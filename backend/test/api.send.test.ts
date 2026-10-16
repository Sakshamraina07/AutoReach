import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, makePdf, PROFILE, type TestEnv } from './helpers/app.js';
import { parseMime } from './helpers/fakeGoogle.js';

let env: TestEnv;
let user: { id: string; token: string; email: string };
let other: { id: string; token: string; email: string };
let resumeA: { id: string };
let resumeB: { id: string };
const pdfA = makePdf('Resume A general');
const pdfB = makePdf('Resume B frontend');

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const key = () => randomUUID();

async function newRecruiter(email: string, extra: Record<string, unknown> = {}) {
  return (await env.api(user.token).post('/api/recruiters', { full_name: 'Meera Iyer', email, company: 'Northwind Labs', ...extra }).expect(201)).body as { id: string };
}

async function newDraft(recruiterId: string, extra: Record<string, unknown> = {}) {
  return (
    await env
      .api(user.token)
      .post('/api/messages', {
        recruiter_id: recruiterId,
        subject: 'Frontend Developer Intern — Sam Kumar',
        body_text:
          "Hi Meera,\n\nI'm Sam, a final-year CS student interested in the Frontend Developer Intern role at Northwind Labs. I built CampusBoard, a React dashboard used by 120 students in the first month. My résumé is attached.\n\nWould you be open to considering me for the role?\n\nThanks,\nSam Kumar",
        ...extra,
      })
      .expect(201)
  ).body as { id: string; tracking_enabled: boolean; resume_id: string | null };
}

beforeAll(async () => {
  env = await createTestEnv();
  user = await env.newUser('sam@student-mail.dev');
  other = await env.newUser('other@student-mail.dev');
  await env.api(user.token).put('/api/profile', PROFILE).expect(200);
  resumeA = (await env.api(user.token).upload('/api/resumes').field('label', 'Software Engineering Resume').attach('file', pdfA, 'Sam_Kumar_SWE.pdf').expect(201)).body;
  resumeB = (await env.api(user.token).upload('/api/resumes').field('label', 'Frontend Resume').field('role_tags', 'frontend,react').attach('file', pdfB, 'Sam_Kumar_Frontend.pdf').expect(201)).body;
  await env.connectGmail(user.id);
});
afterAll(async () => env?.close());
beforeEach(() => {
  env.google.sendQueue = [];
  env.google.sent = [];
});

describe('résumé storage', () => {
  it('stores PDFs privately with checksums; first upload becomes default', async () => {
    const list = (await env.api(user.token).get('/api/resumes').expect(200)).body;
    expect(list).toHaveLength(2);
    const a = list.find((r: { id: string }) => r.id === resumeA.id);
    expect(a).toMatchObject({ is_default: true, sha256: sha(pdfA), file_name: 'Sam_Kumar_SWE.pdf', has_text: true });
    expect(list.find((r: { id: string }) => r.id === resumeB.id).role_tags).toEqual(['frontend', 'react']);
    const keys = [...env.storage.objects.keys()];
    expect(keys.every((k) => k.startsWith(`${user.id}/`))).toBe(true);
    // Only the owner can download.
    const dl = await env.api(user.token).get(`/api/resumes/${resumeA.id}/file`).expect(200);
    expect(sha(Buffer.from(dl.body))).toBe(sha(pdfA));
    await env.api(other.token).get(`/api/resumes/${resumeA.id}/file`).expect(404);
  });

  it('rejects non-PDF uploads', async () => {
    const r = await env.api(user.token).upload('/api/resumes').attach('file', Buffer.from('PK\u0003\u0004 not a pdf'), 'resume.docx');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('NOT_A_PDF');
  });
});

describe('sending', () => {
  it('sends the edited draft with the selected résumé and records Gmail ids', async () => {
    const rec = await newRecruiter('meera@northwind-labs.dev');
    const draft = await newDraft(rec.id, { resume_id: resumeB.id });
    expect(draft.tracking_enabled).toBe(false); // tracking is opt-in
    await env.api(user.token).patch(`/api/messages/${draft.id}`, { body_text: `${'Hi Meera,'}\n\nEdited by me: I built CampusBoard with React and TypeScript, used by 120 students in the first month. My résumé is attached.\n\nWould you consider me for the Frontend Developer Intern role at Northwind Labs?\n\nThanks,\nSam Kumar` }).expect(200);

    const res = await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
    expect(res.body.outcome).toBe('sent');
    const m = res.body.message;
    expect(m.send_status).toBe('sent');
    expect(m.gmail_message_id).toMatch(/^sent/);
    expect(m.gmail_thread_id).toMatch(/^th/);
    expect(m.attachment).toEqual({ file_name: 'Sam_Kumar_Frontend.pdf', size_bytes: pdfB.length, sha256: sha(pdfB) });

    expect(env.google.sent).toHaveLength(1);
    const mime = parseMime(env.google.sent[0]!.raw);
    expect(mime.headers.to).toBe('"Meera Iyer" <meera@northwind-labs.dev>');
    expect(mime.headers.from).toBe(`"Sam Kumar" <${env.google.accountEmail}>`);
    expect(mime.text).toContain('Edited by me');
    expect(mime.html).not.toContain('/t/'); // no pixel when tracking is off
    expect(mime.attachments).toHaveLength(1);
    expect(mime.attachments[0]!.headers).toContain('filename="Sam_Kumar_Frontend.pdf"');
    expect(sha(mime.attachments[0]!.content)).toBe(sha(pdfB));

    const recruiter = (await env.api(user.token).get(`/api/recruiters/${rec.id}`).expect(200)).body;
    expect(recruiter.outreach_status).toBe('contacted');
    expect(recruiter.last_contacted_at).not.toBeNull();
    // A follow-up reminder is created 5 business days later at 10:00 local (UTC by default).
    expect(recruiter.follow_ups).toHaveLength(1);
    expect(recruiter.follow_ups[0]).toMatchObject({ step: 1, status: 'pending' });
    expect(new Date(recruiter.follow_ups[0].due_at).getUTCHours()).toBe(10);
  });

  it('names the attachment from Settings when set, keeping the file intact', async () => {
    await env.api(user.token).patch('/api/settings', { attachment_filename: 'Sam Kumar Resume.pdf' }).expect(200);
    try {
      const rec = await newRecruiter('naming@northwind-labs.dev');
      const draft = await newDraft(rec.id, { resume_id: resumeB.id });
      const res = await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({ confirm_quality_override: true }).expect(200);
      expect(res.body.outcome).toBe('sent');
      expect(res.body.message.attachment.file_name).toBe('Sam Kumar Resume.pdf');
      const mime = parseMime(env.google.sent.at(-1)!.raw);
      expect(mime.attachments[0]!.headers).toContain('filename="Sam Kumar Resume.pdf"');
      expect(sha(mime.attachments[0]!.content)).toBe(sha(pdfB));
    } finally {
      await env.api(user.token).patch('/api/settings', { attachment_filename: null }).expect(200);
    }
  });

  it('prevents duplicate outreach to the same recruiter unless explicitly confirmed', async () => {
    const rec = await newRecruiter('dup@northwind-labs.dev');
    const d1 = await newDraft(rec.id);
    await env.api(user.token).post(`/api/messages/${d1.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
    const d2 = await newDraft(rec.id);
    const blocked = await env.api(user.token).post(`/api/messages/${d2.id}/send`).set('Idempotency-Key', key()).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('DUPLICATE_OUTREACH');
    expect(env.google.sent).toHaveLength(1);
    const ok = await env.api(user.token).post(`/api/messages/${d2.id}/send`).set('Idempotency-Key', key()).send({ confirm_duplicate: true }).expect(200);
    expect(ok.body.outcome).toBe('sent');
  });

  it('handles double submission: same key replays, concurrent keys send once', async () => {
    const rec = await newRecruiter('double@northwind-labs.dev');
    const draft = await newDraft(rec.id);
    const k = key();
    const [a, b] = await Promise.all([
      env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', k).send({}),
      env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({}),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const conflictBody = a.status === 409 ? a.body : b.body;
    expect(['ALREADY_SENDING', 'ALREADY_SENT', 'ALREADY_IN_FLIGHT', 'IDEMPOTENCY_KEY_REUSED']).toContain(conflictBody.error.code);
    expect(env.google.sent).toHaveLength(1);
    // Retrying with the original key returns the stored result without sending again.
    const replay = await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', k).send({});
    if (a.status === 200) {
      expect(replay.status).toBe(200);
      expect(replay.body.outcome).toBe('sent');
    }
    expect(env.google.sent).toHaveLength(1);
  });

  it('requires an Idempotency-Key', async () => {
    const rec = await newRecruiter('nokey@northwind-labs.dev');
    const draft = await newDraft(rec.id);
    const r = await env.api(user.token).post(`/api/messages/${draft.id}/send`, {});
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('marks rejected sends as failed (distinct from sent) and allows a retry', async () => {
    const rec = await newRecruiter('reject@northwind-labs.dev');
    const draft = await newDraft(rec.id);
    env.google.sendQueue.push({ kind: 'http', status: 400, reason: 'invalidArgument', message: 'Invalid To header' });
    const r = await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
    expect(r.body.outcome).toBe('failed');
    expect(r.body.message.send_status).toBe('failed');
    expect(r.body.error.code).toBe('GMAIL_REJECTED');
    const rcp = (await env.api(user.token).get(`/api/recruiters/${rec.id}`).expect(200)).body;
    expect(rcp.outreach_status).toBe('new'); // nothing was sent
    expect(rcp.follow_ups).toHaveLength(0);
    const retry = await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
    expect(retry.body.outcome).toBe('sent');
  });

  it('classifies rate limits as failed-retryable and 5xx / dropped connections as unknown', async () => {
    const r1 = await newRecruiter('rate@northwind-labs.dev');
    const d1 = await newDraft(r1.id);
    env.google.sendQueue.push({ kind: 'http', status: 429, reason: 'rateLimitExceeded' });
    const a = await env.api(user.token).post(`/api/messages/${d1.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
    expect(a.body.error.code).toBe('GMAIL_RATE_LIMITED');
    expect(a.body.message.send_status).toBe('failed');

    const r2 = await newRecruiter('fivexx@northwind-labs.dev');
    const d2 = await newDraft(r2.id);
    env.google.sendQueue.push({ kind: 'http', status: 503, reason: 'backendError' });
    const b = await env.api(user.token).post(`/api/messages/${d2.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
    expect(b.body.outcome).toBe('unknown');
    expect(b.body.message.send_status).toBe('unknown');
    // Unknown outcomes are never retried automatically.
    const again = await env.api(user.token).post(`/api/messages/${d2.id}/send`).set('Idempotency-Key', key()).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('OUTCOME_UNKNOWN');
    // The user checks Gmail and resolves it.
    const resolved = await env.api(user.token).post(`/api/messages/${d2.id}/resolve`, { outcome: 'sent' }).expect(200);
    expect(resolved.body.send_status).toBe('sent');

    const r3 = await newRecruiter('reset@northwind-labs.dev');
    const d3 = await newDraft(r3.id);
    env.google.sendQueue.push({ kind: 'network-ambiguous' });
    const c = await env.api(user.token).post(`/api/messages/${d3.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
    expect(c.body.outcome).toBe('unknown');

    const r4 = await newRecruiter('refused@northwind-labs.dev');
    const d4 = await newDraft(r4.id);
    env.google.sendQueue.push({ kind: 'network-before' });
    const d = await env.api(user.token).post(`/api/messages/${d4.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
    expect(d.body.outcome).toBe('failed');
    expect(d.body.error.code).toBe('GMAIL_UNREACHABLE');
  });

  it('fails safely (nothing sent) when the résumé file is missing from storage', async () => {
    const extra = (await env.api(user.token).upload('/api/resumes').field('label', 'Temp').attach('file', makePdf('temp'), 'Temp.pdf').expect(201)).body;
    const [row] = await env.sql<{ storage_path: string }>(`SELECT storage_path FROM resumes WHERE id = $1`, [extra.id]);
    env.storage.objects.delete(row!.storage_path);
    const rec = await newRecruiter('missing-file@northwind-labs.dev');
    const draft = await newDraft(rec.id, { resume_id: extra.id });
    const r = await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
    expect(r.body.outcome).toBe('failed');
    expect(r.body.error.code).toBe('RESUME_FILE_MISSING');
    expect(env.google.sent).toHaveLength(0);
  });

  it('detects a tampered résumé via checksum', async () => {
    const extra = (await env.api(user.token).upload('/api/resumes').field('label', 'Tamper').attach('file', makePdf('orig'), 'T.pdf').expect(201)).body;
    const [row] = await env.sql<{ storage_path: string }>(`SELECT storage_path FROM resumes WHERE id = $1`, [extra.id]);
    env.storage.objects.set(row!.storage_path, { data: makePdf('changed'), contentType: 'application/pdf' });
    const rec = await newRecruiter('tamper@northwind-labs.dev');
    const draft = await newDraft(rec.id, { resume_id: extra.id });
    const r = await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
    expect(r.body.error.code).toBe('RESUME_CHECKSUM_MISMATCH');
    expect(env.google.sent).toHaveLength(0);
  });

  it('requires a résumé when the setting is on, and blocks quality errors unless overridden', async () => {
    const rec = await newRecruiter('noresume@northwind-labs.dev');
    const draft = await newDraft(rec.id, { resume_id: null });
    const r = await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({});
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('RESUME_REQUIRED');

    const rec2 = await newRecruiter('placeholder@northwind-labs.dev');
    const d2 = await newDraft(rec2.id, { body_text: 'Hi [Recruiter Name], I want to join {company}. My résumé is attached.' });
    const q = await env.api(user.token).post(`/api/messages/${d2.id}/send`).set('Idempotency-Key', key()).send({});
    expect(q.status).toBe(422);
    expect(q.body.error.code).toBe('QUALITY_CHECK_FAILED');
    expect(q.body.error.details.findings.map((f: { code: string }) => f.code)).toContain('PLACEHOLDER_LEFT');
    expect(env.google.sent).toHaveLength(0);
  });

  it('respects pause, the daily limit, do-not-contact and unverified addresses', async () => {
    const rec = await newRecruiter('paused@northwind-labs.dev');
    const draft = await newDraft(rec.id);
    await env.api(user.token).patch('/api/settings', { sending_paused: true }).expect(200);
    const p = await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({});
    expect(p.status).toBe(409);
    expect(p.body.error.code).toBe('SENDING_PAUSED');
    await env.api(user.token).patch('/api/settings', { sending_paused: false, daily_send_limit: 1 }).expect(200);
    const l = await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({});
    expect(l.status).toBe(429);
    expect(l.body.error.code).toBe('DAILY_LIMIT_REACHED');
    await env.api(user.token).patch('/api/settings', { daily_send_limit: 200 }).expect(200);

    const dnc = await newRecruiter('dnc@northwind-labs.dev');
    const dd = await newDraft(dnc.id);
    await env.api(user.token).patch(`/api/recruiters/${dnc.id}`, { do_not_contact: true }).expect(200);
    const x = await env.api(user.token).post(`/api/messages/${dd.id}/send`).set('Idempotency-Key', key()).send({});
    expect(x.body.error.code).toBe('DO_NOT_CONTACT');

    const guess = await newRecruiter('guess@northwind-labs.dev', { email_verification: 'unverified_guess' });
    const gd = await newDraft(guess.id);
    const g1 = await env.api(user.token).post(`/api/messages/${gd.id}/send`).set('Idempotency-Key', key()).send({});
    expect(g1.status).toBe(409);
    expect(g1.body.error.code).toBe('UNVERIFIED_EMAIL');
    const g2 = await env.api(user.token).post(`/api/messages/${gd.id}/send`).set('Idempotency-Key', key()).send({ confirm_unverified_email: true }).expect(200);
    expect(g2.body.outcome).toBe('sent');
    const after = (await env.api(user.token).get(`/api/recruiters/${guess.id}`).expect(200)).body;
    expect(after.email_verification).toBe('confirmed');
  });

  it('does not let one user send or read another user’s message', async () => {
    const rec = await newRecruiter('isolation@northwind-labs.dev');
    const draft = await newDraft(rec.id);
    await env.api(other.token).get(`/api/messages/${draft.id}`).expect(404);
    const r = await env.api(other.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({});
    expect(r.status).toBe(404);
    await env.api(other.token).post('/api/messages', { recruiter_id: rec.id, subject: 'x', body_text: 'y' }).expect(404);
    expect(env.google.sent).toHaveLength(0);
  });

  it('recovers gracefully when Gmail access has expired and refresh is revoked', async () => {
    const u = await env.newUser('expired@student-mail.dev');
    await env.api(u.token).put('/api/profile', PROFILE).expect(200);
    await env.api(u.token).patch('/api/settings', { require_resume_attachment: false }).expect(200);
    await env.connectGmail(u.id, { expired: true });
    env.google.tokenResponses.push({ error: 'invalid_grant', status: 400 });
    const rec = (await env.api(u.token).post('/api/recruiters', { full_name: 'Meera Iyer', email: 'exp@northwind-labs.dev', company: 'Northwind Labs' }).expect(201)).body;
    const draft = (await env.api(u.token).post('/api/messages', { recruiter_id: rec.id, subject: 'Frontend Developer Intern — Sam Kumar', body_text: 'Hi Meera,\n\nI am interested in the Frontend Developer Intern role at Northwind Labs and built CampusBoard with React.\n\nWould you consider me?\n\nSam Kumar' }).expect(201)).body;
    const r = await env.api(u.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
    expect(r.body.outcome).toBe('failed');
    expect(r.body.error.code).toBe('GMAIL_REAUTH_REQUIRED');
    const me = (await env.api(u.token).get('/api/me').expect(200)).body;
    expect(me.gmail.status).toBe('needs_reauth');
    expect(me.gmail.can_send).toBe(false);
    // Subsequent attempts are refused up-front with the same actionable code.
    const again = await env.api(u.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({});
    expect(again.body.error.code).toBe('GMAIL_REAUTH_REQUIRED');
  });

  it('refreshes an expiring access token transparently', async () => {
    const u = await env.newUser('refresh@student-mail.dev');
    await env.api(u.token).put('/api/profile', PROFILE).expect(200);
    await env.api(u.token).patch('/api/settings', { require_resume_attachment: false }).expect(200);
    await env.connectGmail(u.id, { expired: true });
    env.google.tokenResponses.push({ access_token: 'fresh-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata' });
    const rec = (await env.api(u.token).post('/api/recruiters', { full_name: 'Meera Iyer', email: 'fresh@northwind-labs.dev', company: 'Northwind Labs' }).expect(201)).body;
    const draft = (await env.api(u.token).post('/api/messages', { recruiter_id: rec.id, subject: 'Frontend Developer Intern — Sam Kumar', body_text: 'Hi Meera,\n\nI am interested in the Frontend Developer Intern role at Northwind Labs and built CampusBoard with React.\n\nWould you consider me?\n\nSam Kumar' }).expect(201)).body;
    const r = await env.api(u.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
    expect(r.body.outcome).toBe('sent');
    expect(env.google.sent.at(-1)!.accessToken).toBe('fresh-token');
    const [conn] = await env.sql<{ access_token_enc: string }>(`SELECT access_token_enc FROM oauth_connections WHERE user_id = $1`, [u.id]);
    expect(conn!.access_token_enc).toMatch(/^v1:/);
    expect(conn!.access_token_enc).not.toContain('fresh-token');
  });
});

describe('tracking', () => {
  it('embeds a unique pixel only when enabled, maps events to the right message, de-dupes and ignores self-opens', async () => {
    await env.api(user.token).patch('/api/settings', { tracking_enabled: true }).expect(200);
    const r1 = await newRecruiter('track1@northwind-labs.dev');
    const r2 = await newRecruiter('track2@northwind-labs.dev');
    const d1 = await newDraft(r1.id);
    const d2 = await newDraft(r2.id);
    const off = await newDraft((await newRecruiter('track3@northwind-labs.dev')).id, { tracking_enabled: false });
    expect(d1.tracking_enabled).toBe(true);
    for (const d of [d1, d2, off]) await env.api(user.token).post(`/api/messages/${d.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
    const pixels = env.google.sent.map((s) => parseMime(s.raw).html.match(/\/t\/([A-Za-z0-9_-]+)\.gif/)?.[1] ?? null);
    expect(pixels[0]).toBeTruthy();
    expect(pixels[1]).toBeTruthy();
    expect(pixels[0]).not.toBe(pixels[1]);
    expect(pixels[2]).toBeNull();

    const request = (await import('supertest')).default;
    // Immediately after sending → treated as the sender viewing Sent mail; not counted.
    const hit0 = await request(env.app).get(`/t/${pixels[0]}.gif`).set('User-Agent', 'Mozilla/5.0 (via ggpht.com GoogleImageProxy)');
    expect(hit0.status).toBe(200);
    expect(hit0.headers['content-type']).toBe('image/gif');
    await new Promise((r) => setTimeout(r, 150));
    let m1 = (await env.api(user.token).get(`/api/messages/${d1.id}`).expect(200)).body;
    expect(m1.first_open_at).toBeNull();
    expect(m1.events[0].classification).toBe('suspected_self');

    env.clock.now = new Date(Date.now() + 2 * 3600_000);
    await request(env.app).get(`/t/${pixels[0]}.gif`).set('User-Agent', 'Mozilla/5.0 (via ggpht.com GoogleImageProxy)');
    await request(env.app).get(`/t/${pixels[0]}.gif`).set('User-Agent', 'Mozilla/5.0 (via ggpht.com GoogleImageProxy)');
    await request(env.app).get(`/t/${pixels[0]}.gif`).set('User-Agent', 'python-requests/2.31');
    await new Promise((r) => setTimeout(r, 200));
    m1 = (await env.api(user.token).get(`/api/messages/${d1.id}`).expect(200)).body;
    expect(m1.first_open_at).not.toBeNull();
    expect(m1.open_event_count).toBe(1); // second proxy hit de-duplicated, scanner not counted
    expect(m1.events.map((e: { classification: string }) => e.classification).sort()).toEqual(['proxy', 'proxy', 'suspected_automated', 'suspected_self']);
    const m2 = (await env.api(user.token).get(`/api/messages/${d2.id}`).expect(200)).body;
    expect(m2.first_open_at).toBeNull();
    expect(m2.events).toHaveLength(0);

    // Unknown / forged tokens: same image, nothing recorded.
    const forged = await request(env.app).get('/t/AAAAAAAAAAAAAAAAAAAAAA.gif');
    expect(forged.status).toBe(200);

    // Turning tracking off stops recording, and the user can delete all tracking data.
    await env.api(user.token).patch('/api/settings', { tracking_enabled: false }).expect(200);
    await request(env.app).get(`/t/${pixels[1]}.gif`).set('User-Agent', 'Mozilla/5.0');
    await new Promise((r) => setTimeout(r, 150));
    expect((await env.api(user.token).get(`/api/messages/${d2.id}`).expect(200)).body.events).toHaveLength(0);
    await env.api(user.token).post('/api/tracking/delete-all').expect(200);
    m1 = (await env.api(user.token).get(`/api/messages/${d1.id}`).expect(200)).body;
    expect(m1.first_open_at).toBeNull();
    expect(m1.events).toHaveLength(0);
    env.clock.now = new Date();
  });

  it('keeps legacy v1 pixel URLs working', async () => {
    await env.api(user.token).patch('/api/settings', { tracking_enabled: true }).expect(200);
    const rec = await newRecruiter('legacy@northwind-labs.dev');
    const [row] = await env.sql<{ id: string }>(
      `INSERT INTO email_messages (user_id, recruiter_id, recipient_email, subject, send_status, sent_at, legacy, tracking_enabled)
       VALUES ($1,$2,'legacy@northwind-labs.dev','v1 email','sent', now() - interval '3 days', true, true) RETURNING id`,
      [user.id, rec.id],
    );
    await env.sql(`UPDATE email_messages SET tracking_token = id::text WHERE id = $1`, [row!.id]);
    const request = (await import('supertest')).default;
    await request(env.app).get(`/track/${row!.id}`).set('User-Agent', 'Mozilla/5.0').expect(200);
    await new Promise((r) => setTimeout(r, 150));
    const m = (await env.api(user.token).get(`/api/messages/${row!.id}`).expect(200)).body;
    expect(m.first_open_at).not.toBeNull();
    await env.api(user.token).patch('/api/settings', { tracking_enabled: false }).expect(200);
  });
});

describe('scheduled and queued sending', () => {
  it('queues, respects pause, re-checks at send time and sends via the worker', async () => {
    const { processSendQueue } = await import('../src/services/messages.js');
    const rec = await newRecruiter('queued@northwind-labs.dev');
    const draft = await newDraft(rec.id);
    const q = await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({ queue: true }).expect(200);
    expect(q.body.outcome).toBe('queued');
    expect(env.google.sent).toHaveLength(0);

    await env.api(user.token).patch('/api/settings', { sending_paused: true }).expect(200);
    env.clock.now = new Date(Date.now() + 3600_000);
    expect(await processSendQueue(env.deps)).toBe(0);
    expect(env.google.sent).toHaveLength(0);
    await env.api(user.token).patch('/api/settings', { sending_paused: false }).expect(200);
    expect(await processSendQueue(env.deps)).toBe(1);
    expect(env.google.sent).toHaveLength(1);
    const m = (await env.api(user.token).get(`/api/messages/${draft.id}`).expect(200)).body;
    expect(m.send_status).toBe('sent');

    // A queued message whose recruiter replied in the meantime goes back to drafts.
    const rec2 = await newRecruiter('queued2@northwind-labs.dev');
    const d2 = await newDraft(rec2.id);
    await env.api(user.token).post(`/api/messages/${d2.id}/send`).set('Idempotency-Key', key()).send({ queue: true }).expect(200);
    await env.sql(`UPDATE recruiters SET outreach_status = 'replied', last_reply_at = now() WHERE id = $1`, [rec2.id]);
    env.clock.now = new Date(Date.now() + 7200_000);
    await processSendQueue(env.deps);
    const m2 = (await env.api(user.token).get(`/api/messages/${d2.id}`).expect(200)).body;
    expect(m2.send_status).toBe('draft');
    expect(m2.error_code).toBe('RECRUITER_REPLIED');
    env.clock.now = new Date();
  });

  it('turns messages stuck in "sending" into "unknown", never re-sending them', async () => {
    const { sweepStaleSending } = await import('../src/services/messages.js');
    const rec = await newRecruiter('stuck@northwind-labs.dev');
    const draft = await newDraft(rec.id);
    await env.sql(`UPDATE email_messages SET send_status = 'sending', sending_started_at = now() - interval '1 hour' WHERE id = $1`, [draft.id]);
    expect(await sweepStaleSending(env.deps)).toBeGreaterThanOrEqual(1);
    const m = (await env.api(user.token).get(`/api/messages/${draft.id}`).expect(200)).body;
    expect(m.send_status).toBe('unknown');
    expect(env.google.sent).toHaveLength(0);
  });
});

describe('send safety', () => {
  const PLAIN_BODY = "Hi Asha,\n\nI'm Sam, a final-year CS student interested in the Backend Developer Intern role at Contoso. I built CampusBoard, a React dashboard used by 120 students in the first month.\n\nWould you be open to a short call?\n\nThanks,\nSam Kumar";

  async function freshSender(email: string) {
    const u = await env.newUser(email);
    await env.api(u.token).put('/api/profile', PROFILE).expect(200);
    await env.connectGmail(u.id);
    await env.api(u.token).patch('/api/settings', { require_resume_attachment: false }).expect(200);
    const draftFor = async (to: string) => {
      const rec = (await env.api(u.token).post('/api/recruiters', { full_name: 'Asha Rao', email: to, company: 'Contoso' }).expect(201)).body as { id: string };
      return (await env.api(u.token).post('/api/messages', { recruiter_id: rec.id, subject: 'Backend Developer Intern — Sam Kumar', body_text: PLAIN_BODY }).expect(201)).body as { id: string };
    };
    return { ...u, draftFor };
  }

  it('refuses a schedule in the past instead of sending immediately', async () => {
    const rec = await newRecruiter('past@northwind-labs.dev');
    const draft = await newDraft(rec.id);
    const r = await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({ send_at: new Date(Date.now() - 3600_000).toISOString() });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('SEND_AT_IN_PAST');
    expect(env.google.sent).toHaveLength(0);
    expect((await env.api(user.token).get(`/api/messages/${draft.id}`).expect(200)).body.send_status).toBe('draft');
  });

  it('does not let a draft point at another user’s campaign', async () => {
    const theirs = (await env.api(other.token).post('/api/campaigns', { name: 'Their campaign' }).expect(201)).body as { id: string };
    const rec = await newRecruiter('campaign@northwind-labs.dev');
    const draft = await newDraft(rec.id);
    await env.api(user.token).patch(`/api/messages/${draft.id}`, { campaign_id: theirs.id }).expect(404);
    const mine = (await env.api(user.token).post('/api/campaigns', { name: 'Spring internships' }).expect(201)).body as { id: string };
    await env.api(user.token).patch(`/api/messages/${draft.id}`, { campaign_id: mine.id }).expect(200);
  });

  it('keeps simultaneous sends within the daily limit', async () => {
    const s = await freshSender('limit-race@student-mail.dev');
    await env.api(s.token).patch('/api/settings', { daily_send_limit: 1 }).expect(200);
    const [a, b] = await Promise.all([s.draftFor('race-a@contoso.dev'), s.draftFor('race-b@contoso.dev')]);
    const results = await Promise.all([
      env.api(s.token).post(`/api/messages/${a.id}/send`).set('Idempotency-Key', key()).send({}),
      env.api(s.token).post(`/api/messages/${b.id}/send`).set('Idempotency-Key', key()).send({}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(results.find((r) => r.status === 429)!.body.error.code).toBe('DAILY_LIMIT_REACHED');
    expect(env.google.sent).toHaveLength(1);
  });

  it('stops before Gmail when the attempt was taken over while preparing', async () => {
    const rec = await newRecruiter('slow-storage@northwind-labs.dev');
    const draft = await newDraft(rec.id, { resume_id: resumeA.id });
    const original = env.storage.get.bind(env.storage);
    // Storage is slow: meanwhile the stale-send sweeper marks the attempt "unknown".
    env.storage.get = async (p: string) => {
      await env.sql(`UPDATE email_messages SET send_status = 'unknown', error_code = 'SEND_OUTCOME_UNKNOWN' WHERE id = $1`, [draft.id]);
      return original(p);
    };
    try {
      const r = await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', key()).send({}).expect(200);
      expect(r.body.outcome).toBe('failed');
      expect(r.body.error.code).toBe('SEND_PREPARATION_TIMEOUT');
    } finally {
      env.storage.get = original;
    }
    expect(env.google.sent).toHaveLength(0);
    const m = (await env.api(user.token).get(`/api/messages/${draft.id}`).expect(200)).body;
    expect(m.send_status).toBe('failed');
    expect(m.error_code).toBe('SEND_PREPARATION_TIMEOUT');
  });

  it('resolving an old v1 "unknown" as sent uses its creation time and creates no reminder', async () => {
    const rec = await newRecruiter('legacy-unknown@northwind-labs.dev');
    const draft = await newDraft(rec.id);
    const created = new Date(Date.now() - 200 * 86400_000).toISOString();
    await env.sql(`UPDATE email_messages SET legacy = true, send_status = 'unknown', sending_started_at = NULL, created_at = $2, updated_at = now() WHERE id = $1`, [draft.id, created]);
    const r = (await env.api(user.token).post(`/api/messages/${draft.id}/resolve`, { outcome: 'sent' }).expect(200)).body;
    expect(r.send_status).toBe('sent');
    expect(new Date(r.sent_at).toISOString()).toBe(created);
    expect(await env.sql(`SELECT 1 FROM follow_ups WHERE original_message_id = $1 OR previous_message_id = $1`, [draft.id])).toHaveLength(0);
  });

  it('deleting the default résumé while a send holds its message does not deadlock', async () => {
    const pdfC = makePdf('Resume C to delete');
    const resumeC = (await env.api(user.token).upload('/api/resumes').field('label', 'Temporary').field('make_default', 'true').attach('file', pdfC, 'Temp.pdf').expect(201)).body as { id: string };
    const rec = await newRecruiter('lock-order@northwind-labs.dev');
    const draft = await newDraft(rec.id, { resume_id: resumeC.id });
    // Another transaction behaves like a send: message row first, then the user's settings row.
    const sender = new pg.Client({ connectionString: env.dbUrl });
    await sender.connect();
    try {
      await sender.query('BEGIN');
      await sender.query(`SELECT 1 FROM email_messages WHERE id = $1 FOR UPDATE`, [draft.id]);
      const deleting = env.api(user.token).del(`/api/resumes/${resumeC.id}`).then((r) => r);
      await new Promise((r) => setTimeout(r, 300));
      await sender.query(`SELECT 1 FROM user_settings WHERE user_id = $1 FOR UPDATE`, [user.id]);
      await sender.query('COMMIT');
      expect((await deleting).status).toBe(204);
    } finally {
      await sender.end();
    }
    const m = (await env.api(user.token).get(`/api/messages/${draft.id}`).expect(200)).body;
    expect(m.resume_id).toBeNull();
    await env.api(user.token).patch(`/api/resumes/${resumeA.id}`, { is_default: true }).expect(200);
  });

  it('serves other users’ queues while one user is waiting on spacing', async () => {
    const { processSendQueue } = await import('../src/services/messages.js');
    env.clock.now = new Date(Date.now() + 3 * 3600_000);
    try {
      const waiting = await freshSender('spacing-wait@student-mail.dev');
      const sentNow = await waiting.draftFor('just-sent@contoso.dev');
      await env.sql(`UPDATE email_messages SET send_status = 'sent', sent_at = $2 WHERE id = $1`, [sentNow.id, env.clock.now.toISOString()]);
      const older = await waiting.draftFor('older-queued@contoso.dev');
      await env.api(waiting.token).post(`/api/messages/${older.id}/send`).set('Idempotency-Key', key()).send({ queue: true }).expect(200);
      await env.sql(`UPDATE email_messages SET queued_at = now() - interval '1 day' WHERE id = $1`, [older.id]);

      const rec = await newRecruiter('fair-queue@northwind-labs.dev');
      const mine = await newDraft(rec.id);
      await env.api(user.token).post(`/api/messages/${mine.id}/send`).set('Idempotency-Key', key()).send({ queue: true }).expect(200);

      expect(await processSendQueue(env.deps, 1)).toBe(1);
      expect((await env.api(user.token).get(`/api/messages/${mine.id}`).expect(200)).body.send_status).toBe('sent');
      expect((await env.api(waiting.token).get(`/api/messages/${older.id}`).expect(200)).body.send_status).toBe('queued');
    } finally {
      env.clock.now = new Date();
    }
  });
});
