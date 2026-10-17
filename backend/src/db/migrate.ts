import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_DIR = path.resolve(here, '../../../supabase/migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  changedSinceApplied: string[];
}

/**
 * Minimal local stand-in for Supabase's `auth.users`, used ONLY for local
 * development and tests against a plain PostgreSQL server. Never created when
 * the schema already exists (i.e. on Supabase).
 */
export async function ensureAuthShim(client: pg.ClientBase): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(`SELECT to_regclass('auth.users') IS NOT NULL AS exists`);
  if (rows[0]?.exists) return false;
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  return true;
}

export async function runMigrations(
  client: pg.ClientBase,
  opts: { dir?: string; log?: (msg: string) => void } = {},
): Promise<MigrationResult> {
  const dir = opts.dir ?? DEFAULT_MIGRATIONS_DIR;
  const log = opts.log ?? (() => {});
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.autoreach_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Not user data: keep it away from PostgREST's public roles on Supabase.
  await client.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON public.autoreach_migrations FROM anon, authenticated;
      END IF;
    END $$;
  `);

  const { rows } = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM public.autoreach_migrations');
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));
  const result: MigrationResult = { applied: [], skipped: [], changedSinceApplied: [] };

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = applied.get(file);
    if (previous) {
      if (previous !== checksum) result.changedSinceApplied.push(file);
      result.skipped.push(file);
      continue;
    }
    log(`applying ${file}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO public.autoreach_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
      await client.query('COMMIT');
      result.applied.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
    }
  }
  return result;
}

export async function pendingMigrations(client: pg.ClientBase, dir = DEFAULT_MIGRATIONS_DIR): Promise<string[]> {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const exists = await client.query<{ t: string | null }>(`SELECT to_regclass('public.autoreach_migrations')::text AS t`);
  if (!exists.rows[0]?.t) return files;
  const { rows } = await client.query<{ name: string }>('SELECT name FROM public.autoreach_migrations');
  const done = new Set(rows.map((r) => r.name));
  return files.filter((f) => !done.has(f));
}
