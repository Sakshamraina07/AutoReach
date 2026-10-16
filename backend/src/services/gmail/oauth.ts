import { decodeJwt } from 'jose';
import { fetchWithTimeout, readJson, type FetchLike } from '../../lib/http.js';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GMAIL_METADATA_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';
/** Broader scopes that also satisfy reply detection if a user granted them elsewhere. */
export const READ_CAPABLE_SCOPES = [GMAIL_METADATA_SCOPE, 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/'];
export const SEND_CAPABLE_SCOPES = [GMAIL_SEND_SCOPE, 'https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/'];
export const REQUESTED_SCOPES = ['openid', 'email', GMAIL_SEND_SCOPE, GMAIL_METADATA_SCOPE];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class OAuthGrantError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'OAuthGrantError';
  }
}

export function buildAuthorizeUrl(cfg: OAuthClientConfig, state: string, codeChallenge: string, loginHint?: string | null): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', REQUESTED_SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (loginHint) u.searchParams.set('login_hint', loginHint);
  return u.toString();
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

async function tokenRequest(fetchImpl: FetchLike, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetchWithTimeout(fetchImpl, TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    timeoutMs: 20_000,
  });
  const json = await readJson<TokenResponse & { error?: string; error_description?: string }>(res);
  if (!res.ok || !json?.access_token) {
    const code = json?.error ?? `http_${res.status}`;
    throw new OAuthGrantError(json?.error_description ?? `Google token endpoint error (${code})`, code);
  }
  return json;
}

export function exchangeCode(fetchImpl: FetchLike, cfg: OAuthClientConfig, code: string, codeVerifier: string): Promise<TokenResponse> {
  return tokenRequest(fetchImpl, {
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
}

export function refreshAccessToken(fetchImpl: FetchLike, cfg: OAuthClientConfig, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(fetchImpl, {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
}

export async function revokeToken(fetchImpl: FetchLike, token: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(fetchImpl, REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      timeoutMs: 15_000,
    });
    // 400 invalid_token means it is already revoked/expired — the goal is reached.
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

/**
 * The ID token arrives directly from Google's token endpoint over TLS, which
 * OpenID Connect Core §3.1.3.7 allows in place of signature verification.
 * Falls back to the userinfo endpoint.
 */
export async function accountEmail(fetchImpl: FetchLike, tokens: TokenResponse): Promise<string> {
  if (tokens.id_token) {
    try {
      const claims = decodeJwt(tokens.id_token);
      if (typeof claims.email === 'string' && claims.email_verified !== false) return claims.email.toLowerCase();
    } catch {
      /* fall through */
    }
  }
  const res = await fetchWithTimeout(fetchImpl, USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` }, timeoutMs: 15_000 });
  const info = await readJson<{ email?: string }>(res);
  if (!res.ok || !info?.email) throw new OAuthGrantError('Could not read the Gmail account address.', 'userinfo_failed');
  return info.email.toLowerCase();
}

export function hasAnyScope(granted: string[], acceptable: string[]): boolean {
  return granted.some((s) => acceptable.includes(s));
}
