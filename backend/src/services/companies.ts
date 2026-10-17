import { normalizeCompanyName } from '@autoreach/shared';
import type { Tx } from '../db/pool.js';

/** Find or create the company row for a display name; returns null for blank names. */
export async function ensureCompany(tx: Tx, userId: string, name: string | null | undefined, website?: string | null): Promise<string | null> {
  const display = (name ?? '').trim();
  const normalized = normalizeCompanyName(display);
  if (!display || !normalized) return null;
  const row = await tx.one<{ id: string }>(
    `INSERT INTO companies (user_id, name, normalized_name, website)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, normalized_name)
       DO UPDATE SET website = COALESCE(companies.website, EXCLUDED.website)
     RETURNING id`,
    [userId, display, normalized, website ?? null],
  );
  return row.id;
}

/** Background maintenance: link v1 recruiters (company text only) to company rows. */
export async function backfillCompanyLinks(tx: Tx, limit = 500): Promise<number> {
  const rows = await tx.many<{ id: string; user_id: string; company: string; company_website: string | null }>(
    `SELECT id, user_id, company, company_website FROM recruiters
     WHERE company_id IS NULL AND company IS NOT NULL AND btrim(company) <> ''
     LIMIT $1`,
    [limit],
  );
  for (const r of rows) {
    const companyId = await ensureCompany(tx, r.user_id, r.company, r.company_website);
    if (companyId) await tx.query(`UPDATE recruiters SET company_id = $2 WHERE id = $1`, [r.id, companyId]);
  }
  return rows.length;
}

export async function listCompanies(tx: Tx, userId: string) {
  return tx.many(
    `SELECT c.id, c.name, c.website, c.notes,
       (SELECT count(*)::int FROM recruiters r WHERE r.company_id = c.id AND r.merged_into_id IS NULL) AS recruiter_count,
       (SELECT count(*)::int FROM opportunities o WHERE o.company_id = c.id) AS opportunity_count
     FROM companies c WHERE c.user_id = $1 ORDER BY lower(c.name)`,
    [userId],
  );
}
