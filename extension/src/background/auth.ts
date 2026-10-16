import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, supabaseConfigured } from '../lib/config';
import type { AuthState } from '../lib/protocol';
import { sessionStorageArea } from './secureStore';

/** Storage adapter so the session survives service-worker restarts (see secureStore.ts). */
const chromeStorage = {
  getItem: async (key: string) => ((await (await sessionStorageArea()).get(key)) as Record<string, string | undefined>)[key] ?? null,
  setItem: async (key: string, value: string) => (await sessionStorageArea()).set({ [key]: value }),
  removeItem: async (key: string) => (await sessionStorageArea()).remove(key),
};

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  client ??= createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      // A service worker is suspended between events, so timers are unreliable;
      // getSession() refreshes an expired token on demand instead.
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: chromeStorage,
      storageKey: 'autoreach.supabase',
    },
  });
  return client;
}

const DEV_KEY = 'autoreach.devSession';
interface DevSession {
  token: string;
  email: string;
  expiresAt: number;
}

async function devSession(): Promise<DevSession | null> {
  if (!config.devLogin) return null;
  const s = ((await (await sessionStorageArea()).get(DEV_KEY)) as Record<string, DevSession | undefined>)[DEV_KEY];
  return s && s.expiresAt > Date.now() + 30_000 ? s : null;
}

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function getToken(): Promise<string | null> {
  const dev = await devSession();
  if (dev) return dev.token;
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Force a refresh after the API rejected the token. Returns the new token or null. */
export async function refreshToken(): Promise<string | null> {
  if (await devSession()) return null; // dev tokens can't be refreshed; sign in again
  const sb = supabase();
  if (!sb) return null;
  const { data, error } = await sb.auth.refreshSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

export async function authState(): Promise<AuthState> {
  const dev = await devSession();
  if (dev) return { signedIn: true, email: dev.email, mode: 'dev' };
  const sb = supabase();
  if (!sb) return { signedIn: false, email: null, mode: null };
  const { data } = await sb.auth.getSession();
  return data.session ? { signedIn: true, email: data.session.user.email ?? null, mode: 'supabase' } : { signedIn: false, email: null, mode: null };
}

/**
 * Google sign-in through Supabase with PKCE. chrome.identity opens Google in a
 * separate window and hands back the redirect, so this works from the popup
 * even though the popup closes when that window takes focus.
 */
export async function signIn(): Promise<AuthState> {
  const sb = supabase();
  if (!sb) throw new AuthError('NOT_CONFIGURED', 'This build of the extension has no Supabase settings (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  const redirectTo = chrome.identity.getRedirectURL();
  const { data, error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } } });
  if (error || !data.url) throw new AuthError('SIGN_IN_FAILED', error?.message ?? 'Could not start Google sign-in.');
  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AuthError('SIGN_IN_CANCELLED', /did not approve|closed|cancel/i.test(msg) ? 'Sign-in was cancelled.' : `Sign-in failed: ${msg}`);
  }
  if (!responseUrl) throw new AuthError('SIGN_IN_CANCELLED', 'Sign-in was cancelled.');
  const back = new URL(responseUrl);
  const params = new URLSearchParams(back.search || back.hash.slice(1));
  const failure = params.get('error_description') ?? params.get('error');
  if (failure) throw new AuthError('SIGN_IN_FAILED', failure);
  const code = params.get('code');
  if (!code) throw new AuthError('SIGN_IN_FAILED', `Google sign-in did not return a code. Check that ${redirectTo} is an allowed redirect URL in Supabase.`);
  const { error: exErr } = await sb.auth.exchangeCodeForSession(code);
  if (exErr) throw new AuthError('SIGN_IN_FAILED', exErr.message);
  return authState();
}

/** Local development only: the API's /api/dev/login (refused in production and with non-local databases). */
export async function devSignIn(email: string, fetchImpl: typeof fetch = fetch): Promise<AuthState> {
  if (!config.devLogin) throw new AuthError('NOT_AVAILABLE', 'Development sign-in is not enabled in this build.');
  const res = await fetchImpl(`${config.apiUrl}/api/dev/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!res.ok) throw new AuthError('SIGN_IN_FAILED', `Development sign-in failed (${res.status}). Is the API running with ENABLE_DEV_LOGIN=true?`);
  const body = (await res.json()) as { access_token: string; expires_in: number; user: { email: string } };
  const session: DevSession = { token: body.access_token, email: body.user.email, expiresAt: Date.now() + body.expires_in * 1000 };
  await (await sessionStorageArea()).set({ [DEV_KEY]: session });
  return authState();
}

export async function signOut(): Promise<AuthState> {
  await (await sessionStorageArea()).remove(DEV_KEY);
  const sb = supabase();
  if (sb) await sb.auth.signOut({ scope: 'local' }).catch(() => undefined);
  return authState();
}
