import Redis from 'ioredis';

/**
 * Best-effort Redis handle. Redis is a cache/warm layer only — the database
 * is always the source of truth, and every caller must tolerate Redis being
 * absent or failing (log + continue).
 */
let client: Redis | null = null;

/**
 * Test seam (mirrors `__setPool` in db.ts): override the Redis handle.
 * `undefined` (default) means "resolve from REDIS_URL as usual"; any other
 * value — including `null` — is returned verbatim. Lets the kill-switch
 * tests assert cache invalidation against a fake without a real Redis.
 */
let redisOverride: Redis | null | undefined;
export function __setRedis(next: Redis | null | undefined): void {
  redisOverride = next;
  client = null;
}

export function redis(): Redis | null {
  if (redisOverride !== undefined) return redisOverride;
  if (!process.env.REDIS_URL) return null;
  if (!client) {
    client = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
    // ioredis throws on unhandled 'error' events; all call sites already
    // catch operation failures, so this just keeps the process alive.
    client.on('error', () => undefined);
  }
  return client;
}
