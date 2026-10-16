import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  businessDaysBetween,
  classifyRoleCategory,
  compileTemplate,
  deriveDisplayStatus,
  deriveTrackingDisplay,
  duplicateSuggestionKey,
  extractClaimNumbers,
  extractExperienceRequirement,
  extractSkills,
  findPlaceholders,
  hasBlockingFindings,
  isRoleAddress,
  isValidEmail,
  matchSkills,
  normalizeCompanyName,
  normalizeEmail,
  parseAddressHeader,
  parseAddressList,
  profileCompleteness,
  recruiterCreateSchema,
  runQualityChecks,
  settingsUpdateSchema,
  type QualityInput,
} from './index.js';

describe('email helpers', () => {
  it('normalizes case and whitespace only', () => {
    expect(normalizeEmail('  Priya.Shah@Example-Corp.COM ')).toBe('priya.shah@example-corp.com');
  });

  it('validates addresses', () => {
    expect(isValidEmail('a.b@company.io')).toBe(true);
    expect(isValidEmail('a..b@company.io')).toBe(false);
    expect(isValidEmail('no-at-sign')).toBe(false);
    expect(isValidEmail('x@localhost')).toBe(false);
    expect(isValidEmail(`${'a'.repeat(65)}@company.io`)).toBe(false);
  });

  it('builds duplicate suggestion keys cautiously', () => {
    expect(duplicateSuggestionKey('J.Doe+jobs@GoogleMail.com')).toBe('jdoe@gmail.com');
    // dots are significant on company domains
    expect(duplicateSuggestionKey('j.doe+x@acme.io')).toBe('j.doe@acme.io');
  });

  it('flags shared mailboxes', () => {
    expect(isRoleAddress('careers@acme.io')).toBe(true);
    expect(isRoleAddress('meera@acme.io')).toBe(false);
  });

  it('parses address headers', () => {
    expect(parseAddressHeader('"Rao, Anil" <Anil.Rao@Acme.io>')).toEqual({ email: 'anil.rao@acme.io', name: 'Rao, Anil' });
    expect(parseAddressHeader('anil@acme.io')).toEqual({ email: 'anil@acme.io', name: '' });
    expect(parseAddressList('"Rao, Anil" <a@x.io>, b@y.io')).toEqual(['a@x.io', 'b@y.io']);
  });

  it('normalizes company names', () => {
    expect(normalizeCompanyName('Northwind Technologies Pvt. Ltd.')).toBe('northwind technologies');
    expect(normalizeCompanyName('AT&T Inc')).toBe('at and t');
  });
});

describe('skills', () => {
  it('extracts skills without false positives on prose', () => {
    const jd = 'We use React, TypeScript and Node.js. Experience with PostgreSQL, Docker or Go/Rust is a plus.';
    expect(extractSkills(jd)).toEqual(expect.arrayContaining(['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Docker', 'Go', 'Rust']));
    expect(extractSkills('Please go ahead and express interest; it may spark ideas.')).toEqual([]);
    expect(extractSkills('Strong JavaScript skills')).toEqual(['JavaScript']);
  });

  it('matches by canonical names and counts only', () => {
    const r = matchSkills(['reactjs', 'Node', 'python'], ['React', 'Node.js', 'Kubernetes']);
    expect(r.matched).toEqual(['React']);
    expect(r.missing).toEqual(['Node.js', 'Kubernetes']);
    expect(r.considered).toBe(3);
  });
});

describe('roles', () => {
  it('classifies role titles', () => {
    expect(classifyRoleCategory('Frontend Developer Intern')).toBe('frontend');
    expect(classifyRoleCategory('Backend Software Engineer Intern')).toBe('backend');
    expect(classifyRoleCategory('Full Stack Developer')).toBe('fullstack');
    expect(classifyRoleCategory('AI/ML Engineer Intern')).toBe('ai_ml');
    expect(classifyRoleCategory('Graduate Software Engineer')).toBe('general_swe');
    expect(classifyRoleCategory('Software Engineering Fresher')).toBe('general_swe');
    expect(classifyRoleCategory('')).toBe('speculative');
  });

  it('extracts experience requirements', () => {
    expect(extractExperienceRequirement('Requires 0-2 years of experience in web development')).toMatch(/0-2 years/);
    expect(extractExperienceRequirement('Open to freshers and new grads')).toBe('Entry level / freshers');
  });
});

describe('templates', () => {
  it('fills v1 variables and reports missing/unknown ones', () => {
    const r = compileTemplate('Hi {name}, about {Role} at {company} — {user_name} {nope}', {
      name: 'Meera Iyer',
      role: 'Frontend Intern',
      company: '',
      user_name: 'Sam',
    });
    expect(r.text).toBe('Hi Meera Iyer, about Frontend Intern at  — Sam {nope}');
    expect(r.missing).toEqual(['company']);
    expect(r.unknown).toEqual(['{nope}']);
  });

  it('finds leftover placeholders', () => {
    expect(findPlaceholders('Dear [Recruiter Name], I love {company}')).toEqual(expect.arrayContaining(['[Recruiter Name]', '{company}']));
    expect(findPlaceholders('A normal sentence (with brackets).')).toEqual([]);
  });
});

describe('quality checks', () => {
  const base: QualityInput = {
    kind: 'initial',
    subject: 'Frontend Developer Intern — Sam Kumar',
    body:
      'Hi Meera,\n\nI am a final-year CSE student applying for the Frontend Developer Intern role at Northwind. I built a React dashboard used by 120 students and cut page load time by 35%. My résumé is attached.\n\nWould you be open to a short call?\n\nThanks,\nSam',
    recruiterName: 'Meera Iyer',
    recruiterEmail: 'meera@northwind.io',
    companyName: 'Northwind',
    otherCompanyNames: ['Contoso', 'Northwind'],
    candidateSkills: ['React', 'TypeScript'],
    factsText: 'Project: Campus dashboard in React used by 120 students; reduced page load time by 35%.',
    attachment: { required: true, present: true },
  };

  it('passes a grounded draft without errors', () => {
    const f = runQualityChecks(base);
    expect(hasBlockingFindings(f)).toBe(false);
    expect(f.find((x) => x.code === 'UNSUPPORTED_NUMBER')).toBeUndefined();
  });

  it('flags fabricated metrics and skills', () => {
    const f = runQualityChecks({ ...base, body: `${base.body}\nI also scaled a Kubernetes cluster to 10k users.` });
    expect(f.map((x) => x.code)).toEqual(expect.arrayContaining(['UNSUPPORTED_NUMBER', 'UNSUPPORTED_SKILL']));
  });

  it('flags the wrong company and wrong greeting name as errors', () => {
    const f = runQualityChecks({ ...base, body: base.body.replace('Hi Meera', 'Hi Rahul').replace('at Northwind', 'at Contoso') });
    const codes = f.map((x) => x.code);
    expect(codes).toContain('WRONG_COMPANY');
    expect(codes).toContain('WRONG_RECIPIENT_NAME');
    expect(hasBlockingFindings(f)).toBe(true);
  });

  it('flags missing attachment, placeholders, previous contact and referral claims', () => {
    const f = runQualityChecks({
      ...base,
      body: 'Hi Meera, {company} is great. I was referred by a mutual friend. Please find my resume attached.',
      attachment: { required: true, present: false },
      previousContact: { count: 1, lastSentAt: '2026-10-01T10:00:00Z' },
    });
    expect(f.map((x) => x.code)).toEqual(
      expect.arrayContaining(['PLACEHOLDER_LEFT', 'MISSING_ATTACHMENT', 'MENTIONS_MISSING_ATTACHMENT', 'PREVIOUSLY_CONTACTED', 'UNSUPPORTED_CONNECTION']),
    );
  });

  it('extracts claim numbers but ignores years, small counts and phones', () => {
    expect(extractClaimNumbers('Graduating in 2027 with 3 projects, call +91 98765 43210; served 1,200 users and 40% faster')).toEqual([
      '1,200users',
      '40%',
    ]);
  });
});

describe('status derivation', () => {
  const sent = { send_status: 'sent' as const, reply_status: 'none' as const, tracking_enabled: true, first_open_at: null };
  it('keeps send, open and reply facts distinct', () => {
    expect(deriveDisplayStatus(sent).key).toBe('sent');
    expect(deriveDisplayStatus({ ...sent, first_open_at: '2026-10-10T00:00:00Z' }).key).toBe('open_detected');
    expect(deriveDisplayStatus({ ...sent, first_open_at: '2026-10-10T00:00:00Z', reply_status: 'replied' }).key).toBe('replied');
    expect(deriveDisplayStatus({ ...sent, send_status: 'unknown' }).key).toBe('unknown');
    expect(deriveDisplayStatus({ ...sent, send_status: 'failed' }).label).toBe('Failed');
  });

  it('never shows an open when tracking was off', () => {
    expect(deriveDisplayStatus({ ...sent, tracking_enabled: false, first_open_at: '2026-10-10T00:00:00Z' }).key).toBe('sent');
    expect(deriveTrackingDisplay({ ...sent, tracking_enabled: false }).label).toBe('Tracking off');
    expect(deriveTrackingDisplay(sent).label).toBe('No open detected');
  });
});

describe('business days', () => {
  it('skips weekends in the user timezone', () => {
    // Friday 2026-10-16 15:00 IST → +5 business days = Friday 2026-10-23 10:00 IST = 04:30Z
    expect(addBusinessDays('2026-10-16T09:30:00Z', 5, 'Asia/Kolkata')).toBe('2026-10-23T04:30:00.000Z');
    // Saturday + 1 business day = Monday
    expect(addBusinessDays('2026-10-17T06:00:00Z', 1, 'UTC')).toBe('2026-10-19T10:00:00.000Z');
    expect(businessDaysBetween('2026-10-16T09:00:00Z', '2026-10-20T09:00:00Z', 'UTC')).toBe(2);
  });
});

describe('schemas', () => {
  it('rejects javascript: URLs and invalid emails', () => {
    expect(recruiterCreateSchema.safeParse({ email: 'bad', linkedin_url: null }).success).toBe(false);
    expect(recruiterCreateSchema.safeParse({ email: 'a@acme.io', linkedin_url: 'javascript:alert(1)' }).success).toBe(false);
    expect(recruiterCreateSchema.parse({ email: 'a@acme.io', linkedin_url: '' }).linkedin_url).toBeNull();
  });

  it('validates spacing bounds', () => {
    expect(settingsUpdateSchema.safeParse({ send_spacing_min_seconds: 100, send_spacing_max_seconds: 50 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ timezone: 'Asia/Kolkata' }).success).toBe(true);
  });
});

describe('profile completeness', () => {
  it('scores what the drafting assistant uses', () => {
    expect(profileCompleteness(null, { hasResume: false, gmailConnected: false }).percent).toBe(0);
    const p = profileCompleteness({ full_name: 'Sam', skills: ['a', 'b', 'c', 'd', 'e'] }, { hasResume: true, gmailConnected: true });
    expect(p.percent).toBeGreaterThan(30);
    expect(p.items.find((i) => i.key === 'projects')?.done).toBe(false);
  });
});
