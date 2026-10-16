import type { Deps } from '../context.js';
import { backfillCompanyLinks } from '../services/companies.js';
import { processFollowUpAutoSend } from '../services/followupAutosend.js';
import { processSendQueue, sweepStaleSending } from '../services/messages.js';
import { syncAllReplies } from '../services/replySync.js';
import { purgeExpiredTrackingEvents } from '../services/tracking.js';

/**
 * In-process background jobs. Each job holds a Postgres advisory lock while it
 * runs, so several API instances never run the same job concurrently.
 */
interface Job {
  name: string;
  lockKey: number;
  everyMs: number;
  run: (deps: Deps) => Promise<unknown>;
}

const JOBS: Job[] = [
  { name: 'send-queue', lockKey: 72_001, everyMs: 15_000, run: (d) => processSendQueue(d) },
  { name: 'stale-sending-sweeper', lockKey: 72_002, everyMs: 60_000, run: (d) => sweepStaleSending(d) },
  { name: 'reply-sync', lockKey: 72_003, everyMs: 180_000, run: (d) => syncAllReplies(d) },
  { name: 'follow-up-autosend', lockKey: 72_004, everyMs: 300_000, run: (d) => processFollowUpAutoSend(d) },
  { name: 'retention', lockKey: 72_005, everyMs: 6 * 3_600_000, run: (d) => purgeExpiredTrackingEvents(d) },
  { name: 'company-backfill', lockKey: 72_006, everyMs: 3_600_000, run: (d) => d.db.withSystem((tx) => backfillCompanyLinks(tx)) },
];

export function startWorkers(deps: Deps): () => void {
  const timers: NodeJS.Timeout[] = [];
  const running = new Set<string>();
  for (const job of JOBS) {
    const tick = async () => {
      if (running.has(job.name)) return;
      running.add(job.name);
      const lock = await deps.db.pool.connect().catch(() => null);
      if (!lock) {
        running.delete(job.name);
        return;
      }
      try {
        const { rows } = await lock.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [job.lockKey]);
        if (!rows[0]?.ok) return;
        try {
          const started = Date.now();
          const result = await job.run(deps);
          if (typeof result === 'number' && result > 0) deps.logger.info({ job: job.name, result, ms: Date.now() - started }, 'job finished');
        } finally {
          await lock.query('SELECT pg_advisory_unlock($1)', [job.lockKey]);
        }
      } catch (err) {
        deps.logger.error({ err, job: job.name }, 'job failed');
      } finally {
        lock.release();
        running.delete(job.name);
      }
    };
    // Stagger the first runs so start-up is quiet.
    timers.push(setTimeout(() => void tick(), 5_000 + Math.floor(Math.random() * 5_000)));
    timers.push(setInterval(() => void tick(), job.everyMs));
  }
  deps.logger.info({ jobs: JOBS.map((j) => j.name) }, 'background workers started');
  return () => timers.forEach((t) => clearInterval(t));
}
