/**
 * Workers entrypoint.
 *
 * Bootstraps the seven BullMQ workers plus the transactional outbox relay,
 * registers the daily retention-purge repeatable job, then handles graceful
 * shutdown on SIGTERM/SIGINT (stop relay, close workers, release Redis
 * connections, drain the pg pool).
 *
 * Required env:
 *   DATABASE_URL          Postgres connection string.
 *   REDIS_URL             Redis connection string (defaults to localhost; required under NODE_ENV=production).
 *   STUB_WEBHOOK_SECRET   HMAC secret for the stub connector's webhook demo flow.
 *
 * Optional env:
 *   RETENTION_CLICK_CONTEXT_DAYS / RETENTION_CONVERSION_RAW_DAYS /
 *   RETENTION_OUTBOX_DAYS         Retention windows in days (default 365 each).
 *   RETENTION_CRON                BullMQ cron pattern for the purge (default '0 3 * * *').
 *   RETENTION_REPLY_EVENTS_DAYS   comment-reply events (default 30, a placeholder pending counsel).
 *   COMMENT_REPLIES_SENDING       off (default) | shadow | on; with META_APP_SECRET and
 *                                 META_SYSTEM_USER_TOKEN (secrets) and META_GRAPH_VERSION (v26.0);
 *                                 SITE_URL is the only origin a message links to.
 *   ANALYTICS_ROLLUP_CRON         the rollups (default '7 * * * *').
 *   AMAZON_CREATORS_CREDENTIAL_ID / _SECRET / _VERSION
 *                                 Amazon Creators API credentials (secrets; unset = no price
 *                                 refresh, Amazon prices stay hidden). _TOKEN_URL / _API_BASE override
 *                                 the endpoints. AMAZON_REFRESH_CRON (default '17 * * * *'),
 *                                 AMAZON_REFRESH_MAX_REQUESTS (300), AMAZON_OFFER_TTL_DAYS (30).
 *
 * Run: pnpm --filter @paparazzi/workers dev   (tsx src/index.ts)
 */

import type { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { Pool } from 'pg';
import { createClickEventsWorker } from './workers/click-events';
import { createProviderEventsWorker } from './workers/provider-events';
import { createFeedsWorker, scheduleFeedsRepeat } from './workers/feeds';
import { createReconciliationWorker } from './workers/reconciliation';
import { createRetentionWorker, scheduleRetentionRepeat } from './workers/retention';
import { createCommentRepliesWorker, scheduleCommentRepliesRepeat } from './workers/replies';
import { createAnalyticsWorker, scheduleAnalyticsRepeat } from './workers/analytics';
import {
  ALL_QUEUE_NAMES,
  createRedisConnection,
  queueConnection,
  queues,
} from './queues';
import { startOutboxRelay, type OutboxRelay } from './outbox';
import { createLogger, errorMessage } from './logging';

const log = createLogger('workers:bootstrap');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }
  // queues.ts falls back to a local Redis for development; in production an
  // unset REDIS_URL is a misconfiguration (docker-compose.prod.yml no longer
  // refuses it itself, because docker-compose.single-host.yml supplies it).
  if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL?.trim()) {
    throw new Error('REDIS_URL is not configured');
  }

  const pool = new Pool({ connectionString: databaseUrl });

  // One dedicated connection per worker (BullMQ blocking commands), one for
  // the outbox relay's XADD calls. Producers share queueConnection (queues.ts).
  const workerConnections: Redis[] = [
    createRedisConnection(),
    createRedisConnection(),
    createRedisConnection(),
    createRedisConnection(),
    createRedisConnection(),
    createRedisConnection(),
    createRedisConnection(),
  ];
  const relayConnection = createRedisConnection();

  const workers: Worker[] = [
    createClickEventsWorker(workerConnections[0]),
    createProviderEventsWorker(pool, workerConnections[1]),
    createFeedsWorker(pool, workerConnections[2]),
    createReconciliationWorker(pool, workerConnections[3]),
    createRetentionWorker(pool, workerConnections[4]),
    createCommentRepliesWorker(pool, workerConnections[5]),
    createAnalyticsWorker(pool, workerConnections[6]),
  ];

  const relay: OutboxRelay = startOutboxRelay(pool, relayConnection);

  // Daily retention purge (BullMQ repeatable; deduped on re-register).
  await scheduleRetentionRepeat();
  // Hourly Amazon offer refresh: expires prices older than 1 h; refreshes
  // them only with Creators API credentials (src/amazon/refresh.ts).
  await scheduleFeedsRepeat();
  // Comment replies (0007): the sweep; nothing is sent while
  // COMMENT_REPLIES_SENDING is off (the default).
  await scheduleCommentRepliesRepeat();
  // Hourly rollups of clicks and replies for the analytics endpoints.
  await scheduleAnalyticsRepeat();

  log('info', 'workers started', {
    queues: [...ALL_QUEUE_NAMES],
    outbox_stream: 'events',
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log('info', `received ${signal}; shutting down gracefully`);

    relay.stop();
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await Promise.all([
      ...workerConnections.map((c) => c.quit()),
      relayConnection.quit(),
      queueConnection.quit(),
    ]);
    await pool.end();

    log('info', 'shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'fatal', error: errorMessage(error) }));
  process.exit(1);
});
