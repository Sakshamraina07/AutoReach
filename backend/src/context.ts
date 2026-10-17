import type { AppConfig } from './config.js';
import type { Db } from './db/pool.js';
import type { Logger } from './logger.js';
import type { FileStorage } from './storage/index.js';
import type { FetchLike } from './lib/http.js';
import type { AiProvider } from './services/ai/provider.js';
import type { TokenVerifier } from './auth/verify.js';

/** Everything a service needs, injected so tests can substitute fakes. */
export interface Deps {
  config: AppConfig;
  db: Db;
  logger: Logger;
  storage: FileStorage;
  /** HTTP client for Google, Gmail, AI providers and Hunter (fake in tests). */
  fetch: FetchLike;
  ai: AiProvider | null;
  verifier: TokenVerifier;
  now: () => Date;
}
