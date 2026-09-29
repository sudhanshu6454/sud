/**
 * View types for the consumer shop. Both the live catalogue client
 * (lib/catalogue.ts) and the TEST-labelled mock data (lib/mock-data.ts) map
 * onto these shapes, so pages and components never see wire rows.
 *
 * Money is integer minor units with an explicit currency (paise for INR);
 * nothing here ever holds a raw merchant URL — `linkUrl` is always the
 * tracked redirect (`/r/{token}`) or null.
 */

export type Match = 'exact' | 'similar';

/** Known `offers.stock_status` values; the column is free text so unknown values pass through. */
export type Stock = 'in_stock' | 'low_stock' | 'out_of_stock' | string;

export interface LookSummary {
  id: string;
  title: string;
  /** null when the look was published without a category */
  category: string | null;
  locale: string;
  /** Where the look was spotted (looks.source_page); null when not recorded. */
  sourcePage: string | null;
  /** ASCI "Sponsored" flag (looks.sponsored). */
  sponsored: boolean;
  /** assets.public_url of the cover asset, or null → gradient placeholder. */
  coverUrl: string | null;
  /** two CSS colours seeding the gradient placeholder (derived from the id). */
  gradientSeed: [string, string];
  /** ISO timestamp or null. */
  publishedAt: string | null;
  itemCount: number;
}

export interface LookItem {
  /** look_items.id — the "product id" in URLs (/looks/[id]/items/[itemId]). */
  id: string;
  brand: string;
  model: string;
  category: string;
  variant: { size: string | null; colour: string | null; sku: string | null };
  match: Match | null;
  evidence: string | null;
  /** true when a live offer exists; false → "Not available right now" (no price, no CTA). */
  available: boolean;
  merchant: string | null;
  /**
   * null for an item without a live offer, AND for a live offer whose price
   * may not be shown (Amazon: no product-API price younger than 1 hour —
   * the API already nulls it; the page then says "See price on Amazon.in").
   */
  price_minor: number | null;
  currency: string | null;
  /** ISO timestamp of offer.fresh_until (when the offer stops being linkable). */
  freshness: string | null;
  /**
   * ISO time the shown price was read from the merchant's product API
   * (offer.price_as_of); null when there is no such time. A price with a
   * time is shown with it ("as of … IST") and is never stored (/saved).
   */
  priceAsOf: string | null;
  stock: Stock | null;
  /** The offer's programme connector (offer.connector: 'amazon-associates', …); null without a live offer. */
  connector: string | null;
  /** The programme's own disclosure statement (offer.disclosure); null when it has none. */
  disclosure: string | null;
  /** Tracked redirect URL (`{REDIRECT_BASE_URL}/r/{token}`) or null when no link is minted yet. */
  linkUrl: string | null;
}

export interface LookDetail extends LookSummary {
  items: LookItem[];
}

/** What the catalogue client hands to pages: the value plus whether it is demo data. */
export interface CatalogueResult<T> {
  value: T;
  /** true → the page MUST render <DemoBadge />. */
  demo: boolean;
  /**
   * The API failed (network, 5xx, 401 …) and the demo catalogue has no entry
   * for this id either: the page must render the outage (error boundary,
   * "temporarily unavailable"), never a 404 — the look may well exist.
   */
  outage?: boolean;
}

/**
 * Deterministic gradient seed for a look id, so placeholders are stable
 * across renders without storing colours anywhere.
 */
const PALETTE: ReadonlyArray<[string, string]> = [
  ['#1e3a8a', '#9333ea'],
  ['#7c2d12', '#b45309'],
  ['#0f766e', '#164e63'],
  ['#4a044e', '#be185d'],
  ['#1f2937', '#0ea5e9'],
  ['#365314', '#0d9488'],
];

export function gradientSeedFor(id: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const pair = PALETTE[hash % PALETTE.length] ?? PALETTE[0]!;
  return [pair[0], pair[1]];
}
