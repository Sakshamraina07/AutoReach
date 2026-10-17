import { z } from 'zod';

/**
 * All configuration comes from environment variables and is validated once at
 * startup. Optional integrations (Gmail, AI, Hunter) are disabled — with an
 * explicit reason exposed in /readyz and in the UI — when not configured.
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const urlNoSlash = z
  .string()
  .url()
  .transform((v) => v.replace(/\/+$/, ''));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_PUBLIC_URL: urlNoSlash.default('http://localhost:3001'),
  DASHBOARD_URL: urlNoSlash.default('http://localhost:5173'),
  CORS_EXTRA_ORIGINS: optionalString,

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (Supabase: Project Settings → Database → Connection string)'),
  DATABASE_SSL: z.enum(['disable', 'no-verify', 'verify']).optional(),
  DATABASE_CA_CERT: optionalString,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DB_RLS_ROLE: z.string().default('autoreach_app'),

  SUPABASE_URL: optionalString,
  SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_JWT_SECRET: optionalString,

  STORAGE_DRIVER: z.enum(['supabase', 'local']).optional(),
  STORAGE_BUCKET: z.string().default('resumes'),
  STORAGE_LOCAL_DIR: z.string().default('.data/storage'),

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  TOKEN_ENCRYPTION_KEY: optionalString,

  AI_PROVIDER: z.enum(['none', 'anthropic', 'openai', 'openai_compatible', 'groq', 'gemini']).default('none'),
  AI_API_KEY: optionalString,
  AI_MODEL: optionalString,
  AI_BASE_URL: optionalString,
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(45000),

  HUNTER_API_KEY: optionalString,
  GMAIL_REPLY_DETECTION: bool(true),
  /** Optional: the only extension IDs allowed to receive Gmail connection codes. */
  EXTENSION_IDS: optionalString,

  /** Optional: a career-ops folder on this computer whose evaluated jobs appear in the dashboard. */
  CAREER_OPS_DIR: optionalString,
  /** The one signed-in email allowed to read CAREER_OPS_DIR (required in production). */
  CAREER_OPS_OWNER_EMAIL: optionalString,

  WORKERS_ENABLED: bool(true),
  ENABLE_DEV_LOGIN: bool(false),
  DEV_JWT_SECRET: optionalString,
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  isProd: boolean;
  port: number;
  logLevel: Env['LOG_LEVEL'];
  apiPublicUrl: string;
  dashboardUrl: string;
  corsOrigins: string[];
  trustProxyHops: number;
  database: {
    url: string;
    ssl: 'disable' | 'no-verify' | 'verify';
    caCert?: string;
    poolMax: number;
    rlsRole: string | null;
  };
  supabase: {
    url?: string;
    anonKey?: string;
    serviceRoleKey?: string;
    jwtSecret?: string;
  };
  storage: { driver: 'supabase' | 'local'; bucket: string; localDir: string };
  gmail: {
    configured: boolean;
    clientId?: string;
    clientSecret?: string;
    redirectUri: string;
    reason?: string;
    /** Whether to request gmail.metadata and run reply detection. */
    replyDetection: boolean;
    /** Extension IDs allowed as the Gmail connection redirect; empty = any well-formed ID. */
    extensionIds: string[];
  };
  tokenEncryptionKey?: Buffer;
  ai: {
    provider: Exclude<Env['AI_PROVIDER'], 'none'> | null;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    timeoutMs: number;
    reason?: string;
  };
  hunterApiKey?: string;
  tracking: { configured: boolean; reason?: string };
  careerOps: { dir: string | undefined; ownerEmail: string | undefined };
  workersEnabled: boolean;
  devLogin: { enabled: boolean; secret?: string };
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

function decodeKey(raw: string | undefined, problems: string[]): Buffer | undefined {
  if (!raw) return undefined;
  const buf = Buffer.from(raw, /^[0-9a-fA-F]{64}$/.test(raw) ? 'hex' : 'base64');
  if (buf.length !== 32) {
    problems.push('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 (44 chars) or hex (64 chars). Generate one with `npm run gen:key -w @autoreach/backend`.');
    return undefined;
  }
  return buf;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  // A blank line in .env (`DATABASE_SSL=`) means "not set": use the default, as .env.example intends.
  const present = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = EnvSchema.safeParse(present);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`));
  }
  const e = parsed.data;
  const problems: string[] = [];
  const isProd = e.NODE_ENV === 'production';

  const dbHostIsLocal = (() => {
    try {
      const u = new URL(e.DATABASE_URL);
      return ['localhost', '127.0.0.1', '[::1]', '::1', ''].includes(u.hostname) || (u.searchParams.get('host') ?? '').startsWith('/');
    } catch {
      return false;
    }
  })();
  const ssl = e.DATABASE_SSL ?? (dbHostIsLocal ? 'disable' : 'no-verify');

  const tokenKey = decodeKey(e.TOKEN_ENCRYPTION_KEY, problems);

  // Storage driver
  const storageDriver = e.STORAGE_DRIVER ?? (e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'local');
  if (storageDriver === 'supabase' && (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY)) {
    problems.push('STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (isProd && storageDriver === 'local') {
    problems.push('STORAGE_DRIVER=local is for development only. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in production.');
  }

  // Auth
  const devLoginEnabled = e.ENABLE_DEV_LOGIN && !isProd;
  if (e.ENABLE_DEV_LOGIN && isProd) problems.push('ENABLE_DEV_LOGIN must not be set in production.');
  const extensionIds = e.EXTENSION_IDS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  for (const id of extensionIds) if (!/^[a-p]{32}$/.test(id)) problems.push(`EXTENSION_IDS: "${id}" is not a Chrome extension ID (32 letters a–p).`);
  if (devLoginEnabled && !e.DEV_JWT_SECRET) problems.push('ENABLE_DEV_LOGIN=true requires DEV_JWT_SECRET (any long random string).');
  if (devLoginEnabled && !dbHostIsLocal) problems.push('ENABLE_DEV_LOGIN is only allowed with a local database (it creates users in auth.users).');
  if (!devLoginEnabled && !e.SUPABASE_JWT_SECRET && !(e.SUPABASE_URL && e.SUPABASE_ANON_KEY)) {
    problems.push('Authentication is not configured: set SUPABASE_URL and SUPABASE_ANON_KEY (and optionally SUPABASE_JWT_SECRET).');
  }

  // Gmail
  let gmailReason: string | undefined;
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) gmailReason = 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set on the server.';
  else if (!tokenKey) gmailReason = 'TOKEN_ENCRYPTION_KEY is not set on the server.';
  if (isProd && e.GOOGLE_CLIENT_ID && !tokenKey) problems.push('TOKEN_ENCRYPTION_KEY is required when Gmail is configured.');

  // AI
  let aiReason: string | undefined;
  let aiProvider: AppConfig['ai']['provider'] = e.AI_PROVIDER === 'none' ? null : e.AI_PROVIDER;
  if (!aiProvider) aiReason = 'AI_PROVIDER is not set on the server — the composer uses your templates instead.';
  else if (!e.AI_MODEL) {
    aiReason = `AI_MODEL is required for AI_PROVIDER=${aiProvider}.`;
    aiProvider = null;
  } else if (!e.AI_API_KEY && aiProvider !== 'openai_compatible') {
    aiReason = `AI_API_KEY is required for AI_PROVIDER=${e.AI_PROVIDER}.`;
    aiProvider = null;
  } else if (aiProvider === 'openai_compatible' && !e.AI_BASE_URL) {
    aiReason = 'AI_BASE_URL is required for AI_PROVIDER=openai_compatible.';
    aiProvider = null;
  }

  // career-ops: a local folder, read only by its owner.
  const careerOpsOwner = e.CAREER_OPS_OWNER_EMAIL?.toLowerCase();
  if (careerOpsOwner && !/^[^@\s]+@[^@\s]+$/.test(careerOpsOwner)) problems.push('CAREER_OPS_OWNER_EMAIL must be an email address.');
  if (e.CAREER_OPS_DIR && isProd && !careerOpsOwner) {
    problems.push('CAREER_OPS_DIR in production requires CAREER_OPS_OWNER_EMAIL, so only you can read that folder.');
  }

  // Tracking: the pixel URL must be reachable by mail clients.
  let trackingReason: string | undefined;
  if (!/^https:\/\//.test(e.API_PUBLIC_URL)) {
    trackingReason = 'API_PUBLIC_URL is not an https URL, so recipients’ mail clients cannot load a tracking pixel.';
  }

  const corsOrigins = [e.DASHBOARD_URL, ...(e.CORS_EXTRA_ORIGINS?.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean) ?? [])];

  if (problems.length) throw new ConfigError(problems);

  return {
    env: e.NODE_ENV,
    isProd,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    apiPublicUrl: e.API_PUBLIC_URL,
    dashboardUrl: e.DASHBOARD_URL,
    corsOrigins,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    database: {
      url: e.DATABASE_URL,
      ssl,
      caCert: e.DATABASE_CA_CERT,
      poolMax: e.DATABASE_POOL_MAX,
      rlsRole: e.DB_RLS_ROLE.trim(),
    },
    supabase: {
      url: e.SUPABASE_URL?.replace(/\/+$/, ''),
      anonKey: e.SUPABASE_ANON_KEY,
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      jwtSecret: e.SUPABASE_JWT_SECRET,
    },
    storage: { driver: storageDriver, bucket: e.STORAGE_BUCKET, localDir: e.STORAGE_LOCAL_DIR },
    gmail: {
      configured: !gmailReason,
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      redirectUri: `${e.API_PUBLIC_URL}/api/integrations/gmail/callback`,
      reason: gmailReason,
      replyDetection: e.GMAIL_REPLY_DETECTION,
      extensionIds,
    },
    tokenEncryptionKey: tokenKey,
    ai: {
      provider: aiProvider,
      apiKey: e.AI_API_KEY,
      model: e.AI_MODEL,
      baseUrl: e.AI_BASE_URL?.replace(/\/+$/, ''),
      timeoutMs: e.AI_TIMEOUT_MS,
      reason: aiReason,
    },
    hunterApiKey: e.HUNTER_API_KEY,
    tracking: { configured: !trackingReason, reason: trackingReason },
    careerOps: { dir: e.CAREER_OPS_DIR, ownerEmail: careerOpsOwner },
    workersEnabled: e.WORKERS_ENABLED,
    devLogin: { enabled: devLoginEnabled, secret: e.DEV_JWT_SECRET },
  };
}
