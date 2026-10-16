import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MIGRATIONS_DIR, runMigrations } from '../src/db/migrate.js';
import { createAuthUser, createTestDatabase } from './helpers/db.js';

const BASELINE = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '20261016000000_legacy_baseline.sql'), 'utf8');
const V2 = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '20261016000100_autoreach_v2.sql'), 'utf8');

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Seed a database exactly as AutoReach v1 left it, then migrate. */
describe('v1 → v2 migration preserves data', () => {
  let db: { url: string; drop: () => Promise<void> };
  let alice: string;
  let bob: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDatabase({ migrate: false });
    alice = await createAuthUser(db.url, 'alice@gmail.com', {
      name: 'Alice Student',
      degree: 'B.Tech CSE',
      year: '2027',
      location: 'Pune, India',
      contact: '+91 90000 00000',
    });
    // v1 stored `${userId}-${timestamp}.pdf` in the user's (user-editable) metadata.
    // Bob's metadata points at Alice's file: it must not become Bob's résumé.
    const fileUrl = (owner: string) => `https://proj.supabase.co/storage/v1/object/public/resumes/${owner}-1700000000000.pdf`;
    bob = await createAuthUser(db.url, 'bob@gmail.com', { name: 'Bob', contact: 'bob.alt@gmail.com', resume_url: fileUrl(alice) });

    await withClient(db.url, async (c) => {
      await c.query(`UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object('resume_url', $2::text) WHERE id = $1`, [alice, fileUrl(alice)]);
      await c.query(BASELINE);
      const ins = async (user: string, name: string, email: string, status: string, lastSent: string | null, followups = 0, role = 'SDE Intern') => {
        const { rows } = await c.query(
          `INSERT INTO recruiters (user_id, hr_name, company, email, role, source, status, last_sent_at, followup_count, created_at)
           VALUES ($1,$2,'Northwind',$3,$4,'manual',$5,$6,$7, now() - interval '30 days' + (random() * interval '1 hour')) RETURNING id`,
          [user, name, email, role, status, lastSent, followups],
        );
        return rows[0].id as string;
      };
      ids.sent = await ins(alice, 'Meera Iyer', 'meera@northwind.io', 'Sent', new Date(Date.now() - 3 * 86400000).toISOString());
      ids.pending = await ins(alice, 'Ravi K', 'ravi@northwind.io', 'Pending', null);
      ids.failed = await ins(alice, 'Failed Person', 'fail@northwind.io', 'Failed', null);
      ids.dupOld = await ins(alice, 'Case One', 'Case.Dup@Northwind.io', 'Sent', new Date(Date.now() - 2 * 86400000).toISOString());
      // v1's unique key was case-sensitive, so this case-variant duplicate could exist.
      await c.query(`UPDATE recruiters SET created_at = now() - interval '60 days' WHERE id = $1`, [ids.dupOld]);
      ids.dupNew = await ins(alice, 'Case Two', 'case.dup@northwind.io', 'Pending', null);
      ids.bobs = await ins(bob, 'Other', 'meera@northwind.io', 'Sent', new Date().toISOString());
      // A whitespace variant of an existing address (possible under v1's plain unique key).
      ids.spaceDup = await ins(alice, 'Meera Again', ' meera@northwind.io ', 'Pending', null);
      await c.query(`UPDATE recruiters SET created_at = now() - interval '1 day' WHERE id = $1`, [ids.spaceDup]);

      const hist = async (rec: string, user: string, status: string, subject: string, opened: string | null, thread: string | null) => {
        const { rows } = await c.query(
          `INSERT INTO email_history (recruiter_id, user_id, subject, status, sent_at, opened_at, gmail_message_id, gmail_thread_id, retry_count)
           VALUES ($1,$2,$3,$4, now() - interval '3 days', $5, $6, $7, 0) RETURNING id`,
          [rec, user, subject, status, opened, thread ? `msg-${thread}` : null, thread],
        );
        return rows[0].id as string;
      };
      ids.histDelivered = await hist(ids.sent, alice, 'delivered', 'SDE Intern at Northwind', new Date(Date.now() - 2 * 86400000).toISOString(), 'thread-1');
      ids.histFailed = await hist(ids.failed, alice, 'failed', 'Hello', null, null);
      ids.histSending = await hist(ids.pending, alice, 'sending', 'Stuck', null, null);
      ids.histDup = await hist(ids.dupNew, alice, 'delivered', 'Dup mail', null, 'thread-2');
      ids.histBob = await hist(ids.bobs, bob, 'delivered', 'Bob mail', null, 'thread-3');

      await c.query(`INSERT INTO email_templates (user_id, type, subject, body) VALUES ($1,'initial','About {role}','Hi {name}')`, [alice]);
      await c.query(
        `INSERT INTO user_smtp_settings (user_id, gmail_user, gmail_access_token, gmail_refresh_token, token_expires_at)
         VALUES ($1, 'alice@gmail.com', 'plain-access', 'plain-refresh', now())`,
        [alice],
      );
    });

    await withClient(db.url, (c) => runMigrations(c));
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('keeps every recruiter row and maps statuses without re-queuing anyone', async () => {
    const rows = await withClient(db.url, (c) =>
      c.query(`SELECT id, full_name, target_role, legacy_status, outreach_status, email_normalized, merged_into_id, last_contacted_at, source FROM recruiters`),
    );
    expect(rows.rowCount).toBe(7);
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(byId[ids.sent!]).toMatchObject({ full_name: 'Meera Iyer', target_role: 'SDE Intern', legacy_status: 'Sent', outreach_status: 'contacted' });
    expect(byId[ids.sent!].last_contacted_at).not.toBeNull();
    expect(byId[ids.pending!].outreach_status).toBe('new');
    expect(byId[ids.failed!].outreach_status).toBe('new');
    // case-variant duplicate merged into the oldest row, not deleted
    expect(byId[ids.dupNew!].merged_into_id).toBe(ids.dupOld);
    expect(byId[ids.dupOld!].merged_into_id).toBeNull();
    expect(byId[ids.dupOld!].email_normalized).toBe('case.dup@northwind.io');
    // trimmed, then merged into the older row instead of aborting the migration
    expect(byId[ids.spaceDup!]).toMatchObject({ email_normalized: 'meera@northwind.io', merged_into_id: ids.sent });
  });

  it('renames email_history to email_messages and maps send outcomes honestly', async () => {
    const r = await withClient(db.url, (c) =>
      c.query(`SELECT id, recruiter_id, send_status, sent_at, failed_at, legacy, tracking_token, tracking_enabled, first_open_at, open_event_count, recipient_email, error_code FROM email_messages`),
    );
    expect(r.rowCount).toBe(5);
    const byId = Object.fromEntries(r.rows.map((x) => [x.id, x]));
    expect(byId[ids.histDelivered!]).toMatchObject({ send_status: 'sent', legacy: true, tracking_token: ids.histDelivered, open_event_count: 1, recipient_email: 'meera@northwind.io' });
    expect(byId[ids.histFailed!]).toMatchObject({ send_status: 'failed', sent_at: null, error_code: 'LEGACY_SEND_FAILED' });
    expect(byId[ids.histFailed!].failed_at).not.toBeNull();
    // An attempt interrupted mid-send in v1 is NOT claimed as sent or failed.
    expect(byId[ids.histSending!]).toMatchObject({ send_status: 'unknown', sent_at: null, error_code: 'LEGACY_OUTCOME_UNKNOWN' });
    // history of the merged duplicate now points at the surviving recruiter
    expect(byId[ids.histDup!].recruiter_id).toBe(ids.dupOld);
    const legacyTable = await withClient(db.url, (c) => c.query(`SELECT to_regclass('public.email_history') AS t`));
    expect(legacyTable.rows[0].t).toBeNull();
  });

  it('creates legacy open events, threads, reminders and activity', async () => {
    await withClient(db.url, async (c) => {
      const ev = await c.query(`SELECT message_id, classification, counted, legacy FROM email_events`);
      expect(ev.rows).toEqual([{ message_id: ids.histDelivered, classification: 'open_detected', counted: true, legacy: true }]);
      const th = await c.query(`SELECT gmail_thread_id FROM email_threads ORDER BY gmail_thread_id`);
      expect(th.rows.map((x) => x.gmail_thread_id)).toEqual(['thread-1', 'thread-2', 'thread-3']);
      const fu = await c.query(`SELECT recruiter_id, step, status FROM follow_ups WHERE user_id = $1 ORDER BY recruiter_id`, [alice]);
      expect(fu.rows.map((x) => x.recruiter_id).sort()).toEqual([ids.sent, ids.dupOld].sort());
      expect(fu.rows.every((x) => x.status === 'pending' && x.step === 1)).toBe(true);
      const act = await c.query(`SELECT count(*)::int AS n FROM activity_log WHERE metadata->>'source' = 'v1_migration'`);
      expect(act.rows[0].n).toBeGreaterThan(5);
    });
  });

  it('copies profile metadata and the résumé reference', async () => {
    await withClient(db.url, async (c) => {
      const p = await c.query(`SELECT * FROM profiles WHERE user_id = $1`, [alice]);
      expect(p.rows[0]).toMatchObject({
        full_name: 'Alice Student',
        degree: 'B.Tech CSE',
        current_location: 'Pune, India',
        phone: '+91 90000 00000',
        primary_email: 'alice@gmail.com',
        graduation_year: 2027,
        legacy_year: '2027',
      });
      const pb = await c.query(`SELECT primary_email, phone FROM profiles WHERE user_id = $1`, [bob]);
      expect(pb.rows[0]).toEqual({ primary_email: 'bob.alt@gmail.com', phone: null });
      const r = await c.query(`SELECT storage_path, is_default, legacy, file_name FROM resumes WHERE user_id = $1`, [alice]);
      expect(r.rows).toEqual([{ storage_path: `${alice}-1700000000000.pdf`, is_default: true, legacy: true, file_name: 'Resume.pdf' }]);
      const rb = await c.query(`SELECT storage_path FROM resumes WHERE user_id = $1`, [bob]);
      expect(rb.rowCount).toBe(0);
      const s = await c.query(`SELECT tracking_enabled, default_resume_id IS NOT NULL AS has_default FROM user_settings WHERE user_id = $1`, [alice]);
      expect(s.rows[0]).toEqual({ tracking_enabled: false, has_default: true });
      const t = await c.query(`SELECT subject, body FROM email_templates WHERE user_id = $1`, [alice]);
      expect(t.rows[0]).toEqual({ subject: 'About {role}', body: 'Hi {name}' });
    });
  });

  it('is idempotent when the v2 file is applied a second time', async () => {
    // Changes a user made after the upgrade must survive a re-run.
    await withClient(db.url, (c) => c.query(`DELETE FROM resumes WHERE user_id = $1`, [alice]));
    await withClient(db.url, (c) => c.query(`UPDATE follow_ups SET status = 'cancelled', cancel_reason = 'manual' WHERE recruiter_id = $1`, [ids.dupOld]));
    const before = await withClient(db.url, (c) =>
      c.query(`SELECT (SELECT count(*) FROM recruiters) r, (SELECT count(*) FROM email_messages) m, (SELECT count(*) FROM follow_ups) f, (SELECT count(*) FROM activity_log) a, (SELECT count(*) FROM email_events) e, (SELECT count(*) FROM resumes) rs, (SELECT count(*) FROM profiles) p`),
    );
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      await c.query(BASELINE);
      await c.query(V2);
      await c.query('COMMIT');
    });
    const after = await withClient(db.url, (c) =>
      c.query(`SELECT (SELECT count(*) FROM recruiters) r, (SELECT count(*) FROM email_messages) m, (SELECT count(*) FROM follow_ups) f, (SELECT count(*) FROM activity_log) a, (SELECT count(*) FROM email_events) e, (SELECT count(*) FROM resumes) rs, (SELECT count(*) FROM profiles) p`),
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    const fu = await withClient(db.url, (c) => c.query(`SELECT status FROM follow_ups WHERE recruiter_id = $1`, [ids.dupOld]));
    expect(fu.rows).toEqual([{ status: 'cancelled' }]);
  });

  it('enforces per-user isolation for the application role and locks out public roles', async () => {
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE autoreach_app');
      await c.query(`SELECT set_config('app.user_id', $1, true)`, [bob]);
      const visible = await c.query(`SELECT user_id FROM recruiters`);
      expect(visible.rows.every((r) => r.user_id === bob)).toBe(true);
      expect(visible.rowCount).toBe(1);
      const msgs = await c.query(`SELECT count(*)::int AS n FROM email_messages`);
      expect(msgs.rows[0].n).toBe(1);
      // Writing a row for someone else is rejected by the policy's WITH CHECK.
      await expect(
        c.query(`INSERT INTO recruiters (user_id, email, email_normalized) VALUES ($1, 'x@y.io', 'x@y.io')`, [alice]),
      ).rejects.toThrow(/row-level security/);
      await c.query('ROLLBACK');

      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE autoreach_app');
      // no app.user_id at all → nothing visible
      const none = await c.query(`SELECT count(*)::int AS n FROM recruiters`);
      expect(none.rows[0].n).toBe(0);
      await c.query('ROLLBACK');

      for (const role of ['anon', 'authenticated']) {
        await c.query('BEGIN');
        await c.query(`SET LOCAL ROLE ${role}`);
        await expect(c.query('SELECT 1 FROM recruiters LIMIT 1')).rejects.toThrow(/permission denied/);
        await c.query('ROLLBACK');
      }
    });
  });
});

describe('migration on a hand-made v1 schema with enum types and a unique index', () => {
  let db: { url: string; drop: () => Promise<void> };
  let user: string;

  beforeAll(async () => {
    db = await createTestDatabase({ migrate: false });
    user = await createAuthUser(db.url, 'carol@gmail.com');
    await withClient(db.url, async (c) => {
      await c.query(`
        CREATE TYPE recruiter_status AS ENUM ('Pending','Sent','Failed','Skipped');
        CREATE TYPE recruiter_source AS ENUM ('manual','csv','linkedin','company_site');
        CREATE TABLE public.recruiters (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL,
          hr_name text, company text, email text NOT NULL, role text,
          source recruiter_source DEFAULT 'manual',
          status recruiter_status NOT NULL DEFAULT 'Pending',
          last_sent_at timestamptz, followup_count int DEFAULT 0,
          created_at timestamptz DEFAULT now()
        );
        CREATE UNIQUE INDEX recruiters_user_email_idx ON public.recruiters (user_id, email);
        CREATE TABLE public.email_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, subject text, body text, updated_at timestamptz, UNIQUE (user_id, type));
        CREATE TABLE public.email_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recruiter_id uuid REFERENCES public.recruiters(id) ON DELETE CASCADE, user_id uuid, subject text, status text DEFAULT 'sending', sent_at timestamptz DEFAULT now(), opened_at timestamptz, gmail_message_id text, gmail_thread_id text, error_message text, retry_count int DEFAULT 0);
        CREATE TABLE public.user_smtp_settings (user_id uuid PRIMARY KEY, gmail_user text, gmail_access_token text, gmail_refresh_token text, token_expires_at timestamptz, updated_at timestamptz);
      `);
      await c.query(`INSERT INTO recruiters (user_id, hr_name, company, email, source, status) VALUES ($1,'A','Acme','a@acme.io','linkedin','Sent'), ($1,'B','Acme','b@acme.io','csv','Pending')`, [user]);
      await c.query(`INSERT INTO email_history (recruiter_id, user_id, subject, status) SELECT id, user_id, 'Hi', 'delivered' FROM recruiters WHERE email = 'a@acme.io'`);
      await runMigrations(c);
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('converts enum columns, drops the case-sensitive unique index and keeps history on recruiter delete', async () => {
    await withClient(db.url, async (c) => {
      const r = await c.query(`SELECT email, source, outreach_status FROM recruiters ORDER BY email`);
      expect(r.rows).toEqual([
        { email: 'a@acme.io', source: 'linkedin', outreach_status: 'contacted' },
        { email: 'b@acme.io', source: 'csv', outreach_status: 'new' },
      ]);
      const idx = await c.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'recruiters' AND indexname = 'recruiters_user_email_idx'`);
      expect(idx.rowCount).toBe(0);
      // v1 cascaded history deletes; v2 keeps the sent record when a contact is removed.
      await c.query(`DELETE FROM recruiters WHERE email = 'a@acme.io'`);
      const m = await c.query(`SELECT recruiter_id, recipient_email, send_status FROM email_messages`);
      expect(m.rows).toEqual([{ recruiter_id: null, recipient_email: 'a@acme.io', send_status: 'sent' }]);
    });
  });
});
