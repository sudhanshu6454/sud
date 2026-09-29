import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LookCard from '../components/LookCard';
import LookGrid from '../components/LookGrid';
import MatchBadge from '../components/MatchBadge';
import MerchantCta from '../components/MerchantCta';
import { ItemRow } from '../components/shop/ItemRow';
import {
  ctaState,
  displayCategory,
  filterLooks,
  hasPrice,
  isDemoLookId,
  itemName,
  lookCategories,
  LOOK_SORTS,
  matchTag,
  productCount,
  publishedLabel,
  sortLooks,
  stockIsOut,
  variantFacts,
} from '../components/shop/model';
import { mockLook, mockLooks } from '../lib/mock-data';
import type { LookItem, LookSummary } from '../lib/types';

// The components compile with the classic JSX transform under vitest (the
// package's tsconfig says "preserve"), which reads a global React.
(globalThis as { React?: typeof React }).React = React;

const WEB = join(__dirname, '..');
const LINK = 'https://go.example.com/r/0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-09-29T12:00:00.000Z');

const look = (over: Partial<LookSummary>): LookSummary => ({
  id: 'look-x',
  title: 'Demo look',
  category: null,
  locale: 'en',
  sourcePage: null,
  sponsored: false,
  coverUrl: null,
  gradientSeed: ['#000000', '#000000'],
  publishedAt: null,
  itemCount: 0,
  ...over,
});

const item = (over: Partial<LookItem>): LookItem => ({
  id: 'item-x',
  brand: 'Demo Brand',
  model: 'Demo Model',
  category: 'apparel',
  variant: { size: null, colour: null, sku: null },
  match: null,
  evidence: null,
  available: true,
  merchant: 'Demo Merchant One',
  price_minor: 499900,
  currency: 'INR',
  freshness: '2026-09-30T10:00:00.000Z',
  priceAsOf: null,
  stock: 'in_stock',
  connector: 'stub-network',
  disclosure: null,
  linkUrl: null,
  ...over,
});

describe('shop grid: categories, search and sort', () => {
  const looks = [
    look({ id: 'a', title: 'Demo airport street style', category: 'Fashion', sourcePage: 'Demo Candid Frames', publishedAt: '2026-09-29T10:00:00Z', itemCount: 2 }),
    look({ id: 'b', title: 'Demo red-carpet evening look', category: 'Accessories', sourcePage: 'Demo Star Sightings', publishedAt: '2026-09-28T10:00:00Z', itemCount: 5 }),
    look({ id: 'c', title: 'Demo monsoon city stroll', category: 'fashion', publishedAt: null, itemCount: 2 }),
    look({ id: 'd', title: 'Demo brunch', category: null, publishedAt: '2026-09-29T11:00:00Z', itemCount: 1 }),
  ];

  it('lists each category once (case-insensitive, first spelling), A–Z', () => {
    expect(lookCategories(looks)).toEqual(['Accessories', 'Fashion']);
    expect(lookCategories([])).toEqual([]);
  });

  it('filters by one category and by title, source page or category text', () => {
    expect(filterLooks(looks, { query: '', category: 'FASHION' }).map((l) => l.id)).toEqual(['a', 'c']);
    expect(filterLooks(looks, { query: 'star sight', category: null }).map((l) => l.id)).toEqual(['b']);
    expect(filterLooks(looks, { query: '  accessories ', category: null }).map((l) => l.id)).toEqual(['b']);
    expect(filterLooks(looks, { query: 'monsoon', category: 'Accessories' })).toEqual([]);
    expect(filterLooks(looks, { query: '', category: null })).toHaveLength(4);
  });

  it('sorts newest first (undated last), by product count, or by title; ties keep the API order', () => {
    expect(sortLooks(looks, 'newest').map((l) => l.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(sortLooks(looks, 'most-products').map((l) => l.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(sortLooks(looks, 'title').map((l) => l.id)).toEqual(['a', 'd', 'c', 'b']);
    expect(LOOK_SORTS.map((s) => s.label)).toEqual(['Newest', 'Most products', 'Title A–Z']);
    // no price sort: the list endpoint carries no prices
    expect(LOOK_SORTS.some((s) => /price|payout/i.test(s.label))).toBe(false);
  });
});

describe('shop labels', () => {
  it('formats counts, names, categories, variants and publish times', () => {
    expect(productCount(1)).toBe('1 product');
    expect(productCount(2)).toBe('2 products');
    expect(itemName({ brand: 'Demo Kaya', model: 'Oversized Wool-Blend Blazer' })).toBe('Demo Kaya — Oversized Wool-Blend Blazer');
    expect(displayCategory('apparel')).toBe('Apparel');
    expect(variantFacts({ size: 'M', colour: 'Charcoal', sku: 'SKU-1' })).toEqual(['Size M', 'Charcoal']);
    expect(variantFacts({ size: null, colour: null, sku: null })).toEqual([]);
    expect(publishedLabel('2026-09-29T10:00:00.000Z', NOW)).toBe('Published 2h ago');
    expect(publishedLabel(null, NOW)).toBeNull();
    expect(publishedLabel('not a date', NOW)).toBeNull();
  });

  it('maps the match verdict onto the tag variants', () => {
    expect(matchTag('exact')).toEqual({ label: 'Exact item', tone: 'accent' });
    expect(matchTag('similar')).toEqual({ label: 'Similar style', tone: 'neutral' });
    expect(matchTag(null)).toEqual({ label: 'Unverified match', tone: 'outline' });
    expect(stockIsOut('out_of_stock')).toBe(true);
    expect(stockIsOut('low_stock')).toBe(false);
  });

  it('tells demo wishlist entries from live ones by the look id', () => {
    expect(isDemoLookId('look-1')).toBe(true);
    expect(isDemoLookId('5793fbd2-9e8b-4a94-ac49-b1fde7128084')).toBe(false);
  });
});

describe('merchant call to action', () => {
  it('has exactly three states and only ever links the tracked URL', () => {
    expect(ctaState({ available: false, linkUrl: LINK })).toEqual({ kind: 'unavailable' });
    expect(ctaState({ available: true, linkUrl: null })).toEqual({ kind: 'disabled' });
    expect(ctaState({ available: true, linkUrl: LINK })).toEqual({ kind: 'link', href: LINK });
    expect(hasPrice(item({}))).toBe(true);
    expect(hasPrice(item({ available: false, price_minor: null, currency: null }))).toBe(false);
  });

  it('renders the live link as a sponsored, same-tab primary block button', () => {
    const html = renderToStaticMarkup(createElement(MerchantCta, { linkUrl: LINK, available: true, itemName: 'Demo Kaya — Blazer' }));
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain('rel="sponsored nofollow noopener"');
    expect(html).not.toContain('target=');
    expect(html).toContain('View at merchant');
    expect(html).toContain('aria-label="View at merchant: Demo Kaya — Blazer"');
    expect((html.match(/href=/g) ?? []).length).toBe(1);
  });

  it('renders "Link not available yet" as a disabled control with no href', () => {
    const html = renderToStaticMarkup(createElement(MerchantCta, { linkUrl: null, available: true }));
    expect(html).toContain('Link not available yet');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('href');
    expect(html).not.toContain('<a');
  });

  it('renders "Not available right now" without a link, even if a URL is passed', () => {
    const html = renderToStaticMarkup(createElement(MerchantCta, { linkUrl: LINK, available: false }));
    expect(html).toContain('Not available right now');
    expect(html).not.toContain('href');
  });

  it('prints the match verdict as a tag', () => {
    expect(renderToStaticMarkup(createElement(MatchBadge, { match: 'exact' }))).toContain('Exact item');
    expect(renderToStaticMarkup(createElement(MatchBadge, { match: null }))).toContain('Unverified match');
  });
});

describe('shop components over the TEST demo catalogue', () => {
  it('every demo item is either linkless ("Link not available yet") or unavailable', () => {
    for (const summary of mockLooks()) {
      const detail = mockLook(summary.id);
      expect(detail).not.toBeNull();
      for (const it of detail!.items) {
        expect(it.linkUrl).toBeNull();
        expect(ctaState(it).kind).toBe(it.available ? 'disabled' : 'unavailable');
        const html = renderToStaticMarkup(createElement(ItemRow, { look: detail!, item: it }));
        expect(html).not.toMatch(/href="https?:/);
        expect(html).toContain(it.available ? 'Link not available yet' : 'Not available right now');
        if (!it.available) expect(html).not.toContain('₹');
      }
    }
  });

  it('draws a look cell with its eyebrow, Sponsored tag, count and one link to the look', () => {
    const summary = mockLooks().find((l) => l.sponsored)!;
    const html = renderToStaticMarkup(createElement(LookCard, { look: summary, now: NOW }));
    expect(html).toContain('Sponsored');
    expect(html).toContain(summary.title);
    expect(html).toContain(productCount(summary.itemCount));
    expect(html).toContain(`href="/looks/${summary.id}"`);
    expect((html.match(/href=/g) ?? []).length).toBe(1);
  });

  it('labels the grid as demo data when the catalogue fell back, and not otherwise', () => {
    const demo = renderToStaticMarkup(createElement(LookGrid, { looks: mockLooks(), demo: true }));
    expect(demo).toContain('Demo data — API unreachable');
    expect(demo).toContain('3 curated looks');
    const live = renderToStaticMarkup(createElement(LookGrid, { looks: mockLooks(), demo: false }));
    expect(live).not.toContain('Demo data');
  });
});

/* ---------- source rules ---------- */

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const SHOP_COMPONENTS = ['LookCard', 'LookGrid', 'MerchantCta', 'MatchBadge', 'SaveButton', 'Disclosure'];
const SHOP_SOURCES = [
  ...filesUnder(join(WEB, 'app/(shop)')),
  ...filesUnder(join(WEB, 'components/shop')),
  ...readdirSync(join(WEB, 'components'))
    .filter((f) => SHOP_COMPONENTS.some((c) => f.startsWith(`${c}.`)))
    .map((f) => join(WEB, 'components', f)),
].filter((f) => /\.(tsx?|css)$/.test(f));

describe('shop sources follow the Afflino rules', () => {
  it('covers the shop files', () => {
    expect(SHOP_SOURCES.length).toBeGreaterThan(20);
  });

  it('hard-code no colour, radius or shadow a token carries', () => {
    for (const file of SHOP_SOURCES.filter((f) => f.endsWith('.css'))) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, file).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css, file).not.toMatch(/\b(rgba?|hsla?)\(/i);
      expect(css, file).not.toMatch(/border-radius:(?!\s*var\()/);
      expect(css, file).not.toMatch(/box-shadow:(?!\s*var\()/);
    }
  });

  it('never mention cookies, never touch a raw merchant URL, never open a new tab', () => {
    for (const file of SHOP_SOURCES) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/cookie/i);
      expect(src, file).not.toMatch(/offer_?url/i);
      expect(src, file).not.toMatch(/target=["{]/);
    }
  });

  it('put rel="sponsored nofollow noopener" on the merchant CTA only', () => {
    const withRel = SHOP_SOURCES.filter((f) => readFileSync(f, 'utf8').includes('rel="sponsored'));
    expect(withRel.map((f) => f.slice(WEB.length + 1))).toEqual(['components/MerchantCta.tsx']);
  });

  it('keep the catalogue client (WEB_API_TOKEN) out of client components', () => {
    for (const file of SHOP_SOURCES.filter((f) => /\.tsx?$/.test(f))) {
      const src = readFileSync(file, 'utf8');
      if (/^['"]use client['"]/.test(src.trimStart())) {
        expect(src, file).not.toMatch(/lib\/catalogue|lib\/server-env|WEB_API_TOKEN/);
      }
    }
  });
});
