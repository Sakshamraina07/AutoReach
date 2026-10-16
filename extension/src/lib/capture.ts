/**
 * One-shot page reader for "Save this page".
 *
 * `readPage` is injected with chrome.scripting.executeScript only after the
 * user clicks, using the activeTab grant. It must stay self-contained (no
 * imports or outer variables) because Chrome serialises the function. It
 * returns only: URL, title, the user's own text selection, meta description,
 * site name and any schema.org JSON-LD blocks the site publishes for search
 * engines. It does not walk the page's DOM for personal data.
 */
export interface RawPage {
  url: string;
  title: string;
  selection: string;
  description: string;
  siteName: string;
  jsonLd: string[];
}

export function readPage(): RawPage {
  const meta = (sel: string) => (document.querySelector(sel) as HTMLMetaElement | null)?.content?.trim() ?? '';
  const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .map((s) => s.textContent ?? '')
    .filter((t) => /JobPosting/i.test(t))
    .slice(0, 5)
    .map((t) => t.slice(0, 200_000));
  return {
    url: location.href,
    title: document.title.slice(0, 300),
    selection: (window.getSelection()?.toString() ?? '').slice(0, 20_000),
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    siteName: meta('meta[property="og:site_name"]'),
    jsonLd: blocks,
  };
}

export interface CapturedPage {
  url: string;
  title: string;
  selection: string;
  /** True when the fields came from the site's own JobPosting data. */
  structured: boolean;
  job: {
    title: string | null;
    company: string | null;
    location: string | null;
    employment_type: 'internship' | 'full_time' | 'graduate_program' | 'contract' | 'part_time' | 'unknown';
    description: string | null;
    deadline: string | null;
    skills: string[];
    experience: string | null;
    url: string;
  };
  /** Addresses that appear in the user's selection, never guessed. */
  emailsInSelection: string[];
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function findJobPosting(node: unknown, depth = 0): Json | null {
  if (depth > 6 || !node) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findJobPosting(n, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (!isObj(node)) return null;
  const type = node['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return node;
  if (node['@graph']) return findJobPosting(node['@graph'], depth + 1);
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', bull: '•', hellip: '…' };

/** HTML (as published in JobPosting.description) to readable plain text, without a DOM. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function employmentType(v: unknown, title: string | null): CapturedPage['job']['employment_type'] {
  const list = (Array.isArray(v) ? v : [v]).map((x) => String(x ?? '').toUpperCase());
  if (list.some((x) => x.includes('INTERN')) || /\bintern(ship)?\b/i.test(title ?? '')) return 'internship';
  if (/\b(graduate|new grad|campus)\b/i.test(title ?? '')) return 'graduate_program';
  if (list.some((x) => x.includes('FULL'))) return 'full_time';
  if (list.some((x) => x.includes('PART'))) return 'part_time';
  if (list.some((x) => x.includes('CONTRACT') || x.includes('TEMPORARY'))) return 'contract';
  return 'unknown';
}

function locationOf(p: Json): string | null {
  if (String(p.jobLocationType ?? '').toUpperCase() === 'TELECOMMUTE') return 'Remote';
  const places = Array.isArray(p.jobLocation) ? p.jobLocation : p.jobLocation ? [p.jobLocation] : [];
  const names = places
    .map((pl) => {
      if (!isObj(pl)) return str(pl);
      const a = isObj(pl.address) ? pl.address : null;
      if (!a) return str(pl.name);
      return [str(a.addressLocality), str(a.addressRegion), str(a.addressCountry) ?? (isObj(a.addressCountry) ? str(a.addressCountry.name) : null)]
        .filter((x, i, arr): x is string => !!x && arr.indexOf(x) === i)
        .join(', ');
    })
    .filter((x): x is string => !!x);
  return names.length ? [...new Set(names)].slice(0, 3).join('; ') : null;
}

function experienceOf(v: unknown): string | null {
  if (typeof v === 'string') return htmlToText(v).slice(0, 300) || null;
  if (isObj(v) && typeof v.monthsOfExperience === 'number') {
    const m = v.monthsOfExperience;
    return m >= 12 ? `${+(m / 12).toFixed(1)} years` : `${m} months`;
  }
  return null;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Turn what readPage returned into reviewable fields. Pure; safe to run anywhere. */
export function parseCapturedPage(raw: RawPage): CapturedPage {
  let posting: Json | null = null;
  for (const block of raw.jsonLd) {
    try {
      posting = findJobPosting(JSON.parse(block));
    } catch {
      posting = null; // malformed JSON-LD is common; fall back to the title
    }
    if (posting) break;
  }
  const emailsInSelection = [...new Set((raw.selection.match(EMAIL_RE) ?? []).map((e) => e.replace(/[.,;:]+$/, '')))].slice(0, 5);

  if (posting) {
    const org = posting.hiringOrganization;
    const title = str(posting.title);
    const description = typeof posting.description === 'string' ? htmlToText(posting.description).slice(0, 30_000) : null;
    const deadline = str(posting.validThrough)?.slice(0, 10) ?? null;
    const skills = (Array.isArray(posting.skills) ? posting.skills : typeof posting.skills === 'string' ? posting.skills.split(/[,;\n]/) : [])
      .map((s) => String(s).trim())
      .filter((s) => s && s.length <= 50)
      .slice(0, 40);
    return {
      url: raw.url,
      title: raw.title,
      selection: raw.selection,
      structured: true,
      job: {
        title,
        company: isObj(org) ? str(org.name) : str(org),
        location: locationOf(posting),
        employment_type: employmentType(posting.employmentType, title),
        description,
        deadline: deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null,
        skills,
        experience: experienceOf(posting.experienceRequirements),
        url: str(posting.url) ?? raw.url,
      },
      emailsInSelection,
    };
  }

  // No structured data: offer the page title and the user's selection, nothing inferred.
  const cleanTitle = raw.title.replace(/\s*[|–-]\s*[^|–-]*$/, '').trim() || raw.title;
  return {
    url: raw.url,
    title: raw.title,
    selection: raw.selection,
    structured: false,
    job: {
      title: cleanTitle || null,
      company: raw.siteName || null,
      location: null,
      employment_type: employmentType(null, cleanTitle),
      description: raw.selection.trim() || raw.description || null,
      deadline: null,
      skills: [],
      experience: null,
      url: raw.url,
    },
    emailsInSelection,
  };
}
