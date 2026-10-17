import { startOfLocalDay } from '@autoreach/shared';
import type { Deps } from '../context.js';
import { AppError } from '../errors.js';
import { logActivity } from './activity.js';
import { buildDraftContext, templateDraft } from './drafting.js';
import { createDraft } from './messages.js';

/**
 * Optional, explicitly configured follow-up auto-send.
 *
 * Off by default. Runs only for users who (1) enabled it in Settings, (2) saved
 * their own follow-up template — auto-sent text is always the user's template,
 * never AI-generated — and (3) have not paused sending. Each run respects the
 * per-day auto-send cap; the send queue then applies spacing, the daily limit
 * and every pre-flight check again (replied / bounced / do-not-contact stop it).
 */
export async function processFollowUpAutoSend(deps: Deps): Promise<number> {
  const due = await deps.db.withSystem((tx) =>
    tx.many<{ id: string; user_id: string; recruiter_id: string; previous_message_id: string; step: number; cap: number; tz: string }>(
      `SELECT f.id, f.user_id, f.recruiter_id, f.previous_message_id, f.step, s.followup_autosend_daily_cap AS cap, s.timezone AS tz
       FROM follow_ups f
       JOIN user_settings s ON s.user_id = f.user_id
       JOIN recruiters r ON r.id = f.recruiter_id
       WHERE f.status = 'pending' AND f.auto_send AND f.due_at <= now()
         AND s.followup_autosend_enabled AND NOT s.sending_paused
         AND NOT r.do_not_contact AND r.outreach_status NOT IN ('replied', 'interviewing', 'not_interested', 'bounced', 'do_not_contact')
         AND r.last_reply_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM email_messages d WHERE d.follow_up_id = f.id AND d.send_status IN ('draft','queued','sending','sent','unknown'))
       ORDER BY f.due_at ASC LIMIT 50`,
    ),
  );
  let queued = 0;
  for (const f of due) {
    try {
      const ok = await deps.db.withUser(f.user_id, async (tx) => {
        const sentToday = await tx.one<{ n: number }>(
          `SELECT count(*)::int AS n FROM email_messages
           WHERE user_id = $1 AND kind = 'follow_up' AND (generation_meta->>'autosend')::boolean IS TRUE
             AND send_status IN ('queued','sending','sent','unknown') AND coalesce(sent_at, queued_at) >= $2`,
          [f.user_id, startOfLocalDay(f.tz, deps.now())],
        );
        if (sentToday.n >= f.cap) return false;
        const tpl = await tx.maybeOne(`SELECT 1 FROM email_templates WHERE user_id = $1 AND type = $2 AND coalesce(btrim(body), '') <> ''`, [
          f.user_id,
          f.step >= 2 ? 'followup_2' : 'followup_1',
        ]);
        const anyTpl = tpl ?? (await tx.maybeOne(`SELECT 1 FROM email_templates WHERE user_id = $1 AND type = 'followup_1' AND coalesce(btrim(body), '') <> ''`, [f.user_id]));
        if (!anyTpl) return false;
        const prev = await tx.one<{ opportunity_id: string | null; resume_id: string | null; manual_role: string | null }>(
          `SELECT opportunity_id, resume_id, manual_role FROM email_messages WHERE id = $1 AND user_id = $2`,
          [f.previous_message_id, f.user_id],
        );
        const ctx = await buildDraftContext(deps, tx, f.user_id, { recruiter_id: f.recruiter_id, opportunity_id: prev.opportunity_id, manual_role: prev.manual_role, resume_id: prev.resume_id, kind: 'follow_up' });
        const d = templateDraft(ctx, 'follow_up', f.step, !!ctx.resume);
        // Never auto-send a template with blanks; the reminder stays for the user to handle.
        if (d.missingVariables.length || !d.usedUserTemplate) return false;
        const draft = await createDraft(deps, tx, f.user_id, {
          recruiter_id: f.recruiter_id,
          opportunity_id: prev.opportunity_id,
          resume_id: prev.resume_id,
          follow_up_id: f.id,
          subject: d.subject,
          body_text: d.body,
          manual_role: prev.manual_role,
          ai_generated: false,
          generation_meta: { source: 'template', autosend: true },
        });
        await tx.query(`UPDATE email_messages SET send_status = 'queued', queued_at = now() WHERE id = $1 AND user_id = $2 AND send_status = 'draft'`, [draft.id, f.user_id]);
        await logActivity(tx, f.user_id, 'email_queued', `Auto-send queued follow-up ${f.step} to ${draft.recipient_email} (from your template)`, { recruiterId: f.recruiter_id, messageId: draft.id }, { autosend: true });
        return true;
      });
      if (ok) queued++;
    } catch (err) {
      if (!(err instanceof AppError)) deps.logger.error({ err, followUpId: f.id }, 'follow-up auto-send failed');
    }
  }
  return queued;
}
