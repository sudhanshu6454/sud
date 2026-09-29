// Catalogue endpoints for the consumer shop — GET /v1/looks (extended fields)
// and GET /v1/looks/:id (items + live offer + tracked link) — against pg-mem.
//
// Same environment notes as phase3.test.ts: DATABASE_URL/JWT_SECRET are set
// before the API modules are imported; API_PORT=0 keeps the import-time
// main() side effect off a real port; auth is the JWT stub. All seed data is
// TEST-labelled (Demo …, example.com).

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_catalogue';
process.env.JWT_SECRET ??= 'catalogue-test-secret';
process.env.API_PORT ??= '0';
// Trailing slash on purpose: the shared helper must strip it so the URL is
// byte-identical to what POST /v1/links mints.
process.env.REDIRECT_BASE_URL = 'https://go.example.com/';

import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { createTestDb, type TestDatabase } from './pgmem.js';

type PoolLike = TestDatabase['Pool'] extends new () => infer P ? P : never;

let pool: PoolLike;
let app: FastifyInstance;

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const USERS = {
  AD: { id: '00000000-0000-0000-0000-000000000003', role: 'network_admin' },
  ED: { id: '00000000-0000-0000-0000-000000000004', role: 'editor' },
  OW: { id: '00000000-0000-0000-0000-000000000005', role: 'publisher_owner' },
  FO: { id: '00000000-0000-0000-0000-000000000006', role: 'finance_operator' },
} as const;

function bearer(user: { id: string; role: string }, orgId: string) {
  const token = jwt.sign({ sub: user.id, org_id: orgId, role: user.role }, process.env.JWT_SECRET as string);
  return { authorization: `Bearer ${token}` };
}

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const RAW_OFFER_HOST = 'shop.example.com';
const COVER_URL = 'https://cdn.example.com/demo-cover.jpg';
const SOURCE_PAGE = 'https://example.com/demo-street-style';
const DEMO_TOKEN = 'demo0000cafe0000babe0000face0000';
const PAUSED_TOKEN = 'demo0000dead0000beef0000feed0000';

async function insertReturningId(text: string, params: unknown[]): Promise<string> {
  const { rows } = await pool.query(text, params);
  return String(rows[0]!.id);
}

interface OfferOpts {
  price: number;
  status?: string;
  freshDays?: number;
}

async function seedOffer(
  orgId: string,
  variantId: string,
  programmeId: string,
  merchantId: string,
  o: OfferOpts,
): Promise<string> {
  return insertReturningId(
    `insert into offers (org_id, variant_id, programme_id, merchant_id, price_minor, offer_url, fresh_until, status)
     values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8) returning id`,
    [
      orgId,
      variantId,
      programmeId,
      merchantId,
      o.price,
      `https://${RAW_OFFER_HOST}/p/${randomUUID().slice(0, 8)}`,
      daysFromNow(o.freshDays ?? 30),
      o.status ?? 'active',
    ],
  );
}

async function seedVariant(orgId: string, brand: string, model: string, sku: string): Promise<string> {
  const productId = await insertReturningId(
    `insert into products (org_id, brand, model, category) values ($1, $2, $3, 'kurta') returning id`,
    [orgId, brand, model],
  );
  return insertReturningId(
    `insert into variants (org_id, product_id, size_text, colour, merchant_sku)
     values ($1, $2, 'M', 'red', $3) returning id`,
    [orgId, productId, sku],
  );
}

async function seedLookItem(orgId: string, lookId: string, assetId: string, variantId: string, matchType: string, evidence: string) {
  return insertReturningId(
    `insert into look_items (org_id, look_id, asset_id, variant_id, match_type, evidence)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [orgId, lookId, assetId, variantId, matchType, evidence],
  );
}

// ORG_A fixtures
let merchantA: string;
let progActive: string;
let progPaused: string;
let propertyA: string;
let campaignA: string;
let placementA: string;
let placementA2: string;
let variantMain: string; // several offers; cheapest live must win
let variantStaleOnly: string; // only a stale offer → offer null
let variantPausedOnly: string; // only an offer on a paused programme → offer null
let cheapLiveOffer: string;
let lookPub: string; // published, cover, sponsored, 3 items
let lookPub2: string; // published, no cover, no items
let lookDraft: string; // draft
let itemIds: string[];

// ORG_B fixtures
let placementB: string;
let lookB: string;

beforeAll(async () => {
  const tdb = createTestDb();
  pool = new tdb.Pool();

  const dbMod = await import('../src/db.js');
  dbMod.__setPool(pool as unknown as Parameters<typeof dbMod.__setPool>[0]);
  const { buildApp } = await import('../src/index.js');
  app = await buildApp();
  await app.ready();

  for (const [orgId, slug] of [[ORG_A, 'demo-org-a'], [ORG_B, 'demo-org-b']] as const) {
    await pool.query(`insert into organisations (id, name, slug) values ($1, $2, $3)`, [orgId, slug, slug]);
  }
  for (const u of Object.values(USERS)) {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [u.id, `${u.role}@catalogue.example.com`]);
  }

  // ---- ORG_A ----
  merchantA = await insertReturningId(`insert into merchants (org_id, name) values ($1, 'Demo Merchant A') returning id`, [ORG_A]);
  progActive = await insertReturningId(
    `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis)
     values ($1, $2, 'stub-network', 'Demo Programme (active)', 'active', 'sale') returning id`,
    [ORG_A, merchantA],
  );
  progPaused = await insertReturningId(
    `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis)
     values ($1, $2, 'stub-network', 'Demo Programme (paused)', 'paused', 'sale') returning id`,
    [ORG_A, merchantA],
  );
  const publisherA = await insertReturningId(
    `insert into publishers (org_id, legal_name, country, status, onboarding_state)
     values ($1, 'Demo Publisher A', 'IN', 'approved', 'active') returning id`,
    [ORG_A],
  );
  propertyA = await insertReturningId(
    `insert into properties (org_id, publisher_id, platform, external_account_id, status)
     values ($1, $2, 'instagram', 'ig-demo-a', 'approved') returning id`,
    [ORG_A, publisherA],
  );
  campaignA = await insertReturningId(
    `insert into campaigns (org_id, publisher_id, programme_id, name) values ($1, $2, $3, 'Demo campaign A') returning id`,
    [ORG_A, publisherA, progActive],
  );
  placementA = await insertReturningId(
    `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
     values ($1, $2, $3, 'post', 'plc-demo-a-1') returning id`,
    [ORG_A, campaignA, propertyA],
  );
  placementA2 = await insertReturningId(
    `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
     values ($1, $2, $3, 'story', 'plc-demo-a-2') returning id`,
    [ORG_A, campaignA, propertyA],
  );

  variantMain = await seedVariant(ORG_A, 'Demo Brand', 'Demo Model 1', 'DEMO-SKU-1');
  variantStaleOnly = await seedVariant(ORG_A, 'Demo Brand', 'Demo Model 2', 'DEMO-SKU-2');
  variantPausedOnly = await seedVariant(ORG_A, 'Demo Brand', 'Demo Model 3', 'DEMO-SKU-3');

  // variantMain: cheapest LIVE must win over cheaper-but-not-live offers.
  await seedOffer(ORG_A, variantMain, progActive, merchantA, { price: 79900 }); // live, dearer
  cheapLiveOffer = await seedOffer(ORG_A, variantMain, progActive, merchantA, { price: 49900 }); // live, cheapest live
  await seedOffer(ORG_A, variantMain, progActive, merchantA, { price: 100, freshDays: -1 }); // stale
  await seedOffer(ORG_A, variantMain, progActive, merchantA, { price: 200, status: 'revoked' }); // revoked
  await seedOffer(ORG_A, variantMain, progPaused, merchantA, { price: 300 }); // paused programme
  await seedOffer(ORG_A, variantStaleOnly, progActive, merchantA, { price: 1000, freshDays: -2 });
  await seedOffer(ORG_A, variantPausedOnly, progActive, merchantA, { price: 1000, status: 'stale' });
  await seedOffer(ORG_A, variantPausedOnly, progPaused, merchantA, { price: 900 });

  const coverAsset = await insertReturningId(
    `insert into assets (org_id, storage_key, license, public_url) values ($1, 'demo/cover.jpg', 'demo', $2) returning id`,
    [ORG_A, COVER_URL],
  );
  const privateAsset = await insertReturningId(
    `insert into assets (org_id, storage_key, license) values ($1, 'demo/private.jpg', 'demo') returning id`,
    [ORG_A],
  );

  lookPub = await insertReturningId(
    `insert into looks (org_id, title, locale, category, status, published_at, source_page, sponsored, cover_asset_id)
     values ($1, 'Demo look (published)', 'en-IN', 'street-style', 'published', now() - interval '1 day', $2, true, $3) returning id`,
    [ORG_A, SOURCE_PAGE, coverAsset],
  );
  lookPub2 = await insertReturningId(
    `insert into looks (org_id, title, locale, category, status, published_at, cover_asset_id)
     values ($1, 'Demo look (published, no items)', 'en-IN', 'ethnic', 'published', now(), $2) returning id`,
    [ORG_A, privateAsset],
  );
  lookDraft = await insertReturningId(
    `insert into looks (org_id, title, locale, category, status)
     values ($1, 'Demo look (draft)', 'en-IN', 'street-style', 'draft') returning id`,
    [ORG_A],
  );

  itemIds = [
    await seedLookItem(ORG_A, lookPub, coverAsset, variantMain, 'exact', 'Demo evidence 1'),
    await seedLookItem(ORG_A, lookPub, coverAsset, variantStaleOnly, 'similar', 'Demo evidence 2'),
    await seedLookItem(ORG_A, lookPub, coverAsset, variantPausedOnly, 'similar', 'Demo evidence 3'),
  ];
  await seedLookItem(ORG_A, lookDraft, privateAsset, variantMain, 'exact', 'Demo evidence (draft)');

  // Links inserted directly (not minted): an active one for placementA and a
  // paused one for placementA2, both against the cheapest live offer.
  await pool.query(
    `insert into links (org_id, token, placement_id, offer_id, route_signature, status)
     values ($1, $2, $3, $4, 'demo-signature', 'active')`,
    [ORG_A, DEMO_TOKEN, placementA, cheapLiveOffer],
  );
  await pool.query(
    `insert into links (org_id, token, placement_id, offer_id, route_signature, status)
     values ($1, $2, $3, $4, 'demo-signature', 'paused')`,
    [ORG_A, PAUSED_TOKEN, placementA2, cheapLiveOffer],
  );

  // ---- ORG_B ----
  const merchantB = await insertReturningId(`insert into merchants (org_id, name) values ($1, 'Demo Merchant B') returning id`, [ORG_B]);
  const progB = await insertReturningId(
    `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis)
     values ($1, $2, 'stub-network', 'Demo Programme B', 'active', 'sale') returning id`,
    [ORG_B, merchantB],
  );
  const publisherB = await insertReturningId(
    `insert into publishers (org_id, legal_name, country, status, onboarding_state)
     values ($1, 'Demo Publisher B', 'IN', 'approved', 'active') returning id`,
    [ORG_B],
  );
  const propertyB = await insertReturningId(
    `insert into properties (org_id, publisher_id, platform, external_account_id, status)
     values ($1, $2, 'instagram', 'ig-demo-b', 'approved') returning id`,
    [ORG_B, publisherB],
  );
  const campaignB = await insertReturningId(
    `insert into campaigns (org_id, publisher_id, programme_id, name) values ($1, $2, $3, 'Demo campaign B') returning id`,
    [ORG_B, publisherB, progB],
  );
  placementB = await insertReturningId(
    `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
     values ($1, $2, $3, 'post', 'plc-demo-b-1') returning id`,
    [ORG_B, campaignB, propertyB],
  );
  lookB = await insertReturningId(
    `insert into looks (org_id, title, locale, category, status, published_at)
     values ($1, 'Demo look B', 'en-IN', 'street-style', 'published', now()) returning id`,
    [ORG_B],
  );
}, 30000);

async function getLooks(query = '', user: { id: string; role: string } = USERS.OW, orgId = ORG_A) {
  return app.inject({ method: 'GET', url: `/v1/looks${query}`, headers: bearer(user, orgId) });
}

async function getLook(id: string, query = '', user: { id: string; role: string } = USERS.OW, orgId = ORG_A) {
  return app.inject({ method: 'GET', url: `/v1/looks/${id}${query}`, headers: bearer(user, orgId) });
}

// ---------------------------------------------------------------------------
// GET /v1/looks
// ---------------------------------------------------------------------------

describe('GET /v1/looks (consumer list)', () => {
  it('returns published looks with source_page, sponsored, cover_url and item_count', async () => {
    const res = await getLooks();
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.total).toBe(2);
    expect(data.page).toBe(1);
    expect(data.page_size).toBe(20);
    const ids = data.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual([lookPub2, lookPub]); // newest published first
    expect(ids).not.toContain(lookDraft);

    const pub = data.items.find((i: { id: string }) => i.id === lookPub);
    expect(pub).toMatchObject({
      title: 'Demo look (published)',
      locale: 'en-IN',
      category: 'street-style',
      source_page: SOURCE_PAGE,
      sponsored: true,
      cover_url: COVER_URL,
      item_count: 3,
    });
    expect(typeof pub.published_at).toBe('string');
    expect(new Date(pub.published_at).toISOString()).toBe(pub.published_at);

    const pub2 = data.items.find((i: { id: string }) => i.id === lookPub2);
    expect(pub2).toMatchObject({ source_page: null, sponsored: false, cover_url: null, item_count: 0 });
  });

  it('keeps the category / locale filters and pagination', async () => {
    const byCategory = await getLooks('?category=ethnic');
    expect(byCategory.json().data.items.map((i: { id: string }) => i.id)).toEqual([lookPub2]);
    expect(byCategory.json().data.total).toBe(1);

    const page2 = await getLooks('?page=2&page_size=1');
    expect(page2.json().data.items.map((i: { id: string }) => i.id)).toEqual([lookPub]);
    expect(page2.json().data.total).toBe(2);

    const locale = await getLooks('?locale=hi-IN');
    expect(locale.json().data.items).toEqual([]);
    expect(locale.json().data.total).toBe(0);
  });

  it('is tenant-scoped: org B sees only its own looks', async () => {
    const res = await getLooks('', USERS.OW, ORG_B);
    expect(res.json().data.items.map((i: { id: string }) => i.id)).toEqual([lookB]);
  });

  it('never leaks the raw merchant offer_url', async () => {
    const res = await getLooks();
    const body = JSON.stringify(res.json());
    expect(body).not.toContain('offer_url');
    expect(body).not.toContain(RAW_OFFER_HOST);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/looks/:id
// ---------------------------------------------------------------------------

describe('GET /v1/looks/:id (consumer detail)', () => {
  it('returns the look with items, the cheapest live offer and the tracked link for the placement', async () => {
    const res = await getLook(lookPub, `?placement_id=${placementA}`);
    expect(res.statusCode).toBe(200);
    const { data } = res.json();

    expect(data).toMatchObject({
      id: lookPub,
      title: 'Demo look (published)',
      locale: 'en-IN',
      category: 'street-style',
      status: 'published',
      source_page: SOURCE_PAGE,
      sponsored: true,
      cover_url: COVER_URL,
      placement: { id: placementA, property_id: propertyA, campaign_id: campaignA },
    });
    expect(new Date(data.published_at).toISOString()).toBe(data.published_at);

    // items ordered by created_at then id
    expect(data.items.map((i: { id: string }) => i.id)).toEqual(itemIds);

    const main = data.items[0];
    expect(main).toMatchObject({
      match_type: 'exact',
      evidence: 'Demo evidence 1',
      product: { brand: 'Demo Brand', model: 'Demo Model 1', category: 'kurta' },
      variant: { id: variantMain, size_text: 'M', colour: 'red', merchant_sku: 'DEMO-SKU-1' },
    });
    expect(typeof main.product.id).toBe('string');

    // cheapest LIVE offer wins: 49900 beats 79900; the cheaper stale (100),
    // revoked (200) and paused-programme (300) offers are not live.
    expect(main.offer).toMatchObject({
      id: cheapLiveOffer,
      programme_id: progActive,
      merchant: { id: merchantA, name: 'Demo Merchant A' },
      price_minor: 49900,
      currency: 'INR',
      stock_status: 'in_stock',
    });
    expect(typeof main.offer.price_minor).toBe('number');
    expect(new Date(main.offer.fresh_until).toISOString()).toBe(main.offer.fresh_until);
    expect(new Date(main.offer.fresh_until).getTime()).toBeGreaterThan(Date.now());

    // the directly inserted links row appears with the exact composed URL
    expect(main.link).toEqual({ token: DEMO_TOKEN, url: `https://go.example.com/r/${DEMO_TOKEN}` });
  });

  it('stale-only variant → offer null and link null', async () => {
    const res = await getLook(lookPub, `?placement_id=${placementA}`);
    const stale = res.json().data.items[1];
    expect(stale.variant.id).toBe(variantStaleOnly);
    expect(stale.offer).toBeNull();
    expect(stale.link).toBeNull();
  });

  it('paused programme → offer null even though the offer row is active and fresh', async () => {
    const res = await getLook(lookPub, `?placement_id=${placementA}`);
    const paused = res.json().data.items[2];
    expect(paused.variant.id).toBe(variantPausedOnly);
    expect(paused.offer).toBeNull();
    expect(paused.link).toBeNull();
  });

  it('no placement_id → link null on every item and placement null', async () => {
    const res = await getLook(lookPub);
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.placement).toBeNull();
    expect(data.items).toHaveLength(3);
    for (const item of data.items) expect(item.link).toBeNull();
    expect(data.items[0].offer.id).toBe(cheapLiveOffer);
  });

  it('a paused links row is not returned (link null)', async () => {
    const res = await getLook(lookPub, `?placement_id=${placementA2}`);
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.placement.id).toBe(placementA2);
    expect(data.items[0].offer.id).toBe(cheapLiveOffer);
    expect(data.items[0].link).toBeNull();
  });

  it('placement from another org → 404 NOT_FOUND', async () => {
    const res = await getLook(lookPub, `?placement_id=${placementB}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('cross-tenant look → 404 NOT_FOUND (both directions)', async () => {
    const fromB = await getLook(lookPub, '', USERS.AD, ORG_B);
    expect(fromB.statusCode).toBe(404);
    expect(fromB.json().error.code).toBe('NOT_FOUND');
    const fromA = await getLook(lookB, '', USERS.AD, ORG_A);
    expect(fromA.statusCode).toBe(404);
  });

  it('draft look → 404 for publisher_owner / finance roles, 200 for editor and network_admin', async () => {
    const owner = await getLook(lookDraft, '', USERS.OW);
    expect(owner.statusCode).toBe(404);
    expect(owner.json().error.code).toBe('NOT_FOUND');
    const finance = await getLook(lookDraft, '', USERS.FO);
    expect(finance.statusCode).toBe(404);

    const editor = await getLook(lookDraft, '', USERS.ED);
    expect(editor.statusCode).toBe(200);
    expect(editor.json().data).toMatchObject({ id: lookDraft, status: 'draft', published_at: null, items: expect.any(Array) });
    expect(editor.json().data.items).toHaveLength(1);

    const admin = await getLook(lookDraft, '', USERS.AD);
    expect(admin.statusCode).toBe(200);
  });

  it('published look with no items → items [] and cover_url null when the asset has no public_url', async () => {
    const res = await getLook(lookPub2);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: lookPub2, items: [], cover_url: null, sponsored: false, source_page: null });
  });

  it('never leaks the raw merchant offer_url', async () => {
    const res = await getLook(lookPub, `?placement_id=${placementA}`);
    const body = JSON.stringify(res.json());
    expect(body).not.toContain('offer_url');
    expect(body).not.toContain(RAW_OFFER_HOST);
    // but the tracked link IS there
    expect(body).toContain(`https://go.example.com/r/${DEMO_TOKEN}`);
  });

  it('unknown / malformed ids and missing auth', async () => {
    const missing = await getLook(randomUUID());
    expect(missing.statusCode).toBe(404);
    const malformed = await getLook('not-a-uuid');
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe('VALIDATION_ERROR');
    const badPlacement = await getLook(lookPub, '?placement_id=nope');
    expect(badPlacement.statusCode).toBe(400);
    const anon = await app.inject({ method: 'GET', url: `/v1/looks/${lookPub}` });
    expect(anon.statusCode).toBe(401);
  });
});
