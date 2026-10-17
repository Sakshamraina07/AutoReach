import type { Deps } from '../context.js';
import { fetchWithTimeout, readJson } from '../lib/http.js';

/**
 * Optional contact-discovery assistance. Results are SUGGESTIONS only:
 * every inferred address is labelled unverified, carries its source, and
 * nothing is saved or emailed automatically. When saved by the user, such a
 * recruiter has email_verification = 'unverified_guess' and sending requires
 * an explicit confirmation.
 */
export interface EmailSuggestion {
  email: string;
  verification: 'unverified_guess';
  source: string;
  confidence: number | null;
  source_url: string | null;
  note: string;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

export async function suggestEmails(
  deps: Deps,
  input: { full_name: string; company?: string; domain?: string; known_email?: string },
): Promise<{ suggestions: EmailSuggestion[]; disclaimer: string }> {
  const parts = input.full_name.trim().split(/\s+/);
  const first = slug(parts[0] ?? '');
  const last = slug(parts.length > 1 ? parts[parts.length - 1]! : '');
  const suggestions: EmailSuggestion[] = [];

  if (deps.config.hunterApiKey && first && last && (input.domain || input.company)) {
    const url = new URL('https://api.hunter.io/v2/email-finder');
    url.searchParams.set('first_name', parts[0]!);
    url.searchParams.set('last_name', parts.slice(1).join(' '));
    if (input.domain) url.searchParams.set('domain', input.domain);
    else url.searchParams.set('company', input.company!);
    try {
      const res = await fetchWithTimeout(deps.fetch, url.toString(), { headers: { 'X-API-KEY': deps.config.hunterApiKey }, timeoutMs: 15_000 });
      const body = await readJson<{ data?: { email?: string; score?: number; sources?: { uri?: string }[] } }>(res);
      if (res.ok && body?.data?.email) {
        suggestions.push({
          email: body.data.email.toLowerCase(),
          verification: 'unverified_guess',
          source: 'Hunter.io email finder',
          confidence: typeof body.data.score === 'number' ? body.data.score : null,
          source_url: body.data.sources?.[0]?.uri ?? null,
          note: 'Found by a third-party service. Not verified by AutoReach — confirm before sending.',
        });
      }
    } catch (err) {
      deps.logger.warn({ err: (err as Error).message }, 'hunter lookup failed');
    }
  }

  if (input.domain && first) {
    const domain = input.domain.toLowerCase();
    const patterns = last ? [`${first}.${last}`, `${first}${last}`, `${first[0]}${last}`, `${first}`] : [first];
    for (const p of patterns) {
      const email = `${p}@${domain}`;
      if (suggestions.some((s) => s.email === email)) continue;
      suggestions.push({
        email,
        verification: 'unverified_guess',
        source: 'Common address pattern',
        confidence: null,
        source_url: null,
        note: 'A guess based on a common naming pattern. It may not exist.',
      });
    }
  }
  return {
    suggestions,
    disclaimer: 'These addresses are not verified. AutoReach will ask you to confirm before sending to any of them.',
  };
}
