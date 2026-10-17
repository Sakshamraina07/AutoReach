import { describe, expect, it } from 'vitest';
import { htmlToText, parseCapturedPage, readPage, type RawPage } from '../lib/capture';

const posting = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebPage', name: 'Careers' },
    {
      '@type': 'JobPosting',
      title: 'Frontend Developer Intern',
      hiringOrganization: { '@type': 'Organization', name: 'Contoso' },
      jobLocation: [{ '@type': 'Place', address: { addressLocality: 'Bengaluru', addressRegion: 'KA', addressCountry: 'IN' } }],
      employmentType: ['INTERN'],
      validThrough: '2026-11-30T23:59:59+05:30',
      description: '<p>Build <strong>React</strong> components &amp; tests.</p><ul><li>TypeScript</li><li>Accessibility</li></ul>',
      skills: 'React, TypeScript, Accessibility',
      experienceRequirements: { '@type': 'OccupationalExperienceRequirements', monthsOfExperience: 6 },
    },
  ],
};

const raw = (over: Partial<RawPage> = {}): RawPage => ({ url: 'https://careers.contoso.example/jobs/42', title: 'Frontend Developer Intern | Contoso Careers', selection: '', description: '', siteName: '', jsonLd: [], ...over });

describe('page capture', () => {
  it('uses the JobPosting the site publishes, including @graph and nested places', () => {
    const p = parseCapturedPage(raw({ jsonLd: [JSON.stringify(posting)] }));
    expect(p.structured).toBe(true);
    expect(p.job).toMatchObject({
      title: 'Frontend Developer Intern',
      company: 'Contoso',
      location: 'Bengaluru, KA, IN',
      employment_type: 'internship',
      deadline: '2026-11-30',
      skills: ['React', 'TypeScript', 'Accessibility'],
      experience: '6 months',
      url: 'https://careers.contoso.example/jobs/42',
    });
    expect(p.job.description).toBe('Build React components & tests.\n\n• TypeScript\n• Accessibility');
  });

  it('falls back to the title and the user’s selection without inventing anything', () => {
    const p = parseCapturedPage(raw({ selection: 'Contact hr.team@contoso.example for details.', jsonLd: ['{not json'] }));
    expect(p.structured).toBe(false);
    expect(p.job.title).toBe('Frontend Developer Intern');
    expect(p.job.company).toBeNull();
    expect(p.job.description).toBe('Contact hr.team@contoso.example for details.');
    expect(p.emailsInSelection).toEqual(['hr.team@contoso.example']);
  });

  it('reads only title, URL, selection, meta and JSON-LD from a page', () => {
    document.head.innerHTML = `<meta name="description" content="Join us"><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Backend Intern' })}</script><script type="application/ld+json">{"@type":"Organization"}</script>`;
    document.title = 'Backend Intern - Fabrikam';
    document.body.innerHTML = '<p>Secret profile data</p>';
    const r = readPage();
    expect(r.title).toBe('Backend Intern - Fabrikam');
    expect(r.description).toBe('Join us');
    expect(r.jsonLd).toHaveLength(1); // only JobPosting blocks
    expect(JSON.stringify(r)).not.toContain('Secret profile data');
  });

  it('decodes entities and strips scripts', () => {
    expect(htmlToText('<script>alert(1)</script>A&nbsp;&#8211;&#x2014;B<br>C')).toBe('A –—B\nC'.replace(' ', ' '));
  });
});
