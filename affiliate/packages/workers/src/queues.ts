/**
 * Queue definitions and Redis connection management.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on every Redis connection it
 * uses (blocking commands must not time out). Each Worker gets its OWN
 * connection — a connection shared with a Worker would be monopolised by its
 * blocking BRPOPLPUSH-style calls, starving producers.
 */

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

/** Queue names as constants — producers and workers must use these, never literals. */
export const QUEUE_CLICK_EVENTS = 'click-events';
export const QUEUE_PROVIDER_EVENTS = 'provider-events';
export const QUEUE_FEEDS = 'feeds';
export const QUEUE_RECONCILIATION = 'reconciliation';
export const QUEUE_RETENTION = 'retention';
/** Comment replies (0007): the sweep and one 'send' job per matched comment. */
export const QUEUE_COMMENT_REPLIES = 'comment-replies';
/** Daily rollups for the analytics endpoints (0007). */
export const QUEUE_ANALYTICS = 'analytics';

export const ALL_QUEUE_NAMES = [
  QUEUE_CLICK_EVENTS,
  QUEUE_PROVIDER_EVENTS,
  QUEUE_FEEDS,
  QUEUE_RECONCILIATION,
  QUEUE_RETENTION,
  QUEUE_COMMENT_REPLIES,
  QUEUE_ANALYTICS,
] as const;

export type QueueName = (typeof ALL_QUEUE_NAMES)[number];

/**
 * Create a fresh Redis connection suitable for BullMQ.
 * Reads REDIS_URL, defaulting to a local Redis.
 */
export function createRedisConnection(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  return new Redis(url, {
    // Required by BullMQ: blocking commands must never hit a client-side timeout.
    maxRetriesPerRequest: null,
  });
}

/**
 * Connection used by queue PRODUCERS (the exported Queue instances below).
 * Workers must NOT reuse this — they create their own via createRedisConnection().
 */
export const queueConnection = createRedisConnection();

function createQueue(name: QueueName): Queue {
  return new Queue(name, { connection: queueConnection });
}

/** Producer handles. The redirect service / API enqueue jobs through these. */
export const clickEventsQueue = createQueue(QUEUE_CLICK_EVENTS);
export const providerEventsQueue = createQueue(QUEUE_PROVIDER_EVENTS);
export const feedsQueue = createQueue(QUEUE_FEEDS);
export const reconciliationQueue = createQueue(QUEUE_RECONCILIATION);
export const retentionQueue = createQueue(QUEUE_RETENTION);
export const commentRepliesQueue = createQueue(QUEUE_COMMENT_REPLIES);
export const analyticsQueue = createQueue(QUEUE_ANALYTICS);

export const queues: Record<QueueName, Queue> = {
  [QUEUE_CLICK_EVENTS]: clickEventsQueue,
  [QUEUE_PROVIDER_EVENTS]: providerEventsQueue,
  [QUEUE_FEEDS]: feedsQueue,
  [QUEUE_RECONCILIATION]: reconciliationQueue,
  [QUEUE_RETENTION]: retentionQueue,
  [QUEUE_COMMENT_REPLIES]: commentRepliesQueue,
  [QUEUE_ANALYTICS]: analyticsQueue,
};
