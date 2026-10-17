import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { ensureAuthShim, runMigrations } from '../../src/db/migrate.js';

/**
 * Creates a fresh database on the shared test server for one test file.
 * `migrate: false` returns an empty database with only the auth shim (used by
 * the migration tests to seed v1 data first).
 */
export async function createTestDatabase(opts: { migrate?: boolean } = {}): Promise<{ url: string; drop: () => Promise<void> }> {
  const base = inject('pgBaseUrl');
  const name = `autoreach_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: `${base}/postgres` });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = `${base}/${name}`;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await ensureAuthShim(client);
  if (opts.migrate !== false) await runMigrations(client);
  await client.end();
  return {
    url,
    drop: async () => {
      const a = new pg.Client({ connectionString: `${base}/postgres` });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}

export async function createAuthUser(url: string, email: string, meta: Record<string, unknown> = {}): Promise<string> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query<{ id: string }>(
    'INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, $2) RETURNING id',
    [email, JSON.stringify(meta)],
  );
  await client.end();
  return rows[0]!.id;
}
