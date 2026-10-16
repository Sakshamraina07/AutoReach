import { firstNameOf, normalizeCompanyName } from './email.js';
import { canonicalSkillSet, extractSkills } from './skills.js';
import { findPlaceholders } from './template.js';

/**
 * Deterministic "message quality check" (no AI involved). It runs on every
 * draft — AI-generated or hand-written — and never edits the text; it only
 * reports findings so the user decides.
 */

export type QualitySeverity = 'error' | 'warning' | 'info';

export interface QualityFinding {
  code: string;
  severity: QualitySeverity;
  message: string;
}

export interface QualityInput {
  kind: 'initial' | 'follow_up';
  subject: string;
  body: string;
  recruiterName?: string | null;
  recruiterEmail?: string | null;
  companyName?: string | null;
  /** Names of other companies in the user's CRM (used to catch copy/paste mistakes). */
  otherCompanyNames?: string[];
  /** The candidate's verified skills (profile skills + project technologies). */
  candidateSkills: string[];
  /**
   * All verified source text: profile, résumé text, job description, user notes,
   * previous messages. Numbers and claims are checked against this.
   */
  factsText: string;
  attachment: { required: boolean; present: boolean };
  previousContact?: { count: number; lastSentAt?: string | null };
}

export const GENERIC_PHRASES: readonly string[] = [
  'i hope this email finds you well',
  'i hope this message finds you well',
  'i am writing to express my interest',
  'i am writing to inquire',
  'to whom it may concern',
  'dear sir/madam',
  'dear sir or madam',
  'i am a highly motivated',
  'passionate about technology',
  'i believe i would be a great fit',
  'perfect fit',
  'leverage my skills',
  'synergy',
  'delve',
  'in today\'s fast-paced',
  'cutting-edge',
  'i am confident that',
  'thank you for your time and consideration',
  'looking forward to hearing from you at your earliest convenience',
];

const FLATTERY = /\b(dream company|huge fan|biggest fan|world[-\s]class|revolutionary|industry[-\s]leading|the best company|amazing company|incredible company|greatly admire)\b/i;
const CONNECTION_CLAIMS =
  /\b(referred (me|by)|referral from|on the recommendation of|we met|met you|nice meeting you|mutual (friend|connection)|as (we )?discussed|our (recent )?(call|conversation|chat)|you (asked|suggested) (me|that))\b/i;
const RESUME_MENTION = /\b(r[ée]sum[ée]|cv|curriculum vitae)\b/i;
const GREETING_RE = /^\s*(?:hi|hello|dear|hey|good (?:morning|afternoon|evening))\s+(?:(?:mr|mrs|ms|dr|prof)\.?\s+)?([A-Z][\p{L}'-]+)/iu;
const NEUTRAL_GREETINGS = new Set(['team', 'there', 'hiring', 'recruiter', 'recruiting', 'sir', 'madam', 'all', 'everyone']);

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function includesNormalized(haystack: string, needle: string): boolean {
  const n = normalizeCompanyName(needle);
  if (!n) return true;
  return normalizeCompanyName(haystack).includes(n);
}

/** Numbers that look like claims: percentages, multipliers, counts with units. */
export function extractClaimNumbers(text: string): string[] {
  const cleaned = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\S+@\S+/g, ' ')
    .replace(/\+?\d[\d\s-]{8,}\d/g, ' '); // phone numbers
  const out = new Set<string>();
  const re = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(%|\+|k\b|K\b|x\b|X\b|lpa\b|LPA\b|ms\b|users\b|customers\b|requests\b)?/g;
  for (const m of cleaned.matchAll(re)) {
    const digits = m[1] ?? '';
    const unit = (m[2] ?? '').trim();
    const value = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    if (!unit && value < 10) continue; // "2 projects", dates like "5" are too noisy
    if (!unit && value >= 1900 && value <= 2100 && !digits.includes('.')) continue; // years
    out.add(`${digits}${unit}`);
  }
  return [...out];
}

function factsContainNumber(factsText: string, token: string): boolean {
  const digits = token.replace(/[^\d.]/g, '');
  if (!digits) return true;
  const facts = factsText.replace(/,(?=\d{3})/g, '');
  return new RegExp(`(?<![\\d.])${digits.replace('.', '\\.')}(?![\\d])`).test(facts);
}

export function runQualityChecks(input: QualityInput): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const subject = input.subject.trim();
  const body = input.body.trim();
  const add = (code: string, severity: QualitySeverity, message: string) => findings.push({ code, severity, message });

  if (!subject) add('EMPTY_SUBJECT', 'error', 'The subject line is empty.');
  if (!body) add('EMPTY_BODY', 'error', 'The email body is empty.');
  if (!body) return findings;

  const placeholders = findPlaceholders(`${subject}\n${body}`);
  if (placeholders.length) {
    add('PLACEHOLDER_LEFT', 'error', `Unfilled placeholder${placeholders.length > 1 ? 's' : ''}: ${placeholders.join(', ')}.`);
  }

  // Company correctness
  if (input.companyName && input.kind === 'initial' && !includesNormalized(`${subject}\n${body}`, input.companyName)) {
    add('COMPANY_NOT_MENTIONED', 'warning', `The email never mentions ${input.companyName}.`);
  }
  const current = input.companyName ? normalizeCompanyName(input.companyName) : '';
  const wrong = (input.otherCompanyNames ?? []).filter((name) => {
    const n = normalizeCompanyName(name);
    if (!n || n.length < 3 || n === current || current.includes(n) || n.includes(current)) return false;
    return new RegExp(`(?<![a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(normalizeCompanyName(`${subject} ${body}`));
  });
  if (wrong.length) {
    add('WRONG_COMPANY', 'error', `Mentions ${wrong.join(', ')}, but this email is for ${input.companyName ?? 'a different company'}.`);
  }

  // Recruiter name in greeting
  const greeting = body.match(GREETING_RE);
  if (greeting?.[1]) {
    const greeted = greeting[1].toLowerCase();
    const expected = firstNameOf(input.recruiterName).toLowerCase();
    const expectedLast = (input.recruiterName ?? '').trim().split(/\s+/).pop()?.toLowerCase() ?? '';
    if (!NEUTRAL_GREETINGS.has(greeted) && expected && greeted !== expected && greeted !== expectedLast) {
      add('WRONG_RECIPIENT_NAME', 'error', `Greets "${greeting[1]}", but the recruiter is ${input.recruiterName}.`);
    }
  }

  // Length
  const words = wordCount(body);
  const limit = input.kind === 'follow_up' ? 120 : 220;
  if (words > limit) add('TOO_LONG', 'warning', `${words} words — aim for under ${limit} so it can be read in under a minute.`);
  if (words < 25 && input.kind === 'initial') add('TOO_SHORT', 'info', `Only ${words} words — make sure it says why you are a fit.`);
  if (subject.length > 90) add('SUBJECT_TOO_LONG', 'warning', `Subject is ${subject.length} characters; mobile clients cut off around 60–70.`);
  if (input.kind === 'initial' && /^re:/i.test(subject)) add('FAKE_REPLY_SUBJECT', 'warning', 'A first email should not start with "Re:".');
  if (subject && subject === subject.toUpperCase() && /[A-Z]{4}/.test(subject)) add('SUBJECT_ALL_CAPS', 'info', 'Subject is in all caps.');
  if ((body.match(/!/g) ?? []).length > 2) add('EXCLAMATIONS', 'info', 'Several exclamation marks — consider a calmer tone.');

  // Generic language & flattery
  const lower = body.toLowerCase();
  const generic = GENERIC_PHRASES.filter((p) => lower.includes(p));
  if (generic.length) add('GENERIC_LANGUAGE', 'warning', `Generic phrasing: "${generic.slice(0, 3).join('", "')}".`);
  if (FLATTERY.test(body)) add('FLATTERY', 'info', 'Contains heavy flattery; specific, factual interest reads better.');

  // Unsupported claims
  const unsupportedNumbers = extractClaimNumbers(`${subject}\n${body}`).filter((n) => !factsContainNumber(input.factsText, n));
  if (unsupportedNumbers.length) {
    add(
      'UNSUPPORTED_NUMBER',
      'warning',
      `${unsupportedNumbers.join(', ')} ${unsupportedNumbers.length > 1 ? "don't" : "doesn't"} appear in your profile, résumé or the job description — remove it unless it is accurate.`,
    );
  }
  const have = canonicalSkillSet(input.candidateSkills);
  const factsSkills = new Set(extractSkills(input.factsText).map((s) => s.toLowerCase()));
  const mentioned = extractSkills(body);
  const unsupportedSkills = mentioned.filter((s) => !have.has(s.toLowerCase()) && !factsSkills.has(s.toLowerCase()));
  if (unsupportedSkills.length) {
    add('UNSUPPORTED_SKILL', 'warning', `Mentions ${unsupportedSkills.join(', ')}, which ${unsupportedSkills.length > 1 ? 'are' : 'is'} not in your profile or résumé.`);
  }
  const notInProfileButInJd = mentioned.filter((s) => !have.has(s.toLowerCase()) && factsSkills.has(s.toLowerCase()));
  if (notInProfileButInJd.length) {
    add(
      'SKILL_ONLY_IN_JOB',
      'info',
      `${notInProfileButInJd.join(', ')} come${notInProfileButInJd.length > 1 ? '' : 's'} from the job description or notes, not your skills list — make sure the email doesn't claim experience with ${notInProfileButInJd.length > 1 ? 'them' : 'it'}.`,
    );
  }
  if (CONNECTION_CLAIMS.test(body) && !CONNECTION_CLAIMS.test(input.factsText)) {
    add('UNSUPPORTED_CONNECTION', 'warning', 'Claims a referral, meeting or prior conversation that is not recorded anywhere — verify it is true.');
  }

  // One clear request
  const asks = (body.match(/\?/g) ?? []).length;
  if (asks > 2) add('MULTIPLE_ASKS', 'info', `${asks} questions — keep to one clear request.`);

  // Attachment
  if (input.attachment.required && !input.attachment.present) {
    add('MISSING_ATTACHMENT', 'error', 'Your settings require a résumé attachment, but none is selected.');
  }
  if (input.attachment.present && input.kind === 'initial' && !RESUME_MENTION.test(body)) {
    add('ATTACHMENT_NOT_MENTIONED', 'info', 'A résumé is attached but the email does not mention it.');
  }
  if (!input.attachment.present && RESUME_MENTION.test(body) && /attach/i.test(body)) {
    add('MENTIONS_MISSING_ATTACHMENT', 'error', 'The email says a résumé is attached, but nothing is attached.');
  }

  // Previously contacted
  if (input.previousContact && input.previousContact.count > 0 && input.kind === 'initial') {
    const when = input.previousContact.lastSentAt ? ` (last on ${input.previousContact.lastSentAt.slice(0, 10)})` : '';
    add(
      'PREVIOUSLY_CONTACTED',
      'warning',
      `You have already emailed this recruiter ${input.previousContact.count} time${input.previousContact.count > 1 ? 's' : ''}${when}. Consider a follow-up instead.`,
    );
  }

  return findings;
}

export function hasBlockingFindings(findings: readonly QualityFinding[]): boolean {
  return findings.some((f) => f.severity === 'error');
}
