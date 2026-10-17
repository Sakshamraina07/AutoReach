import type { AnalyticsOverview, MeResponse } from '@autoreach/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checklistItems } from '../components/GettingStarted';
import { ToastProvider } from '../components/ui';
import type * as ApiModule from '../lib/api';
import { TRACKING_OFF_NOTE } from '../lib/tracking';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof ApiModule>()), api: apiMock }));
const { default: Overview } = await import('../pages/Overview');
const { default: Analytics } = await import('../pages/Analytics');
const { default: Outreach } = await import('../pages/Outreach');

const kpi = (value: number) => ({ value, previous: null });
const overview: AnalyticsOverview = {
  range: '30d',
  kpis: {
    total_recruiters: kpi(3),
    emails_attempted: kpi(0),
    emails_sent: kpi(0),
    replies: kpi(0),
    followups_due: kpi(0),
    active_opportunities: kpi(2),
    response_rate: { value: null, previous: null, sample: 0 },
    opens_detected: kpi(7),
  },
};

function me(over: Partial<MeResponse> = {}): MeResponse {
  return {
    user: { id: 'u1', email: 'student@example.dev' },
    profile: { full_name: 'Asha' } as unknown as MeResponse['profile'],
    settings: {} as MeResponse['settings'],
    gmail: { configured: true, connected: false, account_email: null, status: null, can_send: false, can_detect_replies: false, reply_detection_enabled: true } as MeResponse['gmail'],
    ai: { configured: true, provider: 'gemini', model: 'gemini-2.5-flash' },
    tracking: { configured: false, public_base_url: null },
    hunter: { configured: false },
    career_ops: { configured: false },
    completeness: {
      percent: 40,
      items: [
        { key: 'full_name', label: 'Full name', done: true },
        { key: 'education', label: 'Degree and college', done: true },
        { key: 'target_roles', label: 'Target roles', done: true },
        { key: 'skills', label: 'At least 5 skills', done: false },
        { key: 'gmail', label: 'Gmail connected', done: false },
      ],
    },
    onboarding_completed: true,
    sent_today: 0,
    ...over,
  };
}

const empty = { items: [], total: 0, page: 1, page_size: 25 };

/** Answers every call the three pages make; `sent` and `jobs` set the totals the checklist looks at. */
function mockApi(opts: { me: MeResponse; sent?: number; jobs?: number }) {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/me') return opts.me;
    if (path.startsWith('/api/analytics/overview')) return overview;
    if (path.startsWith('/api/analytics/timeseries')) return [];
    if (path.startsWith('/api/analytics/breakdown')) return { by: 'role_category', small_sample_threshold: 10, rows: [] };
    if (path.startsWith('/api/analytics/insights')) return [];
    if (path === '/api/analytics/recommendations') return [];
    if (path.startsWith('/api/messages') && path.includes('send_status=sent')) return { ...empty, total: opts.sent ?? 0 };
    if (path.startsWith('/api/messages')) return empty;
    if (path.startsWith('/api/opportunities')) return { ...empty, total: opts.jobs ?? 0 };
    if (path.startsWith('/api/followups')) return empty;
    if (path.startsWith('/api/activity')) return empty;
    if (path === '/api/review-queue') return [];
    throw new Error(`unexpected ${path}`);
  });
}

function Where() {
  const l = useLocation();
  return <p>at {l.pathname + l.search}</p>;
}

function setup(path = '/') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/outreach" element={<Outreach />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
});

describe('overview wording', () => {
  it('calls saved postings "Jobs" everywhere but keeps the /opportunities links', async () => {
    mockApi({ me: me() });
    setup();
    expect(await screen.findByText('Active jobs')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Active jobs 2 not closed' })).toHaveAttribute('href', '/opportunities');
    const header = screen.getByRole('heading', { name: 'Where to focus next' }).parentElement!;
    expect(header.querySelector('a')).toHaveTextContent('Jobs');
    expect(header.querySelector('a')).toHaveAttribute('href', '/opportunities');
    expect(await screen.findByText(/Save job postings in/)).toBeInTheDocument();
    expect(screen.queryByText(/Opportunit/)).toBeNull();
  });
});

describe('overview empty state', () => {
  it('sends people to the job flow first and keeps the single-email composer as a small link', async () => {
    mockApi({ me: me() });
    setup();
    expect(await screen.findByText('No outreach yet')).toBeInTheDocument();
    expect(screen.getByText(/Paste a job posting or open one from career-ops/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Write a single email' })).toHaveAttribute('href', '/outreach/new');
    fireEvent.click(screen.getByRole('button', { name: 'New job' }));
    expect(await screen.findByText('at /jobs/new')).toBeInTheDocument();
  });
});

describe('open counts when tracking is not configured', () => {
  it('shows nothing about opens on the overview', async () => {
    mockApi({ me: me() });
    setup();
    await screen.findByText('Active jobs');
    await screen.findByText(/Response rate/);
    expect(screen.queryByText(/Opens detected/)).toBeNull();
    expect(screen.queryByText(/Opens are approximate/)).toBeNull();
  });

  it('still shows the approximate count when tracking is configured', async () => {
    mockApi({ me: me({ tracking: { configured: true, public_base_url: 'https://autoreach.example' } }) });
    setup();
    expect(await screen.findByText(/Opens detected:/)).toBeInTheDocument();
    expect(screen.getByText(/Opens are approximate/)).toBeInTheDocument();
  });

  it('explains it on Analytics instead of showing a number', async () => {
    mockApi({ me: me() });
    setup('/analytics');
    expect(await screen.findByText(TRACKING_OFF_NOTE)).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByText('approximate')).toBeNull();
  });

  it('explains it on Outreach', async () => {
    mockApi({ me: me() });
    setup('/outreach');
    expect(await screen.findByText(new RegExp(TRACKING_OFF_NOTE.replace(/[.;]/g, '\\$&')))).toBeInTheDocument();
    expect(screen.queryByText(/opens are approximate/)).toBeNull();
  });
});

describe('getting-started checklist', () => {
  it('derives each step only from /api/me and whether a job exists', () => {
    const items = checklistItems(me(), false);
    expect(items.map((i) => [i.key, i.done, i.to])).toEqual([
      ['profile', false, '/settings?section=profile'],
      ['gmail', false, '/settings?section=gmail'],
      ['job', false, '/jobs/new'],
      ['email', false, '/jobs/new'],
    ]);
    const done = checklistItems(
      me({
        gmail: { ...me().gmail, connected: true },
        career_ops: { configured: true },
        completeness: { percent: 90, items: me().completeness.items.map((i) => ({ ...i, done: true })) },
      }),
      true,
    );
    expect(done.map((i) => [i.key, i.done, i.to])).toEqual([
      ['profile', true, '/settings?section=profile'],
      ['gmail', true, '/settings?section=gmail'],
      ['job', true, '/career-ops'],
      ['email', false, '/opportunities'],
    ]);
    expect(checklistItems(me({ onboarding_completed: false }), false)[0]?.to).toBe('/onboarding');
  });

  it('shows on the overview until the first email is sent', async () => {
    mockApi({ me: me(), jobs: 1 });
    setup();
    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeInTheDocument();
    expect(screen.getByText('3 of 4 to go')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add your first job' })).toHaveAttribute('href', '/jobs/new');
    expect(screen.getByRole('link', { name: 'Connect Gmail' })).toHaveAttribute('href', '/settings?section=gmail');
    expect(screen.getAllByText('Done')).toHaveLength(1);
    expect(screen.getAllByText('Not done')).toHaveLength(3);
  });

  it('is hidden once an email has been sent', async () => {
    mockApi({ me: me(), sent: 1, jobs: 1 });
    setup();
    await screen.findByText('Active jobs');
    await screen.findByText(/Response rate/);
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull();
  });
});
