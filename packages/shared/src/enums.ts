/**
 * Canonical enumerations. These mirror CHECK constraints in
 * supabase/migrations/*_autoreach_v2.sql — keep them in sync.
 */

export const OUTREACH_STATUSES = [
  'new',
  'contacted',
  'replied',
  'interviewing',
  'not_interested',
  'bounced',
  'do_not_contact',
] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const OUTREACH_STATUS_LABELS: Record<OutreachStatus, string> = {
  new: 'Not contacted',
  contacted: 'Contacted',
  replied: 'Replied',
  interviewing: 'Interviewing',
  not_interested: 'Not interested',
  bounced: 'Bounced',
  do_not_contact: 'Do not contact',
};

export const RECRUITER_SOURCES = [
  'manual',
  'csv',
  'browser_capture',
  'company_site',
  'linkedin',
  'referral',
  'legacy',
  'other',
] as const;
export type RecruiterSource = (typeof RECRUITER_SOURCES)[number];

export const RECRUITER_SOURCE_LABELS: Record<RecruiterSource, string> = {
  manual: 'Manual',
  csv: 'CSV import',
  browser_capture: 'Captured from page',
  company_site: 'Company website',
  linkedin: 'LinkedIn (entered manually)',
  referral: 'Referral',
  legacy: 'AutoReach v1',
  other: 'Other',
};

/**
 * How much we know about an email address.
 *  - provided:        the user typed or imported it
 *  - confirmed:       the user explicitly confirmed an address that was inferred
 *  - unverified_guess: inferred (pattern / third-party finder); sending requires confirmation
 */
export const EMAIL_VERIFICATION = ['provided', 'confirmed', 'unverified_guess'] as const;
export type EmailVerification = (typeof EMAIL_VERIFICATION)[number];

export const OPPORTUNITY_STATUSES = [
  'saved',
  'researching',
  'ready',
  'contacted',
  'applied',
  'interviewing',
  'offer',
  'rejected',
  'closed',
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  saved: 'Saved',
  researching: 'Researching',
  ready: 'Ready for outreach',
  contacted: 'Contacted',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
  closed: 'Closed',
};

/** Statuses that no longer need action — used for "active opportunities". */
export const TERMINAL_OPPORTUNITY_STATUSES: readonly OpportunityStatus[] = ['offer', 'rejected', 'closed'];

export const EMPLOYMENT_TYPES = ['internship', 'full_time', 'graduate_program', 'contract', 'part_time', 'unknown'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  internship: 'Internship',
  full_time: 'Full-time',
  graduate_program: 'Graduate program',
  contract: 'Contract',
  part_time: 'Part-time',
  unknown: 'Not specified',
};

/** Job types a candidate can prefer (subset of employment types). */
export const JOB_TYPES = ['internship', 'full_time', 'graduate_program', 'contract'] as const;
export type JobType = (typeof JOB_TYPES)[number];

/**
 * Send lifecycle of a single outbound message. Opening and replying are
 * deliberately NOT part of this enum — they are separate facts.
 *  - unknown: the request reached Gmail but no definitive answer came back
 *    (timeout / 5xx). It may or may not have been sent; never auto-retried.
 */
export const SEND_STATUSES = ['draft', 'queued', 'sending', 'sent', 'failed', 'unknown'] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];

export const REPLY_STATUSES = ['none', 'replied', 'auto_reply', 'bounced', 'needs_review'] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

export const MESSAGE_KINDS = ['initial', 'follow_up'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const FOLLOWUP_STATUSES = ['pending', 'completed', 'dismissed', 'cancelled'] as const;
export type FollowUpStatus = (typeof FOLLOWUP_STATUSES)[number];

export const TONES = ['professional', 'friendly', 'enthusiastic', 'formal', 'direct'] as const;
export type Tone = (typeof TONES)[number];

export const TONE_LABELS: Record<Tone, string> = {
  professional: 'Professional',
  friendly: 'Warm & friendly',
  enthusiastic: 'Enthusiastic',
  formal: 'Formal',
  direct: 'Short & direct',
};

/**
 * Classification of a tracking-pixel request.
 *  - open_detected:  counted as an "open detected" signal
 *  - proxy:          fetched by a mail provider image proxy; counted, with caveat
 *  - suspected_self: probably the sender viewing their own Sent mail; not counted
 *  - suspected_automated: probably a security scanner/prefetch; not counted
 */
export const TRACKING_CLASSIFICATIONS = ['open_detected', 'proxy', 'suspected_self', 'suspected_automated'] as const;
export type TrackingClassification = (typeof TRACKING_CLASSIFICATIONS)[number];

export const COUNTED_TRACKING_CLASSIFICATIONS: readonly TrackingClassification[] = ['open_detected', 'proxy'];

export const INBOUND_CLASSIFICATIONS = [
  'reply',
  'possible_reply',
  'auto_reply',
  'bounce',
  'own_message',
  'other_sender',
] as const;
export type InboundClassification = (typeof INBOUND_CLASSIFICATIONS)[number];

export const ACTIVITY_TYPES = [
  'recruiter_added',
  'recruiter_updated',
  'recruiters_merged',
  'recruiters_imported',
  'opportunity_created',
  'opportunity_status_changed',
  'draft_created',
  'email_queued',
  'email_sent',
  'email_failed',
  'email_send_unknown',
  'open_detected',
  'reply_received',
  'auto_reply_received',
  'bounce_detected',
  'reply_needs_review',
  'followup_scheduled',
  'followup_completed',
  'followup_dismissed',
  'followup_cancelled',
  'followup_rescheduled',
  'gmail_connected',
  'gmail_disconnected',
  'sending_paused',
  'sending_resumed',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ROLE_CATEGORIES = [
  'frontend',
  'backend',
  'fullstack',
  'ai_ml',
  'data',
  'mobile',
  'devops_cloud',
  'security',
  'qa',
  'embedded',
  'general_swe',
  'speculative',
  'other',
] as const;
export type RoleCategory = (typeof ROLE_CATEGORIES)[number];

export const ROLE_CATEGORY_LABELS: Record<RoleCategory, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  fullstack: 'Full-stack',
  ai_ml: 'AI / ML',
  data: 'Data',
  mobile: 'Mobile',
  devops_cloud: 'DevOps / Cloud',
  security: 'Security',
  qa: 'QA / Testing',
  embedded: 'Embedded / Systems',
  general_swe: 'Software engineering (general)',
  speculative: 'Speculative (no listed vacancy)',
  other: 'Other',
};

export const AI_REFINE_ACTIONS = ['concise', 'personalize', 'emphasize_projects', 'change_tone', 'regenerate'] as const;
export type AiRefineAction = (typeof AI_REFINE_ACTIONS)[number];

export const AI_REFINE_ACTION_LABELS: Record<AiRefineAction, string> = {
  concise: 'Make more concise',
  personalize: 'Make more personalized',
  emphasize_projects: 'Emphasize relevant projects',
  change_tone: 'Change tone',
  regenerate: 'Regenerate',
};

export const TEMPLATE_TYPES = ['initial', 'followup_1', 'followup_2'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

/** Desired outcome the candidate wants from the email. */
export const OUTREACH_GOALS = ['interview_consideration', 'referral_to_team', 'info_on_openings', 'application_followup'] as const;
export type OutreachGoal = (typeof OUTREACH_GOALS)[number];

export const OUTREACH_GOAL_LABELS: Record<OutreachGoal, string> = {
  interview_consideration: 'Be considered for the role',
  referral_to_team: 'Be pointed to the right hiring manager',
  info_on_openings: 'Learn about current/upcoming openings',
  application_followup: 'Follow up on an application I submitted',
};
