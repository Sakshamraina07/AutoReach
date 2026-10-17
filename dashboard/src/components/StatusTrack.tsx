import { deriveDisplayStatus, deriveTrackingDisplay, OPEN_TRACKING_CAVEAT, type MessageSummary } from '@autoreach/shared';
import { clsx } from 'clsx';
import { Badge, type Tone } from './ui';

type Pick3 = Pick<MessageSummary, 'send_status' | 'reply_status' | 'tracking_enabled' | 'first_open_at' | 'scheduled_for'>;

/**
 * The delivery track: three separate facts — sent, open detected, replied —
 * drawn as three nodes so they are never conflated. The open node is dashed
 * because an open is only ever a signal, never proof.
 */
export function StatusTrack({ m, showLabel = true }: { m: Pick3; showLabel?: boolean }) {
  const status = deriveDisplayStatus(m);
  const tracking = deriveTrackingDisplay(m);

  const sentNode =
    m.send_status === 'sent'
      ? 'bg-sent border-sent'
      : m.send_status === 'failed'
        ? 'border-danger bg-danger'
        : m.send_status === 'unknown'
          ? 'border-warn bg-warn/30'
          : m.send_status === 'draft'
            ? 'border-faint bg-transparent'
            : 'border-accent bg-accent/30';
  const openNode =
    tracking.key === 'open_detected'
      ? 'border-opened border-dashed bg-opened/30'
      : tracking.key === 'off'
        ? 'border-line bg-transparent opacity-40'
        : 'border-line bg-transparent';
  const replyNode =
    m.reply_status === 'replied'
      ? 'border-replied bg-replied'
      : m.reply_status === 'bounced'
        ? 'border-danger bg-danger/40'
        : m.reply_status === 'auto_reply' || m.reply_status === 'needs_review'
          ? 'border-warn bg-warn/30'
          : 'border-line bg-transparent';
  const sentLine = m.send_status === 'sent' ? 'bg-sent/60' : 'bg-line';

  const summary = [
    `Send: ${m.send_status}`,
    `Open: ${tracking.label}${tracking.key === 'open_detected' ? ' (approximate)' : ''}`,
    `Reply: ${m.reply_status === 'none' ? 'none detected' : m.reply_status.replace('_', ' ')}`,
  ].join('. ');

  return (
    <span className="inline-flex items-center gap-2" title={`${status.hint}${tracking.key === 'open_detected' ? `\n\n${OPEN_TRACKING_CAVEAT}` : ''}`}>
      <span className="inline-flex items-center" aria-label={summary} role="img">
        <span className={clsx('h-2.5 w-2.5 rounded-full border', sentNode)} />
        <span className={clsx('h-px w-2.5', sentLine)} />
        <span className={clsx('h-2.5 w-2.5 rounded-full border', openNode)} />
        <span className="h-px w-2.5 bg-line" />
        <span className={clsx('h-2.5 w-2.5 rounded-full border', replyNode)} />
      </span>
      {showLabel && <span className={clsx('text-xs', TONE_TEXT[status.tone])}>{status.label}</span>}
    </span>
  );
}

const TONE_TEXT: Record<string, string> = {
  neutral: 'text-muted',
  info: 'text-accent',
  success: 'text-replied',
  warning: 'text-warn',
  danger: 'text-danger',
  accent: 'text-opened',
};

export function StatusBadge({ m }: { m: Pick3 }) {
  const s = deriveDisplayStatus(m);
  const tone: Tone = s.key === 'sent' ? 'sent' : (s.tone as Tone);
  return (
    <Badge tone={tone} title={s.hint}>
      {s.label}
    </Badge>
  );
}

export function TrackLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-faint">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-sent" /> Sent (accepted by Gmail)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full border border-dashed border-opened bg-opened/30" /> Open detected (approximate)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-replied" /> Replied
      </span>
    </div>
  );
}
