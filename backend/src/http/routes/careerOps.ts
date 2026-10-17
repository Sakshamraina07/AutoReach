import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Deps } from '../../context.js';
import { careerOpsOverview, importCareerOpsJob, profileToCvMarkdown, writeCareerOpsCv } from '../../services/careerOps.js';
import { unprocessable } from '../../errors.js';
import { getProfile } from '../../services/profile.js';
import { parse, userId } from '../support.js';

/** Jobs from a career-ops folder on this computer (CAREER_OPS_DIR). Read-only apart from writing cv.md once. */
export function careerOpsRoutes(deps: Deps, limiters: { ai: RequestHandler }): Router {
  const r = Router();

  r.get('/career-ops', async (req, res) => {
    const uid = userId(req);
    res.json(await careerOpsOverview(deps, uid, req.user?.email));
  });

  r.post('/career-ops/reports/:number/import', limiters.ai, async (req, res) => {
    const uid = userId(req);
    const { number } = parse(z.object({ number: z.coerce.number().int().min(0).max(1_000_000) }), req.params);
    res.status(201).json(await importCareerOpsJob(deps, uid, req.user?.email, number));
  });

  async function cvMarkdown(uid: string): Promise<string> {
    const profile = await deps.db.withUser(uid, (tx) => getProfile(tx, uid));
    if (!profile?.full_name) throw unprocessable('PROFILE_INCOMPLETE', 'Fill in your profile first: cv.md is built from it.');
    return profileToCvMarkdown(profile);
  }

  /** cv.md for career-ops, built from the AutoReach profile. */
  r.get('/career-ops/cv.md', async (req, res) => {
    const uid = userId(req);
    const md = await cvMarkdown(uid);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cv.md"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(md);
  });

  /** Write cv.md into the career-ops folder (only when it has none). */
  r.post('/career-ops/cv.md', async (req, res) => {
    const uid = userId(req);
    const md = await cvMarkdown(uid);
    res.status(201).json(await writeCareerOpsCv(deps, req.user?.email, md));
  });

  return r;
}
