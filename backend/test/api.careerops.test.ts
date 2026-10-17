import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { captureBelongsTo, careerOpsAllowed, jobDescriptionFromReport, parseReportHeader, trackerStatuses } from '../src/services/careerOps.js';
import { createTestEnv, PROFILE, type TestEnv } from './helpers/app.js';

/* A made-up career-ops folder: reports in its own format, one saved capture and a tracker. */

const JD = `Software Engineer Intern - Backend
Company: Northwind Labs
Location: Bengaluru, India (Hybrid)

What you'll do:
- Build and maintain REST APIs in Node.js and TypeScript that serve merchant dashboards
- Write tests and help keep our PostgreSQL queries fast

Requirements:
- Final-year students or recent graduates (0-1 years of experience)
- Good knowledge of JavaScript or TypeScript and Node.js
- Comfortable with SQL (PostgreSQL)`;

const report = (o: { company: string; role: string; score: string; url: string; body: string }) => `# Evaluation: ${o.company} — ${o.role}

**Date:** 2026-10-15
**URL:** ${o.url}
**Archetype:** Backend Engineer
**Score:** ${o.score}
**Legitimacy:** High Confidence
**PDF:** pending

---

## A) Role Summary

| Field | Value |
|-------|-------|
| **TL;DR** | Backend internship |

${o.body}

## Machine Summary
score: ${o.score}
`;

const GH_URL = 'https://boards.greenhouse.io/fabrikamtech/jobs/4012345';

let dir: string;
let env: TestEnv;
let other: TestEnv;
let user: { id: string; token: string; email: string };

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'career-ops-'));
  await fs.mkdir(path.join(dir, 'reports'));
  await fs.mkdir(path.join(dir, 'jds'));
  await fs.mkdir(path.join(dir, 'data'));
  // 001: the JD archived in the report, the normal case.
  await fs.writeFile(
    path.join(dir, 'reports', '001-northwind-labs-2026-10-15.md'),
    report({ company: 'Northwind Labs', role: 'Software Engineer Intern - Backend', score: '4.5/5', url: 'https://jobs.example.org/northwind/backend-intern', body: `## Job Description (archived verbatim)\n\n${JD}` }),
  );
  // 002: the report points at a jds/ capture.
  await fs.writeFile(
    path.join(dir, 'reports', '002-contoso-2026-10-15.md'),
    report({ company: 'Contoso', role: 'Platform Intern', score: '4.1/5', url: '(pasted)', body: '## Job Description\n\nSee jds/002-contoso-platform-intern.md for the full archive (archive-posting.mjs --report=2).' }),
  );
  await fs.writeFile(path.join(dir, 'jds', '002-contoso-platform-intern.md'), JD.replace(/Northwind Labs/g, 'Contoso').replace('Software Engineer Intern - Backend', 'Platform Intern'));
  // 003: only a paraphrase, so the description comes from the Greenhouse link.
  await fs.writeFile(
    path.join(dir, 'reports', '003-fabrikam-tech-2026-10-16.md'),
    report({ company: 'Fabrikam Tech', role: 'Backend Developer Intern', score: '3.8/5', url: GH_URL, body: '## Job Description (paraphrase, not verbatim)\n\nThe team wants a backend intern who knows Node.js and SQL and can write tests.' }),
  );
  // 004: no description and no usable link.
  await fs.writeFile(
    path.join(dir, 'reports', '004-tailspin-2026-10-16.md'),
    report({ company: 'Tailspin', role: 'SDE Intern', score: '2.5/5', url: 'https://careers.tailspin.example/jobs/9', body: '## Job Description\n\nSign in to view this job · Join LinkedIn to see who you know at Tailspin' }),
  );
  // 005: a capture with this number but another company's name must not be used.
  await fs.writeFile(
    path.join(dir, 'reports', '005-initech-2026-10-16.md'),
    report({ company: 'Initech', role: 'Backend Intern', score: '4.0/5', url: '(pasted)', body: '## Job Description\n\nSee jds/005-initech-backend.md for the full archive (archive-posting.mjs --report=5).' }),
  );
  await fs.writeFile(path.join(dir, 'jds', '5-2026-01-02_globex_platform.md'), JD.replace(/Northwind Labs/g, 'Globex'));
  // 006: written by career-ops' Gemini script, so its "verbatim" section is the model's retyping.
  await fs.writeFile(
    path.join(dir, 'reports', '006-umbrella-2026-10-17.md'),
    `\uFEFF${report({ company: 'Umbrella', role: 'Backend Intern', score: '4.3/5', url: '(pasted)', body: `## Job Description (archived verbatim)\n\n${JD.replace(/Northwind Labs/g, 'Umbrella')}` }).replace('**PDF:** pending', '**PDF:** pending\n**Tool:** Gemini (gemini-3.6-flash)')}`,
  );
  await fs.writeFile(path.join(dir, 'reports', 'notes.md'), 'not a report');
  await fs.writeFile(
    path.join(dir, 'data', 'applications.md'),
    `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-10-15 | Northwind Labs | Software Engineer Intern - Backend | 4.5/5 | Evaluated | ❌ | [001](reports/001-northwind-labs-2026-10-15.md) | |
| 2 | 2026-10-16 | Tailspin | SDE Intern | 2.5/5 | SKIP | ❌ | [004](reports/004-tailspin-2026-10-16.md) | |
`,
  );

  env = await createTestEnv({ withAi: false, env: { CAREER_OPS_DIR: dir } });
  other = await createTestEnv({ withAi: false, env: { CAREER_OPS_DIR: dir, CAREER_OPS_OWNER_EMAIL: 'owner@student-mail.dev' } });
  user = await env.newUser('sam@student-mail.dev');
  await env.api(user.token).put('/api/profile', PROFILE).expect(200);
  env.google.external.set(`https://boards-api.greenhouse.io/v1/boards/fabrikamtech/jobs/4012345`, {
    status: 200,
    body: { title: 'Backend Developer Intern', location: { name: 'Pune' }, content: JD.replace(/Northwind Labs/g, 'Fabrikam Tech').replace(/\n/g, '&lt;br&gt;') },
  });
});
afterAll(async () => {
  await env?.close();
  await other?.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

describe('reading career-ops files', () => {
  it('reads the report header career-ops writes', () => {
    expect(parseReportHeader('# Evaluation: Acme AI -- Senior AI Engineer\n\n**Score:** 4.2/5\n**URL:** https://jobs.example.com/acme\n**Date:** 2026-04-01')).toMatchObject({
      company: 'Acme AI',
      role: 'Senior AI Engineer',
      score: 4.2,
      url: 'https://jobs.example.com/acme',
      date: '2026-04-01',
    });
    expect(parseReportHeader('# Evaluation: X — Y\n**Score:** 4 <!-- bot -->\n**URL:** (pasted)')).toMatchObject({ score: 4, url: null });
  });

  it('takes only a verbatim description, never a placeholder, pointer, sign-in wall or paraphrase', () => {
    expect(jobDescriptionFromReport(`## Job Description (archived verbatim)\n\n${JD}\n\n## Machine Summary\nx`)).toContain('REST APIs in Node.js');
    expect(jobDescriptionFromReport(`## Job Description (archived verbatim)\n\n${JD}\n\n## Machine Summary\nx`)).not.toContain('Machine Summary');
    expect(jobDescriptionFromReport("## Job Description\n\n(the posting's full text, pasted verbatim — see requirement below)")).toBeNull();
    expect(jobDescriptionFromReport('## Job Description\n\nSee jds/002-x.md for the full archive (archive-posting.mjs --report=2).')).toBeNull();
    expect(jobDescriptionFromReport('## Job Description\n\nSign in to view this job · Join LinkedIn to see who you know at Acme')).toBeNull();
    expect(jobDescriptionFromReport('## Job Description (paraphrase, not verbatim)\n\nThe team wants someone who knows Node.js and SQL and writes tests.')).toBeNull();
    expect(jobDescriptionFromReport('## Job Description\n\nThe following is a paraphrase of the posting: they want Node.js and SQL experience and tests.')).toBeNull();
  });

  it("reads statuses from the tracker by report link, not by the tracker's own numbering", () => {
    const s = trackerStatuses(
      '| Stage | Status |\n|---|---|\n| x | Done |\n\n| # | Company | Status | Report |\n|---|---|---|---|\n| 7 | A | Applied | [012](reports/012-a-2026-01-01.md), [019](reports/019-a-2026-02-01.md) |',
    );
    expect(s.get(12)).toBe('Applied');
    expect(s.get(19)).toBe('Applied');
    expect(s.get(7)).toBeUndefined();
  });

  it('reads headers in other languages, with a byte-order mark, and companies with hyphens', () => {
    expect(parseReportHeader('\uFEFF# Evaluación: Foo - Bar Labs — Ingeniero Backend\n\n**Fecha:** 2026-10-01\n**Puntuación:** 4,1/5\n**URL:** https://jobs.lever.co/foo/1')).toMatchObject({
      company: 'Foo - Bar Labs',
      role: 'Ingeniero Backend',
      date: '2026-10-01',
      score: 4.1,
      url: 'https://jobs.lever.co/foo/1',
    });
    expect(parseReportHeader('# Évaluation : Acme -- Dev\n**Score :** 3.9/5')).toMatchObject({ company: 'Acme', role: 'Dev', score: 3.9 });
  });

  it("matches a jds/ capture by number and company, as career-ops does", () => {
    expect(captureBelongsTo('002-2026-10-15_contoso_platform-intern.pdf', 2, 'contoso')).toBe(true);
    expect(captureBelongsTo('2-contoso-platform.md', 2, 'contoso')).toBe(true);
    expect(captureBelongsTo('2-2026-01-02_globex_platform.md', 2, 'contoso')).toBe(false);
    expect(captureBelongsTo('20-contoso-x.md', 2, 'contoso')).toBe(false);
    expect(captureBelongsTo('2-contosoplus-x.md', 2, 'contoso')).toBe(false);
  });

  it('never takes a stub, or a disclosed summary, as the description', () => {
    expect(jobDescriptionFromReport('## Job Description\n\nBackend intern, Node.js and SQL, Bengaluru, apply now please.')).toBeNull(); // under 80 characters
    expect(jobDescriptionFromReport(`## Job Description\n\nThis is a summary of the posting, not a verbatim copy. ${JD}`)).toBeNull();
    expect(jobDescriptionFromReport(`## Job Description\n\nThe fetch tool could not reproduce the posting verbatim. Key points: ${JD}`)).toBeNull();
    expect(jobDescriptionFromReport(`## Job Description (summary)\n\n${JD}`)).toBeNull();
  });

  it('serves the folder only to requests from this computer outside production', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://u@localhost/db', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'a', CAREER_OPS_DIR: '/tmp/co' });
    expect(careerOpsAllowed(c, { email: 'a@b.dev', remoteAddress: '127.0.0.1' })).toBe(true);
    expect(careerOpsAllowed(c, { email: 'a@b.dev', remoteAddress: '::ffff:127.0.0.1' })).toBe(true);
    expect(careerOpsAllowed(c, { email: 'a@b.dev', remoteAddress: '::1' })).toBe(true);
    expect(careerOpsAllowed(c, { email: 'a@b.dev', remoteAddress: '192.168.1.23' })).toBe(false);
    expect(careerOpsAllowed(c, { email: 'a@b.dev', remoteAddress: undefined })).toBe(false);
  });
});

describe('career-ops in AutoReach', () => {
  it('lists the evaluations with where each description would come from', async () => {
    const me = (await env.api(user.token).get('/api/me').expect(200)).body;
    expect(me.career_ops).toEqual({ configured: true });
    const r = (await env.api(user.token).get('/api/career-ops').expect(200)).body;
    expect(r.cv_exists).toBe(false);
    expect(r.unreadable).toEqual([]);
    expect(r.jobs.map((j: { report_number: number }) => j.report_number)).toEqual([6, 5, 4, 3, 2, 1]);
    const by = (n: number) => r.jobs.find((j: { report_number: number }) => j.report_number === n);
    expect(by(1)).toMatchObject({ company: 'Northwind Labs', role: 'Software Engineer Intern - Backend', score: 4.5, status: 'Evaluated', description: 'report', opportunity_id: null });
    expect(by(2)).toMatchObject({ company: 'Contoso', url: null, description: 'saved' });
    expect(by(3)).toMatchObject({ score: 3.8, description: 'link', url: GH_URL });
    expect(by(4)).toMatchObject({ status: 'SKIP', description: 'none' });
    expect(by(5)).toMatchObject({ company: 'Initech', description: 'none' }); // the jds/5-… file is Globex's
    expect(by(6)).toMatchObject({ company: 'Umbrella', score: 4.3, description: 'none' }); // BOM read; script-written section not trusted
  });

  it('imports a job from its archived description, once', async () => {
    const view = (await env.api(user.token).post('/api/career-ops/reports/1/import').expect(201)).body;
    expect(view.opportunity).toMatchObject({ company: 'Northwind Labs', title: 'Software Engineer Intern - Backend', career_ops_report: 1, career_ops_score: 4.5, job_url: 'https://jobs.example.org/northwind/backend-intern' });
    expect(view.analysis.must_have).toEqual(expect.arrayContaining(['Node.js', 'PostgreSQL']));
    const again = (await env.api(user.token).post('/api/career-ops/reports/1/import').expect(201)).body;
    expect(again.opportunity.id).toBe(view.opportunity.id);
    const list = (await env.api(user.token).get('/api/career-ops').expect(200)).body;
    expect(list.jobs.find((j: { report_number: number }) => j.report_number === 1).opportunity_id).toBe(view.opportunity.id);
  });

  it('imports from a saved capture and from the posting link', async () => {
    const saved = (await env.api(user.token).post('/api/career-ops/reports/2/import').expect(201)).body;
    expect(saved.opportunity).toMatchObject({ company: 'Contoso', title: 'Platform Intern', job_url: null, career_ops_report: 2 });
    expect(saved.opportunity.description).toContain('Contoso');
    const linked = (await env.api(user.token).post('/api/career-ops/reports/3/import').expect(201)).body;
    expect(linked.opportunity).toMatchObject({ company: 'Fabrikam Tech', title: 'Backend Developer Intern', job_url: GH_URL });
    expect(linked.opportunity.description).toContain('Fabrikam Tech');
    expect(linked.opportunity.description).not.toContain('The team wants'); // the paraphrase was not used
  });

  it("says so when there's no description to read", async () => {
    const r = await env.api(user.token).post('/api/career-ops/reports/4/import').expect(422);
    expect(r.body.error.code).toBe('CAREER_OPS_NO_DESCRIPTION');
    expect(r.body.error.details).toEqual({ url: 'https://careers.tailspin.example/jobs/9' });
    await env.api(user.token).post('/api/career-ops/reports/99/import').expect(404);
    expect((await env.api(user.token).post('/api/career-ops/reports/5/import').expect(422)).body.error.code).toBe('CAREER_OPS_NO_DESCRIPTION');
    expect((await env.api(user.token).post('/api/career-ops/reports/6/import').expect(422)).body.error.code).toBe('CAREER_OPS_NO_DESCRIPTION');
  });

  it('builds cv.md from the profile and writes it only if career-ops has none', async () => {
    const md = (await env.api(user.token).get('/api/career-ops/cv.md').expect(200)).text;
    expect(md).toMatch(/^# Sam Kumar\n/);
    expect(md).toContain('## Projects');
    expect(md).toContain('### CampusBoard');
    expect(md).toContain('- Used by 120 students in the first month');
    await env.api(user.token).post('/api/career-ops/cv.md').expect(201);
    expect(await fs.readFile(path.join(dir, 'cv.md'), 'utf8')).toBe(md);
    const again = await env.api(user.token).post('/api/career-ops/cv.md').expect(409);
    expect(again.body.error.code).toBe('CAREER_OPS_CV_EXISTS');
    expect((await env.api(user.token).get('/api/career-ops').expect(200)).body.cv_exists).toBe(true);
  });

  it('is only for the folder owner when an owner is set', async () => {
    const stranger = await other.newUser('someone@student-mail.dev');
    expect((await other.api(stranger.token).get('/api/me').expect(200)).body.career_ops).toEqual({ configured: false });
    const r = await other.api(stranger.token).get('/api/career-ops').expect(403);
    expect(r.body.error.code).toBe('CAREER_OPS_NOT_YOURS');
    const owner = await other.newUser('owner@student-mail.dev');
    await other.api(owner.token).get('/api/career-ops').expect(200);
  });

  it('reads a job link from Greenhouse, Lever or Ashby, and refuses other sites', async () => {
    const ok = (await env.api(user.token).post('/api/jobs/fetch', { url: GH_URL }).expect(200)).body;
    expect(ok).toMatchObject({ board: 'greenhouse', title: 'Backend Developer Intern', location: 'Pune' });
    const no = await env.api(user.token).post('/api/jobs/fetch', { url: 'https://www.linkedin.com/jobs/view/1' }).expect(422);
    expect(no.body.error.code).toBe('JOB_LINK_UNSUPPORTED');
  });
});

describe('without a career-ops folder', () => {
  it("doesn't offer it", async () => {
    const plain = await createTestEnv({ withAi: false });
    try {
      const u = await plain.newUser('x@student-mail.dev');
      expect((await plain.api(u.token).get('/api/me').expect(200)).body.career_ops).toEqual({ configured: false });
      expect((await plain.api(u.token).get('/api/career-ops').expect(404)).body.error.code).toBe('CAREER_OPS_NOT_CONFIGURED');
    } finally {
      await plain.close();
    }
  });
});
