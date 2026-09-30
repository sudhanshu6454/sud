/**
 * The consumer side of celebrity looks: the mapping from the public read
 * API (what the rights gate let through is all the page ever shows), the
 * look page piece by piece (EXACT first, then "Similar styles"; the wording
 * of each item; the non-endorsement line wherever the celebrity is named;
 * the commercial label first; the still apart from every product; tracked
 * /r/ links only; the Associate statement beside every Amazon button), the
 * feed card, the public client's outcomes and cache tags, and the web's own
 * labels against the wording deny-list. TEST data only ("Demo Star …").
 */
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CelebrityLookView } from '../components/shop/CelebrityLookView';
import { SpottedCard } from '../components/shop/SpottedCard';
import { TrendingRow } from '../components/shop/TrendingRow';
import { AMAZON_IN, CELEBRITY_WEB } from '../lib/site-copy';
import {
  TAGS,
  categoryLabel,
  feedQuery,
  imageUrl,
  isCacheTag,
  mapCard,
  mapFeed,
  mapPublicLook,
  momentLine,
  pageParam,
  slugParam,
  socialPostUrl,
  trackedLinkOnly,
  withdrawalProbePath,
  type PublicLookRow,
  type SpottedCardRow,
} from '../lib/spotted';
import { mockCelebrityLook, mockSpotted } from '../lib/mock-spotted';

(globalThis as { React?: typeof React }).React = React;

const LOOK_ID = '0b3f2a8e-5c1d-4e7a-9f60-2d4b8c1e7a90';
const TOKEN = 'b'.repeat(32);
const LINK = `https://afflino.example.com/r/${TOKEN}`;
const NAME = 'Demo Star One';
const NON_ENDORSEMENT = `${NAME} is not affiliated with Afflino and has not endorsed any product on this page.`;
const SIMILAR_LINE = `Similar style. ${NAME} did not wear or endorse this product.`;

const amazonOffer = (price: number | null) => ({
  id: 'offer-1',
  connector: AMAZON_IN.connector,
  merchant: { name: 'Amazon.in' },
  price_minor: price,
  price_as_of: price === null ? null : '2026-09-30T06:00:00.000Z',
  currency: 'INR',
  stock_status: 'unknown',
  disclosure: AMAZON_IN.associateStatement,
});

const item = (id: string, match: 'exact' | 'similar', over: Record<string, unknown> = {}) => ({
  id,
  match,
  label: match === 'exact' ? 'The same item' : 'Similar styles',
  detail: match === 'exact' ? "Identified by Afflino's editors from the evidence on record." : SIMILAR_LINE,
  product: { brand: 'Demo Brand', model: `Demo product ${id}`, category: 'Clothing' },
  variant: { size_text: null, colour: null },
  offer: amazonOffer(null),
  link: { url: LINK },
  ...over,
});

const row: PublicLookRow = {
  id: LOOK_ID,
  headline: 'Spotted at Demo Film Premiere',
  commercial_label: 'Ad · This page has affiliate links',
  celebrity: { name: NAME, slug: 'demo-star-one' },
  non_endorsement: NON_ENDORSEMENT,
  moment: { event: 'Demo Film Premiere', place: 'Demo City', date: '2026-09-12' },
  image: { url: `/img/looks/${LOOK_ID}?v=0123456789`, credit: 'Demo Media (TEST)' },
  source: { platform: 'instagram', post_permalink: 'https://instagram.example.com/p/demo-0001', storefront: { slug: 'demo-ig', name: 'Demo IG' } },
  display: { name: true, image: true, shoppable: true },
  disclosure: { sponsored: false, affiliate_links: true, amazon_associate: true },
  pieces: [
    // Out of order on purpose: the page orders by position.
    { id: 'p2', label: 'The trousers', category: 'trousers', position: 1, hotspot: { x: 0.45, y: 0.62 }, products_shown: true, exact: null, similar_heading: 'Similar styles', similar: [item('s3', 'similar')] },
    {
      id: 'p1',
      label: 'The shirt',
      category: 'shirt',
      position: 0,
      hotspot: { x: 0.42, y: 0.35 },
      products_shown: true,
      exact: item('e1', 'exact', { offer: amazonOffer(349900) }),
      similar_heading: 'Similar styles',
      similar: [item('s1', 'similar'), item('s2', 'similar', { link: { url: 'https://www.merchant.example.com/dp/B0DEMO0001?tag=x' } })],
    },
    { id: 'p3', label: 'The sunglasses', category: 'eyewear', position: 2, hotspot: null, products_shown: true, exact: null, similar_heading: 'Similar styles', similar: [] },
  ],
  published_at: '2026-09-28T10:00:00.000Z',
};

function render(look = mapPublicLook(row), demo = false): string {
  return renderToStaticMarkup(createElement(CelebrityLookView, { look, demo }));
}

describe('mapping the public look (never more than the API sent)', () => {
  it('orders the pieces by position, EXACT apart from the similar ones, hotspots only with the still', () => {
    const look = mapPublicLook(row);
    expect(look.pieces.map((p) => p.label)).toEqual(['The shirt', 'The trousers', 'The sunglasses']);
    expect(look.pieces[0]?.exact?.id).toBe('e1');
    expect(look.pieces[0]?.similar.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(look.pieces[0]?.hotspot).toEqual({ x: 0.42, y: 0.35 });
    const noImage = mapPublicLook({ ...row, display: { ...row.display, image: false } });
    expect(noImage.image).toBeNull();
    expect(noImage.pieces.every((p) => p.hotspot === null)).toBe(true);
  });

  it('drops any link that is not a tracked /r/ URL (the call to action is then disabled)', () => {
    const look = mapPublicLook(row);
    expect(look.pieces[0]?.similar[0]?.linkUrl).toBe(LINK);
    expect(look.pieces[0]?.similar[1]?.linkUrl).toBeNull();
    expect(trackedLinkOnly('https://afflino.com/r/' + 'c'.repeat(32))).not.toBeNull();
    expect(trackedLinkOnly('https://afflino.com/r/short')).toBeNull();
    expect(trackedLinkOnly('javascript:alert(1)')).toBeNull();
  });

  it('shows no product where the API says the look is not shoppable, and never an EXACT sent as SIMILAR', () => {
    const closed = mapPublicLook({
      ...row,
      display: { ...row.display, shoppable: false },
      pieces: row.pieces.map((p) => ({ ...p, products_shown: false })),
    });
    expect(closed.pieces.every((p) => p.exact === null && p.similar.length === 0)).toBe(true);
    const mixed = mapPublicLook({ ...row, pieces: [{ ...row.pieces[1]!, similar: [item('x', 'exact')] }] });
    expect(mixed.pieces[0]?.similar).toEqual([]);
  });

  it('keeps an original post only on Facebook / Instagram over https', () => {
    expect(socialPostUrl('https://www.instagram.com/p/abc/')).toBe('https://www.instagram.com/p/abc/');
    expect(socialPostUrl('https://facebook.com/x/posts/1')).not.toBeNull();
    expect(socialPostUrl('http://www.instagram.com/p/abc/')).toBeNull();
    expect(socialPostUrl('https://evil.test/instagram.com')).toBeNull();
  });
});

describe('the look page, piece by piece', () => {
  it('puts the commercial label before the headline, and the non-endorsement line beside the name', () => {
    const html = render();
    expect(html.indexOf('data-commercial-label')).toBeGreaterThan(-1);
    expect(html.indexOf('data-commercial-label')).toBeLessThan(html.indexOf('<h1'));
    expect(html).toContain('This page has affiliate links');
    const credit = /<(?:p|span)[^>]*data-non-endorsement=""[^>]*>(.*?)<\/(?:p|span)>/.exec(html)?.[1] ?? '';
    expect(credit.replace(/<[^>]+>/g, '')).toBe(NON_ENDORSEMENT);
    expect(credit).toContain('href="/c/demo-star-one"');
  });

  it('shows the EXACT match first in its piece, then the similar styles, each with its own wording', () => {
    const html = render();
    const shirt = html.slice(html.indexOf('id="piece-p1"'), html.indexOf('id="piece-p2"'));
    expect(shirt.indexOf(CELEBRITY_WEB.exactTag)).toBeGreaterThan(-1);
    expect(shirt.indexOf(CELEBRITY_WEB.exactTag)).toBeLessThan(shirt.indexOf('Similar styles'));
    expect(shirt).toContain("The same item. Identified by Afflino&#x27;s editors from the evidence on record.");
    const similarTiles = html.split('data-match="similar"').slice(1);
    expect(similarTiles).toHaveLength(3);
    for (const t of similarTiles) expect(t.slice(0, t.indexOf('data-match') > 0 ? t.indexOf('data-match') : undefined)).toContain(SIMILAR_LINE);
    // A similar product is never said to be the same item.
    for (const t of similarTiles) expect(t.split('data-match')[0]).not.toContain('The same item');
  });

  it('has only tracked /r/ hrefs on its products, sponsored and same-tab, and the Associate statement beside every Amazon button', () => {
    const html = render();
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1] as string);
    const outbound = hrefs.filter((h) => /^https?:/.test(h));
    for (const h of outbound) expect(h === LINK || h.startsWith('https://instagram.example.com/')).toBe(true);
    expect(html).not.toMatch(/merchant\.example\.com|\/dp\//);
    expect(html).not.toMatch(/target=/);
    const buttons = html.split(`>${AMAZON_IN.ctaLabel}<`).length - 1 + (html.split('Link not available yet').length - 1);
    const statements = html.split(AMAZON_IN.associateStatement).length - 1;
    // One statement beside each of the 4 products' calls to action, plus the disclosure panel's.
    expect(buttons).toBe(4);
    expect(statements).toBe(5);
    expect([...html.matchAll(/<a href="[^"]*\/r\/[0-9a-f]{32}" rel="([^"]+)"/g)].map((m) => m[1])).toEqual(Array(3).fill('sponsored nofollow noopener'));
  });

  it('says "See price on Amazon.in" without a fresh price, and shows a product-API price with its time', () => {
    const html = render();
    expect(html).toContain(AMAZON_IN.noPriceLabel);
    expect(html).toContain('₹3,499');
    expect(html).toContain('IST');
  });

  it('keeps every product out of the still region (no product, price or Amazon text on or beside the image)', () => {
    const html = render();
    const figure = /<figure[\s\S]*?<\/figure>/.exec(html)?.[0] ?? '';
    expect(figure).toContain('<img');
    expect(figure).not.toMatch(/Amazon|₹|Demo product|Buy on/);
    // The markers are numbers linking to their pieces; the unplaced piece has none.
    expect([...figure.matchAll(/href="#piece-(\w+)"[^>]*>(\d)</g)].map((m) => [m[1], m[2]])).toEqual([
      ['p1', '1'],
      ['p2', '2'],
    ]);
  });

  it('shows the pieces without products on a look that is not shoppable', () => {
    const html = render(mapPublicLook({ ...row, display: { name: true, image: false, shoppable: false }, pieces: row.pieces.map((p) => ({ ...p, products_shown: false, exact: null, similar: [] })) }));
    expect(html).toContain(CELEBRITY_WEB.noProducts);
    expect(html).not.toContain(AMAZON_IN.ctaLabel);
    expect(html).not.toContain('<figure');
  });

  it('labels the demo look as demo data', () => {
    const demo = mockCelebrityLook('demo-spotted-premiere');
    expect(demo).not.toBeNull();
    const html = render(demo!, true);
    expect(html).toContain('Demo data — API unreachable');
    expect(html).toContain('Demo Star One');
    expect(html).not.toMatch(/\/r\/[0-9a-f]{32}/);
  });
});

const cardRow: SpottedCardRow = {
  id: LOOK_ID,
  headline: 'Spotted at Demo Film Premiere',
  celebrity: { name: NAME, slug: 'demo-star-one' },
  non_endorsement: NON_ENDORSEMENT,
  moment: { event: 'Demo Film Premiere', place: 'Demo City', date: '2026-09-12' },
  image: null,
  source: { platform: 'instagram', storefront: { slug: 'demo-ig', name: 'Demo IG' } },
  pieces: 3,
  shoppable: true,
  published_at: '2026-09-28T10:00:00.000Z',
};

describe('the feed card and the trending row', () => {
  it('names the celebrity with the non-endorsement line and carries no product or merchant link', () => {
    const html = renderToStaticMarkup(createElement('ul', null, createElement(SpottedCard, { look: mapCard(cardRow) })));
    expect(html).toContain('Spotted at Demo Film Premiere');
    // The name is only in the card's line, the non-endorsement sentence at body size.
    expect(html.split(NAME).length - 1).toBe(1);
    expect(html).toContain(NON_ENDORSEMENT);
    expect(html).toContain('Demo Film Premiere · Demo City · 12 Sep 2026');
    expect(html).toContain(`href="/looks/${LOOK_ID}"`);
    expect(html).toContain('href="/s/demo-ig"');
    expect(html).not.toMatch(/\/r\/|Amazon|₹/);
  });

  it('the trending row numbers its looks and disappears when there is nothing to rank', () => {
    expect(renderToStaticMarkup(createElement(TrendingRow, { looks: [] }))).toBe('');
    const html = renderToStaticMarkup(createElement(TrendingRow, { looks: [mapCard(cardRow), mapCard({ ...cardRow, id: 'x2' })] }));
    expect(html).toContain(CELEBRITY_WEB.trendingTitle);
    expect(html).toContain('>01<');
    expect(html).toContain('>02<');
  });

  it('maps the feed with its facets and commercial label', () => {
    const f = mapFeed({ items: [cardRow], page: 1, page_size: 24, total: 1, facets: { celebrities: [{ slug: 'demo-star-one', name: NAME, looks: 1 }, { slug: 'Bad Slug', name: 'x', looks: 1 }], storefronts: [] }, commercial_label: 'Ad · This page has affiliate links' });
    expect(f.facets.celebrities).toEqual([{ slug: 'demo-star-one', name: NAME, looks: 1 }]);
    expect(f.commercialLabel).toBe('Ad · This page has affiliate links');
    expect(mockSpotted({ celebrity: 'demo-star-two' }).items.map((i) => i.celebrity.slug)).toEqual(['demo-star-two']);
  });
});

describe('helpers', () => {
  it('the withdrawal probe covers looks (and their item pages) and hubs only', () => {
    expect(withdrawalProbePath(`/looks/${LOOK_ID}`)).toBe(`/looks/${LOOK_ID}`);
    expect(withdrawalProbePath(`/looks/${LOOK_ID.toUpperCase()}/items/x`)).toBe(`/looks/${LOOK_ID}`);
    expect(withdrawalProbePath('/c/demo-star-one')).toBe('/celebrities/demo-star-one');
    expect(withdrawalProbePath('/looks/demo-spotted-premiere')).toBeNull();
    expect(withdrawalProbePath('/c/Bad_Slug')).toBeNull();
    expect(withdrawalProbePath('/shop')).toBeNull();
  });

  it('accepts the cache tags the API sends and nothing else', () => {
    for (const t of [TAGS.spotted, TAGS.sitemap, TAGS.look(LOOK_ID), TAGS.celebrity('demo-star-one'), TAGS.storefront('demo-ig'), 'catalogue']) expect(isCacheTag(t)).toBe(true);
    for (const t of ['look:nope', 'celebrity:Bad', 'anything', '', 7, null]) expect(isCacheTag(t)).toBe(false);
  });

  it('builds the feed query, reads the parameters, formats the moment and the categories', () => {
    expect(feedQuery({ celebrity: 'demo-star-one', from: 'demo-ig', p: 2 })).toBe('?celebrity=demo-star-one&from=demo-ig&p=2');
    expect(feedQuery({ celebrity: 'Bad Slug', p: 1 })).toBe('');
    expect(slugParam(['demo-ig', 'x'])).toBe('demo-ig');
    expect(slugParam('<script>')).toBeNull();
    expect(pageParam('3')).toBe(3);
    expect(pageParam('0')).toBe(1);
    expect(momentLine({ event: null, place: 'Demo City', date: '2026-01-05' })).toBe('Demo City · 5 Jan 2026');
    expect(categoryLabel('t_shirt')).toBe('T-shirt');
    expect(categoryLabel('co_ord_set')).toBe('Co-ord set');
    expect(categoryLabel('footwear')).toBe('Footwear');
  });
});

describe('the public client (no token, cache tags, outcomes)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubFetch(status: number, data: unknown) {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(status === 200 ? { data } : { error: { code: 'X', message: 'x' } }), { status }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('reads the look without a token, with the look and feed tags, and maps it', async () => {
    vi.stubEnv('API_BASE', 'http://api.test');
    vi.stubEnv('WEB_API_TOKEN', 'server-secret');
    const fetchMock = stubFetch(200, row);
    const { getPublicLook } = await import('../lib/public-catalogue');
    const out = await getPublicLook(LOOK_ID);
    expect(out.kind).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; next: { revalidate: number; tags: string[] } }];
    expect(url).toBe(`http://api.test/v1/public/afflino/looks/${LOOK_ID}`);
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(init.next).toEqual({ revalidate: 30, tags: [`look:${LOOK_ID}`, 'spotted'] });
  });

  it('410 is gone, 404 a miss, an outage an outage (never the demo for a live id)', async () => {
    const { getPublicLook, getSpotted } = await import('../lib/public-catalogue');
    stubFetch(410, null);
    expect((await getPublicLook(LOOK_ID)).kind).toBe('gone');
    stubFetch(404, null);
    expect((await getPublicLook(LOOK_ID)).kind).toBe('miss');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect((await getPublicLook(LOOK_ID)).kind).toBe('outage');
    const feed = await getSpotted({});
    expect(feed.demo).toBe(true);
    expect(feed.value.items.every((i) => i.celebrity.name.startsWith('Demo Star'))).toBe(true);
    const demoLook = await getPublicLook('demo-spotted-premiere');
    expect(demoLook).toMatchObject({ kind: 'ok', demo: true });
  });

  it('uses PUBLIC_ORG_SLUG and ignores a malformed one', async () => {
    const fetchMock = stubFetch(200, { items: [], page: 1, page_size: 24, total: 0 });
    const { getSpotted } = await import('../lib/public-catalogue');
    vi.stubEnv('PUBLIC_ORG_SLUG', 'demo-org');
    await getSpotted({ celebrity: 'demo-star-one', from: 'demo-ig', page: 2 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/public/demo-org/spotted?page=2&page_size=24&celebrity=demo-star-one&storefront=demo-ig');
    vi.stubEnv('PUBLIC_ORG_SLUG', '../../x');
    await getSpotted({});
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/v1/public/afflino/spotted');
  });
});

describe("the web's own labels", () => {
  const DENY = [/worn by/i, /\bwore\b/i, /\bwears\b/i, /\bdupe/i, /for less/i, /inspired by/i, /\blove/i, /recommend/i, /favou?rite/i, /'s pick/i, /\bsteal\b/i, /\bsave\b/i, /cheaper/i, /as seen on/i, /endorse/i];
  it('say nothing that implies a celebrity wore, owns, chose or recommends a product', () => {
    for (const [key, text] of Object.entries(CELEBRITY_WEB)) {
      for (const re of DENY) expect(text, key).not.toMatch(re);
    }
  });
});

describe('no marker on a face', () => {
  it('draws no marker for a piece worn at the head or face (the piece is still listed)', () => {
    const look = mapPublicLook({
      ...row,
      pieces: [{ ...row.pieces[0]!, category: 'headwear' }, row.pieces[1]!, { ...row.pieces[2]!, hotspot: { x: 0.44, y: 0.18 } }],
    });
    // row.pieces: [trousers (position 1) → made headwear, shirt (0), sunglasses (2) with a marker set].
    expect(look.pieces.map((p) => [p.category, p.hotspot])).toEqual([
      ['shirt', { x: 0.42, y: 0.35 }],
      ['headwear', null],
      ['eyewear', null],
    ]);
    const html = renderToStaticMarkup(createElement(CelebrityLookView, { look, demo: false }));
    const figure = /<figure[\s\S]*?<\/figure>/.exec(html)?.[0] ?? '';
    expect([...figure.matchAll(/href="#piece-(\w+)"/g)].map((m) => m[1])).toEqual(['p1']);
    expect(html).toContain('The sunglasses');
  });
});

describe('the review fixes on the consumer pages', () => {
  it('draws no commercial label on a page that carries no products (a name-only look)', () => {
    const html = render(
      mapPublicLook({
        ...row,
        commercial_label: null,
        display: { name: true, image: false, shoppable: false },
        pieces: row.pieces.map((p) => ({ ...p, products_shown: false, exact: null, similar: [] })),
      }),
    );
    expect(html).not.toContain('data-commercial-label');
    expect(html).not.toContain('This page has affiliate links');
    expect(html).toContain('No products on this page');
  });

  it('leaves out the media region when the still may not be shown (no blank grey box)', () => {
    const html = render(mapPublicLook({ ...row, image: null, display: { ...row.display, image: false } }));
    expect(html).not.toContain('<figure');
    expect(html).not.toContain('<img');
  });

  it('serves the still from its own afflino.com address; a card without one shows the type-only block', () => {
    const look = mapPublicLook(row);
    expect(look.image?.url).toBe(`/img/looks/${LOOK_ID}?v=0123456789`);
    expect(imageUrl('/img/looks/not-a-uuid')).toBeNull();
    expect(imageUrl('javascript:alert(1)')).toBeNull();
    const card = renderToStaticMarkup(createElement('ul', null, createElement(SpottedCard, { look: mapCard({ ...cardRow, image: null }) })));
    expect(card).toContain('data-no-photo');
    expect(card).toContain(CELEBRITY_WEB.photoNotShown);
  });

  it('the headline never names the celebrity; the pieces index is there for phones', () => {
    const html = render();
    const h1 = /<h1[^>]*>(.*?)<\/h1>/.exec(html)?.[1] ?? '';
    expect(h1).toBe('Spotted at Demo Film Premiere');
    expect(h1).not.toContain(NAME);
    expect(html).toContain(`aria-label="${CELEBRITY_WEB.piecesIndex}"`);
    expect(html).toContain('href="#piece-p1"');
  });

  it('similar tiles carry no tag of their own (the heading and the line say it); EXACT keeps its tag', () => {
    const html = render();
    const similarTiles = html.split('data-match="similar"').slice(1);
    for (const t of similarTiles) expect(t.split('data-match')[0]).not.toContain(`>${CELEBRITY_WEB.similarTag}<`);
    expect(html).toContain(`>${CELEBRITY_WEB.exactTag}<`);
  });

  it('a storefront’s own cards leave out “Posted on” this page and take the phone-compact form', () => {
    const html = renderToStaticMarkup(createElement('ul', null, createElement(SpottedCard, { look: mapCard(cardRow), hideSource: true, phoneCompact: true })));
    expect(html).not.toContain('href="/s/demo-ig"');
    expect(html).not.toContain(CELEBRITY_WEB.fromPage);
  });

  it('the feed filters are a GET form with a submit button (nothing navigates on change)', async () => {
    const { SpottedFilters } = await import('../components/shop/SpottedFilters');
    const html = renderToStaticMarkup(
      createElement(SpottedFilters, { celebrities: [{ slug: 'demo-star-one', name: NAME, looks: 1 }], pages: [{ slug: 'demo-ig', name: 'Demo IG', looks: 1 }], celebrity: 'demo-star-one', from: null }),
    );
    expect(html).toMatch(/<form[^>]*method="get"[^>]*action="\/shop"/);
    expect(html).toContain('name="celebrity"');
    expect(html).toContain('name="from"');
    expect(html).toContain(`>${CELEBRITY_WEB.showLooks}<`);
    expect(html).not.toMatch(/onchange/i);
  });

  it('the withdrawn notice has the page’s h1', async () => {
    const { WithdrawnNotice } = await import('../components/shop/WithdrawnNotice');
    const html = renderToStaticMarkup(createElement(WithdrawnNotice));
    expect(/<h1[^>]*>(.*?)<\/h1>/.exec(html)?.[1]).toBe(CELEBRITY_WEB.withdrawnTitle);
    expect(html).toContain('href="/shop"');
  });
});
