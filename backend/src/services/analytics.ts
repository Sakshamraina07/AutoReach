import {
  canonicalSkillSet,
  classifyRoleCategory,
  daysBetween,
  extractSkills,
  ROLE_CATEGORY_LABELS,
  TERMINAL_OPPORTUNITY_STATUSES,
  type AnalyticsOverview,
  type BreakdownRow,
  type Insight,
  type Recommendation,
  type RoleCategory,
  type TimeseriesPoint,
} from '@autoreach/shared';
import type { Tx } from '../db/pool.js';
import { getProfile, verifiedSkills } from './profile.js';

export type Range = '7d' | '30d' | '90d' | '365d' | 'all';
const RANGE_DAYS: Record<Range, number | null> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365, all: null };
export const SMALL_SAMPLE = 10;

function windowOf(range: Range, now: Date): { start: string | null; prevStart: string | null } {
  const days = RANGE_DAYS[range];
  if (!days) return { start: null, prevStart: null };
  const start = new Date(now.getTime() - days * 86_400_000);
  const prevStart = new Date(start.getTime() - days * 86_400_000);
  return { start: start.toISOString(), prevStart: prevStart.toISOString() };
}

export async function overview(tx: Tx, userId: string, range: Range, now: Date): Promise<AnalyticsOverview> {
  const { start, prevStart } = windowOf(range, now);
  const inRange = (col: string, a: string, b: string) => `(${a}::timestamptz IS NULL OR ${col} >= ${a}::timestamptz) AND ${col} < ${b}::timestamptz`;

  const q = await tx.one<Record<string, number | null>>(
    `SELECT
       (SELECT count(*)::int FROM recruiters WHERE user_id = $1 AND merged_into_id IS NULL) AS recruiters_now,
       (SELECT count(*)::int FROM recruiters WHERE user_id = $1 AND merged_into_id IS NULL AND ($2::timestamptz IS NOT NULL) AND created_at < $2::timestamptz) AS recruiters_prev,
       (SELECT count(*)::int FROM email_messages WHERE user_id = $1 AND send_status IN ('sent','failed','unknown')
          AND ${inRange('coalesce(sent_at, failed_at, sending_started_at, updated_at)', '$2', '$4')}) AS attempted,
       (SELECT count(*)::int FROM email_messages WHERE user_id = $1 AND send_status IN ('sent','failed','unknown')
          AND $3::timestamptz IS NOT NULL AND ${inRange('coalesce(sent_at, failed_at, sending_started_at, updated_at)', '$3', '$2')}) AS attempted_prev,
       (SELECT count(*)::int FROM email_messages WHERE user_id = $1 AND send_status = 'sent' AND ${inRange('sent_at', '$2', '$4')}) AS sent,
       (SELECT count(*)::int FROM email_messages WHERE user_id = $1 AND send_status = 'sent' AND $3::timestamptz IS NOT NULL AND ${inRange('sent_at', '$3', '$2')}) AS sent_prev,
       (SELECT count(*)::int FROM email_messages WHERE user_id = $1 AND reply_status = 'replied' AND ${inRange('replied_at', '$2', '$4')}) AS replies,
       (SELECT count(*)::int FROM email_messages WHERE user_id = $1 AND reply_status = 'replied' AND $3::timestamptz IS NOT NULL AND ${inRange('replied_at', '$3', '$2')}) AS replies_prev,
       (SELECT count(*)::int FROM follow_ups WHERE user_id = $1 AND status = 'pending' AND due_at <= $4::timestamptz) AS followups_due,
       (SELECT count(*)::int FROM opportunities WHERE user_id = $1 AND NOT (status = ANY($5::text[]))) AS active_opps,
       (SELECT count(*)::int FROM email_messages WHERE user_id = $1 AND send_status = 'sent' AND tracking_enabled AND first_open_at IS NOT NULL AND ${inRange('sent_at', '$2', '$4')}) AS opens,
       (SELECT count(*)::int FROM email_messages WHERE user_id = $1 AND send_status = 'sent' AND tracking_enabled AND first_open_at IS NOT NULL AND $3::timestamptz IS NOT NULL AND ${inRange('sent_at', '$3', '$2')}) AS opens_prev`,
    [userId, start, prevStart, now.toISOString(), TERMINAL_OPPORTUNITY_STATUSES],
  );

  const rate = async (from: string | null, to: string) => {
    const r = await tx.one<{ total: number; replied: number }>(
      `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM email_messages x WHERE x.user_id = m.user_id AND x.recruiter_id = m.recruiter_id AND x.reply_status = 'replied' AND x.sent_at >= m.sent_at
         ))::int AS replied
       FROM email_messages m
       WHERE m.user_id = $1 AND m.kind = 'initial' AND m.send_status = 'sent' AND ($2::timestamptz IS NULL OR m.sent_at >= $2::timestamptz) AND m.sent_at < $3::timestamptz`,
      [userId, from, to],
    );
    return r;
  };
  const cur = await rate(start, now.toISOString());
  const prev = start && prevStart ? await rate(prevStart, start) : null;
  const hasPrev = !!start;
  return {
    range,
    kpis: {
      total_recruiters: { value: q.recruiters_now ?? 0, previous: hasPrev ? q.recruiters_prev ?? 0 : null },
      emails_attempted: { value: q.attempted ?? 0, previous: hasPrev ? q.attempted_prev ?? 0 : null },
      emails_sent: { value: q.sent ?? 0, previous: hasPrev ? q.sent_prev ?? 0 : null },
      replies: { value: q.replies ?? 0, previous: hasPrev ? q.replies_prev ?? 0 : null },
      followups_due: { value: q.followups_due ?? 0, previous: null },
      active_opportunities: { value: q.active_opps ?? 0, previous: null },
      response_rate: {
        value: cur.total ? cur.replied / cur.total : null,
        previous: prev && prev.total ? prev.replied / prev.total : null,
        sample: cur.total,
      },
      opens_detected: { value: q.opens ?? 0, previous: hasPrev ? q.opens_prev ?? 0 : null },
    },
  };
}

export async function timeseries(tx: Tx, userId: string, range: Range, tz: string, now: Date): Promise<TimeseriesPoint[]> {
  let { start } = windowOf(range, now);
  if (!start) {
    const first = await tx.maybeOne<{ t: string | null }>(`SELECT min(coalesce(sent_at, failed_at)) AS t FROM email_messages WHERE user_id = $1`, [userId]);
    start = first?.t ? new Date(first.t).toISOString() : new Date(now.getTime() - 30 * 86_400_000).toISOString();
    // Cap "all" at two years of daily points.
    if (daysBetween(start, now) > 730) start = new Date(now.getTime() - 730 * 86_400_000).toISOString();
  }
  return tx.many<TimeseriesPoint>(
    `WITH days AS (
       SELECT generate_series((($2::timestamptz) AT TIME ZONE $3)::date, (($4::timestamptz) AT TIME ZONE $3)::date, interval '1 day')::date AS d
     ),
     sent AS (
       SELECT (sent_at AT TIME ZONE $3)::date AS d, count(*)::int AS n FROM email_messages
       WHERE user_id = $1 AND send_status = 'sent' AND sent_at >= $2::timestamptz - interval '1 day' GROUP BY 1
     ),
     replies AS (
       SELECT (replied_at AT TIME ZONE $3)::date AS d, count(*)::int AS n FROM email_messages
       WHERE user_id = $1 AND reply_status = 'replied' AND replied_at >= $2::timestamptz - interval '1 day' GROUP BY 1
     ),
     failed AS (
       SELECT (failed_at AT TIME ZONE $3)::date AS d, count(*)::int AS n FROM email_messages
       WHERE user_id = $1 AND send_status = 'failed' AND failed_at >= $2::timestamptz - interval '1 day' GROUP BY 1
     )
     SELECT to_char(days.d, 'YYYY-MM-DD') AS date, coalesce(sent.n, 0) AS sent, coalesce(replies.n, 0) AS replies, coalesce(failed.n, 0) AS failed
     FROM days LEFT JOIN sent ON sent.d = days.d LEFT JOIN replies ON replies.d = days.d LEFT JOIN failed ON failed.d = days.d
     ORDER BY days.d`,
    [userId, start, tz, now.toISOString()],
  );
}

interface OutreachRow {
  id: string;
  subject: string;
  company: string | null;
  role_text: string | null;
  role_category: string | null;
  description: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  replied: boolean;
  ai_generated: boolean;
  has_attachment: boolean;
}

async function outreachRows(tx: Tx, userId: string, range: Range, now: Date): Promise<OutreachRow[]> {
  const { start } = windowOf(range, now);
  return tx.many<OutreachRow>(
    `SELECT m.id, m.subject, coalesce(o.company_name, r.company, '(no company)') AS company,
       coalesce(o.title, m.manual_role, r.target_role) AS role_text, o.role_category, o.description,
       m.campaign_id, c.name AS campaign_name, m.ai_generated, (m.attachment_snapshot IS NOT NULL) AS has_attachment,
       EXISTS (SELECT 1 FROM email_messages x WHERE x.user_id = m.user_id AND x.recruiter_id = m.recruiter_id
               AND x.reply_status = 'replied' AND x.sent_at >= m.sent_at) AS replied
     FROM email_messages m
     LEFT JOIN recruiters r ON r.id = m.recruiter_id
     LEFT JOIN opportunities o ON o.id = m.opportunity_id
     LEFT JOIN campaigns c ON c.id = m.campaign_id
     WHERE m.user_id = $1 AND m.kind = 'initial' AND m.send_status = 'sent' AND ($2::timestamptz IS NULL OR m.sent_at >= $2::timestamptz)`,
    [userId, start],
  );
}

function aggregate(rows: OutreachRow[], keyOf: (r: OutreachRow) => { key: string; label: string }): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const r of rows) {
    const { key, label } = keyOf(r);
    const row = map.get(key) ?? { key, label, sent: 0, replies: 0, response_rate: null, small_sample: true };
    row.sent++;
    if (r.replied) row.replies++;
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, response_rate: r.sent ? r.replies / r.sent : null, small_sample: r.sent < SMALL_SAMPLE }))
    .sort((a, b) => b.sent - a.sent || a.label.localeCompare(b.label));
}

export async function breakdown(tx: Tx, userId: string, by: 'role_category' | 'company' | 'campaign', range: Range, now: Date): Promise<BreakdownRow[]> {
  const rows = await outreachRows(tx, userId, range, now);
  if (by === 'company') return aggregate(rows, (r) => ({ key: (r.company ?? '').toLowerCase(), label: r.company ?? '(no company)' }));
  if (by === 'campaign') return aggregate(rows, (r) => ({ key: r.campaign_id ?? 'none', label: r.campaign_name ?? 'No campaign' }));
  return aggregate(rows, (r) => {
    const cat = (r.role_category as RoleCategory | null) ?? classifyRoleCategory(r.role_text, r.description);
    return { key: cat, label: ROLE_CATEGORY_LABELS[cat] };
  });
}

function rateText(replied: number, total: number): string {
  return `${replied} of ${total} got a reply (${total ? Math.round((replied / total) * 100) : 0}%)`;
}

/** Correlations between outreach choices and replies. Always labelled directional when samples are small. */
export async function insights(tx: Tx, userId: string, range: Range, now: Date): Promise<Insight[]> {
  const rows = await outreachRows(tx, userId, range, now);
  const out: Insight[] = [];
  const compare = (id: string, title: string, predicate: (r: OutreachRow) => boolean, yesLabel: string, noLabel: string) => {
    const yes = rows.filter(predicate);
    const no = rows.filter((r) => !predicate(r));
    if (yes.length < 3 || no.length < 3) return;
    const yr = yes.filter((r) => r.replied).length;
    const nr = no.filter((r) => r.replied).length;
    const directional = yes.length < 30 || no.length < 30;
    out.push({
      id,
      title,
      detail: `${yesLabel}: ${rateText(yr, yes.length)}. ${noLabel}: ${rateText(nr, no.length)}.${directional ? ' Small sample — treat as directional, not conclusive.' : ''}`,
      sample: rows.length,
      directional,
    });
  };
  compare('subject_names_role', 'Subjects that name the role', (r) => !!r.role_text && r.subject.toLowerCase().includes(r.role_text.toLowerCase().slice(0, 20)), 'Subject names the role', 'Subject does not');
  compare('subject_short', 'Short subjects (under 50 characters)', (r) => r.subject.length < 50, 'Short subject', 'Longer subject');
  compare('subject_question', 'Subjects phrased as a question', (r) => r.subject.trim().endsWith('?'), 'Question', 'Statement');
  compare('ai_drafted', 'AI-assisted drafts', (r) => r.ai_generated, 'AI-assisted', 'Written or templated by you');
  compare('with_resume', 'Emails with a résumé attached', (r) => r.has_attachment, 'Résumé attached', 'No attachment');
  compare('tailored_to_posting', 'Emails tied to a saved job posting', (r) => !!r.role_category, 'Linked to a posting', 'No posting linked');
  if (!out.length && rows.length) {
    out.push({
      id: 'not_enough_data',
      title: 'Not enough data yet',
      detail: `${rows.length} first email${rows.length === 1 ? '' : 's'} sent in this period. Insights appear once each compared group has at least 3 emails.`,
      sample: rows.length,
      directional: true,
    });
  }
  return out;
}

/** Which saved opportunities deserve attention next, and why. No invented scores. */
export async function recommendations(tx: Tx, userId: string, now: Date): Promise<Recommendation[]> {
  const profile = await getProfile(tx, userId);
  const skills = canonicalSkillSet(verifiedSkills(profile));
  const prefs = (profile?.target_roles ?? []).map((r) => r.toLowerCase());
  const opps = await tx.many<{
    id: string;
    title: string;
    company: string;
    status: Recommendation['status'];
    required_skills: string[];
    description: string | null;
    discovered_at: string | null;
    deadline: string | null;
    recruiters: number;
    contacted: number;
    uncontacted_name: string | null;
    due_followups: number;
    replied: number;
  }>(
    `SELECT o.id, o.title, o.company_name AS company, o.status, o.required_skills, o.description, o.discovered_at::text, o.deadline::text,
       (SELECT count(*)::int FROM recruiter_opportunities ro WHERE ro.opportunity_id = o.id) AS recruiters,
       (SELECT count(*)::int FROM email_messages m WHERE m.opportunity_id = o.id AND m.send_status = 'sent') AS contacted,
       (SELECT coalesce(r.full_name, r.email) FROM recruiter_opportunities ro JOIN recruiters r ON r.id = ro.recruiter_id
         WHERE ro.opportunity_id = o.id AND r.outreach_status = 'new' AND NOT r.do_not_contact LIMIT 1) AS uncontacted_name,
       (SELECT count(*)::int FROM follow_ups f JOIN recruiter_opportunities ro ON ro.recruiter_id = f.recruiter_id
         WHERE ro.opportunity_id = o.id AND f.status = 'pending' AND f.due_at <= now()) AS due_followups,
       (SELECT count(*)::int FROM email_messages m WHERE m.opportunity_id = o.id AND m.reply_status = 'replied') AS replied
     FROM opportunities o WHERE o.user_id = $1 AND NOT (o.status = ANY($2::text[]))`,
    [userId, TERMINAL_OPPORTUNITY_STATUSES],
  );

  const recs = opps.map((o) => {
    const jobSkills = o.required_skills.length ? o.required_skills : extractSkills(o.description ?? '');
    const matched = jobSkills.filter((s) => skills.has(s.toLowerCase())).length;
    const reasons: string[] = [];
    const daysOld = o.discovered_at ? daysBetween(o.discovered_at, now) : null;
    const daysToDeadline = o.deadline ? Math.ceil((new Date(`${o.deadline}T23:59:59Z`).getTime() - now.getTime()) / 86_400_000) : null;
    if (jobSkills.length) reasons.push(`You list ${matched} of the ${jobSkills.length} skills in the posting`);
    if (prefs.some((p) => o.title.toLowerCase().includes(p) || p.includes(o.title.toLowerCase()))) reasons.push('Matches one of your target roles');
    if (daysToDeadline !== null && daysToDeadline >= 0) reasons.push(`Deadline in ${daysToDeadline} day${daysToDeadline === 1 ? '' : 's'}`);
    if (daysToDeadline !== null && daysToDeadline < 0) reasons.push('Deadline has passed');
    if (daysOld !== null) reasons.push(daysOld <= 7 ? `Saved ${daysOld} day${daysOld === 1 ? '' : 's'} ago` : `Saved ${daysOld} days ago — postings this old may be filled`);

    let next = '';
    if (o.replied) next = 'A recruiter replied — continue the conversation in Gmail';
    else if (o.due_followups) next = 'A follow-up is due';
    else if (!o.recruiters) next = 'Add a recruiter or hiring-manager contact for this role';
    else if (o.uncontacted_name) next = `Draft outreach to ${o.uncontacted_name}`;
    else if (o.status === 'saved' || o.status === 'researching') next = 'Mark as ready and prepare outreach';
    else next = 'Waiting for a response';

    // Ordering only (never shown as a score): urgent deadlines, open actions, fit, freshness.
    const priority =
      (daysToDeadline !== null && daysToDeadline >= 0 && daysToDeadline <= 7 ? 100 : 0) +
      (o.due_followups ? 40 : 0) +
      (!o.recruiters || o.uncontacted_name ? 30 : 0) +
      (jobSkills.length ? (matched / jobSkills.length) * 30 : 10) +
      (daysOld !== null ? Math.max(0, 20 - daysOld) : 0) -
      (daysToDeadline !== null && daysToDeadline < 0 ? 80 : 0) -
      (o.replied ? 20 : 0);
    return {
      priority,
      rec: {
        opportunity_id: o.id,
        title: o.title,
        company: o.company,
        status: o.status,
        reasons,
        next_action: next,
        matched_skills: matched,
        considered_skills: jobSkills.length,
        has_recruiter: o.recruiters > 0,
        days_since_discovered: daysOld,
        deadline: o.deadline,
      } satisfies Recommendation,
    };
  });
  return recs.sort((a, b) => b.priority - a.priority).slice(0, 10).map((r) => r.rec);
}
