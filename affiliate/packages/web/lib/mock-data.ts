/**
 * TEST-LABELLED demo catalogue, used only when the live API is not
 * configured (no WEB_API_TOKEN) or fails. Every merchant, brand and page
 * name is prefixed "Demo" — none of them is a real merchant or handle.
 * Prices are in paise (INR minor units): 249900 = ₹2,499.
 *
 * Whenever a page renders this data it also renders <DemoBadge />.
 * No merchant URLs exist here either: demo items have `linkUrl: null`
 * ("Link not available yet"), exactly like a live item without a minted link.
 */
import type { LookDetail, LookItem, LookSummary, Match, Stock } from './types';

const H = 60 * 60 * 1000;
const now = Date.now();
const fresh = (msAhead: number) => new Date(now + msAhead).toISOString();
const past = (msAgo: number) => new Date(now - msAgo).toISOString();

interface MockProduct {
  id: string;
  brand: string;
  model: string;
  category: string;
  size: string | null;
  colour: string | null;
  price_minor: number;
  merchant: string;
  match: Match;
  freshness: string;
  stock: Stock;
  /** false → rendered as "Not available right now" (no offer). */
  available?: boolean;
}

const products: MockProduct[] = [
  {
    id: 'p1',
    brand: 'Demo Aurelia',
    model: 'Court Classic White Sneakers',
    category: 'footwear',
    size: 'UK 8',
    colour: 'White',
    price_minor: 499900,
    merchant: 'Demo Merchant One',
    match: 'exact',
    freshness: fresh(22 * H),
    stock: 'in_stock',
  },
  {
    id: 'p2',
    brand: 'Demo Verde',
    model: 'Milano Suede Loafers',
    category: 'footwear',
    size: 'UK 9',
    colour: 'Tan',
    price_minor: 349900,
    merchant: 'Demo Merchant Two',
    match: 'similar',
    freshness: fresh(18 * H),
    stock: 'in_stock',
  },
  {
    id: 'p3',
    brand: 'Demo Kaya',
    model: 'Oversized Wool-Blend Blazer',
    category: 'apparel',
    size: 'M',
    colour: 'Charcoal',
    price_minor: 899900,
    merchant: 'Demo Merchant Three',
    match: 'exact',
    freshness: fresh(23 * H),
    stock: 'in_stock',
  },
  {
    id: 'p4',
    brand: 'Demo Isha',
    model: 'Champagne Silk Slip Dress',
    category: 'apparel',
    size: 'S',
    colour: 'Champagne',
    price_minor: 659900,
    merchant: 'Demo Merchant Two',
    match: 'similar',
    freshness: fresh(21 * H),
    stock: 'low_stock',
  },
  {
    id: 'p5',
    brand: 'Demo Zaveri',
    model: '18K Gold-Plated Hoop Earrings',
    category: 'accessories',
    size: null,
    colour: 'Gold',
    price_minor: 129900,
    merchant: 'Demo Merchant One',
    match: 'exact',
    freshness: fresh(19 * H),
    stock: 'in_stock',
  },
  {
    id: 'p6',
    brand: 'Demo Mira',
    model: 'Roma Mini Shoulder Bag',
    category: 'bags',
    size: null,
    colour: 'Black',
    price_minor: 549900,
    merchant: 'Demo Merchant Three',
    match: 'similar',
    freshness: fresh(16 * H),
    stock: 'out_of_stock',
    available: false,
  },
];

interface MockLook {
  id: string;
  title: string;
  category: string;
  locale: string;
  gradientSeed: [string, string];
  sourcePage: string;
  sponsored: boolean;
  publishedAt: string;
  productIds: string[];
}

const looks: MockLook[] = [
  {
    id: 'look-1',
    title: 'Demo airport street style',
    category: 'Fashion',
    locale: 'en',
    gradientSeed: ['#1e3a8a', '#9333ea'],
    sourcePage: 'Demo Candid Frames',
    sponsored: true,
    publishedAt: past(2 * H),
    productIds: ['p3', 'p1'],
  },
  {
    id: 'look-2',
    title: 'Demo red-carpet evening look',
    category: 'Accessories',
    locale: 'en',
    gradientSeed: ['#7c2d12', '#b45309'],
    sourcePage: 'Demo Star Sightings',
    sponsored: false,
    publishedAt: past(26 * H),
    productIds: ['p4', 'p5'],
  },
  {
    id: 'look-3',
    title: 'Demo monsoon city stroll',
    category: 'Footwear',
    locale: 'en',
    gradientSeed: ['#0f766e', '#164e63'],
    sourcePage: 'Demo Candid Frames',
    sponsored: false,
    publishedAt: past(50 * H),
    productIds: ['p2', 'p6'],
  },
];

function toItem(p: MockProduct): LookItem {
  const available = p.available !== false;
  return {
    id: p.id,
    brand: p.brand,
    model: p.model,
    category: p.category,
    variant: { size: p.size, colour: p.colour, sku: null },
    match: p.match,
    evidence: null,
    available,
    merchant: available ? p.merchant : null,
    price_minor: available ? p.price_minor : null,
    currency: available ? 'INR' : null,
    freshness: available ? p.freshness : null,
    stock: available ? p.stock : null,
    linkUrl: null,
  };
}

function toSummary(l: MockLook): LookSummary {
  return {
    id: l.id,
    title: l.title,
    category: l.category,
    locale: l.locale,
    sourcePage: l.sourcePage,
    sponsored: l.sponsored,
    coverUrl: null,
    gradientSeed: l.gradientSeed,
    publishedAt: l.publishedAt,
    itemCount: l.productIds.length,
  };
}

export function mockLooks(): LookSummary[] {
  return looks.map(toSummary);
}

export function mockLook(id: string): LookDetail | null {
  const l = looks.find((x) => x.id === id);
  if (!l) return null;
  const items = l.productIds
    .map((pid) => products.find((p) => p.id === pid))
    .filter((p): p is MockProduct => p !== undefined)
    .map(toItem);
  return { ...toSummary(l), items };
}

/**
 * Demo candidate lookup for the editorial console's local (non-API) review
 * board, whose seeded candidates reference the ids p1…p6 above.
 */
export function getProduct(id: string): { id: string; brand: string; model: string; merchant: string; match: Match } | undefined {
  const p = products.find((x) => x.id === id);
  return p ? { id: p.id, brand: p.brand, model: p.model, merchant: p.merchant, match: p.match } : undefined;
}
