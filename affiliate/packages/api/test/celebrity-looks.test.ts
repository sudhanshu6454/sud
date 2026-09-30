// Celebrity looks end to end on pg-mem: the library import makes draft looks
// for unreviewed "Demo Star" celebrities → publishing is refused while the
// status allows nothing → a rights review per the capability matrix →
// products through instant links into the pieces (EXACT refused without
// evidence, pending until a second person approves; several SIMILAR) →
// publish → the public feed, hub, look page and storefront show exactly what
// the status allows, piece by piece, with tracked /r/ links → a downgrade,
// an expired licence and a minor flag hide content at the next read.
// TEST data only.

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_celebrity_looks';
process.env.JWT_SECRET ??= 'celebrity-looks-test-secret';
process.env.API_PORT ??= '0';
process.env.REDIRECT_PORT ??= '0';
process.env.REDIRECT_BASE_URL = 'https://afflino.example.com';
process.env.SITE_URL = 'https://afflino.example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { AMZ } from './amazon-fixtures.js';
import { json, libraryFixture, setupCelebrityWorld, WEB_TAG, type CelebCtx } from './celebrity-fixtures.js';

const ORG = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const OTHER = { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', slug: 'demo-other' };

let ctx: CelebCtx;
let lookOne: string; // Demo Star One, three pieces
let lookTwo: string; // Demo Star Two, one piece
let starOne: string;
let pieces: Array<{ id: string; label: string }>;

async function inject(method: 'GET' | 'POST', url: string, who?: Parameters<CelebCtx['as']>[0], payload?: unknown) {
  return ctx.app.inject({ method, url, headers: who ? ctx.as(who) : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
}

beforeAll(async () => {
  ctx = await setupCelebrityWorld({ orgId: ORG, otherOrg: OTHER });
  const { importLibrary } = await import('../src/looks/library-import.js');
  const summary = await importLibrary({ orgSlug: 'afflino', text: libraryFixture(), actorId: null });
  expect(summary.looks_created).toBe(2);
  lookOne = summary.created_looks.find((l) => l.celebrity === 'Demo Star One')!.look_id;
  lookTwo = summary.created_looks.find((l) => l.celebrity === 'Demo Star Two')!.look_id;
  const c = await ctx.pool.query(`select id from celebrities where slug = 'demo-star-one'`);
  starOne = String(c.rows[0]!.id);
  const p = await ctx.pool.query(`select id, label from look_pieces where look_id = $1 order by position`, [lookOne]);
  pieces = p.rows.map((r) => ({ id: String(r.id), label: String(r.label) }));
}, 60000);

describe('import → draft looks for unreviewed celebrities', () => {
  it('creates draft looks with three pieces in order, the still with its licence, the celebrity unreviewed', async () => {
    expect(pieces.map((p) => p.label)).toEqual(['The shirt', 'The trousers', 'The sunglasses']);
    const look = await ctx.pool.query(`select status, celebrity_display, still_asset_id, property_id, platform_post_id from looks where id = $1`, [lookOne]);
    expect(look.rows[0]).toMatchObject({ status: 'draft', celebrity_display: 'name_and_image', platform_post_id: '17900000000000001' });
    const still = await ctx.pool.query(`select kind, license, commercial_reuse, territory, screen_status from assets where id = $1`, [look.rows[0]!.still_asset_id]);
    expect(still.rows[0]).toMatchObject({ kind: 'still', license: 'TEST staff footage', commercial_reuse: 'yes', territory: 'IN', screen_status: 'unscreened' });
    const celeb = await ctx.pool.query(`select rights_status, max_display, shoppable, aliases from celebrities where id = $1`, [starOne]);
    expect(celeb.rows[0]).toMatchObject({ rights_status: 'unreviewed', max_display: 'none', shoppable: false, aliases: ['D. Star One'] });
  });

  it('nothing about an unreviewed celebrity is public: feed empty, hub and look 404, legacy catalogue hides celebrity looks', async () => {
    const feed = await json(await inject('GET', '/v1/public/afflino/spotted'));
    expect(feed.data.total).toBe(0);
    expect((await inject('GET', '/v1/public/afflino/celebrities/demo-star-one')).statusCode).toBe(404);
    expect((await inject('GET', `/v1/public/afflino/looks/${lookOne}`)).statusCode).toBe(404);
    const legacy = await json(await inject('GET', '/v1/looks', 'analyst'));
    expect(legacy.data.items.some((l: { id: string }) => l.id === lookOne)).toBe(false);
    expect((await inject('GET', `/v1/looks/${lookOne}`, 'analyst')).statusCode).toBe(404);
    const sitemap = await json(await inject('GET', '/v1/public/afflino/sitemap'));
    expect(sitemap.data).toEqual({ looks: [], celebrities: [], storefronts: [] });
  });
});

describe('publish gate', () => {
  it('refuses while unreviewed, reporting every failing check', async () => {
    const res = await inject('POST', `/v1/editorial/looks/${lookOne}/transition`, 'editor', { to: 'published' });
    expect(res.statusCode).toBe(409);
    const body = await json(res);
    const failing = body.gate.checks.filter((c: { ok: boolean }) => !c.ok).map((c: { code: string }) => c.code);
    expect(failing).toEqual(expect.arrayContaining(['rights_status', 'display_mode', 'image_licence', 'every_piece_has_a_product']));
    expect(body.gate.checks.find((c: { code: string }) => c.code === 'moment_date').ok).toBe(true);
    expect(body.gate.checks.find((c: { code: string }) => c.code === 'in_house_page').ok).toBe(true);
  });

  it('an editor cannot clear a celebrity; only blocked is theirs', async () => {
    const res = await inject('POST', `/v1/celebrities/${starOne}/rights-review`, 'editor', {
      rights_status: 'cleared',
      evidence_ref: 'TEST-COUNSEL-1',
      note: 'x',
    });
    expect(res.statusCode).toBe(403);
    const blocked = await inject('POST', `/v1/celebrities/${starOne}/rights-review`, 'editor', { rights_status: 'blocked', note: 'hold' });
    expect(blocked.statusCode).toBe(200);
    expect((await json(blocked)).data.celebrity.rights_status).toBe('blocked');
  });

  it('the matrix caps a review: editorial allows name only and no products; images and products need explicit words', async () => {
    const tooMuch = await inject('POST', `/v1/celebrities/${starOne}/rights-review`, 'reviewer', {
      rights_status: 'editorial',
      max_display: 'name_and_image',
      evidence_ref: 'TEST-COUNSEL-1',
      note: 'editorial only',
    });
    expect(tooMuch.statusCode).toBe(400);
    const noEvidence = await inject('POST', `/v1/celebrities/${starOne}/rights-review`, 'reviewer', { rights_status: 'cleared', note: 'x' });
    expect(noEvidence.statusCode).toBe(400);
    const res = await inject('POST', `/v1/celebrities/${starOne}/rights-review`, 'reviewer', {
      rights_status: 'cleared',
      evidence_ref: 'TEST-COUNSEL-1',
      note: 'TEST: counsel cleared name only first',
    });
    expect(res.statusCode).toBe(200);
    const c = (await json(res)).data.celebrity;
    expect(c).toMatchObject({ rights_status: 'cleared', max_display: 'name_only', shoppable: false });
    expect(c.effective).toEqual({ display: 'name_only', shoppable: false });
  });
});

describe('outfit tagging via instant links', () => {
  it('EXACT without evidence is refused and writes nothing', async () => {
    const before = await ctx.pool.query(`select count(*)::int as n from offers`);
    const res = await inject('POST', '/v1/editorial/instant-links', 'editor', {
      asin_or_url: 'https://www.amazon.in/dp/B0DEMO0101',
      brand: 'Demo Brand',
      model: 'Demo Linen Shirt',
      category: 'Shirts',
      property_ids: [],
      piece_id: pieces[0]!.id,
      match_type: 'exact',
    });
    expect(res.statusCode).toBe(422);
    expect((await json(res)).error.message).toMatch(/EXACT tag needs evidence/);
    const after = await ctx.pool.query(`select count(*)::int as n from offers`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('EXACT with evidence is tagged pending; links are withheld while the rights forbid a shoppable page', async () => {
    const res = await inject('POST', '/v1/editorial/instant-links', 'editor', {
      asin_or_url: 'https://www.amazon.in/Demo-Linen-Shirt/dp/B0DEMO0101?tag=someone-21',
      brand: 'Demo Brand',
      model: 'Demo Linen Shirt',
      category: 'Shirts',
      property_ids: [ctx.net.props.ig],
      piece_id: pieces[0]!.id,
      match_type: 'exact',
      evidence: 'TEST: the brand tag and the stitched pocket match the still frame 00:14',
      evidence_source: 'https://evidence.example.com/demo-0001',
    });
    expect(res.statusCode).toBe(201);
    const body = (await json(res)).data;
    expect(body.asin).toBe('B0DEMO0101');
    expect(body.item).toMatchObject({ match_type: 'exact', review_state: 'pending' });
    expect(body.links).toEqual([]);
    expect(body.links_withheld).toMatch(/shoppable/);
    expect(body.look_url).toBe(`https://afflino.example.com/looks/${lookOne}`);
  });

  it('a SIMILAR product naming the celebrity or using endorsement wording is refused', async () => {
    const named = await inject('POST', '/v1/editorial/instant-links', 'editor', {
      asin_or_url: 'B0DEMO0199',
      brand: 'Demo Brand',
      model: 'Demo Star One trousers',
      category: 'Trousers',
      property_ids: [],
      piece_id: pieces[1]!.id,
    });
    expect(named.statusCode).toBe(422);
    const dupe = await inject('POST', '/v1/editorial/instant-links', 'editor', {
      asin_or_url: 'B0DEMO0198',
      brand: 'Demo Brand',
      model: 'Pleated trousers dupe',
      category: 'Trousers',
      property_ids: [],
      piece_id: pieces[1]!.id,
    });
    expect(dupe.statusCode).toBe(422);
    expect((await json(dupe)).error.message).toMatch(/dupe/);
  });

  it('the rights reviewer allows name, image and products; SIMILAR items (several) then get links on the chosen pages', async () => {
    const review = await inject('POST', `/v1/celebrities/${starOne}/rights-review`, 'reviewer', {
      rights_status: 'cleared',
      max_display: 'name_and_image',
      shoppable: true,
      evidence_ref: 'TEST-LICENCE-DEMO-STAR-ONE',
      note: 'TEST: written licence from the agency, shoppable looks',
    });
    expect(review.statusCode).toBe(200);
    for (const [piece, asin, model] of [
      [pieces[1]!.id, 'B0DEMO0201', 'Demo Pleated Trousers'],
      [pieces[1]!.id, 'B0DEMO0202', 'Demo Wide Trousers'],
      [pieces[2]!.id, 'B0DEMO0301', 'Demo Round Sunglasses'],
      [pieces[0]!.id, 'B0DEMO0102', 'Demo Cotton Shirt'],
    ] as const) {
      const res = await inject('POST', '/v1/editorial/instant-links', 'editor', {
        asin_or_url: asin,
        brand: 'Demo Brand',
        model,
        category: 'Clothing',
        property_ids: [ctx.net.props.ig, ctx.net.props.fb, ctx.net.props.snap, ctx.net.props.thirdParty],
        piece_id: piece,
      });
      expect(res.statusCode).toBe(201);
      const body = (await json(res)).data;
      expect(body.item).toMatchObject({ match_type: 'similar', review_state: 'approved' });
      const byProperty = Object.fromEntries(body.links.map((l: { property_id: string }) => [l.property_id, l]));
      expect(byProperty[ctx.net.props.ig]).toMatchObject({ platform: 'instagram', tracking_id: AMZ.IG_TAG, post_label: '#ad · Buy on Amazon.in', refused: null });
      expect(byProperty[ctx.net.props.ig].link_url).toMatch(/^https:\/\/afflino\.example\.com\/r\/[0-9a-f]{32}$/);
      expect(byProperty[ctx.net.props.fb]).toMatchObject({ tracking_id: AMZ.FB_TAG, refused: null });
      expect(byProperty[ctx.net.props.snap].refused.code).toBe('PROPERTY_NOT_OWNER_OPERATED');
      expect(byProperty[ctx.net.props.snap].link_url).toBeNull();
      // A creator's page (not the owner's) never gets the owner's tag.
      expect(byProperty[ctx.net.props.thirdParty].refused.code).toBe('PROPERTY_NOT_OWNER_OPERATED');
    }
  });

  it('at most one EXACT per piece (409), a product once per piece (409)', async () => {
    const offer = await ctx.pool.query(`select id from offers where merchant_item_ref = 'B0DEMO0102'`);
    const again = await inject('POST', `/v1/editorial/pieces/${pieces[0]!.id}/items`, 'editor', { offer_id: offer.rows[0]!.id });
    expect(again.statusCode).toBe(409);
    const other = await ctx.pool.query(`select id from offers where merchant_item_ref = 'B0DEMO0201'`);
    const exact2 = await inject('POST', `/v1/editorial/pieces/${pieces[0]!.id}/items`, 'editor', {
      offer_id: other.rows[0]!.id,
      match_type: 'exact',
      evidence: 'TEST: a second exact claim for the same piece',
      evidence_source: 'demo-file-2',
    });
    expect(exact2.statusCode).toBe(409);
  });

  it('publishing waits for the EXACT review; the tagger cannot approve it; a second editor can', async () => {
    const res = await inject('POST', `/v1/editorial/looks/${lookOne}/transition`, 'editor', { to: 'published' });
    expect(res.statusCode).toBe(409);
    const failing = (await json(res)).gate.checks.filter((c: { ok: boolean }) => !c.ok).map((c: { code: string }) => c.code);
    expect(failing).toContain('exact_reviewed');
    const item = await ctx.pool.query(`select id from look_items where piece_id = $1 and match_type = 'exact'`, [pieces[0]!.id]);
    const self = await inject('POST', `/v1/editorial/look-items/${item.rows[0]!.id}/review`, 'editor', { decision: 'approve' });
    expect(self.statusCode).toBe(403);
    const ok = await inject('POST', `/v1/editorial/look-items/${item.rows[0]!.id}/review`, 'editor2', { decision: 'approve' });
    expect(ok.statusCode).toBe(200);
  });

  it('the image needs the frame screen: publish is refused until an editor passes it', async () => {
    const res = await inject('POST', `/v1/editorial/looks/${lookOne}/transition`, 'editor', { to: 'published' });
    expect(res.statusCode).toBe(409);
    const image = (await json(res)).gate.checks.find((c: { code: string }) => c.code === 'image_licence');
    expect(image).toMatchObject({ ok: false });
    expect(image.detail).toMatch(/frame_not_screened/);
    const still = await ctx.pool.query(`select still_asset_id from looks where id = $1`, [lookOne]);
    const screened = await inject('POST', `/v1/editorial/assets/${still.rows[0]!.still_asset_id}`, 'editor', { screen_status: 'passed' });
    expect(screened.statusCode).toBe(200);
  });

  it('publishes, and mints the look page links on afflino.com’s own placement (the Instagram links are the post’s)', async () => {
    const res = await inject('POST', `/v1/editorial/looks/${lookOne}/transition`, 'editor', { to: 'published' });
    expect(res.statusCode).toBe(200);
    const body = (await json(res)).data;
    expect(body.status).toBe('published');
    expect(body.gate.ok).toBe(true);
    // Five approved items (1 exact + 4 similar); instant links already minted IG links for the 4 similar.
    expect(body.links.minted + body.links.existing).toBe(5);
    expect(body.links.unlinked).toEqual([]);
  });
});

describe('public reads show what the status allows, piece by piece', () => {
  it('look page: headline, commercial label, non-endorsement line, still, hotspots, EXACT first then SIMILAR, /r/ links', async () => {
    const res = await inject('GET', `/v1/public/afflino/looks/${lookOne}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=30');
    const look = (await json(res)).data;
    // The headline never names the celebrity (it is set far larger than the credit line with the non-endorsement line).
    expect(look.headline).toBe('Spotted at Demo Film Premiere');
    expect(look.celebrity).toEqual({ name: 'Demo Star One', slug: 'demo-star-one' });
    expect(look.commercial_label).toMatch(/^Ad/);
    expect(look.non_endorsement).toBe('Demo Star One is not affiliated with Afflino and has not endorsed any product on this page.');
    // The still at its own afflino.com address (the origin URL never reaches the public).
    expect(look.image).toEqual({ url: expect.stringMatching(new RegExp(`^/img/looks/${lookOne}\\?v=[0-9a-f]{10}$`)), credit: 'Demo Media (TEST)' });
    expect(res.body).not.toContain('cdn.example.com');
    expect(look.display).toEqual({ name: true, image: true, shoppable: true });
    expect(look.pieces.map((p: { label: string }) => p.label)).toEqual(['The shirt', 'The trousers', 'The sunglasses']);
    const shirt = look.pieces[0];
    expect(shirt.hotspot).toEqual({ x: 0.42, y: 0.35 });
    expect(shirt.exact).toMatchObject({ match: 'exact', label: 'The same item' });
    expect(shirt.exact.product.model).toBe('Demo Linen Shirt');
    expect(shirt.similar.map((s: { product: { model: string } }) => s.product.model)).toEqual(['Demo Cotton Shirt']);
    expect(shirt.similar[0].detail).toBe('Similar style. Demo Star One did not wear or endorse this product.');
    const trousers = look.pieces[1];
    expect(trousers.exact).toBeNull();
    expect(trousers.similar.map((s: { product: { model: string } }) => s.product.model)).toEqual(['Demo Pleated Trousers', 'Demo Wide Trousers']);
    for (const p of look.pieces) {
      for (const it of [...(p.exact ? [p.exact] : []), ...p.similar]) {
        expect(it.link.url).toMatch(/^https:\/\/afflino\.example\.com\/r\/[0-9a-f]{32}$/);
        expect(it.offer).toMatchObject({ connector: 'amazon-associates', price_minor: null, stock_status: 'unknown' });
      }
    }
    expect(look.disclosure).toEqual({ sponsored: false, affiliate_links: true, amazon_associate: true });
    expect(res.body).not.toContain('amazon.in/dp');
    expect(res.body).not.toContain('offer_url');
    expect(res.body).not.toContain('TEST: the brand tag');
  });

  it('the look page links carry afflino.com’s own tag at the redirect (never the Instagram page’s)', async () => {
    const look = (await json(await inject('GET', `/v1/public/afflino/looks/${lookOne}`))).data;
    const token = String(look.pieces[1].similar[0].link.url).split('/r/')[1];
    const r = await ctx.redirect.inject({ method: 'GET', url: `/r/${token}?via=look`, headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Demo' } });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe(`https://www.amazon.in/dp/B0DEMO0201?tag=${WEB_TAG}`);
    const click = await ctx.pool.query(`select context from clicks c join links l on l.id = c.link_id where l.token = $1`, [token]);
    expect(click.rows[0]!.context).toMatchObject({ via: 'look' });
    const bad = await ctx.redirect.inject({ method: 'GET', url: `/r/${token}?via=Bad%20Value!`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
    expect(bad.statusCode).toBe(302);
    expect(bad.headers.location).not.toContain('via');
  });

  it('feed, hub and sitemap list the look; Demo Star Two (unreviewed) stays out', async () => {
    const feed = (await json(await inject('GET', '/v1/public/afflino/spotted'))).data;
    expect(feed.total).toBe(1);
    expect(feed.items[0]).toMatchObject({ id: lookOne, headline: 'Spotted at Demo Film Premiere', celebrity: { name: 'Demo Star One' }, pieces: 3, shoppable: true });
    expect(feed.items[0].image.url).toMatch(new RegExp(`^/img/looks/${lookOne}\\?v=`));
    expect(feed.commercial_label).toMatch(/^Ad/);
    const hub = await inject('GET', '/v1/public/afflino/celebrities/demo-star-one');
    expect(hub.statusCode).toBe(200);
    expect((await json(hub)).data.looks.total).toBe(1);
    expect((await inject('GET', '/v1/public/afflino/celebrities/demo-star-two')).statusCode).toBe(404);
    const sitemap = (await json(await inject('GET', '/v1/public/afflino/sitemap'))).data;
    expect(sitemap.looks.map((l: { id: string }) => l.id)).toEqual([lookOne]);
    expect(sitemap.celebrities).toEqual(['demo-star-one']);
  });

  it('storefront: only once live, on the look’s own page', async () => {
    const created = await inject('POST', '/v1/editorial/storefronts', 'editor', { property_id: ctx.net.props.ig, slug: 'demo-afflino-ig', display_name: 'Demo Afflino' });
    expect(created.statusCode).toBe(201);
    expect((await inject('GET', '/v1/public/afflino/storefronts/demo-afflino-ig')).statusCode).toBe(404);
    const id = (await json(created)).data.id;
    expect((await inject('POST', `/v1/editorial/storefronts/${id}`, 'editor', { status: 'live' })).statusCode).toBe(200);
    const sf = (await json(await inject('GET', '/v1/public/afflino/storefronts/demo-afflino-ig'))).data;
    expect(sf.storefront).toMatchObject({ slug: 'demo-afflino-ig', name: 'Demo Afflino', platform: 'instagram' });
    expect(sf.looks.items.map((l: { id: string }) => l.id)).toEqual([lookOne]);
    const look = (await json(await inject('GET', `/v1/public/afflino/looks/${lookOne}`))).data;
    expect(look.source.storefront).toEqual({ slug: 'demo-afflino-ig', name: 'Demo Afflino' });
  });

  it('is tenant-safe: another organisation’s slug sees nothing; an unknown slug is 404', async () => {
    expect((await json(await inject('GET', '/v1/public/demo-other/spotted'))).data.total).toBe(0);
    expect((await inject('GET', `/v1/public/demo-other/looks/${lookOne}`)).statusCode).toBe(404);
    expect((await inject('GET', '/v1/public/no-such-org/spotted')).statusCode).toBe(404);
    const cross = await ctx.app.inject({ method: 'GET', url: `/v1/editorial/looks/${lookOne}`, headers: ctx.as('editor', OTHER.id) });
    expect(cross.statusCode).toBe(404);
  });
});

describe('read-time masking', () => {
  it('an expired licence hides the still (and hotspots) at once, without re-publishing', async () => {
    const still = await ctx.pool.query(`select still_asset_id from looks where id = $1`, [lookOne]);
    await ctx.pool.query(`update assets set expires_at = now() - interval '1 minute' where id = $1`, [still.rows[0]!.still_asset_id]);
    const look = (await json(await inject('GET', `/v1/public/afflino/looks/${lookOne}`))).data;
    expect(look.image).toBeNull();
    expect(look.display).toEqual({ name: true, image: false, shoppable: true });
    expect(look.pieces.every((p: { hotspot: unknown }) => p.hotspot === null)).toBe(true);
    const feed = (await json(await inject('GET', '/v1/public/afflino/spotted'))).data;
    expect(feed.items[0].image).toBeNull();
    await ctx.pool.query(`update assets set expires_at = '2027-12-31T18:29:59Z' where id = $1`, [still.rows[0]!.still_asset_id]);
  });

  it('a downgrade to editorial hides products and pauses the look links at once; the upgrade brings them back', async () => {
    const down = await inject('POST', `/v1/celebrities/${starOne}/rights-review`, 'reviewer', {
      rights_status: 'editorial',
      evidence_ref: 'TEST-COUNSEL-2',
      note: 'TEST: editorial only for now',
    });
    expect(down.statusCode).toBe(200);
    expect((await json(down)).data.links_paused).toBeGreaterThan(0);
    const look = (await json(await inject('GET', `/v1/public/afflino/looks/${lookOne}`))).data;
    expect(look.display).toEqual({ name: true, image: false, shoppable: false });
    expect(look.pieces.every((p: { exact: unknown; similar: unknown[] }) => p.exact === null && p.similar.length === 0)).toBe(true);
    const active = await ctx.pool.query(
      `select count(*)::int as n from links l join look_items li on li.id = l.look_item_id where li.look_id = $1 and l.status = 'active'`,
      [lookOne],
    );
    expect(active.rows[0]!.n).toBe(0);
    const paused = await ctx.pool.query(`select token from links l join look_items li on li.id = l.look_item_id where li.look_id = $1 limit 1`, [lookOne]);
    const r = await ctx.redirect.inject({ method: 'GET', url: `/r/${paused.rows[0]!.token}`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('This link is paused');
    const up = await inject('POST', `/v1/celebrities/${starOne}/rights-review`, 'reviewer', {
      rights_status: 'cleared',
      max_display: 'name_and_image',
      shoppable: true,
      evidence_ref: 'TEST-LICENCE-DEMO-STAR-ONE',
      note: 'TEST: back to shoppable',
    });
    expect((await json(up)).data.links_reactivated).toBeGreaterThan(0);
    const again = (await json(await inject('GET', `/v1/public/afflino/looks/${lookOne}`))).data;
    expect(again.display).toEqual({ name: true, image: true, shoppable: true });
    expect(again.pieces[1].similar[0].link).not.toBeNull();
  });

  it('flagging the celebrity a minor hides everything and can never be cleared', async () => {
    const res = await inject('POST', '/v1/celebrities', 'editor', { name: 'Demo Star Three' });
    const id = (await json(res)).data.id;
    const flagged = await inject('POST', `/v1/celebrities/${id}`, 'editor', { is_minor: true });
    expect((await json(flagged)).data.is_minor).toBe(true);
    const clear = await inject('POST', `/v1/celebrities/${id}/rights-review`, 'reviewer', { rights_status: 'cleared', evidence_ref: 'TEST-X', note: 'x' });
    expect(clear.statusCode).toBe(409);
    expect((await inject('POST', `/v1/celebrities/${id}`, 'reviewer', { is_minor: false })).statusCode).toBe(403);
  });
});
