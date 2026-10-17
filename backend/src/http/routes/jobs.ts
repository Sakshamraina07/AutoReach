import { Router, type RequestHandler } from 'express';
import { jobAnalyzeSchema, jobRecruitersPasteSchema, jobSaveSchema } from '@autoreach/shared';
import type { Deps } from '../../context.js';
import { z } from 'zod';
import { unprocessable } from '../../errors.js';
import { fetchJobFromBoard, jobBoardTarget } from '../../services/jobFetch.js';
import { findPeopleAtCompany } from '../../services/hunter.js';
import { addFoundPeopleToJob, addRecruitersToJob, analyzeJob, getJob, prepareJobEmail, saveJob, suggestedRecruiters } from '../../services/jobs.js';
import { findActiveByEmail } from '../../services/recruiters.js';
import { getOpportunity } from '../../services/opportunities.js';
import { notFound } from '../../errors.js';
import { idParam, parse, userId } from '../support.js';

/** "Paste a job → cold email" screen. Reading a job description uses the AI limit. */
export function jobRoutes(deps: Deps, limiters: { ai: RequestHandler }): Router {
  const r = Router();

  r.post('/jobs/analyze', limiters.ai, async (req, res) => {
    const uid = userId(req);
    const body = parse(jobAnalyzeSchema, req.body);
    res.json(await analyzeJob(deps, uid, body));
  });
  /** The text of a Greenhouse, Lever or Ashby posting, from the board's public API. */
  r.post('/jobs/fetch', limiters.ai, async (req, res) => {
    userId(req);
    const { url } = parse(z.object({ url: z.string().trim().min(1).max(2048) }), req.body ?? {});
    if (!jobBoardTarget(url)) {
      throw unprocessable('JOB_LINK_UNSUPPORTED', 'AutoReach can read links from Greenhouse, Lever and Ashby job boards. For other sites, paste the description.');
    }
    const job = await fetchJobFromBoard(deps.fetch, url);
    if (!job) throw unprocessable('JOB_NOT_FOUND', "The job board didn't return this posting. It may have closed; paste the description if you still have it.");
    res.json(job);
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

  /** People at the job's company from Hunter.io's Domain Search. Costs the user's Hunter credits; saves nothing. */
  r.post('/jobs/:id/find-people', limiters.ai, async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const body = parse(
      z.object({
        group: z.enum(['recruiters', 'engineering', 'everyone']).default('recruiters'),
        domain: z
          .string()
          .trim()
          .toLowerCase()
          .transform((v) => v.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
          .refine((v) => v === '' || /^(?=.{3,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v), 'Enter a domain like contoso.com')
          .optional(),
      }),
      req.body ?? {},
    );
    const opp = await deps.db.withUser(uid, (tx) => getOpportunity(tx, uid, id));
    if (!opp) throw notFound('Job');
    const found = await findPeopleAtCompany(deps, { company: opp.company, domain: body.domain || null, group: body.group });
    const people = await deps.db.withUser(uid, async (tx) =>
      Promise.all(found.people.map(async (p) => ({ ...p, recruiter_id: (await findActiveByEmail(tx, uid, p.email))?.id ?? null }))),
    );
    res.json({ ...found, people });
  });
  r.post('/jobs/:id/people', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const person = z.object({
      email: z.string().trim().toLowerCase().email().max(254),
      first_name: z.string().trim().max(80).nullish().transform((v) => v || null),
      last_name: z.string().trim().max(80).nullish().transform((v) => v || null),
      position: z.string().trim().max(160).nullish().transform((v) => v || null),
      linkedin: z.string().trim().max(300).nullish().transform((v) => v || null),
      source_url: z.string().trim().max(2048).regex(/^https?:\/\/\S+$/i).nullish().transform((v) => v || null),
    });
    const { people } = parse(z.object({ people: z.array(person).min(1).max(50) }), req.body ?? {});
    res.json(await deps.db.withUser(uid, (tx) => addFoundPeopleToJob(deps, tx, uid, id, people)));
  });

  /** Write (or reuse) the email for one recruiter on this job. Never sends. */
  r.post('/jobs/:id/recruiters/:recruiterId/email', limiters.ai, async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const recruiterId = idParam(req, 'recruiterId');
    const opts = parse(z.object({ regenerate: z.boolean().default(false), use_template: z.boolean().default(false) }), req.body ?? {});
    res.json(await prepareJobEmail(deps, uid, id, recruiterId, opts));
  });

  return r;
}
