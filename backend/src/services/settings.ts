import type { SettingsUpdate, UserSettings } from '@autoreach/shared';
import type { Tx } from '../db/pool.js';
import { badRequest } from '../errors.js';
import { logActivity } from './activity.js';

const COLUMNS = `timezone, tracking_enabled, tracking_retention_days, followup_delay_business_days, max_followups,
  followup_autosend_enabled, followup_autosend_daily_cap, daily_send_limit, send_spacing_min_seconds,
  send_spacing_max_seconds, sending_paused, require_resume_attachment, reply_scan_new_threads,
  default_resume_id, attachment_filename, updated_at`;

export async function getSettings(tx: Tx, userId: string): Promise<UserSettings> {
  const row = await tx.maybeOne<UserSettings>(`SELECT ${COLUMNS} FROM user_settings WHERE user_id = $1`, [userId]);
  if (row) return row;
  return tx.one<UserSettings>(
    `INSERT INTO user_settings (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING ${COLUMNS}`,
    [userId],
  );
}

export async function updateSettings(tx: Tx, userId: string, patch: SettingsUpdate): Promise<UserSettings> {
  const current = await getSettings(tx, userId);
  const next = { ...current, ...patch };
  if (next.send_spacing_min_seconds > next.send_spacing_max_seconds) {
    throw badRequest('Minimum spacing must not exceed maximum spacing.');
  }
  if (patch.default_resume_id) {
    const r = await tx.maybeOne(`SELECT 1 FROM resumes WHERE id = $1 AND user_id = $2`, [patch.default_resume_id, userId]);
    if (!r) throw badRequest('Selected résumé does not exist.');
  }
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!entries.length) return current;
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`);
  const updated = await tx.one<UserSettings>(
    `UPDATE user_settings SET ${sets.join(', ')} WHERE user_id = $1 RETURNING ${COLUMNS}`,
    [userId, ...entries.map(([, v]) => v)],
  );
  if (patch.default_resume_id !== undefined) {
    // Two statements: the one-default-per-user unique index is checked row by row.
    await tx.query(`UPDATE resumes SET is_default = false WHERE user_id = $1 AND is_default`, [userId]);
    if (patch.default_resume_id) {
      await tx.query(`UPDATE resumes SET is_default = true WHERE user_id = $1 AND id = $2`, [userId, patch.default_resume_id]);
    }
  }
  if (patch.sending_paused !== undefined && patch.sending_paused !== current.sending_paused) {
    await logActivity(tx, userId, patch.sending_paused ? 'sending_paused' : 'sending_resumed', patch.sending_paused ? 'Sending paused' : 'Sending resumed');
  }
  return updated;
}
