import { z } from 'zod';
import {
  AI_REFINE_ACTIONS,
  EMAIL_VERIFICATION,
  EMPLOYMENT_TYPES,
  FOLLOWUP_STATUSES,
  JOB_TYPES,
  OPPORTUNITY_STATUSES,
  OUTREACH_GOALS,
  OUTREACH_STATUSES,
  RECRUITER_SOURCES,
  REPLY_STATUSES,
  SEND_STATUSES,
  TEMPLATE_TYPES,
  TONES,
} from './enums.js';
import { isValidEmail } from './email.js';
import { canonicalTimezone, isValidTimezone } from './dates.js';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export const uuid = z.uuid();
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish();

export const emailField = z
  .string()
  .trim()
  .max(254)
  .refine((v) => isValidEmail(v), { message: 'Enter a valid email address' });

/** http(s) URL or empty → null. Rejects javascript:, data: etc. */
export const urlField = z
  .string()
  .trim()
  .max(2048)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\/[^\s]+$/i.test(v), { message: 'Must be an http(s) URL' });

const tagList = z.array(z.string().trim().min(1).max(40)).max(20);
const shortList = (maxItems: number, maxLen = 80) => z.array(z.string().trim().min(1).max(maxLen)).max(maxItems);

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export const projectSchema = z.object({
  id: z.string().min(1).max(40),
  name: text(120).min(1),
  description: text(1200).default(''),
  technologies: shortList(25, 50).default([]),
  /** Achievements exactly as the candidate states them (used verbatim as facts). */
  achievements: shortList(8, 300).default([]),
  url: urlField,
});
export type Project = z.infer<typeof projectSchema>;

export const experienceSchema = z.object({
  id: z.string().min(1).max(40),
  organization: text(120).min(1),
  title: text(120).min(1),
  start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullish(),
  end: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullish(),
  current: z.boolean().default(false),
  description: text(1200).default(''),
  achievements: shortList(8, 300).default([]),
  technologies: shortList(25, 50).default([]),
});
export type Experience = z.infer<typeof experienceSchema>;

export const profileLinksSchema = z.object({
  github: urlField,
  linkedin: urlField,
  portfolio: urlField,
  other: z.array(z.object({ label: text(40).min(1), url: z.string().trim().regex(/^https?:\/\/\S+$/i) })).max(8).default([]),
});

/*
 * NOTE (zod 4): `.partial()` keeps `.default()` values, so a PATCH schema built
 * with `.partial()` from a schema with defaults would silently overwrite stored
 * data. Every entity therefore has a defaults-free field set used for PATCH,
 * and a separate create/replace schema that adds defaults.
 */
const profileFields = {
  full_name: text(120).min(1),
  primary_email: emailField.nullish(),
  phone: optionalText(40),
  degree: optionalText(120),
  specialization: optionalText(120),
  university: optionalText(160),
  graduation_month: z.number().int().min(1).max(12).nullish(),
  graduation_year: z.number().int().min(1990).max(2100).nullish(),
  current_location: optionalText(120),
  preferred_locations: shortList(15),
  job_types: z.array(z.enum(JOB_TYPES)).max(4),
  target_roles: shortList(15),
  skills: shortList(80, 50),
  projects: z.array(projectSchema).max(15),
  experience: z.array(experienceSchema).max(15),
  links: profileLinksSchema,
  preferred_tone: z.enum(TONES),
  writing_style: optionalText(1000),
  signature: optionalText(600),
};

export const profileUpdateSchema = z.object({
  ...profileFields,
  preferred_locations: profileFields.preferred_locations.default([]),
  job_types: profileFields.job_types.default([]),
  target_roles: profileFields.target_roles.default([]),
  skills: profileFields.skills.default([]),
  projects: profileFields.projects.default([]),
  experience: profileFields.experience.default([]),
  links: profileFields.links.default({ github: null, linkedin: null, portfolio: null, other: [] }),
  preferred_tone: profileFields.preferred_tone.default('professional'),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** Partial save (onboarding steps, single-section edits): only provided keys are written. */
export const profilePatchSchema = z.object(profileFields).partial();

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const settingsUpdateSchema = z
  .object({
    timezone: z.string().max(64).transform(canonicalTimezone).refine(isValidTimezone, { message: 'Unknown timezone' }),
    tracking_enabled: z.boolean(),
    tracking_retention_days: z.number().int().min(7).max(730),
    followup_delay_business_days: z.number().int().min(1).max(30),
    max_followups: z.number().int().min(0).max(3),
    followup_autosend_enabled: z.boolean(),
    followup_autosend_daily_cap: z.number().int().min(1).max(10),
    daily_send_limit: z.number().int().min(1).max(200),
    send_spacing_min_seconds: z.number().int().min(15).max(600),
    send_spacing_max_seconds: z.number().int().min(15).max(1800),
    sending_paused: z.boolean(),
    require_resume_attachment: z.boolean(),
    reply_scan_new_threads: z.boolean(),
    default_resume_id: uuid.nullable(),
    attachment_filename: z
      .string()
      .trim()
      .max(100)
      .regex(/^[\p{L}\p{N} _.()-]*$/u, { message: 'Use letters, numbers, spaces, dots, dashes or underscores' })
      .nullable(),
  })
  .partial()
  .refine(
    (s) => s.send_spacing_min_seconds === undefined || s.send_spacing_max_seconds === undefined || s.send_spacing_min_seconds <= s.send_spacing_max_seconds,
    { message: 'Minimum spacing must not exceed maximum spacing', path: ['send_spacing_min_seconds'] },
  );
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

/* ------------------------------------------------------------------ */
/* Recruiters                                                          */
/* ------------------------------------------------------------------ */

const recruiterFields = {
  full_name: optionalText(120),
  email: emailField,
  company: optionalText(160),
  title: optionalText(160),
  linkedin_url: urlField,
  company_website: urlField,
  source: z.enum(RECRUITER_SOURCES),
  source_url: urlField,
  target_role: optionalText(160),
  email_verification: z.enum(EMAIL_VERIFICATION),
  notes: optionalText(4000),
  tags: tagList,
};

export const recruiterCreateSchema = z.object({
  ...recruiterFields,
  source: recruiterFields.source.default('manual'),
  email_verification: recruiterFields.email_verification.default('provided'),
  tags: recruiterFields.tags.default([]),
  opportunity_id: uuid.nullish(),
});
export type RecruiterCreate = z.infer<typeof recruiterCreateSchema>;

export const recruiterUpdateSchema = z
  .object(recruiterFields)
  .partial()
  .extend({
    outreach_status: z.enum(OUTREACH_STATUSES).optional(),
    do_not_contact: z.boolean().optional(),
  });
export type RecruiterUpdate = z.infer<typeof recruiterUpdateSchema>;

export const RECRUITER_SORTS = ['recent_contact', 'followup_due', 'created_desc', 'name', 'company'] as const;

export const recruiterListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(OUTREACH_STATUSES).optional(),
  source: z.enum(RECRUITER_SOURCES).optional(),
  tag: z.string().trim().max(40).optional(),
  opportunity_id: uuid.optional(),
  role: z.string().trim().max(160).optional(),
  added_from: z.iso.date().optional(),
  added_to: z.iso.date().optional(),
  sort: z.enum(RECRUITER_SORTS).default('created_desc'),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});
export type RecruiterListQuery = z.infer<typeof recruiterListQuerySchema>;

export const recruiterMergeSchema = z.object({ source_id: uuid });

export const csvImportOptionsSchema = z.object({
  dry_run: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(true)
    .transform((v) => v === true || v === 'true'),
  default_tags: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10) : [])),
});

/* ------------------------------------------------------------------ */
/* Opportunities                                                       */
/* ------------------------------------------------------------------ */

const opportunityFields = {
  company: text(160).min(1),
  title: text(200).min(1),
  description: optionalText(30000),
  job_url: urlField,
  location: optionalText(160),
  employment_type: z.enum(EMPLOYMENT_TYPES),
  required_skills: shortList(40, 50),
  experience_requirements: optionalText(300),
  discovered_at: z.iso.date().nullish(),
  deadline: z.iso.date().nullish(),
  status: z.enum(OPPORTUNITY_STATUSES),
  source: z.enum(['manual', 'browser_capture', 'import', 'other']),
  source_url: urlField,
  notes: optionalText(6000),
  company_notes: optionalText(4000),
};

export const opportunityCreateSchema = z.object({
  ...opportunityFields,
  employment_type: opportunityFields.employment_type.default('unknown'),
  required_skills: opportunityFields.required_skills.optional(),
  status: opportunityFields.status.default('saved'),
  source: opportunityFields.source.default('manual'),
  recruiter_ids: z.array(uuid).max(50).optional(),
});
export type OpportunityCreate = z.infer<typeof opportunityCreateSchema>;

export const opportunityUpdateSchema = z.object(opportunityFields).partial();
export type OpportunityUpdate = z.infer<typeof opportunityUpdateSchema>;

export const opportunityListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(OPPORTUNITY_STATUSES).optional(),
  active: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export const linkRecruitersSchema = z.object({ recruiter_ids: z.array(uuid).min(1).max(50) });

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export const draftCreateSchema = z.object({
  recruiter_id: uuid,
  opportunity_id: uuid.nullish(),
  campaign_id: uuid.nullish(),
  resume_id: uuid.nullish(),
  follow_up_id: uuid.nullish(),
  subject: text(300).default(''),
  body_text: text(20000).default(''),
  manual_role: optionalText(200),
  tracking_enabled: z.boolean().optional(),
  ai_generated: z.boolean().default(false),
  generation_meta: z.record(z.string(), z.unknown()).optional(),
});
export type DraftCreate = z.infer<typeof draftCreateSchema>;

export const draftUpdateSchema = z.object({
  subject: text(300).optional(),
  body_text: text(20000).optional(),
  resume_id: uuid.nullable().optional(),
  opportunity_id: uuid.nullable().optional(),
  campaign_id: uuid.nullable().optional(),
  manual_role: optionalText(200),
  tracking_enabled: z.boolean().optional(),
});
export type DraftUpdate = z.infer<typeof draftUpdateSchema>;

export const sendRequestSchema = z.object({
  /** ISO time to send later; omitted = send now. */
  send_at: z.iso.datetime({ offset: true }).nullish(),
  /** Approve now but let the send queue deliver it (respects spacing and the daily limit). */
  queue: z.boolean().default(false),
  /** The user explicitly confirmed sending again to an already-contacted recruiter. */
  confirm_duplicate: z.boolean().default(false),
  /** The user explicitly confirmed an address that was inferred, not provided. */
  confirm_unverified_email: z.boolean().default(false),
  /** The user explicitly chose to send despite blocking quality findings. */
  confirm_quality_override: z.boolean().default(false),
  /** The user explicitly chose to message a recruiter who already replied. */
  confirm_after_reply: z.boolean().default(false),
});
export type SendRequest = z.infer<typeof sendRequestSchema>;

export const resolveUnknownSchema = z.object({ outcome: z.enum(['sent', 'failed']) });

export const replyCorrectionSchema = z.object({
  reply_status: z.enum(REPLY_STATUSES),
  replied_at: z.iso.datetime({ offset: true }).nullish(),
});

export const messageListQuerySchema = z.object({
  recruiter_id: uuid.optional(),
  opportunity_id: uuid.optional(),
  campaign_id: uuid.optional(),
  send_status: z.enum(SEND_STATUSES).optional(),
  reply_status: z.enum(REPLY_STATUSES).optional(),
  kind: z.enum(['initial', 'follow_up']).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

export const qualityCheckSchema = z.object({
  recruiter_id: uuid,
  opportunity_id: uuid.nullish(),
  resume_id: uuid.nullish(),
  kind: z.enum(['initial', 'follow_up']).default('initial'),
  subject: text(300),
  body_text: text(20000),
});

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

export const aiDraftSchema = z.object({
  recruiter_id: uuid,
  opportunity_id: uuid.nullish(),
  manual_role: optionalText(200),
  resume_id: uuid.nullish(),
  tone: z.enum(TONES).optional(),
  goal: z.enum(OUTREACH_GOALS).default('interview_consideration'),
  kind: z.enum(['initial', 'follow_up']).default('initial'),
  /** For follow-ups: the message being followed up. */
  follow_up_of_message_id: uuid.nullish(),
  extra_instructions: optionalText(600),
  /** Force the non-AI template composer even if AI is configured. */
  use_template: z.boolean().default(false),
});
export type AiDraftRequest = z.infer<typeof aiDraftSchema>;

export const aiRefineSchema = aiDraftSchema.extend({
  action: z.enum(AI_REFINE_ACTIONS),
  subject: text(300),
  body_text: text(20000),
});
export type AiRefineRequest = z.infer<typeof aiRefineSchema>;

export const resumeExtractSchema = z.object({
  resume_id: uuid.nullish(),
  pasted_text: z.string().max(60000).nullish(),
});

/* ------------------------------------------------------------------ */
/* Follow-ups                                                          */
/* ------------------------------------------------------------------ */

export const followUpUpdateSchema = z.object({
  status: z.enum(FOLLOWUP_STATUSES).optional(),
  due_at: z.iso.datetime({ offset: true }).optional(),
  auto_send: z.boolean().optional(),
});

export const followUpListQuerySchema = z.object({
  view: z.enum(['due', 'upcoming', 'all_pending', 'closed']).default('due'),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

/* ------------------------------------------------------------------ */
/* Templates, campaigns, misc                                          */
/* ------------------------------------------------------------------ */

export const templateUpdateSchema = z.object({
  subject: text(300),
  body: text(10000),
});

export const templateTypeParam = z.enum(TEMPLATE_TYPES);

export const campaignCreateSchema = z.object({
  name: text(120).min(1),
  description: optionalText(1000),
});

export const resumeUpdateSchema = z.object({
  label: text(80).min(1).optional(),
  role_tags: tagList.optional(),
  is_default: z.boolean().optional(),
});

export const analyticsRangeSchema = z.object({
  range: z.enum(['7d', '30d', '90d', '365d', 'all']).default('30d'),
});

/** The extension's chrome.identity redirect, e.g. https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/gmail */
export const EXTENSION_REDIRECT_RE = /^https:\/\/[a-p]{32}\.chromiumapp\.org\/[A-Za-z0-9_\-/]*$/;

export const gmailAuthorizeSchema = z
  .object({
    return_to: z.enum(['dashboard', 'onboarding', 'extension']).default('dashboard'),
    extension_redirect: z.string().max(200).regex(EXTENSION_REDIRECT_RE).optional(),
  })
  .refine((v) => v.return_to !== 'extension' || !!v.extension_redirect, { message: 'extension_redirect is required when return_to is extension', path: ['extension_redirect'] });

export const gmailCompleteSchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(256),
});

export const selfViewSchema = z.object({
  emails: z.array(emailField).min(1).max(20),
});

export const recruiterLookupSchema = z.object({
  emails: z.array(z.string().trim().max(254)).min(1).max(50),
});
