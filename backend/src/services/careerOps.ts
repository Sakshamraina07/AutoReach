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

/** Whether this signed-in user may read the configured career-ops folder. */
export function careerOpsAllowed(config: AppConfig, email: string | null | undefined): boolean {
  const { dir, ownerEmail } = config.careerOps;
  if (!dir) return false;
  if (!ownerEmail) return !config.isProd;
  return !!email && email.toLowerCase() === ownerEmail;
}

function requireAccess(deps: Deps, email: string | null | undefined): string {
  if (!deps.config.careerOps.dir) throw new AppError(404, 'CAREER_OPS_NOT_CONFIGURED', 'career-ops is not connected. Set CAREER_OPS_DIR in backend/.env to your career-ops folder.');
  if (!careerOpsAllowed(deps.config, email)) throw new AppError(403, 'CAREER_OPS_NOT_YOURS', 'The career-ops folder on this server belongs to another account.');
  return deps.config.careerOps.dir;
}

/** career-ops can keep its data elsewhere: a `.career-ops-data` file in the folder names that place. */
async function dataRoot(dir: string): Promise<string> {
  try {
    const marker = (await fs.readFile(path.join(dir, '.career-ops-data'), 'utf8')).split(/\r?\n/)[0]?.trim();
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

/** The header career-ops writes at the top of every evaluation report. */
export function parseReportHeader(content: string): ParsedReport {
  const title = content.match(/^#\s*Evaluation:\s*(.+?)\s+(?:—|–|--|-)\s+(.+?)\s*$/m);
  const field = (name: string) => content.match(new RegExp(`^\\*\\*${name}:\\*\\*[ \\t]*(.*)$`, 'm'))?.[1];
  const scoreRaw = field('Score')?.match(/(\d+(?:\.\d+)?)/)?.[1];
  const score = scoreRaw !== undefined ? Number(scoreRaw) : NaN;
  const url = field('URL')?.trim().split(/\s+/)[0];
  const date = field('Date')?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  return {
    company: clean(title?.[1]),
    role: clean(title?.[2]),
    score: Number.isFinite(score) && score >= 0 && score <= 5 ? score : null,
    legitimacy: clean(field('Legitimacy')),
    date,
    url: url && /^https?:\/\/\S+$/i.test(url) ? url.slice(0, 2048) : null,
  };
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
/** The evaluator saying the section is its own wording, not the posting. */
const PARAPHRASE =
  /(\(paraphras(?:e|ed)\b[^)\n]*\)\s*(?::|$)|\b(?:what follows|the following|(?:the )?(?:text|passages?|content) below|this(?: (?:description|section|posting|text|summary|document))?) (?:is|are) (?:a |an )?(?:(?:close|detailed|faithful|complete|non-fabricated|full|accurate)[ ,]+)*(?:paraphrase|paraphrased|restatement|restated)\b|\bthis section restates\b|\bthis (?:description|section|posting|text|summary|document) (?:was|has been|is) (?:paraphrased|restated)\b|^[\s*_>#-]*(?:paraphrased|restated) (?:from|version)\b|[—–-]\s*paraphras(?:e|ed)\s*$|\bparaphrase,? not (?:a |the )?(?:literal|verbatim)\b)/im;

function isPostingText(text: string): boolean {
  if (text.replace(/\s+/g, '').length < 40) return false;
  if (text.trim() === PLACEHOLDER) return false;
  if (POINTER.test(text.replace(/^Posted:.*$/im, '').trim())) return false;
  return !NOT_A_POSTING.some((re) => re.test(text)) && !PARAPHRASE.test(text);
}

/** The job description a report archived, when it really is the posting's own text. */
export function jobDescriptionFromReport(content: string): string | null {
  const m = JD_HEADING.exec(content);
  if (!m) return null;
  if (/\b(?:not (?:a |the )?(?:literal|verbatim)|not archived|paraphras|restat)/i.test(m[0])) return null;
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

/** A jds/ capture for this report number ({###}-… or {#}-…), as text. */
async function jobDescriptionFromCapture(root: string, reportNumber: number): Promise<string | null> {
  let names: string[];
  try {
    names = await fs.readdir(path.join(root, 'jds'));
  } catch {
    return null;
  }
  const mine = names
    .filter((n) => {
      const m = /^(\d+)-/.exec(n);
      return m && Number(m[1]) === reportNumber && /\.(md|txt|pdf)$/i.test(n);
    })
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

/** Status per report number from career-ops' tracker (data/applications.md), matched by the report link. */
export function trackerStatuses(markdown: string): Map<number, string> {
  const out = new Map<number, string>();
  let statusCol = -1;
  let reportCol = -1;
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (statusCol === -1) {
      const lower = cells.map((c) => c.toLowerCase());
      const s = lower.findIndex((c) => c === 'status' || c === 'estado');
      if (s !== -1) {
        statusCol = s;
        reportCol = lower.findIndex((c) => c === 'report' || c === 'informe');
      }
      continue;
    }
    if (/^[-:\s|]+$/.test(line)) continue;
    const linkCell = reportCol !== -1 ? cells[reportCol] ?? '' : line;
    const num = /reports\/(\d+)-/.exec(linkCell)?.[1];
    const status = cells[statusCol]?.replace(/[*_`]/g, '').trim();
    if (num && status) out.set(Number(num), status.slice(0, 60));
  }
  return out;
}

interface ReportFile {
  number: number;
  name: string;
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
    .map((x) => ({ name: x.name, number: Number(x.m[1]) }))
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
      files.push({ ...c, content: await fs.readFile(file, 'utf8') });
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

export async function careerOpsOverview(deps: Deps, userId: string, email: string | null | undefined): Promise<CareerOpsOverview> {
  const dir = requireAccess(deps, email);
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
    let description: CareerOpsJob['description'] = 'none';
    if (jobDescriptionFromReport(f.content)) description = 'report';
    else if (await hasCapture(root, f.number)) description = 'saved';
    else if (h.url && jobBoardTarget(h.url)) description = 'link';
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

async function hasCapture(root: string, reportNumber: number): Promise<boolean> {
  try {
    return (await fs.readdir(path.join(root, 'jds'))).some((n) => {
      const m = /^(\d+)-/.exec(n);
      return !!m && Number(m[1]) === reportNumber && /\.(md|txt|pdf)$/i.test(n);
    });
  } catch {
    return false;
  }
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
export async function importCareerOpsJob(deps: Deps, userId: string, email: string | null | undefined, reportNumber: number): Promise<JobView> {
  const dir = requireAccess(deps, email);
  const root = await dataRoot(dir);
  const { files } = await readReports(root);
  const file = files.find((f) => f.number === reportNumber);
  if (!file) throw notFound('career-ops report');
  const header = parseReportHeader(file.content);

  let text = jobDescriptionFromReport(file.content) ?? (await jobDescriptionFromCapture(root, reportNumber));
  if (!text && header.url) text = (await fetchJobFromBoard(deps.fetch, header.url))?.text ?? null;
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
  const req = jobSaveSchema.parse({
    text,
    url: header.url,
    analysis: { ...analysis, company, title },
    opportunity_id: existing ?? null,
  });
  return deps.db.withUser(userId, async (tx) => {
    // Serialise imports of the same report (double click) on the user's settings row.
    await tx.query(`SELECT 1 FROM user_settings WHERE user_id = $1 FOR UPDATE`, [userId]);
    const again = await tx.maybeOne<{ id: string }>(`SELECT id FROM opportunities WHERE user_id = $1 AND career_ops_report = $2`, [userId, reportNumber]);
    const view = await saveJob(deps, tx, userId, { ...req, opportunity_id: req.opportunity_id ?? again?.id ?? null });
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
export async function writeCareerOpsCv(deps: Deps, email: string | null | undefined, markdown: string): Promise<{ path: string }> {
  const root = await dataRoot(requireAccess(deps, email));
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
