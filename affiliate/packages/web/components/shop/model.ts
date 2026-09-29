/**
 * Pure display rules for the consumer shop (/shop, /looks/*, /saved). No
 * React, no '@/' imports (the root vitest config has no alias), so
 * test/shop.test.ts exercises them directly.
 */
import { timeAgo } from '../../lib/format';
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
