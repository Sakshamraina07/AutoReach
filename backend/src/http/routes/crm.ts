import { Router } from 'express';
import multer from 'multer';
import {
  csvImportOptionsSchema,
  emailField,
  linkRecruitersSchema,
  opportunityCreateSchema,
  opportunityListQuerySchema,
  opportunityUpdateSchema,
  recruiterCreateSchema,
  recruiterListQuerySchema,
  recruiterLookupSchema,
  recruiterMergeSchema,
  recruiterUpdateSchema,
  selfViewSchema,
} from '@autoreach/shared';
import { z } from 'zod';
import type { Deps } from '../../context.js';
import { badRequest } from '../../errors.js';
import { explainRoleMatch } from '../../services/drafting.js';
import { suggestEmails } from '../../services/discovery.js';
import * as opps from '../../services/opportunities.js';
import * as recs from '../../services/recruiters.js';
import { idParam, parse, userId } from '../support.js';

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 5 } });

export function crmRoutes(deps: Deps): Router {
  const r = Router();

  /* ---------------- Recruiters ---------------- */
  r.get('/recruiters', async (req, res) => {
    const uid = userId(req);
    const q = parse(recruiterListQuerySchema, req.query);
    res.json(await deps.db.withUser(uid, (tx) => recs.listRecruiters(tx, uid, q)));
  });
  r.post('/recruiters', async (req, res) => {
    const uid = userId(req);
    const body = parse(recruiterCreateSchema, req.body);
    res.status(201).json(await deps.db.withUser(uid, (tx) => recs.createRecruiter(tx, uid, body)));
  });
  r.get('/recruiters/duplicates', async (req, res) => {
    const uid = userId(req);
    res.json(await deps.db.withUser(uid, (tx) => recs.duplicateSuggestions(tx, uid)));
  });
  r.get('/recruiters/export', async (req, res) => {
    const uid = userId(req);
    const csv = await deps.db.withUser(uid, (tx) => recs.exportRecruitersCsv(tx, uid));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="autoreach-recruiters-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(`\uFEFF${csv}`); // BOM so Excel opens UTF-8 correctly
  });
  r.post('/recruiters/import', csvUpload.single('file'), async (req, res) => {
    const uid = userId(req);
    if (!req.file) throw badRequest('Choose a CSV file to import.', undefined, 'NO_FILE');
    const opts = parse(csvImportOptionsSchema, req.body ?? {});
    const text = req.file.buffer.toString('utf8');
    res.json(await deps.db.withUser(uid, (tx) => recs.importRecruitersCsv(tx, uid, text, { dryRun: opts.dry_run, defaultTags: opts.default_tags })));
  });
  r.post('/recruiters/lookup', async (req, res) => {
    const uid = userId(req);
    const { emails } = parse(recruiterLookupSchema, req.body);
    res.json(await deps.db.withUser(uid, (tx) => recs.lookupByEmails(tx, uid, emails)));
  });
  r.post('/recruiters/self-view', async (req, res) => {
    const uid = userId(req);
    const { emails } = parse(selfViewSchema, req.body);
    await deps.db.withUser(uid, (tx) => recs.markSelfView(tx, uid, emails));
    res.status(204).end();
  });
  r.get('/recruiters/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    res.json(await deps.db.withUser(uid, (tx) => recs.getRecruiterDetail(tx, uid, id)));
  });
  r.patch('/recruiters/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const body = parse(recruiterUpdateSchema, req.body);
    res.json(await deps.db.withUser(uid, (tx) => recs.updateRecruiter(tx, uid, id, body)));
  });
  r.delete('/recruiters/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    await deps.db.withUser(uid, (tx) => recs.deleteRecruiter(tx, uid, id));
    res.status(204).end();
  });
  r.post('/recruiters/:id/merge', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const { source_id } = parse(recruiterMergeSchema, req.body);
    res.json(await deps.db.withUser(uid, (tx) => recs.mergeRecruiters(tx, uid, id, source_id)));
  });
  r.post('/recruiters/:id/opportunities', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const { opportunity_id } = parse(z.object({ opportunity_id: z.uuid() }), req.body);
    await deps.db.withUser(uid, (tx) => recs.linkRecruiterToOpportunity(tx, uid, id, opportunity_id));
    res.status(204).end();
  });
  r.delete('/recruiters/:id/opportunities/:oppId', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const oppId = idParam(req, 'oppId');
    await deps.db.withUser(uid, (tx) => recs.unlinkRecruiterFromOpportunity(tx, uid, id, oppId));
    res.status(204).end();
  });

  /* ---------------- Contact discovery (optional, never auto-saves) ---------------- */
  r.post('/discovery/email-suggestions', async (req, res) => {
    userId(req);
    const body = parse(
      z.object({
        full_name: z.string().trim().min(2).max(120),
        company: z.string().trim().max(160).optional(),
        domain: z
          .string()
          .trim()
          .max(253)
          .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)
          .optional(),
        known_email: emailField.optional(),
      }),
      req.body,
    );
    res.json(await suggestEmails(deps, body));
  });

  /* ---------------- Opportunities ---------------- */
  r.get('/opportunities', async (req, res) => {
    const uid = userId(req);
    const q = parse(opportunityListQuerySchema, req.query);
    res.json(await deps.db.withUser(uid, (tx) => opps.listOpportunities(tx, uid, q)));
  });
  r.post('/opportunities', async (req, res) => {
    const uid = userId(req);
    const body = parse(opportunityCreateSchema, req.body);
    res.status(201).json(await deps.db.withUser(uid, (tx) => opps.createOpportunity(tx, uid, body)));
  });
  r.get('/opportunities/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    res.json(await deps.db.withUser(uid, (tx) => opps.getOpportunityDetail(tx, uid, id)));
  });
  r.patch('/opportunities/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const body = parse(opportunityUpdateSchema, req.body);
    res.json(await deps.db.withUser(uid, (tx) => opps.updateOpportunity(tx, uid, id, body)));
  });
  r.delete('/opportunities/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    await deps.db.withUser(uid, (tx) => opps.deleteOpportunity(tx, uid, id));
    res.status(204).end();
  });
  r.post('/opportunities/:id/recruiters', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const { recruiter_ids } = parse(linkRecruitersSchema, req.body);
    await deps.db.withUser(uid, async (tx) => {
      for (const rid of recruiter_ids) await recs.linkRecruiterToOpportunity(tx, uid, rid, id);
    });
    res.status(204).end();
  });
  r.get('/opportunities/:id/match', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    res.json(await deps.db.withUser(uid, (tx) => explainRoleMatch(deps, tx, uid, id)));
  });

  return r;
}
