import type { JobAnalysis, JobFit } from './jobs.js';
/**
 * Response shapes of the AutoReach API. Timestamps are ISO-8601 UTC strings;
 * clients render them in the user's timezone (UserSettings.timezone).
 */
import type {
  ActivityType,
  EmailVerification,
  EmploymentType,
  FollowUpStatus,
  InboundClassification,
  JobType,
  MessageKind,
  OpportunityStatus,
  OutreachStatus,
  RecruiterSource,
  ReplyStatus,
  RoleCategory,
  SendStatus,
  TemplateType,
  Tone,
  TrackingClassification,
} from './enums.js';
import type { Experience, Project } from './schemas.js';
import type { QualityFinding } from './quality.js';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; request_id?: string };
}

export interface Profile {
  user_id: string;
  full_name: string;
  primary_email: string | null;
  phone: string | null;
  degree: string | null;
  specialization: string | null;
  university: string | null;
  graduation_month: number | null;
  graduation_year: number | null;
  current_location: string | null;
  preferred_locations: string[];
  job_types: JobType[];
  target_roles: string[];
  skills: string[];
  projects: Project[];
  experience: Experience[];
  links: { github: string | null; linkedin: string | null; portfolio: string | null; other: { label: string; url: string }[] };
  preferred_tone: Tone;
  writing_style: string | null;
  signature: string | null;
  legacy_year: string | null;
  onboarding_completed_at: string | null;
  updated_at: string;
}

export interface UserSettings {
  timezone: string;
  tracking_enabled: boolean;
  tracking_retention_days: number;
  followup_delay_business_days: number;
  max_followups: number;
  followup_autosend_enabled: boolean;
  followup_autosend_daily_cap: number;
  daily_send_limit: number;
  send_spacing_min_seconds: number;
  send_spacing_max_seconds: number;
  sending_paused: boolean;
  require_resume_attachment: boolean;
  reply_scan_new_threads: boolean;
  default_resume_id: string | null;
  attachment_filename: string | null;
  updated_at: string;
}

export interface Resume {
  id: string;
  label: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string | null;
  role_tags: string[];
  is_default: boolean;
  has_text: boolean;
  legacy: boolean;
  created_at: string;
}

export interface GmailConnectionStatus {
  configured: boolean;
  connected: boolean;
  account_email: string | null;
  status: 'active' | 'needs_reauth' | 'revoked' | 'legacy_import_pending' | null;
  can_send: boolean;
  can_detect_replies: boolean;
  /** False when the server is set up to send only (no gmail.metadata permission requested). */
  reply_detection_enabled: boolean;
  scopes: string[];
  last_sync_at: string | null;
  sync_error: string | null;
}

export interface MeResponse {
  user: { id: string; email: string | null };
  profile: Profile | null;
  settings: UserSettings;
  gmail: GmailConnectionStatus;
  ai: { configured: boolean; provider: string | null; model: string | null };
  tracking: { configured: boolean; public_base_url: string | null };
  /** Hunter.io (HUNTER_API_KEY) for finding people at a company. */
  hunter: { configured: boolean };
  /** A career-ops folder on the server's computer that this user may read. */
  career_ops: { configured: boolean };
  completeness: { percent: number; items: { key: string; label: string; done: boolean }[] };
  onboarding_completed: boolean;
  sent_today: number;
}

export interface RecruiterSummary {
  id: string;
  full_name: string | null;
  email: string;
  company: string | null;
  company_id: string | null;
  title: string | null;
  linkedin_url: string | null;
  company_website: string | null;
  source: RecruiterSource;
  source_url: string | null;
  target_role: string | null;
  outreach_status: OutreachStatus;
  email_verification: EmailVerification;
  do_not_contact: boolean;
  notes: string | null;
  tags: string[];
  last_contacted_at: string | null;
  last_reply_at: string | null;
  next_follow_up_at: string | null;
  messages_sent: number;
  opportunity_count: number;
  is_role_address: boolean;
  created_at: string;
  updated_at: string;
}

export interface OpportunityRef {
  id: string;
  title: string;
  company: string;
  status: OpportunityStatus;
}

export interface RecruiterDetail extends RecruiterSummary {
  opportunities: OpportunityRef[];
  messages: MessageSummary[];
  follow_ups: FollowUp[];
  merged_from: { id: string; email: string; full_name: string | null }[];
}

export interface DuplicateSuggestion {
  reason: 'same_canonical_email' | 'same_name_and_company';
  recruiters: Pick<RecruiterSummary, 'id' | 'full_name' | 'email' | 'company' | 'messages_sent' | 'created_at'>[];
}

export interface Opportunity {
  id: string;
  company: string;
  company_id: string | null;
  title: string;
  role_category: RoleCategory;
  description: string | null;
  job_url: string | null;
  location: string | null;
  employment_type: EmploymentType;
  required_skills: string[];
  experience_requirements: string | null;
  discovered_at: string | null;
  deadline: string | null;
  status: OpportunityStatus;
  source: string;
  source_url: string | null;
  notes: string | null;
  company_notes: string | null;
  /** The job-description analysis the candidate confirmed (null for opportunities saved without one). */
  analysis: JobAnalysis | null;
  /** Set for jobs imported from career-ops: its report number and 0–5 score. */
  career_ops_report: number | null;
  career_ops_score: number | null;
  recruiter_count: number;
  messages_sent: number;
  replies: number;
  created_at: string;
  updated_at: string;
}

export interface OpportunityDetail extends Opportunity {
  recruiters: Pick<RecruiterSummary, 'id' | 'full_name' | 'email' | 'title' | 'outreach_status' | 'last_contacted_at'>[];
  messages: MessageSummary[];
  skill_match: { matched: string[]; missing: string[]; considered: number };
}

export interface MessageSummary {
  id: string;
  kind: MessageKind;
  recruiter_id: string | null;
  recruiter_name: string | null;
  recipient_email: string;
  company: string | null;
  opportunity_id: string | null;
  opportunity_title: string | null;
  role_label: string | null;
  campaign_id: string | null;
  subject: string;
  send_status: SendStatus;
  reply_status: ReplyStatus;
  tracking_enabled: boolean;
  first_open_at: string | null;
  last_open_at: string | null;
  open_event_count: number;
  scheduled_for: string | null;
  sent_at: string | null;
  failed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  replied_at: string | null;
  gmail_thread_id: string | null;
  gmail_message_id: string | null;
  next_follow_up_at: string | null;
  ai_generated: boolean;
  legacy: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessageDetail extends MessageSummary {
  body_text: string;
  resume_id: string | null;
  attachment: { file_name: string; size_bytes: number; sha256: string | null } | null;
  manual_role: string | null;
  follow_up_id: string | null;
  parent_message_id: string | null;
  events: { id: string; occurred_at: string; classification: TrackingClassification; ua_family: string; counted: boolean }[];
  thread: { id: string; occurred_at: string; from_email: string; subject: string | null; classification: InboundClassification; needs_review: boolean }[];
  gmail_url: string | null;
}

export interface FollowUp {
  id: string;
  recruiter_id: string;
  recruiter_name: string | null;
  recruiter_email: string;
  company: string | null;
  original_message_id: string;
  previous_message_id: string;
  previous_subject: string | null;
  previous_sent_at: string | null;
  step: number;
  due_at: string;
  status: FollowUpStatus;
  auto_send: boolean;
  cancel_reason: string | null;
  draft_message_id: string | null;
  completed_message_id: string | null;
  business_days_since_contact: number | null;
  created_at: string;
}

export interface ActivityItem {
  id: string;
  type: ActivityType;
  summary: string;
  recruiter_id: string | null;
  opportunity_id: string | null;
  message_id: string | null;
  occurred_at: string;
}

export interface Template {
  type: TemplateType;
  subject: string;
  body: string;
  updated_at: string | null;
}

export interface DraftResult {
  subject: string;
  body_text: string;
  source: 'ai' | 'template';
  provider: string | null;
  model: string | null;
  facts_used: string[];
  quality: QualityFinding[];
  notes: string[];
}

export interface KpiValue {
  value: number;
  previous: number | null;
}

export interface AnalyticsOverview {
  range: string;
  kpis: {
    total_recruiters: KpiValue;
    emails_attempted: KpiValue;
    emails_sent: KpiValue;
    replies: KpiValue;
    followups_due: KpiValue;
    active_opportunities: KpiValue;
    response_rate: { value: number | null; previous: number | null; sample: number };
    opens_detected: KpiValue;
  };
}

export interface TimeseriesPoint {
  date: string;
  sent: number;
  replies: number;
  failed: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  sent: number;
  replies: number;
  response_rate: number | null;
  small_sample: boolean;
}

export interface Insight {
  id: string;
  title: string;
  detail: string;
  sample: number;
  directional: boolean;
}

export interface Recommendation {
  opportunity_id: string;
  title: string;
  company: string;
  status: OpportunityStatus;
  reasons: string[];
  next_action: string;
  matched_skills: number;
  considered_skills: number;
  has_recruiter: boolean;
  days_since_discovered: number | null;
  deadline: string | null;
}

/** POST /api/recruiters/lookup — one entry per requested address (used by the Gmail assist). */
export interface RecruiterLookupResult {
  email: string;
  recruiter: RecruiterSummary | null;
  messages: MessageSummary[];
}

/* ---------------- "Paste a job" screen ---------------- */

export interface JobAnalysisResult {
  analysis: JobAnalysis;
  fit: JobFit;
}

export interface JobView {
  opportunity: Opportunity;
  analysis: JobAnalysis | null;
  fit: JobFit | null;
  recruiters: RecruiterSummary[];
  /** The latest email to each person about this job (draft, queued or sent), keyed by recruiter id. */
  emails: Record<string, MessageSummary>;
}

export interface JobPasteResult extends JobView {
  added: number;
  already_saved: number;
  /** Pasted lines that had no email address. */
  skipped: string[];
}

export interface PreparedEmail {
  message: MessageDetail;
  /** Set when a new version was written just now. */
  draft: DraftResult | null;
  quality: QualityFinding[];
}

/* ---------------- career-ops (local folder) ---------------- */

/** Where a career-ops job's description would come from when it is imported. */
export type CareerOpsDescriptionSource = 'report' | 'saved' | 'link' | 'none';

export interface CareerOpsJob {
  /** The report number career-ops gave the evaluation (reports/{###}-…). */
  report_number: number;
  report_file: string;
  company: string | null;
  role: string | null;
  /** career-ops' global score, 0–5. */
  score: number | null;
  legitimacy: string | null;
  date: string | null;
  url: string | null;
  /** The application's status in career-ops' tracker, when it has a row. */
  status: string | null;
  description: CareerOpsDescriptionSource;
  /** Set when the job is already in AutoReach. */
  opportunity_id: string | null;
}

export interface CareerOpsOverview {
  jobs: CareerOpsJob[];
  /** Reports that couldn't be read (named, so nothing disappears silently). */
  unreadable: string[];
  /** Whether career-ops already has a cv.md. */
  cv_exists: boolean;
}

/* ---------------- Finding people (Hunter.io) ---------------- */

export type PeopleGroup = 'recruiters' | 'engineering' | 'everyone';

export const PEOPLE_GROUP_LABELS: Record<PeopleGroup, string> = {
  recruiters: 'Recruiters and HR',
  engineering: 'Engineering leads and managers',
  everyone: 'Everyone Hunter found',
};

export interface FoundPerson {
  email: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  department: string | null;
  seniority: string | null;
  /** Hunter's 0–100 confidence that this is the person's address. */
  confidence: number | null;
  /** Hunter's own deliverability check, if it ran one: valid, accept_all, unknown, … */
  hunter_status: string | null;
  linkedin: string | null;
  /** A public page where Hunter saw the address. */
  source_url: string | null;
  sources: number;
  /** Set when this address is already one of your recruiters. */
  recruiter_id?: string | null;
}

export interface PeopleSearch {
  people: FoundPerson[];
  /** The domain Hunter searched (it resolves a company name to one). */
  domain: string | null;
  limit: number;
}
