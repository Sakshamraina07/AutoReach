import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, PROFILE, type TestEnv } from './helpers/app.js';

let env: TestEnv;
let alice: { id: string; token: string };
let bob: { id: string; token: string };

beforeAll(async () => {
  env = await createTestEnv();
  alice = await env.newUser('alice@student-mail.dev');
  bob = await env.newUser('bob@student-mail.dev');
});
afterAll(async () => env?.close());

describe('authentication', () => {
  it('rejects missing and invalid tokens', async () => {
    const r1 = await (await import('supertest')).default(env.app).get('/api/me');
    expect(r1.status).toBe(401);
    expect(r1.body.error.code).toBe('UNAUTHENTICATED');
    const r2 = await env.api('not-a-jwt').get('/api/me');
    expect(r2.status).toBe(401);
    expect(r2.body.error.code).toBe('SESSION_EXPIRED');
  });
});

describe('onboarding and profile', () => {
  it('starts incomplete, saves partial steps, then completes', async () => {
    const me0 = await env.api(alice.token).get('/api/me').expect(200);
    expect(me0.body.onboarding_completed).toBe(false);
    expect(me0.body.completeness.percent).toBe(0);
    expect(me0.body.settings.tracking_enabled).toBe(false);

    await env.api(alice.token).patch('/api/profile', { full_name: 'Sam Kumar', skills: ['react', 'TypeScript', 'React'] }).expect(200);
    const p1 = await env.api(alice.token).get('/api/profile').expect(200);
    expect(p1.body.skills).toEqual(['React', 'TypeScript']); // canonicalised + de-duplicated

    // A later partial step must not wipe earlier fields.
    await env.api(alice.token).patch('/api/profile', { university: 'Example Institute of Technology' }).expect(200);
    const p2 = await env.api(alice.token).get('/api/profile').expect(200);
    expect(p2.body.skills).toEqual(['React', 'TypeScript']);
    expect(p2.body.university).toBe('Example Institute of Technology');

    await env.api(alice.token).put('/api/profile', PROFILE).expect(200);
    await env.api(alice.token).post('/api/profile/complete-onboarding').expect(200);
    const me = await env.api(alice.token).get('/api/me').expect(200);
    expect(me.body.onboarding_completed).toBe(true);
    expect(me.body.profile.projects).toHaveLength(2);
    expect(me.body.completeness.percent).toBeGreaterThan(50);
  });

  it('validates profile input', async () => {
    const r = await env.api(alice.token).patch('/api/profile', { graduation_month: 13, links: { github: 'javascript:alert(1)', linkedin: null, portfolio: null, other: [] } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('extracts profile suggestions from pasted résumé text without saving them', async () => {
    const text = `Priya Sharma\npriya@student-mail.dev | +91 98765 43210 | github.com/priya-dev\nEducation\nB.Tech in Computer Science, Example Institute of Technology, 2026\nSkills\nPython, React, Docker\nProjects\nTaskFlow\n• Built a Kanban app with React and Node.js used by 40 teams`;
    const before = await env.api(bob.token).get('/api/profile').expect(200);
    const r = await env.api(bob.token).post('/api/profile/extract', { pasted_text: text }).expect(200);
    expect(r.body.source).toBe('heuristic');
    expect(r.body.suggested.full_name).toBe('Priya Sharma');
    expect(r.body.suggested.primary_email).toBe('priya@student-mail.dev');
    expect(r.body.suggested.skills).toEqual(expect.arrayContaining(['Python', 'React', 'Docker']));
    expect(r.body.suggested.graduation_year).toBe(2026);
    expect(r.body.suggested.links.github).toBe('https://github.com/priya-dev');
    const after = await env.api(bob.token).get('/api/profile').expect(200);
    expect(after.body).toEqual(before.body);
  });
});

describe('recruiter CRM', () => {
  let meera: { id: string };

  it('creates recruiters and blocks duplicates by normalised email (server-side)', async () => {
    const r = await env.api(alice.token).post('/api/recruiters', { full_name: 'Meera Iyer', email: 'Meera.Iyer@Northwind.io', company: 'Northwind Labs', title: 'Campus Recruiter', tags: ['frontend'] }).expect(201);
    meera = r.body;
    expect(r.body.outreach_status).toBe('new');
    expect(r.body.company_id).toBeTruthy();
    const dup = await env.api(alice.token).post('/api/recruiters', { email: '  meera.iyer@northwind.IO ' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_RECRUITER');
    expect(dup.body.error.details.existing.id).toBe(meera.id);
    // Another user may have the same contact — data is per user.
    await env.api(bob.token).post('/api/recruiters', { email: 'meera.iyer@northwind.io' }).expect(201);
  });

  it('searches, filters and sorts', async () => {
    await env.api(alice.token).post('/api/recruiters', { full_name: 'Ravi Menon', email: 'ravi@contoso.dev', company: 'Contoso', tags: ['backend'], source: 'csv' }).expect(201);
    const byName = await env.api(alice.token).get('/api/recruiters?q=meera').expect(200);
    expect(byName.body.items.map((x: { email: string }) => x.email)).toEqual(['Meera.Iyer@Northwind.io']);
    const byCompany = await env.api(alice.token).get('/api/recruiters?q=contoso').expect(200);
    expect(byCompany.body.total).toBe(1);
    const byTag = await env.api(alice.token).get('/api/recruiters?tag=backend').expect(200);
    expect(byTag.body.items[0].full_name).toBe('Ravi Menon');
    const bySource = await env.api(alice.token).get('/api/recruiters?source=csv').expect(200);
    expect(bySource.body.total).toBe(1);
    const sorted = await env.api(alice.token).get('/api/recruiters?sort=name').expect(200);
    expect(sorted.body.items.map((x: { full_name: string }) => x.full_name)).toEqual(['Meera Iyer', 'Ravi Menon']);
    const bad = await env.api(alice.token).get('/api/recruiters?sort=drop_table');
    expect(bad.status).toBe(400);
  });

  it('isolates users: another user cannot read, edit or delete', async () => {
    const list = await env.api(bob.token).get('/api/recruiters').expect(200);
    expect(list.body.items.every((x: { id: string }) => x.id !== meera.id)).toBe(true);
    await env.api(bob.token).get(`/api/recruiters/${meera.id}`).expect(404);
    await env.api(bob.token).patch(`/api/recruiters/${meera.id}`, { notes: 'mine now' }).expect(404);
    await env.api(bob.token).del(`/api/recruiters/${meera.id}`).expect(404);
    const still = await env.api(alice.token).get(`/api/recruiters/${meera.id}`).expect(200);
    expect(still.body.notes).toBeNull();
  });

  it('updates without clobbering fields that were not sent', async () => {
    const r = await env.api(alice.token).patch(`/api/recruiters/${meera.id}`, { notes: 'Met at a meetup' }).expect(200);
    expect(r.body.notes).toBe('Met at a meetup');
    expect(r.body.tags).toEqual(['frontend']);
    expect(r.body.source).toBe('manual');
    expect(r.body.title).toBe('Campus Recruiter');
  });

  it('imports CSV with a dry-run preview, then commits only new valid rows', async () => {
    const csv = 'Name,Email,Company,Title,Tags\nAnil Rao,anil@fabrikam.dev,Fabrikam,Talent Partner,fresher;backend\nDup,MEERA.IYER@northwind.io,Northwind Labs,,\nBad,not-an-email,X,,\nAnil Again,anil@fabrikam.dev,Fabrikam,,\nCareers,careers@fabrikam.dev,Fabrikam,,\n';
    const preview = await env
      .api(alice.token)
      .upload('/api/recruiters/import')
      .field('dry_run', 'true')
      .attach('file', Buffer.from(csv), 'contacts.csv');
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ dry_run: true, total_rows: 5, created: 0, duplicates: 2, invalid: 1 });
    expect(preview.body.rows.find((r: { email: string }) => r.email === 'careers@fabrikam.dev').role_address).toBe(true);
    const before = await env.api(alice.token).get('/api/recruiters').expect(200);
    const commit = await env.api(alice.token).upload('/api/recruiters/import').field('dry_run', 'false').attach('file', Buffer.from(csv), 'contacts.csv').expect(200);
    expect(commit.body.created).toBe(2);
    const after = await env.api(alice.token).get('/api/recruiters').expect(200);
    expect(after.body.total).toBe(before.body.total + 2);
    const anil = after.body.items.find((x: { email: string }) => x.email === 'anil@fabrikam.dev');
    expect(anil.tags).toEqual(['fresher', 'backend']);
    expect(anil.source).toBe('csv');
  });

  it('exports CSV with formula-injection protection', async () => {
    await env.api(alice.token).post('/api/recruiters', { full_name: '=HYPERLINK("x")', email: 'formula@fabrikam.dev' }).expect(201);
    const r = await env.api(alice.token).get('/api/recruiters/export').expect(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(r.text).toContain('Meera.Iyer@Northwind.io');
  });

  it('suggests possible duplicates and merges them without losing history', async () => {
    const a = await env.api(alice.token).post('/api/recruiters', { full_name: 'Neha Gupta', email: 'neha.gupta@gmail.com', company: 'Wingtip' }).expect(201);
    const b = await env.api(alice.token).post('/api/recruiters', { full_name: 'Neha Gupta', email: 'nehagupta+jobs@gmail.com', company: 'Wingtip Toys', tags: ['referral-ask'] }).expect(201);
    // give b some history
    await env.sql(`INSERT INTO email_messages (user_id, recruiter_id, recipient_email, subject, send_status, sent_at) VALUES ($1,$2,'nehagupta+jobs@gmail.com','Earlier','sent', now())`, [alice.id, b.body.id]);
    const sugg = await env.api(alice.token).get('/api/recruiters/duplicates').expect(200);
    const group = sugg.body.find((g: { recruiters: { id: string }[] }) => g.recruiters.some((r) => r.id === a.body.id));
    expect(group.reason).toBe('same_canonical_email');
    const merged = await env.api(alice.token).post(`/api/recruiters/${a.body.id}/merge`, { source_id: b.body.id }).expect(200);
    expect(merged.body.tags).toEqual(['referral-ask']);
    expect(merged.body.messages_sent).toBe(1);
    const detail = await env.api(alice.token).get(`/api/recruiters/${a.body.id}`).expect(200);
    expect(detail.body.merged_from.map((m: { id: string }) => m.id)).toEqual([b.body.id]);
    expect(detail.body.messages).toHaveLength(1);
    // merged husk is hidden from the list
    const list = await env.api(alice.token).get('/api/recruiters?q=neha').expect(200);
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([a.body.id]);
  });

  it('marks do-not-contact and cancels pending follow-ups', async () => {
    const r = await env.api(alice.token).post('/api/recruiters', { email: 'dnc@fabrikam.dev' }).expect(201);
    const [m] = await env.sql<{ id: string }>(`INSERT INTO email_messages (user_id, recruiter_id, recipient_email, subject, send_status, sent_at) VALUES ($1,$2,'dnc@fabrikam.dev','Hi','sent', now()) RETURNING id`, [alice.id, r.body.id]);
    await env.sql(`INSERT INTO follow_ups (user_id, recruiter_id, original_message_id, previous_message_id, step, due_at) VALUES ($1,$2,$3,$3,1, now())`, [alice.id, r.body.id, m!.id]);
    const u = await env.api(alice.token).patch(`/api/recruiters/${r.body.id}`, { do_not_contact: true }).expect(200);
    expect(u.body.outreach_status).toBe('do_not_contact');
    const fu = await env.sql(`SELECT status, cancel_reason FROM follow_ups WHERE recruiter_id = $1`, [r.body.id]);
    expect(fu[0]).toEqual({ status: 'cancelled', cancel_reason: 'do_not_contact' });
  });
});

describe('opportunities', () => {
  it('creates an opportunity, derives role category and skills, links recruiters, explains match', async () => {
    const rec = await env.api(alice.token).post('/api/recruiters', { full_name: 'Kiran Das', email: 'kiran@adventure-works.dev', company: 'Adventure Works' }).expect(201);
    const o = await env
      .api(alice.token)
      .post('/api/opportunities', {
        company: 'Adventure Works',
        title: 'Frontend Developer Intern',
        description: 'You will build UI with React, TypeScript and GraphQL. 0-1 years of experience. Familiarity with Docker is a plus.',
        employment_type: 'internship',
        recruiter_ids: [rec.body.id],
      })
      .expect(201);
    expect(o.body.role_category).toBe('frontend');
    expect(o.body.required_skills).toEqual(expect.arrayContaining(['React', 'TypeScript', 'GraphQL', 'Docker']));
    expect(o.body.experience_requirements).toMatch(/0-1 years/);
    expect(o.body.recruiter_count).toBe(1);
    const detail = await env.api(alice.token).get(`/api/opportunities/${o.body.id}`).expect(200);
    expect(detail.body.recruiters[0].id).toBe(rec.body.id);
    expect(detail.body.skill_match.matched).toEqual(expect.arrayContaining(['React', 'TypeScript']));
    expect(detail.body.skill_match.missing).toEqual(expect.arrayContaining(['GraphQL', 'Docker']));
    const match = await env.api(alice.token).get(`/api/opportunities/${o.body.id}/match`).expect(200);
    expect(match.body.summary).toMatch(/2 of the 4 skills/);
    expect(match.body.caveat).toMatch(/not a prediction/);

    const upd = await env.api(alice.token).patch(`/api/opportunities/${o.body.id}`, { status: 'ready' }).expect(200);
    expect(upd.body.status).toBe('ready');
    expect(upd.body.required_skills.length).toBe(4); // untouched by PATCH
    const act = await env.api(alice.token).get('/api/activity?page_size=50').expect(200);
    expect(act.body.items.some((a: { type: string }) => a.type === 'opportunity_status_changed')).toBe(true);

    await env.api(bob.token).get(`/api/opportunities/${o.body.id}`).expect(404);
    const recs = await env.api(alice.token).get('/api/analytics/recommendations').expect(200);
    const rec0 = recs.body.find((r: { opportunity_id: string }) => r.opportunity_id === o.body.id);
    expect(rec0.next_action).toBe('Draft outreach to Kiran Das');
    expect(rec0.reasons[0]).toBe('You list 2 of the 4 skills in the posting');
  });
});

describe('settings', () => {
  it('stores current time-zone names even when the browser reports an old alias', async () => {
    // Chrome in India reports "Asia/Calcutta"; databases without the tz "backward" links reject it.
    const s = await env.api(bob.token).patch('/api/settings', { timezone: 'Asia/Calcutta' }).expect(200);
    expect(s.body.timezone).toBe('Asia/Kolkata');
    // Date maths in SQL works with the stored zone.
    await env.api(bob.token).get('/api/analytics/timeseries?range=7d').expect(200);
    await env.api(bob.token).get('/api/me').expect(200);
    const bad = await env.api(bob.token).patch('/api/settings', { timezone: 'Mars/Olympus_Mons' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});
