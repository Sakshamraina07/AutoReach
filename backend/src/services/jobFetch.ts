/**
 * Reads a job description from the public job-board APIs that Greenhouse, Lever and
 * Ashby publish for exactly this purpose, so a posting link can stand in for pasting
 * the text. Only those fixed API hosts are ever contacted (never the link's own host),
 * and only for links whose shape matches the board; anything else returns null and the
 * user pastes the text instead. Nothing is guessed: a miss is a miss.
 *
 *   Greenhouse  GET https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}
 *               (developers.greenhouse.io/job-board.html: no authentication for GET)
 *   Lever       GET https://api.lever.co/v0/postings/{site}/{id}   (EU: api.eu.lever.co)
 *               (github.com/lever/postings-api)
 *   Ashby       GET https://api.ashbyhq.com/posting-api/job-board/{board}
 *               (developers.ashbyhq.com/docs/public-job-posting-api), then the job
 *               whose jobUrl is this link
 */
import { fetchWithTimeout, readJson, type FetchLike } from '../lib/http.js';

export type JobBoard = 'greenhouse' | 'lever' | 'ashby';

export interface FetchedJob {
  board: JobBoard;
  title: string | null;
  location: string | null;
  text: string;
  /** The posting link the text belongs to. */
  url: string;
}

const SEGMENT = /^[A-Za-z0-9._~-]{1,120}$/;
const MAX_TEXT = 30_000;
const MIN_TEXT = 80;

type Target =
  | { board: 'greenhouse'; api: string }
  | { board: 'lever'; api: string }
  | { board: 'ashby'; api: string; jobId: string };

/** Which board a posting link belongs to, and the API URL for it. Null for anything else. */
export function jobBoardTarget(link: string): Target | null {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const parts = u.pathname.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return '\u0000';
    }
  });
  const ok = (...segs: string[]) => segs.every((s) => SEGMENT.test(s));
  const host = u.hostname.toLowerCase();

  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io' || host === 'job-boards.eu.greenhouse.io') {
    const [board, jobs, id] = parts;
    if (parts.length === 3 && jobs === 'jobs' && board && id && /^\d{1,20}$/.test(id) && ok(board)) {
      return { board: 'greenhouse', api: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${id}` };
    }
    return null;
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    const [site, id, extra] = parts;
    if (site && id && (parts.length === 2 || (parts.length === 3 && extra === 'apply')) && ok(site, id)) {
      const apiHost = host === 'jobs.eu.lever.co' ? 'api.eu.lever.co' : 'api.lever.co';
      return { board: 'lever', api: `https://${apiHost}/v0/postings/${encodeURIComponent(site)}/${encodeURIComponent(id)}` };
    }
    return null;
  }
  if (host === 'jobs.ashbyhq.com') {
    const [org, jobId, extra] = parts;
    if (org && jobId && (parts.length === 2 || (parts.length === 3 && extra === 'application')) && ok(org, jobId)) {
      return { board: 'ashby', api: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}`, jobId };
    }
    return null;
  }
  return null;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

/** Job-board HTML to readable plain text: paragraphs and list items keep their lines. */
export function htmlToText(html: string): string {
  let s = html;
  // Greenhouse returns its HTML entity-encoded ("&lt;p&gt;"): decode markup first.
  if (!/<[a-z!/]/i.test(s) && /&lt;[a-z!/]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|ul|ol|h[1-6]|tr|section|blockquote)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|ul|ol|tr|section|blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(s)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function finish(board: JobBoard, url: string, title: string | null, location: string | null, body: string): FetchedJob | null {
  const text = [title, location ? `Location: ${location}` : null, body].filter(Boolean).join('\n\n').slice(0, MAX_TEXT).trim();
  return body.replace(/\s+/g, '').length >= MIN_TEXT ? { board, title, location, text, url } : null;
}

/**
 * The posting's text from its job board's public API, or null when the link isn't a
 * supported board posting, the posting is gone, or the board doesn't answer.
 */
export async function fetchJobFromBoard(fetchImpl: FetchLike, link: string, timeoutMs = 15_000): Promise<FetchedJob | null> {
  const target = jobBoardTarget(link);
  if (!target) return null;
  let res: Response;
  try {
    res = await fetchWithTimeout(fetchImpl, target.api, { headers: { accept: 'application/json' }, redirect: 'error', timeoutMs });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = await readJson<Record<string, unknown>>(res).catch(() => null);
  if (!json || typeof json !== 'object') return null;

  if (target.board === 'greenhouse') {
    const loc = (json.location as { name?: unknown } | undefined)?.name;
    return finish('greenhouse', link, str(json.title), str(loc), htmlToText(String(json.content ?? '')));
  }
  if (target.board === 'lever') {
    const lists = Array.isArray(json.lists) ? (json.lists as { text?: unknown; content?: unknown }[]) : [];
    const body = [
      str(json.descriptionPlain) ?? htmlToText(String(json.description ?? '')),
      ...lists.map((l) => [str(l.text), htmlToText(String(l.content ?? ''))].filter(Boolean).join('\n')),
      str(json.additionalPlain) ?? htmlToText(String(json.additional ?? '')),
    ]
      .filter(Boolean)
      .join('\n\n');
    const loc = (json.categories as { location?: unknown } | undefined)?.location;
    return finish('lever', link, str(json.text), str(loc), body);
  }
  // Ashby: the board lists every job; pick the one this link points to.
  const jobs = Array.isArray(json.jobs) ? (json.jobs as Record<string, unknown>[]) : [];
  const job = jobs.find((j) => {
    if (j.id === target.jobId) return true;
    const u = str(j.jobUrl);
    if (!u) return false;
    try {
      return new URL(u).pathname.split('/').filter(Boolean).includes(target.jobId);
    } catch {
      return false;
    }
  });
  if (!job) return null;
  const body = str(job.descriptionPlain) ?? htmlToText(String(job.descriptionHtml ?? ''));
  const loc = typeof job.location === 'string' ? job.location : str((job.location as { name?: unknown } | undefined)?.name);
  return finish('ashby', link, str(job.title), loc, body);
}
