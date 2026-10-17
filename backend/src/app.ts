import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Deps } from './context.js';
import { ensureUserRows, errorHandler, requireAuth } from './http/support.js';
import { coreRoutes } from './http/routes/core.js';
import { careerOpsRoutes } from './http/routes/careerOps.js';
import { crmRoutes } from './http/routes/crm.js';
import { jobRoutes } from './http/routes/jobs.js';
import { outreachRoutes } from './http/routes/outreach.js';
import { publicRoutes } from './http/routes/public.js';

function limiter(windowMs: number, limit: number, keyBy: 'user' | 'ip', message: string, relaxed = false) {
  return rateLimit({
    windowMs,
    // Automated tests exercise many sends per minute; production limits are unchanged.
    limit: relaxed ? limit * 1000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (keyBy === 'user' && req.user?.id ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req.ip ?? '0.0.0.0')}`),
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message } }),
  });
}

export function createApp(deps: Deps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.config.trustProxyHops);

  app.use((req, res, next) => {
    const incoming = req.headers['x-request-id'];
    req.requestId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });
  if (deps.config.env !== 'test') {
    app.use(
      pinoHttp({
        logger: deps.logger,
        genReqId: (req) => (req as unknown as { requestId: string }).requestId,
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
        // Tracking pixels and health checks are noisy and contain nothing useful.
        autoLogging: { ignore: (req) => /^\/(t|track)\/|^\/healthz/.test(req.url ?? '') },
        serializers: {
          req: (req: { method: string; url: string; id: string }) => ({ method: req.method, url: req.url.replace(/\/t\/[^/?]+/, '/t/[token]').replace(/\/track\/[^/?]+/, '/track/[id]').replace(/([?&](code|state)=)[^&]+/g, '$1[redacted]'), id: req.id }),
          // Status only: response headers add noise and nothing useful for debugging.
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
      }),
    );
  }

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], styleSrc: ["'unsafe-inline'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const allowed = new Set(deps.config.corsOrigins);
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // server-to-server, curl, same-origin navigations
        if (allowed.has(origin)) return cb(null, true);
        if (!deps.config.isProd && (/^chrome-extension:\/\/[a-p]{32}$/.test(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) return cb(null, true);
        return cb(null, false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  const relaxed = deps.config.env === 'test';
  const limiters = {
    pixel: limiter(60_000, 300, 'ip', 'Too many requests.', relaxed),
    oauth: limiter(60_000, 30, 'ip', 'Too many attempts. Try again in a minute.', relaxed),
    devLogin: limiter(60_000, 30, 'ip', 'Too many attempts.', relaxed),
    api: limiter(60_000, 600, 'user', 'Too many requests. Slow down a little.', relaxed),
    ai: limiter(10 * 60_000, 60, 'user', 'AI drafting limit reached (60 per 10 minutes). Try again shortly.', relaxed),
    send: limiter(60_000, 20, 'user', 'Too many send requests in a minute.', relaxed),
    sync: limiter(60_000, 6, 'user', 'Reply sync was requested too often. Try again in a minute.', relaxed),
  };

  app.use(publicRoutes(deps, limiters));

  const api = express.Router();
  api.use(requireAuth(deps));
  api.use(limiters.api);
  api.use(ensureUserRows(deps));
  api.use(coreRoutes(deps, limiters));
  api.use(crmRoutes(deps));
  api.use(jobRoutes(deps, limiters));
  api.use(careerOpsRoutes(deps, limiters));
  api.use(outreachRoutes(deps, limiters));
  app.use('/api', api);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });
  app.use(errorHandler(deps));
  return app;
}
