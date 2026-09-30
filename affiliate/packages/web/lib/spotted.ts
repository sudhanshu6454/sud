/**
 * Celebrity looks on the consumer side (the Spotted feed, a celebrity's hub,
 * a look piece by piece, a storefront): the view types, and the pure
 * mapping from the public read API's rows (packages/api/src/routes/public.ts,
 * docs/openapi.yaml "Public"). No I/O, no React, relative imports only
 * (test/spotted.test.ts runs it under node).
 *
 * Everything a page shows about a celebrity comes from the API, which has
 * already applied the rights gate: the headline (composed from structured
 * fields, never the name: "Spotted at <event>"; the name appears only in the
 * credit line with the non-endorsement line, at body size), the name only
 * while it may be shown, the still only while its
 * licence and the celebrity's rights allow it, products and links only on a
 * shoppable look, EXACT items only once a second person approved them, and
 * the wording of every item (EXACT: "The same item"; SIMILAR: "Similar
 * style. <name> did not wear or endorse this product."). The web never
 * composes celebrity copy of its own and never widens what the API sent.
 *
 * Links: only a tracked /r/<32 hex> URL ever becomes an href (trackedLinkOnly);
 * anything else the API might send is dropped (the call to action is then
 * the disabled state). No raw merchant URL exists here.
 */
import { gradientSeedFor } from './types';
import type { LookItem } from './types';

/* ---------- wire shapes (the subset the web reads) ---------- */

export interface SpottedCardRow {
  id: string;
  headline: string;
  celebrity: { name: string; slug: string };
  non_endorsement: string;
  moment: { event: string | null; place: string | null; date: string | null };
  image: { url: string | null } | null;
  source: { platform: string | null; storefront: { slug: string; name: string | null } | null };
  pieces: number;
  shoppable: boolean;
  published_at: string | null;
}

export interface FacetRow {
  slug: string;
  name: string;
  looks: number;
}

export interface SpottedPageRow {
  items: SpottedCardRow[];
  page: number;
  page_size: number;
  total: number;
  facets?: { celebrities: FacetRow[]; storefronts: FacetRow[] };
  /** The label at the top of a list page; null when no listed look carries products. */
  commercial_label?: string | null;
}

export interface TrendingRow {
  items: SpottedCardRow[];
  days: number;
}

export interface PublicOfferRow {
  id: string;
  connector: string | null;
  merchant: { name: string };
  price_minor: number | null;
  price_as_of: string | null;
  currency: string;
  stock_status: string;
  disclosure: string | null;
}

export interface PieceItemRow {
  id: string;
  match: 'exact' | 'similar';
  label: string;
  detail: string;
  product: { brand: string; model: string; category: string };
  variant: { size_text: string | null; colour: string | null };
  offer: PublicOfferRow | null;
  link: { url: string } | null;
}

export interface PieceRow {
  id: string;
  label: string;
  category: string;
  position: number;
  hotspot: { x: number | null; y: number | null } | null;
  products_shown: boolean;
  exact: PieceItemRow | null;
  similar_heading: string;
  similar: PieceItemRow[];
}

export interface PublicLookRow {
  id: string;
  headline: string;
  /** Null when the page carries no products (a name-only look). */
  commercial_label: string | null;
  celebrity: { name: string; slug: string };
  non_endorsement: string;
  moment: { event: string | null; place: string | null; date: string | null };
  image: { url: string | null; credit: string | null } | null;
  source: { platform: string | null; post_permalink: string | null; storefront: { slug: string; name: string } | null };
  display: { name: boolean; image: boolean; shoppable: boolean };
  disclosure: { sponsored: boolean; affiliate_links: boolean; amazon_associate: boolean };
  pieces: PieceRow[];
  published_at: string | null;
}

export interface HubRow {
  celebrity: { name: string; slug: string };
  commercial_label: string | null;
  non_endorsement: string;
  looks: SpottedPageRow;
}

export interface StorefrontRow {
  storefront: { slug: string; name: string; bio: string | null; platform: string; page_url: string | null };
  commercial_label: string | null;
  looks: SpottedPageRow;
}

export interface PublicSitemapRow {
  looks: Array<{ id: string; updated_at: string | null; celebrity_slug: string; image: boolean }>;
  celebrities: string[];
  storefronts: string[];
}

/* ---------- view types ---------- */

export interface Facet {
  slug: string;
  name: string;
  looks: number;
}

export interface Moment {
  event: string | null;
  place: string | null;
  /** YYYY-MM-DD */
  date: string | null;
}

export interface SpottedCard {
  id: string;
  headline: string;
  celebrity: { name: string; slug: string };
  nonEndorsement: string;
  moment: Moment;
  /** The still, only when the API allowed it; null → the gradient placeholder. */
  imageUrl: string | null;
  platform: string | null;
  storefront: { slug: string; name: string } | null;
  pieces: number;
  shoppable: boolean;
  publishedAt: string | null;
  gradientSeed: [string, string];
}

export interface SpottedFeed {
  items: SpottedCard[];
  page: number;
  pageSize: number;
  total: number;
  facets: { celebrities: Facet[]; storefronts: Facet[] };
  /** The API's commercial label for the page's top (the feed); null when the answer carried none. */
  commercialLabel: string | null;
}

/** One product of a piece: the shop's LookItem (so the Amazon copy rules apply unchanged) plus its wording. */
export interface PieceProduct extends LookItem {
  match: 'exact' | 'similar';
  /** The API's label ("The same item" / "Similar styles"). */
  wordingLabel: string;
  /** The API's line under the product (EXACT: the evidence note; SIMILAR: the non-endorsement for this item). */
  wordingDetail: string;
}

export interface OutfitPiece {
  id: string;
  label: string;
  category: string;
  position: number;
  /** 0..1 on the still, only while the still may be shown. */
  hotspot: { x: number; y: number } | null;
  productsShown: boolean;
  exact: PieceProduct | null;
  similarHeading: string;
  similar: PieceProduct[];
}

export interface CelebrityLook {
  id: string;
  headline: string;
  /** Null when the page carries no products: no label is drawn. */
  commercialLabel: string | null;
  celebrity: { name: string; slug: string };
  nonEndorsement: string;
  moment: Moment;
  image: { url: string; credit: string | null } | null;
  platform: string | null;
  postPermalink: string | null;
  storefront: { slug: string; name: string } | null;
  display: { name: boolean; image: boolean; shoppable: boolean };
  disclosure: { sponsored: boolean; affiliateLinks: boolean; amazonAssociate: boolean };
  pieces: OutfitPiece[];
  publishedAt: string | null;
  gradientSeed: [string, string];
}

export interface CelebrityHub {
  celebrity: { name: string; slug: string };
  commercialLabel: string | null;
  nonEndorsement: string;
  looks: SpottedFeed;
}

export interface StorefrontPage {
  slug: string;
  name: string;
  bio: string | null;
  platform: string;
  /** The in-house page's own address (Instagram / Facebook), when recorded. */
  pageUrl: string | null;
  commercialLabel: string | null;
  looks: SpottedFeed;
}

/* ---------- guards ---------- */

const TRACKED = /^https?:\/\/[^/?#\s]+\/r\/[0-9a-f]{32}$/;

/** A tracked redirect URL (…/r/<32 hex>) or null: nothing else ever becomes a product href. */
export function trackedLinkOnly(url: string | null | undefined): string | null {
  return typeof url === 'string' && TRACKED.test(url) ? url : null;
}

/** An https URL on Facebook or Instagram (the original post), else null. */
export function socialPostUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    const ok = ['facebook.com', 'instagram.com', 'fb.com', 'example.com'].some((d) => host === d || host.endsWith(`.${d}`));
    return ok ? u.toString() : null;
  } catch {
    return null;
  }
}

const STILL_PATH = /^\/img\/looks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\?v=[0-9a-f]{1,16})?$/i;

/**
 * The still's address: its own afflino.com path (/img/looks/<id>?v=…, the
 * web's route, which asks the API again on every request), or — in TEST
 * data — an https / http URL; anything else is null.
 */
export function imageUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  if (STILL_PATH.test(url)) return url;
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

/** A label string, or null (an empty or missing one draws no label). */
function label(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isSlug(value: string): boolean {
  return SLUG.test(value) && value.length <= 80;
}

/* ---------- mapping ---------- */

export function mapCard(r: SpottedCardRow): SpottedCard {
  const sf = r.source?.storefront;
  return {
    id: r.id,
    headline: r.headline,
    celebrity: { name: r.celebrity.name, slug: r.celebrity.slug },
    nonEndorsement: r.non_endorsement,
    moment: { event: r.moment?.event ?? null, place: r.moment?.place ?? null, date: r.moment?.date ?? null },
    imageUrl: imageUrl(r.image?.url),
    platform: r.source?.platform ?? null,
    storefront: sf && sf.slug ? { slug: sf.slug, name: sf.name ?? sf.slug } : null,
    pieces: Number(r.pieces ?? 0),
    shoppable: r.shoppable === true,
    publishedAt: r.published_at ?? null,
    gradientSeed: gradientSeedFor(r.id),
  };
}

function mapFacets(rows: FacetRow[] | undefined): Facet[] {
  return (rows ?? []).filter((f) => isSlug(f.slug)).map((f) => ({ slug: f.slug, name: f.name, looks: Number(f.looks ?? 0) }));
}

export function mapFeed(r: SpottedPageRow): SpottedFeed {
  return {
    items: (r.items ?? []).map(mapCard),
    page: r.page ?? 1,
    pageSize: r.page_size ?? 24,
    total: Number(r.total ?? 0),
    facets: { celebrities: mapFacets(r.facets?.celebrities), storefronts: mapFacets(r.facets?.storefronts) },
    commercialLabel: label(r.commercial_label),
  };
}

export function mapPieceProduct(i: PieceItemRow): PieceProduct {
  const offer = i.offer;
  const priced = !!offer && typeof offer.price_minor === 'number' && Number.isFinite(offer.price_minor);
  return {
    id: i.id,
    brand: i.product.brand,
    model: i.product.model,
    category: i.product.category,
    variant: { size: i.variant?.size_text ?? null, colour: i.variant?.colour ?? null, sku: null },
    match: i.match === 'exact' ? 'exact' : 'similar',
    evidence: null,
    available: offer !== null,
    merchant: offer ? offer.merchant.name : null,
    price_minor: priced ? (offer as PublicOfferRow).price_minor : null,
    currency: offer ? offer.currency : null,
    // The public API has no fresh_until: a price is shown only with its "as of" time.
    freshness: null,
    priceAsOf: priced ? ((offer as PublicOfferRow).price_as_of ?? null) : null,
    stock: offer ? offer.stock_status : null,
    connector: offer ? offer.connector ?? null : null,
    disclosure: offer ? offer.disclosure ?? null : null,
    linkUrl: offer ? trackedLinkOnly(i.link?.url) : null,
    wordingLabel: i.label,
    wordingDetail: i.detail,
  };
}

/**
 * Pieces worn at the head or the face get no marker on the still: a marker is
 * type, and type never sits on a face (the owner's standing rule). The piece
 * is still listed, numbered, below the still.
 */
export const NO_MARKER_CATEGORIES: readonly string[] = ['eyewear', 'headwear', 'jewellery'];

function hotspot(h: PieceRow['hotspot']): { x: number; y: number } | null {
  if (!h || typeof h.x !== 'number' || typeof h.y !== 'number') return null;
  if (h.x < 0 || h.x > 1 || h.y < 0 || h.y > 1) return null;
  return { x: h.x, y: h.y };
}

/** Pieces in the editors' order (position, then the API's order); in each, the EXACT item first, then the similar ones. */
export function mapPieces(rows: PieceRow[], showImage: boolean): OutfitPiece[] {
  return rows
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.position - b.p.position || a.i - b.i)
    .map(({ p }) => ({
      id: p.id,
      label: p.label,
      category: p.category,
      position: p.position,
      hotspot: showImage && !NO_MARKER_CATEGORIES.includes(p.category) ? hotspot(p.hotspot) : null,
      productsShown: p.products_shown === true,
      exact: p.products_shown && p.exact && p.exact.match === 'exact' ? mapPieceProduct(p.exact) : null,
      similarHeading: p.similar_heading,
      similar: p.products_shown ? (p.similar ?? []).filter((s) => s.match === 'similar').map(mapPieceProduct) : [],
    }));
}

export function mapPublicLook(r: PublicLookRow): CelebrityLook {
  const url = imageUrl(r.image?.url);
  const image = r.display?.image && url ? { url, credit: r.image?.credit ?? null } : null;
  const sf = r.source?.storefront;
  return {
    id: r.id,
    headline: r.headline,
    commercialLabel: label(r.commercial_label),
    celebrity: { name: r.celebrity.name, slug: r.celebrity.slug },
    nonEndorsement: r.non_endorsement,
    moment: { event: r.moment?.event ?? null, place: r.moment?.place ?? null, date: r.moment?.date ?? null },
    image,
    platform: r.source?.platform ?? null,
    postPermalink: socialPostUrl(r.source?.post_permalink),
    storefront: sf && sf.slug ? { slug: sf.slug, name: sf.name } : null,
    display: { name: r.display?.name === true, image: image !== null, shoppable: r.display?.shoppable === true },
    disclosure: {
      sponsored: r.disclosure?.sponsored === true,
      affiliateLinks: r.disclosure?.affiliate_links === true,
      amazonAssociate: r.disclosure?.amazon_associate === true,
    },
    pieces: mapPieces(r.pieces ?? [], image !== null),
    publishedAt: r.published_at ?? null,
    gradientSeed: gradientSeedFor(r.id),
  };
}

export function mapHub(r: HubRow): CelebrityHub {
  return {
    celebrity: { name: r.celebrity.name, slug: r.celebrity.slug },
    commercialLabel: label(r.commercial_label),
    nonEndorsement: r.non_endorsement,
    looks: mapFeed(r.looks),
  };
}

export function mapStorefront(r: StorefrontRow): StorefrontPage {
  return {
    slug: r.storefront.slug,
    name: r.storefront.name,
    bio: r.storefront.bio ?? null,
    platform: r.storefront.platform,
    pageUrl: socialPostUrl(r.storefront.page_url),
    commercialLabel: label(r.commercial_label),
    looks: mapFeed(r.looks),
  };
}

/* ---------- display helpers ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Sep 2026" from YYYY-MM-DD (the moment's day; no time, never live whereabouts). */
export function momentDate(date: string | null): string | null {
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}

/** "Demo Film Premiere · Demo City · 12 Sep 2026" (the parts that exist). */
export function momentLine(m: Moment): string {
  return [m.event, m.place, momentDate(m.date)].filter((x): x is string => !!x && x.trim() !== '').join(' · ');
}

/** "3 pieces" / "1 piece". */
export function pieceCount(n: number): string {
  return `${n} ${n === 1 ? 'piece' : 'pieces'}`;
}

/** Garment categories arrive as codes (t_shirt, co_ord_set); display them in words. */
export function categoryLabel(code: string): string {
  const special: Record<string, string> = { t_shirt: 'T-shirt', co_ord_set: 'Co-ord set', ethnic_set: 'Ethnic set' };
  if (special[code]) return special[code] as string;
  const words = code.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : code;
}

/** The platform of an in-house page in words. */
export function platformLabel(platform: string | null): string | null {
  if (platform === 'instagram') return 'Instagram';
  if (platform === 'facebook') return 'Facebook';
  if (platform === 'web') return 'the web';
  return null;
}

/** The feed's query string (celebrity, page of origin, page number), without empty parts. */
export function feedQuery(q: { celebrity?: string | null; from?: string | null; p?: number | null }): string {
  const parts: string[] = [];
  if (q.celebrity && isSlug(q.celebrity)) parts.push(`celebrity=${encodeURIComponent(q.celebrity)}`);
  if (q.from && isSlug(q.from)) parts.push(`from=${encodeURIComponent(q.from)}`);
  if (q.p && q.p > 1) parts.push(`p=${q.p}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** A search parameter as one valid slug (or null). */
export function slugParam(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && isSlug(s) ? s : null;
}

/** A search parameter as a page number (1..10000), default 1. */
export function pageParam(v: string | string[] | undefined): number {
  const s = Array.isArray(v) ? v[0] : v;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

/** Pages of a feed (at least 1). */
export function pageTotal(feed: Pick<SpottedFeed, 'total' | 'pageSize'>): number {
  return Math.max(1, Math.ceil(feed.total / Math.max(1, feed.pageSize)));
}

/** The cache tags of a page (the API's revalidation call names these; app/internal/revalidate). */
export const TAGS = {
  spotted: 'spotted',
  sitemap: 'sitemap',
  look: (id: string) => `look:${id}`,
  celebrity: (slug: string) => `celebrity:${slug}`,
  storefront: (slug: string) => `storefront:${slug}`,
} as const;

/** A tag the revalidation endpoint accepts. */
export function isCacheTag(tag: unknown): tag is string {
  return (
    typeof tag === 'string' &&
    (tag === 'spotted' ||
      tag === 'sitemap' ||
      tag === 'catalogue' ||
      /^look:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(tag) ||
      /^(celebrity|storefront):[a-z0-9]+(-[a-z0-9]+)*$/.test(tag)) &&
    tag.length <= 100
  );
}

/** The public endpoint (under /v1/public/<org>) that says whether a page was withdrawn (410), for the middleware; null for other paths. */
export function withdrawalProbePath(pathname: string): string | null {
  const look = /^\/looks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/.*)?$/i.exec(pathname);
  if (look) return `/looks/${(look[1] as string).toLowerCase()}`;
  const hub = /^\/c\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(pathname);
  if (hub && isSlug(hub[1] as string)) return `/celebrities/${hub[1]}`;
  return null;
}
