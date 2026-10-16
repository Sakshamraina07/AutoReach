import type { FollowUp, MeResponse, MessageSummary, Paginated } from '@autoreach/shared';
import { Bell, ExternalLink, FilePlus2, LogOut, PauseCircle, PenSquare, PlayCircle, Settings2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, authCall, ExtensionApiError } from '../lib/client';
import { config, dashboardLink, supabaseConfigured } from '../lib/config';
import { useLoad } from '../lib/hooks';
import type { AuthState } from '../lib/protocol';
import { Button, ErrorNote, Logo, Spinner, StatusLabel } from '../ui/components';
import { AddRecruiterView } from './AddRecruiter';
import { CaptureView } from './Capture';
import { openComposer } from './compose';
import { SettingsView } from './Settings';

type View = 'home' | 'capture' | 'recruiter' | 'settings';

export function Popup() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authError, setAuthError] = useState<unknown>(null);
  const [view, setView] = useState<View>('home');

  useEffect(() => {
    authCall({ type: 'auth:get' }).then(setAuth, setAuthError);
  }, []);

  return (
    <div className="flex min-h-[420px] w-[380px] flex-col">
      {!auth && !authError && <Spinner label="Starting" />}
      {authError ? (
        <div className="p-4">
          <ErrorNote error={authError} />
        </div>
      ) : null}
      {auth && !auth.signedIn && <SignIn onSignedIn={setAuth} />}
      {auth?.signedIn && view === 'home' && <Home auth={auth} onView={setView} onSignedOut={setAuth} />}
      {auth?.signedIn && view === 'capture' && <CaptureView onDone={() => setView('home')} />}
      {auth?.signedIn && view === 'recruiter' && <AddRecruiterView onDone={() => setView('home')} />}
      {auth?.signedIn && view === 'settings' && <SettingsView auth={auth} onDone={() => setView('home')} onSignedOut={setAuth} />}
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (a: AuthState) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [email, setEmail] = useState('');
  return (
    <div className="flex flex-1 flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-base font-semibold">AutoReach</span>
      </div>
      <div>
        <h1 className="text-lg font-semibold">Sign in to your outreach workspace</h1>
        <p className="mt-1 text-xs text-muted">Use the same Google account as the AutoReach dashboard. Your recruiters, drafts and follow-ups appear here and in Gmail.</p>
      </div>
      {supabaseConfigured ? (
        <Button
          variant="primary"
          className="h-9"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              onSignedIn(await authCall({ type: 'auth:signIn' }));
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Continue with Google
        </Button>
      ) : (
        <p className="rounded border border-warn/40 bg-warn/10 p-2.5 text-xs">This build has no Supabase settings. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and rebuild (docs/EXTENSION.md).</p>
      )}
      {config.devLogin && (
        <form
          className="space-y-2 rounded border border-line p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              onSignedIn(await authCall({ type: 'auth:devSignIn', email }));
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="label" htmlFor="dev-email">
            Local development sign-in
          </label>
          <input id="dev-email" type="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.dev" />
          <Button type="submit" className="w-full" loading={busy}>
            Sign in locally
          </Button>
        </form>
      )}
      {error ? <ErrorNote error={error} /> : null}
    </div>
  );
}

function Home({ auth, onView, onSignedOut }: { auth: AuthState; onView: (v: View) => void; onSignedOut: (a: AuthState) => void }) {
  const me = useLoad(() => api<MeResponse>('/api/me'));
  const due = useLoad(() => api<Paginated<FollowUp>>('/api/followups?view=due&page_size=3'));
  const recent = useLoad(() => api<Paginated<MessageSummary>>('/api/messages?page_size=5'));
  const [pausing, setPausing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const s = me.data?.settings;
  const g = me.data?.gmail;

  // An expired session that couldn't be refreshed: go back to the sign-in screen.
  useEffect(() => {
    if (me.error instanceof ExtensionApiError && ['SESSION_EXPIRED', 'SIGNED_OUT'].includes(me.error.code)) {
      void authCall({ type: 'auth:signOut' }).then(onSignedOut);
    }
  }, [me.error, onSignedOut]);

  async function togglePause() {
    if (!s) return;
    setPausing(true);
    setActionError(null);
    try {
      await api('/api/settings', { method: 'PATCH', body: { sending_paused: !s.sending_paused } });
      await me.reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setPausing(false);
    }
  }

  async function connectGmail() {
    setConnecting(true);
    setActionError(null);
    try {
      const { url } = await api<{ url: string }>('/api/integrations/gmail/authorize', { method: 'POST', body: { return_to: 'extension' } });
      await chrome.tabs.create({ url });
    } catch (e) {
      setActionError(e);
    } finally {
      setConnecting(false);
    }
  }

  if (me.error) {
    return (
      <div className="space-y-3 p-4">
        <ErrorNote error={me.error} onRetry={() => void me.reload()} />
        <Button
          size="sm"
          variant="ghost"
          icon={<LogOut className="h-3.5 w-3.5" />}
          onClick={async () => onSignedOut(await authCall({ type: 'auth:signOut' }))}
        >
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Logo />
        <span className="flex-1 truncate text-sm font-semibold" title={auth.email ?? ''}>
          AutoReach
          <span className="ml-2 text-2xs font-normal text-faint">{auth.email}</span>
        </span>
        <button type="button" aria-label="Settings" onClick={() => onView('settings')} className="rounded p-1 text-muted hover:bg-raised hover:text-ink">
          <Settings2 className="h-4 w-4" />
        </button>
      </header>

      {!me.data ? (
        <div className="px-3">
          <Spinner />
        </div>
      ) : (
        <>
          {g && g.configured && (!g.connected || g.status === 'needs_reauth') && (
            <div className="flex items-center gap-2 border-b border-line bg-raised px-3 py-2 text-xs">
              <span className="flex-1">{g.status === 'needs_reauth' ? 'Gmail access expired. Reconnect to send.' : 'Connect Gmail to send from your own address.'}</span>
              <Button size="sm" variant="primary" loading={connecting} onClick={connectGmail}>
                {g.status === 'needs_reauth' ? 'Reconnect' : 'Connect'}
              </Button>
            </div>
          )}
          {s?.sending_paused && (
            <div className="flex items-center gap-2 border-b border-warn/40 bg-warn/10 px-3 py-2 text-xs">
              <span className="flex-1">Sending is paused. Queued emails wait until you resume.</span>
              <Button size="sm" loading={pausing} onClick={togglePause}>
                Resume
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-px border-b border-line bg-line">
            <div className="bg-surface px-3 py-2">
              <div className="text-2xs text-muted">Sent today</div>
              <div className="num text-lg font-semibold">
                {me.data.sent_today}
                <span className="text-xs font-normal text-faint"> of {s?.daily_send_limit}</span>
              </div>
            </div>
            <div className="bg-surface px-3 py-2">
              <div className="text-2xs text-muted">Follow-ups due</div>
              <div className={`num text-lg font-semibold ${due.data?.total ? 'text-warn' : ''}`}>{due.data?.total ?? '–'}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 p-3">
            <Button variant="primary" icon={<PenSquare className="h-4 w-4" />} onClick={() => openComposer()}>
              Write email
            </Button>
            <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => onView('capture')} title="Filled from the page you're on when it publishes job details">
              Add opportunity
            </Button>
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => onView('recruiter')}>
              Add recruiter
            </Button>
            <Button icon={<ExternalLink className="h-4 w-4" />} onClick={() => void chrome.tabs.create({ url: dashboardLink('/') })}>
              Dashboard
            </Button>
          </div>
          {actionError ? (
            <div className="px-3 pb-2">
              <ErrorNote error={actionError} />
            </div>
          ) : null}

          <section className="border-t border-line">
            <h2 className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-xs font-semibold">
              <Bell className="h-3.5 w-3.5 text-warn" aria-hidden /> Follow-ups due
            </h2>
            {due.error ? (
              <div className="px-3 pb-2">
                <ErrorNote error={due.error} onRetry={() => void due.reload()} />
              </div>
            ) : !due.data ? (
              <div className="px-3">
                <Spinner />
              </div>
            ) : due.data.items.length === 0 ? (
              <p className="px-3 pb-3 text-xs text-muted">Nothing due. Reminders appear here a few business days after each email.</p>
            ) : (
              <ul>
                {due.data.items.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 px-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{f.recruiter_name ?? f.recruiter_email}</div>
                      <div className="truncate text-2xs text-muted">
                        {f.company ? `${f.company}, ` : ''}follow-up {f.step}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => openComposer(f.draft_message_id ? { draftId: f.draft_message_id } : { followUpId: f.id })}>
                      {f.draft_message_id ? 'Open draft' : 'Draft'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border-t border-line">
            <h2 className="px-3 pb-1 pt-2.5 text-xs font-semibold">Recent outreach</h2>
            {recent.error ? (
              <div className="px-3 pb-2">
                <ErrorNote error={recent.error} onRetry={() => void recent.reload()} />
              </div>
            ) : !recent.data ? (
              <div className="px-3">
                <Spinner />
              </div>
            ) : recent.data.items.length === 0 ? (
              <p className="px-3 pb-3 text-xs text-muted">No emails yet.</p>
            ) : (
              <ul className="pb-1">
                {recent.data.items.map((m) => (
                  <li key={m.id}>
                    <a
                      href={dashboardLink(['draft', 'failed'].includes(m.send_status) ? `/outreach/new?draft=${m.id}` : `/outreach/${m.id}`)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 px-3 py-1.5 text-ink hover:bg-raised hover:no-underline"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{m.recruiter_name ?? m.recipient_email}</span>
                        <span className="block truncate text-2xs text-muted">{m.subject || '(no subject)'}</span>
                      </span>
                      <StatusLabel m={m} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <footer className="mt-auto border-t border-line p-2">
            <button
              type="button"
              onClick={togglePause}
              disabled={pausing}
              aria-pressed={!!s?.sending_paused}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${s?.sending_paused ? 'text-warn' : 'text-muted hover:bg-raised hover:text-ink'}`}
            >
              {s?.sending_paused ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
              {s?.sending_paused ? 'Sending paused. Resume' : 'Pause all sending'}
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
