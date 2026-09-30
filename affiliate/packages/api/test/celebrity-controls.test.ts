// The controls three independent checks found missing or bypassable, each as
// the probe that found it (celebrity looks, 0007): a name reaches a page only
// in the credit line of that person's own look (storefronts, look text,
// product text, shelf titles, public replies); EXACT links wait for the
// second person; asset widening is the rights reviewer's and the frame
// flags are one-way; an added alias resets the review; a restore never turns
// links on where the new review allows no products; the still has its own
// address; takedowns list the stills and the share URLs and pause the plain
// page links; a look that was never public stays 404; the api's guards
// (rate limit, epoch-keyed cache, request log without the query, batched
// revalidation, analytics roles, sitemap owner check, Meta's data deletion).
// pg-mem; TEST data only ("Demo Star …", *.example.com, B0DEMO…).

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_celebrity_controls';
process.env.JWT_SECRET ??= 'celebrity-controls-test-secret';
process.env.API_PORT ??= '0';
process.env.REDIRECT_PORT ??= '0';
process.env.REDIRECT_BASE_URL = 'https://afflino.example.com';
process.env.SITE_URL = 'https://afflino.example.com';

import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, libraryFixture, publishDemoStarOne, setupCelebrityWorld, WEB_TAG, type CelebCtx, type PublishedLook } from './celebrity-fixtures.js';

const ORG = 'cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd';

let ctx: CelebCtx;
let w: PublishedLook;

async function inject(method: 'GET' | 'POST', url: string, who?: Parameters<CelebCtx['as']>[0], payload?: unknown) {
  return ctx.app.inject({ method, url, headers: who ? ctx.as(who) : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
}

async function publicLook(id: string) {
  const res = await inject('GET', `/v1/public/afflino/looks/${id}`);
  return { status: res.statusCode, body: res.statusCode === 200 ? (await json(res)).data : null };
}

async function activeLinks(lookId: string): Promise<number> {
  return Number(
    (await ctx.pool.query(`select count(*) as n from links l join look_items li on li.id = l.look_item_id where li.look_id = $1 and l.status = 'active'`, [lookId])).rows[0]!.n,
  );
}

async function modelOf(asin: string): Promise<string> {
  return String((await ctx.pool.query(`select p.model from products p join variants v on v.product_id = p.id where v.merchant_sku = $1`, [asin])).rows[0]!.model);
}

beforeAll(async () => {
  ctx = await setupCelebrityWorld({ orgId: ORG });
  w = await publishDemoStarOne(ctx);
}, 90000);

describe('a storefront never names a celebrity', () => {
  it('refuses a name, slug or bio that names anyone (422), and a default taken from a handle that does', async () => {
    for (const payload of [
      { property_id: ctx.net.props.ig, slug: 'demo-afflino-ig', display_name: 'Demo Star Two Fans' },
      { property_id: ctx.net.props.ig, slug: 'demo-star-two-fans', display_name: 'Demo Afflino' },
      { property_id: ctx.net.props.ig, slug: 'demo-afflino-ig', display_name: 'Demo Afflino', bio: 'Daily Demo Star Two sightings' },
      { property_id: ctx.net.props.ig, slug: 'demo-afflino-ig', display_name: 'DemoStarOne daily' },
    ]) {
      const res = await inject('POST', '/v1/editorial/storefronts', 'editor', payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(422);
      expect((await json(res)).error.message).toMatch(/names a celebrity/);
    }
    expect(Number((await ctx.pool.query(`select count(*) as n from storefronts`)).rows[0]!.n)).toBe(0);
  });

  it('hides a live storefront whose text names someone later (a new alias, a direct edit): 404, no facet, no card link, no sitemap', async () => {
    const created = await inject('POST', '/v1/editorial/storefronts', 'editor', { property_id: ctx.net.props.ig, slug: 'demo-afflino-ig', display_name: 'Demo Afflino', status: 'live' });
    expect(created.statusCode).toBe(201);
    expect((await inject('GET', '/v1/public/afflino/storefronts/demo-afflino-ig')).statusCode).toBe(200);
    expect((await publicLook(w.lookOne)).body.source.storefront).toEqual({ slug: 'demo-afflino-ig', name: 'Demo Afflino' });
    await ctx.pool.query(`update storefronts set bio = 'Daily Demo Star Two sightings' where slug = 'demo-afflino-ig'`);
    expect((await inject('GET', '/v1/public/afflino/storefronts/demo-afflino-ig')).statusCode).toBe(404);
    const feed = (await json(await inject('GET', '/v1/public/afflino/spotted'))).data;
    expect(feed.facets.storefronts).toEqual([]);
    expect(feed.items[0].source.storefront).toBeNull();
    expect((await publicLook(w.lookOne)).body.source.storefront).toBeNull();
    expect((await json(await inject('GET', '/v1/public/afflino/sitemap'))).data.storefronts).toEqual([]);
    // Nor can it be made live again while it does.
    const id = String((await ctx.pool.query(`select id from storefronts where slug = 'demo-afflino-ig'`)).rows[0]!.id);
    await ctx.pool.query(`update storefronts set status = 'draft' where id = $1`, [id]);
    const live = await inject('POST', `/v1/editorial/storefronts/${id}`, 'editor', { status: 'live' });
    expect(live.statusCode).toBe(422);
    await ctx.pool.query(`update storefronts set bio = null, status = 'live' where id = $1`, [id]);
    expect((await inject('GET', '/v1/public/afflino/storefronts/demo-afflino-ig')).statusCode).toBe(200);
  });

  it('the sitemap lists a storefront only while its page is verified owner-operated', async () => {
    expect((await json(await inject('GET', '/v1/public/afflino/sitemap'))).data.storefronts).toEqual(['demo-afflino-ig']);
    await ctx.pool.query(`update verifications set expires_at = now() - interval '1 day' where property_id = $1`, [ctx.net.props.ig]);
    expect((await json(await inject('GET', '/v1/public/afflino/sitemap'))).data.storefronts).toEqual([]);
    expect((await inject('GET', '/v1/public/afflino/storefronts/demo-afflino-ig')).statusCode).toBe(404);
    await ctx.pool.query(`update verifications set expires_at = null where property_id = $1`, [ctx.net.props.ig]);
  });
});

describe('a look’s own text never names anyone', () => {
  it('refuses an event, place or piece label that names a celebrity (their own or another)', async () => {
    const ev = await inject('POST', `/v1/editorial/looks/${w.lookTwo}`, 'editor', { event_name: 'Demo Star One after-party' });
    expect(ev.statusCode).toBe(400);
    expect((await json(ev)).error.message).toMatch(/names a celebrity \(Demo Star One/);
    const place = await inject('POST', `/v1/editorial/looks/${w.lookTwo}`, 'editor', { place: 'Demo Star Two street' });
    expect(place.statusCode).toBe(400);
    const piece = await inject('POST', `/v1/editorial/looks/${w.lookTwo}/pieces`, 'editor', { label: 'Demo Star One jacket', garment_category: 'outerwear' });
    expect(piece.statusCode).toBe(400);
  });

  it('hides a published look whose text came to name someone (404), and the publish gate reports it', async () => {
    await ctx.pool.query(`update looks set event_name = 'Demo Star Two birthday party' where id = $1`, [w.lookOne]);
    expect((await publicLook(w.lookOne)).status).toBe(404);
    expect((await json(await inject('GET', '/v1/public/afflino/spotted'))).data.items).toEqual([]);
    const gate = (await json(await inject('GET', `/v1/editorial/looks/${w.lookOne}`, 'editor'))).data.gate;
    expect(gate.checks.find((c: { code: string }) => c.code === 'no_names_in_text')).toMatchObject({ ok: false });
    await ctx.pool.query(`update looks set event_name = 'Demo Film Premiere' where id = $1`, [w.lookOne]);
    expect((await publicLook(w.lookOne)).status).toBe(200);
  });

  it('the headline never carries the name; the name is in the credit line with the non-endorsement line', async () => {
    const look = (await publicLook(w.lookOne)).body;
    expect(look.headline).toBe('Spotted at Demo Film Premiere');
    expect(look.headline).not.toContain('Demo Star');
    expect(look.non_endorsement).toMatch(/^Demo Star One is not affiliated/);
  });
});

describe('product text never names anyone and never uses endorsement wording', () => {
  it('instant links refuse before anything is written: the live look’s product text stays', async () => {
    const before = await modelOf('B0DEMO0901');
    for (const [brand, model] of [
      ['Demo Star One', 'Demo shirt'],
      ['Demo Brand', 'Gucci style shirt'],
      ['Demo Brand', 'Demo Star Two jacket'],
      ['Demo Brand', 'first copy Demo bag'],
    ]) {
      const res = await inject('POST', '/v1/editorial/instant-links', 'editor', {
        asin_or_url: 'B0DEMO0901',
        brand,
        model,
        category: 'Clothing',
        property_ids: [ctx.net.props.ig],
        piece_id: w.pieces[0]!.id,
      });
      expect(res.statusCode, `${brand} ${model}`).toBe(422);
      expect(await modelOf('B0DEMO0901')).toBe(before);
    }
  });

  it('the Amazon offers file refuses such text too (the whole run), so no write path rewrites a live tile', async () => {
    const { addAmazonOffers } = await import('../src/amazon/offers.js');
    await expect(
      addAmazonOffers({ orgSlug: 'afflino', offers: [{ row: 1, asin: 'B0DEMO0901', brand: 'Demo Brand', model: 'Gucci style shirt', category: 'Clothing', size: null, colour: null }] }),
    ).rejects.toThrow(/endorsement wording/);
    await expect(
      addAmazonOffers({ orgSlug: 'afflino', offers: [{ row: 1, asin: 'B0DEMO0901', brand: 'Demo Star One', model: 'Demo shirt', category: 'Clothing', size: null, colour: null }] }),
    ).rejects.toThrow(/names a celebrity/);
    expect(await modelOf('B0DEMO0901')).toMatch(/^Demo shirt/);
  });

  it('at read time an item whose text came to fail is dropped from the page', async () => {
    const before = (await publicLook(w.lookOne)).body.pieces[0].similar.length;
    const variant = String((await ctx.pool.query(`select product_id from variants where merchant_sku = 'B0DEMO0901'`)).rows[0]!.product_id);
    const old = await modelOf('B0DEMO0901');
    await ctx.pool.query(`update products set model = 'Demo Star One shirt' where id = $1`, [variant]);
    expect((await publicLook(w.lookOne)).body.pieces[0].similar.length).toBe(before - 1);
    await ctx.pool.query(`update products set model = $2 where id = $1`, [variant, old]);
    expect((await publicLook(w.lookOne)).body.pieces[0].similar.length).toBe(before);
  });

  it('an Amazon shelf (the offers file’s look column) names nobody, never joins a celebrity look, and claims no match', async () => {
    const { addAmazonOffers } = await import('../src/amazon/offers.js');
    await expect(
      addAmazonOffers({ orgSlug: 'afflino', offers: [{ row: 1, asin: 'B0DEMO5001', brand: 'Demo Brand', model: 'Demo tote', category: 'Bags', size: null, colour: null, look: 'Demo Star Two airport look: her favourite bag' }] }),
    ).rejects.toThrow(/favourite|names a celebrity/);
    const title = String((await ctx.pool.query(`select title from looks where id = $1`, [w.lookOne])).rows[0]!.title);
    await expect(
      addAmazonOffers({ orgSlug: 'afflino', offers: [{ row: 1, asin: 'B0DEMO5001', brand: 'Demo Brand', model: 'Demo tote', category: 'Bags', size: null, colour: null, look: title }] }),
    ).rejects.toThrow(/celebrity look has this title/);
    const ok = await addAmazonOffers({ orgSlug: 'afflino', offers: [{ row: 1, asin: 'B0DEMO5001', brand: 'Demo Brand', model: 'Demo tote', category: 'Bags', size: null, colour: null, look: 'Demo Travel shelf' }] });
    const items = await ctx.pool.query(`select match_type, evidence from look_items where look_id = $1`, [ok.looks[0]!.look_id]);
    expect(items.rows).toEqual([{ match_type: null, evidence: null }]);
  });
});

describe('an EXACT tag’s links wait for its second person', () => {
  let itemId: string;
  it('instant links tag it pending and mint nothing', async () => {
    const res = await inject('POST', '/v1/editorial/instant-links', 'editor', {
      asin_or_url: 'B0DEMO7001',
      brand: 'Demo Brand',
      model: 'Demo trousers exact',
      category: 'Clothing',
      property_ids: [ctx.net.props.ig],
      piece_id: w.pieces[1]!.id,
      match_type: 'exact',
      evidence: 'TEST: the brand tag is readable at 00:12 of the video',
      evidence_source: 'demo-vid-0001#00:12',
    });
    expect(res.statusCode).toBe(201);
    const body = (await json(res)).data;
    itemId = body.item.item_id;
    expect(body.item.review_state).toBe('pending');
    expect(body.links).toEqual([]);
    expect(body.links_withheld).toMatch(/second person/);
    expect(Number((await ctx.pool.query(`select count(*) as n from links where look_item_id = $1`, [itemId])).rows[0]!.n)).toBe(0);
  });

  it('after the second person approves, the look page link and (on a second call) the page links are minted', async () => {
    const approve = await inject('POST', `/v1/editorial/look-items/${itemId}/review`, 'editor2', { decision: 'approve' });
    expect(approve.statusCode).toBe(200);
    expect(Number((await ctx.pool.query(`select count(*) as n from links where look_item_id = $1 and status = 'active'`, [itemId])).rows[0]!.n)).toBe(1);
    const again = await inject('POST', '/v1/editorial/instant-links', 'editor', {
      asin_or_url: 'B0DEMO7001',
      brand: 'Demo Brand',
      model: 'Demo trousers exact',
      category: 'Clothing',
      property_ids: [ctx.net.props.ig],
      piece_id: w.pieces[1]!.id,
      match_type: 'exact',
      evidence: 'TEST: the brand tag is readable at 00:12 of the video',
      evidence_source: 'demo-vid-0001#00:12',
    });
    expect(again.statusCode).toBe(201);
    const body = (await json(again)).data;
    expect(body.item.item_id).toBe(itemId);
    expect(body.links[0]).toMatchObject({ minted: true, refused: null });
  });

  it('an instant link always goes into a piece', async () => {
    const res = await inject('POST', '/v1/editorial/instant-links', 'editor', { asin_or_url: 'B0DEMO7002', brand: 'Demo Brand', model: 'Demo cap', category: 'Headwear', property_ids: [ctx.net.props.ig] });
    expect(res.statusCode).toBe(422);
    expect((await json(res)).error.message).toMatch(/piece_id/);
  });
});

describe('asset licence metadata: widening is the rights reviewer’s, the frame flags are one-way', () => {
  let assetId: string;
  it('an editor cannot clear a frame flag (no one can), nor widen reuse, territory or expiry', async () => {
    assetId = String(
      (
        await ctx.pool.query(
          `insert into assets (org_id, kind, storage_key, public_url, license, commercial_reuse, territory, expires_at, copyright_owner, acquisition)
           values ($1, 'still', 'demo-stills/9001.jpg', 'https://cdn.example.com/demo-stills/9001.jpg', 'TEST staff footage', 'unknown', 'IN', now() + interval '30 days', 'Demo Media (TEST)', 'staff') returning id`,
          [ORG],
        )
      ).rows[0]!.id,
    );
    expect((await inject('POST', `/v1/editorial/assets/${assetId}`, 'editor', { minor_in_frame: true })).statusCode).toBe(200);
    for (const who of ['editor', 'reviewer'] as const) {
      const res = await inject('POST', `/v1/editorial/assets/${assetId}`, who, { minor_in_frame: false });
      expect(res.statusCode, who).toBe(403);
    }
    // Narrowing is anyone's (India no longer covered: the image may not be shown here).
    expect((await inject('POST', `/v1/editorial/assets/${assetId}`, 'editor', { territory: 'AE' })).statusCode).toBe(200);
    for (const payload of [{ commercial_reuse: 'yes' }, { territory: 'WW' }, { territory: 'IN' }, { expires_at: null }, { expires_at: '2099-01-01T00:00:00Z' }, { license: 'TEST another licence' }]) {
      const res = await inject('POST', `/v1/editorial/assets/${assetId}`, 'editor', payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(403);
      expect((await json(res)).error.message).toMatch(/rights reviewer/);
    }
    const byReviewer = await inject('POST', `/v1/editorial/assets/${assetId}`, 'reviewer', { commercial_reuse: 'yes', territory: 'IN' });
    expect(byReviewer.statusCode).toBe(200);
    expect((await json(byReviewer)).data.widened).toEqual(['commercial_reuse', 'territory']);
    const audit = await ctx.pool.query(`select action from audit_log where entity_id = $1 and action like 'asset.widen%'`, [assetId]);
    expect(audit.rows.length).toBe(1);
  });

  it('a new image starts its frame screen again: the still is hidden until it is screened', async () => {
    expect((await publicLook(w.lookOne)).body.image).not.toBeNull();
    const swap = await inject('POST', `/v1/editorial/assets/${w.stillId}`, 'editor', { public_url: 'https://cdn.example.com/demo-stills/other-frame.jpg' });
    expect(swap.statusCode).toBe(200);
    expect((await ctx.pool.query(`select screen_status from assets where id = $1`, [w.stillId])).rows[0]!.screen_status).toBe('unscreened');
    expect((await publicLook(w.lookOne)).body.image).toBeNull();
    expect((await inject('POST', `/v1/editorial/assets/${w.stillId}`, 'editor', { screen_status: 'passed' })).statusCode).toBe(200);
    expect((await publicLook(w.lookOne)).body.image).not.toBeNull();
  });

  it('no image without the chain of title; recording it is the rights reviewer’s', async () => {
    expect((await inject('POST', `/v1/editorial/assets/${w.stillId}`, 'editor', { acquisition: null })).statusCode).toBe(200);
    expect((await publicLook(w.lookOne)).body.image).toBeNull();
    expect((await inject('POST', `/v1/editorial/assets/${w.stillId}`, 'editor', { acquisition: 'staff' })).statusCode).toBe(403);
    expect((await inject('POST', `/v1/editorial/assets/${w.stillId}`, 'reviewer', { acquisition: 'staff' })).statusCode).toBe(200);
    expect((await publicLook(w.lookOne)).body.image).not.toBeNull();
  });

  it('the library file needs the chain of title with commercial_reuse=yes', async () => {
    const { parseLibraryCsv } = await import('../src/looks/library-import.js');
    const noOwner = libraryFixture().replace(/Demo Media \(TEST\),Demo Shooter,staff,TEST-ASSIGN-001/g, ',Demo Shooter,staff,TEST-ASSIGN-001');
    expect(parseLibraryCsv(noOwner).problems.join(' ')).toMatch(/copyright_owner is required/);
    const freelance = libraryFixture().replace(/staff,TEST-ASSIGN-001/g, 'freelance,');
    expect(parseLibraryCsv(freelance).problems.join(' ')).toMatch(/assignment_ref is required for freelance/);
  });
});

describe('the still’s own address', () => {
  it('serves the bytes only while the page may show the image; the origin address never reaches the public', async () => {
    const still = await import('../src/looks/still.js');
    const seen: string[] = [];
    still.__setStillFetch(async (url) => {
      seen.push(url);
      return new Response(Buffer.from('TEST-JPEG'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    });
    const res = await inject('GET', `/v1/public/afflino/looks/${w.lookOne}/still`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('public, max-age=30');
    expect(res.body).toBe('TEST-JPEG');
    expect(seen).toEqual(['https://cdn.example.com/demo-stills/other-frame.jpg']);
    // A draft (never public) is a 404; so is a look whose image may not be shown.
    expect((await inject('GET', `/v1/public/afflino/looks/${w.lookTwo}/still`)).statusCode).toBe(404);
    // Under the invalidation epoch (Redis), a burst for one image is one origin fetch (whatever `v`), until any invalidation.
    const guard = await import('../src/public-guard.js');
    const wasCache = process.env.PUBLIC_API_CACHE;
    process.env.PUBLIC_API_CACHE = 'on';
    guard.__clearPublicCache();
    seen.length = 0;
    const burst: string[] = [];
    for (let i = 0; i < 5; i += 1) burst.push(String((await inject('GET', `/v1/public/afflino/looks/${w.lookOne}/still?v=${i === 0 ? 'abc' : `f${i}`}`)).headers['x-public-cache']));
    expect(burst).toEqual(['miss', 'hit', 'hit', 'hit', 'hit']);
    expect(seen.length).toBe(1);
    const { invalidateAfterCommit } = await import('../src/looks/invalidate.js');
    await invalidateAfterCommit({ tokens: [], tags: [`look:${w.lookOne}`] });
    expect((await inject('GET', `/v1/public/afflino/looks/${w.lookOne}/still?v=abc`)).headers['x-public-cache']).toBe('miss');
    expect(seen.length).toBe(2);
    // An origin failure is never kept.
    guard.__clearPublicCache();
    still.__setStillFetch(async () => new Response('no', { status: 500 }));
    expect((await inject('GET', `/v1/public/afflino/looks/${w.lookOne}/still?v=bad`)).statusCode).toBe(502);
    still.__setStillFetch(async () => new Response(Buffer.from('TEST-JPEG'), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    expect((await inject('GET', `/v1/public/afflino/looks/${w.lookOne}/still?v=bad`)).statusCode).toBe(200);
    process.env.PUBLIC_API_CACHE = wasCache;
    guard.__clearPublicCache();
    still.__setStillFetch(null);
    expect(still.stillOriginAllowed('http://127.0.0.1:3344/x.jpg', { NODE_ENV: 'production' })).toBe(false);
    expect(still.stillOriginAllowed('https://10.0.0.5/x.jpg', { NODE_ENV: 'production' })).toBe(false);
    expect(still.stillOriginAllowed('https://cdn.example.com/x.jpg', { NODE_ENV: 'production' })).toBe(true);
  });
});

describe('a name-only look carries no commercial label and sends no comment replies', () => {
  it('publishes Demo Star Two name only (editorial): no label, no products, a rule cannot be turned on', async () => {
    const review = await inject('POST', `/v1/celebrities/${w.starTwo}/rights-review`, 'reviewer', {
      rights_status: 'editorial',
      evidence_ref: 'TEST-COUNSEL-EDITORIAL-2',
      note: 'TEST: name only, editorial',
    });
    expect(review.statusCode).toBe(200);
    const piece = String((await ctx.pool.query(`select id from look_pieces where look_id = $1`, [w.lookTwo])).rows[0]!.id);
    const tag = await inject('POST', '/v1/editorial/instant-links', 'editor', {
      asin_or_url: 'B0DEMO8001',
      brand: 'Demo Brand',
      model: 'Demo tote bag',
      category: 'Bags',
      property_ids: [ctx.net.props.fb],
      piece_id: piece,
    });
    expect(tag.statusCode).toBe(201);
    expect((await json(tag)).data.links_withheld).toMatch(/shoppable/);
    const pub = await inject('POST', `/v1/editorial/looks/${w.lookTwo}/transition`, 'editor', { to: 'published' });
    expect(pub.statusCode, pub.body).toBe(200);
    const look = (await publicLook(w.lookTwo)).body;
    expect(look.display).toMatchObject({ name: true, shoppable: false });
    expect(look.commercial_label).toBeNull();
    const hub = (await json(await inject('GET', '/v1/public/afflino/celebrities/demo-star-two'))).data;
    expect(hub.commercial_label).toBeNull();
    await ctx.pool.query(`update looks set platform_post_id = 'demo-post-two' where id = $1`, [w.lookTwo]);
    const rule = await inject('POST', '/v1/replies/rules', 'editor', { look_id: w.lookTwo, keywords: ['link'], enabled: true });
    expect(rule.statusCode).toBe(409);
    expect((await json(rule)).error.message).toMatch(/carries products/);
  });
});

describe('a street or other place needs the rights reviewer’s confirmation', () => {
  it('the gate refuses it until confirmed; any change to the place clears the confirmation', async () => {
    await ctx.pool.query(`update looks set status = 'draft' where id = $1`, [w.lookTwo]);
    expect((await inject('POST', `/v1/editorial/looks/${w.lookTwo}`, 'editor', { place_kind: 'street', place: 'Demo Linking Road' })).statusCode).toBe(200);
    const gate = async () => (await json(await inject('GET', `/v1/editorial/looks/${w.lookTwo}`, 'editor'))).data.gate.checks.find((c: { code: string }) => c.code === 'place_kind');
    expect(await gate()).toMatchObject({ ok: false });
    expect((await inject('POST', `/v1/editorial/looks/${w.lookTwo}/confirm-place`, 'editor', { note: 'TEST: a shopping street' })).statusCode).toBe(403);
    expect((await inject('POST', `/v1/editorial/looks/${w.lookTwo}/confirm-place`, 'reviewer', { note: 'TEST: a public shopping street' })).statusCode).toBe(200);
    expect(await gate()).toMatchObject({ ok: true });
    expect((await inject('POST', `/v1/editorial/looks/${w.lookTwo}`, 'editor', { place: 'Demo Linking Road, west end' })).statusCode).toBe(200);
    expect(await gate()).toMatchObject({ ok: false });
    await ctx.pool.query(`update looks set place_kind = 'airport', place = 'Demo City Airport' where id = $1`, [w.lookTwo]);
  });
});

describe('an added alias resets the review', () => {
  it('an editor adding another name as an alias sends a cleared celebrity back to unreviewed and pauses the links', async () => {
    expect(await activeLinks(w.lookOne)).toBeGreaterThan(0);
    const res = await inject('POST', `/v1/celebrities/${w.starOne}`, 'editor', { aliases: ['D. Star One', 'Demo Star Nine'] });
    expect(res.statusCode).toBe(200);
    expect((await json(res)).data).toMatchObject({ rights_status: 'unreviewed', max_display: 'none', shoppable: false });
    expect(await activeLinks(w.lookOne)).toBe(0);
    expect((await publicLook(w.lookOne)).status).toBe(404);
    const reviews = await ctx.pool.query(`select kind, note from celebrity_rights_reviews where celebrity_id = $1 order by reviewed_at desc limit 1`, [w.starOne]);
    expect(reviews.rows[0]).toMatchObject({ kind: 'rename' });
    const again = await inject('POST', `/v1/celebrities/${w.starOne}/rights-review`, 'reviewer', {
      rights_status: 'cleared',
      max_display: 'name_and_image',
      shoppable: true,
      evidence_ref: 'TEST-LICENCE-DEMO-STAR-ONE-2',
      note: 'TEST: the aliases confirmed',
    });
    expect(again.statusCode).toBe(200);
    expect(await activeLinks(w.lookOne)).toBeGreaterThan(0);
    expect((await publicLook(w.lookOne)).status).toBe(200);
  });
});

describe('takedowns', () => {
  let takedownId: string;
  let plainToken: string;
  let tokens: string[];
  it('a celebrity’s takedown withdraws other looks naming them, pauses the plain page links and lists the stills and share URLs', async () => {
    // A plain page link (no look item: as the Amazon CLI's link sheet mints) for a product of the look, on its page.
    const { mintLink } = await import('../src/links/mint.js');
    const { propertyPlacement } = await import('../src/looks/look-links.js');
    const offer = (await ctx.pool.query(`select o.id from offers o join variants v on v.id = o.variant_id where v.merchant_sku = 'B0DEMO0901'`)).rows[0]!.id as string;
    const placement = await propertyPlacement(ORG, ctx.net.props.ig, ctx.programmeId);
    plainToken = (await mintLink(ORG, { property_id: ctx.net.props.ig, programme_id: ctx.programmeId, offer_id: offer, placement_id: placement!.id })).token;
    // Demo Star Two's look names Demo Star One in its text (written directly, as drift would).
    await ctx.pool.query(`update looks set event_name = 'Demo Star One fan meet' where id = $1`, [w.lookTwo]);
    tokens = (await ctx.pool.query(`select l.token from links l join look_items li on li.id = l.look_item_id where li.look_id = $1 and l.status = 'active'`, [w.lookOne])).rows.map((r) => String(r.token));
    const res = await inject('POST', '/v1/takedowns', 'editor', { scope: 'celebrity', celebrity_id: w.starOne, reason_code: 'legal_notice', requester_ref: 'TEST-NOTICE-9' });
    expect(res.statusCode).toBe(201);
    const out = (await json(res)).data;
    takedownId = out.takedown.id;
    expect(out.looks_named_in_text).toEqual([w.lookTwo]);
    expect(out.looks_withdrawn).toBe(2);
    expect(out.other_links_paused).toBe(1);
    expect(out.stills.map((s: { look_id: string }) => s.look_id).sort()).toEqual([w.lookOne, w.lookTwo].sort());
    expect(out.share_urls).toEqual(expect.arrayContaining([`https://afflino.example.com/looks/${w.lookOne}`, 'https://afflino.example.com/c/demo-star-one', 'https://afflino.example.com/s/demo-afflino-ig']));
    const plain = await ctx.redirect.inject({ method: 'GET', url: `/r/${plainToken}`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
    expect(plain.statusCode).toBe(200);
    expect((await publicLook(w.lookOne)).status).toBe(410);
    expect((await inject('GET', `/v1/public/afflino/looks/${w.lookOne}/still`)).statusCode).toBe(410);
  });

  it('a restore under a review that allows no products brings the look back without its links', async () => {
    const review = await inject('POST', `/v1/celebrities/${w.starOne}/rights-review`, 'reviewer', {
      rights_status: 'cleared',
      max_display: 'name_and_image',
      shoppable: false,
      evidence_ref: 'TEST-COUNSEL-NO-PRODUCTS',
      note: 'TEST: name and image, no products',
    });
    expect(review.statusCode).toBe(200);
    const res = await inject('POST', `/v1/takedowns/${takedownId}/restore`, 'reviewer', { note: 'TEST: notice answered' });
    expect(res.statusCode).toBe(200);
    const out = (await json(res)).data;
    expect(out.looks).toEqual(expect.arrayContaining([{ look_id: w.lookOne, status: 'published', gate_ok: true, shoppable: false }]));
    expect(out.links_reactivated).toBe(0);
    expect(await activeLinks(w.lookOne)).toBe(0);
    const r = await ctx.redirect.inject({ method: 'GET', url: `/r/${tokens[0]}`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
    expect(r.statusCode).toBe(200);
    expect((await ctx.pool.query(`select paused_reason, paused_by_takedown_id from links where token = $1`, [tokens[0]])).rows[0]).toEqual({ paused_reason: 'rights_review', paused_by_takedown_id: null });
    expect((await publicLook(w.lookOne)).body.display.shoppable).toBe(false);
    // A later shoppable review brings the links back (never a takedown's own restore).
    const shop = await inject('POST', `/v1/celebrities/${w.starOne}/rights-review`, 'reviewer', {
      rights_status: 'cleared',
      max_display: 'name_and_image',
      shoppable: true,
      evidence_ref: 'TEST-LICENCE-DEMO-STAR-ONE-3',
      note: 'TEST: products allowed again',
    });
    expect(shop.statusCode).toBe(200);
    const back = await ctx.redirect.inject({ method: 'GET', url: `/r/${tokens[0]}`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toMatch(new RegExp(`tag=(${WEB_TAG}|demo-ig-21)$`));
  });
});

describe('the api’s own guards', () => {
  it('rate-limits the public reads per client (429 with Retry-After)', async () => {
    const guard = await import('../src/public-guard.js');
    const was = process.env.PUBLIC_RATE_PER_MINUTE;
    process.env.PUBLIC_RATE_PER_MINUTE = '3';
    guard.__resetRateLimiters();
    // A visitor: through the edge and the web's /api proxy, always with X-Forwarded-For.
    const visitor = { 'x-forwarded-for': '203.0.113.7' };
    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) codes.push((await ctx.app.inject({ method: 'GET', url: '/v1/public/afflino/spotted', headers: visitor })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
    const last = await ctx.app.inject({ method: 'GET', url: '/v1/public/afflino/spotted', headers: visitor });
    expect(last.headers['retry-after']).toMatch(/^\d+$/);
    expect((await json(last)).error.code).toBe('RATE_LIMITED');
    // The web's own server-side calls (no X-Forwarded-For, a loopback / private peer) are not counted:
    // limiting them would put every visitor in one bucket.
    const own: number[] = [];
    for (let i = 0; i < 5; i += 1) own.push((await inject('GET', '/v1/public/afflino/spotted')).statusCode);
    expect(own).toEqual([200, 200, 200, 200, 200]);
    // A direct caller from a public address without X-Forwarded-For is counted by its address.
    const direct: number[] = [];
    for (let i = 0; i < 4; i += 1) direct.push((await ctx.app.inject({ method: 'GET', url: '/v1/public/afflino/spotted', remoteAddress: '198.51.100.9' })).statusCode);
    expect(direct).toEqual([200, 200, 200, 429]);
    expect(guard.fromTheStack({ headers: {}, socket: { remoteAddress: '::ffff:172.18.0.5' } })).toBe(true);
    expect(guard.fromTheStack({ headers: { 'x-forwarded-for': '203.0.113.7' }, socket: { remoteAddress: '172.18.0.5' } })).toBe(false);
    expect(guard.fromTheStack({ headers: {}, socket: { remoteAddress: '198.51.100.9' } })).toBe(false);
    process.env.PUBLIC_RATE_PER_MINUTE = was;
    guard.__resetRateLimiters();
  });

  it('keeps public answers per URL under the invalidation epoch: a hit until any invalidation, then fresh', async () => {
    const guard = await import('../src/public-guard.js');
    const was = process.env.PUBLIC_API_CACHE;
    process.env.PUBLIC_API_CACHE = 'on';
    guard.__clearPublicCache();
    const a = await inject('GET', `/v1/public/afflino/looks/${w.lookOne}`);
    const b = await inject('GET', `/v1/public/afflino/looks/${w.lookOne}`);
    expect([a.headers['x-public-cache'], b.headers['x-public-cache']]).toEqual(['miss', 'hit']);
    const { invalidateAfterCommit } = await import('../src/looks/invalidate.js');
    await invalidateAfterCommit({ tokens: [], tags: [`look:${w.lookOne}`] });
    expect((await inject('GET', `/v1/public/afflino/looks/${w.lookOne}`)).headers['x-public-cache']).toBe('miss');
    process.env.PUBLIC_API_CACHE = was;
  });

  it('never logs a query string (Meta’s verify token travels in one)', async () => {
    const lines: string[] = [];
    const { buildApp } = await import('../src/index.js');
    const app = await buildApp({ logStream: { write: (l: string) => void lines.push(l) } });
    await app.ready();
    process.env.META_VERIFY_TOKEN = 'TEST-verify-token-0123456789';
    const res = await app.inject({ method: 'GET', url: '/v1/integrations/meta/webhook?hub.mode=subscribe&hub.verify_token=TEST-verify-token-0123456789&hub.challenge=abc123' });
    expect(res.statusCode).toBe(200);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('TEST-verify-token-0123456789');
    expect(lines.join('\n')).toContain('/v1/integrations/meta/webhook');
    delete process.env.META_VERIFY_TOKEN;
    await app.close();
  });

  it('sends a revalidation of thousands of tags in batches the web accepts', async () => {
    const inv = await import('../src/looks/invalidate.js');
    const got: number[] = [];
    process.env.WEB_REVALIDATE_URL = 'http://web.test/internal/revalidate';
    process.env.WEB_REVALIDATE_SECRET = 'TEST-revalidate-secret-000';
    inv.__setRevalidateFetch(async (_u, init) => {
      got.push((JSON.parse(init.body) as { tags: string[] }).tags.length);
      return { status: 200, ok: true };
    });
    const tags = Array.from({ length: 2500 }, (_, i) => `look:00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const out = await inv.revalidateWeb(tags);
    expect(got).toEqual([1000, 1000, 500]);
    expect(out).toMatchObject({ attempted: true, ok: true, batches: 3 });
    inv.__setRevalidateFetch(null);
    delete process.env.WEB_REVALIDATE_URL;
    delete process.env.WEB_REVALIDATE_SECRET;
  });

  it('the organisation’s click and reply analytics are the network’s operators’ only', async () => {
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    expect((await inject('GET', `/v1/analytics/clicks?from=${today}&to=${today}`, 'owner')).statusCode).toBe(403);
    expect((await inject('GET', `/v1/analytics/replies?from=${today}&to=${today}`, 'owner')).statusCode).toBe(403);
    expect((await inject('GET', `/v1/analytics/clicks?from=${today}&to=${today}&group_by=celebrity`, 'editor')).statusCode).toBe(200);
  });

  it('Meta’s data deletion callback: a signed request deletes that person’s reply events; a bad signature is 401', async () => {
    process.env.META_APP_SECRET = 'TEST-meta-app-secret-0000000000';
    process.env.COMMENT_ID_HASH_KEY = 'TEST-comment-hash-key-00000000000000';
    await ctx.pool.query(`insert into meta_accounts (org_id, property_id, platform, meta_account_id) values ($1, $2, 'instagram', '17841400000000001')`, [ORG, ctx.net.props.fb]);
    const { commenterHash } = await import('../src/looks/replies.js');
    const hash = commenterHash(process.env.COMMENT_ID_HASH_KEY, 'instagram', '17841400000000001', '5550001');
    const rule = (
      await ctx.pool.query(`insert into reply_rules (org_id, look_id, property_id, platform_post_id, keywords) values ($1, $2, $3, 'demo-post-del', '{link}') returning id`, [ORG, w.lookOne, ctx.net.props.fb])
    ).rows[0]!.id;
    await ctx.pool.query(
      `insert into reply_events (org_id, rule_id, property_id, platform, meta_account_id, comment_id, commenter_hash, matched_keyword) values ($1, $2, $3, 'instagram', '17841400000000001', 'demo-c-del', $4, 'link')`,
      [ORG, rule, ctx.net.props.fb, hash],
    );
    const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payload = b64(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '5550001', issued_at: Math.floor(Date.now() / 1000) }));
    const sig = b64(createHmac('sha256', process.env.META_APP_SECRET).update(payload).digest());
    const post = (signed: string) =>
      ctx.app.inject({ method: 'POST', url: '/v1/integrations/meta/data-deletion', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `signed_request=${encodeURIComponent(signed)}` });
    expect((await post(`${sig.slice(0, -2)}AA.${payload}`)).statusCode).toBe(401);
    const res = await post(`${sig}.${payload}`);
    expect(res.statusCode).toBe(200);
    const body = await json(res);
    expect(body).toEqual({ url: 'https://afflino.example.com/privacy#data-deletion', confirmation_code: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect((await ctx.pool.query(`select count(*) as n from reply_events where comment_id = 'demo-c-del'`)).rows[0]!.n).toBe(0);
    delete process.env.META_APP_SECRET;
    delete process.env.COMMENT_ID_HASH_KEY;
  });
});

describe('a minor flag through the library import pauses the links at once', () => {
  it('re-importing with celebrity_minor=yes: unreviewed, the page 404, every link paused, the redirect on its paused page', async () => {
    expect(await activeLinks(w.lookOne)).toBeGreaterThan(0);
    const token = String(
      (await ctx.pool.query(`select l.token from links l join look_items li on li.id = l.look_item_id where li.look_id = $1 and l.status = 'active' limit 1`, [w.lookOne])).rows[0]!.token,
    );
    const { importLibrary } = await import('../src/looks/library-import.js');
    const minor = libraryFixture().replace(/Demo Star One,D\. Star One,no,/g, 'Demo Star One,D. Star One,yes,');
    const summary = await importLibrary({ orgSlug: 'afflino', text: minor, actorId: null });
    expect(summary.celebrities_flagged_minor).toBe(1);
    expect(summary.links_paused).toBeGreaterThan(0);
    expect(await activeLinks(w.lookOne)).toBe(0);
    expect((await publicLook(w.lookOne)).status).toBe(404);
    const r = await ctx.redirect.inject({ method: 'GET', url: `/r/${token}`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
    expect(r.statusCode).toBe(200);
  });
});

afterAll(async () => {
  await ctx.app.close();
  await ctx.redirect.close();
});
