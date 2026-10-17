import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hunterDomainSearchUrl } from '../src/services/hunter.js';
import { createTestEnv, PROFILE, type TestEnv } from './helpers/app.js';

const JD = `Software Engineer Intern - Backend
Company: Northwind Labs

What you'll do:
- Build and maintain REST APIs in Node.js and TypeScript that serve merchant dashboards
- Write tests and help keep our PostgreSQL queries fast`;

/* Hunter's documented Domain Search response shape, with made-up people. */
const HUNTER_RESPONSE = {
  data: {
    domain: 'northwind.example',
    emails: [
      {
        value: 'priya.nair@northwind.example',
        type: 'personal',
        confidence: 94,
        first_name: 'Priya',
        last_name: 'Nair',
        position: 'Campus Recruiter',
        seniority: 'senior',
        department: 'hr',
        linkedin: 'https://www.linkedin.com/in/priya-nair-example',
        verification: { status: 'valid', date: '2026-10-01' },
        sources: [{ uri: 'https://northwind.example/careers/team', still_on_page: true }],
      },
      { value: 'omar@northwind.example', type: 'personal', confidence: 71, first_name: 'Omar', last_name: 'Haddad', position: 'Talent Partner', department: 'hr', verification: { status: 'accept_all' }, sources: [] },
      { value: 'not an email', confidence: 99 },
    ],
  },
};

let env: TestEnv;
let noKey: TestEnv;
let user: { id: string; token: string };
let jobId: string;

beforeAll(async () => {
  env = await createTestEnv({ withAi: false, env: { HUNTER_API_KEY: 'test-hunter-key' } });
  noKey = await createTestEnv({ withAi: false });
  user = await env.newUser('sam@student-mail.dev');
  await env.api(user.token).put('/api/profile', PROFILE).expect(200);
  const a = (await env.api(user.token).post('/api/jobs/analyze', { text: JD }).expect(200)).body;
  jobId = (await env.api(user.token).post('/api/jobs', { text: JD, analysis: a.analysis }).expect(201)).body.opportunity.id;
  await env.api(user.token).post('/api/recruiters', { email: 'omar@northwind.example', company: 'Northwind Labs' }).expect(201);
  env.google.external.set(hunterDomainSearchUrl({ company: 'Northwind Labs', group: 'recruiters', limit: 10 }), { status: 200, body: HUNTER_RESPONSE });
  env.google.external.set(hunterDomainSearchUrl({ company: 'Northwind Labs', domain: 'northwind.example', group: 'engineering', limit: 10 }), {
    status: 200,
    body: { data: { domain: 'northwind.example', emails: [] } },
  });
});
afterAll(async () => {
  await env?.close();
  await noKey?.close();
});

describe('finding people with Hunter.io', () => {
  it('asks Hunter for personal addresses in the chosen department, with the key in a header', () => {
    const u = new URL(hunterDomainSearchUrl({ company: 'Northwind Labs', group: 'recruiters', limit: 10 }));
    expect(u.origin + u.pathname).toBe('https://api.hunter.io/v2/domain-search');
    expect(Object.fromEntries(u.searchParams)).toEqual({ company: 'Northwind Labs', type: 'personal', limit: '10', department: 'hr' });
    expect(new URL(hunterDomainSearchUrl({ company: 'X', domain: 'x.example', group: 'everyone', limit: 5 })).searchParams.get('department')).toBeNull();
  });

  it("lists who Hunter found, best first, marking people you've already saved; nothing is saved", async () => {
    const r = (await env.api(user.token).post(`/api/jobs/${jobId}/find-people`, { group: 'recruiters' }).expect(200)).body;
    expect(r.domain).toBe('northwind.example');
    expect(r.people.map((p: { email: string }) => p.email)).toEqual(['priya.nair@northwind.example', 'omar@northwind.example']); // the bad row is dropped
    expect(r.people[0]).toMatchObject({ first_name: 'Priya', position: 'Campus Recruiter', confidence: 94, hunter_status: 'valid', source_url: 'https://northwind.example/careers/team', recruiter_id: null });
    expect(r.people[1].recruiter_id).toEqual(expect.any(String));
    const sent = env.google.requests.filter((q) => q.url.startsWith('https://api.hunter.io/'));
    expect(sent).toHaveLength(1);
    const job = (await env.api(user.token).get(`/api/jobs/${jobId}`).expect(200)).body;
    expect(job.recruiters).toEqual([]);
    // A domain the user typed (with or without https://www.) is what Hunter is asked about.
    const byDomain = (await env.api(user.token).post(`/api/jobs/${jobId}/find-people`, { group: 'engineering', domain: 'https://www.northwind.example/about' }).expect(200)).body;
    expect(byDomain.people).toEqual([]);
  });

  it('adds the people you pick as unconfirmed addresses, so the first send asks you to check', async () => {
    const r = (
      await env
        .api(user.token)
        .post(`/api/jobs/${jobId}/people`, {
          people: [
            { email: 'priya.nair@northwind.example', first_name: 'Priya', last_name: 'Nair', position: 'Campus Recruiter', linkedin: 'https://www.linkedin.com/in/priya-nair-example', source_url: 'https://northwind.example/careers/team' },
            { email: 'omar@northwind.example', first_name: 'Omar', last_name: 'Haddad', position: 'Talent Partner' },
          ],
        })
        .expect(200)
    ).body;
    expect(r).toMatchObject({ added: 1, already_saved: 1 });
    const priya = r.recruiters.find((x: { email: string }) => x.email === 'priya.nair@northwind.example');
    expect(priya).toMatchObject({ full_name: 'Priya Nair', title: 'Campus Recruiter', company: 'Northwind Labs', email_verification: 'unverified_guess', source: 'other', tags: ['hunter'] });
    const omar = r.recruiters.find((x: { email: string }) => x.email === 'omar@northwind.example');
    expect(omar.email_verification).toBe('provided'); // saved earlier by you: unchanged
  });

  it('explains when Hunter is not set up or refuses', async () => {
    const u = await noKey.newUser('x@student-mail.dev');
    expect((await noKey.api(u.token).get('/api/me').expect(200)).body.hunter).toEqual({ configured: false });
    const a = (await noKey.api(u.token).post('/api/jobs/analyze', { text: JD }).expect(200)).body;
    const j = (await noKey.api(u.token).post('/api/jobs', { text: JD, analysis: a.analysis }).expect(201)).body.opportunity.id;
    expect((await noKey.api(u.token).post(`/api/jobs/${j}/find-people`, {}).expect(503)).body.error.code).toBe('HUNTER_NOT_CONFIGURED');

    env.google.external.set(hunterDomainSearchUrl({ company: 'Northwind Labs', group: 'everyone', limit: 10 }), { status: 401, body: { errors: [{ id: 'authentication_failed', details: 'No user found for the API key supplied' }] } });
    expect((await env.api(user.token).post(`/api/jobs/${jobId}/find-people`, { group: 'everyone' }).expect(502)).body.error.code).toBe('HUNTER_KEY_INVALID');
    expect((await env.api(user.token).post(`/api/jobs/${jobId}/find-people`, { domain: 'not a domain' }).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
  });
});
