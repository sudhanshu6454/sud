/**
 * Pure display rules for the consumer shop (/shop, /looks/*, /saved). No
 * React, no '@/' imports (the root vitest config has no alias), so
 * test/shop.test.ts exercises them directly.
 */
import { timeAgo } from '../../lib/format';
import { AMAZON_IN } from '../../lib/site-copy';
import type { LookItem, LookSummary, Match, Stock } from '../../lib/types';

/* ---------- grid: categories, search, sort ---------- */

/** Distinct categories of the loaded looks (case-insensitive), A–Z, first spelling wins. */
export function lookCategories(looks: ReadonlyArray<LookSummary>): string[] {
  const seen = new Map<string, string>();
  for (const l of looks) {
    const c = l.category?.trim();
    if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Search (title, source page, category; case-insensitive substring) and one
 * category. The list endpoint has no search parameter, so this runs over the
 * already-loaded list.
 */
export function filterLooks(
  looks: ReadonlyArray<LookSummary>,
  { query, category }: { query: string; category: string | null },
): LookSummary[] {
  const q = query.trim().toLowerCase();
  const cat = category?.toLowerCase() ?? null;
  return looks.filter((l) => {
    if (cat !== null && (l.category ?? '').toLowerCase() !== cat) return false;
    if (!q) return true;
    return (
      l.title.toLowerCase().includes(q) ||
      (l.sourcePage ?? '').toLowerCase().includes(q) ||
      (l.category ?? '').toLowerCase().includes(q)
    );
  });
}

export type LookSort = 'newest' | 'most-products' | 'title';

/** The "Sort:" choices (1d's "Sort: Highest payout" slot). The list carries no prices, so there is no price sort. */
export const LOOK_SORTS: ReadonlyArray<{ value: LookSort; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'most-products', label: 'Most products' },
  { value: 'title', label: 'Title A–Z' },
];

function publishedMs(l: LookSummary): number {
  const t = l.publishedAt ? new Date(l.publishedAt).getTime() : Number.NaN;
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Stable sort; ties (and looks without a publish time, which sort last on "Newest") keep the API's order. */
export function sortLooks(looks: ReadonlyArray<LookSummary>, sort: LookSort): LookSummary[] {
  const indexed = looks.map((look, i) => ({ look, i }));
  const cmp = (a: { look: LookSummary; i: number }, b: { look: LookSummary; i: number }): number => {
    let d = 0;
    if (sort === 'newest') {
      const pa = publishedMs(a.look);
      const pb = publishedMs(b.look);
      d = pa === pb ? 0 : pb > pa ? 1 : -1;
    } else if (sort === 'most-products') {
      d = b.look.itemCount - a.look.itemCount;
    } else {
      d = a.look.title.localeCompare(b.look.title);
    }
    return d !== 0 ? d : a.i - b.i;
  };
  return indexed.sort(cmp).map((x) => x.look);
}

/* ---------- labels ---------- */

/** "1 product" / "2 products". */
export function productCount(n: number): string {
  return `${n} ${n === 1 ? 'product' : 'products'}`;
}

/** "Demo Kaya — Oversized Wool-Blend Blazer". */
export function itemName(item: Pick<LookItem, 'brand' | 'model'>): string {
  return `${item.brand} — ${item.model}`;
}

/** Product categories arrive lower-case ("apparel"); display them in sentence case ("Apparel"). */
export function displayCategory(category: string): string {
  const c = category.trim();
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : c;
}

/** "Published 2h ago"; null without a (valid) publish time. */
export function publishedLabel(iso: string | null, now: Date = new Date()): string | null {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return null;
  return `Published ${timeAgo(iso, now)}`;
}

/** Size and colour of the matched variant ("Size M", "Charcoal"); the SKU is a separate fact. */
export function variantFacts(variant: LookItem['variant']): string[] {
  const facts: string[] = [];
  if (variant.size) facts.push(`Size ${variant.size}`);
  if (variant.colour) facts.push(variant.colour);
  return facts;
}

export type TagTone = 'accent' | 'neutral' | 'outline';

/** Match verdict as a tag: exact → accent, similar → neutral, no verdict → outline (a review state). */
export function matchTag(match: Match | null): { label: string; tone: TagTone } {
  if (match === 'exact') return { label: 'Exact item', tone: 'accent' };
  if (match === 'similar') return { label: 'Similar style', tone: 'neutral' };
  return { label: 'Unverified match', tone: 'outline' };
}

/** Out of stock is the one stock state that is emphasised (accent-700 text). */
export function stockIsOut(stock: Stock | null): boolean {
  return stock === 'out_of_stock';
}

/**
 * The stock status worth showing: 'unknown' (an Amazon offer whose
 * availability may not be shown, or one never refreshed) is no fact, so it
 * is not shown at all.
 */
export function shownStock(item: Pick<LookItem, 'available' | 'stock'>): Stock | null {
  if (!item.available || !item.stock || item.stock === 'unknown') return null;
  return item.stock;
}

/* ---------- merchant copy: Amazon.in vs the rest ---------- */

/** A live offer of an Amazon.in Associates programme. */
export function isAmazonOffer(item: Pick<LookItem, 'available' | 'connector'>): boolean {
  return item.available && item.connector === AMAZON_IN.connector;
}

export interface OfferCopy {
  /** The call to action's label. */
  ctaLabel: string;
  /** Shown instead of a price for a live offer without one. */
  noPriceLabel: string;
  /** The label over the price. */
  priceLabel: string;
  /** Shown beside a time-stamped price (null = none). */
  priceDisclaimer: string | null;
  /** Programme disclosures shown near the call to action (deduplicated, in order). */
  disclosures: string[];
  /** Amazon's attribution line, whenever Amazon product-API content (a price) is shown. */
  contentAttribution: string | null;
  /** The line under the item page's button: where the purchase happens. */
  purchaseNote: string;
}

/**
 * The disclosures of an Amazon offer: OA §10's statement ALWAYS, first and
 * verbatim, then whatever the operator's programme disclosure adds to it
 * (the setup refuses a disclosure without the statement, so only the rest
 * is shown; it never replaces the statement).
 */
function amazonDisclosures(disclosure: string | null | undefined): string[] {
  const extra = (disclosure ?? '').replace(AMAZON_IN.associateStatement, '').trim();
  return extra ? [AMAZON_IN.associateStatement, extra] : [AMAZON_IN.associateStatement];
}

/**
 * What the shop says around an offer. Amazon.in (lib/site-copy.ts AMAZON_IN):
 * "Buy on Amazon.in", "See price on Amazon.in" when no API price younger than
 * 1 hour exists (the API nulls it), "Amazon.in Price" with its "as of … IST"
 * time, the price disclaimer and the attribution line when one does, OA
 * §10's Associate statement always (the programme's own disclosure only
 * after it), and where the purchase happens. Other merchants keep the shop's
 * generic copy.
 */
export function offerCopy(
  item: Pick<LookItem, 'available' | 'connector' | 'merchant' | 'price_minor' | 'currency' | 'priceAsOf' | 'disclosure'>,
): OfferCopy {
  const priced = hasPrice(item);
  const stamped = priced && item.priceAsOf !== null;
  if (isAmazonOffer(item)) {
    return {
      ctaLabel: AMAZON_IN.ctaLabel,
      noPriceLabel: AMAZON_IN.noPriceLabel,
      priceLabel: AMAZON_IN.pricePrefix,
      priceDisclaimer: stamped ? AMAZON_IN.priceDisclaimer : null,
      disclosures: amazonDisclosures(item.disclosure),
      contentAttribution: stamped ? AMAZON_IN.contentAttribution : null,
      purchaseNote: AMAZON_IN.purchaseNote,
    };
  }
  return {
    ctaLabel: 'View at merchant',
    noPriceLabel: item.merchant ? `See the current price at ${item.merchant}` : 'See the current price at the merchant',
    priceLabel: 'Price',
    priceDisclaimer: null,
    disclosures: item.available && item.disclosure?.trim() ? [item.disclosure.trim()] : [],
    contentAttribution: null,
    purchaseNote:
      item.merchant && item.available
        ? `Payment, delivery and returns are handled by ${item.merchant}.`
        : 'Payment, delivery and returns are handled by the merchant.',
  };
}

/**
 * The look page's last fact. A look with Amazon (affiliate) items does not
 * say "Sponsored: No" — every product on it is a commissioned link — but
 * "Affiliate links: Yes (we earn from qualifying purchases)" (help
 * GPXFHVYZMTGPUMPE: "a legally compliant disclosure with your links"; the
 * ASCI reading is counsel's). Other looks keep their sponsorship fact.
 */
export function lookRelationshipFact(
  look: { sponsored: boolean },
  items: ReadonlyArray<Pick<LookItem, 'available' | 'connector'>>,
): [string, string] {
  if (items.some((i) => i.connector === AMAZON_IN.connector)) {
    return [AMAZON_IN.affiliateLinksFactLabel, AMAZON_IN.affiliateLinksFact];
  }
  return ['Sponsored', look.sponsored ? 'Yes' : 'No'];
}

/** Every item's programme disclosures and attribution lines, once each, in item order (the look page's panel). */
export function lookDisclosures(items: ReadonlyArray<Parameters<typeof offerCopy>[0]>): { disclosures: string[]; attributions: string[] } {
  const disclosures: string[] = [];
  const attributions: string[] = [];
  for (const i of items) {
    const c = offerCopy(i);
    for (const d of c.disclosures) if (!disclosures.includes(d)) disclosures.push(d);
    if (c.contentAttribution && !attributions.includes(c.contentAttribution)) attributions.push(c.contentAttribution);
  }
  return { disclosures, attributions };
}

/**
 * The price a wishlist entry may keep: none for a time-limited price (one
 * with a product-API time, and every Amazon offer — a product-API price may
 * be shown for 1 hour, OA §11 lets one be stored for 24 hours at most), else
 * the live price.
 */
export function storablePrice(
  item: Pick<LookItem, 'available' | 'connector' | 'price_minor' | 'priceAsOf'>,
): { price_minor: number | null; priceNotStored: boolean } {
  if (item.priceAsOf !== null || isAmazonOffer(item)) return { price_minor: null, priceNotStored: true };
  return { price_minor: item.available ? item.price_minor : null, priceNotStored: false };
}

/* ---------- the merchant call to action ---------- */

export type CtaState =
  /** No live offer: "Not available right now" (no price, no CTA). */
  | { kind: 'unavailable' }
  /** Live offer, no minted link: the visibly disabled "Link not available yet". */
  | { kind: 'disabled' }
  /** Live offer with its tracked /r/{token} link — the only href the shop ever renders. */
  | { kind: 'link'; href: string };

export function ctaState(item: Pick<LookItem, 'available' | 'linkUrl'>): CtaState {
  if (!item.available) return { kind: 'unavailable' };
  if (item.linkUrl) return { kind: 'link', href: item.linkUrl };
  return { kind: 'disabled' };
}

/** A live item with a price to show (the API only prices items that have a live offer). */
export function hasPrice(
  item: Pick<LookItem, 'available' | 'price_minor' | 'currency'>,
): item is Pick<LookItem, 'available'> & { price_minor: number; currency: string } {
  return item.available && item.price_minor !== null && item.currency !== null && item.currency !== '';
}

/* ---------- demo detection for the wishlist ---------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Live look ids are uuids (the API answers a non-uuid id with 400), so a saved
 * entry whose look id is not one was saved from the TEST demo catalogue.
 */
export function isDemoLookId(lookId: string): boolean {
  return !UUID.test(lookId);
}
