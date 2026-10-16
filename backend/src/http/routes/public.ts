import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { signDevToken } from '../../auth/verify.js';
import type { Deps } from '../../context.js';
import { pendingMigrations } from '../../db/migrate.js';
import { AppError, notFound } from '../../errors.js';
import { completeAuthorization } from '../../services/gmail/connection.js';
import { PIXEL, recordPixelHit } from '../../services/tracking.js';
import { escapeHtml } from '../../services/gmail/mime.js';
import { parse } from '../support.js';

function sendPixel(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': PIXEL.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  res.end(PIXEL);
}

function resultPage(title: string, body: string, ok: boolean): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0f17;color:#e6e9ef;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:440px;padding:32px;border:1px solid #232a37;border-radius:12px;background:#111622}h1{font-size:18px;margin:0 0 8px;color:${ok ? '#7ee2a8' : '#ff9b9b'}}p{color:#a7b0c0;line-height:1.5;margin:0}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body></html>`;
}

export function publicRoutes(deps: Deps, limiters: { pixel: RequestHandler; oauth: RequestHandler; devLogin: RequestHandler }): Router {
  const r = Router();

  r.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  r.get('/readyz', async (_req, res) => {
    const dbOk = await deps.db.ping();
    let pending: string[] = [];
    if (dbOk) {
      const client = await deps.db.pool.connect();
      try {
        pending = await pendingMigrations(client);
      } finally {
        client.release();
      }
    }
    const ready = dbOk && pending.length === 0;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      database: dbOk ? 'ok' : 'unreachable',
      pending_migrations: pending,
      integrations: {
        gmail: deps.config.gmail.configured ? 'configured' : deps.config.gmail.reason,
        ai: deps.ai ? `${deps.ai.name}:${deps.ai.model}` : deps.config.ai.reason,
        tracking: deps.config.tracking.configured ? 'configured' : deps.config.tracking.reason,
        storage: deps.storage.driver,
        workers: deps.config.workersEnabled ? 'enabled' : 'disabled',
      },
    });
  });

  // Open-tracking pixel: always answer immediately with the image; record asynchronously.
  r.get('/t/:token', limiters.pixel, (req, res) => {
    const token = String(req.params.token).replace(/\.gif$/i, '');
    sendPixel(res);
    recordPixelHit(deps, token, req.headers['user-agent']).catch((err) => deps.logger.warn({ err: (err as Error).message }, 'pixel record failed'));
  });
  // v1 pixels already embedded in sent emails (token = legacy history id).
  r.get('/track/:id', limiters.pixel, (req, res) => {
    sendPixel(res);
    recordPixelHit(deps, String(req.params.id), req.headers['user-agent']).catch((err) => deps.logger.warn({ err: (err as Error).message }, 'legacy pixel record failed'));
  });

  r.get('/api/integrations/gmail/callback', limiters.oauth, async (req, res) => {
    const q = z.object({ code: z.string().max(2048).optional(), state: z.string().max(256).optional(), error: z.string().max(200).optional() }).safeParse(req.query);
    const dashboard = `${deps.config.dashboardUrl}/settings?section=gmail`;
    if (!q.success || q.data.error || !q.data.code || !q.data.state) {
      const reason = q.success && q.data.error === 'access_denied' ? 'You cancelled the Google permission screen.' : 'Google did not return an authorization code.';
      return res.status(400).type('html').send(resultPage('Gmail was not connected', `${reason} Return to AutoReach and try again.`, false));
    }
    try {
      const result = await completeAuthorization(deps, q.data.code, q.data.state);
      if (result.returnTo === 'extension') {
        return res.type('html').send(resultPage('Gmail connected', `AutoReach can now send from ${result.email}. You can close this tab.`, true));
      }
      if (result.returnTo === 'onboarding') return res.redirect(303, `${deps.config.dashboardUrl}/onboarding?gmail=connected`);
      return res.redirect(303, `${dashboard}&gmail=connected`);
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'Something went wrong while connecting Gmail.';
      if (!(err instanceof AppError)) deps.logger.error({ err }, 'gmail callback failed');
      return res.status(400).type('html').send(resultPage('Gmail was not connected', message, false));
    }
  });

  // Development-only sign-in (refused by config in production).
  r.post('/api/dev/login', limiters.devLogin, async (req, res) => {
    if (!deps.config.devLogin.enabled || !deps.config.devLogin.secret) throw notFound('Route');
    const { email } = parse(z.object({ email: z.email().max(254) }), req.body);
    const id = await deps.db.withSystem(async (tx) => {
      const authExists = await tx.maybeOne<{ t: string | null }>(`SELECT to_regclass('auth.users')::text AS t`);
      if (!authExists?.t) throw new AppError(500, 'NO_AUTH_SCHEMA', 'auth.users does not exist; run the migrations with the local auth shim.');
      const existing = await tx.maybeOne<{ id: string }>(`SELECT id FROM auth.users WHERE lower(email) = lower($1)`, [email]);
      if (existing) return existing.id;
      return (await tx.one<{ id: string }>(`INSERT INTO auth.users (email) VALUES ($1) RETURNING id`, [email])).id;
    });
    const token = await signDevToken(deps.config.devLogin.secret, { id, email }, 12 * 3600);
    res.json({ access_token: token, token_type: 'bearer', expires_in: 12 * 3600, user: { id, email } });
  });

  return r;
}
