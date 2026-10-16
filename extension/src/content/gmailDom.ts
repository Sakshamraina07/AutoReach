/**
 * Pure helpers for the Gmail assist (unit-tested against fixture markup).
 *
 * Gmail marks people with hover-card attributes: `email="…"` on name spans
 * and `data-hovercard-id="…"` on recipient chips. Reading those attributes is
 * far more stable than Gmail's generated class names.
 */
import type { MessageSummary, RecruiterLookupResult } from '@autoreach/shared';

const EMAIL = /^[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[A-Za-z]{2,}$/;

function addressesIn(root: ParentNode): string[] {
  const out: string[] = [];
  root.querySelectorAll<HTMLElement>('[email], [data-hovercard-id]').forEach((el) => {
    const v = (el.getAttribute('email') ?? el.getAttribute('data-hovercard-id') ?? '').trim().toLowerCase();
    if (EMAIL.test(v)) out.push(v);
  });
  // Older compose UI keeps recipients in hidden inputs.
  root.querySelectorAll<HTMLInputElement>('input[name="to"], input[name="cc"], input[name="bcc"]').forEach((input) => {
    for (const part of input.value.split(',')) {
      const m = /<([^>]+)>/.exec(part)?.[1] ?? part;
      const v = m.trim().toLowerCase();
      if (EMAIL.test(v)) out.push(v);
    }
  });
  return [...new Set(out)];
}

/** Open compose windows (new message, reply, pop-out), most recent last. */
export function composeDialogs(doc: Document): HTMLElement[] {
  const dialogs = Array.from(doc.querySelectorAll<HTMLElement>('div[role="dialog"]')).filter((d) => d.querySelector('input[name="subjectbox"], [contenteditable="true"]'));
  // Inline replies live inside the thread rather than a dialog.
  const inline = Array.from(doc.querySelectorAll<HTMLElement>('div[role="main"] form[method="POST"], div[role="main"] table[role="presentation"] [contenteditable="true"]')).map(
    (el) => (el.closest('table[role="presentation"], form') as HTMLElement | null) ?? el,
  );
  return [...new Set([...dialogs, ...inline])];
}

export function composeRecipients(doc: Document): string[] {
  return [...new Set(composeDialogs(doc).flatMap(addressesIn))];
}

/** People shown in the headers of the open conversation (not message bodies). */
export function threadParticipants(doc: Document): string[] {
  const main = doc.querySelector('div[role="main"]');
  if (!main) return [];
  const headers = Array.from(main.querySelectorAll<HTMLElement>('h3, span.gD, span.g2, [data-message-id] table'));
  const fromHeaders = headers.flatMap((h) => addressesIn(h.parentElement ?? h));
  return [...new Set(fromHeaders)].slice(0, 20);
}

export type AssistTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface AssistItem {
  email: string;
  known: boolean;
  recruiterId: string | null;
  title: string;
  detail: string;
  tone: AssistTone;
  /** Shown while composing: you have emailed this person before. */
  duplicateWarning: string | null;
  doNotContact: boolean;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

function lastOutcome(messages: MessageSummary[]): string {
  const sent = messages.filter((m) => m.send_status === 'sent');
  const last = sent[0];
  if (!last) return messages.length ? 'No email sent yet' : 'Not contacted yet';
  if (last.reply_status === 'replied') return `Replied ${fmt(last.replied_at)}`;
  if (last.reply_status === 'bounced') return `Last email bounced (${fmt(last.sent_at)})`;
  if (last.reply_status === 'auto_reply') return `Automatic reply only (${fmt(last.sent_at)})`;
  // An open is only a signal (image proxies and scanners load images too), so it's worded as such.
  return last.first_open_at ? `Emailed ${fmt(last.sent_at)}, open detected, no reply yet` : `Emailed ${fmt(last.sent_at)}, no reply yet`;
}

/** What to show for each address, from /api/recruiters/lookup. */
export function assistItems(results: RecruiterLookupResult[], composing: boolean): AssistItem[] {
  return results.map(({ email, recruiter, messages }) => {
    if (!recruiter) {
      return { email, known: false, recruiterId: null, title: email, detail: 'Not in AutoReach', tone: 'neutral', duplicateWarning: null, doNotContact: false };
    }
    const sentCount = messages.filter((m) => m.send_status === 'sent').length;
    const replied = messages.some((m) => m.reply_status === 'replied') || !!recruiter.last_reply_at;
    const name = recruiter.full_name ?? recruiter.email;
    const tone: AssistTone = recruiter.do_not_contact || recruiter.outreach_status === 'bounced' ? 'danger' : replied ? 'success' : sentCount ? 'info' : 'neutral';
    return {
      email,
      known: true,
      recruiterId: recruiter.id,
      title: recruiter.company ? `${name}, ${recruiter.company}` : name,
      detail: recruiter.do_not_contact ? 'Marked do-not-contact in AutoReach' : lastOutcome(messages),
      tone,
      duplicateWarning: composing && sentCount > 0 ? `You've emailed ${name.split(' ')[0]} ${sentCount === 1 ? 'once' : `${sentCount} times`} already.` : null,
      doNotContact: recruiter.do_not_contact,
    };
  });
}
