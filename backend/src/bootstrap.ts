import { SupabaseTokenVerifier } from './auth/verify.js';
import { loadConfig, type AppConfig } from './config.js';
import type { Deps } from './context.js';
import { Db } from './db/pool.js';
import { createLogger } from './logger.js';
import { createAiProvider } from './services/ai/provider.js';
import { createFileStorage } from './storage/index.js';

export function buildDeps(config: AppConfig = loadConfig()): Deps {
  const logger = createLogger(config.logLevel, config.env === 'development' && process.stdout.isTTY);
  const db = new Db(config.database, logger);
  const fetchImpl = globalThis.fetch.bind(globalThis);
  return {
    config,
    db,
    logger,
    storage: createFileStorage(config),
    fetch: fetchImpl,
    ai: createAiProvider(config.ai, fetchImpl),
    verifier: new SupabaseTokenVerifier(config),
    now: () => new Date(),
  };
}
