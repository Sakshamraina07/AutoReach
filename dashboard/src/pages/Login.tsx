import { useState } from 'react';
import { Button, ErrorState } from '../components/ui';
import { useAuth } from '../lib/auth';
import { config, supabaseConfigured } from '../lib/config';

export function Login() {
  const { signInWithGoogle, devSignIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [devEmail, setDevEmail] = useState('');

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
            <path d="M5 9.5h22v13H5z" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.2" strokeLinejoin="round" />
            <path d="m5.5 10 10.5 7.5L26.5 10" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.2" strokeLinejoin="round" />
            <circle cx="26" cy="22" r="4" fill="rgb(var(--replied))" />
          </svg>
          <span className="text-xl font-semibold">AutoReach</span>
        </div>
        <h1 className="text-2xl">Sign in to your outreach workspace</h1>
        <p className="mt-2 text-sm text-muted">Track recruiters, write role-specific emails, send them from your Gmail and know when to follow up.</p>
        <div className="mt-6 space-y-3">
          {supabaseConfigured ? (
            <Button
              variant="primary"
              className="h-10 w-full"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await signInWithGoogle();
                } catch (e) {
                  setError(e);
                  setBusy(false);
                }
              }}
            >
              Continue with Google
            </Button>
          ) : (
            <p className="rounded border border-warn/40 bg-warn/10 p-3 text-sm">
              This build has no Supabase settings. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see docs/SETUP.md).
            </p>
          )}
          {config.devLogin && (
            <form
              className="space-y-2 rounded border border-line p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  await devSignIn(devEmail);
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
              <input id="dev-email" type="email" required className="field" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} placeholder="you@example.dev" />
              <Button type="submit" className="w-full" loading={busy}>
                Sign in locally
              </Button>
              <p className="text-2xs text-faint">Only works against a local API with ENABLE_DEV_LOGIN. Never available in production.</p>
            </form>
          )}
          {error ? <ErrorState error={error} /> : null}
        </div>
        <p className="mt-8 text-xs text-faint">
          AutoReach sends email only when you approve it, from your own Gmail account. <a href="https://auto-reach-ext.vercel.app/privacy">Privacy policy</a>
        </p>
      </div>
    </div>
  );
}
