/**
 * "Paste a job description → cold email" flow: read the JD carefully (AI when
 * configured, checked against the text), show the candidate's honest fit, save
 * it as an opportunity, and attach the recruiters they paste.
 */
import {
  computeJobFit,
  heuristicJobAnalysis,
  parseContactsPaste,
  sanitizeJobAnalysis,
  skillAlternatives,
  type JobAnalysis,
  type JobAnalysisResult,
  type JobFit,
  type JobPasteResult,
  type JobSaveRequest,
  type JobView,
  type MessageDetail,
  type MessageSummary,
  type PreparedEmail,
  type Profile,
  type RecruiterSummary,
} from '@autoreach/shared';
import type { Deps } from '../context.js';
import type { Tx } from '../db/pool.js';
import { notFound, unprocessable } from '../errors.js';
import { AiProviderError, parseJsonObject } from './ai/provider.js';
import { buildDraftContext, qualityFor, writeDraft } from './drafting.js';
import { MESSAGE_SUMMARY_SELECT } from './messageQueries.js';
import { createDraft, getMessageDetail, updateDraft } from './messages.js';
import { createOpportunity, getOpportunity, updateOpportunity } from './opportunities.js';
import { getProfile } from './profile.js';
import { createRecruiter, findActiveByEmail, getRecruiterSummary, linkRecruiterToOpportunity } from './recruiters.js';

const ANALYZE_SYSTEM = `You read a job description for a student or early-career software engineer and return a precise, structured summary.

Rules:
1. Use ONLY what the job description says. Never add skills, numbers, benefits, locations or company facts that are not written in it.
2. "must_have": skills/technologies the JD requires. "nice_to_have": ones it calls preferred, bonus, plus or nice to have. Use the technology's common name (e.g. "Node.js", "PostgreSQL"). If the JD accepts alternatives ("Java or Kotlin"), return them as one entry "Java / Kotlin".
3. "priorities": the 1–3 things this team most clearly cares about, judged from what the JD emphasises (repeated themes, the first responsibilities, words like "you will own"). For each, "point" is a short plain phrase (max 12 words) and "evidence" is an EXACT quote copied from the JD (one sentence or bullet, max 30 words) that shows it.
4. "responsibilities": up to 5, each a short line in the JD's own words.
5. "experience.min_years": the minimum years stated as a number, 0 if it says freshers/new grads/0 years, null if not stated. "fresher_friendly": true if it invites freshers, students or new grads; false if it clearly requires professional experience; null if unclear.
6. "seniority": one of intern, entry, mid, senior, unknown. "employment_type": one of internship, full_time, graduate_program, contract, part_time, unknown.
7. "deadline": YYYY-MM-DD only if an application deadline is written, else null.
8. Respond with one JSON object and nothing else:
{"company": string|null, "title": string|null, "location": string|null, "employment_type": string, "seniority": string,
 "experience": {"min_years": number|null, "text": string|null, "fresher_friendly": boolean|null},
 "must_have": string[], "nice_to_have": string[], "responsibilities": string[],
 "priorities": [{"point": string, "evidence": string}], "deadline": string|null}`;

function fitFor(profile: Profile | null, analysis: JobAnalysis, now: Date): JobFit {
  return computeJobFit(
    {
      skills: profile?.skills ?? [],
      projects: (profile?.projects ?? []).map((p) => ({ name: p.name, description: p.description, technologies: p.technologies })),
      experience: profile?.experience ?? [],
    },
    analysis,
    now,
  );
}

/**
 * Read a pasted job description. AI problems never block: the plain reading is returned with a note.
 * The AI call runs before any database transaction is opened, so a slow provider doesn't hold a connection.
 */
export async function analyzeJob(deps: Deps, userId: string, input: { text: string }): Promise<JobAnalysisResult> {
  const base = heuristicJobAnalysis(input.text);
  let analysis = base;
  if (deps.ai) {
    try {
      const out = await deps.ai.complete({
        system: ANALYZE_SYSTEM,
        user: `<job_description>\n${input.text.slice(0, 24000)}\n</job_description>`,
        maxTokens: 1800,
        temperature: 0.1,
        json: true,
      });
      analysis = sanitizeJobAnalysis(parseJsonObject(out), input.text, base, deps.ai.model);
      if (analysis === base) analysis = { ...base, notes: [...base.notes, 'The AI reply could not be read, so this is a plain keyword reading of the job description.'] };
    } catch (err) {
      if (!(err instanceof AiProviderError)) throw err;
      deps.logger.warn({ status: err.status, provider: deps.ai.name }, 'job analysis: AI provider error');
      analysis = {
        ...base,
        notes: [...base.notes, err.status === 429 ? 'The AI provider is rate limiting requests; this is a plain keyword reading for now.' : 'The AI provider returned an error; this is a plain keyword reading for now.'],
      };
    }
  } else {
    analysis = { ...base, notes: [...base.notes, deps.config.ai.reason ?? 'AI is not configured; this is a plain keyword reading of the job description.'] };
  }
  const profile = await deps.db.withUser(userId, (tx) => getProfile(tx, userId));
  return { analysis, fit: fitFor(profile, analysis, deps.now()) };
}

export async function getJob(deps: Deps, tx: Tx, userId: string, opportunityId: string): Promise<JobView> {
  const opportunity = await getOpportunity(tx, userId, opportunityId);
  if (!opportunity) throw notFound('Job');
  const profile = await getProfile(tx, userId);
  const analysis = opportunity.analysis ?? null;
  const recruiters = await summaries(
    tx,
    userId,
    (
      await tx.many<{ id: string }>(
        `SELECT ro.recruiter_id AS id FROM recruiter_opportunities ro JOIN recruiters r ON r.id = ro.recruiter_id
         WHERE ro.user_id = $1 AND ro.opportunity_id = $2 AND r.merged_into_id IS NULL ORDER BY ro.created_at ASC, r.created_at ASC`,
        [userId, opportunityId],
      )
    ).map((r) => r.id),
  );
  return { opportunity, analysis, fit: analysis ? fitFor(profile, analysis, deps.now()) : null, recruiters, emails: await latestEmails(tx, userId, opportunityId) };
}

async function latestEmails(tx: Tx, userId: string, opportunityId: string): Promise<Record<string, MessageSummary>> {
  const rows = await tx.many<MessageSummary>(
    `SELECT DISTINCT ON (x.recruiter_id) x.* FROM (${MESSAGE_SUMMARY_SELECT} WHERE m.user_id = $1 AND m.opportunity_id = $2 AND m.recruiter_id IS NOT NULL AND m.kind = 'initial') x
     ORDER BY x.recruiter_id, x.created_at DESC`,
    [userId, opportunityId],
  );
  return Object.fromEntries(rows.map((m) => [m.recruiter_id as string, m]));
}

/** The first two sentences after the greeting: enough to tell two emails' openings apart. */
export function openingOf(body: string): string {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const start = /^(hi|hello|dear|hey)\b/i.test(lines[0] ?? '') ? 1 : 0;
  const text = lines.slice(start).join(' ');
  const m = text.match(/^(.+?[.!?])\s+(.+?[.!?])(\s|$)/);
  return (m ? `${m[1]} ${m[2]}` : text).slice(0, 380);
}

/**
 * The email for one recruiter on this job: reuses the saved draft (or shows what was
 * already sent), or writes a new one from the job analysis and the candidate's profile.
 * Nothing is sent here; sending is always a separate, explicit action.
 *
 * Three short steps so no lock or database connection is held while the model writes:
 * read (and return an existing draft), write with no transaction open, then store under a
 * lock on the recruiter, re-checking for a draft another request stored meanwhile.
 */
export async function prepareJobEmail(
  deps: Deps,
  userId: string,
  opportunityId: string,
  recruiterId: string,
  opts: { regenerate: boolean; use_template: boolean },
): Promise<PreparedEmail> {
  type Existing = { id: string; send_status: string; subject: string; body_text: string; resume_id: string | null };
  const findExisting = (tx: Tx) =>
    tx.maybeOne<Existing>(
      `SELECT id, send_status, subject, body_text, resume_id FROM email_messages
       WHERE user_id = $1 AND opportunity_id = $2 AND recruiter_id = $3 AND kind = 'initial'
       ORDER BY created_at DESC LIMIT 1`,
      [userId, opportunityId, recruiterId],
    );
  const isEditable = (e: Existing | null): e is Existing => !!e && ['draft', 'failed'].includes(e.send_status);
  const show = async (tx: Tx, e: Existing): Promise<PreparedEmail> => {
    const message = await getMessageDetail(tx, userId, e.id);
    if (!isEditable(e)) return { message, draft: null, quality: [] };
    const ctx = await buildDraftContext(deps, tx, userId, { recruiter_id: recruiterId, opportunity_id: opportunityId, resume_id: e.resume_id, kind: 'initial' });
    return { message, draft: null, quality: qualityFor(ctx, 'initial', e.subject, e.body_text, !!e.resume_id) };
  };

  // 1. Read.
  const first = await deps.db.withUser(userId, async (tx) => {
    if (!(await getOpportunity(tx, userId, opportunityId))) throw notFound('Job');
    const rec = await tx.maybeOne<{ do_not_contact: boolean; outreach_status: string }>(
      `SELECT do_not_contact, outreach_status FROM recruiters WHERE user_id = $1 AND id = $2 AND merged_into_id IS NULL`,
      [userId, recruiterId],
    );
    if (!rec) throw notFound('Recruiter');
    const existing = await findExisting(tx);
    if (existing && (!isEditable(existing) || !opts.regenerate)) return { done: await show(tx, existing) } as const;
    if (rec.do_not_contact || rec.outreach_status === 'do_not_contact') throw unprocessable('DO_NOT_CONTACT', 'This person is marked do-not-contact, so no email is written.');
    // Openings already written for other people on this job, so each email reads differently.
    const others = await tx.many<{ body_text: string }>(
      `SELECT body_text FROM email_messages WHERE user_id = $1 AND opportunity_id = $2 AND recruiter_id <> $3 AND kind = 'initial' AND body_text <> ''
       ORDER BY created_at DESC LIMIT 5`,
      [userId, opportunityId, recruiterId],
    );
    const req = {
      recruiter_id: recruiterId,
      opportunity_id: opportunityId,
      resume_id: existing ? existing.resume_id : undefined,
      kind: 'initial' as const,
      goal: 'interview_consideration' as const,
      use_template: opts.use_template,
      avoid_openings: [...(existing ? [existing.body_text] : []), ...others.map((o) => o.body_text)].map(openingOf).filter(Boolean).slice(0, 6),
    };
    return { done: null, req, ctx: await buildDraftContext(deps, tx, userId, req), basedOn: existing?.id ?? null } as const;
  });
  if (first.done) return first.done;

  // 2. Write, with no transaction open.
  const draft = await writeDraft(deps, first.ctx, first.req);
  const meta = { source: draft.source, provider: draft.provider, model: draft.model, facts_used: draft.facts_used };

  // 3. Store.
  return deps.db.withUser(userId, async (tx) => {
    // Serialise with other requests for this person (double click, two tabs).
    await tx.query(`SELECT 1 FROM recruiters WHERE user_id = $1 AND id = $2 FOR UPDATE`, [userId, recruiterId]);
    const now = await findExisting(tx);
    if (now && (now.id !== first.basedOn || !isEditable(now))) {
      // Another request stored a draft (or the email was sent) meanwhile: show that one.
      return show(tx, now);
    }
    let message: MessageDetail;
    if (now) {
      await updateDraft(tx, userId, now.id, { subject: draft.subject, body_text: draft.body_text });
      await tx.query(`UPDATE email_messages SET ai_generated = $3, generation_meta = $4::jsonb WHERE user_id = $1 AND id = $2`, [userId, now.id, draft.source === 'ai', JSON.stringify(meta)]);
      message = await getMessageDetail(tx, userId, now.id);
    } else {
      message = await createDraft(deps, tx, userId, {
        recruiter_id: recruiterId,
        opportunity_id: opportunityId,
        subject: draft.subject,
        body_text: draft.body_text,
        ai_generated: draft.source === 'ai',
        generation_meta: meta,
      });
    }
    return { message, draft, quality: draft.quality };
  });
}

/** Save (or update) the job as an opportunity with the confirmed analysis. */
export async function saveJob(deps: Deps, tx: Tx, userId: string, req: JobSaveRequest): Promise<JobView> {
  const a = req.analysis;
  const requiredSkills = [...new Set(a.must_have.flatMap(skillAlternatives))].slice(0, 40);
  const fields = {
    company: a.company,
    title: a.title,
    description: req.text,
    job_url: req.url ?? null,
    location: a.location,
    employment_type: a.employment_type,
    required_skills: requiredSkills,
    experience_requirements: a.experience.text?.slice(0, 300) ?? null,
    deadline: a.deadline,
  };
  let id = req.opportunity_id ?? null;
  if (id && !(await getOpportunity(tx, userId, id))) throw notFound('Job');
  if (!id && req.url) {
    // The same posting saved earlier (for example from the extension): update it instead of duplicating.
    id = (await tx.maybeOne<{ id: string }>(`SELECT id FROM opportunities WHERE user_id = $1 AND job_url = $2 ORDER BY created_at DESC LIMIT 1`, [userId, req.url]))?.id ?? null;
  }
  if (id) await updateOpportunity(tx, userId, id, fields);
  else id = (await createOpportunity(tx, userId, { ...fields, status: 'ready', source: 'manual', discovered_at: null, source_url: req.url ?? null })).id;
  await tx.query(`UPDATE opportunities SET analysis = $3::jsonb WHERE user_id = $1 AND id = $2`, [userId, id, JSON.stringify(a)]);
  return getJob(deps, tx, userId, id);
}

/** Add pasted contacts (and/or saved recruiters) to the job, creating the new ones under the job's company. */
export async function addRecruitersToJob(
  deps: Deps,
  tx: Tx,
  userId: string,
  opportunityId: string,
  input: { text: string; recruiter_ids: string[] },
): Promise<JobPasteResult> {
  const opp = await getOpportunity(tx, userId, opportunityId);
  if (!opp) throw notFound('Job');
  const { contacts, skipped } = parseContactsPaste(input.text);
  let added = 0;
  let alreadySaved = 0;
  const LIMIT = 200;
  if (contacts.length > LIMIT) skipped.push(`${contacts.length - LIMIT} more ${contacts.length - LIMIT === 1 ? 'address' : 'addresses'} (up to ${LIMIT} people can be added at once)`);
  for (const c of contacts.slice(0, LIMIT)) {
    const existing = await findActiveByEmail(tx, userId, c.email);
    if (existing) {
      alreadySaved++;
      await linkRecruiterToOpportunity(tx, userId, existing.id, opportunityId);
      // Fill in a name or title the saved contact was missing, never overwrite.
      if ((!existing.full_name && c.full_name) || (!existing.title && c.title)) {
        await tx.query(`UPDATE recruiters SET full_name = COALESCE(full_name, $3), title = COALESCE(title, $4) WHERE user_id = $1 AND id = $2`, [
          userId,
          existing.id,
          c.full_name,
          c.title,
        ]);
      }
      continue;
    }
    await createRecruiter(tx, userId, {
      email: c.email,
      full_name: c.full_name,
      title: c.title,
      company: opp.company,
      target_role: opp.title,
      linkedin_url: null,
      company_website: null,
      source_url: null,
      source: 'manual',
      email_verification: 'provided',
      tags: [],
      opportunity_id: opportunityId,
    });
    added++;
  }
  for (const rid of input.recruiter_ids) {
    if (!(await getRecruiterSummary(tx, userId, rid))) throw notFound('Recruiter');
    await linkRecruiterToOpportunity(tx, userId, rid, opportunityId);
  }
  const view = await getJob(deps, tx, userId, opportunityId);
  return { ...view, added, already_saved: alreadySaved, skipped };
}

async function summaries(tx: Tx, userId: string, ids: string[]): Promise<RecruiterSummary[]> {
  const out: RecruiterSummary[] = [];
  for (const id of ids) {
    const r = await getRecruiterSummary(tx, userId, id);
    if (r) out.push(r);
  }
  return out;
}

/** Saved recruiters at the job's company who aren't on the job yet. */
export async function suggestedRecruiters(tx: Tx, userId: string, opportunityId: string): Promise<RecruiterSummary[]> {
  const opp = await getOpportunity(tx, userId, opportunityId);
  if (!opp) throw notFound('Job');
  const ids = await tx.many<{ id: string }>(
    `SELECT r.id FROM recruiters r
     WHERE r.user_id = $1 AND r.merged_into_id IS NULL AND NOT r.do_not_contact
       AND (r.company_id = $3 OR lower(r.company) = lower($4))
       AND NOT EXISTS (SELECT 1 FROM recruiter_opportunities ro WHERE ro.recruiter_id = r.id AND ro.opportunity_id = $2)
     ORDER BY r.created_at DESC LIMIT 20`,
    [userId, opportunityId, opp.company_id, opp.company],
  );
  return summaries(tx, userId, ids.map((r) => r.id));
}
