import { randomUUID } from 'node:crypto';
import {
  attachmentDisplayName,
  findPlaceholders,
  hasBlockingFindings,
  isValidEmail,
  normalizeEmail,
  startOfLocalDay,
  type DraftCreate,
  type DraftUpdate,
  type MessageDetail,
  type MessageSummary,
  type Paginated,
  type QualityFinding,
  type SendRequest,
  type UserSettings,
} from '@autoreach/shared';
import type { Deps } from '../context.js';
import type { Tx } from '../db/pool.js';
import { AppError, badRequest, conflict, isUniqueViolation, notFound, unprocessable } from '../errors.js';
import { randomToken } from '../lib/crypto.js';
import { sleep } from '../lib/http.js';
import { logActivity } from './activity.js';
import { buildDraftContext, qualityFor } from './drafting.js';
import { afterMessageSent, cancelPendingFollowUps } from './followups.js';
import { GmailApiError } from './gmail/client.js';
import { connectionStatus, getAuthorizedGmail, markNeedsReauth } from './gmail/connection.js';
import { buildMime, textToHtml, toBase64Url } from './gmail/mime.js';
import { MESSAGE_SUMMARY_SELECT } from './messageQueries.js';
import { linkRecruiterToOpportunity } from './recruiters.js';
import { markOpportunityContacted } from './opportunities.js';
import { loadVerifiedAttachment, type VerifiedAttachment } from './resumes.js';
import { getSettings } from './settings.js';

interface MessageRow {
  id: string;
  user_id: string;
  recruiter_id: string | null;
  opportunity_id: string | null;
  campaign_id: string | null;
  resume_id: string | null;
  follow_up_id: string | null;
  parent_message_id: string | null;
  kind: 'initial' | 'follow_up';
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  body_text: string;
  manual_role: string | null;
  send_status: 'draft' | 'queued' | 'sending' | 'sent' | 'failed' | 'unknown';
  scheduled_for: string | null;
  sent_at: string | null;
  attempt_count: number;
  idempotency_key: string | null;
  tracking_enabled: boolean;
  tracking_token: string | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  rfc_message_id: string | null;
  reply_status: string;
  ai_generated: boolean;
  generation_meta: Record<string, unknown> | null;
  legacy: boolean;
}

async function loadMessage(tx: Tx, userId: string, id: string, lock = false): Promise<MessageRow> {
  const row = await tx.maybeOne<MessageRow>(`SELECT * FROM email_messages WHERE user_id = $1 AND id = $2${lock ? ' FOR UPDATE' : ''}`, [userId, id]);
  if (!row) throw notFound('Message');
  return row;
}

export async function getMessageSummary(tx: Tx, userId: string, id: string): Promise<MessageSummary> {
  const row = await tx.maybeOne<MessageSummary>(`${MESSAGE_SUMMARY_SELECT} WHERE m.user_id = $1 AND m.id = $2`, [userId, id]);
  if (!row) throw notFound('Message');
  return row;
}

export async function getMessageDetail(tx: Tx, userId: string, id: string): Promise<MessageDetail> {
  const summary = await getMessageSummary(tx, userId, id);
  const extra = await tx.one<{ body_text: string; resume_id: string | null; attachment_snapshot: MessageDetail['attachment']; manual_role: string | null; follow_up_id: string | null; parent_message_id: string | null }>(
    `SELECT body_text, resume_id, attachment_snapshot, manual_role, follow_up_id, parent_message_id FROM email_messages WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  const events = await tx.many(
    `SELECT id, occurred_at, classification, ua_family, counted FROM email_events WHERE user_id = $1 AND message_id = $2 ORDER BY occurred_at DESC LIMIT 100`,
    [userId, id],
  );
  const thread = summary.gmail_thread_id
    ? await tx.many(
        `SELECT tm.id, tm.received_at AS occurred_at, tm.from_email, tm.subject, tm.classification, tm.needs_review
         FROM thread_messages tm JOIN email_threads t ON t.id = tm.thread_id
         WHERE t.user_id = $1 AND t.gmail_thread_id = $2 AND tm.direction = 'inbound' ORDER BY tm.received_at ASC`,
        [userId, summary.gmail_thread_id],
      )
    : [];
  return {
    ...summary,
    body_text: extra.body_text,
    resume_id: extra.resume_id,
    attachment: extra.attachment_snapshot,
    manual_role: extra.manual_role,
    follow_up_id: extra.follow_up_id,
    parent_message_id: extra.parent_message_id,
    events,
    thread,
    gmail_url: summary.gmail_thread_id ? `https://mail.google.com/mail/u/0/#all/${summary.gmail_thread_id}` : null,
  } as MessageDetail;
}

export async function listMessages(
  tx: Tx,
  userId: string,
  q: { recruiter_id?: string; opportunity_id?: string; campaign_id?: string; send_status?: string; reply_status?: string; kind?: string; q?: string; page: number; page_size: number },
): Promise<Paginated<MessageSummary>> {
  const where = ['m.user_id = $1'];
  const params: unknown[] = [userId];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replaceAll('$?', `$${params.length}`));
  };
  if (q.recruiter_id) add('m.recruiter_id = $?', q.recruiter_id);
  if (q.opportunity_id) add('m.opportunity_id = $?', q.opportunity_id);
  if (q.campaign_id) add('m.campaign_id = $?', q.campaign_id);
  if (q.send_status) add('m.send_status = $?', q.send_status);
  if (q.reply_status) add('m.reply_status = $?', q.reply_status);
  if (q.kind) add('m.kind = $?', q.kind);
  if (q.q) add('(m.subject ILIKE $? OR m.recipient_email ILIKE $? OR r.full_name ILIKE $? OR r.company ILIKE $?)', `%${q.q.replace(/[%_\\]/g, '\\$&')}%`);
  const total = await tx.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM email_messages m LEFT JOIN recruiters r ON r.id = m.recruiter_id WHERE ${where.join(' AND ')}`,
    params,
  );
  params.push(q.page_size, (q.page - 1) * q.page_size);
  const items = await tx.many<MessageSummary>(
    `${MESSAGE_SUMMARY_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY coalesce(m.sent_at, m.scheduled_for, m.updated_at) DESC, m.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items, total: total.n, page: q.page, page_size: q.page_size };
}

/* ------------------------------------------------------------------ */
/* Drafts                                                              */
/* ------------------------------------------------------------------ */

export async function createDraft(deps: Deps, tx: Tx, userId: string, input: DraftCreate & { follow_up_of_message_id?: string | null }): Promise<MessageDetail> {
  const recruiter = await tx.maybeOne<{ id: string; email: string; full_name: string | null; merged_into_id: string | null }>(
    `SELECT id, email, full_name, merged_into_id FROM recruiters WHERE user_id = $1 AND id = $2`,
    [userId, input.recruiter_id],
  );
  if (!recruiter || recruiter.merged_into_id) throw notFound('Recruiter');
  if (input.opportunity_id && !(await tx.maybeOne(`SELECT 1 FROM opportunities WHERE user_id = $1 AND id = $2`, [userId, input.opportunity_id]))) {
    throw notFound('Opportunity');
  }
  if (input.campaign_id && !(await tx.maybeOne(`SELECT 1 FROM campaigns WHERE user_id = $1 AND id = $2`, [userId, input.campaign_id]))) {
    throw notFound('Campaign');
  }
  const settings = await getSettings(tx, userId);
  const resumeId = input.resume_id === undefined ? settings.default_resume_id : input.resume_id;
  if (resumeId && !(await tx.maybeOne(`SELECT 1 FROM resumes WHERE user_id = $1 AND id = $2`, [userId, resumeId]))) throw notFound('Résumé');

  let kind: 'initial' | 'follow_up' = 'initial';
  let followUpId: string | null = null;
  let parentId: string | null = null;
  if (input.follow_up_id) {
    const fu = await tx.maybeOne<{ id: string; previous_message_id: string; recruiter_id: string; status: string }>(
      `SELECT id, previous_message_id, recruiter_id, status FROM follow_ups WHERE user_id = $1 AND id = $2`,
      [userId, input.follow_up_id],
    );
    if (!fu || fu.recruiter_id !== recruiter.id) throw notFound('Follow-up');
    if (fu.status !== 'pending') throw badRequest('This follow-up reminder is no longer pending.');
    const existing = await tx.maybeOne<{ id: string }>(
      `SELECT id FROM email_messages WHERE user_id = $1 AND follow_up_id = $2 AND send_status IN ('draft','failed','queued') ORDER BY created_at DESC LIMIT 1`,
      [userId, fu.id],
    );
    if (existing) {
      // One draft per reminder: update it instead of creating a duplicate.
      await updateDraft(tx, userId, existing.id, { subject: input.subject, body_text: input.body_text });
      return getMessageDetail(tx, userId, existing.id);
    }
    kind = 'follow_up';
    followUpId = fu.id;
    parentId = fu.previous_message_id;
  } else if (input.follow_up_of_message_id) {
    const parent = await tx.maybeOne<{ id: string; recruiter_id: string | null; send_status: string }>(
      `SELECT id, recruiter_id, send_status FROM email_messages WHERE user_id = $1 AND id = $2`,
      [userId, input.follow_up_of_message_id],
    );
    if (!parent || parent.recruiter_id !== recruiter.id || parent.send_status !== 'sent') throw badRequest('You can only follow up on a sent email to the same recruiter.');
    kind = 'follow_up';
    parentId = parent.id;
    const pending = await tx.maybeOne<{ id: string }>(
      `SELECT id FROM follow_ups WHERE user_id = $1 AND recruiter_id = $2 AND status = 'pending' AND previous_message_id = $3`,
      [userId, recruiter.id, parent.id],
    );
    followUpId = pending?.id ?? null;
  }

  const trackingEnabled = (input.tracking_enabled ?? settings.tracking_enabled) && deps.config.tracking.configured;
  const row = await tx.one<{ id: string }>(
    `INSERT INTO email_messages (user_id, recruiter_id, opportunity_id, campaign_id, resume_id, follow_up_id, parent_message_id, kind,
       recipient_email, recipient_name, subject, body_text, manual_role, send_status, tracking_enabled, ai_generated, generation_meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14,$15,$16) RETURNING id`,
    [
      userId,
      recruiter.id,
      input.opportunity_id ?? null,
      input.campaign_id ?? null,
      resumeId ?? null,
      followUpId,
      parentId,
      kind,
      recruiter.email,
      recruiter.full_name,
      input.subject ?? '',
      input.body_text ?? '',
      input.manual_role ?? null,
      trackingEnabled,
      input.ai_generated ?? false,
      input.generation_meta ? JSON.stringify(input.generation_meta) : null,
    ],
  );
  if (input.opportunity_id) await linkRecruiterToOpportunity(tx, userId, recruiter.id, input.opportunity_id);
  return getMessageDetail(tx, userId, row.id);
}

export async function updateDraft(tx: Tx, userId: string, id: string, patch: DraftUpdate): Promise<void> {
  const msg = await loadMessage(tx, userId, id, true);
  if (!['draft', 'failed'].includes(msg.send_status)) throw conflict('NOT_EDITABLE', 'Only drafts and failed messages can be edited.');
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) fields[k] = v;
  if (fields.resume_id) {
    if (!(await tx.maybeOne(`SELECT 1 FROM resumes WHERE user_id = $1 AND id = $2`, [userId, fields.resume_id]))) throw notFound('Résumé');
  }
  if (fields.opportunity_id) {
    if (!(await tx.maybeOne(`SELECT 1 FROM opportunities WHERE user_id = $1 AND id = $2`, [userId, fields.opportunity_id]))) throw notFound('Opportunity');
  }
  if (fields.campaign_id) {
    if (!(await tx.maybeOne(`SELECT 1 FROM campaigns WHERE user_id = $1 AND id = $2`, [userId, fields.campaign_id]))) throw notFound('Campaign');
  }
  const entries = Object.entries(fields);
  if (!entries.length) return;
  await tx.query(`UPDATE email_messages SET ${entries.map(([k], i) => `${k} = $${i + 3}`).join(', ')} WHERE user_id = $1 AND id = $2`, [
    userId,
    id,
    ...entries.map(([, v]) => v),
  ]);
}

export async function deleteDraft(tx: Tx, userId: string, id: string): Promise<void> {
  const msg = await loadMessage(tx, userId, id, true);
  if (!['draft', 'failed'].includes(msg.send_status)) throw conflict('NOT_DELETABLE', 'Only drafts and failed messages can be deleted. Sent emails stay in your history.');
  await tx.query(`DELETE FROM email_messages WHERE user_id = $1 AND id = $2`, [userId, id]);
}

/** Pull an approved-but-unsent message back to a draft. */
export async function cancelQueued(tx: Tx, userId: string, id: string): Promise<void> {
  const res = await tx.query(
    `UPDATE email_messages SET send_status = 'draft', scheduled_for = NULL, queued_at = NULL WHERE user_id = $1 AND id = $2 AND send_status = 'queued'`,
    [userId, id],
  );
  if (!res.rowCount) throw conflict('NOT_QUEUED', 'This message is not waiting in the queue (it may already be sending).');
}

/* ------------------------------------------------------------------ */
/* Send pipeline                                                       */
/* ------------------------------------------------------------------ */

export interface SendOutcome {
  outcome: 'sent' | 'failed' | 'unknown' | 'queued';
  message: MessageDetail;
  error?: { code: string; message: string };
}

async function sentToday(tx: Tx, userId: string, tz: string, now: Date): Promise<number> {
  const r = await tx.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM email_messages
     WHERE user_id = $1 AND send_status IN ('sent', 'sending', 'unknown') AND coalesce(sent_at, sending_started_at) >= $2`,
    [userId, startOfLocalDay(tz, now)],
  );
  return r.n;
}

export { sentToday };

/**
 * Serialises "count today's sends, then claim one" per user, so two sends approved at
 * the same moment (two tabs, the queue worker and a manual send) can't both slip under
 * the daily limit. Held until the claiming transaction commits.
 */
async function lockSendSlot(tx: Tx, userId: string): Promise<void> {
  await tx.query(`SELECT 1 FROM user_settings WHERE user_id = $1 FOR UPDATE`, [userId]);
}

/**
 * Validates everything that must be true before an email may leave, given
 * the user's explicit confirmations. Throws AppError with a specific code.
 */
async function preflight(deps: Deps, tx: Tx, userId: string, msg: MessageRow, req: SendRequest, settings: UserSettings, opts: { automated: boolean }): Promise<void> {
  if (!msg.recruiter_id) throw unprocessable('RECIPIENT_MISSING', 'This message is not linked to a recruiter anymore.');
  const rec = await tx.maybeOne<{ id: string; email: string; outreach_status: string; do_not_contact: boolean; email_verification: string; merged_into_id: string | null; last_reply_at: string | null }>(
    `SELECT id, email, outreach_status, do_not_contact, email_verification, merged_into_id, last_reply_at FROM recruiters WHERE user_id = $1 AND id = $2`,
    [userId, msg.recruiter_id],
  );
  if (!rec || rec.merged_into_id) throw unprocessable('RECIPIENT_MISSING', 'The recruiter for this message no longer exists.');
  if (rec.do_not_contact || rec.outreach_status === 'do_not_contact') throw unprocessable('DO_NOT_CONTACT', 'This recruiter is marked do-not-contact.');
  if (rec.outreach_status === 'bounced') throw unprocessable('RECIPIENT_BOUNCED', 'A previous email to this address bounced. Update the address before sending again.');
  if (normalizeEmail(rec.email) !== normalizeEmail(msg.recipient_email)) {
    // The recruiter's address changed after the draft was created: follow the recruiter.
    await tx.query(`UPDATE email_messages SET recipient_email = $3 WHERE user_id = $1 AND id = $2`, [userId, msg.id, rec.email]);
    msg.recipient_email = rec.email;
  }
  if (!isValidEmail(msg.recipient_email)) throw unprocessable('INVALID_RECIPIENT', `${msg.recipient_email} is not a valid email address.`);
  if (rec.email_verification === 'unverified_guess') {
    if (opts.automated || !req.confirm_unverified_email) {
      throw conflict('UNVERIFIED_EMAIL', `${rec.email} was inferred, not provided. Confirm the address is correct before sending.`);
    }
    await tx.query(`UPDATE recruiters SET email_verification = 'confirmed' WHERE user_id = $1 AND id = $2`, [userId, rec.id]);
  }
  if (rec.last_reply_at || ['replied', 'interviewing', 'not_interested'].includes(rec.outreach_status)) {
    if (opts.automated || !req.confirm_after_reply) {
      throw conflict('RECRUITER_REPLIED', 'This recruiter has already replied. Reply from Gmail, or confirm that you want to send this email anyway.');
    }
  }
  if (msg.kind === 'initial') {
    const prior = await tx.one<{ n: number; last: string | null }>(
      `SELECT count(*)::int AS n, max(coalesce(sent_at, scheduled_for, updated_at)) AS last FROM email_messages
       WHERE user_id = $1 AND id <> $2 AND send_status IN ('sent', 'queued', 'sending', 'unknown')
         AND (recruiter_id = $3 OR lower(recipient_email) = lower($4))`,
      [userId, msg.id, rec.id, msg.recipient_email],
    );
    if (prior.n > 0 && (opts.automated ? !msg.generation_meta?.duplicate_confirmed : !req.confirm_duplicate)) {
      throw conflict(
        'DUPLICATE_OUTREACH',
        `You have already emailed ${msg.recipient_email} (${prior.n} message${prior.n > 1 ? 's' : ''}). Send a follow-up instead, or confirm this is a new outreach.`,
        { previous_count: prior.n, last: prior.last },
      );
    }
  }
  if (!msg.subject.trim() || !msg.body_text.trim()) throw unprocessable('EMPTY_MESSAGE', 'Add a subject and a message before sending.');
  if (settings.require_resume_attachment && !msg.resume_id) {
    throw unprocessable('RESUME_REQUIRED', 'Your settings require a résumé attachment. Select a résumé or turn off the requirement in Settings.');
  }

  // Quality gate: blocking findings need an explicit override (never for automated sends).
  let findings: QualityFinding[] = [];
  try {
    const ctx = await buildDraftContext(deps, tx, userId, {
      recruiter_id: rec.id,
      opportunity_id: msg.opportunity_id,
      manual_role: msg.manual_role,
      resume_id: msg.resume_id,
      kind: msg.kind,
    });
    findings = qualityFor(ctx, msg.kind, msg.subject, msg.body_text, !!msg.resume_id).filter((f) => !(msg.kind === 'initial' && f.code === 'PREVIOUSLY_CONTACTED'));
  } catch (err) {
    if (!(err instanceof AppError && err.code === 'PROFILE_INCOMPLETE')) throw err;
    const placeholders = findPlaceholders(`${msg.subject}\n${msg.body_text}`);
    if (placeholders.length) findings = [{ code: 'PLACEHOLDER_LEFT', severity: 'error', message: `Unfilled placeholders: ${placeholders.join(', ')}.` }];
  }
  const overridden = opts.automated ? msg.generation_meta?.quality_override_confirmed === true : req.confirm_quality_override;
  if (hasBlockingFindings(findings) && !overridden) {
    throw unprocessable('QUALITY_CHECK_FAILED', 'The quality check found problems that should be fixed before sending.', { findings });
  }

  if (settings.sending_paused) throw conflict('SENDING_PAUSED', 'Sending is paused. Resume sending in Settings or from the extension.');
  const gmail = await connectionStatus(deps, tx, userId);
  if (!gmail.configured) throw new AppError(503, 'GMAIL_NOT_CONFIGURED', deps.config.gmail.reason ?? 'Gmail is not configured on the server.');
  if (!gmail.connected) throw conflict('GMAIL_NOT_CONNECTED', 'Connect your Gmail account in Settings before sending.');
  if (gmail.status === 'needs_reauth') throw conflict('GMAIL_REAUTH_REQUIRED', 'Gmail access expired or was revoked. Reconnect Gmail in Settings.');
  if (!gmail.can_send) throw conflict('GMAIL_SCOPE_MISSING', 'AutoReach is not allowed to send from this Gmail account. Reconnect Gmail and allow sending.');
}

/** API entry point: explicit user approval of one message. */
export async function sendMessage(deps: Deps, userId: string, id: string, idempotencyKey: string, req: SendRequest): Promise<SendOutcome> {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) throw badRequest('A valid Idempotency-Key header is required.', undefined, 'IDEMPOTENCY_KEY_REQUIRED');

  const phaseA = await deps.db.withUser(userId, async (tx) => {
    // Replay of the same request (double click, network retry): return the current state.
    const replay = await tx.maybeOne<{ id: string; send_status: string }>(
      `SELECT id, send_status FROM email_messages WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey],
    );
    if (replay) {
      if (replay.id !== id) throw conflict('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different message.');
      return { replay: true as const };
    }
    const msg = await loadMessage(tx, userId, id, true);
    if (msg.send_status === 'sending') throw conflict('ALREADY_SENDING', 'This message is already being sent.');
    if (msg.send_status === 'sent') throw conflict('ALREADY_SENT', 'This message was already sent.');
    if (msg.send_status === 'unknown') throw conflict('OUTCOME_UNKNOWN', 'The last attempt may have been sent. Check Gmail and resolve it before retrying.');
    if (msg.send_status === 'queued') throw conflict('ALREADY_QUEUED', 'This message is already approved and queued.');
    const settings = await getSettings(tx, userId);
    await preflight(deps, tx, userId, msg, req, settings, { automated: false });

    const sendAt = req.send_at ? new Date(req.send_at) : null;
    // A time already in the past is almost always a mistake (wrong day or time zone); never send it right away.
    if (sendAt && sendAt.getTime() < deps.now().getTime() - 60_000) {
      throw badRequest('The scheduled time is in the past. Pick a later time, or send now.', undefined, 'SEND_AT_IN_PAST');
    }
    const meta = {
      ...(msg.generation_meta ?? {}),
      ...(req.confirm_duplicate ? { duplicate_confirmed: true } : {}),
      ...(req.confirm_quality_override ? { quality_override_confirmed: true } : {}),
    };
    if (req.queue || (sendAt && sendAt.getTime() > deps.now().getTime() + 30_000)) {
      try {
        await tx.query(
          `UPDATE email_messages SET send_status = 'queued', queued_at = now(), scheduled_for = $3, idempotency_key = $4,
             generation_meta = $5::jsonb, error_code = NULL, error_message = NULL
           WHERE user_id = $1 AND id = $2`,
          [userId, id, sendAt ? sendAt.toISOString() : null, idempotencyKey, JSON.stringify(meta)],
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('ALREADY_IN_FLIGHT', 'Another email to this recruiter is already queued or sending.');
        throw err;
      }
      await logActivity(tx, userId, 'email_queued', sendAt ? `Scheduled "${msg.subject.slice(0, 100)}" for ${sendAt.toISOString()}` : `Queued "${msg.subject.slice(0, 100)}"`, {
        recruiterId: msg.recruiter_id,
        messageId: msg.id,
      });
      return { queued: true as const };
    }

    await lockSendSlot(tx, userId);
    const limitReached = (await sentToday(tx, userId, settings.timezone, deps.now())) >= settings.daily_send_limit;
    if (limitReached) {
      throw new AppError(429, 'DAILY_LIMIT_REACHED', `You've reached your daily limit of ${settings.daily_send_limit} emails. Schedule it for tomorrow or raise the limit in Settings.`);
    }
    await claimForSending(tx, userId, msg, idempotencyKey, meta);
    return { claimed: true as const };
  });

  if ('replay' in phaseA || 'queued' in phaseA) {
    const message = await deps.db.withUser(userId, (tx) => getMessageDetail(tx, userId, id));
    return { outcome: message.send_status === 'queued' ? 'queued' : (message.send_status as SendOutcome['outcome']), message };
  }
  return deliver(deps, userId, id);
}

async function claimForSending(tx: Tx, userId: string, msg: MessageRow, idempotencyKey: string | null, meta: Record<string, unknown>): Promise<void> {
  try {
    const res = await tx.query(
      `UPDATE email_messages SET send_status = 'sending', sending_started_at = now(), attempt_count = attempt_count + 1,
         idempotency_key = COALESCE($3, idempotency_key), generation_meta = $4::jsonb, error_code = NULL, error_message = NULL,
         tracking_token = CASE WHEN tracking_enabled THEN COALESCE(tracking_token, $5) ELSE NULL END
       WHERE user_id = $1 AND id = $2 AND send_status IN ('draft', 'failed', 'queued')`,
      [userId, msg.id, idempotencyKey, JSON.stringify(meta), randomToken(16)],
    );
    if (!res.rowCount) throw conflict('ALREADY_SENDING', 'This message is already being sent.');
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('ALREADY_IN_FLIGHT', 'Another email to this recruiter is already queued or sending.');
    throw err;
  }
}

/**
 * Phase B + C: build the MIME, call Gmail once, record the outcome.
 * The message must already be in 'sending' state (claimed).
 */
export async function deliver(deps: Deps, userId: string, id: string): Promise<SendOutcome> {
  const { msg, settings, parent, original } = await deps.db.withUser(userId, async (tx) => {
    const m = await loadMessage(tx, userId, id);
    const s = await getSettings(tx, userId);
    const p = m.parent_message_id
      ? await tx.maybeOne<{ gmail_thread_id: string | null; rfc_message_id: string | null; subject: string }>(
          `SELECT gmail_thread_id, rfc_message_id, subject FROM email_messages WHERE user_id = $1 AND id = $2`,
          [userId, m.parent_message_id],
        )
      : null;
    const o = m.follow_up_id
      ? await tx.maybeOne<{ rfc_message_id: string | null }>(
          `SELECT om.rfc_message_id FROM follow_ups f JOIN email_messages om ON om.id = f.original_message_id WHERE f.user_id = $1 AND f.id = $2`,
          [userId, m.follow_up_id],
        )
      : null;
    return { msg: m, settings: s, parent: p, original: o };
  });
  if (msg.send_status !== 'sending') throw conflict('NOT_CLAIMED', 'Message is not in the sending state.');

  const profile = await deps.db.withUser(userId, (tx) => tx.maybeOne<{ full_name: string }>(`SELECT full_name FROM profiles WHERE user_id = $1`, [userId]));

  // ---- Phase B: everything that can fail without sending ----------------
  let attachment: VerifiedAttachment | null = null;
  let gmailClientInfo: Awaited<ReturnType<typeof getAuthorizedGmail>>;
  try {
    if (msg.resume_id) attachment = await deps.db.withUser(userId, (tx) => loadVerifiedAttachment(tx, deps.storage, userId, msg.resume_id!));
    else if (settings.require_resume_attachment) throw unprocessable('RESUME_REQUIRED', 'A résumé attachment is required but none is selected.');
    gmailClientInfo = await getAuthorizedGmail(deps, userId, 'send');
  } catch (err) {
    const e = err instanceof AppError ? err : new AppError(500, 'SEND_PREPARATION_FAILED', 'Could not prepare the email for sending.');
    if (!(err instanceof AppError)) deps.logger.error({ err, messageId: id }, 'send preparation failed');
    return recordFailure(deps, userId, id, e.code, e.message);
  }

  let subject = msg.subject.trim();
  if (msg.kind === 'follow_up' && parent?.subject) {
    const base = parent.subject.replace(/^(re:\s*)+/i, '');
    if (subject.replace(/^(re:\s*)+/i, '').toLowerCase() !== base.toLowerCase()) subject = `Re: ${base}`;
    else if (!/^re:/i.test(subject)) subject = `Re: ${base}`;
  }
  const pixelUrl = msg.tracking_enabled && msg.tracking_token && deps.config.tracking.configured ? `${deps.config.apiPublicUrl}/t/${msg.tracking_token}.gif` : null;
  const fileName = attachment ? attachmentDisplayName(attachment.fileName, settings.attachment_filename) : undefined;
  const references = [original?.rfc_message_id, parent?.rfc_message_id].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  let raw: string;
  try {
    raw = buildMime({
      from: { email: gmailClientInfo.accountEmail, name: profile?.full_name || null },
      to: { email: msg.recipient_email, name: msg.recipient_name },
      subject,
      text: msg.body_text,
      html: textToHtml(msg.body_text, pixelUrl),
      attachments: attachment ? [{ filename: fileName ?? attachment.fileName, mimeType: attachment.mimeType, data: attachment.data }] : [],
      inReplyTo: msg.kind === 'follow_up' ? parent?.rfc_message_id ?? null : null,
      references: msg.kind === 'follow_up' ? references : [],
      date: deps.now(),
    });
  } catch (err) {
    return recordFailure(deps, userId, id, 'MIME_BUILD_FAILED', (err as Error).message);
  }

  // ---- Phase B': the single, non-retried Gmail call ---------------------
  // Preparation can be slow (storage, token refresh). If the stale-send sweeper or the user
  // took this attempt over meanwhile, stop: nothing has been handed to Gmail yet. Refreshing
  // sending_started_at gives the Gmail call itself the sweeper's full window.
  const stillClaimed = await deps.db.withUser(userId, (tx) =>
    tx.maybeOne(`UPDATE email_messages SET sending_started_at = now() WHERE user_id = $1 AND id = $2 AND send_status = 'sending' AND attempt_count = $3 RETURNING id`, [
      userId,
      id,
      msg.attempt_count,
    ]),
  );
  if (!stillClaimed) return abandonAttempt(deps, userId, id, msg.attempt_count);
  let gmailIds: { id: string; threadId: string };
  try {
    gmailIds = await gmailClientInfo.client.send(toBase64Url(raw), msg.kind === 'follow_up' ? parent?.gmail_thread_id ?? null : null);
  } catch (err) {
    if (err instanceof GmailApiError) {
      if (err.outcome === 'unknown') return recordUnknown(deps, userId, id, err.message);
      if (err.kind === 'auth') {
        await markNeedsReauth(deps, userId, err.message);
        return recordFailure(deps, userId, id, 'GMAIL_REAUTH_REQUIRED', 'Gmail access expired or was revoked. Reconnect Gmail in Settings, then send again.');
      }
      const code = { scope: 'GMAIL_SCOPE_MISSING', rate_limit: 'GMAIL_RATE_LIMITED', quota: 'GMAIL_QUOTA_EXCEEDED', invalid: 'GMAIL_REJECTED', not_found: 'GMAIL_REJECTED', server: 'GMAIL_SERVER_ERROR', network: 'GMAIL_UNREACHABLE', auth: 'GMAIL_REAUTH_REQUIRED' }[err.kind];
      return recordFailure(deps, userId, id, code, err.message);
    }
    deps.logger.error({ err, messageId: id }, 'unexpected error calling Gmail');
    return recordUnknown(deps, userId, id, 'Unexpected error while handing the message to Gmail.');
  }

  // ---- Phase C: record success (retried — Gmail already accepted it) -----
  const sentAt = deps.now().toISOString();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await deps.db.withUser(userId, async (tx) => {
        const updated = await tx.one<{ id: string; recruiter_id: string | null; opportunity_id: string | null; sent_at: string; kind: 'initial' | 'follow_up'; follow_up_id: string | null; parent_message_id: string | null; subject: string }>(
          `UPDATE email_messages SET send_status = 'sent', sent_at = $3, gmail_message_id = $4, gmail_thread_id = $5, subject = $6,
             attachment_snapshot = $7::jsonb, tracking_enabled = ($8::text IS NOT NULL), error_code = NULL, error_message = NULL
           WHERE user_id = $1 AND id = $2
           RETURNING id, recruiter_id, opportunity_id, sent_at, kind, follow_up_id, parent_message_id, subject`,
          [
            userId,
            id,
            sentAt,
            gmailIds.id,
            gmailIds.threadId,
            subject,
            attachment ? JSON.stringify({ file_name: fileName ?? attachment.fileName, size_bytes: attachment.sizeBytes, sha256: attachment.sha256 }) : null,
            pixelUrl,
          ],
        );
        if (updated.recruiter_id) {
          await tx.query(
            `UPDATE recruiters SET last_contacted_at = $3, last_sent_at = $3,
               outreach_status = CASE WHEN outreach_status = 'new' THEN 'contacted' ELSE outreach_status END
             WHERE user_id = $1 AND id = $2`,
            [userId, updated.recruiter_id, sentAt],
          );
          await tx.query(
            `INSERT INTO email_threads (user_id, gmail_thread_id, recruiter_id, first_message_id, last_activity_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id, gmail_thread_id) DO UPDATE SET last_activity_at = EXCLUDED.last_activity_at`,
            [userId, gmailIds.threadId, updated.recruiter_id, id, sentAt],
          );
        }
        if (updated.opportunity_id) await markOpportunityContacted(tx, userId, updated.opportunity_id);
        await afterMessageSent(tx, userId, updated, settings);
        await logActivity(tx, userId, 'email_sent', `Sent "${subject.slice(0, 120)}" to ${msg.recipient_email}`, { recruiterId: updated.recruiter_id, opportunityId: updated.opportunity_id, messageId: id }, {
          kind: msg.kind,
          attachment: !!attachment,
          tracking: !!pixelUrl,
        });
      });
      break;
    } catch (err) {
      deps.logger.error({ err, messageId: id, attempt }, 'Gmail accepted the message but recording it failed');
      if (attempt === 3) {
        // The stale-sending sweeper will mark it 'unknown'; the Gmail ids are logged for recovery.
        deps.logger.fatal({ messageId: id, gmailMessageId: gmailIds.id, gmailThreadId: gmailIds.threadId }, 'could not record a sent message');
        throw new AppError(500, 'SEND_RECORDING_FAILED', 'The email was sent, but AutoReach could not record it. It will appear as "outcome unknown".');
      }
      await sleep(500 * (attempt + 1));
    }
  }

  // Best effort: read the RFC Message-ID so follow-ups thread correctly for the recipient.
  if (gmailClientInfo.canDetectReplies) {
    try {
      const meta = await gmailClientInfo.client.getMessageMetadata(gmailIds.id, ['Message-ID']);
      const rfc = meta.payload?.headers?.find((h) => h.name.toLowerCase() === 'message-id')?.value ?? null;
      if (rfc) await deps.db.withUser(userId, (tx) => tx.query(`UPDATE email_messages SET rfc_message_id = $3 WHERE user_id = $1 AND id = $2`, [userId, id, rfc]));
    } catch (err) {
      deps.logger.warn({ err: (err as Error).message, messageId: id }, 'could not read Message-ID header');
    }
  }

  const message = await deps.db.withUser(userId, (tx) => getMessageDetail(tx, userId, id));
  return { outcome: 'sent', message };
}

/** This attempt lost its claim before calling Gmail, so it certainly wasn't sent by it. */
async function abandonAttempt(deps: Deps, userId: string, id: string, attempt: number): Promise<SendOutcome> {
  const message = 'Preparing this email took too long, so it was stopped before reaching Gmail. Nothing was sent; you can send it again.';
  const detail = await deps.db.withUser(userId, async (tx) => {
    // Only undo the sweeper's "unknown" for this same attempt; a newer attempt or the user's own resolution wins.
    await tx.query(
      `UPDATE email_messages SET send_status = 'failed', failed_at = now(), error_code = 'SEND_PREPARATION_TIMEOUT', error_message = $4
       WHERE user_id = $1 AND id = $2 AND attempt_count = $3 AND send_status = 'unknown' AND error_code = 'SEND_OUTCOME_UNKNOWN'`,
      [userId, id, attempt, message],
    );
    return getMessageDetail(tx, userId, id);
  });
  return { outcome: detail.send_status === 'sent' ? 'sent' : detail.send_status === 'unknown' ? 'unknown' : 'failed', message: detail, error: { code: 'SEND_PREPARATION_TIMEOUT', message } };
}

async function recordFailure(deps: Deps, userId: string, id: string, code: string, message: string): Promise<SendOutcome> {
  const detail = await deps.db.withUser(userId, async (tx) => {
    await tx.query(
      `UPDATE email_messages SET send_status = 'failed', failed_at = now(), error_code = $3, error_message = $4 WHERE user_id = $1 AND id = $2 AND send_status = 'sending'`,
      [userId, id, code, message.slice(0, 500)],
    );
    const m = await getMessageDetail(tx, userId, id);
    await logActivity(tx, userId, 'email_failed', `Not sent: "${m.subject.slice(0, 100)}" — ${message.slice(0, 160)}`, { recruiterId: m.recruiter_id, messageId: id }, { code });
    return m;
  });
  return { outcome: 'failed', message: detail, error: { code, message } };
}

async function recordUnknown(deps: Deps, userId: string, id: string, message: string): Promise<SendOutcome> {
  const detail = await deps.db.withUser(userId, async (tx) => {
    await tx.query(
      `UPDATE email_messages SET send_status = 'unknown', error_code = 'SEND_OUTCOME_UNKNOWN', error_message = $3 WHERE user_id = $1 AND id = $2 AND send_status = 'sending'`,
      [userId, id, message.slice(0, 500)],
    );
    const m = await getMessageDetail(tx, userId, id);
    await logActivity(tx, userId, 'email_send_unknown', `Outcome unknown for "${m.subject.slice(0, 100)}" — check your Gmail Sent folder`, { recruiterId: m.recruiter_id, messageId: id });
    return m;
  });
  return {
    outcome: 'unknown',
    message: detail,
    error: { code: 'SEND_OUTCOME_UNKNOWN', message: 'Gmail did not confirm whether the email was sent. Check your Gmail Sent folder, then mark it as sent or failed.' },
  };
}

/** The user checked Gmail and tells us what happened to an 'unknown' send. */
export async function resolveUnknown(deps: Deps, tx: Tx, userId: string, id: string, outcome: 'sent' | 'failed'): Promise<MessageDetail> {
  const msg = await loadMessage(tx, userId, id, true);
  if (msg.send_status !== 'unknown') throw conflict('NOT_UNKNOWN', 'Only messages with an unknown outcome can be resolved.');
  if (outcome === 'failed') {
    await tx.query(
      `UPDATE email_messages SET send_status = 'failed', failed_at = now(), error_code = 'MARKED_NOT_SENT', error_message = 'You confirmed this email was not sent.' WHERE user_id = $1 AND id = $2`,
      [userId, id],
    );
  } else {
    // v1 rows have no sending_started_at; their creation time is when v1 attempted the send.
    const sentAt = (await tx.one<{ t: string }>(`SELECT coalesce(sending_started_at, created_at) AS t FROM email_messages WHERE id = $1`, [id])).t;
    await tx.query(
      `UPDATE email_messages SET send_status = 'sent', sent_at = $3, error_code = NULL, error_message = NULL WHERE user_id = $1 AND id = $2`,
      [userId, id, sentAt],
    );
    if (msg.recruiter_id) {
      await tx.query(
        `UPDATE recruiters SET last_contacted_at = GREATEST(last_contacted_at, $3), outreach_status = CASE WHEN outreach_status = 'new' THEN 'contacted' ELSE outreach_status END WHERE user_id = $1 AND id = $2`,
        [userId, msg.recruiter_id, sentAt],
      );
      // A v1 send from long ago shouldn't produce a reminder dated in the past.
      const settings = await getSettings(tx, userId);
      if (!msg.legacy) await afterMessageSent(tx, userId, { id, recruiter_id: msg.recruiter_id, sent_at: new Date(sentAt).toISOString(), kind: msg.kind, follow_up_id: msg.follow_up_id, parent_message_id: msg.parent_message_id }, settings);
    }
    await logActivity(tx, userId, 'email_sent', `Marked as sent: "${msg.subject.slice(0, 120)}"`, { recruiterId: msg.recruiter_id, messageId: id }, { manual_resolution: true });
  }
  return getMessageDetail(tx, userId, id);
}

/** Manual correction of reply status (e.g. a reply detection mistake). */
export async function correctReplyStatus(tx: Tx, userId: string, id: string, status: 'none' | 'replied' | 'auto_reply' | 'bounced' | 'needs_review', repliedAt?: string | null): Promise<MessageDetail> {
  const msg = await loadMessage(tx, userId, id, true);
  if (msg.send_status !== 'sent') throw badRequest('Only sent messages can have a reply status.');
  const at = status === 'replied' ? repliedAt ?? new Date().toISOString() : null;
  await tx.query(`UPDATE email_messages SET reply_status = $3, replied_at = $4 WHERE user_id = $1 AND id = $2`, [userId, id, status, at]);
  if (msg.recruiter_id) {
    if (status === 'replied') {
      await tx.query(
        `UPDATE recruiters SET last_reply_at = GREATEST(last_reply_at, $3), outreach_status = CASE WHEN outreach_status IN ('new','contacted') THEN 'replied' ELSE outreach_status END WHERE user_id = $1 AND id = $2`,
        [userId, msg.recruiter_id, at],
      );
      await cancelPendingFollowUps(tx, userId, msg.recruiter_id, 'reply_received');
      await logActivity(tx, userId, 'reply_received', `Marked as replied: "${msg.subject.slice(0, 100)}"`, { recruiterId: msg.recruiter_id, messageId: id }, { manual: true });
    } else if (status === 'bounced') {
      await tx.query(`UPDATE recruiters SET outreach_status = 'bounced' WHERE user_id = $1 AND id = $2`, [userId, msg.recruiter_id]);
      await cancelPendingFollowUps(tx, userId, msg.recruiter_id, 'bounced');
    } else if (status === 'none') {
      // Undo a wrong "replied": restore 'contacted' unless another message has a real reply.
      const other = await tx.maybeOne(`SELECT 1 FROM email_messages WHERE user_id = $1 AND recruiter_id = $2 AND id <> $3 AND reply_status = 'replied'`, [userId, msg.recruiter_id, id]);
      if (!other) {
        await tx.query(
          `UPDATE recruiters SET last_reply_at = NULL, outreach_status = CASE WHEN outreach_status IN ('replied','bounced') THEN 'contacted' ELSE outreach_status END WHERE user_id = $1 AND id = $2`,
          [userId, msg.recruiter_id],
        );
      }
    }
  }
  await tx.query(`UPDATE thread_messages SET needs_review = false, reviewed_at = now() WHERE user_id = $1 AND matched_message_id = $2 AND needs_review`, [userId, id]);
  return getMessageDetail(tx, userId, id);
}

/* ------------------------------------------------------------------ */
/* Queue worker                                                        */
/* ------------------------------------------------------------------ */

/**
 * Send messages the user approved for queued/scheduled delivery. Per user:
 * respects pause, the daily limit and randomised spacing; re-runs every
 * pre-flight check at send time (things may have changed since approval).
 */
export async function processSendQueue(deps: Deps, maxPerRun = 5): Promise<number> {
  // Each user's next due email, oldest first. Users waiting on spacing or at their daily
  // limit are skipped below, so the scan looks well past maxPerRun to keep them from
  // starving everyone else.
  const candidates = await deps.db.withSystem((tx) =>
    tx.many<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM (
         SELECT DISTINCT ON (m.user_id) m.id, m.user_id, coalesce(m.scheduled_for, m.queued_at) AS due
         FROM email_messages m JOIN user_settings s ON s.user_id = m.user_id
         WHERE m.send_status = 'queued' AND (m.scheduled_for IS NULL OR m.scheduled_for <= now()) AND NOT s.sending_paused
         ORDER BY m.user_id, coalesce(m.scheduled_for, m.queued_at) ASC, m.id
       ) next_per_user
       ORDER BY due ASC, id
       LIMIT $1`,
      [maxPerRun * 20],
    ),
  );
  let sent = 0;
  let delivered = 0;
  for (const c of candidates) {
    if (delivered >= maxPerRun) break;
    const claimed = await deps.db
      .withUser(c.user_id, async (tx) => {
        const msg = await tx.maybeOne<MessageRow>(`SELECT * FROM email_messages WHERE user_id = $1 AND id = $2 AND send_status = 'queued' FOR UPDATE SKIP LOCKED`, [c.user_id, c.id]);
        if (!msg) return false;
        const settings = await getSettings(tx, c.user_id);
        if (settings.sending_paused) return false;
        await lockSendSlot(tx, c.user_id);
        // Spacing between consecutive sends for this user.
        const last = await tx.maybeOne<{ t: string | null }>(
          `SELECT max(coalesce(sent_at, sending_started_at)) AS t FROM email_messages WHERE user_id = $1 AND send_status IN ('sent','sending','unknown')`,
          [c.user_id],
        );
        const spacing = (settings.send_spacing_min_seconds + Math.random() * (settings.send_spacing_max_seconds - settings.send_spacing_min_seconds)) * 1000;
        if (last?.t && deps.now().getTime() - new Date(last.t).getTime() < spacing) return false;
        if ((await sentToday(tx, c.user_id, settings.timezone, deps.now())) >= settings.daily_send_limit) return false;
        try {
          await preflight(deps, tx, c.user_id, msg, { confirm_duplicate: false, confirm_unverified_email: false, confirm_quality_override: false, confirm_after_reply: false, queue: true }, settings, {
            automated: true,
          });
        } catch (err) {
          if (err instanceof AppError) {
            // Conditions changed after approval: hand it back to the user as a draft with the reason.
            await tx.query(
              `UPDATE email_messages SET send_status = 'draft', scheduled_for = NULL, queued_at = NULL, error_code = $3, error_message = $4 WHERE id = $1 AND user_id = $2`,
              [msg.id, c.user_id, err.code, `Not sent from the queue: ${err.message}`.slice(0, 500)],
            );
            await logActivity(tx, c.user_id, 'email_failed', `Queued email returned to drafts: ${err.message.slice(0, 160)}`, { recruiterId: msg.recruiter_id, messageId: msg.id }, { code: err.code });
            return false;
          }
          throw err;
        }
        await claimForSending(tx, c.user_id, msg, null, msg.generation_meta ?? {});
        return true;
      })
      .catch((err) => {
        deps.logger.error({ err, messageId: c.id }, 'queue claim failed');
        return false;
      });
    if (!claimed) continue;
    delivered++;
    const result = await deliver(deps, c.user_id, c.id).catch((err) => {
      deps.logger.error({ err, messageId: c.id }, 'queued delivery failed');
      return null;
    });
    if (result?.outcome === 'sent') sent++;
  }
  return sent;
}

/** Messages stuck in 'sending' (process crash mid-send) become 'unknown' — never auto-resent. */
export async function sweepStaleSending(deps: Deps, olderThanMinutes = 10): Promise<number> {
  return deps.db.withSystem(async (tx) => {
    const rows = await tx.many<{ id: string; user_id: string; recruiter_id: string | null; subject: string }>(
      `UPDATE email_messages SET send_status = 'unknown', error_code = 'SEND_OUTCOME_UNKNOWN',
         error_message = 'The send was interrupted. Check your Gmail Sent folder and mark it as sent or failed.'
       WHERE send_status = 'sending' AND sending_started_at < now() - make_interval(mins => $1)
       RETURNING id, user_id, recruiter_id, subject`,
      [olderThanMinutes],
    );
    for (const r of rows) {
      await logActivity(tx, r.user_id, 'email_send_unknown', `Outcome unknown for "${r.subject.slice(0, 100)}" — check your Gmail Sent folder`, { recruiterId: r.recruiter_id, messageId: r.id });
    }
    return rows.length;
  });
}

export function newIdempotencyKey(): string {
  return randomUUID();
}
