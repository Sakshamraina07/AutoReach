import type { JobView, MeResponse, MessageDetail, MessageSummary, PreparedEmail, RecruiterSummary } from '@autoreach/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import type * as ApiModule from '../lib/api';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof ApiModule>()), api: apiMock }));
const { ApiError } = await import('../lib/api');
const { default: JobPage } = await import('../pages/JobPage');

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const ASHA_ID = '22222222-2222-4222-8222-222222222222';
const MSG_ID = '33333333-3333-4333-8333-333333333333';

const me: MeResponse = {
  user: { id: 'u1', email: 'sam@student-mail.dev' },
  profile: null,
  settings: {
    timezone: 'Asia/Kolkata',
    tracking_enabled: false,
    tracking_retention_days: 180,
    followup_delay_business_days: 5,
    max_followups: 2,
    followup_autosend_enabled: false,
    followup_autosend_daily_cap: 3,
    daily_send_limit: 20,
    send_spacing_min_seconds: 45,
    send_spacing_max_seconds: 120,
    sending_paused: false,
    require_resume_attachment: false,
    reply_scan_new_threads: false,
    default_resume_id: 'r1',
    attachment_filename: null,
    updated_at: '2026-10-01T00:00:00Z',
  },
  gmail: { configured: true, connected: true, account_email: 'sam@student-mail.dev', status: 'active', can_send: true, can_detect_replies: true, reply_detection_enabled: true, scopes: [], last_sync_at: null, sync_error: null },
  ai: { configured: true, provider: 'gemini', model: 'gemini-3.8-flash' },
  tracking: { configured: false, public_base_url: null },
  completeness: { percent: 100, items: [] },
  onboarding_completed: true,
  sent_today: 0,
};

const asha = {
  id: ASHA_ID,
  full_name: 'Asha Rao',
  email: 'asha.rao@northwind-mail.example',
  company: 'Northwind Labs',
  title: 'University Recruiter',
  email_verification: 'provided',
  do_not_contact: false,
  outreach_status: 'not_contacted',
} as unknown as RecruiterSummary;

const BODY = "Hi Asha,\n\nI built QueueLite, a Node.js job queue backed by PostgreSQL.\n\nWould you consider me for the role?\n\nSam Kumar";

const summary = (over: Partial<MessageSummary> = {}) =>
  ({ id: MSG_ID, kind: 'initial', recruiter_id: ASHA_ID, opportunity_id: JOB_ID, subject: 'Backend intern — QueueLite', send_status: 'draft', reply_status: 'none', sent_at: null, scheduled_for: null, next_follow_up_at: null, created_at: '2026-10-17T10:00:00Z', updated_at: '2026-10-17T10:00:00Z', ...over }) as MessageSummary;

const detail = { ...summary(), body_text: BODY, resume_id: 'r1', attachment: null, manual_role: null, follow_up_id: null, parent_message_id: null, events: [], thread: [], gmail_url: null } as unknown as MessageDetail;

function view(emails: Record<string, MessageSummary>): JobView {
  return {
    opportunity: { id: JOB_ID, company: 'Northwind Labs', title: 'Software Engineer Intern - Backend', location: 'Bengaluru', employment_type: 'internship', deadline: null, job_url: null, description: 'x'.repeat(100) } as unknown as JobView['opportunity'],
    analysis: {
      company: 'Northwind Labs',
      title: 'Software Engineer Intern - Backend',
      location: 'Bengaluru',
      employment_type: 'internship',
      seniority: 'intern',
      experience: { min_years: 0, text: '0-1 years of experience', fresher_friendly: true },
      must_have: ['Node.js', 'Git'],
      nice_to_have: ['Redis'],
      responsibilities: [],
      priorities: [{ point: 'Reliable APIs for merchants', evidence: 'Build and maintain REST APIs that serve merchant dashboards' }],
      deadline: null,
      source: 'ai',
      model: 'gemini-3.8-flash',
      notes: [],
    },
    fit: { verdict: 'good', summary: 'You have 1 of 2 must-have skills.', matched_must: ['Node.js'], missing_must: ['Git'], matched_nice: [], skills_in_common: ['Node.js'], projects: [{ name: 'QueueLite', matched: ['Node.js'] }], warnings: [] },
    recruiters: [asha],
    emails,
  };
}

function setup() {
  let state: Record<string, MessageSummary> = {};
  const sendBodies: { key: string; body: Record<string, unknown> }[] = [];
  apiMock.mockImplementation(async (path: string, opts: { method?: string; body?: Record<string, unknown>; headers?: Record<string, string> } = {}) => {
    if (path === '/api/me') return me;
    if (path === '/api/resumes') return [{ id: 'r1', label: 'Backend', file_name: 'Sam_Kumar.pdf', size_bytes: 52_000, legacy: false, is_default: true }];
    if (path === `/api/jobs/${JOB_ID}`) return view(state);
    if (path === `/api/jobs/${JOB_ID}/suggested-recruiters`) return { recruiters: [] };
    if (path === `/api/jobs/${JOB_ID}/recruiters/${ASHA_ID}/email`) {
      state = { [ASHA_ID]: summary() };
      return { message: detail, draft: { subject: detail.subject, body_text: BODY, source: 'ai', provider: 'gemini', model: 'gemini-3.8-flash', facts_used: [], quality: [], notes: [] }, quality: [] } satisfies PreparedEmail;
    }
    if (path === `/api/messages/${MSG_ID}/send`) {
      sendBodies.push({ key: opts.headers!['Idempotency-Key']!, body: opts.body ?? {} });
      if (!opts.body?.confirm_duplicate) throw new ApiError(409, 'DUPLICATE_OUTREACH', 'You have already emailed asha.rao@northwind-mail.example (1 message).');
      state = { [ASHA_ID]: summary({ send_status: 'sent', sent_at: '2026-10-17T10:05:00Z', next_follow_up_at: '2026-10-24T03:30:00Z' }) };
      return { outcome: 'sent', message: { ...detail, send_status: 'sent' } };
    }
    if (path.startsWith('/api/messages/')) return detail;
    throw new Error(`unexpected call ${opts.method ?? 'GET'} ${path}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/jobs/${JOB_ID}`]}>
          <Routes>
            <Route path="/jobs/:id" element={<JobPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { sendBodies };
}

describe('job page', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('shows the reading with the JD’s own words, writes the email by itself and sends on one click', async () => {
    const { sendBodies } = setup();
    expect(await screen.findByText('Good fit')).toBeInTheDocument();
    expect(screen.getByText('Build and maintain REST APIs that serve merchant dashboards')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Not on your profile')).toHaveLength(2); // Git and Redis

    // The email is written without a click, and nothing is sent yet.
    const body = (await screen.findByLabelText('Email')) as HTMLTextAreaElement;
    expect(body.value).toBe(BODY);
    expect(apiMock.mock.calls.filter(([p]) => String(p).endsWith('/send'))).toHaveLength(0);
    expect(apiMock).toHaveBeenCalledWith(`/api/jobs/${JOB_ID}/recruiters/${ASHA_ID}/email`, { method: 'POST', body: { regenerate: false, use_template: false } });

    fireEvent.click(screen.getByRole('button', { name: 'Send cold email' }));
    // Already emailed before: the card asks once, inline, and nothing is sent until it's ticked.
    expect(await screen.findByText(/already emailed asha\.rao/)).toBeInTheDocument();
    const sendButton = screen.getByRole('button', { name: 'Send cold email' });
    expect(sendButton).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I know I already emailed this person/));
    fireEvent.click(sendButton);

    expect(await screen.findByText(/Follow-up reminder on/)).toBeInTheDocument();
    expect(sendBodies).toHaveLength(2);
    expect(sendBodies[0]!.body).toEqual({});
    expect(sendBodies[1]!.body).toEqual({ confirm_duplicate: true });
    expect(sendBodies[1]!.key).not.toBe(sendBodies[0]!.key); // a confirmed retry is a new attempt
  });

  it('saves edits before sending', async () => {
    setup();
    const body = (await screen.findByLabelText('Email')) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: `${BODY}\nP.S. I can start in January.` } });
    fireEvent.click(screen.getByRole('button', { name: 'Send cold email' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(`/api/messages/${MSG_ID}`, { method: 'PATCH', body: expect.objectContaining({ body_text: `${BODY}\nP.S. I can start in January.` }) }));
    const patchIndex = apiMock.mock.calls.findIndex(([p, o]) => p === `/api/messages/${MSG_ID}` && o?.method === 'PATCH');
    const sendIndex = apiMock.mock.calls.findIndex(([p]) => p === `/api/messages/${MSG_ID}/send`);
    expect(patchIndex).toBeGreaterThan(-1);
    expect(sendIndex).toBeGreaterThan(patchIndex);
  });
});
