import type { ApiErrorShape, ApiRequest, ApiResult } from '../lib/protocol';

export interface GmailConnectDeps {
  api: <T>(req: ApiRequest) => Promise<ApiResult<T>>;
  /** chrome.identity.getRedirectURL('gmail') */
  redirectUrl: string;
  /** chrome.identity.launchWebAuthFlow */
  launch: (url: string) => Promise<string | undefined>;
}

export type GmailConnectResult = { ok: true; email: string } | { ok: false; error: ApiErrorShape };

const fail = (code: string, message: string): GmailConnectResult => ({ ok: false, error: { status: 0, code, message } });

/**
 * Connect Gmail from the extension. Google's consent page opens in a chrome.identity
 * window; the API's callback hands the code back to this extension's chromiumapp.org
 * redirect, and the service worker completes the connection as the signed-in user.
 */
export async function connectGmail(deps: GmailConnectDeps): Promise<GmailConnectResult> {
  const started = await deps.api<{ url: string }>({ method: 'POST', path: '/api/integrations/gmail/authorize', body: { return_to: 'extension', extension_redirect: deps.redirectUrl } });
  if (!started.ok) return started;
  const expectedState = new URL(started.data.url).searchParams.get('state');

  let responseUrl: string | undefined;
  try {
    responseUrl = await deps.launch(started.data.url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return /did not approve|closed|cancel/i.test(msg) ? fail('GMAIL_CONNECT_CANCELLED', 'Gmail was not connected: the Google window was closed.') : fail('GMAIL_CONNECT_FAILED', `Gmail connection failed: ${msg}`);
  }
  if (!responseUrl) return fail('GMAIL_CONNECT_CANCELLED', 'Gmail was not connected: the Google window was closed.');

  const back = new URL(responseUrl);
  if (!responseUrl.startsWith(deps.redirectUrl)) return fail('GMAIL_CONNECT_FAILED', 'Gmail connection returned to an unexpected address.');
  const state = back.searchParams.get('state');
  if (!state || state !== expectedState) return fail('GMAIL_CONNECT_FAILED', 'Gmail connection did not match the one started here. Try again.');
  const error = back.searchParams.get('gmail_error');
  if (error === 'access_denied') return fail('GMAIL_CONNECT_DECLINED', 'Gmail was not connected because access was declined on Google’s screen.');
  const code = back.searchParams.get('gmail_code');
  if (error || !code) return fail('GMAIL_CONNECT_FAILED', 'Google didn’t return a connection code. Try again.');

  const done = await deps.api<{ email: string }>({ method: 'POST', path: '/api/integrations/gmail/complete', body: { code, state } });
  return done.ok ? { ok: true, email: done.data.email } : done;
}
