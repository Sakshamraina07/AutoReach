import { Router, type RequestHandler } from 'express';
import {
  aiDraftSchema,
  aiRefineSchema,
  draftCreateSchema,
  draftUpdateSchema,
  followUpListQuerySchema,
  followUpUpdateSchema,
  gmailAuthorizeSchema,
  messageListQuerySchema,
  qualityCheckSchema,
  replyCorrectionSchema,
  resolveUnknownSchema,
  sendRequestSchema,
} from '@autoreach/shared';
import { z } from 'zod';
import type { Deps } from '../../context.js';
import { badRequest, conflict } from '../../errors.js';
import { buildDraftContext, generateDraft, qualityFor, refineDraft } from '../../services/drafting.js';
import { getFollowUp, listFollowUps, updateFollowUp } from '../../services/followups.js';
import { connectionStatus, createAuthorization, disconnect } from '../../services/gmail/connection.js';
import * as messages from '../../services/messages.js';
import { syncUserReplies } from '../../services/replySync.js';
import { getSettings } from '../../services/settings.js';
import { idParam, parse, userId } from '../support.js';

export function outreachRoutes(deps: Deps, limiters: { ai: RequestHandler; send: RequestHandler; sync: RequestHandler }): Router {
  const r = Router();

  /* ---------------- Messages ---------------- */
  r.get('/messages', async (req, res) => {
    const uid = userId(req);
    const q = parse(messageListQuerySchema, req.query);
    res.json(await deps.db.withUser(uid, (tx) => messages.listMessages(tx, uid, q)));
  });
  r.post('/messages', async (req, res) => {
    const uid = userId(req);
    const body = parse(draftCreateSchema.extend({ follow_up_of_message_id: z.uuid().nullish() }), req.body);
    res.status(201).json(await deps.db.withUser(uid, (tx) => messages.createDraft(deps, tx, uid, body)));
  });
  r.post('/messages/quality-check', async (req, res) => {
    const uid = userId(req);
    const body = parse(qualityCheckSchema, req.body);
    const findings = await deps.db.withUser(uid, async (tx) => {
      const ctx = await buildDraftContext(deps, tx, uid, { ...body, kind: body.kind });
      return qualityFor(ctx, body.kind, body.subject, body.body_text, !!ctx.resume);
    });
    res.json({ findings });
  });
  r.get('/messages/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    res.json(await deps.db.withUser(uid, (tx) => messages.getMessageDetail(tx, uid, id)));
  });
  r.patch('/messages/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const body = parse(draftUpdateSchema, req.body);
    res.json(
      await deps.db.withUser(uid, async (tx) => {
        await messages.updateDraft(tx, uid, id, body);
        return messages.getMessageDetail(tx, uid, id);
      }),
    );
  });
  r.delete('/messages/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    await deps.db.withUser(uid, (tx) => messages.deleteDraft(tx, uid, id));
    res.status(204).end();
  });
  r.post('/messages/:id/send', limiters.send, async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const key = String(req.headers['idempotency-key'] ?? '');
    const body = parse(sendRequestSchema, req.body ?? {});
    res.json(await messages.sendMessage(deps, uid, id, key, body));
  });
  r.post('/messages/:id/cancel', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    res.json(
      await deps.db.withUser(uid, async (tx) => {
        await messages.cancelQueued(tx, uid, id);
        return messages.getMessageDetail(tx, uid, id);
      }),
    );
  });
  r.post('/messages/:id/resolve', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const { outcome } = parse(resolveUnknownSchema, req.body);
    res.json(await deps.db.withUser(uid, (tx) => messages.resolveUnknown(deps, tx, uid, id, outcome)));
  });
  r.patch('/messages/:id/reply-status', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const body = parse(replyCorrectionSchema, req.body);
    res.json(await deps.db.withUser(uid, (tx) => messages.correctReplyStatus(tx, uid, id, body.reply_status, body.replied_at)));
  });

  /* ---------------- AI drafting ---------------- */
  r.post('/ai/draft', limiters.ai, async (req, res) => {
    const uid = userId(req);
    const body = parse(aiDraftSchema, req.body);
    res.json(await deps.db.withUser(uid, (tx) => generateDraft(deps, tx, uid, body)));
  });
  r.post('/ai/refine', limiters.ai, async (req, res) => {
    const uid = userId(req);
    const body = parse(aiRefineSchema, req.body);
    res.json(await deps.db.withUser(uid, (tx) => refineDraft(deps, tx, uid, body)));
  });

  /* ---------------- Follow-ups ---------------- */
  r.get('/followups', async (req, res) => {
    const uid = userId(req);
    const q = parse(followUpListQuerySchema, req.query);
    res.json(
      await deps.db.withUser(uid, async (tx) => {
        const s = await getSettings(tx, uid);
        return listFollowUps(tx, uid, q.view, q.page, q.page_size, s.timezone, deps.now());
      }),
    );
  });
  r.patch('/followups/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const body = parse(followUpUpdateSchema, req.body);
    res.json(
      await deps.db.withUser(uid, async (tx) => {
        const s = await getSettings(tx, uid);
        return updateFollowUp(tx, uid, id, body, s.timezone, deps.now());
      }),
    );
  });
  /** Create (or reuse) the draft for a reminder, pre-filled with a contextual follow-up. */
  r.post('/followups/:id/draft', limiters.ai, async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const opts = parse(z.object({ use_template: z.boolean().default(false) }), req.body ?? {});
    const result = await deps.db.withUser(uid, async (tx) => {
      // Serialise concurrent requests (double click, React strict-mode effects) so only one draft is created.
      await tx.query(`SELECT 1 FROM follow_ups WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, uid]);
      const s = await getSettings(tx, uid);
      const fu = await getFollowUp(tx, uid, id, s.timezone, deps.now());
      if (fu.status !== 'pending') throw conflict('FOLLOWUP_CLOSED', 'This follow-up is no longer pending.');
      if (fu.draft_message_id) return { message: await messages.getMessageDetail(tx, uid, fu.draft_message_id), draft: null };
      const prev = await tx.one<{ opportunity_id: string | null; resume_id: string | null; manual_role: string | null }>(
        `SELECT opportunity_id, resume_id, manual_role FROM email_messages WHERE id = $1 AND user_id = $2`,
        [fu.previous_message_id, uid],
      );
      const draft = await generateDraft(deps, tx, uid, {
        recruiter_id: fu.recruiter_id,
        opportunity_id: prev.opportunity_id,
        manual_role: prev.manual_role,
        resume_id: prev.resume_id,
        kind: 'follow_up',
        goal: 'interview_consideration',
        use_template: opts.use_template,
        follow_up_of_message_id: fu.previous_message_id,
      });
      const message = await messages.createDraft(deps, tx, uid, {
        recruiter_id: fu.recruiter_id,
        opportunity_id: prev.opportunity_id,
        resume_id: prev.resume_id,
        follow_up_id: fu.id,
        subject: draft.subject,
        body_text: draft.body_text,
        manual_role: prev.manual_role,
        ai_generated: draft.source === 'ai',
        generation_meta: { source: draft.source, provider: draft.provider, model: draft.model, facts_used: draft.facts_used },
      });
      return { message, draft };
    });
    res.json(result);
  });

  /* ---------------- Reply review queue ---------------- */
  r.get('/review-queue', async (req, res) => {
    const uid = userId(req);
    res.json(
      await deps.db.withUser(uid, (tx) =>
        tx.many(
          `SELECT tm.id, tm.from_email, tm.from_name, tm.subject, tm.received_at, tm.classification, tm.matched_message_id,
             m.subject AS original_subject, m.recipient_email, r.full_name AS recruiter_name, t.gmail_thread_id
           FROM thread_messages tm
           JOIN email_threads t ON t.id = tm.thread_id
           LEFT JOIN email_messages m ON m.id = tm.matched_message_id
           LEFT JOIN recruiters r ON r.id = t.recruiter_id
           WHERE tm.user_id = $1 AND tm.needs_review ORDER BY tm.received_at DESC LIMIT 100`,
          [uid],
        ),
      ),
    );
  });
  r.post('/review-queue/:id', async (req, res) => {
    const uid = userId(req);
    const id = idParam(req);
    const { decision } = parse(z.object({ decision: z.enum(['is_reply', 'not_reply']) }), req.body);
    const out = await deps.db.withUser(uid, async (tx) => {
      const tm = await tx.maybeOne<{ matched_message_id: string | null; received_at: string }>(
        `SELECT matched_message_id, received_at FROM thread_messages WHERE user_id = $1 AND id = $2 AND needs_review`,
        [uid, id],
      );
      if (!tm) throw badRequest('This item was already reviewed.', undefined, 'ALREADY_REVIEWED');
      await tx.query(`UPDATE thread_messages SET needs_review = false, reviewed_at = now(), classification = CASE WHEN $3 THEN 'reply' ELSE 'other_sender' END WHERE user_id = $1 AND id = $2`, [
        uid,
        id,
        decision === 'is_reply',
      ]);
      if (!tm.matched_message_id) return null;
      if (decision === 'is_reply') return messages.correctReplyStatus(tx, uid, tm.matched_message_id, 'replied', new Date(tm.received_at).toISOString());
      const stillPending = await tx.maybeOne(`SELECT 1 FROM thread_messages WHERE user_id = $1 AND matched_message_id = $2 AND needs_review`, [uid, tm.matched_message_id]);
      if (!stillPending) {
        await tx.query(`UPDATE email_messages SET reply_status = 'none' WHERE user_id = $1 AND id = $2 AND reply_status = 'needs_review'`, [uid, tm.matched_message_id]);
      }
      return messages.getMessageDetail(tx, uid, tm.matched_message_id);
    });
    res.json({ message: out });
  });

  /* ---------------- Gmail integration ---------------- */
  r.get('/integrations/gmail', async (req, res) => {
    const uid = userId(req);
    res.json(await deps.db.withUser(uid, (tx) => connectionStatus(deps, tx, uid)));
  });
  r.post('/integrations/gmail/authorize', async (req, res) => {
    const uid = userId(req);
    const { return_to } = parse(gmailAuthorizeSchema, req.body ?? {});
    res.json(await deps.db.withUser(uid, (tx) => createAuthorization(deps, tx, uid, return_to, req.user?.email)));
  });
  r.delete('/integrations/gmail', async (req, res) => {
    const uid = userId(req);
    await disconnect(deps, uid);
    res.status(204).end();
  });
  r.post('/integrations/gmail/sync', limiters.sync, async (req, res) => {
    const uid = userId(req);
    res.json(await syncUserReplies(deps, uid));
  });

  return r;
}
