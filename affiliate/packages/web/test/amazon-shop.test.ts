// The shop's Amazon.in offers: the Associate statement (OA §10, verbatim) near
// every Amazon call to action (always, whatever the operator's disclosure) and
// in the footer once AMAZON_ASSOCIATE=on, "Buy on Amazon.in" linking only the
// tracked /r/{token} URL, a price only when the product API supplied one inside
// its hour (the API nulls it otherwise),
// shown with "as of … IST" and Amazon's disclaimer and attribution line, else
// "See price on Amazon.in"; no stale availability; no time-limited price in the
// wishlist; no raw Amazon URL anywhere in the web's sources. TEST data only.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Disclosure, { SHOP_DISCLOSURE } from '../components/Disclosure';
import { ItemRow } from '../components/shop/ItemRow';
import { isAmazonOffer, lookDisclosures, lookRelationshipFact, offerCopy, shownStock, storablePrice } from '../components/shop/model';
import { STUB_MARKER, StubPage } from '../components/marketing/StubPage';
import { MarketingFooter } from '../components/shell/MarketingFooter';
import { mapLookItem, type LookItemRow } from '../lib/catalogue';
import { priceAsOfLabel } from '../lib/format';
import { readSaved, SAVED_KEY, toggleSaved } from '../lib/saved';
import { AMAZON_IN } from '../lib/site-copy';
import type { LookItem } from '../lib/types';
import { AMAZON_ASSOCIATE_DISCLOSURE, AMAZON_CONNECTOR } from '../../shared/src/amazon';

(globalThis as { React?: typeof React }).React = React;

const WEB = join(__dirname, '..');
const LINK = 'https://afflino.example.com/r/0123456789abcdef0123456789abcdef';
const LOOK = { id: '5793fbd2-9e8b-4a94-ac49-b1fde7128084', title: 'Demo Kitchen picks' };
const STATEMENT = 'As an Amazon Associate I earn from qualifying purchases.';

const amazonRow: LookItemRow = {
  id: 'fb706413-e8d2-41c4-bc6c-39d905649a46',
  match_type: 'exact',
  evidence: null,
  product: { id: 'p', brand: 'Demo Brand', model: 'Demo Kettle', category: 'Home' },
  variant: { id: 'v', size_text: null, colour: null, merchant_sku: 'B0DEMO0001' },
  offer: {
    id: 'b1e5adbe-d74c-4df2-bc03-47fdc800f693',
    programme_id: 'cd70fe7c-85a2-46d2-85c2-2d9e2005af29',
    connector: 'amazon-associates',
    merchant: { id: 'm', name: 'Amazon.in' },
    price_minor: null,
    price_as_of: null,
    currency: 'INR',
    stock_status: 'unknown',
    fresh_until: '2026-10-29T00:00:00.000Z',
    disclosure: STATEMENT,
  },
  link: { token: '0123456789abcdef0123456789abcdef', url: LINK },
};

const amazon = (over: Partial<LookItem> = {}): LookItem => ({ ...mapLookItem(amazonRow), ...over });
const priced = (over: Partial<LookItem> = {}): LookItem =>
  amazon({ price_minor: 129900, priceAsOf: '2026-09-29T08:41:00.000Z', stock: 'in_stock', ...over });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('copy (lib/site-copy.ts AMAZON_IN)', () => {
  it('quotes Amazon: the Associate statement (OA §10) verbatim, the same text the api stores by default', () => {
    expect(AMAZON_IN.associateStatement).toBe(STATEMENT);
    expect(AMAZON_IN.associateStatement).toBe(AMAZON_ASSOCIATE_DISCLOSURE);
    expect(AMAZON_IN.connector).toBe(AMAZON_CONNECTOR);
  });

  it("quotes OA §11's price disclaimer and attribution line, with only Amazon's bracketed choice filled in", () => {
    expect(AMAZON_IN.priceDisclaimer).toBe(
      'Product prices and availability are accurate as of the date/time indicated and are subject to change. Any price and availability information displayed on Amazon.in at the time of purchase will apply to the purchase of this product.',
    );
    expect(AMAZON_IN.contentAttribution).toBe(
      'CERTAIN CONTENT THAT APPEARS ON THIS SITE COMES FROM AMAZON SELLER SERVICES PRIVATE LIMITED. THIS CONTENT IS PROVIDED ‘AS IS’ AND IS SUBJECT TO CHANGE OR REMOVAL AT ANY TIME.',
    );
    expect(AMAZON_IN.pricePrefix).toBe('Amazon.in Price');
  });

  it('keeps the button labels, the purchase note and the affiliate fact marked as drafts pending counsel', () => {
    expect(AMAZON_IN.ctaLabel).toBe('Buy on Amazon.in');
    expect(AMAZON_IN.noPriceLabel).toBe('See price on Amazon.in');
    expect(AMAZON_IN.purchaseNote).toBe("You complete the purchase on Amazon.in; Amazon.in's terms apply.");
    expect(AMAZON_IN.affiliateLinksFactLabel).toBe('Affiliate links');
    expect(AMAZON_IN.affiliateLinksFact).toBe('Yes (we earn from qualifying purchases)');
    const src = readFileSync(join(WEB, 'lib/site-copy.ts'), 'utf8');
    expect(src).toContain('DRAFT PENDING COUNSEL SIGN-OFF: `ctaLabel` and `noPriceLabel`');
    expect(src).toContain('DRAFT PENDING COUNSEL SIGN-OFF: `purchaseNote`');
    // The purchase note claims nothing about delivery or returns (third-party sellers' listings).
    expect(AMAZON_IN.purchaseNote).not.toMatch(/deliver|return|payment/i);
  });
});

describe('mapping and rules', () => {
  it('maps connector, price time and disclosure; a price time never travels without its price', () => {
    const it0 = mapLookItem(amazonRow);
    expect(it0).toMatchObject({ connector: 'amazon-associates', price_minor: null, priceAsOf: null, disclosure: STATEMENT, available: true });
    const withPrice = mapLookItem({ ...amazonRow, offer: { ...amazonRow.offer!, price_minor: 129900, price_as_of: '2026-09-29T08:41:00.000Z' } });
    expect(withPrice).toMatchObject({ price_minor: 129900, priceAsOf: '2026-09-29T08:41:00.000Z' });
    const orphan = mapLookItem({ ...amazonRow, offer: { ...amazonRow.offer!, price_minor: null, price_as_of: '2026-09-29T08:41:00.000Z' } });
    expect(orphan.priceAsOf).toBeNull();
    // An API before the connector field: a generic offer.
    const { connector: _c, disclosure: _d, price_as_of: _p, ...legacy } = amazonRow.offer!;
    expect(mapLookItem({ ...amazonRow, offer: { ...legacy, price_minor: 5000 } })).toMatchObject({ connector: null, disclosure: null, priceAsOf: null });
    expect(isAmazonOffer(it0)).toBe(true);
    expect(isAmazonOffer({ available: false, connector: 'amazon-associates' })).toBe(false);
  });

  it('prints the price time in IST with the date, as OA §11 shows it', () => {
    expect(priceAsOfLabel('2026-09-29T08:41:00.000Z')).toBe('as of 29/09/2026 14:11 IST');
    expect(priceAsOfLabel('2026-09-29T20:00:00Z')).toBe('as of 30/09/2026 01:30 IST');
    expect(priceAsOfLabel('2026-12-31T18:29:00Z')).toBe('as of 31/12/2026 23:59 IST');
    expect(priceAsOfLabel(null)).toBeNull();
    expect(priceAsOfLabel('not a time')).toBeNull();
  });

  it('Amazon copy: Buy on Amazon.in, See price on Amazon.in, the statement; disclaimer and attribution only beside an API price', () => {
    expect(offerCopy(amazon())).toEqual({
      ctaLabel: 'Buy on Amazon.in',
      noPriceLabel: 'See price on Amazon.in',
      priceLabel: 'Amazon.in Price',
      priceDisclaimer: null,
      disclosures: [STATEMENT],
      contentAttribution: null,
      purchaseNote: "You complete the purchase on Amazon.in; Amazon.in's terms apply.",
    });
    expect(offerCopy(priced())).toMatchObject({
      priceDisclaimer: AMAZON_IN.priceDisclaimer,
      contentAttribution: AMAZON_IN.contentAttribution,
    });
    // No programme disclosure from the API: OA §10's statement still shows.
    expect(offerCopy(amazon({ disclosure: null })).disclosures).toEqual([STATEMENT]);
    // An operator's disclosure never replaces the statement: it comes after it (without repeating it).
    expect(offerCopy(amazon({ disclosure: 'We may earn a commission.' })).disclosures).toEqual([STATEMENT, 'We may earn a commission.']);
    expect(offerCopy(amazon({ disclosure: `${STATEMENT} #ad` })).disclosures).toEqual([STATEMENT, '#ad']);
    // Other merchants keep the generic copy and carry no Amazon text.
    const generic = offerCopy({ ...amazon(), connector: 'stub-network', merchant: 'Demo Merchant', disclosure: null });
    expect(generic).toMatchObject({
      ctaLabel: 'View at merchant',
      priceLabel: 'Price',
      disclosures: [],
      contentAttribution: null,
      purchaseNote: 'Payment, delivery and returns are handled by Demo Merchant.',
    });
    expect(JSON.stringify(generic)).not.toMatch(/amazon/i);
  });

  it('a look with Amazon items says "Affiliate links: Yes", never "Sponsored: No"; other looks keep their fact', () => {
    expect(lookRelationshipFact({ sponsored: false }, [amazon()])).toEqual(['Affiliate links', 'Yes (we earn from qualifying purchases)']);
    expect(lookRelationshipFact({ sponsored: false }, [{ available: true, connector: 'stub-network' }])).toEqual(['Sponsored', 'No']);
    expect(lookRelationshipFact({ sponsored: true }, [])).toEqual(['Sponsored', 'Yes']);
    const src = readFileSync(join(WEB, 'app/(shop)/looks/[id]/page.tsx'), 'utf8');
    expect(src).toContain('lookRelationshipFact(look, look.items)');
    expect(src).not.toContain("['Sponsored', look.sponsored ? 'Yes' : 'No']");
    const item = readFileSync(join(WEB, 'app/(shop)/looks/[id]/items/[itemId]/page.tsx'), 'utf8');
    expect(item).toContain('{copy.purchaseNote}');
    expect(item).not.toContain('Payment, delivery and returns are handled by ${item.merchant}');
  });

  it('shows no stale availability: "unknown" is never a fact', () => {
    expect(shownStock(amazon())).toBeNull();
    expect(shownStock(priced())).toBe('in_stock');
    expect(shownStock({ available: false, stock: 'in_stock' })).toBeNull();
  });

  it('the look panel lists each statement once and the attribution line only when an API price is shown', () => {
    expect(lookDisclosures([amazon(), amazon({ id: 'b' })])).toEqual({ disclosures: [STATEMENT], attributions: [] });
    expect(lookDisclosures([amazon(), priced({ id: 'b' })])).toEqual({ disclosures: [STATEMENT], attributions: [AMAZON_IN.contentAttribution] });
    const html = renderToStaticMarkup(createElement(Disclosure, { lines: [STATEMENT, STATEMENT, SHOP_DISCLOSURE, ''] }));
    expect(html.split(STATEMENT)).toHaveLength(2);
    expect(html.split(SHOP_DISCLOSURE)).toHaveLength(2);
  });
});

describe('ItemRow with an Amazon offer', () => {
  it('without an API price: "See price on Amazon.in", no ₹, no stock, "Buy on Amazon.in" on the tracked link, the statement', () => {
    const html = renderToStaticMarkup(createElement(ItemRow, { look: LOOK, item: amazon() }));
    expect(html).toContain('See price on Amazon.in');
    expect(html).not.toContain('₹');
    expect(html).not.toMatch(/unknown/i);
    expect(html).not.toContain('Price valid for');
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain('rel="sponsored nofollow noopener"');
    expect(html).toContain('Buy on Amazon.in');
    expect(html).toContain('aria-label="Buy on Amazon.in: Demo Brand — Demo Kettle"');
    expect(html).toContain(STATEMENT);
    expect(html).not.toMatch(/amazon\.in\//i);
    expect(html).not.toContain('target=');
  });

  it('with an API price: "Amazon.in Price", the amount, "as of … IST" and the disclaimer instead of the freshness line', () => {
    const html = renderToStaticMarkup(createElement(ItemRow, { look: LOOK, item: priced() }));
    expect(html).toContain('Amazon.in Price');
    expect(html).toContain('₹1,299');
    expect(html).toContain('(as of 29/09/2026 14:11 IST) Product prices and availability are accurate as of the date/time indicated');
    expect(html).toContain('In stock');
    expect(html).not.toContain('Price valid for');
    expect(html).not.toContain('See price on Amazon.in');
  });

  it('without a minted link: the disabled control, never an Amazon URL', () => {
    const html = renderToStaticMarkup(createElement(ItemRow, { look: LOOK, item: amazon({ linkUrl: null }) }));
    expect(html).toContain('Link not available yet');
    expect(html).not.toMatch(/href="https?:/);
    expect(html).toContain(STATEMENT);
  });

  it('a generic offer still reads as before', () => {
    const html = renderToStaticMarkup(
      createElement(ItemRow, {
        look: LOOK,
        item: amazon({ connector: 'stub-network', merchant: 'Demo Merchant', disclosure: null, price_minor: 200000, priceAsOf: null, freshness: '2999-01-01T00:00:00.000Z', stock: 'in_stock' }),
      }),
    );
    expect(html).toContain('View at merchant');
    expect(html).toContain('Price valid for');
    expect(html).not.toMatch(/amazon/i);
  });
});

describe('the wishlist never keeps a time-limited price', () => {
  function memoryStorage() {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  }

  it('storablePrice: none for Amazon offers (priced or not), the live price otherwise', () => {
    expect(storablePrice(priced())).toEqual({ price_minor: null, priceNotStored: true });
    expect(storablePrice(amazon())).toEqual({ price_minor: null, priceNotStored: true });
    expect(storablePrice({ available: true, connector: 'stub-network', price_minor: 5000, priceAsOf: null })).toEqual({
      price_minor: 5000,
      priceNotStored: false,
    });
    expect(storablePrice({ available: true, connector: 'stub-network', price_minor: 5000, priceAsOf: '2026-09-29T08:41:00Z' }).price_minor).toBeNull();
  });

  it('toggleSaved drops the price of a priceNotStored entry even if one is passed', () => {
    vi.stubGlobal('window', { localStorage: memoryStorage() });
    toggleSaved({
      lookId: LOOK.id,
      itemId: 'i1',
      lookTitle: LOOK.title,
      brand: 'Demo Brand',
      model: 'Demo Kettle',
      merchant: 'Amazon.in',
      price_minor: 129900,
      currency: 'INR',
      priceNotStored: true,
    });
    const saved = readSaved();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ price_minor: null, priceNotStored: true });
    expect((window as unknown as { localStorage: { getItem(k: string): string | null } }).localStorage.getItem(SAVED_KEY)).not.toContain('129900');
  });

  it('the saved page says the price was not stored', () => {
    const src = readFileSync(join(WEB, 'app/(shop)/saved/page.tsx'), 'utf8');
    expect(src).toContain('s.priceNotStored ?');
    expect(src).toContain('Price not stored — open the product for it');
  });
});

describe('the footer identifies the site as an Amazon Associate only when AMAZON_ASSOCIATE=on', () => {
  it('on → the statement; unset or anything else → none', () => {
    vi.stubEnv('AMAZON_ASSOCIATE', 'on');
    expect(renderToStaticMarkup(createElement(MarketingFooter))).toContain(STATEMENT);
    vi.stubEnv('AMAZON_ASSOCIATE', 'yes');
    expect(renderToStaticMarkup(createElement(MarketingFooter))).not.toContain(STATEMENT);
    vi.stubEnv('AMAZON_ASSOCIATE', '');
    expect(renderToStaticMarkup(createElement(MarketingFooter))).not.toContain('Amazon');
  });
});

describe('the privacy page gates the Amazon go-live steps', () => {
  it('a stub page carries the marker amazon.sh looks for, and /privacy is still that stub', () => {
    const html = renderToStaticMarkup(createElement(StubPage, { eyebrow: 'Legal', title: 'Privacy notice', children: 'Being prepared.' }));
    expect(STUB_MARKER).toBe('data-document-status="stub"');
    expect(html).toContain(STUB_MARKER);
    const privacy = readFileSync(join(WEB, 'app/(marketing)/privacy/page.tsx'), 'utf8');
    expect(privacy).toContain('<StubPage');
    const script = readFileSync(join(WEB, '..', '..', 'deploy', 'linode', 'amazon.sh'), 'utf8');
    expect(script).toContain(STUB_MARKER);
  });
});

describe('no raw Amazon URL in the web', () => {
  function filesUnder(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? filesUnder(path) : [path];
    });
  }

  it('app, components and lib never name an amazon host or product path', () => {
    const sources = ['app', 'components', 'lib']
      .flatMap((d) => filesUnder(join(WEB, d)))
      .filter((f) => /\.(tsx?|css|mjs|js)$/.test(f));
    expect(sources.length).toBeGreaterThan(50);
    for (const f of sources) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/(?:www\.|m\.)?amazon\.in\/|amzn\.(?:to|in)\b|media-amazon\.com/i);
    }
  });
});
