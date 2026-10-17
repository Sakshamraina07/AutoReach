import fs from 'node:fs';
import pg from 'pg';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';

const { Pool, types } = pg;

// Return BIGINT/COUNT(*) as JS numbers (all our counts fit comfortably).
types.setTypeParser(20, (v) => Number.parseInt(v, 10));
// Return NUMERIC as numbers (rates, averages).
types.setTypeParser(1700, (v) => Number.parseFloat(v));
// Return DATE as a plain 'YYYY-MM-DD' string (no timezone shifting).
types.setTypeParser(1082, (v) => v);
// Return TIMESTAMPTZ / TIMESTAMP as ISO-8601 UTC strings: every timestamp in the
// API and services is a string, never a Date object.
const parseTimestamptz = types.getTypeParser(1184) as (v: string) => Date;
const parseTimestamp = types.getTypeParser(1114) as (v: string) => Date;
const toIso = (parse: (v: string) => Date) => (v: string) => {
  const d = parse(v);
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : v;
};
types.setTypeParser(1184, toIso(parseTimestamptz));
types.setTypeParser(1114, toIso(parseTimestamp));

export type Queryable = Pick<pg.PoolClient, 'query'>;

export interface Tx {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
  one<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<R>;
  maybeOne<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<R | null>;
  many<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<R[]>;
  /** The user this transaction is scoped to (null for system transactions). */
  userId: string | null;
}

function wrap(client: Queryable, userId: string | null): Tx {
  return {
    userId,
    query: (text, values) => client.query(text, values as unknown[]),
    async one(text, values) {
      const r = await client.query(text, values as unknown[]);
      if (r.rows.length !== 1) throw new Error(`Expected exactly one row, got ${r.rows.length}`);
      return r.rows[0];
    },
    async maybeOne(text, values) {
      const r = await client.query(text, values as unknown[]);
      return r.rows[0] ?? null;
    },
    async many(text, values) {
      const r = await client.query(text, values as unknown[]);
      return r.rows;
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Database access.
 *
 *  withUser(userId, fn): every user-facing request. Runs in a transaction as
 *    the non-privileged role (default `autoreach_app`) with `app.user_id` set,
 *    so Row Level Security restricts every statement to that user's rows.
 *  withSystem(fn): background workers and unauthenticated endpoints (OAuth
 *    callback, tracking pixel). Callers must filter by user explicitly.
 */
export class Db {
  readonly pool: pg.Pool;

  constructor(
    private readonly cfg: AppConfig['database'],
    private readonly logger: Logger,
  ) {
    let ssl: pg.PoolConfig['ssl'] = false;
    if (cfg.ssl === 'no-verify') ssl = { rejectUnauthorized: false };
    if (cfg.ssl === 'verify') ssl = { rejectUnauthorized: true, ...(cfg.caCert ? { ca: fs.readFileSync(cfg.caCert, 'utf8') } : {}) };
    this.pool = new Pool({
      connectionString: stripSslParams(cfg.url),
      ssl,
      max: cfg.poolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'autoreach-api',
    });
    this.pool.on('error', (err) => this.logger.error({ err }, 'postgres pool error'));
  }

  async withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!UUID_RE.test(userId)) throw new Error('withUser requires a UUID user id');
    return this.transaction(userId, fn);
  }

  async withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.transaction(null, fn);
  }

  private async transaction<T>(userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (userId) {
        if (this.cfg.rlsRole) await client.query(`SET LOCAL ROLE ${quoteIdent(this.cfg.rlsRole)}`);
        await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      }
      const result = await fn(wrap(client, userId));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        this.logger.error({ err: rollbackErr }, 'rollback failed');
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /** Try to take a transaction-scoped advisory lock; returns false if another instance holds it. */
  async withAdvisoryLock<T>(key: number, fn: (tx: Tx) => Promise<T>): Promise<{ ran: boolean; result?: T }> {
    return this.withSystem(async (tx) => {
      const { rows } = await tx.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [key]);
      if (!rows[0]?.locked) return { ran: false };
      return { ran: true, result: await fn(tx) };
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Invalid role name: ${name}`);
  return `"${name}"`;
}

/** sslmode in the URL would override our explicit ssl settings in node-postgres. */
function stripSslParams(url: string): string {
  try {
    const u = new URL(url);
    for (const p of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return url;
  }
}
