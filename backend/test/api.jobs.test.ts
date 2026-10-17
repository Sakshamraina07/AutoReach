import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiProviderError } from '../src/services/ai/provider.js';
import { openingOf } from '../src/services/jobs.js';
import { createTestEnv, makePdf, PROFILE, type TestEnv } from './helpers/app.js';

/** A made-up posting; no real company or person. */
const JD = `Software Engineer Intern - Backend
Company: Northwind Labs
Location: Bengaluru, India (Hybrid)

About Northwind Labs
We build payment infrastructure used by 2 million small businesses.

What you'll do:
- Build and maintain REST APIs in Node.js and TypeScript that serve merchant dashboards
- Write tests and help keep our PostgreSQL queries fast
- Work with the platform team on deployments with Docker

Requirements:
- Final-year students or recent graduates (0-1 years of experience)
- Good knowledge of JavaScript or TypeScript and Node.js
- Comfortable with SQL (PostgreSQL)
- Git

Nice to have:
- Experience with AWS or Kubernetes
- Redis

Apply by 30 November 2026.`;

const AI_ANALYSIS = {
  company: 'Northwind Labs',
  title: 'Software Engineer Intern - Backend',
  location: 'Bengaluru, India (Hybrid)',
  employment_type: 'internship',
  seniority: 'intern',
  experience: { min_years: 0, text: '0-1 years of experience', fresher_friendly: true },
  must_have: ['JavaScript / TypeScript', 'Node.js', 'PostgreSQL', 'Git', 'GraphQL'],
  nice_to_have: ['AWS', 'Kubernetes', 'Redis'],
  responsibilities: ['Build and maintain REST APIs in Node.js and TypeScript that serve merchant dashboards'],
  priorities: [
    { point: 'Reliable APIs for merchants', evidence: 'Build and maintain REST APIs in Node.js and TypeScript that serve merchant dashboards' },
    { point: 'Fast database queries', evidence: 'help keep our PostgreSQL queries fast' },
  ],
  deadline: '2026-11-30',
};

const key = () => randomUUID();

let env: TestEnv;
let noAi: TestEnv;
let user: { id: string; token: string };
let stranger: { id: string; token: string };

beforeAll(async () => {
  env = await createTestEnv({ withAi: true });
  noAi = await createTestEnv({ withAi: false });
  user = await env.newUser('sam@student-mail.dev');
  stranger = await env.newUser('stranger@student-mail.dev');
  await env.api(user.token).put('/api/profile', PROFILE).expect(200);
  // The first résumé becomes the default, which every email attaches.
  await env.api(user.token).upload('/api/resumes').field('label', 'Backend Resume').attach('file', makePdf('Sam Kumar Node.js PostgreSQL'), 'Sam_Kumar.pdf').expect(201);
  await env.connectGmail(user.id);
});
afterAll(async () => {
  await env?.close();
  await noAi?.close();
});

async function analyzeAndSave(extra: Record<string, unknown> = {}) {
  env.ai.responses.push(JSON.stringify(AI_ANALYSIS));
  const a = (await env.api(user.token).post('/api/jobs/analyze', { text: JD }).expect(200)).body;
  return (await env.api(user.token).post('/api/jobs', { text: JD, analysis: a.analysis, ...extra }).expect(201)).body;
}

describe('reading a job description', () => {
  it('keeps only what the job description says and shows the honest fit', async () => {
    env.ai.responses.push(JSON.stringify(AI_ANALYSIS));
    const r = await env.api(user.token).post('/api/jobs/analyze', { text: JD }).expect(200);
    const { analysis, fit } = r.body;
    expect(analysis.source).toBe('ai');
    expect(analysis.model).toBe('fake-model-1');
    expect(analysis.must_have).toEqual(['JavaScript / TypeScript', 'Node.js', 'PostgreSQL', 'Git']); // GraphQL isn't in the JD
    expect(analysis.priorities).toHaveLength(2);
    expect(analysis.deadline).toBe('2026-11-30');
    // Sam lists TypeScript, Node.js and PostgreSQL but not Git.
    expect(fit.matched_must).toEqual(['JavaScript / TypeScript', 'Node.js', 'PostgreSQL']);
    expect(fit.missing_must).toEqual(['Git']);
    expect(fit.skills_in_common).toEqual(expect.arrayContaining(['TypeScript', 'Node.js', 'PostgreSQL']));
    expect(fit.projects.map((p: { name: string }) => p.name)).toEqual(['QueueLite', 'CampusBoard']);

    const call = env.ai.calls.at(-1)!;
    expect(call.json).toBe(true);
    expect(call.system).toMatch(/Use ONLY what the job description says/);
    expect(call.user).toContain('<job_description>');
    expect(call.user).toContain('payment infrastructure');
    // The candidate's profile is not sent when reading the job description.
    expect(call.user).not.toContain('Sam Kumar');
    expect(call.user).not.toContain('CampusBoard');
  });

  it('falls back to a plain reading when the AI fails or replies with nonsense', async () => {
    const original = env.ai.complete.bind(env.ai);
    env.ai.complete = async () => {
      throw new AiProviderError('AI provider error: quota', 429, true);
    };
    try {
      const r = await env.api(user.token).post('/api/jobs/analyze', { text: JD }).expect(200);
      expect(r.body.analysis.source).toBe('heuristic');
      expect(r.body.analysis.company).toBe('Northwind Labs');
      expect(r.body.analysis.notes.join(' ')).toMatch(/rate limiting/);
    } finally {
      env.ai.complete = original;
    }
    env.ai.responses.push('I cannot help with that.');
    const bad = await env.api(user.token).post('/api/jobs/analyze', { text: JD }).expect(200);
    expect(bad.body.analysis.source).toBe('heuristic');
    expect(bad.body.analysis.notes.join(' ')).toMatch(/could not be read/);
  });

  it('works without an AI provider', async () => {
    const u = await noAi.newUser('no-ai@student-mail.dev');
    const r = await noAi.api(u.token).post('/api/jobs/analyze', { text: JD }).expect(200);
    expect(r.body.analysis.source).toBe('heuristic');
    expect(r.body.analysis.must_have).toEqual(expect.arrayContaining(['Node.js', 'PostgreSQL']));
    expect(r.body.fit.verdict).toBe('long_shot'); // no profile yet: nothing matched
  });

  it('asks for the full text', async () => {
    const r = await env.api(user.token).post('/api/jobs/analyze', { text: 'Backend intern, Node.js' }).expect(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('saving the job and adding people', () => {
  it('saves the job once per posting URL and keeps the confirmed analysis', async () => {
    const url = 'https://jobs.example.org/northwind/backend-intern';
    const first = await analyzeAndSave({ url });
    expect(first.opportunity).toMatchObject({ company: 'Northwind Labs', title: 'Software Engineer Intern - Backend', status: 'ready', job_url: url });
    expect(first.opportunity.required_skills).toEqual(expect.arrayContaining(['JavaScript', 'TypeScript', 'Node.js', 'PostgreSQL', 'Git']));
    expect(first.analysis.priorities).toHaveLength(2);
    expect(first.recruiters).toEqual([]);

    // The candidate corrects the title; the same URL updates the same job.
    const again = await env
      .api(user.token)
      .post('/api/jobs', { text: JD, url, analysis: { ...first.analysis, title: 'Backend Engineering Intern' } })
      .expect(201);
    expect(again.body.opportunity.id).toBe(first.opportunity.id);
    expect(again.body.opportunity.title).toBe('Backend Engineering Intern');

    const missing = await env.api(user.token).post('/api/jobs', { text: JD, analysis: { ...first.analysis, company: '' } }).expect(400);
    expect(missing.body.error.details[0].message).toMatch(/company/);
    await env.api(stranger.token).get(`/api/jobs/${first.opportunity.id}`).expect(404);
  });

  it('adds pasted contacts under the job, links saved ones and reports what it skipped', async () => {
    const job = await analyzeAndSave();
    const saved = (await env.api(user.token).post('/api/recruiters', { email: 'omar@northwind.example', company: 'Northwind Labs' }).expect(201)).body;
    const r = await env
      .api(user.token)
      .post(`/api/jobs/${job.opportunity.id}/recruiters`, {
        text: 'Priya Nair <priya.nair@northwind.example>\nOmar Haddad, Engineering Manager, omar@northwind.example\nnot an email line',
      })
      .expect(200);
    expect(r.body).toMatchObject({ added: 1, already_saved: 1 });
    expect(r.body.skipped).toEqual(['not an email line']);
    expect(r.body.recruiters.map((x: { email: string }) => x.email).sort()).toEqual(['omar@northwind.example', 'priya.nair@northwind.example']);
    const byEmail = (e: string) => r.body.recruiters.find((x: { email: string }) => x.email === e);
    const priya = byEmail('priya.nair@northwind.example');
    expect(priya).toMatchObject({ full_name: 'Priya Nair', company: 'Northwind Labs', email_verification: 'provided' });
    // The saved contact gets the name and title it was missing.
    expect(byEmail('omar@northwind.example')).toMatchObject({ id: saved.id, full_name: 'Omar Haddad', title: 'Engineering Manager' });

    // Someone else's recruiter can't be attached.
    const theirs = (await env.api(stranger.token).post('/api/recruiters', { email: 'x@contoso.example', company: 'Contoso' }).expect(201)).body;
    await env.api(user.token).post(`/api/jobs/${job.opportunity.id}/recruiters`, { recruiter_ids: [theirs.id] }).expect(404);
  });

  it('suggests saved people at the same company who are not on the job yet', async () => {
    const job = await analyzeAndSave();
    const lena = (await env.api(user.token).post('/api/recruiters', { email: 'lena@northwind.example', company: 'Northwind Labs', full_name: 'Lena Park' }).expect(201)).body;
    await env.api(user.token).post('/api/recruiters', { email: 'pat@fabrikam.example', company: 'Fabrikam' }).expect(201);
    const s = (await env.api(user.token).get(`/api/jobs/${job.opportunity.id}/suggested-recruiters`).expect(200)).body.recruiters;
    expect(s.map((x: { id: string }) => x.id)).toContain(lena.id);
    expect(s.map((x: { email: string }) => x.email)).not.toContain('pat@fabrikam.example');
    await env.api(user.token).post(`/api/jobs/${job.opportunity.id}/recruiters`, { recruiter_ids: [lena.id] }).expect(200);
    const after = (await env.api(user.token).get(`/api/jobs/${job.opportunity.id}/suggested-recruiters`).expect(200)).body.recruiters;
    expect(after.map((x: { id: string }) => x.id)).not.toContain(lena.id);
  });
});

describe('the email for each person', () => {
  it('writes from the job analysis, reuses the draft, varies the opening per person and sends on approval', async () => {
    const job = await analyzeAndSave();
    const jobId = job.opportunity.id;
    const added = (
      await env
        .api(user.token)
        .post(`/api/jobs/${jobId}/recruiters`, { text: 'Asha Rao, University Recruiter, asha.rao@northwind-mail.example\nDev Mehta, Engineering Manager, dev.mehta@northwind-mail.example' })
        .expect(200)
    ).body.recruiters as { id: string; email: string }[];
    const [asha, dev] = [added.find((x) => x.email.startsWith('asha'))!, added.find((x) => x.email.startsWith('dev'))!];

    const ashaBody =
      "Hi Asha,\n\nI saw that the backend intern team at Northwind Labs builds the REST APIs behind merchant dashboards, and I built QueueLite, a Node.js job queue backed by PostgreSQL. I'm Sam Kumar, a B.Tech Computer Science student at Example Institute of Technology graduating in May 2027.\n\nI also built CampusBoard with React and TypeScript.\n\nWould you be open to considering me for the Software Engineer Intern - Backend role?\n\nThank you,\nSam Kumar\nhttps://github.com/example";
    env.ai.responses.push(JSON.stringify({ subject: 'Backend intern — QueueLite (Node.js + PostgreSQL)', body: ashaBody, facts_used: ['job:priorities', 'project:1'], notes: [] }));
    const first = (await env.api(user.token).post(`/api/jobs/${jobId}/recruiters/${asha.id}/email`, {}).expect(200)).body;
    expect(first.draft.source).toBe('ai');
    expect(first.message).toMatchObject({ send_status: 'draft', recruiter_id: asha.id, opportunity_id: jobId, ai_generated: true });
    expect(first.message.resume_id).not.toBeNull();
    expect(first.quality.filter((f: { severity: string }) => f.severity === 'error')).toEqual([]);
    expect(first.message.body_text).toBe(ashaBody);

    const prompt = env.ai.calls.at(-1)!.user;
    expect(prompt).toContain('[job:priorities]');
    expect(prompt).toContain('"Build and maintain REST APIs in Node.js and TypeScript that serve merchant dashboards"');
    expect(prompt).toMatch(/\[fit:skills\][^\n]*TypeScript/);
    expect(prompt).not.toMatch(/\[fit:skills\][^\n]*\bGit\b/); // Sam never listed Git
    expect(prompt).toMatch(/\[fit:projects\][^\n]*QueueLite/);
    expect(prompt).toMatch(/Never mention skills the candidate lacks/);
    expect(prompt).not.toMatch(/is not a recruiter/);

    // Opening the page again shows the same draft without writing a new one.
    const calls = env.ai.calls.length;
    const reuse = (await env.api(user.token).post(`/api/jobs/${jobId}/recruiters/${asha.id}/email`, {}).expect(200)).body;
    expect(reuse.message.id).toBe(first.message.id);
    expect(reuse.draft).toBeNull();
    expect(env.ai.calls.length).toBe(calls);

    // The engineering manager gets a short referral ask, opening differently from Asha's email.
    env.ai.responses.push(JSON.stringify({ subject: 'Northwind backend intern — a pointer?', body: 'Hi Dev,\n\nQuick question about the backend intern role at Northwind Labs.\n\nSam Kumar', facts_used: [], notes: [] }));
    const second = (await env.api(user.token).post(`/api/jobs/${jobId}/recruiters/${dev.id}/email`, {}).expect(200)).body;
    expect(second.message.id).not.toBe(first.message.id);
    const devPrompt = env.ai.calls.at(-1)!.user;
    expect(devPrompt).toMatch(/The recipient \(Engineering Manager\) is not a recruiter/);
    expect(devPrompt).toContain(`- ${openingOf(ashaBody)}`);

    // Regenerating rewrites the same draft and asks for a different opening than before.
    env.ai.responses.push(JSON.stringify({ subject: 'Backend intern application', body: ashaBody.replace('I saw that', 'Reading that'), facts_used: [], notes: [] }));
    const regen = (await env.api(user.token).post(`/api/jobs/${jobId}/recruiters/${asha.id}/email`, { regenerate: true }).expect(200)).body;
    expect(regen.message.id).toBe(first.message.id);
    expect(regen.message.subject).toBe('Backend intern application');
    expect(env.ai.calls.at(-1)!.user).toContain(`- ${openingOf(ashaBody)}`);

    // The job view lists each person's email.
    const view = (await env.api(user.token).get(`/api/jobs/${jobId}`).expect(200)).body;
    expect(view.emails[asha.id]).toMatchObject({ id: first.message.id, send_status: 'draft' });
    expect(view.emails[dev.id]).toMatchObject({ id: second.message.id, send_status: 'draft' });

    // Nothing is sent until the candidate approves it.
    expect(env.google.sent).toHaveLength(0);
    const sent = await env.api(user.token).post(`/api/messages/${first.message.id}/send`).set('Idempotency-Key', key()).send({});
    expect(sent.status).toBe(200);
    expect(sent.body.outcome).toBe('sent');
    expect(env.google.sent).toHaveLength(1);

    // After sending, the screen shows the sent email instead of writing another.
    const before = env.ai.calls.length;
    const after = (await env.api(user.token).post(`/api/jobs/${jobId}/recruiters/${asha.id}/email`, { regenerate: true }).expect(200)).body;
    expect(after.message.send_status).toBe('sent');
    expect(after.draft).toBeNull();
    expect(env.ai.calls.length).toBe(before);
  });

  it('two requests at once write one draft', async () => {
    const job = await analyzeAndSave();
    const rec = (await env.api(user.token).post(`/api/jobs/${job.opportunity.id}/recruiters`, { text: 'kim@northwind-twice.example' }).expect(200)).body.recruiters[0];
    const [a, b] = await Promise.all([
      env.api(user.token).post(`/api/jobs/${job.opportunity.id}/recruiters/${rec.id}/email`, {}),
      env.api(user.token).post(`/api/jobs/${job.opportunity.id}/recruiters/${rec.id}/email`, {}),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.message.id).toBe(b.body.message.id);
    const rows = await env.sql(`SELECT count(*)::int AS n FROM email_messages WHERE recruiter_id = $1`, [rec.id]);
    expect(rows[0]!.n).toBe(1);
  });

  it("can't write emails on someone else's job", async () => {
    const job = await analyzeAndSave();
    const rec = (await env.api(stranger.token).post('/api/recruiters', { email: 'y@contoso.example', company: 'Contoso' }).expect(201)).body;
    await env.api(stranger.token).post(`/api/jobs/${job.opportunity.id}/recruiters/${rec.id}/email`, {}).expect(404);
  });
});

describe('opening of an email', () => {
  it('skips the greeting and keeps two sentences', () => {
    expect(openingOf('Hi Asha,\n\nFirst one. Second one! Third.\n\nThanks')).toBe('First one. Second one!');
    expect(openingOf('Short body without punctuation')).toBe('Short body without punctuation');
  });
});
