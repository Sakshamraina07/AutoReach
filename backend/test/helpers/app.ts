import { randomBytes } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { signDevToken, SupabaseTokenVerifier } from '../../src/auth/verify.js';
import { loadConfig } from '../../src/config.js';
import type { Deps } from '../../src/context.js';
import { Db } from '../../src/db/pool.js';
import { encryptSecret } from '../../src/lib/crypto.js';
import { createLogger } from '../../src/logger.js';
import type { AiCompletionRequest, AiProvider } from '../../src/services/ai/provider.js';
import { MemoryFileStorage } from '../../src/storage/index.js';
import { createAuthUser, createTestDatabase } from './db.js';
import { FakeGoogle } from './fakeGoogle.js';

export class FakeAi implements AiProvider {
  readonly name = 'fake';
  readonly model = 'fake-model-1';
  calls: AiCompletionRequest[] = [];
  responses: string[] = [];
  async complete(req: AiCompletionRequest): Promise<string> {
    this.calls.push(req);
    return this.responses.shift() ?? JSON.stringify({ subject: 'Hello', body: 'Hi there,\n\nBody.\n\nThanks', facts_used: [], notes: [] });
  }
}

export interface TestEnv {
  deps: Deps;
  app: ReturnType<typeof createApp>;
  google: FakeGoogle;
  ai: FakeAi;
  storage: MemoryFileStorage;
  dbUrl: string;
  clock: { now: Date };
  newUser: (email?: string) => Promise<{ id: string; token: string; email: string }>;
  connectGmail: (userId: string, opts?: { scopes?: string[]; expired?: boolean; email?: string }) => Promise<void>;
  sql: <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;
  api: (token: string) => {
    get: (url: string) => request.Test;
    post: (url: string, body?: object) => request.Test;
    patch: (url: string, body?: object) => request.Test;
    put: (url: string, body?: object) => request.Test;
    del: (url: string, body?: object) => request.Test;
    upload: (url: string) => request.Test;
  };
  close: () => Promise<void>;
}

export async function createTestEnv(opts: { withAi?: boolean; env?: Record<string, string> } = {}): Promise<TestEnv> {
  const db = await createTestDatabase();
  const devSecret = randomBytes(24).toString('hex');
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: db.url,
    API_PUBLIC_URL: 'https://api.autoreach.test',
    DASHBOARD_URL: 'https://app.autoreach.test',
    ENABLE_DEV_LOGIN: 'true',
    DEV_JWT_SECRET: devSecret,
    STORAGE_DRIVER: 'local',
    GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    WORKERS_ENABLED: 'false',
    ...opts.env,
  });
  const google = new FakeGoogle();
  const ai = new FakeAi();
  const storage = new MemoryFileStorage();
  const clock = { now: new Date() };
  const logger = createLogger(process.env.TEST_LOG_LEVEL ?? 'silent');
  const deps: Deps = {
    config,
    db: new Db(config.database, logger),
    logger,
    storage,
    fetch: google.fetch,
    ai: opts.withAi ? ai : null,
    verifier: new SupabaseTokenVerifier(config),
    now: () => clock.now,
  };
  const app = createApp(deps);
  const pool = new pg.Pool({ connectionString: db.url, max: 3 });

  const env: TestEnv = {
    deps,
    app,
    google,
    ai,
    storage,
    dbUrl: db.url,
    clock,
    async newUser(email = `user-${randomBytes(4).toString('hex')}@example-student.dev`) {
      const id = await createAuthUser(db.url, email);
      const token = await signDevToken(devSecret, { id, email });
      return { id, token, email };
    },
    async connectGmail(userId, o = {}) {
      const key = config.tokenEncryptionKey!;
      await pool.query(
        `INSERT INTO oauth_connections (user_id, provider, account_email, scopes, access_token_enc, refresh_token_enc, token_expires_at, status)
         VALUES ($1, 'google_gmail', $2, $3, $4, $5, $6, 'active')
         ON CONFLICT (user_id, provider) DO UPDATE SET scopes = EXCLUDED.scopes, token_expires_at = EXCLUDED.token_expires_at, status = 'active'`,
        [
          userId,
          o.email ?? google.accountEmail,
          o.scopes ?? ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.metadata'],
          encryptSecret('valid-access-token', key),
          encryptSecret('valid-refresh-token', key),
          o.expired ? new Date(Date.now() - 3600_000).toISOString() : new Date(Date.now() + 3600_000).toISOString(),
        ],
      );
    },
    async sql(text, values) {
      return (await pool.query(text, values as unknown[])).rows;
    },
    api(token) {
      const auth = (t: request.Test) => t.set('Authorization', `Bearer ${token}`);
      return {
        get: (url) => auth(request(app).get(url)),
        post: (url, body) => auth(request(app).post(url)).send(body ?? {}),
        patch: (url, body) => auth(request(app).patch(url)).send(body ?? {}),
        put: (url, body) => auth(request(app).put(url)).send(body ?? {}),
        del: (url, body) => auth(request(app).delete(url)).send(body ?? {}),
        upload: (url) => auth(request(app).post(url)),
      };
    },
    async close() {
      await pool.end();
      await deps.db.close();
      await db.drop();
    },
  };
  return env;
}

/** A tiny but valid single-page PDF. */
export function makePdf(label: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${label.replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export const PROFILE = {
  full_name: 'Sam Kumar',
  degree: 'B.Tech Computer Science',
  university: 'Example Institute of Technology',
  graduation_month: 5,
  graduation_year: 2027,
  current_location: 'Pune, India',
  target_roles: ['Frontend Developer Intern', 'Full-Stack Developer'],
  job_types: ['internship', 'full_time'],
  skills: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Tailwind CSS'],
  projects: [
    {
      id: 'p1',
      name: 'CampusBoard',
      description: 'A React dashboard for college club announcements built with TypeScript.',
      technologies: ['React', 'TypeScript', 'Tailwind CSS'],
      achievements: ['Used by 120 students in the first month'],
      url: 'https://github.com/example/campusboard',
    },
    {
      id: 'p2',
      name: 'QueueLite',
      description: 'A Node.js job queue backed by PostgreSQL.',
      technologies: ['Node.js', 'PostgreSQL'],
      achievements: [],
      url: null,
    },
  ],
  links: { github: 'https://github.com/example', linkedin: null, portfolio: null, other: [] },
};
