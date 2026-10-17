import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { startPgServer } from './helpers/pgServer.js';

declare module 'vitest' {
  export interface ProvidedContext {
    pgBaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const server = await startPgServer();
  // Supabase-like cluster roles so the migration's REVOKEs are exercised.
  const client = new pg.Client({ connectionString: `${server.baseUrl}/postgres` });
  await client.connect();
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$;
  `);
  await client.end();
  project.provide('pgBaseUrl', server.baseUrl);
  return () => server.stop();
}
