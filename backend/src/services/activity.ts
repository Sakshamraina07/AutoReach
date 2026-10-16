import type { ActivityItem, ActivityType, Paginated } from '@autoreach/shared';
import type { Tx } from '../db/pool.js';

export interface ActivityRefs {
  recruiterId?: string | null;
  opportunityId?: string | null;
  messageId?: string | null;
}

export async function logActivity(
  tx: Tx,
  userId: string,
  type: ActivityType,
  summary: string,
  refs: ActivityRefs = {},
  metadata: Record<string, unknown> = {},
  occurredAt?: Date | string,
): Promise<void> {
  await tx.query(
    `INSERT INTO activity_log (user_id, type, summary, recruiter_id, opportunity_id, message_id, metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()))`,
    [userId, type, summary.slice(0, 500), refs.recruiterId ?? null, refs.opportunityId ?? null, refs.messageId ?? null, metadata, occurredAt ?? null],
  );
}

export async function listActivity(
  tx: Tx,
  userId: string,
  opts: { page: number; pageSize: number; recruiterId?: string; opportunityId?: string },
): Promise<Paginated<ActivityItem>> {
  const where = ['user_id = $1'];
  const params: unknown[] = [userId];
  if (opts.recruiterId) {
    params.push(opts.recruiterId);
    where.push(`recruiter_id = $${params.length}`);
  }
  if (opts.opportunityId) {
    params.push(opts.opportunityId);
    where.push(`opportunity_id = $${params.length}`);
  }
  const total = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM activity_log WHERE ${where.join(' AND ')}`, params);
  params.push(opts.pageSize, (opts.page - 1) * opts.pageSize);
  const items = await tx.many<ActivityItem>(
    `SELECT id, type, summary, recruiter_id, opportunity_id, message_id, occurred_at
     FROM activity_log WHERE ${where.join(' AND ')}
     ORDER BY occurred_at DESC, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items, total: total.n, page: opts.page, page_size: opts.pageSize };
}
