import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { config, supabaseConfigured } from './config';

/**
 * Authentication: Supabase Auth (Google) in normal use; a local "dev login"
 * only when VITE_DEV_LOGIN=true and the API has ENABLE_DEV_LOGIN (never in production).
 */

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

const DEV_KEY = 'autoreach.devSession';

interface AuthState {
  ready: boolean;
  email: string | null;
  getToken: () => Promise<string | null>;
  /** Force-refresh after a 401; returns a new token or null. */
  refresh: () => Promise<string | null>;
  signInWithGoogle: () => Promise<void>;
  devSignIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  signedIn: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

interface DevSession {
  token: string;
  email: string;
  expiresAt: number;
}

function readDev(): DevSession | null {
  try {
    const raw = localStorage.getItem(DEV_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as DevSession;
    return s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [dev, setDev] = useState<DevSession | null>(() => (config.devLogin ? readDev() : null));
  const [ready, setReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const getToken = useCallback(async () => {
    if (dev) return dev.token;
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, [dev]);

  const refresh = useCallback(async () => {
    if (dev || !supabase) return null;
    const { data } = await supabase.auth.refreshSession();
    return data.session?.access_token ?? null;
  }, [dev]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured for this dashboard build.');
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/` } });
    if (error) throw error;
  }, []);

  const devSignIn = useCallback(async (email: string) => {
    const res = await fetch(`${config.apiUrl}/api/dev/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message: string } };
    if (!res.ok || !body.access_token) throw new Error(body.error?.message ?? 'Dev login failed');
    const s = { token: body.access_token, email, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    localStorage.setItem(DEV_KEY, JSON.stringify(s));
    setDev(s);
  }, []);

  const signOut = useCallback(async () => {
    localStorage.removeItem(DEV_KEY);
    setDev(null);
    if (supabase) await supabase.auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      email: dev?.email ?? session?.user.email ?? null,
      signedIn: !!dev || !!session,
      getToken,
      refresh,
      signInWithGoogle,
      devSignIn,
      signOut,
    }),
    [ready, dev, session, getToken, refresh, signInWithGoogle, devSignIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
