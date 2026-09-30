/**
 * SERVER-ONLY client of the public read API for celebrity looks
 * (packages/api/src/routes/public.ts): the Spotted feed and its facets, the
 * trending row, one look piece by piece, a celebrity's hub, a storefront,
 * the sitemap lists. Import it only from server components and route
 * handlers (by convention, like lib/catalogue.ts; test/shop.test.ts checks
 * no client component imports it).
 *
 * No token: the organisation is its public slug (PUBLIC_ORG_SLUG, default
 * "afflino", the in-house network's organisation). Every fetch carries
 * cache tags (lib/spotted.ts TAGS) and `revalidate: 30` — the API's own
 * `max-age=30` — so a takedown's revalidation call
 * (app/internal/revalidate) drops the cached answers at once, and without
 * that call they expire within 30 s.
 *
 * Outcomes: ok (live), gone (410: withdrawn under a takedown — the page
 * shows the withdrawn notice, the middleware answers 410), miss (404: never
 * public, or not a celebrity look), outage (anything else). On an outage the
 * feed, hub, look and storefront fall back to the TEST demo data only for
 * the demo's own ids and slugs (lib/mock-spotted.ts) — never for a live id.
 */
import { apiBase, publicOrgSlug } from './server-env';
import { mockCelebrityLook, mockHub, mockSpotted, mockStorefront, mockTrending } from './mock-spotted';
import {
  TAGS,
  isSlug,
  mapCard,
  mapFeed,
  mapHub,
  mapPublicLook,
  mapStorefront,
  type CelebrityHub,
  type CelebrityLook,
  type HubRow,
  type PublicLookRow,
  type PublicSitemapRow,
  type SpottedCard,
  type SpottedFeed,
  type SpottedPageRow,
  type StorefrontPage,
  type StorefrontRow,
  type TrendingRow,
} from './spotted';

export const PUBLIC_REVALIDATE_SECONDS = 30;
export const FEED_PAGE_SIZE = 24;

export type PublicOutcome<T> =
  | { kind: 'ok'; value: T; demo: boolean }
  | { kind: 'gone' }
  | { kind: 'miss' }
  | { kind: 'outage' };

interface Answer<T> {
  status: number;
  data: T | null;
}

/** One GET on the public API; never throws (an unreachable API is status 0). */
async function publicGet<T>(path: string, tags: string[]): Promise<Answer<T>> {
  try {
    const res = await fetch(`${apiBase()}/v1/public/${publicOrgSlug()}${path}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS, tags },
    });
    if (!res.ok) return { status: res.status, data: null };
    const body = (await res.json().catch(() => null)) as { data?: T } | null;
    if (!body || body.data === undefined) return { status: 0, data: null };
    return { status: res.status, data: body.data };
  } catch {
    return { status: 0, data: null };
  }
}

function outcome<W, T>(a: Answer<W>, map: (w: W) => T): PublicOutcome<T> {
  if (a.status === 200 && a.data !== null) return { kind: 'ok', value: map(a.data), demo: false };
  if (a.status === 410) return { kind: 'gone' };
  if (a.status === 404 || a.status === 400) return { kind: 'miss' };
  return { kind: 'outage' };
}

export interface FeedQuery {
  celebrity?: string | null;
  /** A storefront's slug: the in-house page the looks came from. */
  from?: string | null;
  page?: number;
}

/** The Spotted feed (newest first) with its facets; the TEST demo feed when the API is unreachable. */
export async function getSpotted(q: FeedQuery = {}): Promise<{ value: SpottedFeed; demo: boolean }> {
  const params = new URLSearchParams({ page: String(q.page ?? 1), page_size: String(FEED_PAGE_SIZE) });
  if (q.celebrity && isSlug(q.celebrity)) params.set('celebrity', q.celebrity);
  if (q.from && isSlug(q.from)) params.set('storefront', q.from);
  const tags: string[] = [TAGS.spotted];
  if (q.celebrity) tags.push(TAGS.celebrity(q.celebrity));
  if (q.from) tags.push(TAGS.storefront(q.from));
  const res = outcome(await publicGet<SpottedPageRow>(`/spotted?${params.toString()}`, tags), mapFeed);
  if (res.kind === 'ok') return { value: res.value, demo: false };
  if (res.kind === 'outage') return { value: mockSpotted({ celebrity: q.celebrity ?? null, from: q.from ?? null }), demo: true };
  return { value: { items: [], page: 1, pageSize: FEED_PAGE_SIZE, total: 0, facets: { celebrities: [], storefronts: [] }, commercialLabel: null }, demo: false };
}

/** The trending row (ranked by clicks over the last 7 IST days; no counts). */
export async function getTrending(): Promise<{ value: SpottedCard[]; demo: boolean }> {
  const res = outcome(await publicGet<TrendingRow>('/trending?days=7&limit=8', [TAGS.spotted]), (r) => (r.items ?? []).map(mapCard));
  if (res.kind === 'ok') return { value: res.value, demo: false };
  if (res.kind === 'outage') return { value: mockTrending(), demo: true };
  return { value: [], demo: false };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One celebrity look. A non-uuid id is a miss unless it is a demo id (the
 * demo look, with `demo: true`, only while the API is unreachable or for
 * the demo's own ids).
 */
export async function getPublicLook(id: string): Promise<PublicOutcome<CelebrityLook>> {
  if (!UUID.test(id)) {
    const mock = mockCelebrityLook(id);
    return mock ? { kind: 'ok', value: mock, demo: true } : { kind: 'miss' };
  }
  return outcome(await publicGet<PublicLookRow>(`/looks/${id}`, [TAGS.look(id), TAGS.spotted]), mapPublicLook);
}

/** A celebrity's hub (only while the name may be shown; 410 under a takedown). */
export async function getCelebrityHub(slug: string, page = 1): Promise<PublicOutcome<CelebrityHub>> {
  if (!isSlug(slug)) return { kind: 'miss' };
  const res = outcome(
    await publicGet<HubRow>(`/celebrities/${slug}?page=${page}&page_size=${FEED_PAGE_SIZE}`, [TAGS.celebrity(slug), TAGS.spotted]),
    mapHub,
  );
  if (res.kind === 'outage') {
    const mock = mockHub(slug);
    return mock ? { kind: 'ok', value: mock, demo: true } : res;
  }
  return res;
}

/** An in-house page's storefront (live, approved, owner-operated pages only). */
export async function getStorefront(slug: string, page = 1): Promise<PublicOutcome<StorefrontPage>> {
  if (!isSlug(slug)) return { kind: 'miss' };
  const res = outcome(
    await publicGet<StorefrontRow>(`/storefronts/${slug}?page=${page}&page_size=${FEED_PAGE_SIZE}`, [TAGS.storefront(slug), TAGS.spotted]),
    mapStorefront,
  );
  if (res.kind === 'outage') {
    const mock = mockStorefront(slug);
    return mock ? { kind: 'ok', value: mock, demo: true } : res;
  }
  return res;
}

/** What the sitemap may list (never demo data: an outage lists nothing). */
export async function getPublicSitemap(): Promise<PublicSitemapRow | null> {
  const a = await publicGet<PublicSitemapRow>('/sitemap', [TAGS.sitemap]);
  return a.status === 200 && a.data ? a.data : null;
}
