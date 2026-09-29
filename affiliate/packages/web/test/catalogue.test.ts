import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLook,
  listLooks,
  CatalogueUnavailableError,
  lookOrMiss,
  mapLookDetail,
  mapLookItem,
  mapLookSummary,
  type LookDetailRow,
  type LookItemRow,
  type LookRow,
} from '../lib/catalogue';
import { apiBase, webPlacementId } from '../lib/server-env';
import { gradientSeedFor } from '../lib/types';

const LOOK_ID = '5793fbd2-9e8b-4a94-ac49-b1fde7128084';
const PLACEMENT_ID = 'a1b15b6e-556f-4183-9f09-75b6ccea5d30';

const row: LookRow = {
  id: LOOK_ID,
  title: 'Demo festive look',
  locale: 'en',
  category: 'apparel',
  published_at: '2026-09-29T00:00:00.000Z',
  source_page: 'Demo Candid Frames',
  sponsored: false,
  cover_url: 'https://cdn.example.com/demo/looks/look-1.jpg',
  item_count: 1,
};

const liveItem: LookItemRow = {
  id: 'fb706413-e8d2-41c4-bc6c-39d905649a46',
  match_type: 'exact',
  evidence: null,
  product: { id: 'p', brand: 'Demo Brand', model: 'Festive Kurta', category: 'apparel' },
  variant: { id: 'v', size_text: 'M', colour: 'Red', merchant_sku: 'DEMO-SKU-001' },
  offer: {
    id: 'b1e5adbe-d74c-4df2-bc03-47fdc800f693',
    programme_id: 'cd70fe7c-85a2-46d2-85c2-2d9e2005af29',
    merchant: { id: 'm', name: 'Demo Merchant' },
    price_minor: 200000,
    currency: 'INR',
    stock_status: 'in_stock',
    fresh_until: '2026-10-29T00:00:00.000Z',
  },
  link: { token: 'a'.repeat(32), url: `http://127.0.0.1:3101/r/${'a'.repeat(32)}` },
};

const detail: LookDetailRow = {
  ...row,
  status: 'published',
  items: [liveItem, { ...liveItem, id: 'item-no-link', link: null }, { ...liveItem, id: 'item-no-offer', offer: null, link: null }],
  placement: { id: PLACEMENT_ID, property_id: 'prop', campaign_id: 'camp' },
};

type FetchMock = ReturnType<typeof vi.fn> & { mock: { calls: unknown[][] } };
/** First argument (the URL) of the n-th fetch call. */
function calledUrl(fetchMock: unknown, n: number): unknown {
  return (fetchMock as FetchMock).mock.calls[n]?.[0];
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('mapping', () => {
  it('maps a list row onto LookSummary (cover, sponsored, source page, item count)', () => {
    const s = mapLookSummary(row);
    expect(s).toMatchObject({
      id: LOOK_ID,
      title: 'Demo festive look',
      category: 'apparel',
      sourcePage: 'Demo Candid Frames',
      sponsored: false,
      coverUrl: 'https://cdn.example.com/demo/looks/look-1.jpg',
      publishedAt: '2026-09-29T00:00:00.000Z',
      itemCount: 1,
    });
    expect(s.gradientSeed).toEqual(gradientSeedFor(LOOK_ID));
    expect(mapLookSummary({ ...row, source_page: null, cover_url: null, category: null }).sourcePage).toBeNull();
  });

  it('maps a live offer with a tracked link', () => {
    const it = mapLookItem(liveItem);
    expect(it).toMatchObject({
      available: true,
      merchant: 'Demo Merchant',
      price_minor: 200000,
      currency: 'INR',
      stock: 'in_stock',
      freshness: '2026-10-29T00:00:00.000Z',
      match: 'exact',
      linkUrl: `http://127.0.0.1:3101/r/${'a'.repeat(32)}`,
      variant: { size: 'M', colour: 'Red', sku: 'DEMO-SKU-001' },
    });
  });

  it('maps a live offer without a link to linkUrl null (CTA disabled, never a merchant URL)', () => {
    const it = mapLookItem({ ...liveItem, link: null });
    expect(it.available).toBe(true);
    expect(it.linkUrl).toBeNull();
    expect(JSON.stringify(it)).not.toContain('offer_url');
  });

  it('maps an item without a live offer to "not available" (no price, no merchant, no link)', () => {
    const it = mapLookItem({ ...liveItem, offer: null, link: null });
    expect(it).toMatchObject({ available: false, merchant: null, price_minor: null, currency: null, stock: null, freshness: null, linkUrl: null });
  });

  it('normalises an unknown match_type to null', () => {
    expect(mapLookItem({ ...liveItem, match_type: 'weird' as unknown as 'exact' }).match).toBeNull();
    expect(mapLookItem({ ...liveItem, match_type: null }).match).toBeNull();
  });

  it('maps detail rows, counting items itself', () => {
    const d = mapLookDetail(detail);
    expect(d.itemCount).toBe(3);
    expect(d.items.map((i) => i.available)).toEqual([true, true, false]);
  });
});

describe('server env', () => {
  it('resolves API_BASE, then an absolute NEXT_PUBLIC_API_BASE, then the default', () => {
    vi.stubEnv('API_BASE', 'http://api.internal:3000/');
    vi.stubEnv('NEXT_PUBLIC_API_BASE', 'https://public.example.com');
    expect(apiBase()).toBe('http://api.internal:3000');
    vi.stubEnv('API_BASE', '');
    expect(apiBase()).toBe('https://public.example.com');
    vi.stubEnv('NEXT_PUBLIC_API_BASE', '/api');
    expect(apiBase()).toBe('http://localhost:3000');
  });

  it('ignores a non-uuid WEB_PLACEMENT_ID', () => {
    vi.stubEnv('WEB_PLACEMENT_ID', 'not-a-uuid');
    expect(webPlacementId()).toBeNull();
    vi.stubEnv('WEB_PLACEMENT_ID', PLACEMENT_ID);
    expect(webPlacementId()).toBe(PLACEMENT_ID);
  });
});

describe('listLooks', () => {
  it('returns TEST-labelled mock data flagged demo when WEB_API_TOKEN is missing (no fetch)', async () => {
    vi.stubEnv('WEB_API_TOKEN', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await listLooks();
    expect(res.demo).toBe(true);
    expect(res.value.length).toBeGreaterThan(0);
    expect(res.value.every((l) => l.title.startsWith('Demo'))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pages the live list with the bearer token and revalidate 60', async () => {
    vi.stubEnv('WEB_API_TOKEN', 'tok');
    vi.stubEnv('API_BASE', 'http://127.0.0.1:3100');
    const fetchMock = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'));
      const items = page === 1 ? [row, { ...row, id: 'second' }] : [{ ...row, id: 'third' }];
      return jsonResponse(200, { data: { items, page, page_size: 100, total: 3 }, request_id: 'r' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await listLooks();
    expect(res.demo).toBe(false);
    expect(res.value.map((l) => l.id)).toEqual([LOOK_ID, 'second', 'third']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { next?: { revalidate?: number } }];
    expect(url).toBe('http://127.0.0.1:3100/v1/looks?page=1&page_size=100');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
    expect(init.next?.revalidate).toBe(60);
  });

  it('falls back to demo data when the API errors or is unreachable', async () => {
    vi.stubEnv('WEB_API_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'x' } })));
    expect((await listLooks()).demo).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect((await listLooks()).demo).toBe(true);
  });
});

describe('getLook', () => {
  it('appends WEB_PLACEMENT_ID and maps the detail', async () => {
    vi.stubEnv('WEB_API_TOKEN', 'tok');
    vi.stubEnv('API_BASE', 'http://127.0.0.1:3100');
    vi.stubEnv('WEB_PLACEMENT_ID', PLACEMENT_ID);
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: detail, request_id: 'r' }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await getLook(LOOK_ID);
    expect(res.demo).toBe(false);
    expect(res.value?.items).toHaveLength(3);
    expect(res.value?.items[0]?.linkUrl).toMatch(/\/r\/[0-9a-f]{32}$/);
    expect(calledUrl(fetchMock, 0)).toBe(`http://127.0.0.1:3100/v1/looks/${LOOK_ID}?placement_id=${PLACEMENT_ID}`);
  });

  it('omits placement_id when WEB_PLACEMENT_ID is unset', async () => {
    vi.stubEnv('WEB_API_TOKEN', 'tok');
    vi.stubEnv('API_BASE', 'http://127.0.0.1:3100');
    vi.stubEnv('WEB_PLACEMENT_ID', '');
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: { ...detail, placement: null }, request_id: 'r' }));
    vi.stubGlobal('fetch', fetchMock);
    await getLook(LOOK_ID);
    expect(calledUrl(fetchMock, 0)).toBe(`http://127.0.0.1:3100/v1/looks/${LOOK_ID}`);
  });

  it('treats a live 404 (and 400 for a malformed id) as not found, not as demo', async () => {
    vi.stubEnv('WEB_API_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Look not found' } })));
    expect(await getLook(LOOK_ID)).toEqual({ value: null, demo: false });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(400, { error: { code: 'VALIDATION_ERROR', message: 'bad id' } })));
    expect(await getLook('look-1')).toEqual({ value: null, demo: false });
  });

  it('falls back to the mock look on outages (null for ids the mock does not know)', async () => {
    vi.stubEnv('WEB_API_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const known = await getLook('look-1');
    expect(known.demo).toBe(true);
    expect(known.value?.title.startsWith('Demo')).toBe(true);
    expect(known.value?.items.every((i) => i.linkUrl === null)).toBe(true);
    const unknown = await getLook(LOOK_ID);
    expect(unknown).toEqual({ value: null, demo: true, outage: true });
    // The page must not answer 404 for a look that may exist: lookOrMiss throws.
    expect(() => lookOrMiss(unknown)).toThrow(CatalogueUnavailableError);
  });

  it('a 503 for a live id is an outage, never a miss', async () => {
    vi.stubEnv('WEB_API_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'down' } })));
    const result = await getLook(LOOK_ID);
    expect(result).toEqual({ value: null, demo: true, outage: true });
    expect(() => lookOrMiss(result)).toThrow('Catalogue temporarily unavailable');
    // a real 404 stays a miss
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Look not found' } })));
    expect(lookOrMiss(await getLook(LOOK_ID))).toBeNull();
  });

  it('serves the mock look in demo mode (no token) and null for unknown ids', async () => {
    vi.stubEnv('WEB_API_TOKEN', '');
    expect((await getLook('look-2')).value?.id).toBe('look-2');
    expect((await getLook('nope')).value).toBeNull();
  });
});
