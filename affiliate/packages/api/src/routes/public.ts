import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, apiError } from '@paparazzi/shared';
import { ok, parseOr400 } from './_helpers.js';
import { loadLookBundle, publicLook, publicStillSource } from '../looks/bundle.js';
import { celebrityNames } from '../looks/names.js';
import {
  PUBLIC_CACHE_SECONDS,
  TRENDING_DEFAULT_DAYS,
  TRENDING_MAX,
  celebrityHub,
  orgBySlug,
  sitemapLists,
  spottedFacets,
  spottedFeed,
  storefrontPage,
  trendingLooks,
} from '../looks/public.js';
import { fetchStill } from '../looks/still.js';
import { cachedAnswer, cachedStill, clientKey, currentEpoch, fromTheStack, publicRateLimiter, storeAnswer, storeStill } from '../public-guard.js';

// ---------------------------------------------------------------------------
// The public read API of celebrity looks — no token. The organisation is its
// public slug (`afflino`); every query after that lookup is tenant-scoped.
// Answers carry `cache-control: public, max-age=30`; the api keeps each JSON
// answer up to 30 s itself, keyed by the invalidation epoch every takedown,
// review, publish and edit increments (src/public-guard.ts), so a takedown
// reaches every answer at once. A withdrawn look that was public once, a
// look of a celebrity under takedown, or the hub of one, answer 410 GONE;
// content that was never public answers 404. Never more than the
// celebrity's rights allow at this moment; never a raw merchant URL (links
// are /r/<token> only); never the still's origin URL (the still is served
// at its own address, GET /v1/public/:org/looks/:id/still, behind the web's
// /img/looks/<id>). Rate-limited per client (429 RATE_LIMITED).
// ---------------------------------------------------------------------------

const OrgParams = z.object({ org: z.string().min(1).max(63) });
const PageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  page_size: z.coerce.number().int().min(1).max(48).default(24),
});
const FeedQuery = PageQuery.extend({
  celebrity: z.string().min(1).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(),
  storefront: z.string().min(1).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(),
});
const TrendingQuery = z.object({
  days: z.coerce.number().int().min(1).max(30).default(TRENDING_DEFAULT_DAYS),
  limit: z.coerce.number().int().min(1).max(TRENDING_MAX).default(8),
});
const SlugParams = OrgParams.extend({ slug: z.string().min(1).max(80) });
const LookParams = OrgParams.extend({ id: z.string().uuid() });
const StillQuery = z.object({ v: z.string().regex(/^[0-9a-f]{1,16}$/).optional() });

function cacheHeader(reply: FastifyReply): void {
  reply.header('cache-control', `public, max-age=${PUBLIC_CACHE_SECONDS}`);
}

async function org(req: FastifyRequest): Promise<string> {
  const { org: slug } = parseOr400(OrgParams, req.params);
  const id = await orgBySlug(slug);
  if (!id) throw new AppError('NOT_FOUND', 'Not found', 404);
  return id;
}

type Answer = { status: 200; data: unknown } | { status: 404 } | { status: 410; what: string };

/**
 * One public JSON answer: from the epoch-keyed cache when it holds a fresh
 * one for this URL, else computed (and kept). 404 / 410 are cached too (a
 * restore bumps the epoch).
 */
async function serve(req: FastifyRequest, reply: FastifyReply, compute: () => Promise<Answer>) {
  const epoch = await currentEpoch();
  const hit = cachedAnswer(req.url, epoch, PUBLIC_CACHE_SECONDS);
  const answer = (hit?.body as Answer | undefined) ?? (await compute());
  if (!hit) storeAnswer(req.url, epoch, answer.status, answer);
  cacheHeader(reply);
  reply.header('x-public-cache', hit ? 'hit' : 'miss');
  if (answer.status === 410) return reply.code(410).send(apiError('GONE', `${answer.what} was withdrawn`, req.requestId));
  if (answer.status === 404) return reply.code(404).send(apiError('NOT_FOUND', 'Not found', req.requestId));
  return reply.code(200).send(ok(req, answer.data));
}

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  // Every route of this plugin: one token per request from the client's
  // bucket (a visitor, through the edge; the web's own server-side calls are
  // not counted: src/public-guard.ts fromTheStack).
  app.addHook('onRequest', async (req, reply) => {
    if (fromTheStack(req.raw)) return undefined;
    const t = publicRateLimiter().take(clientKey(req.ip));
    if (!t.ok) {
      reply.header('retry-after', String(t.retryAfter));
      return reply.code(429).send(apiError('RATE_LIMITED', 'too many requests; try again shortly', req.requestId));
    }
    return undefined;
  });

  /**
   * GET /v1/public/:org/spotted — the latest public looks (filters: celebrity,
   * storefront), `facets` (the celebrities and live storefronts that have
   * public looks, for the feed's filter row) and the commercial label the
   * page shows at its top (null when no listed look carries products).
   */
  app.get('/v1/public/:org/spotted', async (req, reply) => {
    const orgId = await org(req);
    const q = parseOr400(FeedQuery, req.query);
    return serve(req, reply, async () => {
      const names = await celebrityNames(orgId);
      const feed = await spottedFeed(orgId, q, Date.now(), names);
      const facets = await spottedFacets(orgId, names);
      return { status: 200, data: { ...feed, facets } };
    });
  });

  /** GET /v1/public/:org/trending — public looks ranked by clicks over the last `days` IST days (no counts). */
  app.get('/v1/public/:org/trending', async (req, reply) => {
    const orgId = await org(req);
    const q = parseOr400(TrendingQuery, req.query);
    return serve(req, reply, async () => ({ status: 200, data: await trendingLooks(orgId, q) }));
  });

  /** GET /v1/public/:org/celebrities/:slug — a celebrity's hub, only while the rights allow the name. */
  app.get('/v1/public/:org/celebrities/:slug', async (req, reply) => {
    const orgId = await org(req);
    const { slug } = parseOr400(SlugParams, req.params);
    const q = parseOr400(PageQuery, req.query);
    return serve(req, reply, async () => {
      const out = await celebrityHub(orgId, slug, q);
      if (out.kind === 'gone') return { status: 410, what: 'This page' };
      if (out.kind === 'not_found') return { status: 404 };
      return { status: 200, data: out.body };
    });
  });

  /** GET /v1/public/:org/looks/:id — one look, piece by piece (EXACT first, then SIMILAR). */
  app.get('/v1/public/:org/looks/:id', async (req, reply) => {
    const orgId = await org(req);
    const { id } = parseOr400(LookParams, req.params);
    return serve(req, reply, async () => {
      const b = await loadLookBundle(orgId, id);
      if (!b) return { status: 404 };
      const out = publicLook(b, Date.now(), await celebrityNames(orgId));
      if (out.kind === 'gone') return { status: 410, what: 'This look' };
      if (out.kind === 'not_found') return { status: 404 };
      return { status: 200, data: out.body };
    });
  });

  /**
   * GET /v1/public/:org/looks/:id/still — the look's still itself, only while
   * the look page may show it (the rights, the licence, the chain of title,
   * the frame screen: every rule, on every request). The bytes come from the
   * origin file; its address never reaches the public. 410 after a takedown
   * of a look that was public, 404 otherwise; `max-age=30`.
   */
  app.get('/v1/public/:org/looks/:id/still', async (req, reply) => {
    const orgId = await org(req);
    const { id } = parseOr400(LookParams, req.params);
    parseOr400(StillQuery, req.query);
    cacheHeader(reply);
    // The same epoch-keyed 30 s as the JSON answers (a takedown or an asset
    // change drops it at once), within a byte budget: a burst for one image
    // costs one origin fetch. Keyed by the look alone (`v` only busts the
    // browser's cache), so a made-up `v` cannot force a fetch. An origin
    // failure is never kept.
    const epoch = await currentEpoch();
    const key = `${orgId}:${id}`;
    const hit = cachedStill(key, epoch, PUBLIC_CACHE_SECONDS);
    reply.header('x-public-cache', hit ? 'hit' : 'miss');
    let answer = hit;
    if (!answer) {
      const b = await loadLookBundle(orgId, id);
      const src = b ? publicStillSource(b, Date.now(), await celebrityNames(orgId)) : ({ kind: 'not_found' } as const);
      if (src.kind === 'ok') {
        const file = await fetchStill(src.url);
        if (!file.ok) {
          reply.header('cache-control', 'no-store');
          return reply.code(502).send(apiError('UPSTREAM_UNAVAILABLE', 'the image could not be loaded', req.requestId));
        }
        answer = { epoch: epoch ?? '', at: Date.now(), status: 200, contentType: file.contentType, bytes: file.bytes };
      } else {
        answer = { epoch: epoch ?? '', at: Date.now(), status: src.kind === 'gone' ? 410 : 404, contentType: null, bytes: null };
      }
      storeStill(key, epoch, { status: answer.status, contentType: answer.contentType, bytes: answer.bytes });
    }
    if (answer.status === 410) return reply.code(410).send(apiError('GONE', 'This image was withdrawn', req.requestId));
    if (answer.status === 404 || !answer.bytes || !answer.contentType) return reply.code(404).send(apiError('NOT_FOUND', 'Not found', req.requestId));
    return reply
      .code(200)
      .header('content-type', answer.contentType)
      .header('content-length', String(answer.bytes.length))
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline')
      .send(answer.bytes);
  });

  /** GET /v1/public/:org/storefronts/:slug — an in-house page's storefront (its link-in-bio page). */
  app.get('/v1/public/:org/storefronts/:slug', async (req, reply) => {
    const orgId = await org(req);
    const { slug } = parseOr400(SlugParams, req.params);
    const q = parseOr400(PageQuery, req.query);
    return serve(req, reply, async () => {
      const out = await storefrontPage(orgId, slug, q);
      return out ? { status: 200, data: out } : { status: 404 };
    });
  });

  /** GET /v1/public/:org/sitemap — what a sitemap may list (public looks, hubs, live storefronts). */
  app.get('/v1/public/:org/sitemap', async (req, reply) => {
    const orgId = await org(req);
    return serve(req, reply, async () => ({ status: 200, data: await sitemapLists(orgId) }));
  });
}
