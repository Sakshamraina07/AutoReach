import {
  AI_REFINE_ACTION_LABELS,
  canonicalSkillSet,
  classifyRoleCategory,
  compileTemplate,
  computeJobFit,
  extractSkills,
  firstNameOf,
  OUTREACH_GOAL_LABELS,
  ROLE_CATEGORY_LABELS,
  runQualityChecks,
  TONE_LABELS,
  type AiDraftRequest,
  type AiRefineAction,
  type DraftResult,
  type JobFit,
  type Opportunity,
  type Profile,
  type QualityFinding,
  type RecruiterSummary,
  type TemplateType,
  type Tone,
} from '@autoreach/shared';
import type { Deps } from '../context.js';
import type { Tx } from '../db/pool.js';
import { AppError, notFound, unprocessable } from '../errors.js';
import { AiProviderError, parseJsonObject } from './ai/provider.js';
import { getOpportunity } from './opportunities.js';
import { getProfile, verifiedSkills } from './profile.js';
import { getRecruiterSummary } from './recruiters.js';
import { getSettings } from './settings.js';

/* ------------------------------------------------------------------ */
/* Context: verified facts only                                        */
/* ------------------------------------------------------------------ */

export interface Fact {
  id: string;
  text: string;
}

export interface DraftContext {
  profile: Profile;
  recruiter: RecruiterSummary;
  opportunity: Opportunity | null;
  roleLabel: string | null;
  companyName: string | null;
  resume: { id: string; label: string; text: string | null } | null;
  facts: Fact[];
  /** Concatenated verified text used by the quality checks. */
  factsText: string;
  candidateSkills: string[];
  otherCompanyNames: string[];
  previousMessages: { id: string; subject: string; sent_at: string | null; body_text: string; kind: string }[];
  previousContactCount: number;
  lastSentAt: string | null;
  attachmentRequired: boolean;
  tone: Tone;
  writingStyle: string | null;
  signature: string;
  templates: Partial<Record<TemplateType, { subject: string; body: string }>>;
  timezone: string;
  /** Fit against the confirmed job analysis, when the opportunity has one. */
  fit: JobFit | null;
}

function monthName(m: number | null): string {
  if (!m) return '';
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1] ?? '';
}

function educationLine(p: Profile): string | null {
  const parts: string[] = [];
  if (p.degree) parts.push(p.degree + (p.specialization ? ` (${p.specialization})` : ''));
  if (p.university) parts.push(p.university);
  const grad = [monthName(p.graduation_month), p.graduation_year ?? ''].filter(Boolean).join(' ');
  if (grad) parts.push(`graduating ${grad}`);
  return parts.length ? parts.join(', ') : null;
}

function defaultSignature(p: Profile): string {
  const lines = [p.full_name];
  if (p.phone) lines.push(p.phone);
  const links = [p.links?.linkedin, p.links?.github, p.links?.portfolio].filter(Boolean) as string[];
  lines.push(...links);
  return lines.filter(Boolean).join('\n');
}

/** Rank projects by overlap with the job's skills/description. */
export function rankProjects(profile: Profile, jobSkills: string[], jobText: string): Profile['projects'] {
  const wanted = canonicalSkillSet([...jobSkills, ...extractSkills(jobText)]);
  const score = (p: Profile['projects'][number]) => {
    const techs = canonicalSkillSet([...(p.technologies ?? []), ...extractSkills(`${p.name} ${p.description}`)]);
    let s = 0;
    for (const t of techs) if (wanted.has(t)) s += 2;
    if ((p.achievements ?? []).length) s += 1;
    return s;
  };
  return [...profile.projects].sort((a, b) => score(b) - score(a));
}

export async function buildDraftContext(
  deps: Deps,
  tx: Tx,
  userId: string,
  req: Pick<AiDraftRequest, 'recruiter_id' | 'opportunity_id' | 'manual_role' | 'resume_id' | 'tone' | 'kind' | 'follow_up_of_message_id'>,
): Promise<DraftContext> {
  const profile = await getProfile(tx, userId);
  if (!profile || !profile.full_name) {
    throw unprocessable('PROFILE_INCOMPLETE', 'Add at least your name, education and a few skills in your profile before drafting.');
  }
  const recruiter = await getRecruiterSummary(tx, userId, req.recruiter_id);
  if (!recruiter) throw notFound('Recruiter');
  const opportunity = req.opportunity_id ? await getOpportunity(tx, userId, req.opportunity_id) : null;
  if (req.opportunity_id && !opportunity) throw notFound('Opportunity');
  const settings = await getSettings(tx, userId);

  const resumeId = req.resume_id === undefined ? settings.default_resume_id : req.resume_id;
  const resume = resumeId
    ? await tx.maybeOne<{ id: string; label: string; text: string | null }>(
        `SELECT id, label, extracted_text AS text FROM resumes WHERE user_id = $1 AND id = $2`,
        [userId, resumeId],
      )
    : null;

  const companyName = opportunity?.company ?? recruiter.company ?? null;
  const roleLabel = opportunity?.title ?? req.manual_role ?? recruiter.target_role ?? null;
  const companyRow = recruiter.company_id
    ? await tx.maybeOne<{ notes: string | null; website: string | null }>(`SELECT notes, website FROM companies WHERE id = $1 AND user_id = $2`, [recruiter.company_id, userId])
    : null;

  const previousMessages = await tx.many<{ id: string; subject: string; sent_at: string | null; body_text: string; kind: string }>(
    `SELECT id, subject, sent_at, body_text, kind FROM email_messages
     WHERE user_id = $1 AND recruiter_id = $2 AND send_status = 'sent' ORDER BY sent_at ASC`,
    [userId, recruiter.id],
  );
  const otherCompanyNames = (
    await tx.many<{ name: string }>(`SELECT DISTINCT name FROM companies WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2) LIMIT 500`, [
      userId,
      recruiter.company_id,
    ])
  ).map((r) => r.name);
  const templates = Object.fromEntries(
    (await tx.many<{ type: TemplateType; subject: string | null; body: string | null }>(`SELECT type, subject, body FROM email_templates WHERE user_id = $1`, [userId]))
      .filter((t) => t.body)
      .map((t) => [t.type, { subject: t.subject ?? '', body: t.body ?? '' }]),
  );

  // ---- facts ------------------------------------------------------
  const facts: Fact[] = [];
  facts.push({ id: 'candidate:name', text: `Candidate name: ${profile.full_name}` });
  const edu = educationLine(profile);
  if (edu) facts.push({ id: 'candidate:education', text: `Education: ${edu}` });
  if (profile.current_location) facts.push({ id: 'candidate:location', text: `Current location: ${profile.current_location}` });
  if (profile.target_roles.length) facts.push({ id: 'candidate:target_roles', text: `Target roles: ${profile.target_roles.join(', ')}` });
  if (profile.job_types.length) facts.push({ id: 'candidate:job_types', text: `Looking for: ${profile.job_types.join(', ').replace(/_/g, ' ')}` });
  const skills = verifiedSkills(profile);
  if (skills.length) facts.push({ id: 'candidate:skills', text: `Skills: ${skills.join(', ')}` });
  const jobSkills = opportunity?.required_skills ?? [];
  const jobText = `${opportunity?.title ?? roleLabel ?? ''}\n${opportunity?.description ?? ''}`;
  rankProjects(profile, jobSkills, jobText)
    .slice(0, 6)
    .forEach((p, i) => {
      const bits = [`Project "${p.name}"`];
      if (p.description) bits.push(p.description);
      if (p.technologies?.length) bits.push(`Technologies: ${p.technologies.join(', ')}`);
      if (p.achievements?.length) bits.push(`Achievements (verbatim): ${p.achievements.join('; ')}`);
      if (p.url) bits.push(`Link: ${p.url}`);
      facts.push({ id: `project:${i + 1}`, text: bits.join('. ') });
    });
  profile.experience.slice(0, 5).forEach((e, i) => {
    const when = [e.start, e.current ? 'present' : e.end].filter(Boolean).join(' – ');
    const bits = [`${e.title} at ${e.organization}${when ? ` (${when})` : ''}`];
    if (e.description) bits.push(e.description);
    if (e.technologies?.length) bits.push(`Technologies: ${e.technologies.join(', ')}`);
    if (e.achievements?.length) bits.push(`Achievements (verbatim): ${e.achievements.join('; ')}`);
    facts.push({ id: `experience:${i + 1}`, text: bits.join('. ') });
  });
  const links = [profile.links?.github && `GitHub: ${profile.links.github}`, profile.links?.linkedin && `LinkedIn: ${profile.links.linkedin}`, profile.links?.portfolio && `Portfolio: ${profile.links.portfolio}`].filter(Boolean);
  if (links.length) facts.push({ id: 'candidate:links', text: links.join(' | ') });
  if (resume?.text) facts.push({ id: 'resume', text: `Résumé text (${resume.label}): ${resume.text.slice(0, 6000)}` });

  facts.push({
    id: 'recruiter',
    text: `Recipient: ${recruiter.full_name ?? '(name unknown)'}${recruiter.title ? `, ${recruiter.title}` : ''}${companyName ? ` at ${companyName}` : ''} <${recruiter.email}>`,
  });
  if (opportunity) {
    const bits = [`Role: ${opportunity.title} at ${opportunity.company}`];
    if (opportunity.location) bits.push(`Location: ${opportunity.location}`);
    if (opportunity.employment_type !== 'unknown') bits.push(`Type: ${opportunity.employment_type.replace(/_/g, ' ')}`);
    if (opportunity.required_skills.length) bits.push(`Listed skills: ${opportunity.required_skills.join(', ')}`);
    if (opportunity.experience_requirements) bits.push(`Experience: ${opportunity.experience_requirements}`);
    facts.push({ id: 'job', text: bits.join('. ') });
    const a = opportunity.analysis;
    if (a?.priorities.length) {
      facts.push({
        id: 'job:priorities',
        text: `What the team says it cares about most (each with the job description's own words): ${a.priorities.map((p, i) => `${i + 1}. ${p.point} — "${p.evidence}"`).join(' ')}`,
      });
    }
    if (a?.must_have.length) facts.push({ id: 'job:must_have', text: `Must-have skills in the job description: ${a.must_have.join(', ')}` });
    if (a?.nice_to_have.length) facts.push({ id: 'job:nice_to_have', text: `Nice-to-have skills in the job description: ${a.nice_to_have.join(', ')}` });
    if (a?.experience.text) facts.push({ id: 'job:experience', text: `Experience the job asks for: ${a.experience.text}` });
    if (opportunity.description) facts.push({ id: 'job:description', text: `Job description (excerpt): ${opportunity.description.slice(0, 3500)}` });
    if (opportunity.notes) facts.push({ id: 'job:notes', text: `Candidate's notes about this opportunity: ${opportunity.notes.slice(0, 1500)}` });
    if (opportunity.company_notes) facts.push({ id: 'company:notes', text: `Company information supplied by the candidate: ${opportunity.company_notes.slice(0, 1500)}` });
  } else if (roleLabel) {
    facts.push({ id: 'job', text: `Role the candidate is asking about: ${roleLabel}${companyName ? ` at ${companyName}` : ''} (no job description provided)` });
  } else {
    facts.push({ id: 'job', text: `No specific vacancy: speculative outreach to ${companyName ?? 'the company'} about software engineering internship / entry-level roles` });
  }
  if (companyRow?.notes) facts.push({ id: 'company:crm_notes', text: `Company information supplied by the candidate: ${companyRow.notes.slice(0, 1500)}` });
  if (recruiter.notes) facts.push({ id: 'recruiter:notes', text: `Candidate's notes about the recipient: ${recruiter.notes.slice(0, 1000)}` });
  previousMessages.slice(-3).forEach((m, i) => {
    facts.push({
      id: `previous:${i + 1}`,
      text: `Previously sent (${m.sent_at ? new Date(m.sent_at).toISOString().slice(0, 10) : 'date unknown'}), subject "${m.subject}"${m.body_text ? `: ${m.body_text.slice(0, 1200)}` : ''}`,
    });
  });

  const fit = opportunity?.analysis
    ? computeJobFit({ skills: profile.skills, projects: profile.projects, experience: profile.experience }, opportunity.analysis, deps.now())
    : null;
  if (fit?.skills_in_common.length) {
    facts.push({ id: 'fit:skills', text: `Skills from the job description that the candidate has (from their profile): ${fit.skills_in_common.join(', ')}` });
  }
  if (fit?.projects.length) {
    facts.push({ id: 'fit:projects', text: `The candidate's projects that best match this job: ${fit.projects.map((p) => `${p.name} (shows ${p.matched.join(', ')})`).join('; ')}` });
  }

  return {
    profile,
    recruiter,
    opportunity,
    roleLabel,
    companyName,
    resume: resume ? { id: resume.id, label: resume.label, text: resume.text } : null,
    facts,
    factsText: facts.map((f) => f.text).join('\n'),
    candidateSkills: skills,
    otherCompanyNames,
    previousMessages,
    previousContactCount: previousMessages.length,
    lastSentAt: previousMessages.at(-1)?.sent_at ?? null,
    attachmentRequired: settings.require_resume_attachment,
    tone: req.tone ?? profile.preferred_tone,
    writingStyle: profile.writing_style,
    signature: profile.signature?.trim() || defaultSignature(profile),
    templates,
    timezone: settings.timezone,
    fit,
  };
}

/* ------------------------------------------------------------------ */
/* Template composer (works without AI)                                */
/* ------------------------------------------------------------------ */

const BUILTIN_INITIAL = {
  subject: '{role_or_interest} — {user_name}',
  body: `Hi {first_name_or_team},

I'm {user_name}{education_clause}. {interest_sentence}

{project_sentence}

{skills_sentence}

{attachment_sentence}Would you be open to considering me{for_role}, or pointing me to the right person on the team?

Thank you for your time,
{signature}`,
};

const BUILTIN_FOLLOWUP = {
  subject: 'Re: {previous_subject}',
  body: `Hi {first_name_or_team},

I'm following up on my email from {previous_date} about {about}. I'd still be glad to be considered{for_role}, and I'm happy to share more detail on {project_name}.

{attachment_sentence}Thank you,
{signature}`,
};

function sentenceCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function firstSentence(s: string): string {
  const m = s.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim().replace(/[.!?]$/, '');
}

export function templateDraft(
  ctx: DraftContext,
  kind: 'initial' | 'follow_up',
  step = 1,
  hasAttachment = true,
): { subject: string; body: string; missingVariables: string[]; usedUserTemplate: boolean } {
  const p = ctx.profile;
  const first = firstNameOf(ctx.recruiter.full_name);
  const projects = rankProjects(p, ctx.opportunity?.required_skills ?? [], `${ctx.roleLabel ?? ''} ${ctx.opportunity?.description ?? ''}`);
  const top = projects[0];
  const jobSkills = canonicalSkillSet([...(ctx.opportunity?.required_skills ?? []), ...extractSkills(ctx.opportunity?.description ?? '')]);
  const matched = ctx.candidateSkills.filter((s) => jobSkills.has(s.toLowerCase()));
  const shownSkills = (matched.length ? matched : ctx.candidateSkills).slice(0, 4);
  const edu = educationLine(p);
  const company = ctx.companyName ?? 'your company';
  const last = ctx.previousMessages.at(-1);

  const vars: Record<string, string> = {
    // v1 variables
    name: ctx.recruiter.full_name ?? '',
    company: ctx.companyName ?? '',
    role: ctx.roleLabel ?? '',
    user_name: p.full_name,
    degree: p.degree ?? '',
    year: p.graduation_year ? String(p.graduation_year) : (p.legacy_year ?? ''),
    location: p.current_location ?? '',
    contact: p.phone ?? p.primary_email ?? '',
    // v2 variables
    first_name: first,
    recruiter_title: ctx.recruiter.title ?? '',
    university: p.university ?? '',
    skills: shownSkills.join(', '),
    project: top ? `${top.name}${top.description ? ` — ${firstSentence(top.description)}` : ''}` : '',
    github: p.links?.github ?? '',
    linkedin: p.links?.linkedin ?? '',
    portfolio: p.links?.portfolio ?? '',
    // built-in template helpers
    first_name_or_team: first || 'there',
    role_or_interest: ctx.roleLabel ? `${ctx.roleLabel} at ${company}` : `Software engineering opportunities at ${company}`,
    education_clause: edu ? ` (${edu})` : '',
    interest_sentence: ctx.roleLabel
      ? `I'm interested in the ${ctx.roleLabel} role at ${company}.`
      : `I'm reaching out to ask whether ${company} has any software engineering internship or entry-level openings.`,
    project_sentence: top
      ? `The most relevant thing I've built is ${top.name}${top.description ? `: ${firstSentence(top.description)}` : ''}${top.achievements?.[0] ? `. ${sentenceCase(firstSentence(top.achievements[0]))}` : ''}.`
      : '',
    skills_sentence: shownSkills.length ? `I work with ${shownSkills.join(', ')}.` : '',
    attachment_sentence: hasAttachment ? (kind === 'initial' ? "I've attached my résumé. " : "I've attached my résumé again for convenience.\n\n") : '',
    for_role: ctx.roleLabel ? ` for the ${ctx.roleLabel} role` : '',
    signature: ctx.signature,
    previous_subject: last?.subject?.replace(/^(re:\s*)+/i, '') ?? '',
    previous_date: last?.sent_at ? new Date(last.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: ctx.timezone }) : 'earlier',
    about: ctx.roleLabel ? `the ${ctx.roleLabel} role at ${company}` : `opportunities at ${company}`,
    project_name: top?.name ?? 'my projects',
  };

  const userTemplate = kind === 'initial' ? ctx.templates.initial : ctx.templates[step >= 2 ? 'followup_2' : 'followup_1'] ?? ctx.templates.followup_1;
  const tpl = userTemplate ?? (kind === 'initial' ? BUILTIN_INITIAL : BUILTIN_FOLLOWUP);
  // Built-in helpers are only exposed to the built-in templates.
  const missing = new Set<string>();
  const compile = (s: string) => {
    if (!userTemplate) return s.replace(/\{([a-z_]+)\}/g, (whole, k: string) => (k in vars ? (vars[k] as string) : whole));
    const c = compileTemplate(s, vars);
    c.missing.forEach((m) => missing.add(m));
    return c.text;
  };
  let subject = compile(tpl.subject).replace(/\s+/g, ' ').trim();
  if (kind === 'follow_up' && last) subject = `Re: ${last.subject.replace(/^(re:\s*)+/i, '')}`;
  const body = compile(tpl.body)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { subject, body, missingVariables: [...missing], usedUserTemplate: !!userTemplate };
}

/* ------------------------------------------------------------------ */
/* AI generation                                                       */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You write cold outreach emails for a student or early-career software engineer who is contacting a recruiter about a job.

Hard rules — follow every one:
1. Use ONLY the facts provided in <facts>. Never invent or embellish skills, technologies, projects, employers, metrics, numbers, dates, grades, awards, referrals, mutual connections, prior conversations, company achievements, products, news or the recruiter's interests.
2. If a fact you would like to use is missing, leave it out. Do not use placeholders like [Company] or {name}.
3. Mention at most two of the candidate's projects or achievements — the ones most relevant to the role. Numbers may only appear if they appear verbatim in the facts.
4. The recruiter's name and company must exactly match the facts. If the recipient's name is unknown, greet with "Hi there,".
5. One clear, polite request (e.g. to be considered, or to be pointed to the right person). No pressure, no flattery, no clichés such as "I hope this email finds you well", "passionate", "leverage", "perfect fit", "dream company".
6. Plain text only — no markdown, no bullet symbols, no bold. Short paragraphs.
7. Do not claim experience with skills listed only in the job description. You may say the candidate is learning something only if the facts say so.
8. End with the provided signature block exactly as given.
9. Respond with a single JSON object and nothing else: {"subject": string, "body": string, "facts_used": string[], "notes": string[]}. "facts_used" lists the fact ids you relied on; "notes" may list caveats for the candidate (e.g. "No job description was provided").`;

/** Engineers, managers and founders get a short "could you point me / refer me" ask, not a recruiter pitch. */
export function recipientIsNotRecruiter(title: string | null | undefined): boolean {
  if (!title) return false;
  if (/\b(recruit\w*|talent|people|hr|human resources|hiring|sourc\w*|campus|university relations)\b/i.test(title)) return false;
  return /\b(engineer\w*|developer|sde|swe|architect|manager|lead|head|director|vp|cto|ceo|founder|co-?founder|scientist|principal|staff)\b/i.test(title);
}

function describeTask(
  ctx: DraftContext,
  req: { kind: 'initial' | 'follow_up'; goal: AiDraftRequest['goal']; extra_instructions?: string | null; avoid_openings?: string[] },
  hasAttachment: boolean,
): string {
  const category = classifyRoleCategory(ctx.roleLabel, ctx.opportunity?.description);
  const lines = [
    `Email type: ${req.kind === 'initial' ? 'first outreach' : `follow-up #${ctx.previousMessages.filter((m) => m.kind === 'follow_up').length + 1} to the previous email (same thread)`}`,
    `Role category: ${ROLE_CATEGORY_LABELS[category]}`,
    `Desired outcome: ${OUTREACH_GOAL_LABELS[req.goal]}`,
    `Tone: ${TONE_LABELS[ctx.tone]}`,
    `Length: ${req.kind === 'initial' ? '110–170 words' : '50–90 words'} for the body`,
    `Résumé attached: ${hasAttachment ? 'yes — mention it once, briefly' : 'no — do not mention an attachment'}`,
  ];
  if (req.kind === 'initial' && ctx.opportunity?.analysis) {
    lines.push(
      'Structure: open by connecting ONE of the team\'s priorities (fact job:priorities) to the candidate\'s most relevant project or experience from the facts, in your own words (quote at most 8 words of the job description). Then one or two sentences on matching skills, shown through what the candidate built, not as a list. Never mention skills the candidate lacks and never apologise for gaps.',
    );
    lines.push('Subject: specific to this role and the candidate (e.g. role title plus the candidate\'s strongest relevant project or skill), under 70 characters, no clickbait.');
  }
  if (req.kind === 'initial' && recipientIsNotRecruiter(ctx.recruiter.title)) {
    lines.push(
      `The recipient (${ctx.recruiter.title}) is not a recruiter. Keep the body to 80–120 words and ask whether they would be open to referring the candidate or pointing them to the right hiring contact.`,
    );
  }
  if (req.avoid_openings?.length) {
    lines.push(`Other people at this company are getting a similar email. Start the body differently from each of these openings and use a different subject line:\n${req.avoid_openings.map((o) => `- ${o.slice(0, 300)}`).join('\n')}`);
  }
  if (req.kind === 'follow_up') {
    lines.push('Subject must be "Re: " followed by the previous subject exactly.');
    lines.push('Reference the previous email accurately (date and topic). Do not repeat the whole pitch; add at most one new relevant fact.');
  }
  if (ctx.writingStyle) lines.push(`Candidate's writing-style preferences: ${ctx.writingStyle.slice(0, 800)}`);
  const styleExample = req.kind === 'initial' ? ctx.templates.initial : ctx.templates.followup_1;
  if (styleExample?.body) lines.push(`Candidate's own template (use only as a style reference; facts still come from <facts>):\n${styleExample.body.slice(0, 1200)}`);
  if (req.extra_instructions) lines.push(`Extra instructions from the candidate: ${req.extra_instructions}`);
  lines.push(`Signature block to end with:\n${ctx.signature}`);
  return lines.join('\n');
}

function factsBlock(ctx: DraftContext): string {
  return ctx.facts.map((f) => `[${f.id}] ${f.text}`).join('\n');
}

const REFINE_INSTRUCTIONS: Record<AiRefineAction, (tone: Tone) => string> = {
  concise: () => 'Rewrite the draft to be noticeably shorter (under 110 words for a first email, under 70 for a follow-up) while keeping the strongest relevant fact and the request.',
  personalize: () =>
    'Rewrite the draft so it connects the candidate’s verified facts more specifically to this role and company. Use only facts given; if there is no company information, focus on the role requirements instead of praising the company.',
  emphasize_projects: () => 'Rewrite the draft to lead with the one or two projects from the facts that best match the role, stating what was built and any verbatim achievement.',
  change_tone: (tone) => `Rewrite the draft in this tone: ${TONE_LABELS[tone]}. Keep the facts and the request.`,
  regenerate: () => 'Write a fresh alternative version with a different opening and structure. Same rules.',
};

function sanitizeModelText(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*subject:\s.*\n+/i, '')
    .trim()
    .slice(0, max);
}

async function callModel(deps: Deps, system: string, user: string): Promise<{ subject: string; body: string; facts_used: string[]; notes: string[] }> {
  if (!deps.ai) throw new AppError(503, 'AI_NOT_CONFIGURED', deps.config.ai.reason ?? 'AI drafting is not configured on the server.');
  let lastError = 'The AI response could not be read.';
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      text = await deps.ai.complete({ system, user: attempt === 0 ? user : `${user}\n\nReturn ONLY the JSON object.`, maxTokens: 1200, temperature: 0.4, json: true });
    } catch (err) {
      if (err instanceof AiProviderError) {
        deps.logger.warn({ status: err.status, provider: deps.ai.name }, 'AI provider error');
        throw new AppError(err.status === 429 ? 429 : 502, 'AI_PROVIDER_ERROR', err.status === 429 ? 'The AI provider is rate limiting requests. Try again in a minute.' : 'The AI provider returned an error. Try again, or use your template.');
      }
      throw err;
    }
    const obj = parseJsonObject(text);
    const subject = sanitizeModelText(obj?.subject, 300);
    const body = sanitizeModelText(obj?.body, 8000);
    if (subject && body) {
      const factsUsed = Array.isArray(obj?.facts_used) ? (obj.facts_used as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 30) : [];
      const notes = Array.isArray(obj?.notes) ? (obj.notes as unknown[]).filter((x): x is string => typeof x === 'string').map((n) => n.slice(0, 300)).slice(0, 5) : [];
      return { subject, body, facts_used: factsUsed, notes };
    }
    lastError = 'The AI response was missing a subject or body.';
  }
  throw new AppError(502, 'AI_BAD_RESPONSE', `${lastError} Try again, or use your template.`);
}

export function qualityFor(ctx: DraftContext, kind: 'initial' | 'follow_up', subject: string, body: string, hasAttachment: boolean): QualityFinding[] {
  return runQualityChecks({
    kind,
    subject,
    body,
    recruiterName: ctx.recruiter.full_name,
    recruiterEmail: ctx.recruiter.email,
    companyName: ctx.companyName,
    otherCompanyNames: ctx.otherCompanyNames,
    candidateSkills: ctx.candidateSkills,
    factsText: `${ctx.factsText}\n${ctx.signature}`,
    attachment: { required: ctx.attachmentRequired, present: hasAttachment },
    previousContact: kind === 'initial' ? { count: ctx.previousContactCount, lastSentAt: ctx.lastSentAt } : undefined,
  });
}

export async function generateDraft(deps: Deps, tx: Tx, userId: string, req: AiDraftRequest): Promise<DraftResult> {
  const ctx = await buildDraftContext(deps, tx, userId, req);
  const hasAttachment = !!ctx.resume;
  const step = ctx.previousMessages.filter((m) => m.kind === 'follow_up').length + 1;
  if (req.kind === 'follow_up' && !ctx.previousMessages.length) {
    throw unprocessable('NOTHING_TO_FOLLOW_UP', 'There is no sent email to this recruiter to follow up on.');
  }
  if (req.use_template || !deps.ai) {
    const d = templateDraft(ctx, req.kind, step, hasAttachment);
    const notes = deps.ai ? [] : [deps.config.ai.reason ?? 'AI drafting is not configured; this draft was built from your template and profile.'];
    if (d.missingVariables.length) {
      notes.push(`Your template uses ${d.missingVariables.map((v) => `{${v}}`).join(', ')}, which ${d.missingVariables.length > 1 ? 'have' : 'has'} no value for this recruiter — edit the text before sending.`);
    }
    return { subject: d.subject, body_text: d.body, source: 'template', provider: null, model: null, facts_used: [], quality: qualityFor(ctx, req.kind, d.subject, d.body, hasAttachment), notes };
  }
  const user = `<facts>\n${factsBlock(ctx)}\n</facts>\n\n<task>\n${describeTask(ctx, req, hasAttachment)}\n</task>`;
  const out = await callModel(deps, SYSTEM_PROMPT, user);
  let subject = out.subject;
  const last = ctx.previousMessages.at(-1);
  if (req.kind === 'follow_up' && last) subject = `Re: ${last.subject.replace(/^(re:\s*)+/i, '')}`;
  const known = new Set(ctx.facts.map((f) => f.id));
  return {
    subject,
    body_text: out.body,
    source: 'ai',
    provider: deps.ai.name,
    model: deps.ai.model,
    facts_used: out.facts_used.filter((f) => known.has(f)),
    quality: qualityFor(ctx, req.kind, subject, out.body, hasAttachment),
    notes: out.notes,
  };
}

export async function refineDraft(
  deps: Deps,
  tx: Tx,
  userId: string,
  req: AiDraftRequest & { action: AiRefineAction; subject: string; body_text: string },
): Promise<DraftResult> {
  const ctx = await buildDraftContext(deps, tx, userId, req);
  const hasAttachment = !!ctx.resume;
  if (!deps.ai) throw new AppError(503, 'AI_NOT_CONFIGURED', deps.config.ai.reason ?? 'AI drafting is not configured on the server.');
  const user = `<facts>\n${factsBlock(ctx)}\n</facts>\n\n<task>\n${describeTask(ctx, req, hasAttachment)}\n</task>\n\n<current_draft>\nSubject: ${req.subject}\n\n${req.body_text}\n</current_draft>\n\n<instruction>\n${REFINE_INSTRUCTIONS[req.action](req.tone ?? ctx.tone)} The candidate may have edited the draft by hand; keep any of their facts that also appear in <facts>, and drop anything that does not.\n</instruction>`;
  const out = await callModel(deps, SYSTEM_PROMPT, user);
  const last = ctx.previousMessages.at(-1);
  const subject = req.kind === 'follow_up' && last ? `Re: ${last.subject.replace(/^(re:\s*)+/i, '')}` : out.subject;
  const known = new Set(ctx.facts.map((f) => f.id));
  return {
    subject,
    body_text: out.body,
    source: 'ai',
    provider: deps.ai.name,
    model: deps.ai.model,
    facts_used: out.facts_used.filter((f) => known.has(f)),
    quality: qualityFor(ctx, req.kind, subject, out.body, hasAttachment),
    notes: [`${AI_REFINE_ACTION_LABELS[req.action]} applied.`, ...out.notes],
  };
}

/* ------------------------------------------------------------------ */
/* Profile-to-role match (explanation, not a score)                    */
/* ------------------------------------------------------------------ */

export async function explainRoleMatch(deps: Deps, tx: Tx, userId: string, opportunityId: string) {
  const opp = await getOpportunity(tx, userId, opportunityId);
  if (!opp) throw notFound('Opportunity');
  const profile = await getProfile(tx, userId);
  const skills = verifiedSkills(profile);
  const jobSkills = opp.required_skills.length ? opp.required_skills : extractSkills(opp.description ?? '');
  const have = canonicalSkillSet(skills);
  const matched = jobSkills.filter((s) => have.has(s.toLowerCase()));
  const missing = jobSkills.filter((s) => !have.has(s.toLowerCase()));
  const projects = profile ? rankProjects(profile, jobSkills, opp.description ?? '').slice(0, 3) : [];
  const relevantProjects = projects
    .map((p) => ({
      name: p.name,
      overlapping: (p.technologies ?? []).filter((t) => canonicalSkillSet(jobSkills).has(t.toLowerCase())),
    }))
    .filter((p) => p.overlapping.length);
  return {
    opportunity_id: opp.id,
    matched_skills: matched,
    missing_skills: missing,
    considered: jobSkills.length,
    relevant_projects: relevantProjects,
    summary: jobSkills.length
      ? `Your profile lists ${matched.length} of the ${jobSkills.length} skills mentioned in this posting.`
      : 'This posting does not list recognisable skills; add the description or skills to compare.',
    caveat: 'Based only on skills written in your profile and the posting. It is not a prediction of your chances.',
  };
}
