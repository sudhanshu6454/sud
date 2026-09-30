import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  AMAZON_PREVIEW_PAGE,
  amazonRouteParams,
  apiError,
  buildEnvelope,
  isAmazonAcceptedPlatform,
  isLinkPreviewCrawler,
  isSpeculativeRequest,
  parseTrustProxy,
  requestLogFields,
  type TrustProxySetting,
} from '@paparazzi/shared';

// Re-exported: the request-log contract is tested from this package too.
export { requestLogFields };

/**
 * Redirect service — the public click hot path: GET /r/{token}.
 *
 * Sequence:
 *   1. Token format check (32 lowercase hex chars) → 404 otherwise.
 *   2. Redis GET `route:{token}`; on miss, single-query DB fallback joining
 *      links/offers/programmes/programme_capabilities, then best-effort
 *      cache rebuild (TTL 300s).
 *   3. Eligibility: programme and offer must be active (and the offer fresh);
 *      otherwise serve the paused page (HTTP 200, no redirect).
 *   4. Open-redirect guard: the destination hostname must be in the
 *      programme's allowed_hosts → else 403 (fail closed).
 *   5. Persist the click (click_id) and enqueue a `click-events` BullMQ job.
 *      FAIL-OPEN: if persistence fails, we still 302 to the approved
 *      destination WITHOUT a click_id/subid — the click is lost observably
 *      (error log) rather than breaking the user journey.
 *   6. 302 to destination_url with the subid query param set to click_id
 *      (only when the click was persisted).
 *
 * Amazon.in Associates routes (the route payload carries `set_params`,
 * `strip_params`, `subid_field: null` and `crawler_guard`, built by
 * `amazonRouteParams` in @paparazzi/shared, both at mint time and in the DB
 * fallback below): the destination is the stored canonical
 * https://www.amazon.in/dp/<ASIN>; `tag`, `ascsubtag` and `subid` are
 * removed, `tag` is set to the placement's tracking ID (else the account's
 * store ID), and NO click id is ever added (LR: "Under no circumstances may
 * you associate any sub-tag with a specific end user of your site"). The tag
 * is applied even when the click could not be persisted (fail-open keeps the
 * merchant's attribution). Automated clients (named link-preview crawlers,
 * generic bot / crawler / headless / HTTP-library user agents, no user agent
 * at all), prefetch / prerender / preview requests and HEAD requests get the
 * preview page instead (HTTP 200, no click row, no tagged URL anywhere):
 * Amazon forbids creating Sessions "by way of a robot or software program"
 * (PR 27) and pages opened "other than as a result of the customer clicking"
 * (PR 25) — a heuristic, counsel to confirm. A route whose Amazon account is
 * disabled, whose property lost its owner_operated verification or approval,
 * or whose property is on a platform Amazon links may not go on, serves the
 * paused page (`route_block`).
 * Every /r/ response carries `X-Robots-Tag: noindex, nofollow`.
 *
 * Tenant scoping: the token is a 128-bit unguessable bearer secret with a
 * global unique constraint, so the route lookup is by token alone (documented
 * exception to the org_id-everywhere rule — see ASSUMPTIONS.md). All writes
 * use the org_id read back from the link row.
 *
 * Client address: `req.ip` is what gets hashed. TRUST_PROXY (unset = trust
 * nothing, `req.ip` is the TCP peer) is passed to Fastify's `trustProxy`
 * (`parseTrustProxy` in @paparazzi/shared); behind the edge,
 * docker-compose.prod.yml sets `loopback,uniquelocal` and Caddy overwrites
 * any client-supplied X-Forwarded-For, so the hash is of the address the
 * edge saw, never of a value the shopper chose. The hash is HMAC-SHA256
 * keyed with IP_HASH_KEY when that is set (`hashClientAddress`); without a
 * key it is the plain SHA-256 of before, which for IPv4 is reversible by
 * enumerating the 2^32 addresses. The request log never carries the address
 * either (`requestLogFields`).
 *
 * Test seam (exact contract name): `buildRedirectApp({ pool })` builds the
 * Fastify app WITHOUT listening, so harnesses can inject a pg-mem-backed
 * pool. DATABASE_URL is required only when no pool is passed.
 */

let redisClient: Redis | null = null;
function redis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    redisClient.on('error', () => undefined);
  }
  return redisClient;
}

let clickQueue: Queue | null = null;
function queue(): Queue | null {
  if (!process.env.REDIS_URL) return null;
  if (!clickQueue) {
    // BullMQ requires maxRetriesPerRequest: null on its connection.
    const connection = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
    connection.on('error', () => undefined);
    clickQueue = new Queue('click-events', { connection });
  }
  return clickQueue;
}

interface RouteCache {
  destination_url: string;
  allowed_hosts: string[];
  programme_status: string;
  offer_status: string;
  fresh_until?: string | null;
  /**
   * Query param carrying the click id. Absent = 'subid' (every payload
   * written before Amazon existed); null = no click id on the destination
   * (every Amazon route).
   */
  subid_field?: string | null;
  /** Params removed from the destination before `set_params` (Amazon: tag, ascsubtag, subid). */
  strip_params?: string[];
  /** Params set on the destination, replacing any value already there (Amazon: tag). */
  set_params?: Record<string, string>;
  /** Automated clients, prefetches and HEAD requests get the preview page (Amazon routes). */
  crawler_guard?: boolean;
  /** Set when the route must not redirect (serves the paused page); e.g. 'amazon_account_disabled'. */
  route_block?: string | null;
  org_id: string;
  link_id: string;
}

/** The redirect's own row shape for the DB fallback (exported for tests). */
export interface RouteRow {
  link_id: string;
  org_id: string;
  /** links.status: a paused link (a takedown, a rights review, an unpublished look) serves the paused page. */
  link_status?: string | null;
  destination_url: string;
  allowed_hosts: string[] | null;
  programme_status: string;
  offer_status: string;
  /** timestamptz: pg returns string, pg-mem returns Date — both Date-parseable. */
  fresh_until: string | Date | null;
  /** Amazon Associates account of the offer's programme (null for every other programme). */
  amazon_account_id?: string | null;
  amazon_account_status?: string | null;
  amazon_store_id?: string | null;
  /** The link placement's own tracking ID, when one is mapped. */
  amazon_placement_tracking_id?: string | null;
  property_status?: string | null;
  property_platform?: string | null;
  /** Id of a live owner_operated verification of the placement's property, if any. */
  owner_verification_id?: string | null;
}

/**
 * Route payload from the DB row (exported for tests). For an Amazon programme
 * the tag and the click-id rule come from `amazonRouteParams`, the same
 * function POST /v1/links uses to warm the cache.
 */
export function routeFromRow(row: RouteRow): RouteCache {
  const route: RouteCache = {
    destination_url: row.destination_url,
    allowed_hosts: row.allowed_hosts ?? [],
    programme_status: row.programme_status,
    offer_status: row.offer_status,
    // Normalise to ISO text: the cache is JSON-serialised for Redis, and
    // pg-mem returns timestamptz as Date while pg returns string.
    fresh_until: row.fresh_until instanceof Date ? row.fresh_until.toISOString() : row.fresh_until,
    subid_field: 'subid',
    org_id: row.org_id,
    link_id: row.link_id,
  };
  const linkPaused = row.link_status !== undefined && row.link_status !== null && row.link_status !== 'active';
  if (linkPaused) route.route_block = 'link_paused';
  if (!row.amazon_account_id) return route;

  const params = amazonRouteParams({
    storeId: String(row.amazon_store_id ?? ''),
    placementTrackingId: row.amazon_placement_tracking_id ?? null,
  });
  let block: string | null = linkPaused ? 'link_paused' : null;
  if (block) {
    // keep the first reason
  } else if (row.amazon_account_status !== 'active' || !row.amazon_store_id) block = 'amazon_account_disabled';
  else if (row.property_status !== 'approved') block = 'property_not_approved';
  else if (!row.owner_verification_id) block = 'property_not_owner_operated';
  else if (!isAmazonAcceptedPlatform(row.property_platform)) block = 'property_platform_not_accepted';
  return {
    ...route,
    subid_field: params.subid_field,
    strip_params: params.strip_params,
    set_params: params.set_params,
    crawler_guard: params.crawler_guard,
    route_block: block,
  };
}

/**
 * The DB fallback: one query across the route graph, by token alone (see
 * the file docstring). A paused link (links.status 'paused': a takedown, a
 * rights review, an unpublished look, a removed item) is found too and
 * serves the paused page (route_block 'link_paused'), never a redirect.
 * The Amazon joins are LEFT joins that match nothing for any other
 * programme; each is keyed to the link's own organisation.
 * The verification join keeps only live owner_operated rows, so a duplicate
 * row can only repeat the same answer (`limit 1`).
 */
export const ROUTE_SQL = `select l.id as link_id, l.org_id as org_id, l.status as link_status,
            o.offer_url as destination_url,
            pc.allowed_domains as allowed_hosts,
            p.status as programme_status,
            o.status as offer_status,
            o.fresh_until as fresh_until,
            aa.id as amazon_account_id,
            aa.status as amazon_account_status,
            aa.store_id as amazon_store_id,
            t.tracking_id as amazon_placement_tracking_id,
            pr.status as property_status,
            pr.platform as property_platform,
            v.id as owner_verification_id
       from links l
       join offers o on o.id = l.offer_id
       join programmes p on p.id = o.programme_id
       join placements pl on pl.id = l.placement_id and pl.org_id = l.org_id
       join properties pr on pr.id = pl.property_id and pr.org_id = l.org_id
       left join programme_capabilities pc on pc.programme_id = p.id
       left join amazon_associates_accounts aa on aa.programme_id = p.id and aa.org_id = l.org_id
       left join amazon_tracking_ids t
              on t.account_id = aa.id and t.placement_id = l.placement_id and t.org_id = l.org_id
       left join verifications v
              on v.property_id = pl.property_id and v.org_id = l.org_id
             and v.method = 'owner_operated' and v.verified_at is not null
             and (v.expires_at is null or v.expires_at > now())
      where l.token = $1
      limit 1`;

const TOKEN_RE = /^[0-9a-f]{32}$/;

/**
 * `?via=<surface>` on a /r/ link: the page surface the click came from (e.g.
 * 's-<storefront slug>', 'look', 'reply'), for per-surface counts without a
 * tracking ID per surface. Kept in clicks.context only when it matches this
 * pattern; it names a page, never a person, and never reaches the merchant
 * (the destination is built from the stored offer URL alone).
 */
export const VIA_RE = /^[a-z0-9-]{1,40}$/;

export function viaOf(query: unknown): string | null {
  const v = typeof query === 'object' && query !== null ? (query as Record<string, unknown>).via : undefined;
  return typeof v === 'string' && VIA_RE.test(v) ? v : null;
}

/**
 * IP_HASH_KEY: the secret for the keyed client-address hash. Unset or empty
 * → `null` (plain SHA-256, the behaviour before the key existed, so existing
 * rows and tests stay valid). Set → at least IP_HASH_KEY_MIN_LENGTH
 * characters after trimming, or boot fails (a short key would make the HMAC
 * as enumerable as the unkeyed hash). The error never echoes the value.
 */
export const IP_HASH_KEY_MIN_LENGTH = 32;

export function parseIpHashKey(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  if (value.length < IP_HASH_KEY_MIN_LENGTH) {
    throw new Error(
      `IP_HASH_KEY: must be at least ${IP_HASH_KEY_MIN_LENGTH} characters (e.g. the 64 hex characters of openssl rand -hex 32);` +
        ` the value given has ${value.length}`,
    );
  }
  return value;
}

/**
 * `clicks.context.ip_hash`: HMAC-SHA256(key, ip) as lowercase hex with a key,
 * SHA-256(ip) without one. The same address always gives the same value under
 * one key (so per-address fraud checks keep working); values made under
 * different keys, or before and after a key was set, do not compare.
 */
export function hashClientAddress(ip: string, key: string | null): string {
  return key
    ? createHmac('sha256', key).update(ip).digest('hex')
    : createHash('sha256').update(ip).digest('hex');
}

/**
 * What an automated client (or a prefetch, or a HEAD request) gets for an
 * Amazon route: no click row, no redirect, and no tagged URL anywhere in the
 * page. The words are @paparazzi/shared AMAZON_PREVIEW_PAGE (drafts pending
 * counsel: they are what link cards show under every post).
 */
const PREVIEW_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>${AMAZON_PREVIEW_PAGE.title}</title></head>
<body style="font-family:sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem">
<h1>${AMAZON_PREVIEW_PAGE.heading}</h1>
<p>${AMAZON_PREVIEW_PAGE.body}</p>
</body></html>`;

const PAUSED_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Link paused</title></head>
<body style="font-family:sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem">
<h1>This link is paused</h1>
<p>The offer behind this link is no longer available. Please check back later or browse the latest looks.</p>
</body></html>`;

async function loadRoute(pool: Pool, token: string, req: FastifyRequest): Promise<RouteCache | null> {
  // 1) Cache first.
  try {
    const r = redis();
    if (r) {
      const raw = await r.get(`route:${token}`);
      if (raw) return JSON.parse(raw) as RouteCache;
    }
  } catch (err) {
    req.log.warn({ err }, 'route cache read failed; falling back to DB');
  }

  // 2) DB fallback — single query across the route graph.
  // NOTE: links.token is globally unique, so this lookup is by token alone;
  // the row's org_id scopes every subsequent write (see file docstring).
  const { rows } = await pool.query<RouteRow>(ROUTE_SQL, [token]);
  const row = rows[0];
  if (!row) return null;

  const route = routeFromRow(row);

  // Best-effort cache rebuild.
  try {
    const r = redis();
    if (r) await r.set(`route:${token}`, JSON.stringify(route), 'EX', 300);
  } catch (err) {
    req.log.warn({ err }, 'route cache rebuild failed');
  }
  return route;
}

async function handleRedirect(pool: Pool, ipHashKey: string | null, req: FastifyRequest, reply: FastifyReply) {
  const requestId = randomUUID();
  const token = (req.params as { token?: string }).token ?? '';
  // /r/ is a redirect, never a page to index (brief §1.5); set on every answer.
  reply.header('x-robots-tag', 'noindex, nofollow');

  if (!TOKEN_RE.test(token)) {
    return reply.code(404).send(apiError('NOT_FOUND', 'Unknown link', requestId));
  }

  const route = await loadRoute(pool, token, req);
  if (!route) {
    return reply.code(404).send(apiError('NOT_FOUND', 'Unknown link', requestId));
  }

  // 3) Eligibility — paused programme/offer/stale offer serves the paused page.
  const fresh = !route.fresh_until || new Date(route.fresh_until).getTime() > Date.now();
  if (route.programme_status !== 'active' || route.offer_status !== 'active' || !fresh || route.route_block) {
    if (route.route_block) req.log.warn({ token, reason: route.route_block }, 'route blocked; serving the paused page');
    return reply.code(200).type('text/html').send(PAUSED_HTML);
  }

  // 4) Open-redirect guard — fail closed.
  let target: URL;
  try {
    target = new URL(route.destination_url);
  } catch {
    req.log.error({ token }, 'route has malformed destination_url; refusing redirect');
    return reply.code(403).send(apiError('PROGRAMME_NOT_APPROVED', 'Destination not permitted', requestId));
  }
  if (!route.allowed_hosts.includes(target.hostname)) {
    req.log.warn({ token, hostname: target.hostname }, 'redirect blocked: hostname not in allowed_hosts');
    return reply.code(403).send(apiError('PROGRAMME_NOT_APPROVED', 'Destination not permitted', requestId));
  }

  // 4b) Amazon: automated clients, prefetches and HEAD never create a click or see the tagged URL.
  if (
    route.crawler_guard &&
    (req.method === 'HEAD' || isSpeculativeRequest(req.headers) || isLinkPreviewCrawler(req.headers['user-agent']))
  ) {
    return reply.code(200).type('text/html').header('cache-control', 'no-store').send(PREVIEW_HTML);
  }

  // Destination params (Amazon): strip, then set. Applied whether or not the
  // click persists below, so the merchant's own attribution never fails open.
  for (const name of route.strip_params ?? []) target.searchParams.delete(name);
  for (const [name, value] of Object.entries(route.set_params ?? {})) target.searchParams.set(name, value);

  // 5) Click persistence + event enqueue. Fail-open on persistence failure:
  // redirect anyway WITHOUT click_id (no subid param), with observable loss.
  const clickId = randomUUID();
  let persisted = false;
  try {
    const ua = req.headers['user-agent'];
    // Never store the raw address: only its (keyed) hash. req.ip honours TRUST_PROXY.
    const ipHash = hashClientAddress(req.ip, ipHashKey);
    const via = viaOf(req.query);
    await pool.query(
      `insert into clicks (id, org_id, link_id, click_id, occurred_at, context)
       values ($1, $2, $3, $4, now(), $5::jsonb)`,
      [randomUUID(), route.org_id, route.link_id, clickId, JSON.stringify(via ? { ua, ip_hash: ipHash, via } : { ua, ip_hash: ipHash })],
    );
    const q = queue();
    if (q) {
      const envelope = buildEnvelope({
        source: 'redirect',
        event_type: 'click.observed',
        payload: { click_id: clickId, token, org_id: route.org_id },
      });
      await q.add('click.observed', { envelope }, { removeOnComplete: 1000, removeOnFail: 5000 });
    }
    persisted = true;
  } catch (err) {
    // FAIL-OPEN: the user still reaches the approved merchant destination;
    // the click is lost but the failure is loudly observable.
    req.log.error({ err, token, click_id: clickId }, 'click persistence failed; redirecting without click_id (event loss)');
  }

  // 6) 302 — the click id only when the click was actually persisted, and
  // only when the route carries a click-id param at all (legacy payloads
  // without the key: 'subid'; Amazon: never).
  const subidField = route.subid_field === undefined ? 'subid' : route.subid_field;
  if (persisted && subidField) {
    target.searchParams.set(subidField, clickId);
  }
  return reply.code(302).header('location', target.toString()).send();
}

export interface RedirectAppDeps {
  /** Injected pool (test seam). When omitted, DATABASE_URL is required. */
  pool?: Pool;
  /** Fastify trustProxy (test seam). When omitted, parsed from TRUST_PROXY. */
  trustProxy?: TrustProxySetting;
  /** Where the request log goes (test seam). When omitted, stdout. */
  logStream?: { write(line: string): void };
  /** Key for the client-address hash (test seam). When omitted, parsed from IP_HASH_KEY. */
  ipHashKey?: string | null;
}

/** Build the Fastify app without listening (test seam — exact contract name). */
export async function buildRedirectApp(deps?: RedirectAppDeps): Promise<FastifyInstance> {
  const pool =
    deps?.pool ??
    (() => {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
      return new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
    })();

  // Both parsed before anything listens, so a bad value fails the boot.
  const trustProxy = deps?.trustProxy ?? parseTrustProxy(process.env.TRUST_PROXY);
  const ipHashKey = deps?.ipHashKey !== undefined ? deps.ipHashKey : parseIpHashKey(process.env.IP_HASH_KEY);

  const app = Fastify({
    logger: {
      level: 'info',
      // method, url, hostname: never remoteAddress (@paparazzi/shared request-log.ts).
      serializers: { req: requestLogFields },
      ...(deps?.logStream ? { stream: deps.logStream } : {}),
    },
    trustProxy,
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/r/:token', (req, reply) => handleRedirect(pool, ipHashKey, req, reply));

  app.setNotFoundHandler((req, reply) => {
    const requestId = randomUUID();
    return reply.code(404).send(apiError('NOT_FOUND', `No route for ${req.method} ${req.url}`, requestId));
  });

  return app;
}

async function main() {
  // In production the route cache and the click-events queue are not
  // optional: without REDIS_URL every click would be persisted but never
  // enqueued for the workers. Fail the boot instead (docker-compose.prod.yml
  // no longer refuses an empty REDIS_URL itself, because
  // docker-compose.single-host.yml supplies it).
  if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL?.trim()) {
    throw new Error('REDIS_URL is required in production');
  }
  const app = await buildRedirectApp();
  const port = Number(process.env.REDIRECT_PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
}

// Only listen when run as the entrypoint (`tsx src/index.ts`); importing the
// module (e.g. the buildRedirectApp test seam) must not bind a port.
if (typeof require !== 'undefined' && require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
