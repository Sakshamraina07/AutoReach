import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ErrorState, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { startGmailConnect } from '../lib/gmail';

type ReturnTo = 'dashboard' | 'onboarding';

/** Read once: the parameters are removed from the address bar straight away. */
function readParams() {
  const p = new URLSearchParams(window.location.search);
  const returnTo: ReturnTo = p.get('return_to') === 'onboarding' ? 'onboarding' : 'dashboard';
  return { code: p.get('gmail_code'), state: p.get('state'), error: p.get('gmail_error'), returnTo };
}

function destination(returnTo: ReturnTo, connected: boolean): string {
  const base = returnTo === 'onboarding' ? '/onboarding' : '/settings?section=gmail';
  if (!connected) return base;
  return `${base}${base.includes('?') ? '&' : '?'}gmail=connected`;
}

/**
 * Google sends the user back to the API, which hands the authorization code to this page.
 * The page finishes the connection as the signed-in user, so a consent link that was
 * forwarded to someone else can't attach their mailbox to this account.
 */
export default function GmailCallback() {
  const navigate = useNavigate();
  const [params] = useState(readParams);
  const [failure, setFailure] = useState<unknown>(() => {
    if (params.error === 'access_denied') return new Error('Gmail was not connected because access was declined on Google’s screen.');
    if (params.error || !params.code || !params.state) return new Error('Google didn’t return a connection code. Start the connection again.');
    return null;
  });
  const started = useRef(false);

  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  useEffect(() => {
    if (started.current || failure || !params.code || !params.state) return;
    started.current = true;
    api<{ email: string; return_to: string }>('/api/integrations/gmail/complete', { method: 'POST', body: { code: params.code, state: params.state } })
      .then((r) => navigate(destination(r.return_to === 'onboarding' ? 'onboarding' : 'dashboard', true), { replace: true }))
      .catch((e: unknown) => setFailure(e));
  }, [failure, params, navigate]);

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-xl">{failure ? 'Gmail was not connected' : 'Connecting Gmail'}</h1>
        {failure ? (
          <>
            <ErrorState error={failure} />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  startGmailConnect(params.returnTo).catch((e: unknown) => setFailure(e));
                }}
              >
                Try again
              </Button>
              <Button onClick={() => navigate(destination(params.returnTo, false), { replace: true })}>
                {params.returnTo === 'onboarding' ? 'Back to setup' : 'Back to settings'}
              </Button>
            </div>
          </>
        ) : (
          <Spinner label="Finishing the connection" />
        )}
      </div>
    </div>
  );
}
