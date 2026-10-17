/**
 * Hunter.io Domain Search: the people whose work addresses Hunter has found on public
 * web pages for a company (https://hunter.io/api-documentation/v2#domain-search).
 *
 * Everything returned is a suggestion. People the user adds are saved as
 * `unverified_guess`, so the first send to each asks the user to confirm the address,
 * and Hunter's own verification status is shown as Hunter's, never as AutoReach's.
 *
 * Cost (hunter.io/pricing): 1 credit per email found; the free plan has 50 a month.
 */
import type { FoundPerson, PeopleGroup, PeopleSearch } from '@autoreach/shared';
import type { Deps } from '../context.js';
import { AppError } from '../errors.js';
import { fetchWithTimeout, readJson } from '../lib/http.js';

/** Hunter's department filter for each group. */
export const PEOPLE_GROUPS: Record<PeopleGroup, string | null> = {
  /** Recruiters, HR and people teams. */
  recruiters: 'hr',
  /** Engineering and product leads who can refer or point to the hiring manager. */
  engineering: 'it,management,executive',
  everyone: null,
};

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function hunterDomainSearchUrl(q: { company: string; domain?: string | null; group: PeopleGroup; limit: number }): string {
  const url = new URL('https://api.hunter.io/v2/domain-search');
  // Hunter: "If both are sent, domain takes precedence."
  if (q.domain) url.searchParams.set('domain', q.domain);
  else url.searchParams.set('company', q.company);
  url.searchParams.set('type', 'personal');
  url.searchParams.set('limit', String(q.limit));
  const dept = PEOPLE_GROUPS[q.group];
  if (dept) url.searchParams.set('department', dept);
  return url.toString();
}

export async function findPeopleAtCompany(
  deps: Deps,
  q: { company: string; domain?: string | null; group: PeopleGroup; limit?: number },
): Promise<PeopleSearch> {
  const key = deps.config.hunterApiKey;
  if (!key) throw new AppError(503, 'HUNTER_NOT_CONFIGURED', 'Hunter.io is not set up. Add HUNTER_API_KEY to backend/.env (a free key is at hunter.io).');
  const limit = Math.min(Math.max(q.limit ?? 10, 1), 20);
  let res: Response;
  try {
    res = await fetchWithTimeout(deps.fetch, hunterDomainSearchUrl({ ...q, limit }), { headers: { 'X-API-KEY': key, accept: 'application/json' }, timeoutMs: 20_000 });
  } catch {
    throw new AppError(502, 'HUNTER_UNREACHABLE', "Couldn't reach Hunter.io. Check your connection and try again.");
  }
  const body = await readJson<{ data?: { domain?: unknown; emails?: unknown[] }; errors?: { id?: string; details?: string }[] }>(res);
  if (!res.ok) {
    const detail = body?.errors?.[0]?.details ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new AppError(502, 'HUNTER_KEY_INVALID', 'Hunter.io refused the API key in HUNTER_API_KEY.');
    if (res.status === 429) throw new AppError(429, 'HUNTER_LIMIT', `Hunter.io says the limit is reached: ${detail}`);
    throw new AppError(502, 'HUNTER_ERROR', `Hunter.io returned an error: ${String(detail).slice(0, 200)}`);
  }
  const emails = Array.isArray(body?.data?.emails) ? (body!.data!.emails as Record<string, unknown>[]) : [];
  const people: FoundPerson[] = [];
  for (const e of emails) {
    const email = str(e.value, 254)?.toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    const sources = Array.isArray(e.sources) ? (e.sources as { uri?: unknown; still_on_page?: unknown }[]) : [];
    const live = sources.find((s) => s.still_on_page === true) ?? sources[0];
    const verification = (e.verification ?? {}) as { status?: unknown };
    people.push({
      email,
      first_name: str(e.first_name, 80),
      last_name: str(e.last_name, 80),
      position: str(e.position, 160),
      department: str(e.department, 40),
      seniority: str(e.seniority, 40),
      confidence: typeof e.confidence === 'number' ? Math.max(0, Math.min(100, Math.round(e.confidence))) : null,
      hunter_status: str(verification.status, 30),
      linkedin: str(e.linkedin, 300),
      source_url: live && typeof live.uri === 'string' && /^https?:\/\//i.test(live.uri) ? live.uri.slice(0, 2048) : null,
      sources: sources.length,
    });
  }
  people.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  return { people, domain: str(body?.data?.domain, 253), limit };
}
