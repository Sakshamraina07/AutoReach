import { createClient } from '@supabase/supabase-js';
import type { Deps } from '../context.js';
import { disconnect } from './gmail/connection.js';

const EXPORT_TABLES: Array<{ table: string; columns: string; order?: string }> = [
  { table: 'profiles', columns: '*' },
  { table: 'user_settings', columns: '*' },
  { table: 'resumes', columns: 'id, label, file_name, mime_type, size_bytes, sha256, role_tags, is_default, legacy, created_at, updated_at' },
  { table: 'companies', columns: '*', order: 'created_at' },
  { table: 'recruiters', columns: '*', order: 'created_at' },
  { table: 'opportunities', columns: '*', order: 'created_at' },
  { table: 'recruiter_opportunities', columns: '*' },
  { table: 'campaigns', columns: '*' },
  { table: 'email_templates', columns: 'type, subject, body, updated_at' },
  { table: 'email_messages', columns: '*', order: 'created_at' },
  { table: 'email_events', columns: 'id, message_id, event_type, occurred_at, classification, ua_family, counted', order: 'occurred_at' },
  { table: 'email_threads', columns: '*' },
  { table: 'thread_messages', columns: '*', order: 'received_at' },
  { table: 'follow_ups', columns: '*', order: 'created_at' },
  { table: 'activity_log', columns: '*', order: 'occurred_at' },
  { table: 'oauth_connections', columns: 'provider, account_email, scopes, status, last_sync_at, created_at' },
];

/** Everything stored about the user, except secrets (OAuth tokens are never exported). */
export async function exportAccount(deps: Deps, userId: string): Promise<Record<string, unknown>> {
  return deps.db.withUser(userId, async (tx) => {
    const out: Record<string, unknown> = {
      exported_at: deps.now().toISOString(),
      format: 'autoreach-export-v1',
      note: 'Résumé files are not embedded; download them from Settings → Résumés. OAuth tokens are never exported.',
    };
    for (const t of EXPORT_TABLES) {
      out[t.table] = await tx.many(`SELECT ${t.columns} FROM ${t.table} WHERE user_id = $1${t.order ? ` ORDER BY ${t.order}` : ''}`, [userId]);
    }
    return out;
  });
}

/**
 * Permanently delete the account: Gmail grant revoked, résumé files removed,
 * all rows deleted, and (when the service key is configured) the Supabase Auth
 * user deleted too.
 */
export async function deleteAccount(deps: Deps, userId: string): Promise<{ auth_user_deleted: boolean }> {
  await disconnect(deps, userId).catch((err) => deps.logger.warn({ err }, 'gmail disconnect during account deletion failed'));
  const paths = await deps.db.withUser(userId, async (tx) => (await tx.many<{ storage_path: string }>(`SELECT storage_path FROM resumes WHERE user_id = $1`, [userId])).map((r) => r.storage_path));
  if (paths.length) await deps.storage.remove(paths);

  await deps.db.withUser(userId, async (tx) => {
    // Children first; everything is also ON DELETE CASCADE from auth.users.
    for (const table of [
      'activity_log',
      'thread_messages',
      'email_threads',
      'email_events',
      'follow_ups',
      'email_messages',
      'recruiter_opportunities',
      'opportunities',
      'recruiters',
      'companies',
      'campaigns',
      'email_templates',
      'oauth_states',
      'oauth_connections',
      'user_smtp_settings',
      'user_settings',
      'resumes',
      'profiles',
    ]) {
      if (table === 'email_messages') await tx.query(`UPDATE email_messages SET parent_message_id = NULL, follow_up_id = NULL WHERE user_id = $1`, [userId]);
      if (table === 'recruiters') await tx.query(`UPDATE recruiters SET merged_into_id = NULL WHERE user_id = $1`, [userId]);
      await tx.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
    }
  });

  let authUserDeleted = false;
  const { url, serviceRoleKey } = deps.config.supabase;
  if (url && serviceRoleKey) {
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) deps.logger.error({ err: error.message }, 'could not delete auth user');
    else authUserDeleted = true;
  }
  return { auth_user_deleted: authUserDeleted };
}
