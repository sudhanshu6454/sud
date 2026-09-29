/**
 * retention worker — scheduled DPDP retention purge.
 *
 * The processor is a thin wrapper around runRetentionPurge (src/retention/):
 * it loads the window config from the environment, runs the tenant-aware
 * purge, and logs the per-class outcome. The job itself carries no org_id —
 * the purge loops all organisations internally, one transaction per org.
 *
 * Scheduling: the workers bootstrap registers a BullMQ repeatable job on the
 * `retention` queue (see scheduleRetentionRepeat; pattern from RETENTION_CRON,
 * default daily 03:00). A manual run is `pnpm --filter @paparazzi/workers
 * purge:retention`.
 */

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { QUEUE_RETENTION, createRedisConnection, retentionQueue } from '../queues';
import { createLogger, errorMessage } from '../logging';
import { loadRetentionConfig } from '../retention/config';
import { runRetentionPurge } from '../retention/purge';

const log = createLogger('worker:retention');

export interface RetentionJobData {
  /**
   * When true, counts what would be purged without writing anything.
   * Useful for verifying windows before the first real run.
   */
  dry_run?: boolean;
}

export function createRetentionProcessor(pool: Pool) {
  return async function processRetention(job: Job<RetentionJobData>): Promise<void> {
    const dryRun = job.data.dry_run ?? false;
    const config = loadRetentionConfig();
    const results = await runRetentionPurge(pool, config, { dryRun });
    const total = results.reduce(
      (sum, r) => sum + r.classes.reduce((a, c) => a + c.rows_affected, 0),
      0,
    );
    log('info', 'retention run finished', {
      jobId: job.id,
      orgs: results.length,
      rows_affected_total: total,
      dry_run: dryRun,
    });
  };
}

/** Start a Worker on the retention queue. The caller owns pool/connection lifecycles. */
export function createRetentionWorker(pool: Pool, connection?: Redis): Worker<RetentionJobData> {
  const worker = new Worker<RetentionJobData>(QUEUE_RETENTION, createRetentionProcessor(pool), {
    connection: connection ?? createRedisConnection(),
  });
  worker.on('failed', (job, error) => {
    log('error', 'job failed', { jobId: job?.id, error: errorMessage(error) });
  });
  return worker;
}

/**
 * Register the daily repeatable purge on the retention queue.
 * Idempotent: BullMQ dedupes the repeatable definition, so calling this on
 * every bootstrap is safe.
 */
export async function scheduleRetentionRepeat(): Promise<void> {
  const config = loadRetentionConfig();
  await retentionQueue.add('purge', {}, { repeat: { pattern: config.cron } });
  log('info', 'retention repeat scheduled', { cron: config.cron, queue: QUEUE_RETENTION });
}
