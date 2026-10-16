import type { GmailConnectionStatus } from '@autoreach/shared';
import { clsx } from 'clsx';
import { BarChart3, Bell, Briefcase, Inbox, LayoutGrid, LogOut, Menu, Moon, PauseCircle, PlayCircle, Plus, Send, Settings, Sun, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { setTimezone } from '../lib/format';
import { useFollowUps, useInvalidate, useMe } from '../lib/queries';
import { Button, useToast } from './ui';

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: '/', label: 'Overview', icon: <LayoutGrid className="h-4 w-4" />, end: true },
  { to: '/recruiters', label: 'Recruiters', icon: <Users className="h-4 w-4" /> },
  { to: '/opportunities', label: 'Opportunities', icon: <Briefcase className="h-4 w-4" /> },
  { to: '/outreach', label: 'Outreach', icon: <Send className="h-4 w-4" />, end: true },
  { to: '/followups', label: 'Follow-ups', icon: <Bell className="h-4 w-4" /> },
  { to: '/analytics', label: 'Analytics', icon: <BarChart3 className="h-4 w-4" /> },
  { to: '/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
];

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'dark');
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    if (next === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem('autoreach.theme', next);
    } catch {
      /* private mode */
    }
    setTheme(next);
  };
  return [theme, toggle];
}

export function Layout() {
  const me = useMe();
  const due = useFollowUps('due');
  const { email, signOut } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [pausing, setPausing] = useState(false);

  // Close the mobile menu after navigating (state adjusted during render, not in an effect).
  const [menuPath, setMenuPath] = useState(location.pathname);
  if (menuPath !== location.pathname) {
    setMenuPath(location.pathname);
    setOpen(false);
  }
  useEffect(() => setTimezone(me.data?.settings.timezone), [me.data?.settings.timezone]);
  useEffect(() => {
    if (me.data && !me.data.onboarding_completed && location.pathname !== '/onboarding' && !location.pathname.startsWith('/settings')) {
      navigate('/onboarding', { replace: true });
    }
  }, [me.data, location.pathname, navigate]);

  const paused = me.data?.settings.sending_paused ?? false;
  const gmail = me.data?.gmail;
  const dueCount = due.data?.total ?? 0;

  async function togglePause() {
    setPausing(true);
    try {
      await api('/api/settings', { method: 'PATCH', body: { sending_paused: !paused } });
      await invalidate();
      toast.success(paused ? 'Sending resumed' : 'Sending paused — nothing will be sent until you resume');
    } catch (e) {
      toast.error(e);
    } finally {
      setPausing(false);
    }
  }

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col gap-1 px-3 py-4">
      <Link to="/" className="mb-4 flex items-center gap-2 px-2 text-ink no-underline hover:no-underline">
        <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
          <path d="M5 9.5h22v13H5z" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="m5.5 10 10.5 7.5L26.5 10" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="26" cy="22" r="4" fill="rgb(var(--replied))" />
        </svg>
        <span className="text-lg font-semibold tracking-tight">AutoReach</span>
      </Link>
      <Button variant="primary" className="mb-3 w-full" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/outreach/new')}>
        New outreach
      </Button>
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-2.5 rounded px-2 py-1.5 text-sm no-underline hover:no-underline',
              isActive ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink',
            )
          }
        >
          {n.icon}
          <span className="flex-1">{n.label}</span>
          {n.to === '/followups' && dueCount > 0 && <span className="num rounded bg-warn/15 px-1.5 text-2xs font-semibold text-warn">{dueCount}</span>}
        </NavLink>
      ))}
      <div className="mt-auto space-y-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={togglePause}
          disabled={pausing || !me.data}
          className={clsx(
            'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
            paused ? 'bg-warn/10 text-warn' : 'text-muted hover:bg-raised hover:text-ink',
          )}
          aria-pressed={paused}
        >
          {paused ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
          {paused ? 'Sending paused. Resume' : 'Pause all sending'}
        </button>
        <div className="flex items-center gap-1 px-2">
          <span className="min-w-0 flex-1 truncate text-xs text-faint" title={email ?? ''}>
            {email}
          </span>
          <button type="button" onClick={toggleTheme} className="rounded p-1 text-muted hover:bg-raised hover:text-ink" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => void signOut()} className="rounded p-1 text-muted hover:bg-raised hover:text-ink" aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-56 shrink-0 border-r border-line bg-surface lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 flex bg-black/50 lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <aside className="w-64 border-r border-line bg-surface">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-2 border-b border-line px-4 lg:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation" className="rounded p-1.5 text-muted hover:bg-raised">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold">AutoReach</span>
        </header>
        <Banners paused={paused} gmail={gmail} onResume={togglePause} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function Banners({ paused, gmail, onResume }: { paused: boolean; gmail: GmailConnectionStatus | undefined; onResume: () => void }) {
  const items: ReactNode[] = [];
  if (gmail?.status === 'needs_reauth') {
    items.push(
      <div key="reauth" className="flex flex-wrap items-center gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-ink">
        <Inbox className="h-4 w-4 text-danger" />
        Gmail access expired or was revoked. Emails can't be sent until you reconnect.
        <Link to="/settings?section=gmail" className="font-medium">
          Reconnect Gmail
        </Link>
      </div>,
    );
  } else if (gmail && gmail.configured && !gmail.connected) {
    items.push(
      <div key="connect" className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-4 py-2 text-sm text-muted">
        <Inbox className="h-4 w-4" />
        Connect Gmail to send outreach from your own address.
        <Link to="/settings?section=gmail" className="font-medium">
          Connect Gmail
        </Link>
      </div>,
    );
  }
  if (paused) {
    items.push(
      <div key="paused" className="flex flex-wrap items-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm text-ink">
        <PauseCircle className="h-4 w-4 text-warn" />
        Sending is paused. Queued and scheduled emails wait until you resume.
        <button type="button" onClick={onResume} className="font-medium text-accent hover:underline">
          Resume sending
        </button>
      </div>,
    );
  }
  return <>{items}</>;
}
