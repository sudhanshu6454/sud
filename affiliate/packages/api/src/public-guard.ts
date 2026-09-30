/**
 * Guards for the api's unauthenticated routes (the public read API
 * /v1/public/*, the Meta webhook): a per-client token bucket, and a short
 * in-process cache of public answers.
 *
 * Rate limit. The client is req.ip (the visitor's address behind the edge
 * and the web's /api proxy, TRUST_PROXY), kept only as a keyed hash in
 * memory (IP_HASH_KEY, like the redirect's clicks; never logged or
 * stored). Buckets: the public reads PUBLIC_RATE_PER_MINUTE (default 240
 * per minute, bursts of the same size), the webhook
 * WEBHOOK_RATE_PER_MINUTE (default 1200: Meta delivers in bursts and
 * retries for 36 hours, so a refused delivery comes back). Over the limit →
 * 429 RATE_LIMITED with Retry-After. The table is bounded (oldest dropped).
 * Per process: with several api replicas each keeps its own.
 *
 * Not limited: a call from the stack itself (`fromTheStack`: no
 * X-Forwarded-For, and the TCP peer a loopback or private address) — the
 * web's server-side renders, its middleware and its /img/looks proxy. Every
 * visitor's request reaches the api through the edge, which always sets
 * X-Forwarded-For (docker/Caddyfile), and the web's /api proxy passes it
 * on, so a visitor is always counted by their own address; limiting the
 * web's own calls would put every visitor in the web's one bucket (one busy
 * client would then make the whole site answer errors). Those calls are
 * bounded by the web's caches and this module's answer cache instead.
 *
 * Cache. A public answer is kept up to PUBLIC_CACHE_SECONDS (30 s, the
 * answer's own max-age) per URL, keyed by the current *invalidation epoch*:
 * a Redis counter (`public:epoch`) that every invalidation increments
 * (src/looks/invalidate.ts, after every takedown, restore, review, publish,
 * unpublish, removal, asset or storefront change — from the api or the
 * CLI, any process). A cached answer is used only while the epoch it was
 * stored under is still the current one, so a takedown reaches every
 * public answer at once. Without Redis (or when it fails), or with
 * PUBLIC_API_CACHE=off, nothing is cached.
 */
import { createHmac } from 'node:crypto';
import { redis } from './redis.js';

export const EPOCH_KEY = 'public:epoch';

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  at: number;
}

const MAX_CLIENTS = 50_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Take one token for `client`; the answer says whether it was allowed and, if not, when to retry (seconds). */
  take(client: string): { ok: boolean; retryAfter: number } {
    const t = this.now();
    const rate = this.perMinute / 60_000;
    const cur = this.buckets.get(client) ?? { tokens: this.perMinute, at: t };
    cur.tokens = Math.min(this.perMinute, cur.tokens + (t - cur.at) * rate);
    cur.at = t;
    this.buckets.delete(client);
    if (this.buckets.size >= MAX_CLIENTS) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    this.buckets.set(client, cur);
    if (cur.tokens >= 1) {
      cur.tokens -= 1;
      return { ok: true, retryAfter: 0 };
    }
    return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - cur.tokens) / rate / 1000)) };
  }
}

function perMinute(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : fallback;
}

let publicLimiter: RateLimiter | null = null;
let webhookLimiter: RateLimiter | null = null;

export function publicRateLimiter(): RateLimiter {
  publicLimiter ??= new RateLimiter(perMinute(process.env.PUBLIC_RATE_PER_MINUTE, 240));
  return publicLimiter;
}

export function webhookRateLimiter(): RateLimiter {
  webhookLimiter ??= new RateLimiter(perMinute(process.env.WEBHOOK_RATE_PER_MINUTE, 1200));
  return webhookLimiter;
}

/** Test seam: fresh limiters (the env read again). */
export function __resetRateLimiters(): void {
  publicLimiter = null;
  webhookLimiter = null;
}

/** A loopback or private-range address (IPv4, IPv6, IPv4-mapped IPv6). */
export function privateAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.toLowerCase().replace(/^::ffff:/, '');
  if (/^(127\.|10\.|192\.168\.)/.test(a)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true;
  return a === '::1' || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe80:/.test(a);
}

/** A call from the stack itself (the web's server side): no forwarded client address, a private TCP peer. */
export function fromTheStack(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): boolean {
  const xff = req.headers['x-forwarded-for'];
  if (xff !== undefined && xff !== '') return false;
  return privateAddress(req.socket?.remoteAddress);
}

/** The in-memory key of a client address (keyed like the redirect's ip_hash; never stored). */
export function clientKey(ip: string | undefined): string {
  const key = process.env.IP_HASH_KEY || 'afflino-rate-limit';
  return createHmac('sha256', key).update(ip ?? 'unknown').digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------
// Public answer cache
// ---------------------------------------------------------------------------

interface Entry {
  epoch: string;
  at: number;
  status: number;
  body: unknown;
}

const MAX_ENTRIES = 1000;
const cache = new Map<string, Entry>();

/** The current invalidation epoch, or null (no Redis, or it failed): then nothing is cached. */
export async function currentEpoch(): Promise<string | null> {
  if (process.env.PUBLIC_API_CACHE?.trim().toLowerCase() === 'off') return null;
  const r = redis();
  if (!r) return null;
  try {
    return ((await r.get(EPOCH_KEY)) as string | null) ?? '0';
  } catch {
    return null;
  }
}

/** Every invalidation calls this (after its commit): every cached public answer is dropped, in every process. */
export async function bumpEpoch(): Promise<boolean> {
  cache.clear();
  stills.clear();
  stillBytes = 0;
  const r = redis() as unknown as { incr?: (k: string) => Promise<number> } | null;
  if (!r || typeof r.incr !== 'function') return false;
  try {
    await r.incr(EPOCH_KEY);
    return true;
  } catch {
    return false;
  }
}

export function cachedAnswer(url: string, epoch: string | null, maxAgeSeconds: number, now: number = Date.now()): Entry | null {
  if (epoch === null) return null;
  const e = cache.get(url);
  if (!e) return null;
  if (e.epoch !== epoch || now - e.at > maxAgeSeconds * 1000) {
    cache.delete(url);
    return null;
  }
  return e;
}

export function storeAnswer(url: string, epoch: string | null, status: number, body: unknown, now: number = Date.now()): void {
  if (epoch === null) return;
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, { epoch, at: now, status, body });
}

// ---------------------------------------------------------------------------
// Still cache: the bytes of a still (or its refusal) per URL, under the same
// epoch and for the same 30 s, within a byte budget, so a burst of requests
// for one image costs one origin fetch and one set of queries.
// ---------------------------------------------------------------------------

export interface StillEntry {
  epoch: string;
  at: number;
  status: 200 | 404 | 410;
  contentType: string | null;
  bytes: Buffer | null;
}

const STILL_BUDGET_BYTES = 64 * 1024 * 1024;
const STILL_MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const stills = new Map<string, StillEntry>();
let stillBytes = 0;

function dropStill(key: string): void {
  const e = stills.get(key);
  if (!e) return;
  stillBytes -= e.bytes?.length ?? 0;
  stills.delete(key);
}

export function cachedStill(url: string, epoch: string | null, maxAgeSeconds: number, now: number = Date.now()): StillEntry | null {
  if (epoch === null) return null;
  const e = stills.get(url);
  if (!e) return null;
  if (e.epoch !== epoch || now - e.at > maxAgeSeconds * 1000) {
    dropStill(url);
    return null;
  }
  return e;
}

export function storeStill(url: string, epoch: string | null, entry: Omit<StillEntry, 'epoch' | 'at'>, now: number = Date.now()): void {
  if (epoch === null) return;
  const size = entry.bytes?.length ?? 0;
  if (size > STILL_MAX_ENTRY_BYTES) return;
  dropStill(url);
  while ((stillBytes + size > STILL_BUDGET_BYTES || stills.size >= MAX_ENTRIES) && stills.size > 0) {
    const oldest = stills.keys().next().value;
    if (oldest === undefined) break;
    dropStill(oldest);
  }
  stills.set(url, { ...entry, epoch, at: now });
  stillBytes += size;
}

/** Test seam. */
export function __clearPublicCache(): void {
  cache.clear();
  stills.clear();
  stillBytes = 0;
}
