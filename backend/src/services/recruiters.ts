import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import {
  duplicateSuggestionKey,
  isRoleAddress,
  isValidEmail,
  normalizeCompanyName,
  normalizeEmail,
  type DuplicateSuggestion,
  type OutreachStatus,
  type Paginated,
  type RecruiterCreate,
  type RecruiterDetail,
  type RecruiterListQuery,
  type RecruiterSummary,
  type RecruiterUpdate,
} from '@autoreach/shared';
import type { Tx } from '../db/pool.js';
import { badRequest, conflict, isUniqueViolation, notFound } from '../errors.js';
import { logActivity } from './activity.js';
import { ensureCompany } from './companies.js';
import { MESSAGE_SUMMARY_SELECT } from './messageQueries.js';
import { FOLLOW_UP_SELECT } from './followupQueries.js';

export const RECRUITER_SELECT = `
  SELECT r.id, r.full_name, r.email, r.company, r.company_id, r.title, r.linkedin_url, r.company_website,
    r.source, r.source_url, r.target_role, r.outreach_status, r.email_verification, r.do_not_contact,
    r.notes, r.tags, r.last_contacted_at, r.last_reply_at,
    (SELECT min(f.due_at) FROM follow_ups f WHERE f.recruiter_id = r.id AND f.status = 'pending') AS next_follow_up_at,
    (SELECT count(*)::int FROM email_messages m WHERE m.recruiter_id = r.id AND m.send_status = 'sent') AS messages_sent,
    (SELECT count(*)::int FROM recruiter_opportunities ro WHERE ro.recruiter_id = r.id) AS opportunity_count,
    r.created_at, r.updated_at
  FROM recruiters r`;

type RecruiterRow = Omit<RecruiterSummary, 'is_role_address'>;

export function toSummary(row: RecruiterRow): RecruiterSummary {
  return { ...row, tags: row.tags ?? [], is_role_address: isRoleAddress(row.email) };
}

const SORTS: Record<RecruiterListQuery['sort'], string> = {
  recent_contact: 'last_contacted_at DESC NULLS LAST, created_at DESC',
  followup_due: 'next_follow_up_at ASC NULLS LAST, last_contacted_at DESC NULLS LAST',
  created_desc: 'created_at DESC',
  name: 'lower(coalesce(full_name, email)) ASC',
  company: 'lower(coalesce(company, \'\')) ASC, lower(coalesce(full_name, email)) ASC',
};

export async function listRecruiters(tx: Tx, userId: string, q: RecruiterListQuery): Promise<Paginated<RecruiterSummary>> {
  const where = ['r.user_id = $1', 'r.merged_into_id IS NULL'];
  const params: unknown[] = [userId];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replaceAll('$?', `$${params.length}`));
  };
  if (q.q) add(`(r.full_name ILIKE $? OR r.email ILIKE $? OR r.company ILIKE $? OR r.title ILIKE $?)`, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`);
  if (q.status) add('r.outreach_status = $?', q.status);
  if (q.source) add('r.source = $?', q.source);
  if (q.tag) add('$? = ANY(r.tags)', q.tag);
  if (q.opportunity_id) add('EXISTS (SELECT 1 FROM recruiter_opportunities ro WHERE ro.recruiter_id = r.id AND ro.opportunity_id = $?)', q.opportunity_id);
  if (q.role) {
    add(
      `(r.target_role ILIKE $? OR EXISTS (SELECT 1 FROM recruiter_opportunities ro JOIN opportunities o ON o.id = ro.opportunity_id
        WHERE ro.recruiter_id = r.id AND o.title ILIKE $?))`,
      `%${q.role.replace(/[%_\\]/g, '\\$&')}%`,
    );
  }
  if (q.added_from) add('r.created_at >= $?::date', q.added_from);
  if (q.added_to) add(`r.created_at < ($?::date + interval '1 day')`, q.added_to);

  const total = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM recruiters r WHERE ${where.join(' AND ')}`, params);
  params.push(q.page_size, (q.page - 1) * q.page_size);
  const rows = await tx.many<RecruiterRow>(
    `SELECT * FROM (${RECRUITER_SELECT} WHERE ${where.join(' AND ')}) x
     ORDER BY ${SORTS[q.sort]}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows.map(toSummary), total: total.n, page: q.page, page_size: q.page_size };
}

export async function getRecruiterSummary(tx: Tx, userId: string, id: string): Promise<RecruiterSummary | null> {
  const row = await tx.maybeOne<RecruiterRow>(`${RECRUITER_SELECT} WHERE r.user_id = $1 AND r.id = $2`, [userId, id]);
  return row ? toSummary(row) : null;
}

export async function getRecruiterDetail(tx: Tx, userId: string, id: string): Promise<RecruiterDetail> {
  const summary = await getRecruiterSummary(tx, userId, id);
  if (!summary) throw notFound('Recruiter');
  const opportunities = await tx.many(
    `SELECT o.id, o.title, o.company_name AS company, o.status FROM recruiter_opportunities ro
     JOIN opportunities o ON o.id = ro.opportunity_id WHERE ro.recruiter_id = $1 ORDER BY o.created_at DESC`,
    [id],
  );
  const messages = await tx.many(`${MESSAGE_SUMMARY_SELECT} WHERE m.user_id = $1 AND m.recruiter_id = $2 ORDER BY coalesce(m.sent_at, m.created_at) DESC`, [userId, id]);
  const followUps = await tx.many(`${FOLLOW_UP_SELECT} WHERE f.user_id = $1 AND f.recruiter_id = $2 ORDER BY f.due_at DESC`, [userId, id]);
  const mergedFrom = await tx.many(`SELECT id, email, full_name FROM recruiters WHERE merged_into_id = $1 AND user_id = $2`, [id, userId]);
  return { ...summary, opportunities, messages, follow_ups: followUps, merged_from: mergedFrom } as RecruiterDetail;
}

export async function findActiveByEmail(tx: Tx, userId: string, email: string): Promise<RecruiterSummary | null> {
  const row = await tx.maybeOne<RecruiterRow>(`${RECRUITER_SELECT} WHERE r.user_id = $1 AND r.email_normalized = $2 AND r.merged_into_id IS NULL`, [
    userId,
    normalizeEmail(email),
  ]);
  return row ? toSummary(row) : null;
}

async function duplicateError(tx: Tx, userId: string, email: string) {
  const existing = await findActiveByEmail(tx, userId, email);
  return conflict('DUPLICATE_RECRUITER', `${email} is already in your recruiters${existing?.full_name ? ` as ${existing.full_name}` : ''}.`, {
    existing,
  });
}

export async function createRecruiter(tx: Tx, userId: string, input: RecruiterCreate): Promise<RecruiterSummary> {
  const email = input.email.trim();
  if (await findActiveByEmail(tx, userId, email)) throw await duplicateError(tx, userId, email);
  const companyId = await ensureCompany(tx, userId, input.company, input.company_website);
  let id: string;
  try {
    ({ id } = await tx.one<{ id: string }>(
      `INSERT INTO recruiters (user_id, full_name, email, email_normalized, company, company_id, title, linkedin_url,
         company_website, source, source_url, target_role, email_verification, notes, tags, outreach_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'new') RETURNING id`,
      [
        userId,
        input.full_name ?? null,
        email,
        normalizeEmail(email),
        input.company ?? null,
        companyId,
        input.title ?? null,
        input.linkedin_url ?? null,
        input.company_website ?? null,
        input.source,
        input.source_url ?? null,
        input.target_role ?? null,
        input.email_verification,
        input.notes ?? null,
        input.tags ?? [],
      ],
    ));
  } catch (err) {
    if (isUniqueViolation(err)) throw await duplicateError(tx, userId, email);
    throw err;
  }
  if (input.opportunity_id) await linkRecruiterToOpportunity(tx, userId, id, input.opportunity_id);
  await logActivity(
    tx,
    userId,
    'recruiter_added',
    `Added ${input.full_name || email}${input.company ? ` (${input.company})` : ''}`,
    { recruiterId: id, opportunityId: input.opportunity_id ?? null },
    { source: input.source },
  );
  return (await getRecruiterSummary(tx, userId, id))!;
}

export async function linkRecruiterToOpportunity(tx: Tx, userId: string, recruiterId: string, opportunityId: string): Promise<void> {
  const ok = await tx.maybeOne(
    `SELECT 1 FROM recruiters r, opportunities o WHERE r.id = $1 AND o.id = $2 AND r.user_id = $3 AND o.user_id = $3 AND r.merged_into_id IS NULL`,
    [recruiterId, opportunityId, userId],
  );
  if (!ok) throw notFound('Recruiter or opportunity');
  await tx.query(
    `INSERT INTO recruiter_opportunities (user_id, recruiter_id, opportunity_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [userId, recruiterId, opportunityId],
  );
}

export async function unlinkRecruiterFromOpportunity(tx: Tx, userId: string, recruiterId: string, opportunityId: string): Promise<void> {
  await tx.query(`DELETE FROM recruiter_opportunities WHERE user_id = $1 AND recruiter_id = $2 AND opportunity_id = $3`, [userId, recruiterId, opportunityId]);
}

export async function updateRecruiter(tx: Tx, userId: string, id: string, patch: RecruiterUpdate): Promise<RecruiterSummary> {
  const current = await getRecruiterSummary(tx, userId, id);
  if (!current) throw notFound('Recruiter');
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) fields[k] = v;

  if (typeof fields.email === 'string') {
    const email = fields.email.trim();
    fields.email = email;
    if (normalizeEmail(email) !== normalizeEmail(current.email)) {
      const other = await findActiveByEmail(tx, userId, email);
      if (other && other.id !== id) throw await duplicateError(tx, userId, email);
      fields.email_normalized = normalizeEmail(email);
      // A changed address is whatever the user says it is now.
      if (patch.email_verification === undefined) fields.email_verification = 'provided';
    }
  }
  if ('company' in fields || 'company_website' in fields) {
    fields.company_id = await ensureCompany(
      tx,
      userId,
      (fields.company as string | null | undefined) ?? current.company,
      (fields.company_website as string | null | undefined) ?? current.company_website,
    );
  }
  if (fields.outreach_status === 'do_not_contact') fields.do_not_contact = true;
  if (fields.do_not_contact === true && !fields.outreach_status) fields.outreach_status = 'do_not_contact';
  if (fields.do_not_contact === false && current.outreach_status === 'do_not_contact' && !fields.outreach_status) {
    fields.outreach_status = current.last_contacted_at ? 'contacted' : 'new';
  }

  const entries = Object.entries(fields);
  if (entries.length) {
    try {
      await tx.query(
        `UPDATE recruiters SET ${entries.map(([k], i) => `${k} = $${i + 3}`).join(', ')} WHERE user_id = $1 AND id = $2`,
        [userId, id, ...entries.map(([, v]) => v)],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw await duplicateError(tx, userId, String(fields.email));
      throw err;
    }
  }
  if (fields.do_not_contact === true) {
    await tx.query(
      `UPDATE follow_ups SET status = 'cancelled', cancel_reason = 'do_not_contact' WHERE user_id = $1 AND recruiter_id = $2 AND status = 'pending'`,
      [userId, id],
    );
    await tx.query(
      `UPDATE email_messages SET send_status = 'draft', scheduled_for = NULL, queued_at = NULL
       WHERE user_id = $1 AND recruiter_id = $2 AND send_status = 'queued'`,
      [userId, id],
    );
  }
  if (patch.outreach_status && patch.outreach_status !== current.outreach_status) {
    await logActivity(tx, userId, 'recruiter_updated', `${current.full_name || current.email}: status → ${patch.outreach_status}`, { recruiterId: id });
  }
  return (await getRecruiterSummary(tx, userId, id))!;
}

export async function deleteRecruiter(tx: Tx, userId: string, id: string): Promise<void> {
  // Husks merged into this row go too (their history was already re-pointed).
  await tx.query(`DELETE FROM recruiters WHERE user_id = $1 AND merged_into_id = $2`, [userId, id]);
  const res = await tx.query(`DELETE FROM recruiters WHERE user_id = $1 AND id = $2`, [userId, id]);
  if (!res.rowCount) throw notFound('Recruiter');
}

const STATUS_RANK: Record<OutreachStatus, number> = {
  new: 0,
  contacted: 1,
  not_interested: 2,
  replied: 3,
  interviewing: 4,
  bounced: 5,
  do_not_contact: 6,
};

/** Merge `sourceId` into `targetId`, moving every reference. Nothing is deleted. */
export async function mergeRecruiters(tx: Tx, userId: string, targetId: string, sourceId: string): Promise<RecruiterSummary> {
  if (targetId === sourceId) throw badRequest('Choose two different recruiters to merge.');
  const rows = await tx.many<RecruiterSummary & { merged_into_id: string | null }>(
    `SELECT r.*, r.merged_into_id FROM recruiters r WHERE r.user_id = $1 AND r.id = ANY($2::uuid[]) FOR UPDATE`,
    [userId, [targetId, sourceId]],
  );
  const target = rows.find((r) => r.id === targetId);
  const source = rows.find((r) => r.id === sourceId);
  if (!target || !source) throw notFound('Recruiter');
  if (target.merged_into_id || source.merged_into_id) throw badRequest('One of these recruiters was already merged.');

  const moves: Array<[string, unknown[]]> = [
    [`UPDATE email_messages SET recruiter_id = $2 WHERE user_id = $3 AND recruiter_id = $1`, [sourceId, targetId, userId]],
    [`UPDATE follow_ups SET recruiter_id = $2 WHERE user_id = $3 AND recruiter_id = $1`, [sourceId, targetId, userId]],
    [`UPDATE email_threads SET recruiter_id = $2 WHERE user_id = $3 AND recruiter_id = $1`, [sourceId, targetId, userId]],
    [`UPDATE activity_log SET recruiter_id = $2 WHERE user_id = $3 AND recruiter_id = $1`, [sourceId, targetId, userId]],
    [`UPDATE recruiters SET merged_into_id = $2 WHERE user_id = $3 AND merged_into_id = $1`, [sourceId, targetId, userId]],
    [
      `INSERT INTO recruiter_opportunities (user_id, recruiter_id, opportunity_id)
       SELECT user_id, $2, opportunity_id FROM recruiter_opportunities WHERE recruiter_id = $1 AND user_id = $3
       ON CONFLICT DO NOTHING`,
      [sourceId, targetId, userId],
    ],
    [`DELETE FROM recruiter_opportunities WHERE recruiter_id = $1 AND user_id = $2`, [sourceId, userId]],
  ];
  for (const [sql, params] of moves) await tx.query(sql, params);

  const status = STATUS_RANK[source.outreach_status] > STATUS_RANK[target.outreach_status] ? source.outreach_status : target.outreach_status;
  const notes = [target.notes, source.notes ? `Merged from ${source.email}: ${source.notes}` : null].filter(Boolean).join('\n\n') || null;
  await tx.query(
    `UPDATE recruiters SET
       full_name = COALESCE(full_name, $3), title = COALESCE(title, $4), company = COALESCE(company, $5),
       company_id = COALESCE(company_id, $6), linkedin_url = COALESCE(linkedin_url, $7), company_website = COALESCE(company_website, $8),
       target_role = COALESCE(target_role, $9), tags = ARRAY(SELECT DISTINCT unnest(tags || $10::text[])),
       notes = $11, outreach_status = $12, do_not_contact = do_not_contact OR $13,
       last_contacted_at = GREATEST(last_contacted_at, $14), last_reply_at = GREATEST(last_reply_at, $15),
       followup_count = GREATEST(followup_count, $16)
     WHERE user_id = $1 AND id = $2`,
    [
      userId,
      targetId,
      source.full_name,
      source.title,
      source.company,
      source.company_id,
      source.linkedin_url,
      source.company_website,
      source.target_role,
      source.tags ?? [],
      notes,
      status,
      source.do_not_contact,
      source.last_contacted_at,
      source.last_reply_at,
      (source as unknown as { followup_count: number }).followup_count ?? 0,
    ],
  );
  await tx.query(`UPDATE recruiters SET merged_into_id = $2 WHERE user_id = $1 AND id = $3`, [userId, targetId, sourceId]);
  await logActivity(tx, userId, 'recruiters_merged', `Merged ${source.email} into ${target.email}`, { recruiterId: targetId }, { source_id: sourceId });
  return (await getRecruiterSummary(tx, userId, targetId))!;
}

export async function duplicateSuggestions(tx: Tx, userId: string): Promise<DuplicateSuggestion[]> {
  const rows = await tx.many<{ id: string; full_name: string | null; email: string; company: string | null; messages_sent: number; created_at: string }>(
    `SELECT r.id, r.full_name, r.email, r.company, r.created_at,
       (SELECT count(*)::int FROM email_messages m WHERE m.recruiter_id = r.id AND m.send_status = 'sent') AS messages_sent
     FROM recruiters r WHERE r.user_id = $1 AND r.merged_into_id IS NULL`,
    [userId],
  );
  const groups = new Map<string, { reason: DuplicateSuggestion['reason']; ids: Set<string> }>();
  const push = (key: string, reason: DuplicateSuggestion['reason'], id: string) => {
    const g = groups.get(key) ?? { reason, ids: new Set<string>() };
    g.ids.add(id);
    groups.set(key, g);
  };
  for (const r of rows) {
    push(`email:${duplicateSuggestionKey(r.email)}`, 'same_canonical_email', r.id);
    const name = (r.full_name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const company = normalizeCompanyName(r.company ?? '');
    if (name.includes(' ') && company) push(`name:${name}|${company}`, 'same_name_and_company', r.id);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: DuplicateSuggestion[] = [];
  for (const g of groups.values()) {
    if (g.ids.size < 2) continue;
    const key = [...g.ids].sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ reason: g.reason, recruiters: [...g.ids].map((id) => byId.get(id)!) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* CSV import / export                                                 */
/* ------------------------------------------------------------------ */

const HEADER_ALIASES: Record<string, string[]> = {
  email: ['email', 'email address', 'e-mail', 'work email', 'mail'],
  full_name: ['name', 'full name', 'hr name', 'hr_name', 'recruiter', 'recruiter name', 'contact name'],
  first_name: ['first name', 'firstname', 'first'],
  last_name: ['last name', 'lastname', 'surname', 'last'],
  company: ['company', 'company name', 'organization', 'organisation', 'employer'],
  title: ['title', 'job title', 'position', 'designation', 'recruiter title'],
  target_role: ['role', 'target role', 'applying for', 'opening'],
  linkedin_url: ['linkedin', 'linkedin url', 'linkedin profile'],
  company_website: ['website', 'company website', 'url'],
  notes: ['notes', 'note', 'comments'],
  tags: ['tags', 'tag', 'labels'],
};

function canonicalHeader(h: string): string | null {
  const k = h.trim().toLowerCase().replace(/[_]+/g, ' ');
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.includes(k)) return field;
  return null;
}

export interface ImportRowResult {
  row: number;
  email: string;
  full_name: string | null;
  company: string | null;
  status: 'new' | 'duplicate_existing' | 'duplicate_in_file' | 'invalid';
  reason?: string;
  role_address?: boolean;
}

export interface ImportResult {
  dry_run: boolean;
  total_rows: number;
  created: number;
  duplicates: number;
  invalid: number;
  rows: ImportRowResult[];
  unmapped_headers: string[];
}

const MAX_IMPORT_ROWS = 5000;

const cleanUrl = (v: string | undefined) => (v && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim().slice(0, 2048) : null);

export async function importRecruitersCsv(
  tx: Tx,
  userId: string,
  csvText: string,
  opts: { dryRun: boolean; defaultTags: string[] },
): Promise<ImportResult> {
  let records: Record<string, string>[];
  try {
    records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true }) as Record<string, string>[];
  } catch (err) {
    throw badRequest(`Could not read the CSV: ${(err as Error).message.slice(0, 200)}`, undefined, 'INVALID_CSV');
  }
  if (records.length > MAX_IMPORT_ROWS) throw badRequest(`CSV has ${records.length} rows; the limit is ${MAX_IMPORT_ROWS}.`, undefined, 'CSV_TOO_LARGE');
  const headers = records[0] ? Object.keys(records[0]) : [];
  const headerMap = new Map(headers.map((h) => [h, canonicalHeader(h)]));
  if (![...headerMap.values()].includes('email')) throw badRequest('The CSV needs an "Email" column.', { headers }, 'CSV_NO_EMAIL_COLUMN');

  const existing = new Set(
    (await tx.many<{ e: string }>(`SELECT email_normalized AS e FROM recruiters WHERE user_id = $1 AND merged_into_id IS NULL`, [userId])).map((r) => r.e),
  );
  const seenInFile = new Set<string>();
  const results: ImportRowResult[] = [];
  const toInsert: Array<Record<string, unknown>> = [];

  records.forEach((rec, idx) => {
    const v: Record<string, string> = {};
    for (const [h, val] of Object.entries(rec)) {
      const f = headerMap.get(h);
      if (f && val !== undefined && val !== '') v[f] = String(val).trim();
    }
    const email = (v.email ?? '').trim();
    const fullName = (v.full_name ?? [v.first_name, v.last_name].filter(Boolean).join(' ')).trim().slice(0, 120) || null;
    const base = { row: idx + 2, email, full_name: fullName, company: v.company?.slice(0, 160) ?? null };
    if (!isValidEmail(email)) {
      results.push({ ...base, status: 'invalid', reason: email ? 'Not a valid email address' : 'Missing email' });
      return;
    }
    const norm = normalizeEmail(email);
    if (existing.has(norm)) {
      results.push({ ...base, status: 'duplicate_existing', reason: 'Already in your recruiters' });
      return;
    }
    if (seenInFile.has(norm)) {
      results.push({ ...base, status: 'duplicate_in_file', reason: 'Appears earlier in this file' });
      return;
    }
    seenInFile.add(norm);
    results.push({ ...base, status: 'new', role_address: isRoleAddress(email) });
    const tags = [
      ...opts.defaultTags,
      ...(v.tags ?? '')
        .split(/[;,|]/)
        .map((t) => t.trim())
        .filter(Boolean),
    ]
      .map((t) => t.slice(0, 40))
      .slice(0, 20);
    toInsert.push({
      full_name: fullName,
      email,
      email_normalized: norm,
      company: base.company,
      title: v.title?.slice(0, 160) ?? null,
      target_role: v.target_role?.slice(0, 160) ?? null,
      linkedin_url: cleanUrl(v.linkedin_url),
      company_website: cleanUrl(v.company_website),
      notes: v.notes?.slice(0, 4000) ?? null,
      tags: [...new Set(tags)],
    });
  });

  let created = 0;
  if (!opts.dryRun) {
    for (const r of toInsert) {
      const companyId = await ensureCompany(tx, userId, r.company as string | null, r.company_website as string | null);
      const res = await tx.query(
        `INSERT INTO recruiters (user_id, full_name, email, email_normalized, company, company_id, title, target_role, linkedin_url,
           company_website, notes, tags, source, email_verification, outreach_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'csv','provided','new')
         ON CONFLICT (user_id, email_normalized) WHERE merged_into_id IS NULL DO NOTHING`,
        [userId, r.full_name, r.email, r.email_normalized, r.company, companyId, r.title, r.target_role, r.linkedin_url, r.company_website, r.notes, r.tags],
      );
      created += res.rowCount ?? 0;
    }
    if (created) await logActivity(tx, userId, 'recruiters_imported', `Imported ${created} recruiter${created === 1 ? '' : 's'} from CSV`, {}, { created });
  }

  return {
    dry_run: opts.dryRun,
    total_rows: records.length,
    created,
    duplicates: results.filter((r) => r.status.startsWith('duplicate')).length,
    invalid: results.filter((r) => r.status === 'invalid').length,
    rows: results,
    unmapped_headers: headers.filter((h) => !headerMap.get(h)),
  };
}

export async function exportRecruitersCsv(tx: Tx, userId: string): Promise<string> {
  const rows = await tx.many(
    `SELECT * FROM (${RECRUITER_SELECT} WHERE r.user_id = $1 AND r.merged_into_id IS NULL) x ORDER BY created_at`,
    [userId],
  );
  return stringify(
    rows.map((r) => ({
      Name: r.full_name ?? '',
      Email: r.email,
      Company: r.company ?? '',
      Title: r.title ?? '',
      'Target role': r.target_role ?? '',
      Status: r.outreach_status,
      'Email verification': r.email_verification,
      'Do not contact': r.do_not_contact ? 'yes' : '',
      Source: r.source,
      LinkedIn: r.linkedin_url ?? '',
      Website: r.company_website ?? '',
      Tags: (r.tags ?? []).join('; '),
      Notes: r.notes ?? '',
      'Messages sent': r.messages_sent,
      'Last contacted': r.last_contacted_at ? new Date(r.last_contacted_at).toISOString() : '',
      'Last reply': r.last_reply_at ? new Date(r.last_reply_at).toISOString() : '',
      'Next follow-up': r.next_follow_up_at ? new Date(r.next_follow_up_at).toISOString() : '',
      Added: new Date(r.created_at).toISOString(),
    })),
    { header: true, cast: { string: (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s) } },
  );
}

/** Used by the extension on Gmail: what do we know about these addresses? */
export async function lookupByEmails(tx: Tx, userId: string, emails: string[]) {
  const normalized = [...new Set(emails.map(normalizeEmail).filter(isValidEmail))].slice(0, 50);
  if (!normalized.length) return [];
  const rows = await tx.many<RecruiterRow & { email_normalized: string }>(
    `SELECT * FROM (${RECRUITER_SELECT} WHERE r.user_id = $1 AND r.email_normalized = ANY($2::text[]) AND r.merged_into_id IS NULL) x`,
    [userId, normalized],
  );
  const out = [];
  for (const email of normalized) {
    const rec = rows.find((r) => normalizeEmail(r.email) === email);
    if (!rec) {
      out.push({ email, recruiter: null, messages: [] });
      continue;
    }
    const messages = await tx.many(
      `${MESSAGE_SUMMARY_SELECT} WHERE m.user_id = $1 AND m.recruiter_id = $2 AND m.send_status <> 'draft'
       ORDER BY coalesce(m.sent_at, m.created_at) DESC LIMIT 5`,
      [userId, rec.id],
    );
    out.push({ email, recruiter: toSummary(rec), messages });
  }
  return out;
}

/** The sender's own Gmail tab is showing a thread with these recipients (extension signal). */
export async function markSelfView(tx: Tx, userId: string, emails: string[], seconds = 20): Promise<void> {
  const normalized = [...new Set(emails.map(normalizeEmail))];
  await tx.query(
    `UPDATE recruiters SET self_view_until = now() + make_interval(secs => $3)
     WHERE user_id = $1 AND email_normalized = ANY($2::text[]) AND merged_into_id IS NULL`,
    [userId, normalized, seconds],
  );
}
