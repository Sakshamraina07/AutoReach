import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { decodeProtectedHeader, jwtVerify, SignJWT } from 'jose';
import type { AppConfig } from '../config.js';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthUser | null>;
}

/**
 * Verifies Supabase access tokens.
 *  1. HS256 with SUPABASE_JWT_SECRET (Supabase "legacy JWT secret") — local, no network.
 *  2. HS256 with DEV_JWT_SECRET — only when ENABLE_DEV_LOGIN (never in production).
 *  3. Otherwise ask Supabase Auth (`auth.getUser`), which works for any signing key type.
 * Successful verifications are cached for up to 60 s (never beyond token expiry).
 */
export class SupabaseTokenVerifier implements TokenVerifier {
  private readonly cache = new Map<string, { user: AuthUser; until: number }>();
  private readonly supabase: SupabaseClient | null;
  private readonly enc = new TextEncoder();

  constructor(private readonly cfg: AppConfig) {
    this.supabase =
      cfg.supabase.url && cfg.supabase.anonKey
        ? createClient(cfg.supabase.url, cfg.supabase.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
        : null;
  }

  async verify(token: string): Promise<AuthUser | null> {
    if (!token || token.length > 8192) return null;
    const key = createHash('sha256').update(token).digest('hex');
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.user;

    let user: AuthUser | null = null;
    let exp: number | undefined;
    let alg: string | undefined;
    try {
      alg = decodeProtectedHeader(token).alg;
    } catch {
      return null;
    }

    if (alg === 'HS256' && this.cfg.supabase.jwtSecret) {
      ({ user, exp } = await this.verifyHs256(token, this.cfg.supabase.jwtSecret));
    }
    if (!user && alg === 'HS256' && this.cfg.devLogin.enabled && this.cfg.devLogin.secret) {
      ({ user, exp } = await this.verifyHs256(token, this.cfg.devLogin.secret));
    }
    if (!user && this.supabase && !(alg === 'HS256' && this.cfg.supabase.jwtSecret)) {
      const { data, error } = await this.supabase.auth.getUser(token);
      if (!error && data.user) user = { id: data.user.id, email: data.user.email ?? null };
    }
    if (!user) return null;

    const until = Math.min(Date.now() + 60_000, exp ? exp * 1000 : Infinity);
    this.cache.set(key, { user, until });
    if (this.cache.size > 5000) {
      const now = Date.now();
      for (const [k, v] of this.cache) if (v.until <= now) this.cache.delete(k);
    }
    return user;
  }

  private async verifyHs256(token: string, secret: string): Promise<{ user: AuthUser | null; exp?: number }> {
    try {
      const { payload } = await jwtVerify(token, this.enc.encode(secret), { algorithms: ['HS256'], audience: 'authenticated' });
      if (typeof payload.sub !== 'string') return { user: null };
      return { user: { id: payload.sub, email: typeof payload.email === 'string' ? payload.email : null }, exp: payload.exp };
    } catch {
      return { user: null };
    }
  }
}

/** Issue a token for development/test login (same claims shape as Supabase). */
export async function signDevToken(secret: string, user: AuthUser, ttlSeconds = 3600): Promise<string> {
  return new SignJWT({ email: user.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(new TextEncoder().encode(secret));
}
