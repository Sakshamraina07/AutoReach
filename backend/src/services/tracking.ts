import type { TrackingClassification } from '@autoreach/shared';
import type { Deps } from '../context.js';
import type { Tx } from '../db/pool.js';
import { logActivity } from './activity.js';

/** 1×1 transparent GIF */
export const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Coarse user-agent family. We deliberately keep nothing finer-grained (no IP,
 * no location, no device model): those details cannot be attributed to the
 * recipient reliably when proxies and scanners fetch images.
 */
export function uaFamily(ua: string | undefined): string {
  const s = (ua ?? '').toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('googleimageproxy') || s.includes('ggpht.com')) return 'gmail_proxy';
  if (s.includes('yahoomailproxy')) return 'yahoo_proxy';
  if (/(bot|crawler|spider|scanner|curl|wget|python|go-http|java\/|okhttp|libwww|headless|barracuda|mimecast|proofpoint|safelinks|symantec|trendmicro|forcepoint)/.test(s)) return 'scanner';
  if (s.includes('outlook') || s.includes('microsoft office') || s.includes('ms-office')) return 'outlook';
  if (s.includes('thunderbird')) return 'thunderbird';
  if (s.includes('mozilla/')) return 'browser_or_mail_app';
  return 'unknown';
}

export function classifyOpen(params: { secondsSinceSent: number; family: string; senderViewing: boolean }): TrackingClassification {
  if (params.family === 'scanner') return 'suspected_automated';
  // Opening the Sent folder right after sending loads the pixel through the same proxy.
  if (params.senderViewing || params.secondsSinceSent < 60) return params.family === 'scanner' ? 'suspected_automated' : 'suspected_self';
  if (params.family === 'gmail_proxy' || params.family === 'yahoo_proxy') return 'proxy';
  return 'open_detected';
}

const COUNTED = new Set<TrackingClassification>(['open_detected', 'proxy']);

/** Record a pixel request. Unknown tokens are ignored silently (no oracle for guessing). */
export async function recordPixelHit(deps: Deps, token: string, userAgent: string | undefined): Promise<void> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return;
  await deps.db.withSystem(async (tx) => {
    const msg = await tx.maybeOne<{
      id: string;
      user_id: string;
      recruiter_id: string | null;
      sent_at: string | null;
      subject: string;
      first_open_at: string | null;
      self_view_until: string | null;
      tracking_on: boolean;
    }>(
      `SELECT m.id, m.user_id, m.recruiter_id, m.sent_at, m.subject, m.first_open_at, r.self_view_until,
         coalesce(s.tracking_enabled, false) AS tracking_on
       FROM email_messages m
       LEFT JOIN recruiters r ON r.id = m.recruiter_id
       LEFT JOIN user_settings s ON s.user_id = m.user_id
       WHERE m.tracking_token = $1 AND m.tracking_enabled AND m.send_status = 'sent'
       FOR UPDATE OF m`,
      [token],
    );
    if (!msg || !msg.tracking_on) return; // user has turned tracking off: record nothing
    const now = deps.now();
    const family = uaFamily(userAgent);
    const classification = classifyOpen({
      secondsSinceSent: msg.sent_at ? (now.getTime() - new Date(msg.sent_at).getTime()) / 1000 : Infinity,
      family,
      senderViewing: !!msg.self_view_until && new Date(msg.self_view_until).getTime() > now.getTime(),
    });
    let counted = COUNTED.has(classification);
    if (counted) {
      // De-duplicate repeated loads (clients refetch images when the message is re-rendered).
      const recent = await tx.maybeOne(
        `SELECT 1 FROM email_events WHERE message_id = $1 AND counted AND ua_family = $2 AND occurred_at > $3::timestamptz - interval '10 minutes'`,
        [msg.id, family, now.toISOString()],
      );
      if (recent) counted = false;
    }
    await tx.query(
      `INSERT INTO email_events (user_id, message_id, event_type, occurred_at, classification, ua_family, counted)
       VALUES ($1, $2, 'open', $3, $4, $5, $6)`,
      [msg.user_id, msg.id, now.toISOString(), classification, family, counted],
    );
    if (counted) {
      await tx.query(
        `UPDATE email_messages SET first_open_at = coalesce(first_open_at, $2), last_open_at = $2, open_event_count = open_event_count + 1 WHERE id = $1`,
        [msg.id, now.toISOString()],
      );
      if (!msg.first_open_at) {
        await logActivity(tx, msg.user_id, 'open_detected', `Open detected for "${msg.subject.slice(0, 120)}"`, { recruiterId: msg.recruiter_id, messageId: msg.id }, { ua_family: family, classification }, now);
      }
    }
  });
}

/** Retention: delete tracking events older than each user's retention window. */
export async function purgeExpiredTrackingEvents(deps: Deps): Promise<number> {
  return deps.db.withSystem(async (tx) => {
    const res = await tx.query(
      `DELETE FROM email_events e USING user_settings s
       WHERE e.user_id = s.user_id AND e.occurred_at < now() - make_interval(days => s.tracking_retention_days)`,
    );
    await tx.query(`DELETE FROM oauth_states WHERE expires_at < now()`);
    return res.rowCount ?? 0;
  });
}

/** User-initiated: delete every tracking event and open aggregate. */
export async function deleteAllTrackingData(tx: Tx, userId: string): Promise<{ events_deleted: number }> {
  const res = await tx.query(`DELETE FROM email_events WHERE user_id = $1`, [userId]);
  await tx.query(`UPDATE email_messages SET first_open_at = NULL, last_open_at = NULL, open_event_count = 0 WHERE user_id = $1 AND (first_open_at IS NOT NULL OR open_event_count > 0)`, [userId]);
  await tx.query(`DELETE FROM activity_log WHERE user_id = $1 AND type = 'open_detected'`, [userId]);
  return { events_deleted: res.rowCount ?? 0 };
}
