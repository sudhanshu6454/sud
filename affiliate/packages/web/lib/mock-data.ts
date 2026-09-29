/**
 * Mock catalogue data — STUBBED, no API wiring yet (phase 2).
 * Prices are in paise (INR minor units): 249900 = ₹2,499.
 */

export type Match = 'exact' | 'similar';
export type Stock = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface Product {
  id: string;
  brand: string;
  model: string;
  price_minor: number;
  merchant: string;
  match: Match;
  freshness: string; // ISO timestamp of last price check
  stock: Stock;
}

export interface Look {
  id: string;
  title: string;
  category: 'Fashion' | 'Footwear' | 'Bags' | 'Accessories';
  locale: 'en' | 'hi';
  /** two CSS colors used as the gradient seed for the media placeholder */
  gradientSeed: [string, string];
  sourcePage: string;
  sponsored: boolean;
  productIds: string[];
}

const H = 60 * 60 * 1000;
const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

export const products: Product[] = [
  {
    id: 'p1',
    brand: 'Aurelia',
    model: 'Court Classic White Sneakers',
    price_minor: 499900,
    merchant: 'Flipkart',
    match: 'exact',
    freshness: iso(2 * H),
    stock: 'in_stock',
  },
  {
    id: 'p2',
    brand: 'Verde',
    model: 'Milano Suede Loafers',
    price_minor: 349900,
    merchant: 'Myntra',
    match: 'similar',
    freshness: iso(6 * H),
    stock: 'in_stock',
  },
  {
    id: 'p3',
    brand: 'Kaya',
    model: 'Oversized Wool-Blend Blazer',
    price_minor: 899900,
    merchant: 'Ajio',
    match: 'exact',
    freshness: iso(1 * H),
    stock: 'in_stock',
  },
  {
    id: 'p4',
    brand: 'Isha',
    model: 'Champagne Silk Slip Dress',
    price_minor: 659900,
    merchant: 'Myntra',
    match: 'similar',
    freshness: iso(3 * H),
    stock: 'low_stock',
  },
  {
    id: 'p5',
    brand: 'Zaveri & Co.',
    model: '18K Gold-Plated Hoop Earrings',
    price_minor: 129900,
    merchant: 'Amazon India',
    match: 'exact',
    freshness: iso(5 * H),
    stock: 'in_stock',
  },
  {
    id: 'p6',
    brand: 'Mira',
    model: 'Roma Mini Shoulder Bag',
    price_minor: 549900,
    merchant: 'Ajio',
    match: 'similar',
    freshness: iso(8 * H),
    stock: 'out_of_stock',
  },
];

export const looks: Look[] = [
  {
    id: 'look-1',
    title: 'Airport street style',
    category: 'Fashion',
    locale: 'en',
    gradientSeed: ['#1e3a8a', '#9333ea'],
    sourcePage: 'Candid Frames',
    sponsored: true,
    productIds: ['p3', 'p1'],
  },
  {
    id: 'look-2',
    title: 'Red-carpet evening look',
    category: 'Accessories',
    locale: 'en',
    gradientSeed: ['#7c2d12', '#b45309'],
    sourcePage: 'Star Sightings',
    sponsored: false,
    productIds: ['p4', 'p5'],
  },
  {
    id: 'look-3',
    title: 'Monsoon city stroll',
    category: 'Footwear',
    locale: 'en',
    gradientSeed: ['#0f766e', '#164e63'],
    sourcePage: 'Candid Frames',
    sponsored: false,
    productIds: ['p2', 'p6'],
  },
];

export function getLook(id: string): Look | undefined {
  return looks.find((l) => l.id === id);
}

export function getProduct(id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

export function getProductsForLook(look: Look): Product[] {
  return look.productIds
    .map((pid) => getProduct(pid))
    .filter((p): p is Product => p !== undefined);
}

export function stockLabel(stock: Stock): string {
  switch (stock) {
    case 'in_stock':
      return 'In stock';
    case 'low_stock':
      return 'Low stock';
    case 'out_of_stock':
      return 'Out of stock';
  }
}
