import { describe, expect, it } from 'vitest';
import { computeJobFit, heuristicJobAnalysis, jobSaveSchema, parseContactsPaste, sanitizeJobAnalysis, type JobAnalysis } from './index.js';

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

  it('never turns a pasted string into a different address', () => {
    const { contacts, skipped } = parseContactsPaste(`Ödön Kovács <ödön@firma.example>
joe!bob@contoso.example
a&b@contoso.example
Talent Acquisition - jobs@contoso.example`);
    // Whatever is used is exactly what was pasted; nothing is cut down to a valid-looking tail.
    for (const c of contacts) expect(['ödön@firma.example', 'joe!bob@contoso.example', 'a&b@contoso.example', 'jobs@contoso.example']).toContain(c.email);
    expect(contacts.map((c) => c.email)).not.toContain('n@firma.example');
    expect(contacts.map((c) => c.email)).not.toContain('bob@contoso.example');
    expect(contacts.map((c) => c.email)).not.toContain('b@contoso.example');
    expect(contacts.length + skipped.length).toBe(4);
    // A team label is not a person's name.
    expect(contacts.find((c) => c.email === 'jobs@contoso.example')).toEqual({ email: 'jobs@contoso.example', full_name: null, title: 'Talent Acquisition' });
  });
});

describe('what the AI may not add', () => {
  const base = heuristicJobAnalysis(JD);
  const ai = (over: Record<string, unknown>) =>
    sanitizeJobAnalysis(
      { company: 'Northwind Labs', title: 'Software Engineer Intern - Backend', employment_type: 'internship', seniority: 'intern', experience: { min_years: 0, text: null, fresher_friendly: true }, must_have: ['Node.js'], nice_to_have: [], responsibilities: [], priorities: [], deadline: null, ...over },
      JD,
      base,
      'm',
    );

  it('drops invented priorities: one-word quotes and points with facts the JD never states', () => {
    const a = ai({
      priorities: [
        { point: 'Recently raised a $50M Series B; wants Kubernetes experts with 5 years', evidence: 'Build and maintain REST APIs in Node.js and TypeScript that serve merchant dashboards' },
        { point: 'Fast queries', evidence: 'queries' },
        { point: 'Fast PostgreSQL queries', evidence: 'help keep our PostgreSQL queries fast' },
      ],
    });
    expect(a.priorities.map((p) => p.point)).toEqual(['Fast PostgreSQL queries']);
  });

  it('only keeps a company or role the JD names, as whole words', () => {
    const jd = 'Backend developer\nWe store metadata for millions of merchants using Node.js and PostgreSQL. Apply with your CV and a short note about a project.';
    const b = heuristicJobAnalysis(jd);
    const a = sanitizeJobAnalysis({ company: 'Meta', title: 'Backend developer', must_have: ['Node.js'] }, jd, b, 'm');
    expect(a.company).toBeNull(); // "Meta" only appears inside "metadata": the page will ask
    const c = sanitizeJobAnalysis({ company: 'Initech', title: 'Backend developer', must_have: ['Node.js'] }, jd, b, 'm');
    expect(c.company).toBeNull();
  });

  it('keeps a deadline only when the JD writes it, and never an impossible date', () => {
    expect(ai({ deadline: '2026-11-30' }).deadline).toBe('2026-11-30');
    const jd = JD.replace('Apply by 30 November 2026.', 'Applications reviewed on a rolling basis.');
    const b = heuristicJobAnalysis(jd);
    expect(sanitizeJobAnalysis({ title: 'Software Engineer Intern - Backend', deadline: '2026-11-01' }, jd, b, 'm').deadline).toBeNull();
    expect(sanitizeJobAnalysis({ title: 'Software Engineer Intern - Backend', deadline: '2026-02-31' }, jd, b, 'm').deadline).toBeNull();
  });

  it('reads the minimum of a range, and takes the experience line only as quoted', () => {
    const jd = JD.replace('(0-1 years of experience)', '(1-3 years of experience)');
    const b = heuristicJobAnalysis(jd);
    const a = sanitizeJobAnalysis({ title: 'Software Engineer Intern - Backend', experience: { min_years: 3, text: 'Requirements: 5 years Kubernetes Python team' } }, jd, b, 'm');
    expect(a.experience.min_years).toBe(b.experience.min_years);
    expect(a.experience.min_years).not.toBe(3);
    expect(a.experience.text).not.toMatch(/Kubernetes/);
  });

  it('ignores English words that only look like skills, and treats a bare slash as "both"', () => {
    const jd = `${JD}\nYou should be ready to go from idea to launch and express ideas clearly.\nFront end: HTML/CSS.\nWe deploy with CI/CD.`;
    const b = heuristicJobAnalysis(jd);
    const a = sanitizeJobAnalysis({ title: 'Software Engineer Intern - Backend', must_have: ['Go', 'Express', 'HTML / CSS', 'CI/CD', 'JavaScript / TypeScript'] }, jd, b, 'm');
    expect(a.must_have).not.toContain('Go');
    expect(a.must_have).not.toContain('Express');
    expect(a.must_have).toEqual(expect.arrayContaining(['HTML', 'CSS', 'CI/CD', 'JavaScript / TypeScript']));
    const fit = computeJobFit({ skills: ['HTML', 'CI/CD'], projects: [], experience: [] }, a, new Date('2026-10-17'));
    expect(fit.matched_must).toEqual(expect.arrayContaining(['HTML', 'CI/CD']));
    expect(fit.missing_must).toContain('CSS');
  });

  it('always returns something that can be saved', () => {
    const long = 'JavaScript / TypeScript / Node.js / PostgreSQL / Docker / Git / AWS';
    const a = ai({ must_have: [long], responsibilities: ['x'.repeat(500)] });
    expect(jobSaveSchema.shape.analysis.safeParse({ ...a, company: a.company ?? 'x', title: a.title ?? 'y' }).success).toBe(true);
  });
});

describe('skills the candidate has', () => {
  it("doesn't count a skill that only appears in a project's description", () => {
    const fit = computeJobFit(
      { skills: ['Node.js'], projects: [{ name: 'Blog', description: 'Planning to learn Kubernetes and Redis next', technologies: ['Node.js'] }], experience: [] },
      heuristicJobAnalysis(JD),
      new Date('2026-10-17'),
    );
    expect(fit.skills_in_common).not.toContain('Kubernetes');
    expect(fit.skills_in_common).not.toContain('Redis');
    expect(fit.projects[0]?.matched ?? []).not.toContain('Redis');
  });
});


describe('priorities in the AI’s own words', () => {
  it('keeps a fair paraphrase backed by a quote', () => {
    const base = heuristicJobAnalysis(JD);
    const a = sanitizeJobAnalysis(
      { title: 'Software Engineer Intern - Backend', must_have: ['Node.js'], priorities: [{ point: 'Fast, well-tested database work', evidence: 'Write tests and help keep our PostgreSQL queries fast' }] },
      JD,
      base,
      'm',
    );
    expect(a.priorities.map((p) => p.point)).toEqual(['Fast, well-tested database work']);
  });

  it('drops a point that only shares a word or two with the JD', () => {
    const base = heuristicJobAnalysis(JD);
    const quote = 'Write tests and help keep our PostgreSQL queries fast';
    const a = sanitizeJobAnalysis(
      {
        title: 'Software Engineer Intern - Backend',
        must_have: ['Node.js'],
        priorities: [
          { point: 'Fast-growing, well-funded startup offering equity to interns', evidence: quote },
          { point: 'Write tests with guaranteed return offer', evidence: quote },
        ],
      },
      JD,
      base,
      'm',
    );
    expect(a.priorities).toEqual([]);
  });
});
