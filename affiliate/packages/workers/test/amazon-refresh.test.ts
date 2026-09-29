import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDatabase } from '../../api/test/pgmem.js';
import { nextUtcDay, pauseUntil, refreshAmazonOffers, type ItemsClient } from '../src/amazon/refresh.js';
import {
  CreatorsApiClient,
  CreatorsApiError,
  creatorsApiConfigFromEnv,
  exactPriceMinor,
  parseGetItemsBody,
  type FetchLike,
} from '../src/amazon/creators-api.js';

/**
 * The Amazon offer refresh (src/amazon/refresh.ts) and the Creators API
 * client (src/amazon/creators-api.ts), with a fake client / fake fetch: no
 * network, no credentials (TEST values only), no Redis.
 */

type PgMemPool = TestDatabase['Pool'] extends new () => infer P ? P : never;
let pool: PgMemPool;

const ORG = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
let programmeId: string;
const offerIds: Record<string, string> = {};

const ASINS = ['B0DEMO0001', 'B0DEMO0002', 'B0DEMO0003', 'B0DEMO0004'];

async function id(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await pool.query(sql, params);
  return String(rows[0]!.id);
}

async function offer(asin: string) {
  const { rows } = await pool.query(
    `select price_minor, price_as_of, stock_status, status, stale_reason, fresh_until from offers where id = $1`,
    [offerIds[asin]],
  );
  return rows[0]!;
}

beforeAll(async () => {
  pool = new (createTestDb().Pool)();
  await pool.query(`insert into organisations (id, name, slug) values ($1, 'Demo refresh', 'demo-refresh')`, [ORG]);
  const merchant = await id(`insert into merchants (org_id, name) values ($1, 'Amazon.in') returning id`, [ORG]);
  programmeId = await id(
    `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis)
     values ($1, $2, 'amazon-associates', 'Amazon.in Associates', 'active', 'associates_fee_schedule') returning id`,
    [ORG, merchant],
  );
  await pool.query(
    `insert into amazon_associates_accounts (org_id, programme_id, marketplace_host, store_id, account_ref, disclosure_text)
     values ($1, $2, 'www.amazon.in', 'demo-21', 'amazon-associates:demo-21', 'As an Amazon Associate I earn from qualifying purchases.')`,
    [ORG, programmeId],
  );
  const product = await id(`insert into products (org_id, brand, model, category) values ($1, 'Demo', 'Demo', 'Home') returning id`, [ORG]);
  for (const asin of ASINS) {
    const variant = await id(`insert into variants (org_id, product_id, merchant_sku) values ($1, $2, $3) returning id`, [ORG, product, asin]);
    offerIds[asin] = await id(
      `insert into offers (org_id, variant_id, programme_id, merchant_id, price_minor, offer_url, fresh_until, status, merchant_item_ref)
       values ($1, $2, $3, $4, null, $5, now() + interval '2 days', 'active', $6) returning id`,
      [ORG, variant, programmeId, merchant, `https://www.amazon.in/dp/${asin}`, asin],
    );
  }
});

describe('refreshAmazonOffers', () => {
  it('without credentials: a logged no-op that still expires prices older than 1 hour', async () => {
    await pool.query(`update offers set price_minor = 50000, price_as_of = now() - interval '61 minutes' where id = $1`, [offerIds.B0DEMO0004]);
    await pool.query(`update offers set price_minor = 40000, price_as_of = now() - interval '30 minutes' where id = $1`, [offerIds.B0DEMO0002]);
    const logs: string[] = [];
    const s = await refreshAmazonOffers(pool, { clientFor: () => null, log: (_l, m) => void logs.push(m) });
    expect(s).toMatchObject({ accounts: 1, expired_prices: 1, requests: 0, skipped_no_credentials: 1, priced: 0 });
    expect(logs.join(' ')).toMatch(/prices stay hidden/);
    expect(await offer('B0DEMO0004')).toMatchObject({ price_minor: null, price_as_of: null, status: 'active' });
    // Younger than the hour: kept.
    expect(Number((await offer('B0DEMO0002')).price_minor)).toBe(40000);
  });

  it('with a client: priced items get price + time and a longer fresh_until; not accessible → stale; missing → no price', async () => {
    const calls: string[][] = [];
    const client: ItemsClient = {
      getItems: async (asins) => {
        calls.push(asins);
        return {
          items: [
            { asin: 'B0DEMO0001', priceMinor: 129900, stockStatus: 'in_stock' },
            { asin: 'B0DEMO0002', priceMinor: null, stockStatus: 'out_of_stock' },
          ],
          notAccessible: ['B0DEMO0003'],
        };
      },
    };
    const before = await offer('B0DEMO0001');
    const s = await refreshAmazonOffers(pool, { clientFor: () => client, minIntervalMs: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sort()).toEqual([...ASINS].sort());
    expect(s).toMatchObject({ requests: 1, priced: 1, unpriced: 2, stale: 1 });
    const priced = await offer('B0DEMO0001');
    expect(Number(priced.price_minor)).toBe(129900);
    expect(priced.stock_status).toBe('in_stock');
    expect(Date.now() - new Date(priced.price_as_of).getTime()).toBeLessThan(60_000);
    expect(new Date(priced.fresh_until).getTime()).toBeGreaterThan(new Date(before.fresh_until).getTime() + 20 * 86_400_000);
    expect(await offer('B0DEMO0002')).toMatchObject({ price_minor: null, price_as_of: null, stock_status: 'out_of_stock', status: 'active' });
    expect(await offer('B0DEMO0003')).toMatchObject({ status: 'stale', stale_reason: 'merchant_not_accessible', price_minor: null });
    expect(await offer('B0DEMO0004')).toMatchObject({ price_minor: null, stock_status: 'unknown', status: 'active' });
  });

  it('an offer Amazon reported not accessible is asked again, and comes back when Amazon lists the item again', async () => {
    const still: ItemsClient = { getItems: async () => ({ items: [], notAccessible: ['B0DEMO0003'] }) };
    const s1 = await refreshAmazonOffers(pool, { clientFor: () => still, minIntervalMs: 0 });
    expect(s1).toMatchObject({ stale: 0, reactivated: 0 });
    expect(await offer('B0DEMO0003')).toMatchObject({ status: 'stale', stale_reason: 'merchant_not_accessible' });
    const back: ItemsClient = {
      getItems: async (asins) => ({ items: asins.map((asin) => ({ asin, priceMinor: 9900, stockStatus: 'in_stock' as const })), notAccessible: [] }),
    };
    const s2 = await refreshAmazonOffers(pool, { clientFor: () => back, minIntervalMs: 0 });
    expect(s2.reactivated).toBe(1);
    expect(await offer('B0DEMO0003')).toMatchObject({ status: 'active', stale_reason: null });
    expect(Number((await offer('B0DEMO0003')).price_minor)).toBe(9900);
  });

  it('a 429 pauses the account for retryAfterSeconds (else until the next UTC day); a 403 until the next UTC day; nothing else changes', async () => {
    const snapshot = await offer('B0DEMO0001');
    const t0 = new Date();
    let calls = 0;
    const throttled = {
      getItems: async () => {
        calls += 1;
        return Promise.reject(new CreatorsApiError(429, 'ThrottleException', 'slow down', 2));
      },
    };
    const s = await refreshAmazonOffers(pool, { clientFor: () => throttled, minIntervalMs: 0, now: () => t0 });
    expect(s.stopped).toEqual([
      { account_id: expect.any(String), status: 429, code: 'ThrottleException', paused_until: new Date(t0.getTime() + 2000).toISOString() },
    ]);
    expect(await offer('B0DEMO0001')).toEqual(snapshot);
    // Paused: the next run asks nothing…
    const s2 = await refreshAmazonOffers(pool, { clientFor: () => throttled, minIntervalMs: 0, now: () => new Date(t0.getTime() + 1000) });
    expect(s2.requests).toBe(0);
    expect(s2.skipped_paused).toHaveLength(1);
    expect(calls).toBe(1);
    // …until the pause is over.
    const s3 = await refreshAmazonOffers(pool, { clientFor: () => throttled, minIntervalMs: 0, now: () => new Date(t0.getTime() + 3000) });
    expect(s3.requests).toBe(1);

    expect(pauseUntil(429, null, new Date('2026-09-29T21:15:00Z'))!.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(pauseUntil(403, null, new Date('2026-09-29T21:15:00Z'))!.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(pauseUntil(401, 5, new Date('2026-09-29T21:15:00Z'))!.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(pauseUntil(503, 5, new Date('2026-09-29T21:15:00Z'))).toBeNull();
    expect(nextUtcDay(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    await pool.query(`update amazon_associates_accounts set api_paused_until = null where org_id = $1`, [ORG]);
  });
});

describe('Creators API client (fake fetch, TEST credentials)', () => {
  const env = { AMAZON_CREATORS_CREDENTIAL_ID: 'test-id', AMAZON_CREATORS_CREDENTIAL_SECRET: 'test-secret' };

  it('config: none without credentials; version 3.2 → the EU token endpoint; unknown version needs a URL', () => {
    expect(creatorsApiConfigFromEnv({}, { marketplace_host: 'www.amazon.in', store_id: 'demo-21' })).toBeNull();
    const cfg = creatorsApiConfigFromEnv(env, { marketplace_host: 'www.amazon.in', store_id: 'demo-21' })!;
    expect(cfg).toMatchObject({ tokenUrl: 'https://api.amazon.co.uk/auth/o2/token', apiBase: 'https://creatorsapi.amazon', partnerTag: 'demo-21' });
    expect(() =>
      creatorsApiConfigFromEnv({ ...env, AMAZON_CREATORS_CREDENTIAL_VERSION: '9.9' }, { marketplace_host: 'www.amazon.in', store_id: 'demo-21' }),
    ).toThrow(/AMAZON_CREATORS_TOKEN_URL/);
  });

  it('client credentials once per hour, GetItems with the marketplace header and body fields', async () => {
    const requests: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      if (url.endsWith('/auth/o2/token')) return { status: 200, text: async () => JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }) };
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            itemResults: {
              items: [
                {
                  asin: 'B0DEMO0001',
                  offersV2: { listings: [{ isBuyBoxWinner: true, price: { money: { amount: 1299.5, currency: 'INR', displayAmount: '₹1,299.50' } }, availability: { type: 'IN_STOCK' } }] },
                },
              ],
            },
          }),
      };
    };
    let now = 1_000_000;
    const client = new CreatorsApiClient(creatorsApiConfigFromEnv(env, { marketplace_host: 'www.amazon.in', store_id: 'demo-21' })!, fetchImpl, () => now);
    const r1 = await client.getItems(['B0DEMO0001']);
    const r2 = await client.getItems(['B0DEMO0001']);
    expect(r1.items[0]).toEqual({ asin: 'B0DEMO0001', priceMinor: 129950, stockStatus: 'in_stock' });
    expect(r2.items).toHaveLength(1);
    expect(requests.filter((r) => r.url.endsWith('/auth/o2/token'))).toHaveLength(1);
    expect(requests[0]!.body).toEqual({ grant_type: 'client_credentials', client_id: 'test-id', client_secret: 'test-secret', scope: 'creatorsapi::default' });
    const call = requests[1]!;
    expect(call.url).toBe('https://creatorsapi.amazon/catalog/v1/getItems');
    expect(call.headers).toMatchObject({ Authorization: 'Bearer tok-1', 'x-marketplace': 'www.amazon.in' });
    expect(call.body).toMatchObject({ itemIds: ['B0DEMO0001'], itemIdType: 'ASIN', marketplace: 'www.amazon.in', partnerTag: 'demo-21' });
    now += 3600 * 1000;
    await client.getItems(['B0DEMO0001']);
    expect(requests.filter((r) => r.url.endsWith('/auth/o2/token'))).toHaveLength(2);
  });

  it('errors carry status, code and retryAfterSeconds (429) or AssociateNotEligible (403)', async () => {
    const fetchImpl: FetchLike = async (url) =>
      url.endsWith('/auth/o2/token')
        ? { status: 200, text: async () => JSON.stringify({ access_token: 't', expires_in: 3600 }) }
        : { status: 403, text: async () => JSON.stringify({ errors: [{ code: 'AssociateNotEligible', message: 'not eligible' }] }) };
    const client = new CreatorsApiClient(creatorsApiConfigFromEnv(env, { marketplace_host: 'www.amazon.in', store_id: 'demo-21' })!, fetchImpl);
    await expect(client.getItems(['B0DEMO0001'])).rejects.toMatchObject({ status: 403, code: 'AssociateNotEligible' });
  });

  it('exact paise from the decimal text; disagreement, a third decimal or another currency → no price', () => {
    expect(exactPriceMinor({ amount: 1299, currency: 'INR', displayAmount: '₹1,299.00' })).toBe(129900);
    expect(exactPriceMinor({ amount: 59.49, currency: 'INR' })).toBe(5949);
    expect(exactPriceMinor({ displayAmount: 'Rs. 12,34,567.00' })).toBe(123456700);
    expect(exactPriceMinor({ amount: 59.495, currency: 'INR' })).toBeNull();
    expect(exactPriceMinor({ amount: 100, currency: 'INR', displayAmount: '₹101.00' })).toBeNull();
    expect(exactPriceMinor({ amount: 100, currency: 'USD' })).toBeNull();
    expect(exactPriceMinor(null)).toBeNull();
  });

  it('reads itemsResult and itemResults; explicit ItemNotAccessible errors name the ASIN', () => {
    const body = {
      itemsResult: { items: [{ asin: 'B0DEMO0001', offersV2: { listings: [] } }] },
      errors: [{ code: 'ItemNotAccessible', message: 'The ItemId B0DEMO0002 is not accessible through the API.' }],
    };
    expect(parseGetItemsBody(body, ['B0DEMO0001', 'B0DEMO0002'])).toEqual({
      items: [{ asin: 'B0DEMO0001', priceMinor: null, stockStatus: 'unknown' }],
      notAccessible: ['B0DEMO0002'],
    });
  });
});
