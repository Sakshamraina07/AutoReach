import { emailDomain, isFreemailDomain, isNoReplyAddress, normalizeEmail, parseAddressHeader, type InboundClassification } from '@autoreach/shared';
import type { Deps } from '../context.js';
import type { Tx } from '../db/pool.js';
import { AppError } from '../errors.js';
import { logActivity } from './activity.js';
import { cancelPendingFollowUps } from './followups.js';
import { GmailApiError, header, type GmailClient, type GmailMessageMeta } from './gmail/client.js';
import { getAuthorizedGmail, markNeedsReauth } from './gmail/connection.js';

/* ------------------------------------------------------------------ */
/* Pure classification (unit tested)                                   */
/* ------------------------------------------------------------------ */

export interface InboundHeaders {
  from: string | null;
  subject: string | null;
  autoSubmitted: string | null;
  xAutoreply: string | null;
  xAutorespond: string | null;
  precedence: string | null;
  contentType: string | null;
}

export function classifyInbound(h: InboundHeaders, ctx: { accountEmail: string; recruiterEmail: string | null; labelIds?: string[] }): InboundClassification {
  const from = parseAddressHeader(h.from)?.email ?? '';
  if (ctx.labelIds?.includes('SENT') || (from && from === normalizeEmail(ctx.accountEmail))) return 'own_message';
  const local = from.split('@')[0] ?? '';
  const subject = (h.subject ?? '').trim();
  if (
    /^(mailer-daemon|postmaster)$/i.test(local) ||
    /report-type\s*=\s*"?delivery-status/i.test(h.contentType ?? '') ||
    /^(delivery status notification|undeliverable|undelivered mail|mail delivery (failed|subsystem)|returned mail|failure notice)/i.test(subject)
  ) {
    return 'bounce';
  }
  const autoSubmitted = (h.autoSubmitted ?? '').trim().toLowerCase();
  if (
    (autoSubmitted && autoSubmitted !== 'no') ||
    h.xAutoreply ||
    h.xAutorespond ||
    /^(auto_reply|auto-reply)$/i.test((h.precedence ?? '').trim()) ||
    /^(automatic reply|auto:|auto reply|autoreply|auto-reply|out of (the )?office|ooo\b)/i.test(subject)
  ) {
    return 'auto_reply';
  }
  if (ctx.recruiterEmail && from === normalizeEmail(ctx.recruiterEmail)) return 'reply';
  if (isNoReplyAddress(from)) return 'auto_reply';
  if (ctx.recruiterEmail) {
    const d = emailDomain(ctx.recruiterEmail);
    if (d && !isFreemailDomain(d) && emailDomain(from) === d) return 'possible_reply';
  }
  return 'other_sender';
}

function headersOf(m: GmailMessageMeta): InboundHeaders {
  return {
    from: header(m, 'From'),
    subject: header(m, 'Subject'),
    autoSubmitted: header(m, 'Auto-Submitted'),
    xAutoreply: header(m, 'X-Autoreply'),
    xAutorespond: header(m, 'X-Autorespond'),
    precedence: header(m, 'Precedence'),
    contentType: header(m, 'Content-Type'),
  };
}

/* ------------------------------------------------------------------ */
/* Applying one Gmail message to our records                           */
/* ------------------------------------------------------------------ */

interface ThreadRow {
  id: string;
  gmail_thread_id: string;
  recruiter_id: string | null;
  recruiter_email: string | null;
}

export async function applyThreadMessage(tx: Tx, userId: string, accountEmail: string, thread: ThreadRow, m: GmailMessageMeta): Promise<InboundClassification | null> {
  const classification = classifyInbound(headersOf(m), { accountEmail, recruiterEmail: thread.recruiter_email, labelIds: m.labelIds });
  const receivedAt = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString();
  const from = parseAddressHeader(header(m, 'From'));

  // Our own recorded sends are already known.
  const ours = await tx.maybeOne(`SELECT 1 FROM email_messages WHERE user_id = $1 AND gmail_message_id = $2`, [userId, m.id]);
  if (ours) return null;

  // The latest message WE sent in this thread before this one arrived.
  const matched = await tx.maybeOne<{ id: string; reply_status: string; subject: string; replied_at: string | null }>(
    `SELECT id, reply_status, subject, replied_at FROM email_messages
     WHERE user_id = $1 AND gmail_thread_id = $2 AND send_status = 'sent' AND sent_at <= $3
     ORDER BY sent_at DESC LIMIT 1`,
    [userId, thread.gmail_thread_id, receivedAt],
  );
  const direction = classification === 'own_message' ? 'outbound' : 'inbound';
  const relevant = !!matched; // messages before our first email are earlier conversation, not replies
  const needsReview = relevant && (classification === 'possible_reply' || classification === 'other_sender');

  const inserted = await tx.maybeOne<{ id: string }>(
    `INSERT INTO thread_messages (user_id, thread_id, gmail_message_id, direction, from_email, from_name, subject, received_at, classification, matched_message_id, needs_review)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (user_id, gmail_message_id) DO NOTHING RETURNING id`,
    [userId, thread.id, m.id, direction, from?.email ?? '', from?.name || null, header(m, 'Subject'), receivedAt, classification, matched?.id ?? null, needsReview],
  );
  if (!inserted) return null; // already processed: idempotent
  await tx.query(
    `UPDATE email_threads SET last_activity_at = GREATEST(last_activity_at, $2), last_inbound_at = CASE WHEN $3 THEN GREATEST(last_inbound_at, $2) ELSE last_inbound_at END WHERE id = $1`,
    [thread.id, receivedAt, direction === 'inbound'],
  );

  if (!thread.recruiter_id) return classification;
  if (classification === 'own_message') {
    // The user wrote to this recruiter directly from Gmail.
    await tx.query(`UPDATE recruiters SET last_contacted_at = GREATEST(last_contacted_at, $3) WHERE user_id = $1 AND id = $2`, [userId, thread.recruiter_id, receivedAt]);
    return classification;
  }
  if (!relevant || !matched) return classification;

  const subjectLabel = `"${matched.subject.slice(0, 100)}"`;
  switch (classification) {
    case 'reply': {
      await tx.query(
        `UPDATE email_messages SET reply_status = 'replied', replied_at = LEAST(coalesce(replied_at, $3), $3), reply_from = $4
         WHERE user_id = $1 AND id = $2 AND reply_status IN ('none', 'needs_review', 'auto_reply')`,
        [userId, matched.id, receivedAt, from?.email ?? null],
      );
      await tx.query(
        `UPDATE recruiters SET last_reply_at = GREATEST(last_reply_at, $3),
           outreach_status = CASE WHEN outreach_status IN ('new', 'contacted') THEN 'replied' ELSE outreach_status END
         WHERE user_id = $1 AND id = $2`,
        [userId, thread.recruiter_id, receivedAt],
      );
      await cancelPendingFollowUps(tx, userId, thread.recruiter_id, 'reply_received');
      await logActivity(tx, userId, 'reply_received', `Reply received from ${from?.name || from?.email} to ${subjectLabel}`, { recruiterId: thread.recruiter_id, messageId: matched.id }, {}, receivedAt);
      break;
    }
    case 'bounce': {
      await tx.query(`UPDATE email_messages SET reply_status = 'bounced' WHERE user_id = $1 AND id = $2 AND reply_status <> 'replied'`, [userId, matched.id]);
      await tx.query(`UPDATE recruiters SET outreach_status = 'bounced' WHERE user_id = $1 AND id = $2 AND outreach_status IN ('new', 'contacted')`, [userId, thread.recruiter_id]);
      await cancelPendingFollowUps(tx, userId, thread.recruiter_id, 'bounced');
      await logActivity(tx, userId, 'bounce_detected', `Delivery failure reported for ${subjectLabel}`, { recruiterId: thread.recruiter_id, messageId: matched.id }, {}, receivedAt);
      break;
    }
    case 'auto_reply': {
      await tx.query(`UPDATE email_messages SET reply_status = 'auto_reply' WHERE user_id = $1 AND id = $2 AND reply_status = 'none'`, [userId, matched.id]);
      await logActivity(tx, userId, 'auto_reply_received', `Automatic reply received for ${subjectLabel}`, { recruiterId: thread.recruiter_id, messageId: matched.id }, {}, receivedAt);
      break;
    }
    case 'possible_reply':
    case 'other_sender': {
      await tx.query(`UPDATE email_messages SET reply_status = 'needs_review' WHERE user_id = $1 AND id = $2 AND reply_status IN ('none', 'auto_reply')`, [userId, matched.id]);
      await logActivity(
        tx,
        userId,
        'reply_needs_review',
        `${from?.email ?? 'Someone'} wrote in the thread for ${subjectLabel} — confirm whether it is a reply`,
        { recruiterId: thread.recruiter_id, messageId: matched.id },
        {},
        receivedAt,
      );
      break;
    }
    default:
      break;
  }
  return classification;
}

/* ------------------------------------------------------------------ */
/* Incremental sync                                                    */
/* ------------------------------------------------------------------ */

export interface SyncResult {
  status: 'ok' | 'skipped' | 'error';
  reason?: string;
  mode?: 'incremental' | 'resync';
  processed: number;
  replies: number;
}

const TRACK_WINDOW_DAYS = 120;
const RESYNC_WINDOW_DAYS = 60;
const MAX_MESSAGES_PER_SYNC = 300;

async function trackedThreads(tx: Tx, userId: string, sinceDays: number): Promise<ThreadRow[]> {
  return tx.many<ThreadRow>(
    `SELECT t.id, t.gmail_thread_id, t.recruiter_id, r.email AS recruiter_email
     FROM email_threads t LEFT JOIN recruiters r ON r.id = t.recruiter_id
     WHERE t.user_id = $1 AND coalesce(t.last_activity_at, t.created_at) > now() - make_interval(days => $2)
     ORDER BY t.last_activity_at DESC NULLS LAST LIMIT 1000`,
    [userId, sinceDays],
  );
}

async function resync(deps: Deps, userId: string, client: GmailClient, accountEmail: string): Promise<{ processed: number; replies: number; historyId: string }> {
  const profile = await client.getProfile();
  const threads = await deps.db.withUser(userId, (tx) => trackedThreads(tx, userId, RESYNC_WINDOW_DAYS));
  let processed = 0;
  let replies = 0;
  for (const t of threads.slice(0, 200)) {
    let full;
    try {
      full = await client.getThreadMetadata(t.gmail_thread_id);
    } catch (err) {
      if (err instanceof GmailApiError && err.kind === 'not_found') continue; // thread deleted in Gmail
      throw err;
    }
    for (const m of full.messages ?? []) {
      const c = await deps.db.withUser(userId, (tx) => applyThreadMessage(tx, userId, accountEmail, t, m));
      if (c) processed++;
      if (c === 'reply') replies++;
    }
  }
  return { processed, replies, historyId: profile.historyId };
}

export async function syncUserReplies(deps: Deps, userId: string): Promise<SyncResult> {
  let gmail;
  try {
    gmail = await getAuthorizedGmail(deps, userId, 'read');
  } catch (err) {
    if (err instanceof AppError) return { status: 'skipped', reason: err.code, processed: 0, replies: 0 };
    throw err;
  }
  const { client, accountEmail } = gmail;
  const conn = await deps.db.withSystem((tx) =>
    tx.one<{ history_id: string | null }>(`SELECT history_id FROM oauth_connections WHERE user_id = $1 AND provider = 'google_gmail'`, [userId]),
  );
  const settings = await deps.db.withUser(userId, (tx) => tx.one<{ reply_scan_new_threads: boolean }>(`SELECT reply_scan_new_threads FROM user_settings WHERE user_id = $1`, [userId]));

  try {
    let processed = 0;
    let replies = 0;
    let newHistoryId: string;
    let mode: 'incremental' | 'resync' = 'incremental';

    if (!conn.history_id) {
      mode = 'resync';
      ({ processed, replies, historyId: newHistoryId } = await resync(deps, userId, client, accountEmail));
    } else {
      const threads = await deps.db.withUser(userId, (tx) => trackedThreads(tx, userId, TRACK_WINDOW_DAYS));
      const byGmailId = new Map(threads.map((t) => [t.gmail_thread_id, t]));
      const added: { id: string; threadId: string; labelIds?: string[] }[] = [];
      let pageToken: string | undefined;
      newHistoryId = conn.history_id;
      try {
        do {
          const page = await client.listHistory(conn.history_id, pageToken);
          for (const h of page.history ?? []) for (const a of h.messagesAdded ?? []) added.push(a.message);
          newHistoryId = page.historyId ?? newHistoryId;
          pageToken = page.nextPageToken;
        } while (pageToken && added.length < 5000);
      } catch (err) {
        if (err instanceof GmailApiError && err.kind === 'not_found') {
          // History cursor expired (Gmail keeps it ~1 week, sometimes less): bounded full resync.
          mode = 'resync';
          ({ processed, replies, historyId: newHistoryId } = await resync(deps, userId, client, accountEmail));
          await saveCursor(deps, userId, newHistoryId, null);
          return { status: 'ok', mode, processed, replies };
        }
        throw err;
      }

      const seen = new Set<string>();
      let fetched = 0;
      for (const a of added) {
        if (seen.has(a.id) || fetched >= MAX_MESSAGES_PER_SYNC) continue;
        seen.add(a.id);
        let thread = byGmailId.get(a.threadId);
        if (!thread) {
          // Untracked thread. Only look at it if the user opted in, and only at headers.
          if (!settings.reply_scan_new_threads || a.labelIds?.includes('SENT')) continue;
          fetched++;
          const meta = await client.getMessageMetadata(a.id, ['From', 'Subject']);
          const fromEmail = parseAddressHeader(header(meta, 'From'))?.email;
          if (!fromEmail) continue;
          const created = await deps.db.withUser(userId, async (tx) => {
            const rec = await tx.maybeOne<{ id: string; email: string }>(
              `SELECT id, email FROM recruiters WHERE user_id = $1 AND email_normalized = $2 AND merged_into_id IS NULL`,
              [userId, fromEmail],
            );
            if (!rec) return null;
            const sentBefore = await tx.maybeOne(`SELECT 1 FROM email_messages WHERE user_id = $1 AND recruiter_id = $2 AND send_status = 'sent'`, [userId, rec.id]);
            if (!sentBefore) return null;
            const row = await tx.one<{ id: string }>(
              `INSERT INTO email_threads (user_id, gmail_thread_id, recruiter_id, last_activity_at) VALUES ($1,$2,$3, now())
               ON CONFLICT (user_id, gmail_thread_id) DO UPDATE SET recruiter_id = COALESCE(email_threads.recruiter_id, EXCLUDED.recruiter_id) RETURNING id`,
              [userId, a.threadId, rec.id],
            );
            return { id: row.id, gmail_thread_id: a.threadId, recruiter_id: rec.id, recruiter_email: rec.email } satisfies ThreadRow;
          });
          if (!created) continue;
          thread = created;
          byGmailId.set(a.threadId, created);
          // A reply in a brand-new thread: count it against the latest email we sent this recruiter.
          const c = await deps.db.withUser(userId, (tx) => applyNewThreadReply(tx, userId, accountEmail, created, meta));
          if (c) processed++;
          if (c === 'reply') replies++;
          continue;
        }
        fetched++;
        const meta = await client.getMessageMetadata(a.id);
        const c = await deps.db.withUser(userId, (tx) => applyThreadMessage(tx, userId, accountEmail, thread!, meta));
        if (c) processed++;
        if (c === 'reply') replies++;
      }
    }
    await saveCursor(deps, userId, newHistoryId, null);
    return { status: 'ok', mode, processed, replies };
  } catch (err) {
    if (err instanceof GmailApiError && err.kind === 'auth') {
      await markNeedsReauth(deps, userId, err.message);
      return { status: 'error', reason: 'GMAIL_REAUTH_REQUIRED', processed: 0, replies: 0 };
    }
    const message = err instanceof Error ? err.message : 'Reply sync failed';
    await deps.db.withSystem((tx) => tx.query(`UPDATE oauth_connections SET sync_error = $2, last_sync_at = now() WHERE user_id = $1`, [userId, message.slice(0, 300)]));
    deps.logger.warn({ err: message, userId }, 'reply sync failed');
    return { status: 'error', reason: message, processed: 0, replies: 0 };
  }
}

/** A recruiter answered in a new thread (not a reply in ours). */
async function applyNewThreadReply(tx: Tx, userId: string, accountEmail: string, thread: ThreadRow, meta: GmailMessageMeta): Promise<InboundClassification | null> {
  const last = await tx.maybeOne<{ gmail_thread_id: string | null }>(
    `SELECT gmail_thread_id FROM email_messages WHERE user_id = $1 AND recruiter_id = $2 AND send_status = 'sent' ORDER BY sent_at DESC LIMIT 1`,
    [userId, thread.recruiter_id],
  );
  if (!last?.gmail_thread_id) return null;
  // Attribute to the conversation we started, but store under the new thread.
  const proxyThread = { ...thread, gmail_thread_id: last.gmail_thread_id };
  const classification = await applyThreadMessage(tx, userId, accountEmail, { ...proxyThread, id: thread.id }, meta);
  return classification;
}

async function saveCursor(deps: Deps, userId: string, historyId: string, syncError: string | null): Promise<void> {
  await deps.db.withSystem((tx) =>
    tx.query(`UPDATE oauth_connections SET history_id = $2, last_sync_at = now(), sync_error = $3 WHERE user_id = $1 AND provider = 'google_gmail'`, [userId, historyId, syncError]),
  );
}

/** Worker: sync every active connection that can read metadata, at most every 3 minutes. */
export async function syncAllReplies(deps: Deps): Promise<number> {
  const users = await deps.db.withSystem((tx) =>
    tx.many<{ user_id: string }>(
      `SELECT user_id FROM oauth_connections
       WHERE status = 'active' AND (last_sync_at IS NULL OR last_sync_at < now() - interval '150 seconds')
         AND scopes && ARRAY['https://www.googleapis.com/auth/gmail.metadata','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/']::text[]
         AND EXISTS (SELECT 1 FROM email_threads t WHERE t.user_id = oauth_connections.user_id)
       ORDER BY last_sync_at NULLS FIRST LIMIT 20`,
    ),
  );
  for (const u of users) await syncUserReplies(deps, u.user_id);
  return users.length;
}
