import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import type { AuthUser } from '../auth/verify.js';
import type { Deps } from '../context.js';
import { AppError, badRequest, unauthorized } from '../errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    requestId?: string;
  }
}

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(
      'Some fields are invalid.',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      'VALIDATION_ERROR',
    );
  }
  return result.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function idParam(req: Request, name = 'id'): string {
  const v = req.params[name];
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw badRequest(`Invalid ${name}.`, undefined, 'INVALID_ID');
  return v;
}

export function userId(req: Request): string {
  if (!req.user) throw unauthorized();
  return req.user.id;
}

export function requireAuth(deps: Deps) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return next(unauthorized('Sign in to continue.', 'UNAUTHENTICATED'));
    const user = await deps.verifier.verify(token).catch(() => null);
    if (!user) return next(unauthorized('Your session expired. Sign in again.', 'SESSION_EXPIRED'));
    req.user = user;
    next();
  };
}

/** Ensures the auth user has a profile + settings row (first request after sign-up). */
export function ensureUserRows(deps: Deps) {
  const seen = new Map<string, number>();
  return async (req: Request, _res: Response, next: NextFunction) => {
    const id = req.user?.id;
    if (!id) return next();
    const last = seen.get(id);
    if (last && Date.now() - last < 10 * 60_000) return next();
    try {
      await deps.db.withUser(id, async (tx) => {
        await tx.query(`INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [id]);
        await tx.query(`INSERT INTO profiles (user_id, primary_email) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [id, req.user?.email ?? null]);
      });
      seen.set(id, Date.now());
      next();
    } catch (err) {
      // A missing auth.users row (FK) means the token is for a user that no longer exists.
      if ((err as { code?: string }).code === '23503') return next(unauthorized('This account no longer exists.', 'ACCOUNT_NOT_FOUND'));
      next(err);
    }
  };
}

export function errorHandler(deps: Deps) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId;
    if (err instanceof AppError) {
      if (err.status >= 500) deps.logger.error({ err, requestId, code: err.code }, err.message);
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, request_id: requestId } });
    }
    const e = err as { type?: string; status?: number; code?: string; message?: string };
    if (e?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.', request_id: requestId } });
    }
    if (e?.type === 'entity.too.large' || e?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The upload is too large.', request_id: requestId } });
    }
    if (e?.code && String(e.code).startsWith('LIMIT_')) {
      return res.status(400).json({ error: { code: 'UPLOAD_REJECTED', message: 'The upload was rejected.', request_id: requestId } });
    }
    deps.logger.error({ err, requestId }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.', request_id: requestId } });
  };
}
