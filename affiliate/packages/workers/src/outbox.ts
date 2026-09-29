/**
 * Transactional outbox relay.
 *
 * Business writes (e.g. the provider-events worker) commit their outbox rows
 * in the SAME database transaction as the domain change. This relay polls for
 * unpublished rows and publishes each envelope to the `events` Redis stream,
 * then marks the row published.
 *
 * Delivery is AT-LEAST-ONCE: the stream append happens before the
 * published_at update, so a crash between the two republishes the event.
 * Consumers must dedupe on envelope.event_id (the envelope carries its own
 * payload_hash for integrity verification).
 */

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { createLogger, errorMessage } from './logging';
import type { OutboxRow } from '@paparazzi/shared';

const log = createLogger('outbox-relay');

/** Redis stream that carries published envelopes. */
export const OUTBOX_STREAM = 'events';

const BATCH_LIMIT = 100;
const POLL_INTERVAL_MS = 5000;

/**
 * Publish one batch of unpublished outbox rows. Returns the number published.
 * Exported for testing; the interval loop in startOutboxRelay calls it.
 */
export async function relayOutboxBatch(
  pool: Pool,
  redis: Redis,
  limit: number = BATCH_LIMIT,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<OutboxRow>(
      `select id, org_id, event_type, payload, payload_hash, occurred_at
       from outbox
       where published_at is null
       order by occurred_at asc
       limit $1
       for update skip locked`,
      [limit],
    );

    for (const row of rows) {
      // Stream append first, DB mark second => at-least-once (see module doc).
      await redis.xadd(OUTBOX_STREAM, '*', 'envelope', JSON.stringify(row.payload));
      await client.query('update outbox set published_at = now() where id = $1', [row.id]);
    }

    await client.query('commit');
    return rows.length;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export interface OutboxRelay {
  stop: () => void;
}

/**
 * Start polling the outbox every `intervalMs` (default 5000ms).
 * Returns a handle; call `stop()` for graceful shutdown.
 */
export function startOutboxRelay(
  pool: Pool,
  redis: Redis,
  intervalMs: number = POLL_INTERVAL_MS,
): OutboxRelay {
  let inFlight = false;

  const timer = setInterval(() => {
    if (inFlight) {
      log('warn', 'previous outbox batch still running; skipping tick');
      return;
    }
    inFlight = true;
    relayOutboxBatch(pool, redis)
      .then((published) => {
        if (published > 0) {
          log('info', 'outbox batch published', { published });
        }
      })
      .catch((error: unknown) => {
        log('error', 'outbox batch failed', { error: errorMessage(error) });
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);

  log('info', 'outbox relay started', { interval_ms: intervalMs, stream: OUTBOX_STREAM });

  return {
    stop: () => {
      clearInterval(timer);
      log('info', 'outbox relay stopped');
    },
  };
}
