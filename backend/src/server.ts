import 'dotenv/config';
import { createApp } from './app.js';
import { buildDeps } from './bootstrap.js';
import { ConfigError } from './config.js';
import { pendingMigrations } from './db/migrate.js';
import { importLegacyTokens } from './services/gmail/connection.js';
import { startWorkers } from './workers/index.js';

async function main() {
  let deps;
  try {
    deps = buildDeps();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n${err.message}\n\nSee backend/.env.example and docs/SETUP.md.\n`);
      process.exit(1);
    }
    throw err;
  }
  const { config, logger, db } = deps;

  if (!(await db.ping())) logger.error('database is not reachable — check DATABASE_URL');
  else {
    const client = await db.pool.connect();
    try {
      const pending = await pendingMigrations(client);
      if (pending.length) logger.warn({ pending }, 'database migrations are pending — run `npm run db:migrate`');
    } finally {
      client.release();
    }
    const imported = await importLegacyTokens(deps).catch((err) => {
      logger.error({ err }, 'legacy Gmail token import failed');
      return 0;
    });
    if (imported) logger.info({ imported }, 'encrypted v1 Gmail tokens');
  }

  const app = createApp(deps);
  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        env: config.env,
        gmail: config.gmail.configured ? 'configured' : config.gmail.reason,
        ai: deps.ai ? `${deps.ai.name}:${deps.ai.model}` : config.ai.reason,
        tracking: config.tracking.configured ? 'configured' : config.tracking.reason,
        storage: deps.storage.driver,
      },
      'AutoReach API listening',
    );
  });
  const stopWorkers = config.workersEnabled ? startWorkers(deps) : () => {};

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopWorkers();
    server.close(() => {
      void db.close().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled promise rejection'));
}

void main();
