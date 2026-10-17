import type { GmailConnectionStatus, MeResponse } from '@autoreach/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { cleanProfile, profileToForm } from '../components/ProfileEditor';
import { StatusTrack } from '../components/StatusTrack';
import { ToastProvider } from '../components/ui';
import { gmailProblem } from '../lib/gmail';
import SettingsPage from '../pages/Settings';

const gmail = (over: Partial<GmailConnectionStatus> = {}): GmailConnectionStatus => ({
  configured: true,
  connected: true,
  account_email: 'student@example.dev',
  status: 'active',
  can_send: true,
  can_detect_replies: true,
  reply_detection_enabled: true,
  scopes: [],
  last_sync_at: null,
  sync_error: null,
  ...over,
});

describe('StatusTrack', () => {
  const base = { send_status: 'sent' as const, reply_status: 'none' as const, tracking_enabled: true, first_open_at: null, scheduled_for: null };

  it('keeps sent, open and reply as separate facts in its accessible summary', () => {
    render(<StatusTrack m={base} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toMatch(/Send: sent\. Open: .*\. Reply: none detected/);
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  it('labels opens as approximate and never as read', () => {
    render(<StatusTrack m={{ ...base, first_open_at: '2026-10-10T10:00:00Z' }} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('(approximate)');
    expect(screen.queryByText(/read/i)).toBeNull();
    expect(screen.getByText('Open detected')).toBeInTheDocument();
  });

  it('shows an unknown send outcome distinctly from a failure', () => {
    const { rerender } = render(<StatusTrack m={{ ...base, send_status: 'unknown' }} />);
    const unknownLabel = screen.getByRole('img').getAttribute('aria-label');
    rerender(<StatusTrack m={{ ...base, send_status: 'failed' }} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toBe(unknownLabel);
  });
});

describe('gmailProblem', () => {
  it('allows sending only with a healthy connection that can send', () => {
    expect(gmailProblem(gmail())).toBeNull();
    expect(gmailProblem(gmail({ configured: false }))?.action).toBeNull();
    expect(gmailProblem(gmail({ connected: false }))?.action).toBe('Connect Gmail');
    expect(gmailProblem(gmail({ status: 'needs_reauth' }))?.action).toBe('Reconnect Gmail');
    expect(gmailProblem(gmail({ can_send: false }))?.message).toMatch(/permission to send/);
  });
});

describe('profile form', () => {
  it('turns blank optional fields into nulls and drops empty rows before saving', () => {
    const f = profileToForm(null, 'me@example.dev');
    f.full_name = '  Sam  ';
    f.phone = '   ';
    f.links = { github: '', linkedin: 'https://linkedin.com/in/sam', portfolio: null, other: [] };
    f.projects = [
      { id: 'a', name: '', description: 'x', technologies: [], achievements: [], url: '' },
      { id: 'b', name: 'Tracker', description: 'd', technologies: ['React'], achievements: [], url: '' },
    ];
    f.experience = [{ id: 'e', organization: 'Org', title: 'Intern', start: '2026-01', end: '2026-03', current: true, description: '', achievements: [], technologies: [] }];
    const out = cleanProfile(f);
    expect(out.phone).toBeNull();
    expect(out.primary_email).toBe('me@example.dev');
    expect(out.links.github).toBeNull();
    expect(out.projects).toHaveLength(1);
    expect(out.projects[0]!.url).toBeNull();
    expect(out.experience[0]!.end).toBeNull(); // current role has no end date
  });
});

function me(over: Partial<MeResponse> = {}): MeResponse {
  return {
    user: { id: 'u1', email: 'student@example.dev' },
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
      default_resume_id: null,
      attachment_filename: null,
      updated_at: '2026-10-01T00:00:00Z',
    },
    gmail: gmail(),
    ai: { configured: false, provider: null, model: null },
    tracking: { configured: false, public_base_url: null },
    career_ops: { configured: false },
    hunter: { configured: false },
    completeness: { percent: 50, items: [] },
    onboarding_completed: true,
    sent_today: 0,
    ...over,
  };
}

function withProviders(ui: ReactNode, data: MeResponse, path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['me'], data);
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Settings', () => {
  it('keeps open tracking off and explains why when the server cannot host the pixel', () => {
    withProviders(<SettingsPage />, me(), '/settings?section=tracking');
    const toggle = screen.getByRole('switch', { name: 'Track opens on new emails' });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/isn't available on this server/)).toBeInTheDocument();
  });

  it('only enables saving after a change and rejects an impossible spacing range', () => {
    withProviders(<SettingsPage />, me(), '/settings?section=sending');
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Gap between queued emails'), { target: { value: '300' } });
    expect(screen.getByText('The minimum gap must not be longer than the maximum.')).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Gap between queued emails'), { target: { value: '60' } });
    expect(save).toBeEnabled();
  });

  it('describes Gmail access as headers-only and offers reconnecting when access expired', () => {
    withProviders(<SettingsPage />, me({ gmail: gmail({ status: 'needs_reauth', can_send: false }) }), '/settings?section=gmail');
    expect(screen.getByText(/Read message headers, not bodies/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect Gmail' })).toBeInTheDocument();
  });
});
