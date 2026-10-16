import 'dotenv/config';
import { buildDeps } from './bootstrap.js';
import { startWorkers } from './workers/index.js';

/** Run the background jobs in a separate process (set WORKERS_ENABLED=false on the API). */
const deps = buildDeps();
const stop = startWorkers(deps);
const shutdown = () => {
  stop();
  void deps.db.close().finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
