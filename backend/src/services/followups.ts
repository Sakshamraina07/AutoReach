import { addBusinessDays, businessDaysBetween, type FollowUp, type Paginated, type UserSettings } from '@autoreach/shared';
import type { Tx } from '../db/pool.js';
import { badRequest, notFound } from '../errors.js';
import { logActivity } from './activity.js';
import { FOLLOW_UP_SELECT } from './followupQueries.js';

interface SentMessage {
  id: string;
  recruiter_id: string | null;
  sent_at: string;
  kind: 'initial' | 'follow_up';
  follow_up_id: string | null;
  parent_message_id: string | null;
}

/** Called in the same transaction that records a successful send. */
export async function afterMessageSent(tx: Tx, userId: string, msg: SentMessage, settings: UserSettings): Promise<void> {
  if (!msg.recruiter_id) return;

  // A new email to this person supersedes any reminder that was still pending.
  const completed = await tx.many<{ id: string; original_message_id: string; step: number }>(
    `UPDATE follow_ups SET status = 'completed', completed_message_id = $3, completed_at = now()
     WHERE user_id = $1 AND recruiter_id = $2 AND status = 'pending'
     RETURNING id, original_message_id, step`,
    [userId, msg.recruiter_id, msg.id],
  );

  let originalId = msg.id;
  let nextStep = 1;
  if (msg.kind === 'follow_up') {
    await tx.query(`UPDATE recruiters SET followup_count = followup_count + 1 WHERE user_id = $1 AND id = $2`, [userId, msg.recruiter_id]);
    const own = msg.follow_up_id ? completed.find((c) => c.id === msg.follow_up_id) ?? (await tx.maybeOne<{ original_message_id: string; step: number }>(
      `SELECT original_message_id, step FROM follow_ups WHERE id = $1 AND user_id = $2`,
      [msg.follow_up_id, userId],
    )) : null;
    if (own) {
      originalId = own.original_message_id;
      nextStep = own.step + 1;
    } else {
      // Manual follow-up outside a reminder: continue the sequence of the parent conversation.
      const parent = msg.parent_message_id
        ? await tx.maybeOne<{ original_message_id: string; step: number }>(
            `SELECT original_message_id, max(step) AS step FROM follow_ups WHERE user_id = $1 AND (original_message_id = $2 OR previous_message_id = $2) GROUP BY original_message_id`,
            [userId, msg.parent_message_id],
          )
        : null;
      originalId = parent?.original_message_id ?? msg.parent_message_id ?? msg.id;
      nextStep = (parent?.step ?? 0) + 1;
    }
    for (const c of completed) {
      if (c.id !== msg.follow_up_id) {
        await logActivity(tx, userId, 'followup_completed', 'Follow-up reminder completed by a new email', { recruiterId: msg.recruiter_id, messageId: msg.id });
      }
    }
  }

  if (nextStep > settings.max_followups || nextStep > 3) return;
  const dueAt = addBusinessDays(msg.sent_at, settings.followup_delay_business_days, settings.timezone, 10);
  const inserted = await tx.maybeOne<{ id: string }>(
    `INSERT INTO follow_ups (user_id, recruiter_id, original_message_id, previous_message_id, step, due_at, auto_send)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (original_message_id, step) DO NOTHING RETURNING id`,
    [userId, msg.recruiter_id, originalId, msg.id, nextStep, dueAt, settings.followup_autosend_enabled],
  );
  if (inserted) {
    await logActivity(
      tx,
      userId,
      'followup_scheduled',
      `Follow-up ${nextStep} reminder set for ${new Date(dueAt).toISOString().slice(0, 10)}`,
      { recruiterId: msg.recruiter_id, messageId: msg.id },
      { due_at: dueAt, step: nextStep },
    );
  }
}

export async function cancelPendingFollowUps(tx: Tx, userId: string, recruiterId: string, reason: string): Promise<number> {
  const rows = await tx.many<{ id: string }>(
    `UPDATE follow_ups SET status = 'cancelled', cancel_reason = $3
     WHERE user_id = $1 AND recruiter_id = $2 AND status = 'pending' RETURNING id`,
    [userId, recruiterId, reason],
  );
  // Queued (approved, unsent) follow-up messages are pulled back to drafts as well.
  await tx.query(
    `UPDATE email_messages SET send_status = 'draft', scheduled_for = NULL, queued_at = NULL,
       error_code = 'FOLLOWUP_CANCELLED', error_message = $3
     WHERE user_id = $1 AND recruiter_id = $2 AND kind = 'follow_up' AND send_status = 'queued'`,
    [userId, recruiterId, `Not sent: ${reason.replace(/_/g, ' ')}.`],
  );
  if (rows.length) {
    await logActivity(tx, userId, 'followup_cancelled', `Cancelled ${rows.length} pending follow-up${rows.length > 1 ? 's' : ''} (${reason.replace(/_/g, ' ')})`, { recruiterId }, { reason });
  }
  return rows.length;
}

function withBusinessDays(rows: FollowUp[], tz: string, now: Date): FollowUp[] {
  return rows.map((r) => ({ ...r, business_days_since_contact: r.previous_sent_at ? businessDaysBetween(r.previous_sent_at, now, tz) : null }));
}

export async function listFollowUps(
  tx: Tx,
  userId: string,
  view: 'due' | 'upcoming' | 'all_pending' | 'closed',
  page: number,
  pageSize: number,
  tz: string,
  now: Date,
): Promise<Paginated<FollowUp>> {
  const where = ['f.user_id = $1', '$4::timestamptz IS NOT NULL'];
  let order = 'f.due_at ASC';
  if (view === 'due') where.push(`f.status = 'pending' AND f.due_at <= $4::timestamptz`);
  if (view === 'upcoming') where.push(`f.status = 'pending' AND f.due_at > $4::timestamptz`);
  if (view === 'all_pending') where.push(`f.status = 'pending'`);
  if (view === 'closed') {
    where.push(`f.status <> 'pending'`);
    order = 'f.updated_at DESC';
  }
  const total = await tx.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM follow_ups f WHERE ${where.join(' AND ')} AND $2::int IS NOT NULL AND $3::int IS NOT NULL`,
    [userId, pageSize, (page - 1) * pageSize, now.toISOString()],
  );
  const rows = await tx.many<FollowUp>(`${FOLLOW_UP_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $2 OFFSET $3`, [
    userId,
    pageSize,
    (page - 1) * pageSize,
    now.toISOString(),
  ]);
  return { items: withBusinessDays(rows, tz, now), total: total.n, page, page_size: pageSize };
}

export async function getFollowUp(tx: Tx, userId: string, id: string, tz: string, now: Date): Promise<FollowUp> {
  const row = await tx.maybeOne<FollowUp>(`${FOLLOW_UP_SELECT} WHERE f.user_id = $1 AND f.id = $2`, [userId, id]);
  if (!row) throw notFound('Follow-up');
  return withBusinessDays([row], tz, now)[0]!;
}

export async function updateFollowUp(
  tx: Tx,
  userId: string,
  id: string,
  patch: { status?: 'pending' | 'completed' | 'dismissed' | 'cancelled'; due_at?: string; auto_send?: boolean },
  tz: string,
  now: Date,
): Promise<FollowUp> {
  const current = await getFollowUp(tx, userId, id, tz, now);
  if (patch.due_at) {
    if (current.status !== 'pending') throw badRequest('Only pending follow-ups can be rescheduled.');
    await tx.query(`UPDATE follow_ups SET due_at = $3 WHERE user_id = $1 AND id = $2`, [userId, id, patch.due_at]);
    await logActivity(tx, userId, 'followup_rescheduled', `Follow-up for ${current.recruiter_name ?? current.recruiter_email} moved to ${patch.due_at.slice(0, 10)}`, {
      recruiterId: current.recruiter_id,
    });
  }
  if (patch.auto_send !== undefined) {
    await tx.query(`UPDATE follow_ups SET auto_send = $3 WHERE user_id = $1 AND id = $2`, [userId, id, patch.auto_send]);
  }
  if (patch.status && patch.status !== current.status) {
    if (patch.status === 'pending') {
      const replied = await tx.maybeOne(`SELECT 1 FROM recruiters WHERE id = $1 AND (do_not_contact OR outreach_status IN ('replied','bounced','do_not_contact','not_interested'))`, [current.recruiter_id]);
      if (replied) throw badRequest('This recruiter has replied, bounced or is marked do-not-contact; the reminder cannot be reopened.');
    }
    await tx.query(
      `UPDATE follow_ups SET status = $3, completed_at = CASE WHEN $3 IN ('completed','dismissed') THEN now() ELSE NULL END,
         cancel_reason = CASE WHEN $3 = 'pending' THEN NULL ELSE cancel_reason END
       WHERE user_id = $1 AND id = $2`,
      [userId, id, patch.status],
    );
    if (patch.status === 'dismissed' || patch.status === 'completed') {
      await logActivity(tx, userId, patch.status === 'dismissed' ? 'followup_dismissed' : 'followup_completed', `Follow-up for ${current.recruiter_name ?? current.recruiter_email} ${patch.status}`, {
        recruiterId: current.recruiter_id,
      });
    }
  }
  return getFollowUp(tx, userId, id, tz, now);
}
