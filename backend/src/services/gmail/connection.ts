import type { GmailConnectionStatus } from '@autoreach/shared';
import type { Deps } from '../../context.js';
import type { Tx } from '../../db/pool.js';
import { AppError, badRequest, serviceUnavailable } from '../../errors.js';
import { decryptSecret, encryptSecret, pkceChallenge, randomToken } from '../../lib/crypto.js';
import { logActivity } from '../activity.js';
import { GmailClient } from './client.js';
import {
  accountEmail,
  buildAuthorizeUrl,
  exchangeCode,
  GMAIL_SEND_SCOPE,
  hasAnyScope,
  OAuthGrantError,
  READ_CAPABLE_SCOPES,
  refreshAccessToken,
  revokeToken,
  SEND_CAPABLE_SCOPES,
  type OAuthClientConfig,
} from './oauth.js';

interface ConnectionRow {
  id: string;
  user_id: string;
  account_email: string;
  scopes: string[];
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  status: 'active' | 'needs_reauth' | 'revoked';
  last_error: string | null;
  history_id: string | null;
  last_sync_at: string | null;
  sync_error: string | null;
}

function oauthConfig(deps: Deps): OAuthClientConfig {
  const g = deps.config.gmail;
  if (!g.configured || !g.clientId || !g.clientSecret) throw serviceUnavailable('GMAIL_NOT_CONFIGURED', g.reason ?? 'Gmail is not configured on the server.');
  return { clientId: g.clientId, clientSecret: g.clientSecret, redirectUri: g.redirectUri, replyDetection: g.replyDetection };
}

function key(deps: Deps): Buffer {
  if (!deps.config.tokenEncryptionKey) throw serviceUnavailable('GMAIL_NOT_CONFIGURED', 'TOKEN_ENCRYPTION_KEY is not set on the server.');
  return deps.config.tokenEncryptionKey;
}

export async function getConnectionRow(tx: Tx, userId: string): Promise<ConnectionRow | null> {
  return tx.maybeOne<ConnectionRow>(`SELECT * FROM oauth_connections WHERE user_id = $1 AND provider = 'google_gmail'`, [userId]);
}

export async function connectionStatus(deps: Deps, tx: Tx, userId: string): Promise<GmailConnectionStatus> {
  const row = await getConnectionRow(tx, userId);
  const legacyPending = !row
    ? await tx.maybeOne(`SELECT 1 FROM user_smtp_settings WHERE user_id = $1 AND migrated_at IS NULL AND gmail_refresh_token IS NOT NULL`, [userId])
    : null;
  const connected = !!row && row.status !== 'revoked';
  return {
    configured: deps.config.gmail.configured,
    connected,
    account_email: row?.account_email ?? null,
    status: row ? row.status : legacyPending ? 'legacy_import_pending' : null,
    can_send: connected && row!.status === 'active' && hasAnyScope(row!.scopes, SEND_CAPABLE_SCOPES),
    can_detect_replies: deps.config.gmail.replyDetection && connected && row!.status === 'active' && hasAnyScope(row!.scopes, READ_CAPABLE_SCOPES),
    reply_detection_enabled: deps.config.gmail.replyDetection,
    scopes: row?.scopes ?? [],
    last_sync_at: row?.last_sync_at ?? null,
    sync_error: row?.sync_error ?? row?.last_error ?? null,
  };
}

/** Step 1 of the OAuth flow: single-use state with a PKCE verifier. */
export async function createAuthorization(
  deps: Deps,
  tx: Tx,
  userId: string,
  returnTo: 'dashboard' | 'onboarding' | 'extension',
  loginHint?: string | null,
  returnUrl?: string | null,
) {
  const cfg = oauthConfig(deps);
  key(deps);
  const state = randomToken(32);
  const verifier = randomToken(48);
  await tx.query(`DELETE FROM oauth_states WHERE user_id = $1 AND expires_at < now()`, [userId]);
  await tx.query(
    `INSERT INTO oauth_states (state, user_id, code_verifier, return_to, return_url, expires_at) VALUES ($1,$2,$3,$4,$5, now() + interval '10 minutes')`,
    [state, userId, verifier, returnTo, returnUrl ?? null],
  );
  return { url: buildAuthorizeUrl(cfg, state, pkceChallenge(verifier), loginHint) };
}

/**
 * Step 2a: Google redirected back to the API. Nothing is exchanged here: we only
 * look up where the flow started so the code can be handed to that signed-in
 * client (dashboard or extension), which completes it in step 2b.
 */
export async function lookupAuthorization(deps: Deps, state: string): Promise<{ returnTo: string; returnUrl: string | null } | null> {
  const row = await deps.db.withSystem((tx) =>
    tx.maybeOne<{ return_to: string; return_url: string | null }>(`SELECT return_to, return_url FROM oauth_states WHERE state = $1 AND expires_at > now()`, [state]),
  );
  return row ? { returnTo: row.return_to, returnUrl: row.return_url } : null;
}

/**
 * Step 2b: the signed-in user who started the flow completes it. A state created
 * by someone else is refused, so a consent link forwarded to another person can't
 * attach that person's Gmail to the sender's account.
 */
export async function completeAuthorization(deps: Deps, code: string, state: string, userId: string): Promise<{ userId: string; returnTo: string; email: string }> {
  const cfg = oauthConfig(deps);
  const k = key(deps);
  const consumed = await deps.db.withSystem((tx) =>
    tx.maybeOne<{ user_id: string; code_verifier: string; return_to: string }>(
      `DELETE FROM oauth_states WHERE state = $1 AND user_id = $2 AND expires_at > now() RETURNING user_id, code_verifier, return_to`,
      [state, userId],
    ),
  );
  if (!consumed) {
    throw badRequest('This Gmail connection was started from a different AutoReach account, has expired, or was already used. Start again from Settings.', undefined, 'OAUTH_STATE_INVALID');
  }

  const tokens = await exchangeCode(deps.fetch, cfg, code, consumed.code_verifier).catch((err: unknown) => {
    throw badRequest(`Google did not complete the connection: ${(err as Error).message}`, undefined, 'OAUTH_EXCHANGE_FAILED');
  });
  const email = await accountEmail(deps.fetch, tokens);
  const scopes = (tokens.scope ?? '').split(/\s+/).filter(Boolean);
  if (!hasAnyScope(scopes, SEND_CAPABLE_SCOPES)) {
    await revokeToken(deps.fetch, tokens.refresh_token ?? tokens.access_token);
    throw badRequest(
      'Google did not grant permission to send email. Connect again and keep the "Send email on your behalf" box checked.',
      undefined,
      'GMAIL_SEND_SCOPE_DECLINED',
    );
  }

  await deps.db.withUser(consumed.user_id, async (tx) => {
    const existing = await getConnectionRow(tx, consumed.user_id);
    // Google only returns a refresh token on (re)consent; keep the old one otherwise.
    const refreshEnc = tokens.refresh_token ? encryptSecret(tokens.refresh_token, k) : existing?.refresh_token_enc ?? null;
    const sameAccount = existing?.account_email === email;
    await tx.query(
      `INSERT INTO oauth_connections (user_id, provider, account_email, scopes, access_token_enc, refresh_token_enc, token_expires_at, status, last_error, history_id, sync_error)
       VALUES ($1, 'google_gmail', $2, $3, $4, $5, now() + make_interval(secs => $6), 'active', NULL, NULL, NULL)
       ON CONFLICT (user_id, provider) DO UPDATE SET
         account_email = EXCLUDED.account_email, scopes = EXCLUDED.scopes, access_token_enc = EXCLUDED.access_token_enc,
         refresh_token_enc = EXCLUDED.refresh_token_enc, token_expires_at = EXCLUDED.token_expires_at, status = 'active',
         last_error = NULL, sync_error = NULL, imported_from_v1 = false,
         history_id = CASE WHEN $7 THEN oauth_connections.history_id ELSE NULL END`,
      [consumed.user_id, email, scopes, encryptSecret(tokens.access_token, k), refreshEnc, Math.max(60, tokens.expires_in - 60), sameAccount],
    );
    await tx.query(`UPDATE user_smtp_settings SET gmail_access_token = NULL, gmail_refresh_token = NULL, migrated_at = COALESCE(migrated_at, now()) WHERE user_id = $1`, [
      consumed.user_id,
    ]);
    await logActivity(tx, consumed.user_id, 'gmail_connected', `Connected Gmail account ${email}`, {}, { scopes });
  });
  return { userId: consumed.user_id, returnTo: consumed.return_to, email };
}

export async function disconnect(deps: Deps, userId: string): Promise<void> {
  const row = await deps.db.withUser(userId, (tx) => getConnectionRow(tx, userId));
  if (row && deps.config.tokenEncryptionKey) {
    const token = row.refresh_token_enc ?? row.access_token_enc;
    if (token) {
      try {
        await revokeToken(deps.fetch, decryptSecret(token, deps.config.tokenEncryptionKey));
      } catch (err) {
        deps.logger.warn({ err }, 'could not decrypt token for revocation');
      }
    }
  }
  await deps.db.withUser(userId, async (tx) => {
    await tx.query(`DELETE FROM oauth_connections WHERE user_id = $1 AND provider = 'google_gmail'`, [userId]);
    await tx.query(`UPDATE user_smtp_settings SET gmail_access_token = NULL, gmail_refresh_token = NULL, migrated_at = COALESCE(migrated_at, now()) WHERE user_id = $1`, [userId]);
    if (row) await logActivity(tx, userId, 'gmail_disconnected', `Disconnected Gmail account ${row.account_email}`);
  });
}

export interface AuthorizedGmail {
  client: GmailClient;
  accountEmail: string;
  scopes: string[];
  canDetectReplies: boolean;
}

/**
 * Returns a Gmail client with a fresh access token, refreshing if it expires
 * within 5 minutes. Token refresh state is written in its own transaction.
 */
export async function getAuthorizedGmail(deps: Deps, userId: string, purpose: 'send' | 'read'): Promise<AuthorizedGmail> {
  const k = key(deps);
  const cfg = oauthConfig(deps);
  const row = await deps.db.withSystem((tx) =>
    tx.maybeOne<ConnectionRow>(`SELECT * FROM oauth_connections WHERE user_id = $1 AND provider = 'google_gmail'`, [userId]),
  );
  if (!row) throw new AppError(409, 'GMAIL_NOT_CONNECTED', 'Connect your Gmail account in Settings before sending.');
  if (row.status !== 'active') throw new AppError(409, 'GMAIL_REAUTH_REQUIRED', 'Gmail access expired or was revoked. Reconnect Gmail in Settings.');
  if (purpose === 'send' && !hasAnyScope(row.scopes, SEND_CAPABLE_SCOPES)) {
    throw new AppError(409, 'GMAIL_SCOPE_MISSING', 'AutoReach is not allowed to send from this Gmail account. Reconnect Gmail and allow sending.');
  }
  if (purpose === 'read' && !deps.config.gmail.replyDetection) {
    throw new AppError(409, 'REPLY_DETECTION_DISABLED', 'Reply detection is turned off on this server (GMAIL_REPLY_DETECTION=false). Mark replies by hand on each email.');
  }
  if (purpose === 'read' && !hasAnyScope(row.scopes, READ_CAPABLE_SCOPES)) {
    throw new AppError(409, 'GMAIL_SCOPE_MISSING', 'Reply detection needs the Gmail metadata permission. Reconnect Gmail to enable it.');
  }

  let accessToken = row.access_token_enc ? decryptSecret(row.access_token_enc, k) : null;
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  if (!accessToken || expiresAt - deps.now().getTime() < 5 * 60_000) {
    if (!row.refresh_token_enc) {
      await markNeedsReauth(deps, userId, 'No refresh token stored');
      throw new AppError(409, 'GMAIL_REAUTH_REQUIRED', 'Gmail access expired. Reconnect Gmail in Settings.');
    }
    try {
      const tokens = await refreshAccessToken(deps.fetch, cfg, decryptSecret(row.refresh_token_enc, k));
      accessToken = tokens.access_token;
      const newScopes = tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : row.scopes;
      await deps.db.withSystem((tx) =>
        tx.query(
          `UPDATE oauth_connections SET access_token_enc = $2, token_expires_at = now() + make_interval(secs => $3), scopes = $4,
             refresh_token_enc = COALESCE($5, refresh_token_enc), last_error = NULL
           WHERE id = $1`,
          [row.id, encryptSecret(tokens.access_token, k), Math.max(60, tokens.expires_in - 60), newScopes, tokens.refresh_token ? encryptSecret(tokens.refresh_token, k) : null],
        ),
      );
      row.scopes = newScopes;
    } catch (err) {
      if (err instanceof OAuthGrantError && (err.code === 'invalid_grant' || err.code === 'unauthorized_client')) {
        await markNeedsReauth(deps, userId, err.message);
        throw new AppError(409, 'GMAIL_REAUTH_REQUIRED', 'Gmail access expired or was revoked. Reconnect Gmail in Settings.');
      }
      throw new AppError(503, 'GMAIL_TOKEN_REFRESH_FAILED', 'Could not refresh Gmail access right now. Try again shortly.');
    }
  }
  return {
    client: new GmailClient(deps.fetch, accessToken),
    accountEmail: row.account_email,
    scopes: row.scopes,
    canDetectReplies: hasAnyScope(row.scopes, READ_CAPABLE_SCOPES),
  };
}

export async function markNeedsReauth(deps: Deps, userId: string, reason: string): Promise<void> {
  await deps.db.withSystem((tx) =>
    tx.query(`UPDATE oauth_connections SET status = 'needs_reauth', last_error = $2 WHERE user_id = $1 AND provider = 'google_gmail'`, [userId, reason.slice(0, 300)]),
  );
}

/**
 * One-time import of v1 plaintext tokens into encrypted storage. Idempotent;
 * runs at API start-up. The v1 grant only had gmail.send, so reply detection
 * shows "reconnect to enable" until the user reconnects.
 */
export async function importLegacyTokens(deps: Deps): Promise<number> {
  if (!deps.config.tokenEncryptionKey) return 0;
  const k = deps.config.tokenEncryptionKey;
  return deps.db.withSystem(async (tx) => {
    const exists = await tx.maybeOne<{ t: string | null }>(`SELECT to_regclass('public.user_smtp_settings')::text AS t`);
    if (!exists?.t) return 0;
    const rows = await tx.many<{ user_id: string; gmail_user: string | null; gmail_access_token: string | null; gmail_refresh_token: string | null; token_expires_at: string | null }>(
      `SELECT user_id, gmail_user, gmail_access_token, gmail_refresh_token, token_expires_at FROM user_smtp_settings
       WHERE migrated_at IS NULL AND (gmail_refresh_token IS NOT NULL OR gmail_access_token IS NOT NULL)
         -- rows of deleted accounts (or without an owner) can't be imported; leave them alone
         AND user_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = user_smtp_settings.user_id)
       FOR UPDATE OF user_smtp_settings`,
    );
    let imported = 0;
    for (const r of rows) {
      if (r.gmail_refresh_token && r.gmail_user) {
        const res = await tx.query(
          `INSERT INTO oauth_connections (user_id, provider, account_email, scopes, access_token_enc, refresh_token_enc, token_expires_at, status, imported_from_v1)
           VALUES ($1, 'google_gmail', $2, $3, $4, $5, $6, 'active', true)
           ON CONFLICT (user_id, provider) DO NOTHING`,
          [
            r.user_id,
            r.gmail_user.toLowerCase(),
            [GMAIL_SEND_SCOPE, 'https://www.googleapis.com/auth/userinfo.email'],
            r.gmail_access_token ? encryptSecret(r.gmail_access_token, k) : null,
            encryptSecret(r.gmail_refresh_token, k),
            r.token_expires_at,
          ],
        );
        imported += res.rowCount ?? 0;
      }
      await tx.query(`UPDATE user_smtp_settings SET gmail_access_token = NULL, gmail_refresh_token = NULL, migrated_at = now() WHERE user_id = $1`, [r.user_id]);
    }
    return imported;
  });
}
