/**
 * Email address helpers.
 *
 * Normalisation policy (cautious on purpose):
 *  - The UNIQUE key for a recruiter is `normalizeEmail()` = trimmed + lower-cased.
 *    Mailbox local parts are technically case-sensitive but no real provider
 *    treats them that way, so this is safe.
 *  - Provider-specific canonicalisation (Gmail dots, "+tag" suffixes) is only
 *    used to *suggest* possible duplicates, never to block or auto-merge,
 *    because for company domains "+tag" may route to a different mailbox.
 */

const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const email = raw.trim();
  if (email.length > 254) return false;
  const [local] = email.split('@');
  if (!local || local.length > 64) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return EMAIL_RE.test(email);
}

export function emailDomain(raw: string): string {
  const at = raw.lastIndexOf('@');
  return at === -1 ? '' : normalizeEmail(raw.slice(at + 1));
}

const FREEMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'yahoo.co.in',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'rediffmail.com',
  'zoho.com',
]);

export function isFreemailDomain(domain: string): boolean {
  return FREEMAIL_DOMAINS.has(domain.toLowerCase());
}

/** Placeholder / reserved domains that can never belong to a real recruiter. */
const RESERVED_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'test.com', 'dummy.com', 'invalid', 'localhost']);

export function isReservedDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return RESERVED_DOMAINS.has(d) || d.endsWith('.example') || d.endsWith('.invalid') || d.endsWith('.test');
}

/**
 * Shared mailboxes (hr@, careers@, …). v1 silently dropped these; v2 accepts
 * them (many companies only publish careers@) but flags them so the user knows
 * the email will not reach a named person.
 */
const ROLE_LOCAL_PARTS = new Set([
  'hr',
  'careers',
  'career',
  'jobs',
  'recruiting',
  'recruitment',
  'talent',
  'hiring',
  'info',
  'contact',
  'hello',
  'support',
  'admin',
  'office',
  'team',
]);
const NO_REPLY_RE = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce)/i;

export function isRoleAddress(raw: string): boolean {
  const local = normalizeEmail(raw).split('@')[0] ?? '';
  return ROLE_LOCAL_PARTS.has(local);
}

export function isNoReplyAddress(raw: string): boolean {
  const local = normalizeEmail(raw).split('@')[0] ?? '';
  return NO_REPLY_RE.test(local);
}

/**
 * Canonical form used only for duplicate *suggestions*:
 * gmail/googlemail → strip dots and +tag; other domains → strip +tag.
 */
export function duplicateSuggestionKey(raw: string): string {
  const email = normalizeEmail(raw);
  const at = email.lastIndexOf('@');
  if (at === -1) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

/** Extract a bare address from `"Name" <a@b.com>` / `a@b.com` header values. */
export function parseAddressHeader(value: string | null | undefined): { email: string; name: string } | null {
  if (!value) return null;
  const angle = value.match(/<([^>]+)>/);
  if (angle?.[1]) {
    const email = angle[1].trim();
    const name = value
      .slice(0, angle.index)
      .trim()
      .replace(/^"|"$/g, '')
      .trim();
    return { email: normalizeEmail(email), name };
  }
  const bare = value.trim();
  if (bare.includes('@')) return { email: normalizeEmail(bare), name: '' };
  return null;
}

/** Split a comma-separated address list header (best effort, ignores quoted commas). */
export function parseAddressList(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let current = '';
  for (const ch of value) {
    if (ch === '"') inQuote = !inQuote;
    if (!inQuote && ch === '<') depth++;
    if (!inQuote && ch === '>') depth--;
    if (ch === ',' && !inQuote && depth === 0) {
      const parsed = parseAddressHeader(current);
      if (parsed) out.push(parsed.email);
      current = '';
    } else {
      current += ch;
    }
  }
  const parsed = parseAddressHeader(current);
  if (parsed) out.push(parsed.email);
  return out;
}

export function firstNameOf(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const cleaned = fullName.replace(/\s+/g, ' ').trim();
  const first = cleaned.split(' ')[0] ?? '';
  // Strip honorifics
  if (/^(mr|mrs|ms|miss|dr|prof)\.?$/i.test(first)) return cleaned.split(' ')[1] ?? '';
  return first;
}

/** Company name normalisation for the companies table / duplicate suggestions. */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(private|pvt|limited|ltd|llp|llc|inc|incorporated|corp|corporation|co|gmbh|plc|the)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
