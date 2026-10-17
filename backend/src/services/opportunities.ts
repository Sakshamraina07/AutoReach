import {
  classifyRoleCategory,
  extractExperienceRequirement,
  extractSkills,
  matchSkills,
  TERMINAL_OPPORTUNITY_STATUSES,
  type Opportunity,
  type OpportunityCreate,
  type OpportunityDetail,
  type OpportunityUpdate,
  type Paginated,
} from '@autoreach/shared';
import type { Tx } from '../db/pool.js';
import { notFound } from '../errors.js';
import { logActivity } from './activity.js';
import { ensureCompany } from './companies.js';
import { MESSAGE_SUMMARY_SELECT } from './messageQueries.js';
import { getProfile, verifiedSkills } from './profile.js';
import { linkRecruiterToOpportunity } from './recruiters.js';

export const OPPORTUNITY_SELECT = `
  SELECT o.id, o.company_name AS company, o.company_id, o.title, o.role_category, o.description, o.job_url, o.location,
    o.employment_type, o.required_skills, o.experience_requirements, o.discovered_at, o.deadline, o.status, o.source,
    o.source_url, o.notes, o.company_notes, o.analysis,
    (SELECT count(*)::int FROM recruiter_opportunities ro WHERE ro.opportunity_id = o.id) AS recruiter_count,
    (SELECT count(*)::int FROM email_messages m WHERE m.opportunity_id = o.id AND m.send_status = 'sent') AS messages_sent,
    (SELECT count(*)::int FROM email_messages m WHERE m.opportunity_id = o.id AND m.reply_status = 'replied') AS replies,
    o.created_at, o.updated_at
  FROM opportunities o`;

export async function listOpportunities(
  tx: Tx,
  userId: string,
  q: { q?: string; status?: string; active?: 'true' | 'false'; page: number; page_size: number },
): Promise<Paginated<Opportunity>> {
  const where = ['o.user_id = $1'];
  const params: unknown[] = [userId];
  if (q.q) {
    params.push(`%${q.q.replace(/[%_\\]/g, '\\$&')}%`);
    where.push(`(o.title ILIKE $${params.length} OR o.company_name ILIKE $${params.length} OR o.location ILIKE $${params.length})`);
  }
  if (q.status) {
    params.push(q.status);
    where.push(`o.status = $${params.length}`);
  }
  if (q.active) {
    params.push(TERMINAL_OPPORTUNITY_STATUSES);
    where.push(q.active === 'true' ? `NOT (o.status = ANY($${params.length}::text[]))` : `o.status = ANY($${params.length}::text[])`);
  }
  const total = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM opportunities o WHERE ${where.join(' AND ')}`, params);
  params.push(q.page_size, (q.page - 1) * q.page_size);
  const items = await tx.many<Opportunity>(
    `${OPPORTUNITY_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items, total: total.n, page: q.page, page_size: q.page_size };
}

export async function getOpportunity(tx: Tx, userId: string, id: string): Promise<Opportunity | null> {
  return tx.maybeOne<Opportunity>(`${OPPORTUNITY_SELECT} WHERE o.user_id = $1 AND o.id = $2`, [userId, id]);
}

export async function getOpportunityDetail(tx: Tx, userId: string, id: string): Promise<OpportunityDetail> {
  const opp = await getOpportunity(tx, userId, id);
  if (!opp) throw notFound('Opportunity');
  const recruiters = await tx.many(
    `SELECT r.id, r.full_name, r.email, r.title, r.outreach_status, r.last_contacted_at
     FROM recruiter_opportunities ro JOIN recruiters r ON r.id = ro.recruiter_id
     WHERE ro.opportunity_id = $1 AND r.user_id = $2 ORDER BY r.full_name NULLS LAST`,
    [id, userId],
  );
  const messages = await tx.many(`${MESSAGE_SUMMARY_SELECT} WHERE m.user_id = $1 AND m.opportunity_id = $2 ORDER BY coalesce(m.sent_at, m.created_at) DESC`, [userId, id]);
  const profile = await getProfile(tx, userId);
  const skill_match = matchSkills(verifiedSkills(profile), opp.required_skills);
  return { ...opp, recruiters, messages, skill_match } as OpportunityDetail;
}

function deriveFields(input: { title?: string; description?: string | null; required_skills?: string[]; experience_requirements?: string | null }) {
  const out: Record<string, unknown> = {};
  if (input.title !== undefined || input.description !== undefined) out.role_category = classifyRoleCategory(input.title, input.description);
  if (input.required_skills === undefined && input.description) out.required_skills = extractSkills(input.description);
  if (input.experience_requirements === undefined && input.description) {
    const exp = extractExperienceRequirement(input.description);
    if (exp) out.experience_requirements = exp;
  }
  return out;
}

export async function createOpportunity(tx: Tx, userId: string, input: OpportunityCreate): Promise<Opportunity> {
  const companyId = await ensureCompany(tx, userId, input.company);
  const derived = deriveFields(input);
  const { id } = await tx.one<{ id: string }>(
    `INSERT INTO opportunities (user_id, company_id, company_name, title, role_category, description, job_url, location, employment_type,
       required_skills, experience_requirements, discovered_at, deadline, status, source, source_url, notes, company_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::date, current_date),$13,$14,$15,$16,$17,$18) RETURNING id`,
    [
      userId,
      companyId,
      input.company,
      input.title,
      derived.role_category ?? classifyRoleCategory(input.title),
      input.description ?? null,
      input.job_url ?? null,
      input.location ?? null,
      input.employment_type,
      input.required_skills ?? (derived.required_skills as string[] | undefined) ?? [],
      input.experience_requirements ?? (derived.experience_requirements as string | undefined) ?? null,
      input.discovered_at ?? null,
      input.deadline ?? null,
      input.status,
      input.source,
      input.source_url ?? null,
      input.notes ?? null,
      input.company_notes ?? null,
    ],
  );
  for (const rid of input.recruiter_ids ?? []) await linkRecruiterToOpportunity(tx, userId, rid, id);
  await logActivity(tx, userId, 'opportunity_created', `Saved opportunity: ${input.title} at ${input.company}`, { opportunityId: id });
  return (await getOpportunity(tx, userId, id))!;
}

export async function updateOpportunity(tx: Tx, userId: string, id: string, patch: OpportunityUpdate): Promise<Opportunity> {
  const current = await getOpportunity(tx, userId, id);
  if (!current) throw notFound('Opportunity');
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) fields[k === 'company' ? 'company_name' : k] = v;
  if (patch.company !== undefined) fields.company_id = await ensureCompany(tx, userId, patch.company);
  if (patch.title !== undefined || patch.description !== undefined) {
    fields.role_category = classifyRoleCategory(patch.title ?? current.title, patch.description ?? current.description);
  }
  // A new description makes the earlier reading of it out of date: the job page asks to read it again.
  if (patch.description !== undefined && (patch.description ?? null) !== (current.description ?? null)) fields.analysis = null;
  if (patch.description && patch.required_skills === undefined && current.required_skills.length === 0) {
    fields.required_skills = extractSkills(patch.description);
  }
  const entries = Object.entries(fields);
  if (entries.length) {
    await tx.query(`UPDATE opportunities SET ${entries.map(([k], i) => `${k} = $${i + 3}`).join(', ')} WHERE user_id = $1 AND id = $2`, [
      userId,
      id,
      ...entries.map(([, v]) => v),
    ]);
  }
  if (patch.status && patch.status !== current.status) {
    await logActivity(tx, userId, 'opportunity_status_changed', `${current.title} at ${current.company}: ${current.status} → ${patch.status}`, { opportunityId: id }, {
      from: current.status,
      to: patch.status,
    });
  }
  return (await getOpportunity(tx, userId, id))!;
}

export async function deleteOpportunity(tx: Tx, userId: string, id: string): Promise<void> {
  const res = await tx.query(`DELETE FROM opportunities WHERE user_id = $1 AND id = $2`, [userId, id]);
  if (!res.rowCount) throw notFound('Opportunity');
}

/** When outreach is sent for an opportunity still in an early stage, move it to "contacted". */
export async function markOpportunityContacted(tx: Tx, userId: string, id: string): Promise<void> {
  const row = await tx.maybeOne<{ status: string; title: string; company_name: string }>(
    `UPDATE opportunities SET status = 'contacted' WHERE user_id = $1 AND id = $2 AND status IN ('saved', 'researching', 'ready')
     RETURNING status, title, company_name`,
    [userId, id],
  );
  if (row) {
    await logActivity(tx, userId, 'opportunity_status_changed', `${row.title} at ${row.company_name}: → contacted`, { opportunityId: id }, { to: 'contacted', automatic: true });
  }
}
