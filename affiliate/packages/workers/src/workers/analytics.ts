/**
 * analytics worker (0007): the hourly rollup of clicks and comment replies
 * into click_daily / reply_daily (src/analytics/rollup.ts). ANALYTICS_ROLLUP_CRON
 * (default '7 * * * *'); a manual run is `node dist/analytics/rollup-once.js`.
 * Read-only with respect to money.
 */
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { QUEUE_ANALYTICS, analyticsQueue, createRedisConnection } from '../queues';
import { createLogger, errorMessage } from '../logging';
import { runRollups } from '../analytics/rollup';
import { loadRetentionConfig } from '../retention/config';

const log = createLogger('worker:analytics');

export function createAnalyticsProcessor(pool: Pool) {
  return async function processAnalyticsJob(job: Job): Promise<void> {
    // Never recompute a day the retention purge has reached (its stored counts stay).
    const retention = loadRetentionConfig();
    const summary = await runRollups(pool, { replyRetentionDays: retention.replyEventsDays, clickContextDays: retention.clickContextDays });
    log('info', 'rollups finished', { jobId: job.id, ...summary });
  };
}

export function createAnalyticsWorker(pool: Pool, connection?: Redis): Worker {
  const worker = new Worker(QUEUE_ANALYTICS, createAnalyticsProcessor(pool), { connection: connection ?? createRedisConnection() });
  worker.on('failed', (job, error) => log('error', 'job failed', { jobId: job?.id, error: errorMessage(error) }));
  return worker;
}

export async function scheduleAnalyticsRepeat(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const pattern = env.ANALYTICS_ROLLUP_CRON?.trim() || '7 * * * *';
  await analyticsQueue.add('rollup', {}, { repeat: { pattern } });
  log('info', 'analytics rollup scheduled', { cron: pattern, queue: QUEUE_ANALYTICS });
}
