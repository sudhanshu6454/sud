// Amazon.in Associates: the setup CLI's core (account, programme, placements,
// tracking IDs), the offers CLI's core, link minting (owner-operated only, the
// programme's own campaign, accepted platforms only, canonical /dp/<ASIN>),
// the redirect (the tag, never a click id, previews / bots / prefetches,
// fail-open, blocked routes) and the route-cache invalidation when a mapping
// is added — against pg-mem.
// TEST data only (demo-21, demo-*-21, B0DEMO…, *.example.com).

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_amazon_links';
process.env.JWT_SECRET ??= 'amazon-links-test-secret';
process.env.API_PORT ??= '0';
process.env.REDIRECT_PORT ??= '0';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import type { Redis } from 'ioredis';
import { createTestDb } from './pgmem.js';
import { AMZ, declarations, seedOwnNetwork, type OwnNetwork, type PoolLike } from './amazon-fixtures.js';
import { __setRedis } from '../src/redis.js';
import { buildRedirectApp } from '../../redirect/src/index.js';
import type * as SetupModule from '../src/amazon/setup.js';
import type * as OffersModule from '../src/amazon/offers.js';

let pool: PoolLike;
let app: FastifyInstance;
let redirectApp: FastifyInstance;
let setup: typeof SetupModule;
let offersMod: typeof OffersModule;
let net: OwnNetwork;
let summary: SetupModule.AmazonSetupSummary;
let offerId: string;

const ORG = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ADMIN = { id: '00000000-0000-0000-0000-00000000a001', role: 'network_admin' };
const OWNER = { id: '00000000-0000-0000-0000-00000000a002', role: 'publisher_owner' };

function bearer(user: { id: string; role: string }, orgId = ORG) {
  return { authorization: `Bearer ${jwt.sign({ sub: user.id, org_id: orgId, role: user.role }, process.env.JWT_SECRET as string)}` };
}

function placementOf(platform: string): SetupModule.SetupPlacement {
  const p = summary.placements.find((x) => x.platform === platform);
  if (!p) throw new Error(`no ${platform} placement`);
  return p;
}

async function mint(placement: SetupModule.SetupPlacement, offer = offerId, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/links',
    headers: bearer(OWNER),
    payload: {
      property_id: placement.property_id,
      programme_id: summary.programme_id,
      offer_id: offer,
      placement_id: placement.placement_id,
      ...extra,
    },
  });
}

async function clicksFor(token: string): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as n from clicks c join links l on l.id = c.link_id where l.token = $1`,
    [token],
  );
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  const tdb = createTestDb({ rollback: true });
  pool = new tdb.Pool();
  const dbMod = await import('../src/db.js');
  dbMod.__setPool(pool as unknown as Parameters<typeof dbMod.__setPool>[0]);
  const { buildApp } = await import('../src/index.js');
  app = await buildApp();
  await app.ready();
  redirectApp = await buildRedirectApp({ pool: pool as unknown as Parameters<typeof buildRedirectApp>[0]['pool'], ipHashKey: null });
  await redirectApp.ready();
  setup = await import('../src/amazon/setup.js');
  offersMod = await import('../src/amazon/offers.js');

  net = await seedOwnNetwork(pool, ORG, 'amzlinks', ADMIN.id);
  summary = await setup.setupAmazonAssociates({
    orgSlug: net.slug,
    storeId: AMZ.STORE,
    declarations: declarations(net),
    publisherShareBps: 7000,
    shopHost: `amzlinks.${AMZ.SHOP_HOST}`,
  });
  const added = await offersMod.addAmazonOffers({
    orgSlug: net.slug,
    offers: [
      { row: 1, asin: AMZ.ASIN, brand: 'Demo Brand', model: 'Demo Kettle', category: 'Home', size: null, colour: null },
    ],
  });
  offerId = added.offers[0]!.offer_id;
}, 30000);

afterEach(() => __setRedis(undefined));

describe('amazon setup (src/amazon/setup.ts)', () => {
  it('creates the merchant, programme, account, one placement per declared property and the mappings', async () => {
    expect(summary.store_id).toBe(AMZ.STORE);
    expect(summary.account_ref).toBe('amazon-associates:demo-21');
    expect(summary.marketplace_host).toBe('www.amazon.in');
    expect(summary.programme_status).toBe('active');
    expect(summary.placements).toHaveLength(3);
    expect(placementOf('instagram').tag).toBe(AMZ.IG_TAG);
    expect(placementOf('facebook').tag).toBe(AMZ.FB_TAG);
    expect(placementOf('web')).toMatchObject({ tracking_id: null, tag: AMZ.STORE });
    expect(summary.web_placement_id).toBe(placementOf('web').placement_id);
    expect(summary.tracking_ids_added).toBe(2);
    const caps = await pool.query(
      `select allowed_domains, price_max_age_hours, subpublisher_allowed from programme_capabilities where programme_id = $1`,
      [summary.programme_id],
    );
    expect(caps.rows[0]).toMatchObject({ allowed_domains: ['www.amazon.in'], price_max_age_hours: 1, subpublisher_allowed: false });
    const contract = await pool.query(
      `select publisher_share_bps, status from contracts where org_id = $1 and programme_id = $2`,
      [ORG, summary.programme_id],
    );
    expect(contract.rows).toEqual([{ publisher_share_bps: 7000, status: 'approved' }]);
    const acct = await pool.query(`select disclosure_text, api_paused_until from amazon_associates_accounts where id = $1`, [
      summary.account_id,
    ]);
    expect(acct.rows[0]).toEqual({
      disclosure_text: 'As an Amazon Associate I earn from qualifying purchases.',
      api_paused_until: null,
    });
    // No sub-tag and no third-party setting exists at all.
    const cols = (await pool.query(`select * from amazon_associates_accounts where id = $1`, [summary.account_id])).rows[0]!;
    expect(Object.keys(cols).filter((k) => /subtag|third_party/.test(k))).toEqual([]);
  });

  it('is idempotent: a second run writes nothing new and reports the same ids', async () => {
    const counts = async () =>
      (
        await pool.query(
          `select (select count(*) from programmes where org_id = $1)::int as p,
                  (select count(*) from placements where org_id = $1)::int as pl,
                  (select count(*) from amazon_tracking_ids where org_id = $1)::int as t,
                  (select count(*) from contracts where org_id = $1)::int as c,
                  (select count(*) from merchants where org_id = $1)::int as m`,
          [ORG],
        )
      ).rows[0];
    const before = await counts();
    const again = await setup.setupAmazonAssociates({
      orgSlug: net.slug,
      storeId: AMZ.STORE,
      declarations: declarations(net),
      shopHost: `amzlinks.${AMZ.SHOP_HOST}`,
    });
    expect(await counts()).toEqual(before);
    expect(again.tracking_ids_added).toBe(0);
    expect(again.programme_id).toBe(summary.programme_id);
    expect(again.placements.map((p) => p.placement_id).sort()).toEqual(summary.placements.map((p) => p.placement_id).sort());
  });

  it('refuses, writing nothing: a remap, a second tag for a placement, the store ID as a mapping, a new store ID', async () => {
    const base = { orgSlug: net.slug, storeId: AMZ.STORE };
    const refuse = (decls: ReturnType<typeof declarations>, extra: Record<string, unknown> = {}) =>
      setup.setupAmazonAssociates({ ...base, declarations: decls, ...extra });
    const d = declarations(net);
    // demo-ig-21 moved to the facebook page
    await expect(
      refuse([{ ...d[1]!, trackingId: AMZ.IG_TAG }]),
    ).rejects.toThrow(/already mapped to another property|already has tracking ID/);
    // a second tag for instagram
    await expect(refuse([{ ...d[0]!, trackingId: 'demo-ig2-21' }])).rejects.toThrow(/already has tracking ID demo-ig-21/);
    await expect(refuse([{ ...d[2]!, trackingId: AMZ.STORE }])).rejects.toThrow(/store ID demo-21 cannot be mapped/);
    await expect(setup.setupAmazonAssociates({ ...base, storeId: 'demo2-21', declarations: d })).rejects.toThrow(
      /has store ID demo-21; it cannot become demo2-21/,
    );
    const t = await pool.query(`select count(*)::int as n from amazon_tracking_ids where org_id = $1`, [ORG]);
    expect(t.rows[0]!.n).toBe(2);
  });

  it('refuses a property without an owner_operated verification, a proprietary term, and TEST values in production', async () => {
    await expect(
      setup.setupAmazonAssociates({
        orgSlug: net.slug,
        storeId: AMZ.STORE,
        declarations: [{ row: 1, platform: 'facebook', account: 'demo.unverified.amzlinks', trackingId: null }],
      }),
    ).rejects.toThrow(/no live owner_operated verification/);
    expect(setup.checkSetupOptions({ orgSlug: 'x', storeId: 'myamazonstore-21', declarations: [] }).join(' ')).toMatch(
      /proprietary terms/,
    );
    expect(setup.checkSetupOptions({ orgSlug: 'x', storeId: 'demo-21', declarations: [{ row: 1, platform: 'instagram', account: 'a', trackingId: 'alexa-picks-21' }] }).join(' ')).toMatch(
      /contains 'alexa'.*non-exhaustive/,
    );
    expect(
      setup.checkSetupOptions({ orgSlug: 'x', storeId: 'demo-21', declarations: [{ row: 1, platform: 'web', account: 'a.example.com', trackingId: null }] }, { NODE_ENV: 'production' }).join(' '),
    ).toMatch(/REFUSING under NODE_ENV=production/);
    expect(setup.checkSetupOptions({ orgSlug: 'x', storeId: 'demo-21', declarations: [], marketplaceHost: 'www.amazon.com' }).join(' ')).toMatch(
      /not supported/,
    );
  });

  it('parses the properties file (platform,account,tracking_id) and refuses bad rows', () => {
    const ok = setup.parsePropertiesFile('﻿platform,account,tracking_id\ninstagram,@Demo.IG,Demo-IG-21\nweb,Shop.Example.com,\n');
    expect(ok.problems).toEqual([]);
    expect(ok.declarations).toEqual([
      { row: 1, platform: 'instagram', account: 'demo.ig', trackingId: 'demo-ig-21' },
      { row: 2, platform: 'web', account: 'shop.example.com', trackingId: null },
    ]);
    const bad = setup.parsePropertiesFile('platform,account,tracking_id,extra\ntiktok,x,demo-21\n');
    expect(bad.problems.join(' ')).toMatch(/unknown column 'extra'/);
    const bad2 = setup.parsePropertiesFile('platform,account,tracking_id\ntiktok,x,\ninstagram,y,notatag\n');
    expect(bad2.problems.join(' ')).toMatch(/row 1: platform 'tiktok'/);
    expect(bad2.problems.join(' ')).toMatch(/row 2: 'notatag' is not an amazon\.in tracking ID/);
  });

  it('refuses platforms Amazon links may not go on: Snapchat, Telegram (and YouTube until the owner lists a channel)', async () => {
    const parsed = setup.parsePropertiesFile(
      'platform,account,tracking_id\nsnapchat,demo.snap,demo-snap-21\ntelegram,demo.tg,demo-tg-21\nyoutube,demo.yt,demo-yt-21\n',
    );
    expect(parsed.declarations).toEqual([]);
    expect(parsed.problems).toHaveLength(3);
    expect(parsed.problems[0]).toMatch(/row 1: platform 'snapchat' cannot carry Amazon links/);
    expect(parsed.problems[1]).toMatch(/row 2: platform 'telegram' cannot carry Amazon links/);
    expect(parsed.problems[2]).toMatch(/row 3: platform 'youtube' cannot carry Amazon links/);
    // The core refuses them too (owner-operated properties of the network), writing nothing.
    const before = (await pool.query(`select count(*)::int as n from placements where org_id = $1`, [ORG])).rows[0]!.n;
    await expect(
      setup.setupAmazonAssociates({
        orgSlug: net.slug,
        storeId: AMZ.STORE,
        declarations: [
          { row: 1, platform: 'snapchat', account: 'demo.snap.amzlinks', trackingId: 'demo-snap-21' },
          { row: 2, platform: 'telegram', account: 'demo_tg_amzlinks', trackingId: 'demo-tg-21' },
        ],
      }),
    ).rejects.toThrow(/platform 'snapchat' cannot carry Amazon links[\s\S]*platform 'telegram' cannot carry Amazon links/);
    expect((await pool.query(`select count(*)::int as n from placements where org_id = $1`, [ORG])).rows[0]!.n).toBe(before);
  });

  it('a disclosure must contain OA §10\'s statement word for word', () => {
    const base = { orgSlug: 'x', storeId: 'demo-21', declarations: [{ row: 1, platform: 'web', account: 'a.example.com', trackingId: null }] };
    expect(setup.checkSetupOptions({ ...base, disclosureText: 'We earn from Amazon purchases.' }).join(' ')).toMatch(/word for word/);
    expect(setup.checkSetupOptions({ ...base, disclosureText: 'As an Amazon Associate I earn from qualifying purchases. #ad' })).toEqual([]);
  });
});

describe('amazon offers (src/amazon/offers.ts)', () => {
  it('stores the canonical /dp/<ASIN> URL, no tag, no price; accepts an amazon.in URL; refuses short links', async () => {
    const parsed = offersMod.parseOffersFile(
      'asin_or_url,brand,model,category\n' +
        `https://www.amazon.in/Demo-Kettle/dp/${AMZ.ASIN2}/ref=sr_1?tag=someone-21&ascsubtag=x,Demo Brand,Demo Mug,Home\n` +
        'https://amzn.to/abc123,Demo Brand,Demo Cup,Home\n',
    );
    expect(parsed.offers.map((o) => o.asin)).toEqual([AMZ.ASIN2]);
    expect(parsed.problems.join(' ')).toMatch(/row 2: .*short links are not resolved/);
    const res = await offersMod.addAmazonOffers({ orgSlug: net.slug, offers: parsed.offers });
    const { rows } = await pool.query(
      `select offer_url, price_minor, price_as_of, merchant_item_ref, status, stock_status from offers where id = $1`,
      [res.offers[0]!.offer_id],
    );
    expect(rows[0]).toEqual({
      offer_url: `https://www.amazon.in/dp/${AMZ.ASIN2}`,
      price_minor: null,
      price_as_of: null,
      merchant_item_ref: AMZ.ASIN2,
      status: 'active',
      stock_status: 'unknown',
    });
    // idempotent: same offer, product and variant on a re-run
    const again = await offersMod.addAmazonOffers({ orgSlug: net.slug, offers: parsed.offers });
    expect(again.offers[0]).toMatchObject({ offer_id: res.offers[0]!.offer_id, created: false });
    await expect(
      offersMod.addAmazonOffers({ orgSlug: net.slug, offers: parsed.offers }, { NODE_ENV: 'production' }),
    ).rejects.toThrow(/TEST ASINs/);
  });
});

describe('POST /v1/links for an Amazon programme', () => {
  it('mints for an owner-operated placement and warms the route with its tag and no click-id param', async () => {
    const sets: Array<{ key: string; value: string }> = [];
    __setRedis({
      set: async (key: string, value: string) => void sets.push({ key, value }),
      get: async () => null,
      del: async () => 0,
    } as unknown as Redis);
    const res = await mint(placementOf('instagram'));
    expect(res.statusCode).toBe(201);
    expect(res.headers['set-cookie']).toBeUndefined();
    const route = JSON.parse(sets[0]!.value);
    expect(route).toMatchObject({
      destination_url: `https://www.amazon.in/dp/${AMZ.ASIN}`,
      allowed_hosts: ['www.amazon.in'],
      subid_field: null,
      set_params: { tag: AMZ.IG_TAG },
      strip_params: ['tag', 'ascsubtag', 'subid'],
      crawler_guard: true,
      route_block: null,
    });
  });

  it('403 PROPERTY_NOT_OWNER_OPERATED for a property without an owner_operated verification', async () => {
    // A placement in the Amazon campaign for the unverified property, made by hand
    // (the setup would have refused to declare it).
    const campaign = summary.campaigns[0]!.campaign_id;
    const { rows } = await pool.query(
      `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
       values ($1, $2, $3, 'facebook_post', 'amazon-test-unverified') returning id`,
      [ORG, campaign, net.props.fbUnverified],
    );
    const res = await mint({ platform: 'facebook', account: 'x', property_id: net.props.fbUnverified, placement_id: String(rows[0]!.id), tracking_id: null, tag: AMZ.STORE });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PROPERTY_NOT_OWNER_OPERATED');
  });

  it('403 PROPERTY_FORBIDDEN for an owner-operated Snapchat or Telegram property (placements made by hand)', async () => {
    const campaign = summary.campaigns[0]!.campaign_id;
    for (const [platform, prop, channel] of [
      ['snapchat', net.props.snap, 'snapchat_profile'],
      ['telegram', net.props.tg, 'telegram_post'],
    ] as const) {
      const { rows } = await pool.query(
        `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
         values ($1, $2, $3, $4, $5) returning id`,
        [ORG, campaign, prop, channel, `amazon-test-${platform}`],
      );
      const res = await mint({ platform, account: 'x', property_id: prop, placement_id: String(rows[0]!.id), tracking_id: null, tag: AMZ.STORE });
      expect(res.statusCode, platform).toBe(403);
      expect(res.json().error.code, platform).toBe('PROPERTY_FORBIDDEN');
      expect(res.json().error.message).toMatch(/Facebook, Instagram and the operator's own website only/);
    }
  });

  it("403 PROPERTY_FORBIDDEN for a placement outside the programme's campaign, or of another property", async () => {
    // same property, but a campaign of another programme
    const { rows: m } = await pool.query(`insert into merchants (org_id, name) values ($1, 'Demo Other') returning id`, [ORG]);
    const { rows: p } = await pool.query(
      `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis)
       values ($1, $2, 'stub-network', 'Demo Other Programme', 'active', 'sale') returning id`,
      [ORG, m[0]!.id],
    );
    const { rows: c } = await pool.query(
      `insert into campaigns (org_id, publisher_id, programme_id, name) values ($1, $2, $3, 'Demo other') returning id`,
      [ORG, net.publisherId, p[0]!.id],
    );
    const { rows: pl } = await pool.query(
      `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
       values ($1, $2, $3, 'instagram_bio', 'other-ig') returning id`,
      [ORG, c[0]!.id, net.props.ig],
    );
    const outside = await mint({ ...placementOf('instagram'), placement_id: String(pl[0]!.id) });
    expect(outside.statusCode).toBe(403);
    expect(outside.json().error.code).toBe('PROPERTY_FORBIDDEN');

    const otherProperty = await mint({ ...placementOf('instagram'), property_id: net.props.fb });
    expect(otherProperty.statusCode).toBe(403);
    expect(otherProperty.json().error.code).toBe('PROPERTY_FORBIDDEN');
  });

  it('403 PROGRAMME_NOT_APPROVED for a tagged / non-canonical offer URL, a mismatched programme, a disabled account', async () => {
    const { rows } = await pool.query(
      `insert into offers (org_id, variant_id, programme_id, merchant_id, price_minor, offer_url, fresh_until, status, merchant_item_ref)
       select org_id, variant_id, programme_id, merchant_id, null, $2, fresh_until, 'active', 'B0DEMO0009' from offers where id = $1
       returning id`,
      [offerId, `https://www.amazon.in/dp/B0DEMO0009?tag=someone-21`],
    );
    const tagged = await mint(placementOf('instagram'), String(rows[0]!.id));
    expect(tagged.statusCode).toBe(403);
    expect(tagged.json().error.code).toBe('PROGRAMME_NOT_APPROVED');

    const wrongProgramme = await mint(placementOf('instagram'), offerId, { programme_id: '11111111-1111-1111-1111-111111111111' });
    expect(wrongProgramme.statusCode).toBe(403);
    expect(wrongProgramme.json().error.code).toBe('PROGRAMME_NOT_APPROVED');

    await pool.query(`update amazon_associates_accounts set status = 'disabled' where id = $1`, [summary.account_id]);
    try {
      const disabled = await mint(placementOf('instagram'));
      expect(disabled.statusCode).toBe(403);
      expect(disabled.json().error.message).toMatch(/disabled/);
    } finally {
      await pool.query(`update amazon_associates_accounts set status = 'active' where id = $1`, [summary.account_id]);
    }
  });
});

describe('GET /r/{token} for an Amazon link', () => {
  it('302 to https://www.amazon.in/dp/<ASIN>?tag=<placement tracking ID>: no subid, no cookie, one click', async () => {
    const token = (await mint(placementOf('instagram'))).json().data.token as string;
    const res = await redirectApp.inject({ method: 'GET', url: `/r/${token}`, headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14)' } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`https://www.amazon.in/dp/${AMZ.ASIN}?tag=${AMZ.IG_TAG}`);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(await clicksFor(token)).toBe(1);
  });

  it('a placement without its own tracking ID carries the store ID', async () => {
    const token = (await mint(placementOf('web'))).json().data.token as string;
    const res = await redirectApp.inject({ method: 'GET', url: `/r/${token}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`https://www.amazon.in/dp/${AMZ.ASIN}?tag=${AMZ.STORE}`);
  });

  it('link-preview crawlers, other software, prefetches and HEAD get the preview page: no click, no tagged URL', async () => {
    const token = (await mint(placementOf('facebook'))).json().data.token as string;
    for (const ua of [
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0 A',
      'Twitterbot/1.0',
      'curl/8.0',
      'python-requests/2.31',
      'Go-http-client/1.1',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
    ]) {
      const res = await redirectApp.inject({ method: 'GET', url: `/r/${token}`, headers: { 'user-agent': ua } });
      expect(res.statusCode, ua).toBe(200);
      expect(res.headers.location).toBeUndefined();
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.body).not.toContain('amazon.in/dp');
      expect(res.body).not.toContain(AMZ.FB_TAG);
      expect(res.body).toContain('A link to a product on Amazon.in');
    }
    for (const headers of [{ 'sec-purpose': 'prefetch;prerender' }, { purpose: 'prefetch' }, { 'x-purpose': 'preview' }]) {
      const res = await redirectApp.inject({ method: 'GET', url: `/r/${token}`, headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14)', ...headers } });
      expect(res.statusCode, JSON.stringify(headers)).toBe(200);
      expect(res.headers.location).toBeUndefined();
    }
    const head = await redirectApp.inject({ method: 'HEAD', url: `/r/${token}` });
    expect(head.statusCode).toBe(200);
    expect(await clicksFor(token)).toBe(0);
    // An in-app browser is a person: redirected.
    const inApp = await redirectApp.inject({ method: 'GET', url: `/r/${token}`, headers: { 'user-agent': 'Mozilla/5.0 Instagram 300.0 Android' } });
    expect(inApp.statusCode).toBe(302);
    expect(inApp.headers.location).toBe(`https://www.amazon.in/dp/${AMZ.ASIN}?tag=${AMZ.FB_TAG}`);
  });

  it('never a click id on the Amazon URL: no subid, no ascsubtag, on the cache path and on the DB fallback', async () => {
    const sets: Array<{ key: string; value: string }> = [];
    __setRedis({
      set: async (key: string, value: string) => void sets.push({ key, value }),
      get: async () => null,
      del: async () => 0,
    } as unknown as Redis);
    const token = (await mint(placementOf('instagram'))).json().data.token as string;
    __setRedis(undefined);
    expect(JSON.parse(sets[0]!.value).subid_field).toBeNull();
    // The redirect has no Redis here: the DB fallback builds the route.
    const res = await redirectApp.inject({ method: 'GET', url: `/r/${token}`, headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14)' } });
    expect(res.statusCode).toBe(302);
    const loc = new URL(String(res.headers.location));
    expect([...loc.searchParams.keys()]).toEqual(['tag']);
    expect(loc.searchParams.get('tag')).toBe(AMZ.IG_TAG);
    expect(await clicksFor(token)).toBe(1);
  });

  it('fail-open keeps the tag (click insert failing → 302 with tag, no ascsubtag)', async () => {
    const token = (await mint(placementOf('instagram'))).json().data.token as string;
    const failing = {
      query: (text: string, params?: unknown[]) =>
        /insert into clicks/.test(text) ? Promise.reject(new Error('db down')) : pool.query(text, params),
    };
    const app2 = await buildRedirectApp({ pool: failing as unknown as Parameters<typeof buildRedirectApp>[0]['pool'], ipHashKey: null });
    const res = await app2.inject({ method: 'GET', url: `/r/${token}` });
    await app2.close();
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`https://www.amazon.in/dp/${AMZ.ASIN}?tag=${AMZ.IG_TAG}`);
  });

  it('a property that lost its owner_operated verification, or a disabled account, serves the paused page', async () => {
    const token = (await mint(placementOf('facebook'))).json().data.token as string;
    await pool.query(`update verifications set expires_at = now() - interval '1 day' where property_id = $1`, [net.props.fb]);
    try {
      const res = await redirectApp.inject({ method: 'GET', url: `/r/${token}` });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('This link is paused');
    } finally {
      await pool.query(`update verifications set expires_at = null where property_id = $1`, [net.props.fb]);
    }
    await pool.query(`update amazon_associates_accounts set status = 'disabled' where id = $1`, [summary.account_id]);
    try {
      const res = await redirectApp.inject({ method: 'GET', url: `/r/${token}` });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('This link is paused');
    } finally {
      await pool.query(`update amazon_associates_accounts set status = 'active' where id = $1`, [summary.account_id]);
    }
  });
});

describe('route cache invalidation when a mapping is added', () => {
  it('setup deletes the cached routes of links on a placement that just got its tracking ID', async () => {
    // A new owner-operated Facebook page, declared on the store ID first.
    const { rows } = await pool.query(
      `insert into properties (org_id, publisher_id, platform, external_account_id, status)
       values ($1, $2, 'facebook', 'demo.second.amzlinks', 'approved') returning id`,
      [ORG, net.publisherId],
    );
    const fb2 = String(rows[0]!.id);
    await pool.query(
      `insert into verifications (org_id, property_id, method, verified_at) values ($1, $2, 'owner_operated', now())`,
      [ORG, fb2],
    );
    const first = await setup.setupAmazonAssociates({
      orgSlug: net.slug,
      storeId: AMZ.STORE,
      declarations: [{ row: 1, platform: 'facebook', account: 'demo.second.amzlinks', trackingId: null }],
    });
    const tgPlacement = first.placements.find((p) => p.property_id === fb2)!;
    const token = (await mint(tgPlacement)).json().data.token as string;
    const before = await redirectApp.inject({ method: 'GET', url: `/r/${token}` });
    expect(new URL(String(before.headers.location)).searchParams.get('tag')).toBe(AMZ.STORE);

    const deleted: string[][] = [];
    const second = await setup.setupAmazonAssociates(
      {
        orgSlug: net.slug,
        storeId: AMZ.STORE,
        declarations: [{ row: 1, platform: 'facebook', account: 'demo.second.amzlinks', trackingId: 'demo-fb2-21' }],
      },
      {
        invalidate: async (tokens) => {
          deleted.push(tokens);
          return { deleted: tokens.length, redisAvailable: true };
        },
      },
    );
    expect(second.tracking_ids_added).toBe(1);
    expect(second.route_cache).toBe('invalidated');
    expect(deleted.flat()).toContain(token);
    const after = await redirectApp.inject({ method: 'GET', url: `/r/${token}` });
    expect(new URL(String(after.headers.location)).searchParams.get('tag')).toBe('demo-fb2-21');
  });
});
