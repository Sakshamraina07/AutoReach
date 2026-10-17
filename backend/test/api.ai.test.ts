import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, makePdf, PROFILE, type TestEnv } from './helpers/app.js';

let env: TestEnv;
let noAi: TestEnv;
let user: { id: string; token: string };
let stranger: { id: string; token: string };
let recruiterId: string;
let opportunityId: string;

beforeAll(async () => {
  env = await createTestEnv({ withAi: true });
  noAi = await createTestEnv({ withAi: false });
  user = await env.newUser('sam@student-mail.dev');
  stranger = await env.newUser('stranger@student-mail.dev');
  await env.api(user.token).put('/api/profile', PROFILE).expect(200);
  await env.api(stranger.token).put('/api/profile', { ...PROFILE, full_name: 'Stranger Danger', skills: ['Kubernetes', 'Rust'] }).expect(200);
  await env.api(stranger.token).post('/api/recruiters', { email: 'secret@contoso-private.dev', company: 'Contoso Private' }).expect(201);
  await env.api(user.token).upload('/api/resumes').field('label', 'Frontend Resume').attach('file', makePdf('Sam Kumar React TypeScript'), 'Sam.pdf').expect(201);
  recruiterId = (await env.api(user.token).post('/api/recruiters', { full_name: 'Meera Iyer', email: 'meera@northwind-labs.dev', company: 'Northwind Labs', title: 'University Recruiter' }).expect(201)).body.id;
  await env.api(user.token).post('/api/recruiters', { full_name: 'Other Person', email: 'p@fabrikam-hr.dev', company: 'Fabrikam' }).expect(201);
  opportunityId = (
    await env
      .api(user.token)
      .post('/api/opportunities', { company: 'Northwind Labs', title: 'Frontend Developer Intern', description: 'Build accessible UI in React and TypeScript. GraphQL is a plus.', company_notes: 'Northwind builds scheduling software for clinics.' })
      .expect(201)
  ).body.id;
});
afterAll(async () => {
  await env?.close();
  await noAi?.close();
});

describe('AI drafting', () => {
  it('sends only verified facts for the right role, company and recruiter to the provider', async () => {
    env.ai.responses.push(
      JSON.stringify({
        subject: 'Frontend Developer Intern — Sam Kumar',
        body: "Hi Meera,\n\nI'm Sam Kumar, a B.Tech CS student graduating in May 2027, writing about the Frontend Developer Intern role at Northwind Labs. I built CampusBoard, a React and TypeScript dashboard used by 120 students in the first month. My résumé is attached.\n\nWould you be open to considering me for the role?\n\nThanks,\nSam Kumar\nhttps://github.com/example",
        facts_used: ['project:1', 'job', 'made-up-id'],
        notes: [],
      }),
    );
    const r = await env.api(user.token).post('/api/ai/draft', { recruiter_id: recruiterId, opportunity_id: opportunityId, tone: 'friendly' }).expect(200);
    expect(r.body.source).toBe('ai');
    expect(r.body.provider).toBe('fake');
    expect(r.body.facts_used).toEqual(['project:1', 'job']); // unknown ids dropped
    expect(r.body.quality.filter((f: { severity: string }) => f.severity === 'error')).toEqual([]);

    const call = env.ai.calls.at(-1)!;
    expect(call.json).toBe(true);
    expect(call.system).toMatch(/Use ONLY the facts provided/);
    expect(call.user).toContain('Role: Frontend Developer Intern at Northwind Labs');
    expect(call.user).toContain('Recipient: Meera Iyer, University Recruiter at Northwind Labs');
    expect(call.user).toContain('Project "CampusBoard"');
    expect(call.user).toContain('Used by 120 students in the first month');
    expect(call.user).toContain('Northwind builds scheduling software for clinics.');
    expect(call.user).toContain('Tone: Warm & friendly');
    expect(call.user).toMatch(/Résumé attached: yes/);
    // Nothing from another user's account leaks into the prompt.
    expect(call.user).not.toContain('Stranger');
    expect(call.user).not.toContain('Contoso Private');
    expect(call.user).not.toContain('Kubernetes');
  });

  it('flags fabricated claims and the wrong company in AI output instead of hiding them', async () => {
    env.ai.responses.push(
      JSON.stringify({
        subject: 'Intern application',
        body: 'Hi Meera,\n\nI have 3 years of Kubernetes experience and improved performance by 75% at Fabrikam. I would love to join Fabrikam.\n\nSam Kumar',
        facts_used: [],
        notes: [],
      }),
    );
    const r = await env.api(user.token).post('/api/ai/draft', { recruiter_id: recruiterId, opportunity_id: opportunityId }).expect(200);
    const codes = r.body.quality.map((f: { code: string }) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['UNSUPPORTED_NUMBER', 'UNSUPPORTED_SKILL', 'WRONG_COMPANY', 'COMPANY_NOT_MENTIONED']));
  });

  it('refines with a specific instruction and keeps the follow-up subject threaded', async () => {
    env.ai.responses.push(JSON.stringify({ subject: 'Shorter', body: 'Hi Meera,\n\nShort version about the Frontend Developer Intern role at Northwind Labs.\n\nSam Kumar', facts_used: [], notes: [] }));
    const r = await env
      .api(user.token)
      .post('/api/ai/refine', { recruiter_id: recruiterId, opportunity_id: opportunityId, action: 'concise', subject: 'Long', body_text: 'Hi Meera, a very long draft...' })
      .expect(200);
    expect(r.body.body_text).toContain('Short version');
    expect(env.ai.calls.at(-1)!.user).toMatch(/noticeably shorter/);
    expect(env.ai.calls.at(-1)!.user).toContain('<current_draft>');
  });

  it('retries once on unreadable output, then reports a clear error', async () => {
    env.ai.responses.push('not json', 'still not json');
    const r = await env.api(user.token).post('/api/ai/draft', { recruiter_id: recruiterId }).expect(502);
    expect(r.body.error.code).toBe('AI_BAD_RESPONSE');
    env.ai.responses.push('```json\n{"subject":"Ok","body":"Hi Meera,\\n\\nBody about Northwind Labs.\\n\\nSam"}\n```');
    const ok = await env.api(user.token).post('/api/ai/draft', { recruiter_id: recruiterId }).expect(200);
    expect(ok.body.subject).toBe('Ok');
  });

  it('can be bypassed to use the template composer', async () => {
    const before = env.ai.calls.length;
    const r = await env.api(user.token).post('/api/ai/draft', { recruiter_id: recruiterId, opportunity_id: opportunityId, use_template: true }).expect(200);
    expect(r.body.source).toBe('template');
    expect(env.ai.calls.length).toBe(before);
  });

  it('refuses to draft for another user’s recruiter', async () => {
    const r = await env.api(stranger.token).post('/api/ai/draft', { recruiter_id: recruiterId });
    expect(r.status).toBe(404);
  });
});

describe('without an AI provider', () => {
  it('builds a role-aware template draft from verified profile facts', async () => {
    const u = await noAi.newUser('sam2@student-mail.dev');
    await noAi.api(u.token).put('/api/profile', PROFILE).expect(200);
    const rec = (await noAi.api(u.token).post('/api/recruiters', { full_name: 'Meera Iyer', email: 'meera@northwind-labs.dev', company: 'Northwind Labs' }).expect(201)).body;
    const backend = (await noAi.api(u.token).post('/api/opportunities', { company: 'Northwind Labs', title: 'Backend Software Engineer Intern', description: 'Node.js and PostgreSQL services.' }).expect(201)).body;
    const frontend = (await noAi.api(u.token).post('/api/opportunities', { company: 'Northwind Labs', title: 'Frontend Developer Intern', description: 'React and TypeScript UI.' }).expect(201)).body;
    const b = (await noAi.api(u.token).post('/api/ai/draft', { recruiter_id: rec.id, opportunity_id: backend.id }).expect(200)).body;
    const f = (await noAi.api(u.token).post('/api/ai/draft', { recruiter_id: rec.id, opportunity_id: frontend.id }).expect(200)).body;
    expect(b.source).toBe('template');
    expect(b.notes[0]).toMatch(/AI_PROVIDER is not set/);
    expect(b.subject).toBe('Backend Software Engineer Intern at Northwind Labs — Sam Kumar');
    // The most relevant project is chosen per role.
    expect(b.body_text).toContain('QueueLite');
    expect(f.body_text).toContain('CampusBoard');
    expect(f.body_text).toContain('Hi Meera,');
    expect(f.body_text).not.toMatch(/\{[a-z_]+\}/);
    // Speculative outreach with no role.
    const s = (await noAi.api(u.token).post('/api/ai/draft', { recruiter_id: rec.id }).expect(200)).body;
    expect(s.body_text).toMatch(/whether Northwind Labs has any software engineering internship or entry-level openings/);
    const refine = await noAi.api(u.token).post('/api/ai/refine', { recruiter_id: rec.id, action: 'concise', subject: 'x', body_text: 'y' });
    expect(refine.status).toBe(503);
    expect(refine.body.error.code).toBe('AI_NOT_CONFIGURED');
  });
});
