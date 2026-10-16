import type { ReplyStatus, SendStatus } from './enums.js';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

export interface DisplayStatus {
  key:
    | 'draft'
    | 'scheduled'
    | 'queued'
    | 'sending'
    | 'sent'
    | 'failed'
    | 'unknown'
    | 'open_detected'
    | 'replied'
    | 'auto_reply'
    | 'bounced'
    | 'needs_review';
  label: string;
  tone: StatusTone;
  hint: string;
}

export interface MessageStatusInput {
  send_status: SendStatus;
  reply_status: ReplyStatus;
  tracking_enabled: boolean;
  first_open_at: string | null;
  scheduled_for?: string | null;
}

export const OPEN_TRACKING_CAVEAT =
  'Open detection is approximate: image blocking hides real opens, while mail-provider image proxies, privacy features and security scanners can load the pixel without anyone reading the email.';

/**
 * Single headline status for tables. The most informative *reliable* fact wins:
 * reply/bounce > open detected > send state. Separate columns still show each fact.
 */
export function deriveDisplayStatus(m: MessageStatusInput): DisplayStatus {
  switch (m.send_status) {
    case 'draft':
      return { key: 'draft', label: 'Draft', tone: 'neutral', hint: 'Not sent. Only you can see it.' };
    case 'queued':
      return m.scheduled_for && new Date(m.scheduled_for).getTime() > Date.now()
        ? { key: 'scheduled', label: 'Scheduled', tone: 'info', hint: 'Approved and waiting for its scheduled time.' }
        : { key: 'queued', label: 'Queued', tone: 'info', hint: 'Approved; the send queue will send it shortly.' };
    case 'sending':
      return { key: 'sending', label: 'Sending', tone: 'info', hint: 'Handing the message to Gmail.' };
    case 'failed':
      return { key: 'failed', label: 'Failed', tone: 'danger', hint: 'Gmail did not accept the message. Nothing was sent.' };
    case 'unknown':
      return {
        key: 'unknown',
        label: 'Outcome unknown',
        tone: 'warning',
        hint: "The request reached Gmail but no confirmation came back. Check your Gmail Sent folder and mark it as sent or failed — AutoReach will not retry automatically to avoid a duplicate.",
      };
    case 'sent':
      break;
  }
  switch (m.reply_status) {
    case 'replied':
      return { key: 'replied', label: 'Replied', tone: 'success', hint: 'A reply from the recipient arrived in this Gmail thread.' };
    case 'bounced':
      return { key: 'bounced', label: 'Bounced', tone: 'danger', hint: 'A delivery-failure notice arrived for this message.' };
    case 'auto_reply':
      return { key: 'auto_reply', label: 'Auto-reply', tone: 'warning', hint: 'An automatic reply (e.g. out of office) arrived. Not counted as a reply.' };
    case 'needs_review':
      return { key: 'needs_review', label: 'Check reply', tone: 'warning', hint: 'A message arrived in the thread from a different address. Confirm whether it is a reply.' };
    case 'none':
      break;
  }
  if (m.tracking_enabled && m.first_open_at) {
    return { key: 'open_detected', label: 'Open detected', tone: 'accent', hint: OPEN_TRACKING_CAVEAT };
  }
  return { key: 'sent', label: 'Sent', tone: 'success', hint: 'Gmail accepted the message for delivery. Delivery to the inbox is not confirmed.' };
}

export type TrackingDisplay = { key: 'off' | 'not_detected' | 'open_detected' | 'not_applicable'; label: string };

export function deriveTrackingDisplay(m: Pick<MessageStatusInput, 'send_status' | 'tracking_enabled' | 'first_open_at'>): TrackingDisplay {
  if (m.send_status !== 'sent') return { key: 'not_applicable', label: '—' };
  if (!m.tracking_enabled) return { key: 'off', label: 'Tracking off' };
  if (m.first_open_at) return { key: 'open_detected', label: 'Open detected' };
  return { key: 'not_detected', label: 'No open detected' };
}
