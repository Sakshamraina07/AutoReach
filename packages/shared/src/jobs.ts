/**
 * Job descriptions → structured analysis, the candidate's fit, and pasted
 * recruiter contacts. Pure functions: the API runs them, the tests pin them.
 *
 * The AI may only *summarise* a job description. Everything it returns is
 * checked against the pasted text here: skills must occur in the JD, every
 * "what they care about" point must quote the JD, and numbers must appear in it.
 */
import { z } from 'zod';
import { isValidEmail, normalizeEmail } from './email.js';
import { EMPLOYMENT_TYPES, type EmploymentType } from './enums.js';
import { extractExperienceRequirement } from './roles.js';
import { canonicalSkill, canonicalSkillSet, extractSkills, SKILL_LEXICON } from './skills.js';

export const SENIORITY_LEVELS = ['intern', 'entry', 'mid', 'senior', 'unknown'] as const;
export type Seniority = (typeof SENIORITY_LEVELS)[number];

export interface JobPriority {
  /** What the team cares about, in a few words ("Shipping APIs used by millions"). */
  point: string;
  /** Verbatim quote from the job description that shows it. */
  evidence: string;
}

export interface JobAnalysis {
  company: string | null;
  title: string | null;
  location: string | null;
  employment_type: EmploymentType;
  seniority: Seniority;
  experience: { min_years: number | null; text: string | null; fresher_friendly: boolean | null };
  must_have: string[];
  nice_to_have: string[];
  responsibilities: string[];
  priorities: JobPriority[];
  deadline: string | null;
  source: 'ai' | 'heuristic';
  model: string | null;
  notes: string[];
}

export type FitVerdict = 'strong' | 'good' | 'stretch' | 'long_shot';

export interface JobFit {
  verdict: FitVerdict;
  /** One sentence for the screen ("You have 6 of 8 must-have skills."). */
  summary: string;
  matched_must: string[];
  missing_must: string[];
  matched_nice: string[];
  /**
   * The specific skills the candidate has, out of everything the job lists. For an
   * entry such as "Java / Kotlin" only the one they actually have is named, so an
   * email built from this never claims the other.
   */
  skills_in_common: string[];
  /** The candidate's projects that best match, with the job skills each one shows. */
  projects: { name: string; matched: string[] }[];
  warnings: string[];
}

export const FIT_VERDICT_LABELS: Record<FitVerdict, string> = {
  strong: 'Strong fit',
  good: 'Good fit',
  stretch: 'Stretch',
  long_shot: 'Long shot',
};

/* ------------------------------------------------------------------ */
/* Request schemas                                                     */
/* ------------------------------------------------------------------ */

const jdText = z
  .string()
  .trim()
  .min(80, 'Paste the full job description (at least a few sentences).')
  .max(30000, 'That job description is longer than 30,000 characters. Paste the main part.');

const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\/[^\s]+$/i.test(v), { message: 'Must be an http(s) URL' });

export const jobAnalyzeSchema = z.object({ text: jdText, url: optionalUrl });
export type JobAnalyzeRequest = z.infer<typeof jobAnalyzeSchema>;

const skillList = z.array(z.string().trim().min(1).max(60)).max(25);

/** The analysis as the candidate confirmed it (they may correct company, title, etc.). */
export const jobAnalysisSchema = z.object({
  company: z.string().trim().max(160).nullable(),
  title: z.string().trim().max(200).nullable(),
  location: z.string().trim().max(160).nullable(),
  employment_type: z.enum(EMPLOYMENT_TYPES),
  seniority: z.enum(SENIORITY_LEVELS),
  experience: z.object({
    min_years: z.number().int().min(0).max(40).nullable(),
    text: z.string().trim().max(300).nullable(),
    fresher_friendly: z.boolean().nullable(),
  }),
  must_have: skillList,
  nice_to_have: skillList,
  responsibilities: z.array(z.string().trim().min(1).max(220)).max(6),
  priorities: z.array(z.object({ point: z.string().trim().min(1).max(200), evidence: z.string().trim().min(1).max(400) })).max(3),
  deadline: z.iso.date().nullable(),
  source: z.enum(['ai', 'heuristic']),
  model: z.string().max(120).nullable(),
  notes: z.array(z.string().max(300)).max(6),
});

export const jobSaveSchema = z.object({
  text: jdText,
  url: optionalUrl,
  analysis: jobAnalysisSchema.extend({
    company: z.string().trim().min(1, 'Enter the company name').max(160),
    title: z.string().trim().min(1, 'Enter the role title').max(200),
  }),
  /** Reuse an opportunity saved earlier (e.g. from the extension). */
  opportunity_id: z.uuid().nullish(),
});
export type JobSaveRequest = z.infer<typeof jobSaveSchema>;

export const jobRecruitersPasteSchema = z.object({
  text: z.string().max(200_000).default(''),
  recruiter_ids: z.array(z.uuid()).max(50).default([]),
});

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) =>
  squash(s)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-');
const words = (s: string) => norm(s).match(/[a-z0-9+#.]{4,}/g) ?? [];

function lines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

const BULLET = /^(?:[-*•●▪‣⁃∙]|\d{1,2}[.)])\s+/;

/** Lines under a heading that matches `heading`, until the next heading-like line. */
function section(text: string, heading: RegExp): string[] {
  const out: string[] = [];
  let inside = false;
  for (const l of lines(text)) {
    const isHeading = !BULLET.test(l) && l.length <= 80 && (/:$/.test(l) || /^[A-Z][^.!?]*$/.test(l)) && l.split(' ').length <= 9;
    if (isHeading) {
      inside = heading.test(l);
      continue;
    }
    if (inside) out.push(l.replace(BULLET, ''));
  }
  return out;
}

const NICE_HEADING = /\b(nice[\s-]to[\s-]have|good[\s-]to[\s-]have|preferred|bonus|plus|desirable|would be (?:a )?(?:plus|great))\b/i;
const MUST_HEADING = /\b(requirements?|must[\s-]have|qualifications?|what you(?:'| wi)ll need|what we(?:'re| are) looking for|you (?:have|bring|should have)|skills|eligibility|who you are)\b/i;
const RESP_HEADING = /\b(responsibilit\w*|what you(?:'| wi)ll do|the role|your role|role overview|day[\s-]to[\s-]day|you will|job description|key duties)\b/i;

const ROLE_WORD = /\b(intern(ship)?|engineer|developer|sde|swe|analyst|scientist|programmer|architect|associate|trainee|graduate|fresher|designer|consultant)\b/i;

function guessTitle(text: string): string | null {
  for (const l of lines(text).slice(0, 8)) {
    const m = l.match(/^(?:job\s+title|role|position|title)\s*[:-]\s*(.{3,120})$/i);
    if (m?.[1]) return squash(m[1]);
  }
  for (const l of lines(text).slice(0, 5)) {
    if (l.length <= 100 && ROLE_WORD.test(l) && !/[.!?]$/.test(l) && !/^about\b/i.test(l)) return squash(l.replace(/\s*[|–-]\s*(apply|job|careers?).*$/i, ''));
  }
  return null;
}

function guessCompany(text: string): string | null {
  const labelled = text.match(/\b(?:company(?:\s+name)?|organi[sz]ation|employer)\s*[:-]\s*([^\n]{2,80})/i);
  if (labelled?.[1]) return squash(labelled[1]).replace(/[.,;]+$/, '');
  const about = text.match(/^about\s+(?!the\b|us\b|you\b|this\b|our\b|the role\b|the job\b|the team\b)([A-Z][\w&.'\- ]{1,60}?)\s*:?\s*$/m);
  if (about?.[1]) return squash(about[1]);
  const at = (lines(text)[0] ?? '').match(/\b(?:at|@)\s+([A-Z][\w&.'\- ]{1,60})$/);
  if (at?.[1]) return squash(at[1]);
  return null;
}

function guessLocation(text: string): string | null {
  const m = text.match(/\b(?:location|based in|work location|office)\s*[:-]\s*([^\n]{2,100})/i);
  if (m?.[1]) return squash(m[1]).replace(/[.;]+$/, '');
  if (/\b(fully remote|100% remote|remote[- ]first)\b/i.test(text)) return 'Remote';
  return null;
}

function guessEmploymentType(text: string, title: string | null): EmploymentType {
  const t = `${title ?? ''}\n${text}`;
  if (/\bintern(ship)?s?\b/i.test(title ?? '') || /\b(internship|summer intern|winter intern)\b/i.test(text.slice(0, 1500))) return 'internship';
  if (/\b(graduate (scheme|program(me)?)|new grad(uate)? program)\b/i.test(t)) return 'graduate_program';
  if (/\bcontract(or)?\b|\bfixed[- ]term\b/i.test(t.slice(0, 2000))) return 'contract';
  if (/\bpart[- ]time\b/i.test(t.slice(0, 2000))) return 'part_time';
  if (/\bfull[- ]time\b/i.test(t)) return 'full_time';
  return 'unknown';
}

function minYearsFrom(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d{1,2})/);
  return m ? Number(m[1]) : null;
}

function guessSeniority(title: string | null, minYears: number | null, text: string): Seniority {
  const t = title ?? '';
  if (/\bintern(ship)?\b/i.test(t)) return 'intern';
  if (/\b(senior|sr\.?|lead|staff|principal|head of|manager|director)\b/i.test(t)) return 'senior';
  if (minYears !== null) {
    if (minYears >= 5) return 'senior';
    if (minYears >= 2) return 'mid';
    return 'entry';
  }
  if (/\b(fresher|freshers|new grad|recent graduates?|entry[- ]level|graduate|junior|jr\.?|trainee|associate)\b/i.test(`${t}\n${text.slice(0, 3000)}`)) return 'entry';
  return 'unknown';
}

const FRESHER_OK = /\b(freshers?|new grads?|recent graduates?|no (prior )?experience (is )?required|0\s*(?:-|–|to)\s*\d\s*(?:years?|yrs?)|final[- ]year students?|students? graduating)\b/i;

function guessDeadline(text: string): string | null {
  const m = text.match(/\b(?:apply by|deadline|last date(?: to apply)?|applications? close[sd]?(?: on)?)\s*[:-]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i);
  if (!m?.[1]) return null;
  const cleaned = m[1].replace(/(\d)(st|nd|rd|th)/i, '$1').replace(',', '');
  const d = new Date(`${cleaned} UTC`);
  if (Number.isNaN(d.getTime())) {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(m[1]) ? m[1] : null;
    return iso;
  }
  return d.toISOString().slice(0, 10);
}

/** Names written with a slash that are one thing, not a choice. */
const SLASH_COMPOUND = /\b(?:ci\/cd|pl\/sql|tcp\/ip|ui\/ux|a\/b|i\/o|b2b\/b2c)\b/gi;

/**
 * "JavaScript / TypeScript" (as AutoReach writes it) or "Java or Kotlin": the job accepts
 * either. "CI/CD", "PL/SQL" and similar stay one skill.
 */
export function skillAlternatives(entry: string): string[] {
  const kept: string[] = [];
  const masked = entry.replace(SLASH_COMPOUND, (m) => `\uE000${kept.push(m) - 1}\uE000`);
  return masked
    .split(/\s*(?:\/|\bor\b)\s*/i)
    .map((p) => p.replace(/\uE000(\d+)\uE000/g, (_, i: string) => kept[Number(i)] ?? '').trim())
    .filter(Boolean);
}

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text offers `a` and `b` as a choice ("Java or Kotlin", "Java and/or Kotlin"). A plain "HTML/CSS" means both. */
function offeredAsChoice(text: string, a: string, b: string): boolean {
  const names = (skill: string) => {
    const entry = SKILL_LEXICON.find((e) => e.name.toLowerCase() === canonicalSkill(skill).toLowerCase());
    return [skill, ...(entry ? [entry.name, ...entry.aliases] : [])].map(esc).join('|');
  };
  const or = '\\s*,?\\s*(?:\\bor\\b|\\band\\s*/\\s*or\\b)\\s*';
  const side = (skill: string) => `(?<![\\w.])(?:${names(skill)})(?![\\w])`;
  return new RegExp(`${side(a)}${or}${side(b)}|${side(b)}${or}${side(a)}`, 'i').test(text);
}

/** Knowing the left side means knowing the right side well enough to say so. */
const IMPLIES: Record<string, string[]> = {
  postgresql: ['sql'],
  mysql: ['sql'],
  typescript: ['javascript'],
  'node.js': ['javascript'],
  react: ['javascript'],
  'next.js': ['react', 'javascript'],
  express: ['node.js', 'javascript'],
  django: ['python'],
  flask: ['python'],
  fastapi: ['python'],
};

function withImplied(skills: Set<string>): Set<string> {
  const out = new Set(skills);
  for (const s of skills) for (const extra of IMPLIES[s] ?? []) out.add(extra);
  return out;
}

/** Group skills that one requirement line offers as alternatives ("JavaScript or TypeScript"). */
function groupAlternatives(lineList: string[], skills: string[]): string[] {
  const out: string[] = [];
  const used = new Set<string>();
  for (const line of lineList) {
    if (!/\bor\b/i.test(line)) continue;
    const inLine = extractSkills(line).filter((sk) => skills.includes(sk));
    if (inLine.length < 2) continue;
    const alt = inLine.map(esc).join('|');
    // Only the skills directly either side of "or" ("JavaScript or TypeScript and Node.js" → JS / TS).
    // A slash alone ("HTML/CSS") means both are wanted.
    const re = new RegExp(`(?<![\\w.])(${alt})(?![\\w])\\s*(?:,\\s*)?(?:\\bor\\b|\\band\\s*/\\s*or\\b)\\s*(${alt})(?![\\w])`, 'gi');
    for (const m of line.matchAll(re)) {
      const a = inLine.find((sk) => sk.toLowerCase() === m[1]!.toLowerCase());
      const b = inLine.find((sk) => sk.toLowerCase() === m[2]!.toLowerCase());
      if (a && b && a !== b && !used.has(a) && !used.has(b)) {
        used.add(a);
        used.add(b);
        out.push(`${a} / ${b}`);
      }
    }
  }
  for (const sk of skills) if (!used.has(sk)) out.push(sk);
  return out;
}

/* ------------------------------------------------------------------ */
/* Analysis without AI                                                 */
/* ------------------------------------------------------------------ */

export function heuristicJobAnalysis(text: string): JobAnalysis {
  const title = guessTitle(text);
  const expText = extractExperienceRequirement(text);
  const minYears = minYearsFrom(expText);
  const niceLines = section(text, NICE_HEADING);
  const mustLines = section(text, MUST_HEADING);
  const nice = extractSkills(niceLines.join('\n'));
  const niceSet = canonicalSkillSet(nice);
  const mustFromSection = extractSkills(mustLines.join('\n'));
  const all = extractSkills(text);
  const mustFlat = (mustFromSection.length ? mustFromSection : all).filter((s) => !niceSet.has(s.toLowerCase()) || mustFromSection.includes(s));
  const must = groupAlternatives(mustLines.length ? mustLines : lines(text), mustFlat);
  const responsibilities = section(text, RESP_HEADING)
    .filter((l) => l.length >= 15)
    .slice(0, 5)
    .map((l) => squash(l).slice(0, 200));
  return {
    company: guessCompany(text),
    title,
    location: guessLocation(text),
    employment_type: guessEmploymentType(text, title),
    seniority: guessSeniority(title, minYears, text),
    experience: { min_years: minYears, text: expText, fresher_friendly: FRESHER_OK.test(text) ? true : minYears !== null && minYears >= 2 ? false : null },
    must_have: must.slice(0, 15),
    nice_to_have: nice.filter((s) => !mustFlat.includes(s)).slice(0, 12),
    responsibilities,
    priorities: [],
    deadline: guessDeadline(text),
    source: 'heuristic',
    model: null,
    notes: [],
  };
}

/* ------------------------------------------------------------------ */
/* Checking what the AI returned                                       */
/* ------------------------------------------------------------------ */

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? squash(v).slice(0, max) : null;
}

function strList(v: unknown, maxItems: number, maxLen: number): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter((x): x is string => !!x).slice(0, maxItems) : [];
}

/** The phrase occurs in the JD as whole words ("Go" doesn't count inside "good", "Meta" not inside "metadata"). */
function hasPhrase(jdNorm: string, phrase: string): boolean {
  const p = norm(phrase);
  if (!p) return false;
  return new RegExp(`(?<![a-z0-9])${esc(p)}(?![a-z0-9])`).test(jdNorm);
}

/** True when the value, or most of its words, occur in the JD as whole words (tolerates "Contoso" vs "Contoso Ltd."). */
function occursIn(jdNorm: string, value: string): boolean {
  if (hasPhrase(jdNorm, value)) return true;
  const ws = norm(value).match(/[a-z0-9&+#.]{3,}/g) ?? [];
  return ws.length > 0 && ws.filter((w) => hasPhrase(jdNorm, w)).length >= Math.ceil(ws.length * 0.6);
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'their', 'they', 'what', 'about', 'your', 'you', 'our', 'are', 'who', 'will', 'can', 'more', 'most', 'team', 'teams', 'work']);
const contentWords = (s: string) => (norm(s).match(/[a-z0-9+#.]{3,}/g) ?? []).filter((w) => !STOP.has(w));

const LEXICON_NAMES = new Set(SKILL_LEXICON.map((e) => e.name.toLowerCase()));

/**
 * Keep only skills the JD itself asks for. Skills AutoReach knows ("Go", "Express", "Swift")
 * must be found by its own careful matcher, so "ready to go" isn't Go; other names must
 * appear in the JD as whole words. "A / B" stays a choice only if the JD says "A or B".
 */
function verifiedJobSkills(raw: string[], jd: string, jdNorm: string, jdSkills: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const ok = (p: string) => {
    const key = canonicalSkill(p).toLowerCase();
    return LEXICON_NAMES.has(key) ? jdSkills.has(key) : hasPhrase(jdNorm, p);
  };
  const push = (entry: string) => {
    const k = entry.toLowerCase();
    if (entry.length > 60 || seen.has(k)) return;
    seen.add(k);
    out.push(entry);
  };
  for (const s of raw) {
    const parts = skillAlternatives(s).filter(ok).map(canonicalSkill);
    if (parts.length === 2 && offeredAsChoice(jd, parts[0]!, parts[1]!)) push(`${parts[0]} / ${parts[1]}`);
    else for (const part of parts) push(part);
  }
  return out;
}

/** A YYYY-MM-DD date the JD actually writes (as ISO, or with its day, month and year). */
function dateWrittenIn(jd: string, iso: string): boolean {
  if (!jobAnalysisSchema.shape.deadline.safeParse(iso).success) return false;
  if (jd.includes(iso)) return true;
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const month = new Date(Date.UTC(2000, m - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const monthRe = `(?:${month}|${month.slice(0, 3)})\\.?`;
  const day = `0?${d}(?:st|nd|rd|th)?`;
  return new RegExp(`\\b${day}\\s+${monthRe},?\\s+${y}\\b|\\b${monthRe}\\s+${day},?\\s+${y}\\b|\\b0?${d}[/.-]0?${m}[/.-]${y}\\b`, 'i').test(jd);
}

/**
 * Merge an AI analysis into the heuristic one, keeping only what the JD supports.
 * Anything the model invents is dropped and counted in `notes`.
 */
export function sanitizeJobAnalysis(raw: Record<string, unknown> | null, jd: string, base: JobAnalysis, model: string | null): JobAnalysis {
  if (!raw) return base;
  const jdNorm = norm(jd);
  const jdSkills = canonicalSkillSet(extractSkills(jd));
  let dropped = 0;
  const quoted = (v: string | null) => !!v && jdNorm.includes(norm(v));

  const company = str(raw.company, 160);
  const title = str(raw.title, 200);
  const location = str(raw.location, 160);
  const et = typeof raw.employment_type === 'string' && (EMPLOYMENT_TYPES as readonly string[]).includes(raw.employment_type) ? (raw.employment_type as EmploymentType) : null;
  const sen = typeof raw.seniority === 'string' && (SENIORITY_LEVELS as readonly string[]).includes(raw.seniority) ? (raw.seniority as Seniority) : null;

  const exp = (raw.experience && typeof raw.experience === 'object' ? raw.experience : {}) as Record<string, unknown>;
  let minYears = typeof exp.min_years === 'number' && Number.isInteger(exp.min_years) && exp.min_years >= 0 && exp.min_years <= 40 ? exp.min_years : null;
  // The minimum must be written in the JD next to "year(s)", and not as the top of a range ("1-3 years" is 1).
  if (minYears !== null && minYears > 0 && !new RegExp(`(?<![\\d.])(?<!\\d\\s*(?:-|–|to)\\s*)${minYears}\\s*(?:\\+|(?:-|–|to)\\s*\\d{1,2})?\\s*\\+?\\s*(?:years?|yrs?)\\b`, 'i').test(jd)) {
    minYears = base.experience.min_years;
    dropped++;
  }
  const expTextRaw = str(exp.text, 300);
  // The experience line feeds the email, so it must be the JD's own words.
  const expText = quoted(expTextRaw) ? expTextRaw : null;
  if (expTextRaw && !expText) dropped++;
  const fresher = typeof exp.fresher_friendly === 'boolean' ? exp.fresher_friendly : null;

  const mustRaw = strList(raw.must_have, 25, 80);
  const niceRaw = strList(raw.nice_to_have, 25, 80);
  const must = verifiedJobSkills(mustRaw, jd, jdNorm, jdSkills).slice(0, 25);
  const mustKeys = new Set(must.flatMap(skillAlternatives).map((s) => s.toLowerCase()));
  const nice = verifiedJobSkills(niceRaw, jd, jdNorm, jdSkills)
    .filter((s) => !skillAlternatives(s).some((p) => mustKeys.has(p.toLowerCase())))
    .slice(0, 25);
  dropped += Math.max(0, mustRaw.length + niceRaw.length - must.length - nice.length);

  const responsibilities = strList(raw.responsibilities, 8, 220).filter((r) => {
    const ws = words(r);
    const ok = ws.length > 0 && ws.filter((w) => hasPhrase(jdNorm, w)).length / ws.length >= 0.5;
    if (!ok) dropped++;
    return ok;
  });

  // Each priority opens an email, so it must be backed by a real quote, and the point
  // itself may only use the JD's words, numbers and skills.
  const priorities: JobPriority[] = [];
  if (Array.isArray(raw.priorities)) {
    for (const p of raw.priorities.slice(0, 5)) {
      const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      const point = str(o.point, 200);
      const evidence = str(o.evidence, 400)?.replace(/^["'“]+|["'”]+$/g, '') ?? null;
      const evidenceOk = quoted(evidence) && (evidence!.split(/\s+/).length >= 6 || evidence!.length >= 30);
      const pointWords = point ? contentWords(point) : [];
      // Paraphrase is fine ("Fast, well-tested database work"), new facts are not: names, numbers and skills must be in the JD.
      // A word counts when the JD has it, or the same stem ("tested" → "test…", "merchants" → "merchan…").
      const inJd = (w: string) => new RegExp(`(?<![a-z0-9])${esc(w.length >= 6 ? w.slice(0, w.length - 2) : w)}`).test(jdNorm);
      const names = point ? point.split(/\s+/).slice(1).filter((w) => /^[A-Z]/.test(w)).map((w) => w.replace(/[^\w&.+#-]+$/, '')) : [];
      const pointOk =
        !!point &&
        // Most of its words must come from the JD: one shared word ("interns") isn't enough
        // to carry "well-funded startup offering equity to interns".
        pointWords.length > 0 &&
        pointWords.filter(inJd).length / pointWords.length >= 0.5 &&
        names.every((n) => hasPhrase(jdNorm, n)) &&
        (point.match(/\d+/g) ?? []).every((n) => new RegExp(`(?<!\\d)${n}(?!\\d)`).test(jd)) &&
        extractSkills(point).every((sk) => jdSkills.has(sk.toLowerCase()));
      if (point && evidence && evidenceOk && pointOk) priorities.push({ point, evidence });
      else dropped++;
      if (priorities.length === 3) break;
    }
  }

  const deadlineRaw = str(raw.deadline, 10);
  let deadline = base.deadline;
  if (deadlineRaw && deadlineRaw !== base.deadline) {
    if (!base.deadline && dateWrittenIn(jd, deadlineRaw)) deadline = deadlineRaw;
    else dropped++;
  }

  const notes = [...base.notes];
  if (dropped > 0) notes.push(`${dropped} detail${dropped === 1 ? '' : 's'} from the AI didn't match the job description and ${dropped === 1 ? 'was' : 'were'} left out.`);

  // Company and role must appear in the JD. When they don't and the plain reading found
  // nothing either, leave them empty so the page asks instead of guessing.
  const merged: JobAnalysis = {
    company: company && occursIn(jdNorm, company) ? company : base.company,
    title: title && occursIn(jdNorm, title) ? title : base.title,
    location: location && occursIn(jdNorm, location) ? location : base.location,
    employment_type: et ?? base.employment_type,
    seniority: sen ?? base.seniority,
    experience: {
      min_years: minYears,
      text: expText ?? base.experience.text,
      fresher_friendly: fresher ?? base.experience.fresher_friendly,
    },
    must_have: must.length ? must : base.must_have,
    nice_to_have: must.length || nice.length ? nice : base.nice_to_have,
    responsibilities: (responsibilities.length ? responsibilities.slice(0, 5) : base.responsibilities).map((r) => r.slice(0, 220)),
    priorities,
    deadline,
    source: 'ai',
    model: model ? model.slice(0, 120) : null,
    notes: notes.slice(0, 6),
  };
  // Whatever comes out must be saveable as-is; otherwise use the plain reading.
  if (!jobAnalysisSchema.safeParse(merged).success) {
    return { ...base, notes: [...base.notes, 'The AI reply could not be used, so this is a plain keyword reading of the job description.'].slice(0, 6) };
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* The candidate's fit                                                 */
/* ------------------------------------------------------------------ */

export interface FitCandidate {
  skills: readonly string[];
  projects: readonly { name: string; description?: string; technologies?: readonly string[] }[];
  experience: readonly { technologies?: readonly string[]; start?: string | null; end?: string | null; current?: boolean }[];
}

function monthsOfExperience(exp: FitCandidate['experience'], now = new Date()): number {
  let months = 0;
  for (const e of exp) {
    if (!e.start) continue;
    const [sy, sm] = e.start.split('-').map(Number);
    const endStr = e.current || !e.end ? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}` : e.end;
    const [ey, em] = endStr.split('-').map(Number);
    if (sy && sm && ey && em) months += Math.max(0, (ey - sy) * 12 + (em - sm));
  }
  return months;
}

/**
 * Counting, not guessing: which of the job's skills the candidate has listed, and what that
 * means. Only listed skills and technologies count; a project description that says
 * "planning to learn Kubernetes" doesn't make Kubernetes a skill.
 */
export function computeJobFit(c: FitCandidate, a: JobAnalysis, now = new Date()): JobFit {
  const projectTech = c.projects.flatMap((p) => p.technologies ?? []);
  const expTech = c.experience.flatMap((e) => e.technologies ?? []);
  const have = withImplied(canonicalSkillSet([...c.skills, ...projectTech, ...expTech]));
  const has = (s: string) => skillAlternatives(s).some((p) => have.has(canonicalSkill(p).toLowerCase()));
  const matched_must = a.must_have.filter(has);
  const missing_must = a.must_have.filter((s) => !has(s));
  const matched_nice = a.nice_to_have.filter(has);
  const skills_in_common = [
    ...new Set(
      [...a.must_have, ...a.nice_to_have].flatMap((s) => skillAlternatives(s).filter((p) => have.has(canonicalSkill(p).toLowerCase())).map(canonicalSkill)),
    ),
  ];

  const wanted = canonicalSkillSet([...a.must_have, ...a.nice_to_have].flatMap(skillAlternatives));
  const projects = c.projects
    .map((p) => {
      const tech = withImplied(canonicalSkillSet(p.technologies ?? []));
      const matched = [...a.must_have, ...a.nice_to_have]
        .filter((s, i, arr) => arr.indexOf(s) === i)
        .flatMap((s) => skillAlternatives(s).filter((part) => tech.has(canonicalSkill(part).toLowerCase())).slice(0, 1).map(canonicalSkill));
      return { name: p.name, matched };
    })
    .filter((p) => p.matched.length > 0 && wanted.size > 0)
    .sort((x, y) => y.matched.length - x.matched.length)
    .slice(0, 2);

  const warnings: string[] = [];
  const months = monthsOfExperience(c.experience, now);
  if (a.seniority === 'senior') warnings.push('This reads as a senior role.');
  const minYears = a.experience.min_years;
  if (minYears !== null && minYears >= 1 && months < minYears * 12) {
    warnings.push(`Asks for ${minYears}+ year${minYears === 1 ? '' : 's'} of experience; your profile lists ${months >= 12 ? `about ${Math.floor(months / 12)} year${months >= 24 ? 's' : ''}` : months > 0 ? `${months} month${months === 1 ? '' : 's'}` : 'none yet'}.`);
  }
  if (a.must_have.length >= 3 && missing_must.length > a.must_have.length / 2) {
    warnings.push(`You haven't listed most of the must-have skills (missing ${missing_must.slice(0, 4).join(', ')}${missing_must.length > 4 ? '…' : ''}).`);
  }

  const ratio = a.must_have.length ? matched_must.length / a.must_have.length : 0.5;
  const experienceGap = minYears !== null && minYears >= 2 && months < minYears * 12;
  let verdict: FitVerdict;
  if (a.seniority === 'senior' || (minYears !== null && minYears >= 4 && months < 24)) verdict = 'long_shot';
  else if (ratio >= 0.75 && !experienceGap) verdict = 'strong';
  else if (ratio >= 0.5 && !experienceGap) verdict = 'good';
  else if (ratio >= 0.25 || experienceGap) verdict = 'stretch';
  else verdict = 'long_shot';

  const summary = a.must_have.length
    ? `You have ${matched_must.length} of ${a.must_have.length} must-have skill${a.must_have.length === 1 ? '' : 's'}${a.nice_to_have.length ? ` and ${matched_nice.length} of ${a.nice_to_have.length} nice-to-haves` : ''}.`
    : 'The job description doesn’t list specific skills, so this is based on the role and experience only.';

  return { verdict, summary, matched_must, missing_must, matched_nice, skills_in_common, projects, warnings };
}

/* ------------------------------------------------------------------ */
/* Pasted recruiter contacts                                           */
/* ------------------------------------------------------------------ */

export interface PastedContact {
  email: string;
  full_name: string | null;
  title: string | null;
}

export interface PastedContacts {
  contacts: PastedContact[];
  /** Lines that had something in them but no usable email address. */
  skipped: string[];
}

/**
 * Addresses exactly as pasted: a line is cut at spaces and punctuation that can't be part of
 * an address, and only pieces that are valid addresses in full are used. Part of a longer
 * string ("joe!bob@x.com") is never taken as an address.
 */
function emailsIn(line: string): { emails: string[]; rejected: string[] } {
  const emails: string[] = [];
  const rejected: string[] = [];
  for (const raw of line.split(/[\s<>()[\],;"|]+/)) {
    const piece = raw.replace(/^mailto:/i, '').replace(/^['`]+|['`.:]+$/g, '');
    if (!piece.includes('@')) continue;
    if (isValidEmail(piece)) emails.push(piece);
    else rejected.push(piece);
  }
  return { emails, rejected };
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delim && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Words that mark a team or a role, not a person ("Talent Acquisition", "HR Team"). */
const NOT_A_PERSON = /\b(talent|acquisition|recruit\w*|hiring|careers?|jobs?|team|hr|human|resources|people|office|admin|support|info|contact|campus|university|department)\b/i;
const looksLikeName = (s: string) => /^[\p{L}][\p{L}'.\- ]{0,58}[\p{L}.]$/u.test(s) && s.split(/\s+/).length <= 5 && !NOT_A_PERSON.test(s);

/**
 * Accepts what people actually paste: a CSV with an "email" column, lines like
 * "Priya Nair <priya@contoso.com>", "Priya Nair, Talent Partner, priya@contoso.com",
 * "Priya Nair - priya@contoso.com", or plain addresses separated by commas or new lines.
 */
export function parseContactsPaste(text: string): PastedContacts {
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  const first = rows.find((r) => r.trim()) ?? '';
  const contacts: PastedContact[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  const add = (email: string, full_name: string | null, title: string | null) => {
    const e = email.trim().replace(/^mailto:/i, '');
    if (!isValidEmail(e)) return false;
    const key = normalizeEmail(e);
    if (seen.has(key)) return true;
    seen.add(key);
    contacts.push({ email: e, full_name: full_name ? full_name.slice(0, 120) : null, title: title ? title.slice(0, 160) : null });
    return true;
  };

  const delim = first.includes('\t') ? '\t' : ',';
  const header = splitCsvLine(first, delim).map((h) => h.toLowerCase().replace(/[_-]+/g, ' ').trim());
  const emailCol = header.findIndex((h) => ['email', 'email address', 'e mail', 'work email', 'mail'].includes(h));
  if (emailCol >= 0) {
    const col = (names: string[]) => header.findIndex((h) => names.includes(h));
    const nameCol = col(['name', 'full name', 'hr name', 'recruiter', 'recruiter name', 'contact name']);
    const firstCol = col(['first name', 'firstname', 'first']);
    const lastCol = col(['last name', 'lastname', 'surname', 'last']);
    const titleCol = col(['title', 'job title', 'position', 'designation', 'role']);
    for (const row of rows.slice(rows.indexOf(first) + 1)) {
      if (!row.trim()) continue;
      const cells = splitCsvLine(row, delim);
      const name = nameCol >= 0 ? cells[nameCol] : [firstCol >= 0 ? cells[firstCol] : '', lastCol >= 0 ? cells[lastCol] : ''].filter(Boolean).join(' ');
      if (!add(cells[emailCol] ?? '', name?.trim() || null, titleCol >= 0 ? cells[titleCol]?.trim() || null : null)) skipped.push(row.trim().slice(0, 200));
    }
    return { contacts, skipped };
  }

  for (const row of rows) {
    const line = row.trim();
    if (!line) continue;
    const { emails, rejected } = emailsIn(line);
    if (!emails.length || rejected.length) {
      // Anything that looks like an address but isn't a valid one: skip the whole line rather than guess.
      skipped.push(line.slice(0, 200));
      continue;
    }
    if (emails.length > 1) {
      for (const e of emails) if (!add(e, null, null)) skipped.push(e);
      continue;
    }
    const rest = line
      .replace(emails[0]!, ' ')
      .replace(/mailto:/gi, ' ')
      .replace(/[<>()[\]"]/g, ' ')
      .split(/\s+[|–—-]\s+|[,;\t|]/)
      .map((p) => squash(p))
      .filter(Boolean);
    let name: string | null = null;
    let title: string | null = null;
    if (rest[0] && looksLikeName(rest[0])) {
      name = rest[0];
      title = rest[1] ?? null;
    } else if (rest[0]) {
      title = rest[0];
    }
    if (!add(emails[0]!, name, title)) skipped.push(line.slice(0, 200));
  }
  return { contacts, skipped };
}
