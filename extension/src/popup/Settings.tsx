import { ArrowLeft, ExternalLink, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { authCall } from '../lib/client';
import { config, dashboardLink } from '../lib/config';
import { GMAIL_ASSIST_KEY, type AuthState } from '../lib/protocol';
import { Button } from '../ui/components';

export function SettingsView({ auth, onDone, onSignedOut }: { auth: AuthState; onDone: () => void; onSignedOut: (a: AuthState) => void }) {
  const [assist, setAssist] = useState<boolean | null>(null);
  useEffect(() => {
    void chrome.storage.sync.get(GMAIL_ASSIST_KEY).then((v) => setAssist((v as Record<string, boolean | undefined>)[GMAIL_ASSIST_KEY] !== false));
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" aria-label="Back" onClick={onDone} className="rounded p-1 text-muted hover:bg-raised hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-sm font-semibold">Extension settings</h1>
      </header>
      <div className="space-y-4 p-3 text-xs">
        <div className="flex items-start justify-between gap-4">
          <div>
            <label htmlFor="assist" className="text-sm font-medium text-ink">
              Gmail assist
            </label>
            <p className="mt-0.5 text-muted">
              Shows whether you've contacted the people you're writing to. It sends only the addresses shown in Gmail's recipient chips and conversation headers to your AutoReach account. It never reads message bodies or changes Gmail's buttons.
            </p>
          </div>
          <button
            id="assist"
            role="switch"
            type="button"
            aria-checked={!!assist}
            disabled={assist === null}
            onClick={() => {
              const next = !assist;
              setAssist(next);
              void chrome.storage.sync.set({ [GMAIL_ASSIST_KEY]: next });
            }}
            className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${assist ? 'border-accent bg-accent' : 'border-line bg-raised'}`}
          >
            <span className={`absolute left-0 top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform ${assist ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <div className="space-y-1 border-t border-line pt-3 text-muted">
          <p>
            Signed in as <span className="text-ink">{auth.email}</span>
            {auth.mode === 'dev' ? ' (local development sign-in)' : ''}.
          </p>
          <p>API: {config.apiUrl}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => void chrome.tabs.create({ url: dashboardLink('/settings') })}>
            Account settings
          </Button>
          <Button size="sm" variant="ghost" icon={<LogOut className="h-3.5 w-3.5" />} onClick={async () => onSignedOut(await authCall({ type: 'auth:signOut' }))}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
