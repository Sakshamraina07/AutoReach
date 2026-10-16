import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { classifyInbound } from '../src/services/replySync.js';
import { createTestEnv, PROFILE, type TestEnv } from './helpers/app.js';
import { parseMime } from './helpers/fakeGoogle.js';

const decodeWords = (v: string) => v.replace(/=\?UTF-8\?B\?([^?]+)\?=\s*/gi, (_m, b64: string) => Buffer.from(b64, 'base64').toString('utf8'));

let env: TestEnv;
let user: { id: string; token: string };

async function sendTo(email: string, name = 'Meera Iyer', company = 'Northwind Labs') {
  const rec = (await env.api(user.token).post('/api/recruiters', { full_name: name, email, company }).expect(201)).body;
  const draft = (
    await env
      .api(user.token)
      .post('/api/messages', {
        recruiter_id: rec.id,
        subject: `Frontend Developer Intern — Sam Kumar`,
        body_text: `Hi ${name.split(' ')[0]},\n\nI'm interested in the Frontend Developer Intern role at ${company}. I built CampusBoard with React, used by 120 students in the first month.\n\nWould you be open to considering me?\n\nThanks,\nSam Kumar`,
      })
      .expect(201)
  ).body;
  const sent = (await env.api(user.token).post(`/api/messages/${draft.id}/send`).set('Idempotency-Key', randomUUID()).send({}).expect(200)).body;
  expect(sent.outcome).toBe('sent');
  return { rec, message: sent.message };
}

async function sync() {
  return (await env.api(user.token).post('/api/integrations/gmail/sync').expect(200)).body;
}

beforeAll(async () => {
  env = await createTestEnv();
  user = await env.newUser('sam@student-mail.dev');
  await env.api(user.token).put('/api/profile', PROFILE).expect(200);
  await env.api(user.token).patch('/api/settings', { require_resume_attachment: false }).expect(200);
  await env.connectGmail(user.id);
});
afterAll(async () => env?.close());
beforeEach(() => {
  env.clock.now = new Date();
});

describe('inbound classification', () => {
  const ctx = { accountEmail: 'sam@gmail.com', recruiterEmail: 'meera@northwind-labs.dev' };
  const h = (o: Partial<Parameters<typeof classifyInbound>[0]>) => ({ from: null, subject: null, autoSubmitted: null, xAutoreply: null, xAutorespond: null, precedence: null, contentType: null, ...o });
  it('distinguishes replies, bounces, auto-replies, colleagues and unrelated senders', () => {
    expect(classifyInbound(h({ from: 'Meera <MEERA@northwind-labs.dev>', subject: 'Re: Intern' }), ctx)).toBe('reply');
    expect(classifyInbound(h({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)' }), ctx)).toBe('bounce');
    expect(classifyInbound(h({ from: 'postmaster@outlook.com', contentType: 'multipart/report; report-type=delivery-status; boundary=x' }), ctx)).toBe('bounce');
    expect(classifyInbound(h({ from: 'meera@northwind-labs.dev', autoSubmitted: 'auto-replied', subject: 'Re: Intern' }), ctx)).toBe('auto_reply');
    expect(classifyInbound(h({ from: 'meera@northwind-labs.dev', subject: 'Automatic reply: Intern' }), ctx)).toBe('auto_reply');
    expect(classifyInbound(h({ from: 'noreply@greenhouse.io', subject: 'Thanks for applying' }), ctx)).toBe('auto_reply');
    expect(classifyInbound(h({ from: 'arjun@northwind-labs.dev', subject: 'Re: Intern' }), ctx)).toBe('possible_reply');
    expect(classifyInbound(h({ from: 'friend@gmail.com', subject: 'Fwd: Intern' }), ctx)).toBe('other_sender');
    expect(classifyInbound(h({ from: 'sam@gmail.com' }), ctx)).toBe('own_message');
    expect(classifyInbound(h({ from: 'x@y.dev' }), { ...ctx, labelIds: ['SENT'] })).toBe('own_message');
    // Same freemail domain is NOT evidence of the same organisation.
    expect(classifyInbound(h({ from: 'someone@gmail.com' }), { accountEmail: 'sam@gmail.com', recruiterEmail: 'recruiter@gmail.com' })).toBe('other_sender');
  });
});

describe('reply sync', () => {
  it('first sync sets the cursor; a recruiter reply marks replied and cancels follow-ups', async () => {
    const { rec, message } = await sendTo('meera@northwind-labs.dev');
    const first = await sync();
    expect(first).toMatchObject({ status: 'ok', mode: 'resync' });
    const pending = await env.sql(`SELECT status FROM follow_ups WHERE recruiter_id = $1`, [rec.id]);
    expect(pending.map((p) => p.status)).toEqual(['pending']);

    env.google.deliverInbound({
      threadId: message.gmail_thread_id,
      headers: { From: 'Meera Iyer <meera@northwind-labs.dev>', Subject: 'Re: Frontend Developer Intern — Sam Kumar', 'Message-ID': '<r1@northwind>' },
      at: new Date(Date.now() + 60_000),
    });
    // Unrelated mail in an untracked thread is never fetched.
    env.google.deliverInbound({ threadId: 'unrelated-thread', headers: { From: 'news@shop.dev', Subject: 'Sale' } });
    const before = env.google.requests.length;
    const r = await sync();
    expect(r).toMatchObject({ status: 'ok', mode: 'incremental', replies: 1 });
    const fetched = env.google.requests.slice(before).filter((q) => q.url.includes('/messages/'));
    expect(fetched).toHaveLength(1);
    expect(fetched[0]!.url).not.toContain('format=full');
    expect(fetched[0]!.url).toContain('format=metadata');

    const m = (await env.api(user.token).get(`/api/messages/${message.id}`).expect(200)).body;
    expect(m.reply_status).toBe('replied');
    expect(m.replied_at).not.toBeNull();
    expect(m.thread).toHaveLength(1);
    const recruiter = (await env.api(user.token).get(`/api/recruiters/${rec.id}`).expect(200)).body;
    expect(recruiter.outreach_status).toBe('replied');
    expect(recruiter.last_reply_at).not.toBeNull();
    expect(recruiter.follow_ups[0]).toMatchObject({ status: 'cancelled', cancel_reason: 'reply_received' });

    // Re-running is idempotent.
    const again = await sync();
    expect(again.processed).toBe(0);

    // And we never message them automatically again; a manual send needs confirmation.
    const d = (await env.api(user.token).post('/api/messages', { recruiter_id: rec.id, follow_up_of_message_id: message.id, subject: 'Re: x', body_text: 'Hi Meera, thanks again! Sam Kumar' }).expect(201)).body;
    const blocked = await env.api(user.token).post(`/api/messages/${d.id}/send`).set('Idempotency-Key', randomUUID()).send({});
    expect(blocked.body.error.code).toBe('RECRUITER_REPLIED');
  });

  it('records bounces and auto-replies without counting them as replies', async () => {
    const bounced = await sendTo('nobody@northwind-labs.dev', 'No Body');
    const ooo = await sendTo('away@northwind-labs.dev', 'Away Person');
    await sync();
    env.google.deliverInbound({
      threadId: bounced.message.gmail_thread_id,
      headers: { From: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', Subject: 'Delivery Status Notification (Failure)', 'Content-Type': 'multipart/report; report-type=delivery-status; boundary="b"' },
      at: new Date(Date.now() + 60_000),
    });
    env.google.deliverInbound({
      threadId: ooo.message.gmail_thread_id,
      headers: { From: 'away@northwind-labs.dev', Subject: 'Automatic reply: Frontend Developer Intern', 'Auto-Submitted': 'auto-replied' },
      at: new Date(Date.now() + 60_000),
    });
    const r = await sync();
    expect(r.replies).toBe(0);
    const mb = (await env.api(user.token).get(`/api/messages/${bounced.message.id}`).expect(200)).body;
    expect(mb.reply_status).toBe('bounced');
    const rb = (await env.api(user.token).get(`/api/recruiters/${bounced.rec.id}`).expect(200)).body;
    expect(rb.outreach_status).toBe('bounced');
    expect(rb.follow_ups[0].status).toBe('cancelled');
    const mo = (await env.api(user.token).get(`/api/messages/${ooo.message.id}`).expect(200)).body;
    expect(mo.reply_status).toBe('auto_reply');
    const ro = (await env.api(user.token).get(`/api/recruiters/${ooo.rec.id}`).expect(200)).body;
    expect(ro.outreach_status).toBe('contacted');
    expect(ro.follow_ups[0].status).toBe('pending'); // an out-of-office does not cancel the reminder
  });

  it('sends ambiguous senders to a review queue for manual confirmation', async () => {
    const { rec, message } = await sendTo('lead@contoso-corp.dev', 'Lead Recruiter', 'Contoso');
    await sync();
    env.google.deliverInbound({
      threadId: message.gmail_thread_id,
      headers: { From: 'Hiring Manager <manager@contoso-corp.dev>', Subject: 'Re: Frontend Developer Intern' },
      at: new Date(Date.now() + 60_000),
    });
    await sync();
    const m = (await env.api(user.token).get(`/api/messages/${message.id}`).expect(200)).body;
    expect(m.reply_status).toBe('needs_review');
    const queue = (await env.api(user.token).get('/api/review-queue').expect(200)).body;
    const item = queue.find((q: { matched_message_id: string }) => q.matched_message_id === message.id);
    expect(item.classification).toBe('possible_reply');
    const decided = await env.api(user.token).post(`/api/review-queue/${item.id}`, { decision: 'is_reply' }).expect(200);
    expect(decided.body.message.reply_status).toBe('replied');
    const r = (await env.api(user.token).get(`/api/recruiters/${rec.id}`).expect(200)).body;
    expect(r.follow_ups[0].status).toBe('cancelled');
    // Manual correction back to "no reply" is possible.
    const undone = await env.api(user.token).patch(`/api/messages/${message.id}/reply-status`, { reply_status: 'none' }).expect(200);
    expect(undone.body.reply_status).toBe('none');
  });

  it('resynchronises safely when the Gmail history cursor has expired', async () => {
    const { message } = await sendTo('cursor@fabrikam-hr.dev', 'Cursor Test', 'Fabrikam');
    await sync();
    env.google.deliverInbound({
      threadId: message.gmail_thread_id,
      headers: { From: 'cursor@fabrikam-hr.dev', Subject: 'Re: Frontend Developer Intern' },
      at: new Date(Date.now() + 60_000),
    });
    env.google.historyExpired = true;
    const r = await sync();
    expect(r).toMatchObject({ status: 'ok', mode: 'resync' });
    env.google.historyExpired = false;
    const m = (await env.api(user.token).get(`/api/messages/${message.id}`).expect(200)).body;
    expect(m.reply_status).toBe('replied');
  });

  it('skips reply detection (without failing) when the metadata scope was not granted', async () => {
    const u = await env.newUser('sendonly@student-mail.dev');
    await env.connectGmail(u.id, { scopes: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/userinfo.email'] });
    const me = (await env.api(u.token).get('/api/me').expect(200)).body;
    expect(me.gmail.can_send).toBe(true);
    expect(me.gmail.can_detect_replies).toBe(false);
    const r = (await env.api(u.token).post('/api/integrations/gmail/sync').expect(200)).body;
    expect(r).toMatchObject({ status: 'skipped', reason: 'GMAIL_SCOPE_MISSING' });
  });
});

describe('follow-ups', () => {
  it('lists due reminders, drafts an in-thread follow-up, sends it and schedules the next step', async () => {
    const { rec, message } = await sendTo('fu@woodgrove-talent.dev', 'Follow Up', 'Woodgrove');
    env.clock.now = new Date(Date.now() + 10 * 86_400_000);
    const due = (await env.api(user.token).get('/api/followups?view=due').expect(200)).body;
    const fu = due.items.find((f: { recruiter_id: string }) => f.recruiter_id === rec.id);
    expect(fu).toMatchObject({ step: 1, status: 'pending', previous_subject: 'Frontend Developer Intern — Sam Kumar' });
    expect(fu.business_days_since_contact).toBeGreaterThanOrEqual(6);

    const drafted = (await env.api(user.token).post(`/api/followups/${fu.id}/draft`, { use_template: true }).expect(200)).body;
    expect(drafted.draft.source).toBe('template');
    expect(drafted.message.kind).toBe('follow_up');
    expect(drafted.message.subject).toBe('Re: Frontend Developer Intern — Sam Kumar');
    expect(drafted.message.body_text).toContain('following up on my email');
    // Asking again returns the same draft (no duplicates).
    const again = (await env.api(user.token).post(`/api/followups/${fu.id}/draft`, {}).expect(200)).body;
    expect(again.message.id).toBe(drafted.message.id);

    const sent = (await env.api(user.token).post(`/api/messages/${drafted.message.id}/send`).set('Idempotency-Key', randomUUID()).send({}).expect(200)).body;
    expect(sent.outcome).toBe('sent');
    // Same Gmail thread as the original.
    expect(env.google.sent.at(-1)!.threadId).toBe(message.gmail_thread_id);
    expect(env.google.sent.at(-1)!.raw).toMatch(/In-Reply-To: <CAF/);

    const r = (await env.api(user.token).get(`/api/recruiters/${rec.id}`).expect(200)).body;
    const steps = r.follow_ups.map((f: { step: number; status: string }) => `${f.step}:${f.status}`).sort();
    expect(steps).toEqual(['1:completed', '2:pending']);

    const step2 = r.follow_ups.find((f: { step: number }) => f.step === 2);
    // Two simultaneous "draft follow-up" requests produce one draft, not two.
    const [d1, d2] = await Promise.all([
      env.api(user.token).post(`/api/followups/${step2.id}/draft`, { use_template: true }).expect(200),
      env.api(user.token).post(`/api/followups/${step2.id}/draft`, { use_template: true }).expect(200),
    ]);
    expect(d1.body.message.id).toBe(d2.body.message.id);
    expect(await env.sql(`SELECT 1 FROM email_messages WHERE follow_up_id = $1`, [step2.id])).toHaveLength(1);

    // Reschedule and dismiss.
    const later = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const moved = (await env.api(user.token).patch(`/api/followups/${step2.id}`, { due_at: later }).expect(200)).body;
    expect(new Date(moved.due_at).toISOString()).toBe(later);
    const dismissed = (await env.api(user.token).patch(`/api/followups/${step2.id}`, { status: 'dismissed' }).expect(200)).body;
    expect(dismissed.status).toBe('dismissed');
  });

  it('ends reminders when the user marks the conversation as answered or closed by hand', async () => {
    const { rec } = await sendTo('manual-status@woodgrove-talent.dev', 'Manual Status', 'Woodgrove');
    const pending = async () => (await env.sql(`SELECT 1 FROM follow_ups WHERE recruiter_id = $1 AND status = 'pending'`, [rec.id])).length;
    expect(await pending()).toBe(1);
    await env.api(user.token).patch(`/api/recruiters/${rec.id}`, { outreach_status: 'not_interested' }).expect(200);
    expect(await pending()).toBe(0);
    const [fu] = await env.sql<{ cancel_reason: string }>(`SELECT cancel_reason FROM follow_ups WHERE recruiter_id = $1`, [rec.id]);
    expect(fu!.cancel_reason).toBe('not_interested');
  });

  it('auto-sends only when explicitly enabled, from the user’s own template, within the cap', async () => {
    const { processFollowUpAutoSend } = await import('../src/services/followupAutosend.js');
    const { processSendQueue } = await import('../src/services/messages.js');
    const { rec } = await sendTo('auto@woodgrove-talent.dev', 'Auto Person', 'Woodgrove');
    await env.sql(`UPDATE follow_ups SET auto_send = true WHERE recruiter_id = $1`, [rec.id]);
    await env.api(user.token).patch(`/api/recruiters/${rec.id}`, { target_role: 'Frontend Developer Intern' }).expect(200);
    env.clock.now = new Date(Date.now() + 10 * 86_400_000);
    await env.sql(`UPDATE follow_ups SET due_at = now() - interval '1 hour' WHERE recruiter_id = $1`, [rec.id]);
    // Disabled in settings → nothing happens.
    expect(await processFollowUpAutoSend(env.deps)).toBe(0);
    await env.api(user.token).patch('/api/settings', { followup_autosend_enabled: true, followup_autosend_daily_cap: 1 }).expect(200);
    // Enabled but no saved follow-up template → still nothing (never auto-sends AI text).
    expect(await processFollowUpAutoSend(env.deps)).toBe(0);
    await env.api(user.token).put('/api/templates/followup_1', { subject: 'Re: {role}', body: 'Hi {first_name},\n\nFollowing up on my note about {role} at {company}.\n\nThanks,\n{user_name}' }).expect(200);
    expect(await processFollowUpAutoSend(env.deps)).toBe(1);
    const sentBefore = env.google.sent.length;
    // Move past the per-user send spacing window (an earlier test sent at "+10 days").
    env.clock.now = new Date(Date.now() + 11 * 86_400_000);
    expect(await processSendQueue(env.deps)).toBe(1);
    expect(env.google.sent.length).toBe(sentBefore + 1);
    const mime = parseMime(env.google.sent.at(-1)!.raw);
    expect(decodeWords(mime.headers.subject!)).toBe('Re: Frontend Developer Intern — Sam Kumar');
    expect(mime.text).toBe('Hi Auto,\n\nFollowing up on my note about Frontend Developer Intern at Woodgrove.\n\nThanks,\nSam Kumar');
    await env.api(user.token).patch('/api/settings', { followup_autosend_enabled: false }).expect(200);
  });
});

describe('Gmail OAuth connection', () => {
  it('builds a consent URL with minimal scopes, PKCE and single-use state; stores tokens encrypted', async () => {
    const u = await env.newUser('connect@student-mail.dev');
    const auth = (await env.api(u.token).post('/api/integrations/gmail/authorize', { return_to: 'dashboard' }).expect(200)).body;
    const url = new URL(auth.url);
    expect(url.host).toBe('accounts.google.com');
    expect(url.searchParams.get('scope')!.split(' ').sort()).toEqual(['email', 'https://www.googleapis.com/auth/gmail.metadata', 'https://www.googleapis.com/auth/gmail.send', 'openid']);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.autoreach.test/api/integrations/gmail/callback');
    const state = url.searchParams.get('state')!;
    env.google.tokenResponses.push({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: 'openid https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata https://www.googleapis.com/auth/userinfo.email' });
    const request = (await import('supertest')).default;
    const cb = await request(env.app).get(`/api/integrations/gmail/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(303);
    expect(cb.headers.location).toBe('https://app.autoreach.test/settings?section=gmail&gmail=connected');
    const [row] = await env.sql<{ access_token_enc: string; refresh_token_enc: string; scopes: string[]; account_email: string }>(`SELECT * FROM oauth_connections WHERE user_id = $1`, [u.id]);
    expect(row!.account_email).toBe(env.google.accountEmail);
    expect(row!.refresh_token_enc).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain('new-refresh');
    expect(JSON.stringify(row)).not.toContain('new-access');
    // State cannot be replayed.
    const replay = await request(env.app).get(`/api/integrations/gmail/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(replay.status).toBe(400);
    expect(replay.text).toContain('expired or was already used');
    // Disconnect revokes at Google and removes tokens.
    await env.api(u.token).del('/api/integrations/gmail').expect(204);
    expect(env.google.revoked).toContain('new-refresh');
    expect(await env.sql(`SELECT 1 FROM oauth_connections WHERE user_id = $1`, [u.id])).toHaveLength(0);
  });

  it('can be set up to send only, without the restricted header permission', async () => {
    const gmailCfg = env.deps.config.gmail as { replyDetection: boolean };
    gmailCfg.replyDetection = false;
    try {
      const auth = (await env.api(user.token).post('/api/integrations/gmail/authorize', {}).expect(200)).body;
      expect(new URL(auth.url).searchParams.get('scope')!.split(' ').sort()).toEqual(['email', 'https://www.googleapis.com/auth/gmail.send', 'openid']);
      const me = (await env.api(user.token).get('/api/me').expect(200)).body;
      expect(me.gmail).toMatchObject({ reply_detection_enabled: false, can_detect_replies: false, can_send: true });
      expect(await sync()).toMatchObject({ status: 'skipped', reason: 'REPLY_DETECTION_DISABLED' });
    } finally {
      gmailCfg.replyDetection = true;
    }
    expect((await env.api(user.token).get('/api/me').expect(200)).body.gmail).toMatchObject({ reply_detection_enabled: true, can_detect_replies: true });
  });

  it('returns to the onboarding wizard when the connection was started there', async () => {
    const u = await env.newUser('onboard-connect@student-mail.dev');
    const auth = (await env.api(u.token).post('/api/integrations/gmail/authorize', { return_to: 'onboarding' }).expect(200)).body;
    const state = new URL(auth.url).searchParams.get('state')!;
    env.google.tokenResponses.push({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata' });
    const request = (await import('supertest')).default;
    const cb = await request(env.app).get(`/api/integrations/gmail/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(303);
    expect(cb.headers.location).toBe('https://app.autoreach.test/onboarding?gmail=connected');
    await env.api(u.token).post('/api/integrations/gmail/authorize', { return_to: 'elsewhere' }).expect(400);
  });

  it('refuses a connection where the user unticked the send permission', async () => {
    const u = await env.newUser('nosend@student-mail.dev');
    const auth = (await env.api(u.token).post('/api/integrations/gmail/authorize', {}).expect(200)).body;
    const state = new URL(auth.url).searchParams.get('state')!;
    env.google.tokenResponses.push({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/gmail.metadata' });
    const request = (await import('supertest')).default;
    const cb = await request(env.app).get(`/api/integrations/gmail/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(400);
    expect(cb.text).toContain('did not grant permission to send');
    expect(await env.sql(`SELECT 1 FROM oauth_connections WHERE user_id = $1`, [u.id])).toHaveLength(0);
  });

  it('encrypts v1 plaintext tokens on start-up and clears the plaintext', async () => {
    const { importLegacyTokens } = await import('../src/services/gmail/connection.js');
    const u = await env.newUser('legacy@student-mail.dev');
    await env.sql(`INSERT INTO user_smtp_settings (user_id, gmail_user, gmail_access_token, gmail_refresh_token, token_expires_at) VALUES ($1,'legacy@gmail.com','plain-a','plain-r', now())`, [u.id]);
    expect(await importLegacyTokens(env.deps)).toBe(1);
    const [legacy] = await env.sql(`SELECT gmail_access_token, gmail_refresh_token, migrated_at FROM user_smtp_settings WHERE user_id = $1`, [u.id]);
    expect(legacy).toMatchObject({ gmail_access_token: null, gmail_refresh_token: null });
    const [conn] = await env.sql<{ refresh_token_enc: string; imported_from_v1: boolean; scopes: string[] }>(`SELECT * FROM oauth_connections WHERE user_id = $1`, [u.id]);
    expect(conn!.imported_from_v1).toBe(true);
    expect(conn!.refresh_token_enc).not.toContain('plain-r');
    const me = (await env.api(u.token).get('/api/me').expect(200)).body;
    expect(me.gmail).toMatchObject({ connected: true, can_send: true, can_detect_replies: false });
    expect(await importLegacyTokens(env.deps)).toBe(0); // idempotent
  });
});

describe('analytics from stored records', () => {
  it('reports KPIs, time series, breakdowns and insights from real rows', async () => {
    const ov = (await env.api(user.token).get('/api/analytics/overview?range=30d').expect(200)).body;
    const [counts] = await env.sql<{ sent: number; replies: number; recruiters: number }>(
      `SELECT (SELECT count(*)::int FROM email_messages WHERE user_id = $1 AND send_status = 'sent' AND sent_at <= now()) AS sent,
              (SELECT count(*)::int FROM email_messages WHERE user_id = $1 AND reply_status = 'replied' AND replied_at <= now()) AS replies,
              (SELECT count(*)::int FROM recruiters WHERE user_id = $1 AND merged_into_id IS NULL) AS recruiters`,
      [user.id],
    );
    expect(ov.kpis.emails_sent.value).toBe(counts!.sent);
    expect(ov.kpis.replies.value).toBe(counts!.replies);
    expect(ov.kpis.total_recruiters.value).toBe(counts!.recruiters);
    expect(ov.kpis.response_rate.sample).toBeGreaterThan(0);
    const ts = (await env.api(user.token).get('/api/analytics/timeseries?range=7d').expect(200)).body;
    expect(ts.length).toBeGreaterThanOrEqual(7);
    expect(ts.reduce((s: number, p: { sent: number }) => s + p.sent, 0)).toBe(counts!.sent);
    const bd = (await env.api(user.token).get('/api/analytics/breakdown?by=company&range=30d').expect(200)).body;
    expect(bd.rows.every((r: { small_sample: boolean }) => r.small_sample)).toBe(true);
    const ins = (await env.api(user.token).get('/api/analytics/insights?range=30d').expect(200)).body;
    expect(ins.every((i: { directional: boolean }) => i.directional)).toBe(true);
    const act = (await env.api(user.token).get('/api/activity?page_size=100').expect(200)).body;
    const types = new Set(act.items.map((a: { type: string }) => a.type));
    for (const t of ['recruiter_added', 'email_sent', 'reply_received', 'followup_scheduled', 'bounce_detected']) expect(types.has(t)).toBe(true);
  });
});

describe('account data rights', () => {
  it('exports without secrets and deletes everything for the user only', async () => {
    const u = await env.newUser('leaving@student-mail.dev');
    await env.api(u.token).put('/api/profile', { ...PROFILE, full_name: 'Leaving User' }).expect(200);
    await env.api(u.token).post('/api/recruiters', { email: 'x@leaving-co.dev' }).expect(201);
    await env.connectGmail(u.id);
    const exp = await env.api(u.token).get('/api/account/export').expect(200);
    expect(exp.body.recruiters).toHaveLength(1);
    expect(JSON.stringify(exp.body)).not.toMatch(/token_enc|v1:/);
    const bad = await env.api(u.token).del('/api/account', { confirm: 'yes' });
    expect(bad.status).toBe(400);
    const del = await env.api(u.token).del('/api/account', { confirm: 'DELETE MY ACCOUNT' }).expect(200);
    expect(del.body.auth_user_deleted).toBe(false); // no Supabase service key in tests
    const left = await env.sql(`SELECT (SELECT count(*)::int FROM recruiters WHERE user_id = $1) r, (SELECT count(*)::int FROM oauth_connections WHERE user_id = $1) o, (SELECT count(*)::int FROM profiles WHERE user_id = $1) p`, [u.id]);
    expect(left[0]).toEqual({ r: 0, o: 0, p: 0 });
    // Other users untouched.
    const mine = await env.sql(`SELECT count(*)::int AS n FROM recruiters WHERE user_id = $1`, [user.id]);
    expect(mine[0]!.n).toBeGreaterThan(0);
  });
});
