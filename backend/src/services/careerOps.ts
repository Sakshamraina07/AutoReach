/**
 * Bridge to a career-ops folder on the same computer (github.com/santifer/career-ops,
 * MIT). career-ops finds and scores jobs and writes one report per evaluation; this
 * module reads those reports so the best ones can become AutoReach jobs in one click.
 *
 * It only ever reads `reports/`, `jds/` and `data/applications.md` inside the folder
 * (plus writes `cv.md` once, on request, if it doesn't exist). File names come from
 * directory listings filtered by career-ops' own naming rules, never from requests.
 *
 * The job-description checks below follow career-ops' own `check-jd-archive.mjs`
 * (MIT): a report's "## Job Description" section counts only when it is the posting's
 * text, not a placeholder, a pointer to another file, a sign-in wall or a paraphrase.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { extractText } from 'unpdf';
import { jobSaveSchema, type CareerOpsJob, type CareerOpsOverview, type JobView, type Profile } from '@autoreach/shared';
import type { AppConfig } from '../config.js';
import type { Deps } from '../context.js';
import { AppError, notFound, unprocessable } from '../errors.js';
import { fetchJobFromBoard, jobBoardTarget } from './jobFetch.js';
import { analyzeJob, getJob, saveJob } from './jobs.js';

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

/** The caller as the career-ops checks see it: the signed-in email and the connection's own address. */
export interface CareerOpsCaller {
  email: string | null | undefined;
  /** req.socket.remoteAddress: the TCP peer, which a forwarded-for header can't change. */
  remoteAddress: string | null | undefined;
}

const isLoopback = (a: string | null | undefined) => !!a && (a === '::1' || /^(?:::ffff:)?127\./.test(a));

/**
 * Whether this caller may read the configured career-ops folder. Outside production the
 * API is a program on your own computer, so the folder is only served to requests from
 * this computer: another device on the same Wi-Fi can't read it, even with a
 * development sign-in. With an owner email set, only that account may read it.
 */
export function careerOpsAllowed(config: AppConfig, caller: CareerOpsCaller): boolean {
  const { dir, ownerEmail } = config.careerOps;
  if (!dir) return false;
  if (!config.isProd && !isLoopback(caller.remoteAddress)) return false;
  if (!ownerEmail) return !config.isProd;
  return !!caller.email && caller.email.toLowerCase() === ownerEmail;
}

function requireAccess(deps: Deps, caller: CareerOpsCaller): string {
  if (!deps.config.careerOps.dir) throw new AppError(404, 'CAREER_OPS_NOT_CONFIGURED', 'career-ops is not connected. Set CAREER_OPS_DIR in backend/.env to your career-ops folder.');
  if (!careerOpsAllowed(deps.config, caller)) {
    throw new AppError(403, 'CAREER_OPS_NOT_YOURS', 'The career-ops folder on this server is only available to its owner, on the computer it is on.');
  }
  return deps.config.careerOps.dir;
}

/** career-ops can keep its data elsewhere: a `.career-ops-data` file in the folder names that place. */
async function dataRoot(dir: string): Promise<string> {
  try {
    // career-ops trims the whole file (getCareerOpsRoot); a leading blank line is not a different folder.
    const marker = (await fs.readFile(path.join(dir, '.career-ops-data'), 'utf8')).replace(/^\uFEFF/, '').trim();
    if (marker) return path.resolve(dir, marker);
  } catch {
    /* no marker: data lives in the folder itself */
  }
  return dir;
}

async function folderExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Reading reports                                                     */
/* ------------------------------------------------------------------ */

/** reports/{###}-{company-slug}-{YYYY-MM-DD}.md — the slug may contain hyphens. */
const REPORT_FILE = /^(\d+)-(.+)-(\d{4}-\d{2}-\d{2})\.md$/;
const MAX_REPORTS = 300;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface ParsedReport {
  company: string | null;
  role: string | null;
  score: number | null;
  legitimacy: string | null;
  date: string | null;
  url: string | null;
}

const clean = (s: string | undefined | null) => {
  const v = s?.replace(/<!--[\s\S]*?-->/g, '').replace(/[*_`]/g, '').trim();
  return v ? v.slice(0, 200) : null;
};

/** Labels career-ops' language modes use for the same header fields. */
const LABELS = {
  score: ['Score', 'Puntuación', 'Puntuacion', 'Pontuação', 'Punteggio', 'Note', 'Wertung', 'Ocena'],
  url: ['URL', 'Link', 'Enlace'],
  date: ['Date', 'Fecha', 'Datum', 'Data', 'Dato', 'Datos'],
  legitimacy: ['Legitimacy', 'Legitimidad', 'Legitimidade', 'Legitimität', 'Légitimité', 'Legittimità', 'Legitimitet', 'Wiarygodność'],
};

/**
 * The header career-ops writes at the top of every evaluation report:
 * `# Evaluation: {Company} — {Role}` (or the same in another language), then
 * `**Score:** 4.2/5`, `**URL:** …`, `**Date:** …`.
 */
export function parseReportHeader(raw: string): ParsedReport {
  const content = raw.replace(/^\uFEFF/, '');
  // The first level-1 heading with a colon is the title. Split on the em dash first:
  // company names can contain a plain hyphen ("Foo - Bar Labs — Engineer").
  const h1 = content.match(/^#\s+[^\n:]{2,40}?\s*:\s*(.+?)\s*$/m)?.[1] ?? '';
  let company: string | undefined;
  let role: string | undefined;
  for (const sep of [/\s+—\s+/, /\s+–\s+/, /\s+--\s+/, /\s+-\s+/]) {
    const at = h1.search(sep);
    if (at !== -1) {
      company = h1.slice(0, at);
      role = h1.slice(at).replace(sep, '');
      break;
    }
  }
  const field = (names: string[]) =>
    content.match(new RegExp(`^\\*\\*(?:${names.join('|')})\\s*:\\*\\*[ \\t]*(.*)$`, 'mi'))?.[1] ??
    content.match(new RegExp(`^\\*\\*(?:${names.join('|')})\\*\\*\\s*:[ \\t]*(.*)$`, 'mi'))?.[1];
  const scoreRaw = field(LABELS.score)?.match(/(\d+(?:[.,]\d+)?)/)?.[1]?.replace(',', '.');
  const score = scoreRaw !== undefined ? Number(scoreRaw) : NaN;
  const url = field(LABELS.url)?.trim().split(/\s+/)[0];
  const date = field(LABELS.date)?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  return {
    company: clean(company),
    role: clean(role),
    score: Number.isFinite(score) && score >= 0 && score <= 5 ? score : null,
    legitimacy: clean(field(LABELS.legitimacy)),
    date,
    url: url && /^https?:\/\/\S+$/i.test(url) ? url.slice(0, 2048) : null,
  };
}

/** Reports written by career-ops' Gemini/OpenRouter scripts carry a `**Tool:**` line: their sections are model-written. */
export function writtenByScript(content: string): boolean {
  return /^\*\*Tool:\*\*/m.test(content);
}

const JD_HEADING = /^##\s+Job Description\b.*$/im;
const NEXT_SECTION =
  /^##\s+(?:Machine Summary|Keywords extracted|[A-Z]\)|Block\s[A-Z]\b|Risk Summary|Cover Letter Draft|Post-evaluation|Liveness gate|Blacklist gate|Bounded Research Budget|Step 0\b)/im;
const PLACEHOLDER = "(the posting's full text, pasted verbatim — see requirement below)";
const POINTER = /^See\s+jds\/[^\s()]+\.(?:md|pdf)\s+for the full archive(?:\s*\(archive-posting\.mjs\s+--report=\d+\))?\.?$/i;
/** Text that is a fetch failure, not a posting (career-ops check-jd-archive.mjs, MIT). */
const NOT_A_POSTING = [
  /(sign in to view this job|join linkedin to see who you know at|please log in to continue|sign in to continue)/i,
  /(404\s*(?:error|not found)|page not found|this job posting is no longer available)/i,
  /(subscribe to continue reading|this content is for subscribers)/i,
  /(please enable javascript|this site requires javascript|<noscript)/i,
  /(checking your browser before accessing|verify(?:ing)? (?:that )?you are (?:a )?human|please stand by,? while we (?:are )?check(?:ing)? your browser|cloudflare ray id|captcha verification required to continue)/i,
];
/** The evaluator saying the section is its own wording, not the posting (career-ops check-jd-archive.mjs, MIT, verbatim). */
const PARAPHRASE =
  /(\(paraphras(?:e|ed)\b[^)\n]*\)\s*(?::|$)|\b(?:what follows|the following|(?:the )?(?:text|passages?|content) below|this(?: (?:description|section|posting|text|summary|document))?) (?:is|are) (?:a |an )?(?:(?:close|detailed|faithful|complete|non-fabricated|full|accurate)[ ,]+)*(?:paraphrase|paraphrased|restatement|restated)\b|\bthis section restates\b|\bthis (?:description|section|posting|text|summary|document) (?:was|has been|is) (?:paraphrased|restated)\b|^[\s*_>#-]*(?:paraphrased|restated) (?:from|version)\b|[—–-]\s*paraphras(?:e|ed)\s*$|\b(?:what follows|the following|(?:the )?(?:text|passages?|content) below|this (?:is|description|section|posting|text|summary|document))[^.\n]{0,60}?\bnot (?:a |the )?(?:literal|verbatim) (?:copy|quote|text|reproduction|archive|posting)\b|\bparaphrase,? not (?:a |the )?(?:literal|verbatim)\b|\b(?:tool|fetcher|evaluator|scraper)\b[^.\n]{0,30}?\b(?:could|would|did|can) ?not (?:be )?(?:reproduc|quot|return|captur|copi)\w*[^.\n]{0,40}\b(?:literal|verbatim)\b)/im;

function isPostingText(text: string): boolean {
  // The same minimum as a pasted description (jobSaveSchema): shorter is a stub, not a posting.
  if (text.trim().length < 80) return false;
  if (text.trim() === PLACEHOLDER) return false;
  if (POINTER.test(text.replace(/^Posted:.*$/im, '').trim())) return false;
  return !NOT_A_POSTING.some((re) => re.test(text)) && !PARAPHRASE.test(text);
}

/** The job description a report archived, when it really is the posting's own text. */
export function jobDescriptionFromReport(raw: string): string | null {
  const content = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = JD_HEADING.exec(content);
  if (!m) return null;
  // The heading is written by the evaluator: any disclosure there disqualifies the section.
  if (/\b(?:not (?:a |the )?(?:literal|verbatim)|not archived|paraphras|restat|summary|summarised|summarized)/i.test(m[0])) return null;
  if (NOT_A_POSTING.some((re) => re.test(m[0])) || PARAPHRASE.test(m[0])) return null;
  const rest = content.slice(m.index + m[0].length);
  const end = rest.search(NEXT_SECTION);
  let section = end === -1 ? rest : rest.slice(0, end);
  let prev;
  do {
    prev = section;
    section = section.replace(/<!--[\s\S]*?-->/g, '');
  } while (section !== prev);
  section = section.trim();
  return isPostingText(section) ? section.slice(0, 30_000) : null;
}

/**
 * Is `filename` a jds/ capture of this report? The number must match and so must the
 * company: `{NNN}-{YYYY-MM-DD}_{company}_{role}.pdf` (archive-posting.mjs) or
 * `{NNN}-{company}-{role}.{ext}`. A number alone can belong to another posting
 * (career-ops jd-capture.mjs, MIT).
 */
export function captureBelongsTo(filename: string, reportNumber: number, companySlug: string): boolean {
  const m = /^(\d+)-/.exec(filename);
  if (!m || Number(m[1]) !== reportNumber || !/\.(md|txt|pdf)$/i.test(filename)) return false;
  const rest = filename.replace(/^\d+-/, '').replace(/^\d{4}-\d{2}-\d{2}[_-]/, '').toLowerCase();
  const slug = companySlug.toLowerCase();
  if (!slug || !rest.startsWith(slug)) return false;
  const next = rest.charAt(slug.length);
  return next === '' || next === '-' || next === '_' || next === '.';
}

/** A jds/ capture for this report, as text. */
async function jobDescriptionFromCapture(root: string, reportNumber: number, companySlug: string): Promise<string | null> {
  let names: string[];
  try {
    names = await fs.readdir(path.join(root, 'jds'));
  } catch {
    return null;
  }
  const mine = names
    .filter((n) => captureBelongsTo(n, reportNumber, companySlug))
    // Text captures first: they are the posting as written; PDFs need extracting.
    .sort((a, b) => Number(/\.pdf$/i.test(a)) - Number(/\.pdf$/i.test(b)));
  for (const name of mine) {
    const file = path.join(root, 'jds', name);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) continue;
      let text: string;
      if (/\.pdf$/i.test(name)) {
        text = (await extractText(new Uint8Array(await fs.readFile(file)), { mergePages: true })).text;
      } else {
        text = await fs.readFile(file, 'utf8');
      }
      text = text.replace(/\r\n?/g, '\n').trim();
      if (isPostingText(text)) return text.slice(0, 30_000);
    } catch {
      /* unreadable capture: try the next one */
    }
  }
  return null;
}

/** Status per report number from career-ops' tracker (data/applications.md), matched by the report links in each row. */
export function trackerStatuses(markdown: string): Map<number, string> {
  const out = new Map<number, string>();
  let statusCol = -1;
  let reportCol = -1;
  for (const line of markdown.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) {
      statusCol = -1; // a table ended: the next one needs its own header
      continue;
    }
    const cells = line.split('|').map((c) => c.trim());
    if (statusCol === -1) {
      const lower = cells.map((c) => c.toLowerCase());
      const s = lower.findIndex((c) => c === 'status' || c === 'estado');
      const r = lower.findIndex((c) => c === 'report' || c === 'informe');
      // The tracker's header names Status and Report (and the company): a lone "Status" cell elsewhere is not it.
      if (s !== -1 && r !== -1 && lower.some((c) => c === 'company' || c === 'empresa')) {
        statusCol = s;
        reportCol = r;
      }
      continue;
    }
    if (/^[-:\s|]+$/.test(line)) continue;
    const status = cells[statusCol]?.replace(/[*_`]/g, '').trim();
    if (!status) continue;
    for (const m of (cells[reportCol] ?? '').matchAll(/reports\/(\d+)-/g)) out.set(Number(m[1]), status.slice(0, 60));
  }
  return out;
}

interface ReportFile {
  number: number;
  name: string;
  /** The company slug in the file name, which names its jds/ captures too. */
  slug: string;
  content: string;
}

async function readReports(root: string): Promise<{ files: ReportFile[]; unreadable: string[] }> {
  let names: string[];
  try {
    names = await fs.readdir(path.join(root, 'reports'));
  } catch {
    throw unprocessable('CAREER_OPS_NO_REPORTS', `No reports folder in ${root}. Check that CAREER_OPS_DIR points at your career-ops folder.`);
  }
  const candidates = names
    .map((name) => ({ name, m: REPORT_FILE.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => !!x.m)
    .map((x) => ({ name: x.name, number: Number(x.m[1]), slug: x.m[2]! }))
    .sort((a, b) => b.number - a.number)
    .slice(0, MAX_REPORTS);
  const files: ReportFile[] = [];
  const unreadable: string[] = [];
  for (const c of candidates) {
    try {
      const file = path.join(root, 'reports', c.name);
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        unreadable.push(c.name);
        continue;
      }
      files.push({ ...c, content: (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') });
    } catch {
      unreadable.push(c.name);
    }
  }
  return { files, unreadable };
}

async function linkedOpportunities(deps: Deps, userId: string): Promise<{ byUrl: Map<string, string>; byReport: Map<number, string> }> {
  const rows = await deps.db.withUser(userId, (tx) =>
    tx.many<{ id: string; job_url: string | null; career_ops_report: number | null }>(
      `SELECT id, job_url, career_ops_report FROM opportunities
       WHERE user_id = $1 AND (job_url IS NOT NULL OR career_ops_report IS NOT NULL) ORDER BY created_at DESC`,
      [userId],
    ),
  );
  const byUrl = new Map<string, string>();
  const byReport = new Map<number, string>();
  for (const r of rows) {
    if (r.job_url && !byUrl.has(r.job_url)) byUrl.set(r.job_url, r.id);
    if (r.career_ops_report !== null && !byReport.has(r.career_ops_report)) byReport.set(r.career_ops_report, r.id);
  }
  return { byUrl, byReport };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export async function careerOpsOverview(deps: Deps, userId: string, caller: CareerOpsCaller): Promise<CareerOpsOverview> {
  const dir = requireAccess(deps, caller);
  if (!(await folderExists(dir))) throw unprocessable('CAREER_OPS_DIR_MISSING', `The folder ${dir} doesn't exist on this computer. Check CAREER_OPS_DIR in backend/.env.`);
  const root = await dataRoot(dir);
  const { files, unreadable } = await readReports(root);
  let statuses = new Map<number, string>();
  try {
    statuses = trackerStatuses(await fs.readFile(path.join(root, 'data', 'applications.md'), 'utf8'));
  } catch {
    /* no tracker yet */
  }
  const linked = await linkedOpportunities(deps, userId);
  const jobs: CareerOpsJob[] = [];
  for (const f of files) {
    const h = parseReportHeader(f.content);
    const description = (await descriptionSources(root, f, h))[0]?.kind ?? 'none';
    jobs.push({
      report_number: f.number,
      report_file: f.name,
      ...h,
      status: statuses.get(f.number) ?? null,
      description,
      opportunity_id: linked.byReport.get(f.number) ?? (h.url ? linked.byUrl.get(h.url) ?? null : null),
    });
  }
  return { jobs, unreadable, cv_exists: await fileExists(path.join(root, 'cv.md')) };
}

async function hasCapture(root: string, f: ReportFile): Promise<boolean> {
  try {
    return (await fs.readdir(path.join(root, 'jds'))).some((n) => captureBelongsTo(n, f.number, f.slug));
  } catch {
    return false;
  }
}

type Source = { kind: Exclude<CareerOpsJob['description'], 'none'>; read: () => Promise<string | null> };

/**
 * Where a report's description can come from, best first:
 * 1. the posting's own job board (Greenhouse, Lever, Ashby), the most faithful copy;
 * 2. a jds/ capture career-ops saved for this report;
 * 3. the report's "Job Description" section, unless a script wrote the report, because
 *    then the section is the model's retyping of the posting, not the posting.
 */
async function descriptionSources(root: string, f: ReportFile, h: ParsedReport): Promise<Source[]> {
  const out: Source[] = [];
  if (h.url && jobBoardTarget(h.url)) out.push({ kind: 'link', read: async () => null }); // read over the network at import
  if (await hasCapture(root, f)) out.push({ kind: 'saved', read: () => jobDescriptionFromCapture(root, f.number, f.slug) });
  if (!writtenByScript(f.content) && jobDescriptionFromReport(f.content)) out.push({ kind: 'report', read: async () => jobDescriptionFromReport(f.content) });
  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * Turn one career-ops evaluation into an AutoReach job: the description from the
 * report (or its saved capture, or the posting's job board), read and checked the
 * same way as a pasted one, with career-ops' company and role.
 */
export async function importCareerOpsJob(deps: Deps, userId: string, caller: CareerOpsCaller, reportNumber: number): Promise<JobView> {
  const dir = requireAccess(deps, caller);
  const root = await dataRoot(dir);
  const { files } = await readReports(root);
  const file = files.find((f) => f.number === reportNumber);
  if (!file) throw notFound('career-ops report');
  const header = parseReportHeader(file.content);

  let text: string | null = null;
  for (const source of await descriptionSources(root, file, header)) {
    text = source.kind === 'link' ? ((await fetchJobFromBoard(deps.fetch, header.url!))?.text ?? null) : await source.read();
    if (text && text.trim().length >= 80) break;
    text = null;
  }
  if (!text) {
    throw unprocessable(
      'CAREER_OPS_NO_DESCRIPTION',
      header.url
        ? "career-ops didn't save this job's description and its job board couldn't be read. Open the posting, copy the description, and paste it into New job."
        : "career-ops didn't save this job's description or a link to it. Paste the description into New job.",
      { url: header.url },
    );
  }
  text = text.slice(0, 30_000);

  const linked = await linkedOpportunities(deps, userId);
  const existing = linked.byReport.get(reportNumber) ?? (header.url ? linked.byUrl.get(header.url) : undefined);

  const { analysis } = await analyzeJob(deps, userId, { text });
  const company = header.company ?? analysis.company;
  const title = header.role ?? analysis.title;
  if (!company || !title) throw unprocessable('CAREER_OPS_MISSING_NAME', 'The report names no company or role. Paste the description into New job instead.');
  const parsed = jobSaveSchema.safeParse({
    text,
    url: header.url,
    analysis: { ...analysis, company: company.slice(0, 160), title: title.slice(0, 200) },
    opportunity_id: existing ?? null,
  });
  if (!parsed.success) {
    throw unprocessable('CAREER_OPS_UNREADABLE', "This report couldn't be turned into a job. Paste the description into New job instead.", { url: header.url });
  }
  const req = parsed.data;
  return deps.db.withUser(userId, async (tx) => {
    // Serialise imports of the same report (double click) on the user's settings row.
    await tx.query(`SELECT 1 FROM user_settings WHERE user_id = $1 FOR UPDATE`, [userId]);
    const again = await tx.maybeOne<{ id: string }>(`SELECT id FROM opportunities WHERE user_id = $1 AND career_ops_report = $2`, [userId, reportNumber]);
    // The lookup made under the lock wins over the one made before it.
    const view = await saveJob(deps, tx, userId, { ...req, opportunity_id: again?.id ?? req.opportunity_id ?? null });
    await tx.query(`UPDATE opportunities SET career_ops_report = $3, career_ops_score = $4 WHERE user_id = $1 AND id = $2`, [userId, view.opportunity.id, reportNumber, header.score]);
    return getJob(deps, tx, userId, view.opportunity.id);
  });
}

/* ------------------------------------------------------------------ */
/* cv.md from the AutoReach profile                                    */
/* ------------------------------------------------------------------ */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** career-ops reads the CV from cv.md (markdown). Built only from what the profile says. */
export function profileToCvMarkdown(p: Profile): string {
  const out: string[] = [`# ${p.full_name}`, ''];
  const contact = [
    p.primary_email,
    p.phone,
    p.current_location,
    p.links?.linkedin ? `[LinkedIn](${p.links.linkedin})` : null,
    p.links?.github ? `[GitHub](${p.links.github})` : null,
    p.links?.portfolio ? `[Portfolio](${p.links.portfolio})` : null,
  ].filter(Boolean);
  if (contact.length) out.push(contact.join(' | '), '');
  if (p.target_roles.length) out.push(`**Looking for:** ${p.target_roles.join(', ')}`, '');

  if (p.degree || p.university) {
    out.push('## Education', '');
    const grad = [p.graduation_month ? MONTHS[p.graduation_month - 1] : null, p.graduation_year].filter(Boolean).join(' ');
    out.push(`- ${[p.degree && `${p.degree}${p.specialization ? ` (${p.specialization})` : ''}`, p.university, grad && `graduating ${grad}`].filter(Boolean).join(', ')}`, '');
  }
  if (p.skills.length) out.push('## Skills', '', p.skills.join(', '), '');
  if (p.experience.length) {
    out.push('## Experience', '');
    for (const e of p.experience) {
      const when = [e.start, e.current ? 'present' : e.end].filter(Boolean).join(' – ');
      out.push(`### ${e.title}, ${e.organization}${when ? ` (${when})` : ''}`, '');
      if (e.description) out.push(e.description, '');
      for (const a of e.achievements ?? []) out.push(`- ${a}`);
      if (e.achievements?.length) out.push('');
      if (e.technologies?.length) out.push(`Technologies: ${e.technologies.join(', ')}`, '');
    }
  }
  if (p.projects.length) {
    out.push('## Projects', '');
    for (const pr of p.projects) {
      out.push(`### ${pr.name}${pr.url ? ` ([link](${pr.url}))` : ''}`, '');
      if (pr.description) out.push(pr.description, '');
      for (const a of pr.achievements ?? []) out.push(`- ${a}`);
      if (pr.achievements?.length) out.push('');
      if (pr.technologies?.length) out.push(`Technologies: ${pr.technologies.join(', ')}`, '');
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** Write cv.md into the career-ops folder. Never replaces one that exists. */
export async function writeCareerOpsCv(deps: Deps, caller: CareerOpsCaller, markdown: string): Promise<{ path: string }> {
  const root = await dataRoot(requireAccess(deps, caller));
  if (!(await folderExists(root))) throw unprocessable('CAREER_OPS_DIR_MISSING', `The folder ${root} doesn't exist on this computer.`);
  const target = path.join(root, 'cv.md');
  try {
    await fs.writeFile(target, markdown, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new AppError(409, 'CAREER_OPS_CV_EXISTS', 'career-ops already has a cv.md. AutoReach never replaces it; download the new one and compare.');
    throw err;
  }
  return { path: target };
}
