// Amazon offers on the catalogue read paths: a price is shown only when it came
// from the product API with its time and is younger than the programme's limit
// (1 h); otherwise price_minor is null (never an old price, never 0), the
// offer stays live, the programme's disclosure rides along, and offer_url is
// still never returned by the catalogue. pg-mem; TEST data only.

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_amazon_catalogue';
process.env.JWT_SECRET ??= 'amazon-catalogue-test-secret';
process.env.API_PORT ??= '0';

import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { createTestDb } from './pgmem.js';
import { AMZ, declarations, seedOwnNetwork, type OwnNetwork, type PoolLike } from './amazon-fixtures.js';
import { displayablePrice, displayableStock } from '../src/offer-price.js';

let pool: PoolLike;
let app: FastifyInstance;
let net: OwnNetwork;
let lookId: string;
let offerId: string;
let programmeId: string;

const ORG = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ADMIN = { id: '00000000-0000-0000-0000-00000000c001', role: 'network_admin' };
const ANALYST = { id: '00000000-0000-0000-0000-00000000c002', role: 'publisher_analyst' };
const bearer = (u: { id: string; role: string }) => ({
  authorization: `Bearer ${jwt.sign({ sub: u.id, org_id: ORG, role: u.role }, process.env.JWT_SECRET as string)}`,
});

async function item() {
  const res = await app.inject({ method: 'GET', url: `/v1/looks/${lookId}`, headers: bearer(ANALYST) });
  expect(res.statusCode).toBe(200);
  expect(res.body).not.toContain('amazon.in/dp');
  return res.json().data.items[0].offer;
}

beforeAll(async () => {
  const tdb = createTestDb({ rollback: true });
  pool = new tdb.Pool();
  const dbMod = await import('../src/db.js');
  dbMod.__setPool(pool as unknown as Parameters<typeof dbMod.__setPool>[0]);
  const { buildApp } = await import('../src/index.js');
  app = await buildApp();
  await app.ready();
  net = await seedOwnNetwork(pool, ORG, 'amzcat', ADMIN.id);
  const setup = await import('../src/amazon/setup.js');
  const summary = await setup.setupAmazonAssociates({ orgSlug: net.slug, storeId: AMZ.STORE, declarations: declarations(net), publisherShareBps: 7000 });
  programmeId = summary.programme_id;
  const offers = await import('../src/amazon/offers.js');
  const added = await offers.addAmazonOffers({
    orgSlug: net.slug,
    offers: [{ row: 1, asin: AMZ.ASIN, brand: 'Demo Brand', model: 'Demo Kettle', category: 'Home', size: null, colour: null }],
  });
  offerId = added.offers[0]!.offer_id;
  const { rows: a } = await pool.query(
    `insert into assets (org_id, storage_key, license) values ($1, 'demo/amz/kettle.jpg', 'owned') returning id`,
    [ORG],
  );
  const { rows: l } = await pool.query(
    `insert into looks (org_id, title, status, published_at) values ($1, 'Demo look — Amazon', 'published', now()) returning id`,
    [ORG],
  );
  lookId = String(l[0]!.id);
  await pool.query(
    `insert into look_items (org_id, look_id, asset_id, variant_id, match_type) values ($1, $2, $3, $4, 'exact')`,
    [ORG, lookId, a[0]!.id, added.offers[0]!.variant_id],
  );
}, 30000);

describe('Amazon offer prices on GET /v1/looks/:id and GET /v1/offers', () => {
  it('no API price → a live offer with price_minor null, the disclosure, and no merchant URL', async () => {
    const offer = await item();
    expect(offer).toMatchObject({
      id: offerId,
      connector: 'amazon-associates',
      merchant: { name: 'Amazon.in' },
      price_minor: null,
      price_as_of: null,
      currency: 'INR',
      stock_status: 'unknown',
      disclosure: 'As an Amazon Associate I earn from qualifying purchases.',
    });
    const offers = await app.inject({ method: 'GET', url: `/v1/offers?programme_id=${programmeId}`, headers: bearer(ANALYST) });
    expect(offers.json().data[0]).toMatchObject({ price_minor: null, price_as_of: null });
  });

  it('an API price younger than 1 h (the Creators API: "Offers | 1 hour") is shown with its time; at 61 minutes it is not', async () => {
    const asOf = new Date(Date.now() - 30 * 60_000).toISOString();
    await pool.query(`update offers set price_minor = 129900, price_as_of = $2::timestamptz where id = $1`, [offerId, asOf]);
    const fresh = await item();
    expect(fresh.price_minor).toBe(129900);
    expect(fresh.price_as_of).toBe(asOf);

    await pool.query(`update offers set stock_status = 'in_stock' where id = $1`, [offerId]);
    expect((await item()).stock_status).toBe('in_stock');

    await pool.query(`update offers set price_as_of = now() - interval '61 minutes' where id = $1`, [offerId]);
    const old = await item();
    expect(old.price_minor).toBeNull();
    expect(old.price_as_of).toBeNull();
    // Availability is under the same 1-hour rule as the price: no stale "In stock".
    expect(old.stock_status).toBe('unknown');
    const offers = await app.inject({ method: 'GET', url: `/v1/offers?programme_id=${programmeId}`, headers: bearer(ANALYST) });
    expect(offers.json().data[0].price_minor).toBeNull();
    expect(offers.json().data[0].stock_status).toBe('unknown');
  });

  it('displayableStock: limited programmes show a stock status only beside a displayable price', () => {
    expect(displayableStock({ stock_status: 'in_stock' }, { price_as_of: null })).toBe('in_stock');
    expect(displayableStock({ stock_status: 'in_stock', price_max_age_hours: null }, { price_as_of: null })).toBe('in_stock');
    expect(displayableStock({ stock_status: 'in_stock', price_max_age_hours: 24 }, { price_as_of: null })).toBe('unknown');
    expect(displayableStock({ stock_status: 'out_of_stock', price_max_age_hours: 24 }, { price_as_of: '2026-09-29T11:00:00.000Z' })).toBe(
      'out_of_stock',
    );
  });

  it('displayablePrice: legacy offers keep their price; limited ones need a time inside the limit', () => {
    const now = Date.parse('2026-09-29T12:00:00Z');
    expect(displayablePrice({ price_minor: '99900' }, now)).toEqual({ price_minor: 99900, price_as_of: null });
    expect(displayablePrice({ price_minor: '99900', price_max_age_hours: 24 }, now).price_minor).toBeNull();
    expect(displayablePrice({ price_minor: null, price_max_age_hours: null }, now).price_minor).toBeNull();
    expect(
      displayablePrice({ price_minor: '100', price_as_of: '2026-09-29T11:00:00Z', price_max_age_hours: 24 }, now),
    ).toEqual({ price_minor: 100, price_as_of: '2026-09-29T11:00:00.000Z' });
    expect(displayablePrice({ price_minor: '100', price_as_of: '2026-09-29T13:00:00Z', price_max_age_hours: 24 }, now).price_minor).toBeNull();
  });
});
