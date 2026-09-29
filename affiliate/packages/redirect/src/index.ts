import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import { apiError, buildEnvelope } from '@paparazzi/shared';

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
 * Tenant scoping: the token is a 128-bit unguessable bearer secret with a
 * global unique constraint, so the route lookup is by token alone (documented
 * exception to the org_id-everywhere rule — see ASSUMPTIONS.md). All writes
 * use the org_id read back from the link row.
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
  subid_field?: string;
  org_id: string;
  link_id: string;
}

const TOKEN_RE = /^[0-9a-f]{32}$/;

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
  const { rows } = await pool.query<{
    link_id: string;
    org_id: string;
    destination_url: string;
    allowed_hosts: string[] | null;
    programme_status: string;
    offer_status: string;
    /** timestamptz: pg returns string, pg-mem returns Date — both Date-parseable. */
    fresh_until: string | Date | null;
  }>(
    `select l.id as link_id, l.org_id as org_id,
            o.offer_url as destination_url,
            pc.allowed_domains as allowed_hosts,
            p.status as programme_status,
            o.status as offer_status,
            o.fresh_until as fresh_until
       from links l
       join offers o on o.id = l.offer_id
       join programmes p on p.id = o.programme_id
       left join programme_capabilities pc on pc.programme_id = p.id
      where l.token = $1 and l.status = 'active'
      limit 1`,
    [token],
  );
  const row = rows[0];
  if (!row) return null;

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

  // Best-effort cache rebuild.
  try {
    const r = redis();
    if (r) await r.set(`route:${token}`, JSON.stringify(route), 'EX', 300);
  } catch (err) {
    req.log.warn({ err }, 'route cache rebuild failed');
  }
  return route;
}

async function handleRedirect(pool: Pool, req: FastifyRequest, reply: FastifyReply) {
  const requestId = randomUUID();
  const token = (req.params as { token?: string }).token ?? '';

  if (!TOKEN_RE.test(token)) {
    return reply.code(404).send(apiError('NOT_FOUND', 'Unknown link', requestId));
  }

  const route = await loadRoute(pool, token, req);
  if (!route) {
    return reply.code(404).send(apiError('NOT_FOUND', 'Unknown link', requestId));
  }

  // 3) Eligibility — paused programme/offer/stale offer serves the paused page.
  const fresh = !route.fresh_until || new Date(route.fresh_until).getTime() > Date.now();
  if (route.programme_status !== 'active' || route.offer_status !== 'active' || !fresh) {
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

  // 5) Click persistence + event enqueue. Fail-open on persistence failure:
  // redirect anyway WITHOUT click_id (no subid param), with observable loss.
  const clickId = randomUUID();
  let persisted = false;
  try {
    const ua = req.headers['user-agent'];
    const ipHash = createHash('sha256').update(req.ip).digest('hex'); // never store raw IP
    await pool.query(
      `insert into clicks (id, org_id, link_id, click_id, occurred_at, context)
       values ($1, $2, $3, $4, now(), $5::jsonb)`,
      [randomUUID(), route.org_id, route.link_id, clickId, JSON.stringify({ ua, ip_hash: ipHash })],
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

  // 6) 302 — subid only when the click was actually persisted.
  if (persisted) {
    target.searchParams.set(route.subid_field || 'subid', clickId);
  }
  return reply.code(302).header('location', target.toString()).send();
}

export interface RedirectAppDeps {
  /** Injected pool (test seam). When omitted, DATABASE_URL is required. */
  pool?: Pool;
}

/** Build the Fastify app without listening (test seam — exact contract name). */
export async function buildRedirectApp(deps?: RedirectAppDeps): Promise<FastifyInstance> {
  const pool =
    deps?.pool ??
    (() => {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
      return new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
    })();

  const app = Fastify({ logger: true });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/r/:token', (req, reply) => handleRedirect(pool, req, reply));

  app.setNotFoundHandler((req, reply) => {
    const requestId = randomUUID();
    return reply.code(404).send(apiError('NOT_FOUND', `No route for ${req.method} ${req.url}`, requestId));
  });

  return app;
}

async function main() {
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
