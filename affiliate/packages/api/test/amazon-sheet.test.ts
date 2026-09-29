// Amazon.in Associates: the operator's link sheet (src/amazon/links.ts, the CLI's
// `template`, `links` and `status`) and the offers file's shop looks
// (src/amazon/offers.ts) — against pg-mem, links minted through POST /v1/links
// itself (app.inject). TEST data only (demo-21, demo-*-21, B0DEMO…, *.example.com).

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_amazon_sheet';
process.env.JWT_SECRET ??= 'amazon-sheet-test-secret';
process.env.API_PORT ??= '0';
process.env.REDIRECT_BASE_URL ??= 'https://go.example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { createTestDb } from './pgmem.js';
import { AMZ, seedOwnNetwork, type OwnNetwork, type PoolLike } from './amazon-fixtures.js';
import type * as SetupModule from '../src/amazon/setup.js';
import type * as OffersModule from '../src/amazon/offers.js';
import type * as LinksModule from '../src/amazon/links.js';

let pool: PoolLike;
let app: FastifyInstance;
let setup: typeof SetupModule;
let offersMod: typeof OffersModule;
let sheet: typeof LinksModule;
let net: OwnNetwork;
let summary: SetupModule.AmazonSetupSummary;
let redirectUrl: (token: string) => string;

const ORG = 'abababab-abab-abab-abab-abababababab';
const ADMIN = { id: '00000000-0000-0000-0000-00000000b101', role: 'network_admin' };
const ANALYST = { id: '00000000-0000-0000-0000-00000000b102', role: 'publisher_analyst' };
const bearer = (u: { id: string; role: string }) => `Bearer ${jwt.sign({ sub: u.id, org_id: ORG, role: u.role }, process.env.JWT_SECRET as string)}`;

/** POST /v1/links through the API, as the CLI does it. */
const post: LinksModule.PostLink = async (body, key) => {
  const r = await app.inject({
    method: 'POST',
    url: '/v1/links',
    headers: { authorization: bearer(ADMIN), 'idempotency-key': key, 'content-type': 'application/json' },
    payload: body,
  });
  return { statusCode: r.statusCode, headers: r.headers as Record<string, unknown>, body: r.body };
};

const OFFERS_CSV = [
  'asin_or_url,brand,model,category,look',
  'B0DEMO0001,Demo Brand,Demo Kettle,Home,Demo Kitchen picks',
  'https://www.amazon.in/Demo-Mug/dp/B0DEMO0002/ref=sr_1_1?tag=someone-21,Demo Brand,Demo Mug,Home,Demo Kitchen picks',
  'B0DEMO0003,Demo Brand,Demo Lamp,Home,',
].join('\n');

beforeAll(async () => {
  const tdb = createTestDb({ rollback: true });
  pool = new tdb.Pool();
  const dbMod = await import('../src/db.js');
  dbMod.__setPool(pool as unknown as Parameters<typeof dbMod.__setPool>[0]);
  const { buildApp } = await import('../src/index.js');
  app = await buildApp({ logStream: { write: () => undefined } });
  await app.ready();
  setup = await import('../src/amazon/setup.js');
  offersMod = await import('../src/amazon/offers.js');
  sheet = await import('../src/amazon/links.js');
  redirectUrl = (await import('../src/redirect-url.js')).redirectLinkUrl;
  net = await seedOwnNetwork(pool, ORG, 'amzsheet', ADMIN.id);
}, 30000);

describe('template (a starting properties file)', () => {
  it('lists every approved owner-operated Facebook / Instagram / web property with its url, web first; never an unverified, third-party, Snapchat or Telegram one', async () => {
    const t = await sheet.propertiesTemplate({ orgSlug: net.slug });
    const lines = t.csv.trim().split('\n');
    expect(lines[0]).toBe('platform,account,tracking_id,url');
    expect(lines.slice(1)).toEqual([
      `web,amzsheet.${AMZ.SHOP_HOST},,https://web.example.com/amzsheet.${AMZ.SHOP_HOST}`,
      'instagram,demo.amzsheet,,https://instagram.example.com/demo.amzsheet',
      'facebook,demo.amzsheet,,https://facebook.example.com/demo.amzsheet',
    ]);
    expect(t).toMatchObject({ rows: 3, mapped: 0, left_out_platforms: { snapchat: 1, telegram: 1 } });
    expect(t.csv).not.toContain('snapchat');
    expect(t.csv).not.toContain('telegram');
    expect(t.csv).not.toContain('demo.unverified');
    expect(t.csv).not.toContain('demo.creator');
  });

  it('the filled-in template loads as the properties file (its url column is ignored)', async () => {
    const t = await sheet.propertiesTemplate({ orgSlug: net.slug });
    const filled = t.csv
      .replace(`web,amzsheet.${AMZ.SHOP_HOST},,`, `web,amzsheet.${AMZ.SHOP_HOST},demo-shop-21,`)
      .replace('instagram,demo.amzsheet,,', `instagram,demo.amzsheet,${AMZ.IG_TAG},`);
    const parsed = setup.parsePropertiesFile(filled);
    expect(parsed.problems).toEqual([]);
    expect(parsed.declarations.map((d) => [d.platform, d.trackingId])).toEqual([
      ['web', 'demo-shop-21'],
      ['instagram', AMZ.IG_TAG],
      ['facebook', null],
    ]);
    summary = await setup.setupAmazonAssociates({
      orgSlug: net.slug,
      storeId: AMZ.STORE,
      declarations: parsed.declarations,
      publisherShareBps: 7000,
      shopHost: `amzsheet.${AMZ.SHOP_HOST}`,
    });
    expect(summary.tracking_ids_added).toBe(2);
    const again = await sheet.propertiesTemplate({ orgSlug: net.slug });
    expect(again.mapped).toBe(2);
    expect(again.csv).toContain(`instagram,demo.amzsheet,${AMZ.IG_TAG},`);
    expect(setup.parsePropertiesFile('platform,account,tracking_id,notes\nweb,a.example.com,\n').problems).toEqual([
      "properties file: unknown column 'notes'",
    ]);
  });
});

describe('offers file: the shop looks', () => {
  it('groups rows naming a look into one published look with a placeholder cover; rows without one are offers only', async () => {
    const parsed = offersMod.parseOffersFile(OFFERS_CSV);
    expect(parsed.problems).toEqual([]);
    expect(parsed.offers.map((o) => o.look)).toEqual(['Demo Kitchen picks', 'Demo Kitchen picks', null]);
    const res = await offersMod.addAmazonOffers({ orgSlug: net.slug, offers: parsed.offers });
    expect(res.looks).toHaveLength(1);
    expect(res.looks[0]).toMatchObject({ title: 'Demo Kitchen picks', status: 'published', created: true, items_added: 2 });
    expect(res.offers.map((o) => o.look_id)).toEqual([res.looks[0]!.look_id, res.looks[0]!.look_id, null]);
    const look = await pool.query(
      `select l.status, l.sponsored, l.source_page, l.category, a.license, a.public_url, a.storage_key
         from looks l join assets a on a.id = l.cover_asset_id where l.id = $1`,
      [res.looks[0]!.look_id],
    );
    expect(look.rows[0]).toMatchObject({
      status: 'published',
      sponsored: false,
      source_page: null,
      category: null,
      license: 'owned',
      public_url: null,
      storage_key: 'amazon-looks/demo-kitchen-picks',
    });
  });

  it('a re-run adds nothing, and a look paused since stays paused', async () => {
    const parsed = offersMod.parseOffersFile(OFFERS_CSV);
    const first = await pool.query(`select id from looks where org_id = $1 and title = 'Demo Kitchen picks'`, [ORG]);
    await pool.query(`update looks set status = 'paused' where id = $1`, [first.rows[0]!.id]);
    const res = await offersMod.addAmazonOffers({ orgSlug: net.slug, offers: parsed.offers });
    expect(res.looks[0]).toMatchObject({ status: 'paused', created: false, items_added: 0 });
    const n = async (table: string) => Number((await pool.query(`select count(*) as n from ${table} where org_id = $1`, [ORG])).rows[0]!.n);
    expect({ looks: await n('looks'), items: await n('look_items'), assets: await n('assets') }).toEqual({ looks: 1, items: 2, assets: 1 });
    await pool.query(`update looks set status = 'published' where id = $1`, [first.rows[0]!.id]);
    expect(offersMod.parseOffersFile(`asin,brand,model,category,look\nB0DEMO0009,Demo,Demo,Home,${'x'.repeat(121)}\n`).problems).toEqual([
      'offers file row 1: look is longer than 120 characters',
    ]);
  });
});

describe('links (the link sheet)', () => {
  it('mints one link per placement with its own tracking ID × live offer, through POST /v1/links; the store-ID placement is skipped', async () => {
    const res = await sheet.mintAmazonLinks({ orgSlug: net.slug, post, redirectUrl });
    expect(res).toMatchObject({ placements: 2, offers: 3, minted: 6, existing: 0, failed: [] });
    expect(res.placements_skipped_store_default).toEqual([{ platform: 'facebook', account: 'demo.amzsheet' }]);
    expect(res.links.map((l) => [l.platform, l.tracking_id, l.asin, l.look])).toEqual([
      ['web', 'demo-shop-21', 'B0DEMO0001', 'Demo Kitchen picks'],
      ['web', 'demo-shop-21', 'B0DEMO0002', 'Demo Kitchen picks'],
      ['web', 'demo-shop-21', 'B0DEMO0003', null],
      ['instagram', AMZ.IG_TAG, 'B0DEMO0001', 'Demo Kitchen picks'],
      ['instagram', AMZ.IG_TAG, 'B0DEMO0002', 'Demo Kitchen picks'],
      ['instagram', AMZ.IG_TAG, 'B0DEMO0003', null],
    ]);
    for (const l of res.links) expect(l.link_url).toBe(`https://go.example.com/r/${l.token}`);
    const csv = sheet.linkSheetCsv(res.links);
    expect(csv.split('\n')[0]).toBe('platform,account,tracking_id,asin,brand,model,look,post_label,link_url');
    // Every post starts from the link-level disclosure (a draft pending counsel); no Amazon URL anywhere.
    for (const line of csv.trim().split('\n').slice(1)) expect(line).toMatch(/,#ad · Buy on Amazon\.in,https:\/\/go\.example\.com\/r\//);
    expect(csv).not.toMatch(/amazon\.in\//i);
    const n = await pool.query(`select count(*) as n from links where org_id = $1`, [ORG]);
    expect(Number(n.rows[0]!.n)).toBe(6);
  });

  it('a re-run mints nothing: every link is reused', async () => {
    const res = await sheet.mintAmazonLinks({ orgSlug: net.slug, post, redirectUrl });
    expect(res).toMatchObject({ minted: 0, existing: 6, failed: [] });
    const n = await pool.query(`select count(*) as n from links where org_id = $1`, [ORG]);
    expect(Number(n.rows[0]!.n)).toBe(6);
  });

  it('a link paused since is replaced (its stale idempotency replay is not trusted)', async () => {
    const one = await pool.query(
      `select l.id, l.token from links l join placements pl on pl.id = l.placement_id join properties p on p.id = pl.property_id
        where l.org_id = $1 and p.platform = 'instagram' order by l.created_at, l.id limit 1`,
      [ORG],
    );
    await pool.query(`update links set status = 'paused' where id = $1`, [one.rows[0]!.id]);
    const res = await sheet.mintAmazonLinks({ orgSlug: net.slug, post, redirectUrl, now: () => 1_790_000_000_000 });
    expect(res).toMatchObject({ minted: 1, existing: 5, failed: [] });
    expect(res.links.find((l) => l.minted)!.token).not.toBe(one.rows[0]!.token);
  });

  it('the shop placement’s link reaches the look page, with the connector and no merchant URL', async () => {
    const look = await pool.query(`select id from looks where org_id = $1 and title = 'Demo Kitchen picks'`, [ORG]);
    const r = await app.inject({
      method: 'GET',
      url: `/v1/looks/${look.rows[0]!.id}?placement_id=${summary.web_placement_id}`,
      headers: { authorization: bearer(ANALYST) },
    });
    expect(r.statusCode, r.body).toBe(200);
    const items = r.json().data.items as Array<{ offer: { connector: string; price_minor: number | null }; link: { url: string } | null }>;
    expect(items).toHaveLength(2);
    for (const i of items) {
      expect(i.offer).toMatchObject({ connector: 'amazon-associates', price_minor: null });
      expect(i.link?.url).toMatch(/^https:\/\/go\.example\.com\/r\/[0-9a-f]{32}$/);
    }
    expect(r.body).not.toMatch(/amazon\.in\//i);
  });

  it('a refusal is reported per row and the rest still mint; a paused programme mints nothing', async () => {
    await pool.query(`update offers set status = 'revoked' where org_id = $1 and merchant_item_ref = 'B0DEMO0003'`, [ORG]);
    const revoked = await sheet.mintAmazonLinks({ orgSlug: net.slug, post, redirectUrl });
    expect(revoked.offers).toBe(2);
    await pool.query(`update offers set status = 'active' where org_id = $1 and merchant_item_ref = 'B0DEMO0003'`, [ORG]);

    // A placement whose property lost its owner_operated verification is refused by the route.
    await pool.query(`update verifications set expires_at = now() - interval '1 hour' where org_id = $1 and property_id = $2`, [
      ORG,
      net.props.ig,
    ]);
    await pool.query(`update links set status = 'paused' where org_id = $1`, [ORG]);
    const res = await sheet.mintAmazonLinks({ orgSlug: net.slug, post, redirectUrl, now: () => 1_790_000_100_000 });
    expect(res.minted).toBe(3);
    expect(res.failed).toHaveLength(3);
    expect(res.failed[0]).toMatchObject({ platform: 'instagram', status: 403, code: 'PROPERTY_NOT_OWNER_OPERATED' });
    await pool.query(`update verifications set expires_at = null where org_id = $1 and property_id = $2`, [ORG, net.props.ig]);

    await pool.query(`update programmes set status = 'paused' where id = $1`, [summary.programme_id]);
    await expect(sheet.mintAmazonLinks({ orgSlug: net.slug, post, redirectUrl })).rejects.toThrow(/programme is 'paused'/);
    await pool.query(`update programmes set status = 'active' where id = $1`, [summary.programme_id]);
  });
});

describe('pause / resume (the kill switch, as the organisation’s network_admin)', () => {
  const sign = (sub: string, orgId: string) => jwt.sign({ sub, org_id: orgId, role: 'network_admin' }, process.env.JWT_SECRET as string);
  const postAs = async (url: string, b: string) => {
    const r = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${b}` } });
    return { statusCode: r.statusCode, headers: r.headers as Record<string, unknown>, body: r.body };
  };

  it('needs a real network_admin member (the audit row names a users row)', async () => {
    await expect(sheet.amazonKillSwitch({ orgSlug: net.slug, action: 'pause', sign, post: postAs })).rejects.toThrow(/no network_admin member/);
  });

  it('pauses the programme through the route (audit row, links refused), and resumes it', async () => {
    await pool.query(`insert into memberships (user_id, org_id, role) values ($1, $2, 'network_admin')`, [ADMIN.id, ORG]);
    const paused = await sheet.amazonKillSwitch({ orgSlug: net.slug, action: 'pause', sign, post: postAs });
    expect(paused).toMatchObject({ programme_id: summary.programme_id, status: 'paused' });
    // The programme's active links (the shop's three), whose cached routes the route clears.
    expect(paused.invalidated_routes).toBe(3);
    const audit = await pool.query(`select action, actor_id from audit_log where org_id = $1 and entity_id = $2`, [ORG, summary.programme_id]);
    expect(audit.rows).toEqual([{ action: 'programme.pause', actor_id: ADMIN.id }]);
    await expect(sheet.mintAmazonLinks({ orgSlug: net.slug, post, redirectUrl })).rejects.toThrow(/programme is 'paused'/);
    const resumed = await sheet.amazonKillSwitch({ orgSlug: net.slug, action: 'resume', sign, post: postAs });
    expect(resumed.status).toBe('active');
    await expect(sheet.amazonKillSwitch({ orgSlug: net.slug, action: 'resume', sign, post: postAs })).rejects.toThrow(/HTTP 409 CONFLICT/);
  });
});

describe('status (the check step)', () => {
  it('counts placements, offers, looks, links, clicks and conversions by attribution and suspense reason', async () => {
    const link = await pool.query(
      `select l.id from links l join placements pl on pl.id = l.placement_id where l.org_id = $1 and l.status = 'active' limit 1`,
      [ORG],
    );
    await pool.query(
      `insert into clicks (org_id, link_id, click_id, occurred_at, context) values ($1, $2, 'demo-click-sheet-1', now(), '{}')`,
      [ORG, link.rows[0]!.id],
    );
    const s = await sheet.amazonStatus({ orgSlug: net.slug });
    expect(s).toMatchObject({
      store_id: AMZ.STORE,
      account_status: 'active',
      programme_status: 'active',
      placements: 3,
      placements_with_tracking_id: 2,
      offers: { active: 3, stale: 0, revoked: 0, priced_now: 0 },
      looks_with_amazon_items: 1,
      links_active: 3,
      clicks: 1,
      conversions: { total: 0, suspense: 0 },
    });
    expect(s.sample_link).toMatchObject({ platform: 'web' });
    await expect(sheet.amazonStatus({ orgSlug: 'no-such-org' })).rejects.toThrow(/no organisation/);
  });

  it('csvField quotes commas, quotes and newlines', () => {
    expect(sheet.csvLine(['a', 'b,c', 'say "hi"', null, 3])).toBe('a,"b,c","say ""hi""",,3');
  });
});
