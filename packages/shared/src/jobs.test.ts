import { describe, expect, it } from 'vitest';
import { computeJobFit, heuristicJobAnalysis, parseContactsPaste, sanitizeJobAnalysis, type JobAnalysis } from './index.js';

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

describe('job description analysis without AI', () => {
  it('pulls out the role, company, location, skills and experience', () => {
    const a = heuristicJobAnalysis(JD);
    expect(a.title).toBe('Software Engineer Intern - Backend');
    expect(a.company).toBe('Northwind Labs');
    expect(a.location).toBe('Bengaluru, India (Hybrid)');
    expect(a.employment_type).toBe('internship');
    expect(a.seniority).toBe('intern');
    expect(a.experience).toMatchObject({ min_years: 0, fresher_friendly: true });
    expect(a.must_have).toEqual(expect.arrayContaining(['JavaScript / TypeScript', 'Node.js', 'PostgreSQL', 'Git']));
    expect(a.nice_to_have).toEqual(expect.arrayContaining(['AWS', 'Kubernetes', 'Redis']));
    expect(a.must_have).not.toContain('Redis');
    expect(a.responsibilities[0]).toMatch(/REST APIs in Node\.js/);
    expect(a.deadline).toBe('2026-11-30');
    expect(a.source).toBe('heuristic');
  });
});

describe('checking an AI analysis against the job description', () => {
  const base = heuristicJobAnalysis(JD);

  it('keeps what the JD supports and drops what it does not', () => {
    const raw = {
      company: 'Northwind Labs Pvt Ltd',
      title: 'Software Engineer Intern - Backend',
      location: 'Bengaluru',
      employment_type: 'internship',
      seniority: 'intern',
      experience: { min_years: 3, text: '0-1 years of experience', fresher_friendly: true },
      must_have: ['Node.js', 'typescript', 'PostgreSQL', 'GraphQL'],
      nice_to_have: ['AWS', 'Redis', 'Go'],
      responsibilities: ['Build REST APIs in Node.js and TypeScript for merchant dashboards', 'Lead a team of five engineers in Berlin'],
      priorities: [
        { point: 'APIs that merchants rely on', evidence: 'Build and maintain REST APIs in Node.js and TypeScript that serve merchant dashboards' },
        { point: 'Fast queries', evidence: '“help keep our PostgreSQL queries fast”' },
        { point: 'Scale', evidence: 'serves 10 million requests a day' },
      ],
      deadline: '2026-11-30',
    };
    const a = sanitizeJobAnalysis(raw, JD, base, 'gemini-test');
    expect(a.source).toBe('ai');
    expect(a.company).toBe('Northwind Labs'); // "Pvt Ltd" isn't how the JD names it, so the JD's own name is kept
    expect(a.must_have).toEqual(['Node.js', 'TypeScript', 'PostgreSQL']); // GraphQL isn't in the JD
    expect(a.nice_to_have).toEqual(['AWS', 'Redis']); // Go isn't either
    expect(a.experience.min_years).toBe(0); // "3 years" isn't written in the JD
    expect(a.responsibilities).toHaveLength(1);
    expect(a.priorities.map((p) => p.point)).toEqual(['APIs that merchants rely on', 'Fast queries']);
    expect(a.notes.join(' ')).toMatch(/didn't match the job description/);
  });

  it('falls back to the plain analysis when the AI returns nothing usable', () => {
    expect(sanitizeJobAnalysis(null, JD, base, 'x')).toBe(base);
  });
});

describe("the candidate's fit", () => {
  const a: JobAnalysis = heuristicJobAnalysis(JD);
  const now = new Date('2026-10-17T00:00:00Z');

  it('counts matches and names the projects that show them', () => {
    const fit = computeJobFit(
      {
        skills: ['TypeScript', 'React', 'postgres', 'Git'],
        projects: [
          { name: 'Ledger API', description: 'Expense tracking REST API', technologies: ['Node.js', 'PostgreSQL', 'Docker'] },
          { name: 'Portfolio site', technologies: ['React'] },
        ],
        experience: [],
      },
      a,
      now,
    );
    expect(fit.missing_must).toEqual([]);
    expect(fit.verdict).toBe('strong');
    expect(fit.projects[0]).toEqual({ name: 'Ledger API', matched: expect.arrayContaining(['Node.js', 'PostgreSQL']) });
    // A React project shows JavaScript, which this job accepts ("JavaScript or TypeScript").
    expect(fit.projects[1]).toEqual({ name: 'Portfolio site', matched: ['JavaScript'] });
    expect(fit.summary).toMatch(/You have \d+ of \d+ must-have skills/);
    expect(fit.skills_in_common).toEqual(expect.arrayContaining(['JavaScript', 'TypeScript', 'Node.js', 'PostgreSQL', 'Git']));
    expect(fit.skills_in_common).not.toEqual(expect.arrayContaining(['AWS']));
    expect(fit.skills_in_common).not.toEqual(expect.arrayContaining(['Redis']));
  });

  it('names only the alternative the candidate actually has', () => {
    const jvm = { ...a, must_have: ['Java / Kotlin'], nice_to_have: [] };
    const fit = computeJobFit({ skills: ['Kotlin'], projects: [], experience: [] }, jvm, now);
    expect(fit.matched_must).toEqual(['Java / Kotlin']);
    expect(fit.skills_in_common).toEqual(['Kotlin']);
  });

  it('is honest about experience gaps and senior roles', () => {
    const senior = { ...a, seniority: 'senior' as const, experience: { min_years: 5, text: '5+ years', fresher_friendly: false } };
    const fit = computeJobFit({ skills: ['TypeScript'], projects: [], experience: [] }, senior, now);
    expect(fit.verdict).toBe('long_shot');
    expect(fit.warnings.join(' ')).toMatch(/senior role/);
    expect(fit.warnings.join(' ')).toMatch(/Asks for 5\+ years of experience; your profile lists none yet/);
  });
});

describe('pasted recruiter contacts', () => {
  it('reads the common formats people paste', () => {
    const { contacts, skipped } = parseContactsPaste(`Priya Nair <priya.nair@northwind.example>
Omar Haddad, Engineering Manager, omar@northwind.example
Lena Fischer - lena@northwind.example
careers@northwind.example
a@x.example, b@x.example
see LinkedIn for more
priya.nair@northwind.example`);
    expect(contacts).toEqual([
      { email: 'priya.nair@northwind.example', full_name: 'Priya Nair', title: null },
      { email: 'omar@northwind.example', full_name: 'Omar Haddad', title: 'Engineering Manager' },
      { email: 'lena@northwind.example', full_name: 'Lena Fischer', title: null },
      { email: 'careers@northwind.example', full_name: null, title: null },
      { email: 'a@x.example', full_name: null, title: null },
      { email: 'b@x.example', full_name: null, title: null },
    ]);
    expect(skipped).toEqual(['see LinkedIn for more']);
  });

  it('reads a CSV with an email column, including quoted commas', () => {
    const { contacts, skipped } = parseContactsPaste(`Name,Email,Title
"Iyer, Meera",meera@contoso.example,Talent Partner
Raj,not-an-email,Recruiter`);
    expect(contacts).toEqual([{ email: 'meera@contoso.example', full_name: 'Iyer, Meera', title: 'Talent Partner' }]);
    expect(skipped).toHaveLength(1);
  });
});
