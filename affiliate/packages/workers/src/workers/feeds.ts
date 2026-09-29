/**
 * feeds worker — STUB.
 *
 * In production this worker performs incremental catalogue ingestion per
 * connector: fetch product/offer feeds since the last checkpoint, validate
 * currency/stock/price, quarantine malformed or implausible rows, preserve
 * provenance and the merchant item id, then advance the checkpoint atomically.
 *
 * No connector feed is configured for this run, so the worker only logs and
 * acknowledges the job. Enqueueing feed jobs remains supported so scheduling
 * and retry behaviour can be exercised end to end.
 */

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_FEEDS, createRedisConnection } from '../queues';
import { createLogger } from '../logging';

const log = createLogger('worker:feeds');

export interface FeedsJobData {
  /** Connector name, e.g. 'stub-network'. Absent until scheduling is wired up. */
  connector?: string;
  /** ISO timestamp of the last successful checkpoint for incremental pulls. */
  since?: string;
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

export function createFeedsWorker(connection?: Redis): Worker<FeedsJobData> {
  const worker = new Worker<FeedsJobData>(QUEUE_FEEDS, processFeed, {
    connection: connection ?? createRedisConnection(),
  });
  worker.on('failed', (job, error) => {
    log('error', 'job failed', { jobId: job?.id, error: error.message });
  });
  return worker;
}
