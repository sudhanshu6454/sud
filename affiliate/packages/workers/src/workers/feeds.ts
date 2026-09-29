/**
 * feeds worker.
 *
 * connector 'amazon-associates': the Amazon offer refresh
 * (src/amazon/refresh.ts): expires Amazon prices older than 1 hour and,
 * with Creators API credentials (AMAZON_CREATORS_CREDENTIAL_ID / _SECRET /
 * _VERSION on the workers service), refreshes prices and availability.
 * Scheduled hourly by scheduleFeedsRepeat (AMAZON_REFRESH_CRON, default
 * '17 * * * *'); a manual run is `node dist/amazon/refresh-once.js`.
 *
 * Any other connector: STUB. In production this worker would perform
 * incremental catalogue ingestion per connector: fetch product/offer feeds
 * since the last checkpoint, validate currency/stock/price, quarantine
 * malformed or implausible rows, preserve provenance and the merchant item
 * id, then advance the checkpoint atomically. No such feed is configured, so
 * the worker only logs and acknowledges the job.
 */

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { AMAZON_CONNECTOR } from '@paparazzi/shared';
import { QUEUE_FEEDS, createRedisConnection, feedsQueue } from '../queues';
import { createLogger, errorMessage } from '../logging';
import { refreshAmazonOffers, type RefreshSummary } from '../amazon/refresh';
import { CreatorsApiClient, creatorsApiConfigFromEnv } from '../amazon/creators-api';

const log = createLogger('worker:feeds');

export interface FeedsJobData {
  /** Connector name, e.g. 'stub-network'. Absent until scheduling is wired up. */
  connector?: string;
  /** ISO timestamp of the last successful checkpoint for incremental pulls. */
  since?: string;
}

/** The Amazon refresh with its production dependencies (env credentials, real fetch). */
export async function runAmazonRefresh(pool: Pool, env: NodeJS.ProcessEnv = process.env): Promise<RefreshSummary> {
  const numberEnv = (name: string, fallback: number) => {
    const v = Number(env[name]);
    return Number.isInteger(v) && v > 0 ? v : fallback;
  };
  return refreshAmazonOffers(pool, {
    clientFor: (account) => {
      const cfg = creatorsApiConfigFromEnv(env, account);
      return cfg ? new CreatorsApiClient(cfg) : null;
    },
    maxRequestsPerRun: numberEnv('AMAZON_REFRESH_MAX_REQUESTS', 300),
    offerTtlDays: numberEnv('AMAZON_OFFER_TTL_DAYS', 30),
    log: (level, message, fields) => log(level, message, fields),
  });
}

export function createFeedsProcessor(pool: Pool) {
  return async function processFeedJob(job: Job<FeedsJobData>): Promise<void> {
    if (job.data.connector === AMAZON_CONNECTOR) {
      const summary = await runAmazonRefresh(pool);
      log('info', 'amazon offer refresh finished', { jobId: job.id, ...summary });
      return;
    }
    await processFeed(job);
  };
}

export async function processFeed(job: Job<FeedsJobData>): Promise<void> {
  log('info', 'feed ingest not configured for this run', {
    jobId: job.id,
    connector: job.data.connector ?? 'none',
    since: job.data.since ?? 'none',
  });

  // TODO: incremental feed ingestion with checkpoints (brief §6):
  //   1. load the connector's checkpoint (last successful ingest timestamp);
  //   2. pull the feed/API delta via connector.ingestProducts()/refreshOffers();
  //   3. validate currency, stock and price; quarantine malformed rows with reason;
  //   4. upsert offers preserving provenance + merchant item id;
  //   5. advance the checkpoint only after the batch commits.
  // Expired or revoked offers must not generate new commissionable links.
}

export function createFeedsWorker(pool: Pool, connection?: Redis): Worker<FeedsJobData> {
  const worker = new Worker<FeedsJobData>(QUEUE_FEEDS, createFeedsProcessor(pool), {
    connection: connection ?? createRedisConnection(),
  });
  worker.on('failed', (job, error) => {
    log('error', 'job failed', { jobId: job?.id, error: errorMessage(error) });
  });
  return worker;
}

/**
 * Register the hourly Amazon refresh (BullMQ repeatable; deduped on
 * re-register, like the retention purge). Registered whether or not
 * credentials exist: without them the run still expires old prices.
 */
export async function scheduleFeedsRepeat(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const pattern = env.AMAZON_REFRESH_CRON?.trim() || '17 * * * *';
  await feedsQueue.add('amazon-refresh', { connector: AMAZON_CONNECTOR }, { repeat: { pattern } });
  log('info', 'amazon refresh repeat scheduled', { cron: pattern, queue: QUEUE_FEEDS });
}
