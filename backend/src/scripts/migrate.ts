import 'dotenv/config';
import pg from 'pg';
import { ensureAuthShim, runMigrations } from '../db/migrate.js';

/**
 * Applies supabase/migrations/*.sql in order (each in its own transaction) and
 * records them in public.autoreach_migrations.
 *
 *   npm run db:migrate                 # uses DATABASE_URL
 *   ALLOW_AUTH_SHIM=true npm run ...   # local Postgres without Supabase: creates a minimal auth.users
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const u = new URL(url);
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
  const ssl = process.env.DATABASE_SSL === 'disable' || (local && !process.env.DATABASE_SSL) ? false : { rejectUnauthorized: process.env.DATABASE_SSL === 'verify' };
  for (const p of ['sslmode', 'sslrootcert']) u.searchParams.delete(p);
  const client = new pg.Client({ connectionString: u.toString(), ssl });
  await client.connect();
  try {
    const authExists = (await client.query<{ t: string | null }>(`SELECT to_regclass('auth.users')::text AS t`)).rows[0]?.t;
    if (!authExists) {
      if (process.env.ALLOW_AUTH_SHIM === 'true') {
        await ensureAuthShim(client);
        console.log('Created local auth.users shim (development only).');
      } else {
        console.error('auth.users does not exist. Point DATABASE_URL at your Supabase database, or set ALLOW_AUTH_SHIM=true for a local Postgres.');
        process.exit(1);
      }
    }
    const result = await runMigrations(client, { log: (m) => console.log(m) });
    console.log(`Applied: ${result.applied.length ? result.applied.join(', ') : 'none'}; already applied: ${result.skipped.length}.`);
    if (result.changedSinceApplied.length) console.warn(`Warning: these applied migrations changed on disk: ${result.changedSinceApplied.join(', ')}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
