import { Router, type RequestHandler } from 'express';
import { jobAnalyzeSchema, jobRecruitersPasteSchema, jobSaveSchema } from '@autoreach/shared';
import type { Deps } from '../../context.js';
import { z } from 'zod';
import { addRecruitersToJob, analyzeJob, getJob, prepareJobEmail, saveJob, suggestedRecruiters } from '../../services/jobs.js';
import { idParam, parse, userId } from '../support.js';

/** "Paste a job → cold email" screen. Reading a job description uses the AI limit. */
export function jobRoutes(deps: Deps, limiters: { ai: RequestHandler }): Router {
  const r = Router();

  r.post('/jobs/analyze', limiters.ai, async (req, res) => {
    const uid = userId(req);
    const body = parse(jobAnalyzeSchema, req.body);
    res.json(await analyzeJob(deps, uid, body));
  });
  r.post('/jobs', async (req, res) => {
    const uid = userId(req);
    const body = parse(jobSaveSchema, req.body);
    res.status(201).json(await deps.db.withUser(uid, (tx) => saveJob(deps, tx, uid, body)));
  });
  r.get('/jobs/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    res.json(await deps.db.withUser(uid, (tx) => getJob(deps, tx, uid, id)));
  });
  r.post('/jobs/:id/recruiters', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const body = parse(jobRecruitersPasteSchema, req.body ?? {});
    res.json(await deps.db.withUser(uid, (tx) => addRecruitersToJob(deps, tx, uid, id, body)));
  });
  r.get('/jobs/:id/suggested-recruiters', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    res.json({ recruiters: await deps.db.withUser(uid, (tx) => suggestedRecruiters(tx, uid, id)) });
  });

  /** Write (or reuse) the email for one recruiter on this job. Never sends. */
  r.post('/jobs/:id/recruiters/:recruiterId/email', limiters.ai, async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const recruiterId = idParam(req, 'recruiterId');
    const opts = parse(z.object({ regenerate: z.boolean().default(false), use_template: z.boolean().default(false) }), req.body ?? {});
    res.json(await deps.db.withUser(uid, (tx) => prepareJobEmail(deps, tx, uid, id, recruiterId, opts)));
  });

  return r;
}
