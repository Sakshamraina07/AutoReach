import { Router } from 'express';
import multer from 'multer';
import {
  analyticsRangeSchema,
  campaignCreateSchema,
  profileCompleteness,
  profilePatchSchema,
  profileUpdateSchema,
  resumeExtractSchema,
  resumeUpdateSchema,
  settingsUpdateSchema,
  templateTypeParam,
  templateUpdateSchema,
  TEMPLATE_TYPES,
  type MeResponse,
} from '@autoreach/shared';
import { z } from 'zod';
import type { Deps } from '../../context.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { exportAccount, deleteAccount } from '../../services/account.js';
import { listActivity } from '../../services/activity.js';
import * as analytics from '../../services/analytics.js';
import { listCompanies } from '../../services/companies.js';
import { connectionStatus } from '../../services/gmail/connection.js';
import { sentToday } from '../../services/messages.js';
import { getProfile, saveProfile } from '../../services/profile.js';
import { extractProfileFromText } from '../../services/resumeParser.js';
import { deleteResume, getResumeFile, getResumeText, listResumes, MAX_RESUME_BYTES, updateResume, uploadResume } from '../../services/resumes.js';
import { getSettings, updateSettings } from '../../services/settings.js';
import { deleteAllTrackingData } from '../../services/tracking.js';
import { idParam, parse, userId } from '../support.js';

const resumeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RESUME_BYTES, files: 1, fields: 10 } });

export function coreRoutes(deps: Deps): Router {
  const r = Router();

  r.get('/me', async (req, res) => {
    const uid = userId(req);
    const body = await deps.db.withUser(uid, async (tx): Promise<MeResponse> => {
      // Sequential on purpose: one transaction = one connection.
      const profile = await getProfile(tx, uid);
      const settings = await getSettings(tx, uid);
      const gmail = await connectionStatus(deps, tx, uid);
      const resumes = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM resumes WHERE user_id = $1`, [uid]);
      const completeness = profileCompleteness(profile, { hasResume: resumes.n > 0, gmailConnected: gmail.connected });
      return {
        user: { id: uid, email: req.user?.email ?? null },
        profile,
        settings,
        gmail,
        ai: { configured: !!deps.ai, provider: deps.ai?.name ?? null, model: deps.ai?.model ?? null },
        tracking: { configured: deps.config.tracking.configured, public_base_url: deps.config.tracking.configured ? deps.config.apiPublicUrl : null },
        completeness: { percent: completeness.percent, items: completeness.items.map(({ key, label, done }) => ({ key, label, done })) },
        onboarding_completed: !!profile?.onboarding_completed_at,
        sent_today: await sentToday(tx, uid, settings.timezone, deps.now()),
      };
    });
    res.json(body);
  });

  /* ---------------- Profile ---------------- */
  r.get('/profile', async (req, res) => {
    const uid = userId(req);
    res.json(await deps.db.withUser(uid, (tx) => getProfile(tx, uid)));
  });
  r.put('/profile', async (req, res) => {
    const uid = userId(req);
    const body = parse(profileUpdateSchema, req.body);
    res.json(await deps.db.withUser(uid, (tx) => saveProfile(tx, uid, body)));
  });
  r.patch('/profile', async (req, res) => {
    const uid = userId(req);
    const body = parse(profilePatchSchema, req.body);
    res.json(await deps.db.withUser(uid, (tx) => saveProfile(tx, uid, body)));
  });
  r.post('/profile/complete-onboarding', async (req, res) => {
    const uid = userId(req);
    const profile = await deps.db.withUser(uid, async (tx) => {
      const p = await getProfile(tx, uid);
      if (!p?.full_name) throw badRequest('Add your name before finishing onboarding.', undefined, 'PROFILE_INCOMPLETE');
      return saveProfile(tx, uid, {}, { completeOnboarding: true });
    });
    res.json(profile);
  });
  r.post('/profile/extract', async (req, res) => {
    const uid = userId(req);
    const body = parse(resumeExtractSchema, req.body);
    let text = body.pasted_text ?? '';
    if (!text && body.resume_id) {
      text = (await deps.db.withUser(uid, (tx) => getResumeText(tx, uid, body.resume_id!))) ?? '';
    }
    if (!text.trim()) throw badRequest('Paste your résumé text or choose an uploaded résumé with readable text.', undefined, 'NO_RESUME_TEXT');
    res.json(await extractProfileFromText(deps, text));
  });

  /* ---------------- Settings ---------------- */
  r.get('/settings', async (req, res) => {
    const uid = userId(req);
    res.json(await deps.db.withUser(uid, (tx) => getSettings(tx, uid)));
  });
  r.patch('/settings', async (req, res) => {
    const uid = userId(req);
    const body = parse(settingsUpdateSchema, req.body);
    if (body.tracking_enabled === true && !deps.config.tracking.configured) {
      throw conflict('TRACKING_NOT_AVAILABLE', deps.config.tracking.reason ?? 'Open tracking is not available on this server.');
    }
    res.json(await deps.db.withUser(uid, (tx) => updateSettings(tx, uid, body)));
  });

  /* ---------------- Résumés ---------------- */
  r.get('/resumes', async (req, res) => {
    const uid = userId(req);
    res.json(await deps.db.withUser(uid, (tx) => listResumes(tx, uid)));
  });
  r.post('/resumes', resumeUpload.single('file'), async (req, res) => {
    const uid = userId(req);
    if (!req.file) throw badRequest('Choose a PDF file to upload.', undefined, 'NO_FILE');
    const meta = parse(
      z.object({
        label: z.string().trim().min(1).max(80).optional(),
        role_tags: z
          .string()
          .optional()
          .transform((v) => (v ? v.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20) : [])),
        make_default: z
          .enum(['true', 'false'])
          .optional()
          .transform((v) => v === 'true'),
      }),
      req.body ?? {},
    );
    const file = req.file;
    const row = await deps.db.withUser(uid, (tx) =>
      uploadResume(tx, deps.storage, uid, { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype, size: file.size }, meta),
    );
    res.status(201).json(row);
  });
  r.patch('/resumes/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const body = parse(resumeUpdateSchema, req.body);
    res.json(await deps.db.withUser(uid, (tx) => updateResume(tx, uid, id, body)));
  });
  r.delete('/resumes/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    await deps.db.withUser(uid, (tx) => deleteResume(tx, deps.storage, uid, id));
    res.status(204).end();
  });
  r.get('/resumes/:id/file', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const file = await deps.db.withUser(uid, (tx) => getResumeFile(tx, deps.storage, uid, id));
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${file.file_name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.data);
  });

  /* ---------------- Templates ---------------- */
  r.get('/templates', async (req, res) => {
    const uid = userId(req);
    const rows = await deps.db.withUser(uid, (tx) =>
      tx.many<{ type: string; subject: string | null; body: string | null; updated_at: string | null }>(`SELECT type, subject, body, updated_at FROM email_templates WHERE user_id = $1`, [uid]),
    );
    res.json(TEMPLATE_TYPES.map((type) => {
      const row = rows.find((x) => x.type === type);
      return { type, subject: row?.subject ?? '', body: row?.body ?? '', updated_at: row?.updated_at ?? null };
    }));
  });
  r.put('/templates/:type', async (req, res) => {
    const uid = userId(req);
    const type = parse(templateTypeParam, req.params.type);
    const body = parse(templateUpdateSchema, req.body);
    const row = await deps.db.withUser(uid, (tx) =>
      tx.one(
        `INSERT INTO email_templates (user_id, type, subject, body) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, type) DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body
         RETURNING type, subject, body, updated_at`,
        [uid, type, body.subject, body.body],
      ),
    );
    res.json(row);
  });

  /* ---------------- Companies & campaigns ---------------- */
  r.get('/companies', async (req, res) => {
    const uid = userId(req);
    res.json(await deps.db.withUser(uid, (tx) => listCompanies(tx, uid)));
  });
  r.get('/campaigns', async (req, res) => {
    const uid = userId(req);
    res.json(
      await deps.db.withUser(uid, (tx) =>
        tx.many(
          `SELECT c.id, c.name, c.description, c.created_at,
             (SELECT count(*)::int FROM email_messages m WHERE m.campaign_id = c.id AND m.send_status = 'sent') AS sent
           FROM campaigns c WHERE c.user_id = $1 ORDER BY c.created_at DESC`,
          [uid],
        ),
      ),
    );
  });
  r.post('/campaigns', async (req, res) => {
    const uid = userId(req);
    const body = parse(campaignCreateSchema, req.body);
    const row = await deps.db.withUser(uid, async (tx) => {
      const existing = await tx.maybeOne(`SELECT 1 FROM campaigns WHERE user_id = $1 AND name = $2`, [uid, body.name]);
      if (existing) throw conflict('DUPLICATE_CAMPAIGN', 'A campaign with this name already exists.');
      return tx.one(`INSERT INTO campaigns (user_id, name, description) VALUES ($1,$2,$3) RETURNING id, name, description, created_at`, [uid, body.name, body.description ?? null]);
    });
    res.status(201).json(row);
  });
  r.delete('/campaigns/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const result = await deps.db.withUser(uid, (tx) => tx.query(`DELETE FROM campaigns WHERE user_id = $1 AND id = $2`, [uid, id]));
    if (!result.rowCount) throw notFound('Campaign');
    res.status(204).end();
  });

  /* ---------------- Analytics & activity ---------------- */
  r.get('/analytics/overview', async (req, res) => {
    const uid = userId(req);
    const { range } = parse(analyticsRangeSchema, req.query);
    res.json(await deps.db.withUser(uid, (tx) => analytics.overview(tx, uid, range, deps.now())));
  });
  r.get('/analytics/timeseries', async (req, res) => {
    const uid = userId(req);
    const { range } = parse(analyticsRangeSchema, req.query);
    res.json(
      await deps.db.withUser(uid, async (tx) => {
        const s = await getSettings(tx, uid);
        return analytics.timeseries(tx, uid, range, s.timezone, deps.now());
      }),
    );
  });
  r.get('/analytics/breakdown', async (req, res) => {
    const uid = userId(req);
    const q = parse(analyticsRangeSchema.extend({ by: z.enum(['role_category', 'company', 'campaign']).default('role_category') }), req.query);
    res.json({ by: q.by, small_sample_threshold: analytics.SMALL_SAMPLE, rows: await deps.db.withUser(uid, (tx) => analytics.breakdown(tx, uid, q.by, q.range, deps.now())) });
  });
  r.get('/analytics/insights', async (req, res) => {
    const uid = userId(req);
    const { range } = parse(analyticsRangeSchema, req.query);
    res.json(await deps.db.withUser(uid, (tx) => analytics.insights(tx, uid, range, deps.now())));
  });
  r.get('/analytics/recommendations', async (req, res) => {
    const uid = userId(req);
    res.json(await deps.db.withUser(uid, (tx) => analytics.recommendations(tx, uid, deps.now())));
  });
  r.get('/activity', async (req, res) => {
    const uid = userId(req);
    const q = parse(
      z.object({
        page: z.coerce.number().int().min(1).default(1),
        page_size: z.coerce.number().int().min(1).max(100).default(20),
        recruiter_id: z.uuid().optional(),
        opportunity_id: z.uuid().optional(),
      }),
      req.query,
    );
    res.json(await deps.db.withUser(uid, (tx) => listActivity(tx, uid, { page: q.page, pageSize: q.page_size, recruiterId: q.recruiter_id, opportunityId: q.opportunity_id })));
  });

  /* ---------------- Privacy ---------------- */
  r.post('/tracking/delete-all', async (req, res) => {
    const uid = userId(req);
    res.json(await deps.db.withUser(uid, (tx) => deleteAllTrackingData(tx, uid)));
  });
  r.get('/account/export', async (req, res) => {
    const uid = userId(req);
    const data = await exportAccount(deps, uid);
    res.setHeader('Content-Disposition', `attachment; filename="autoreach-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(data);
  });
  r.delete('/account', async (req, res) => {
    const uid = userId(req);
    const { confirm } = parse(z.object({ confirm: z.literal('DELETE MY ACCOUNT') }), req.body);
    void confirm;
    res.json(await deleteAccount(deps, uid));
  });

  return r;
}
