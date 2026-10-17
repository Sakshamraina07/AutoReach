import { useEffect, useState } from 'react';
import { authCall } from '../lib/client';
import { dashboardLink } from '../lib/config';
import { PREFILL_KEY, type AuthState, type ComposePrefill } from '../lib/protocol';
import { Button, ErrorNote, Logo, Spinner } from '../ui/components';
import { Composer } from './Composer';

type StoredPrefill = ComposePrefill & { at: number };

/** Side panel: the composer, starting from whatever the popup or Gmail asked for. */
export function SidePanel() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [prefill, setPrefill] = useState<StoredPrefill | null>(null);

  useEffect(() => {
    authCall({ type: 'auth:get' }).then(setAuth, setError);
    const take = (v: unknown) => {
      const p = v as StoredPrefill | undefined;
      if (p?.at) {
        setPrefill(p);
        void chrome.storage.session.remove(PREFILL_KEY);
      }
    };
    void chrome.storage.session.get(PREFILL_KEY).then((v) => take((v as Record<string, unknown>)[PREFILL_KEY]));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && changes[PREFILL_KEY]?.newValue) take(changes[PREFILL_KEY].newValue);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  if (error) return <div className="p-4"><ErrorNote error={error} /></div>;
  if (!auth) return <div className="p-4"><Spinner label="Starting" /></div>;
  if (!auth.signedIn) {
    return (
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="font-semibold">AutoReach</span>
        </div>
        <p className="text-sm text-muted">Sign in from the AutoReach button in Chrome's toolbar, then reopen this panel.</p>
        <Button size="sm" onClick={() => authCall({ type: 'auth:get' }).then(setAuth, setError)}>
          I've signed in
        </Button>
      </div>
    );
  }
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Logo />
        <span className="flex-1 text-sm font-semibold">Write outreach</span>
        <a href={dashboardLink('/outreach')} target="_blank" rel="noreferrer" className="text-xs">
          Dashboard
        </a>
      </header>
      {/* A new prefill starts a fresh composer. */}
      <Composer key={prefill?.at ?? 'blank'} prefill={prefill ?? {}} />
    </div>
  );
}
