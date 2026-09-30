// Takedowns on pg-mem: a celebrity takedown withdraws every look at once —
// 410 on the look page and the hub, gone from the feed, the storefront and
// the sitemap, links paused (the redirect serves the paused page), the route
// cache deleted twice, the web revalidated, comment-reply rules off and
// queued replies cancelled — with audit rows and the SLA timestamps; a
// restore needs the rights reviewer AND a new review. TEST data only.

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_takedowns';
process.env.JWT_SECRET ??= 'takedowns-test-secret';
process.env.API_PORT ??= '0';
process.env.REDIRECT_PORT ??= '0';
process.env.REDIRECT_BASE_URL = 'https://afflino.example.com';
process.env.SITE_URL = 'https://afflino.example.com';
process.env.WEB_REVALIDATE_URL = 'http://web.internal.example.com/internal/revalidate';
process.env.WEB_REVALIDATE_SECRET = 'demo-revalidate-secret-0000000000000000';

import { beforeAll, describe, expect, it } from 'vitest';
import { json, publishDemoStarOne, setupCelebrityWorld, type CelebCtx, type PublishedLook } from './celebrity-fixtures.js';

const ORG = 'aaaa1111-aaaa-1111-aaaa-111111111111';
let ctx: CelebCtx;
let w: PublishedLook;
let tokens: string[];
let takedownId: string;
const revalidated: Array<{ tags: string[]; secret: string | undefined }> = [];

async function inject(method: 'GET' | 'POST', url: string, who?: Parameters<CelebCtx['as']>[0], payload?: unknown) {
  return ctx.app.inject({ method, url, headers: who ? ctx.as(who) : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
}

beforeAll(async () => {
  ctx = await setupCelebrityWorld({ orgId: ORG });
  const inv = await import('../src/looks/invalidate.js');
  inv.__setRevalidateFetch(async (_url, init) => {
    revalidated.push({ tags: (JSON.parse(init.body) as { tags: string[] }).tags, secret: init.headers['x-revalidate-secret'] });
    return { status: 200, ok: true };
  });
  w = await publishDemoStarOne(ctx);
  // A live storefront, a mapped Instagram account, an enabled reply rule and a queued reply.
  const sf = await inject('POST', '/v1/editorial/storefronts', 'editor', { property_id: ctx.net.props.ig, slug: 'demo-ig', display_name: 'Demo IG', status: 'live' });
  expect(sf.statusCode).toBe(201);
  await inject('POST', '/v1/replies/accounts', 'editor', { property_id: ctx.net.props.ig, meta_account_id: '17841400000000001', linked_page_id: '100000000000001' });
  const rule = await inject('POST', '/v1/replies/rules', 'editor', { look_id: w.lookOne, keywords: ['link'], enabled: true });
  expect(rule.statusCode).toBe(201);
  const ruleId = (await json(rule)).data.id;
  await ctx.pool.query(
    `insert into reply_events (org_id, rule_id, property_id, platform, meta_account_id, comment_id, commenter_hash, matched_keyword)
     values ($1, $2, $3, 'instagram', '17841400000000001', 'demo-comment-queued', $4, 'link')`,
    [ORG, ruleId, ctx.net.props.ig, 'a'.repeat(64)],
  );
  tokens = (
    await ctx.pool.query(
      `select l.token from links l join look_items li on li.id = l.look_item_id where li.look_id = $1 and l.status = 'active' order by l.token`,
      [w.lookOne],
    )
  ).rows.map((r) => String(r.token));
  expect(tokens.length).toBeGreaterThanOrEqual(3);
  for (const t of tokens) ctx.redis.store.set(`route:${t}`, '{"cached":true}');
  // Everything is public before the takedown.
  expect((await inject('GET', `/v1/public/afflino/looks/${w.lookOne}`)).statusCode).toBe(200);
  expect((await inject('GET', '/v1/public/afflino/celebrities/demo-star-one')).statusCode).toBe(200);
}, 60000);

describe('celebrity takedown', () => {
  it('withdraws every look in one call, with counts, the posts to delete and the SLA timestamps', async () => {
    const requestedAt = new Date(Date.now() - 40 * 60_000).toISOString();
    const res = await inject('POST', '/v1/takedowns', 'editor', {
      scope: 'celebrity',
      celebrity_id: w.starOne,
      reason_code: 'rights_holder_request',
      requester_ref: 'TEST-NOTICE-0001',
      requested_at: requestedAt,
    });
    expect(res.statusCode).toBe(201);
    const out = (await json(res)).data;
    takedownId = out.takedown.id;
    expect(out).toMatchObject({ created: true, looks_withdrawn: 1, links_paused: tokens.length, rules_disabled: 1, replies_cancelled: 1 });
    expect(out.takedown).toMatchObject({ scope: 'celebrity', status: 'active', requester_ref: 'TEST-NOTICE-0001', sla: 'ok' });
    expect(out.takedown.requested_at).toBe(requestedAt);
    expect(out.takedown.actioned_at).not.toBeNull();
    expect(out.takedown.completed_at).not.toBeNull();
    expect(out.takedown.minutes_to_action).toBeGreaterThanOrEqual(39);
    expect(out.posts_to_delete).toEqual([
      expect.objectContaining({ look_id: w.lookOne, platform: 'instagram', account: 'demo.afflino', post_permalink: 'https://instagram.example.com/p/demo-0001' }),
    ]);
    expect(out.invalidation.web).toMatchObject({ attempted: true, ok: true });
  });

  it('answers 410 on the look and the hub; the feed, storefront and sitemap no longer list it', async () => {
    const look = await inject('GET', `/v1/public/afflino/looks/${w.lookOne}`);
    expect(look.statusCode).toBe(410);
    expect((await json(look)).error.code).toBe('GONE');
    expect(look.body).not.toContain('Demo Star One');
    expect((await inject('GET', '/v1/public/afflino/celebrities/demo-star-one')).statusCode).toBe(410);
    expect((await json(await inject('GET', '/v1/public/afflino/spotted'))).data.total).toBe(0);
    expect((await json(await inject('GET', '/v1/public/afflino/spotted?celebrity=demo-star-one'))).data.items).toEqual([]);
    const sf = (await json(await inject('GET', '/v1/public/afflino/storefronts/demo-ig'))).data;
    expect(sf.looks.items).toEqual([]);
    const sitemap = (await json(await inject('GET', '/v1/public/afflino/sitemap'))).data;
    expect(sitemap.looks).toEqual([]);
    expect(sitemap.celebrities).toEqual([]);
    expect((await inject('GET', `/v1/looks/${w.lookOne}`, 'analyst')).statusCode).toBe(404);
  });

  it('pauses every link: the redirect serves the paused page, and the route cache was deleted twice', async () => {
    const { __lastRouteCacheSecondDelete } = await import('../src/routes/programmes.js');
    await __lastRouteCacheSecondDelete();
    const keys = tokens.map((t) => `route:${t}`).sort();
    const deletes = ctx.redis.deleted.filter((d) => d.some((k) => keys.includes(k)));
    expect(deletes.length).toBeGreaterThanOrEqual(2);
    expect([...deletes[deletes.length - 1]!].sort()).toEqual(keys);
    for (const t of tokens) {
      const r = await ctx.redirect.inject({ method: 'GET', url: `/r/${t}`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain('This link is paused');
      expect(r.headers.location).toBeUndefined();
    }
    const clicks = await ctx.pool.query(`select count(*)::int as n from clicks where org_id = $1`, [ORG]);
    expect(clicks.rows[0]!.n).toBe(0);
  });

  it('revalidates the web caches of the look, the hub, the storefront, the feed and the sitemap, with the secret', async () => {
    const last = revalidated.find((r) => r.tags.includes(`look:${w.lookOne}`) && r.tags.includes('celebrity:demo-star-one') && r.tags.includes('storefront:demo-ig'));
    expect(last).toBeDefined();
    expect(last!.tags).toEqual(expect.arrayContaining(['spotted', 'sitemap', 'storefront:demo-ig']));
    expect(last!.secret).toBe('demo-revalidate-secret-0000000000000000');
  });

  it('turns the comment replies off and cancels the queued one; nothing can re-enable them meanwhile', async () => {
    const ev = await ctx.pool.query(`select status, error_code from reply_events where comment_id = 'demo-comment-queued'`);
    expect(ev.rows[0]).toMatchObject({ status: 'skipped_disabled', error_code: 'takedown' });
    const rules = (await json(await inject('GET', `/v1/replies/rules?look_id=${w.lookOne}`, 'editor'))).data.items;
    expect(rules[0]).toMatchObject({ enabled: false, disabled_by_takedown_id: takedownId });
    const again = await inject('POST', `/v1/replies/rules/${rules[0].id}`, 'editor', { enabled: true });
    expect(again.statusCode).toBe(410);
  });

  it('blocks every way back in: publishing, editing, tagging, new links', async () => {
    expect((await inject('POST', `/v1/editorial/looks/${w.lookOne}/transition`, 'editor', { to: 'published' })).statusCode).toBe(410);
    expect((await inject('POST', `/v1/editorial/looks/${w.lookOne}`, 'editor', { event_name: 'Demo Other Event' })).statusCode).toBe(410);
    const tag = await inject('POST', '/v1/editorial/instant-links', 'editor', {
      asin_or_url: 'B0DEMO0999',
      brand: 'Demo Brand',
      model: 'Demo Scarf',
      category: 'Clothing',
      property_ids: [ctx.net.props.ig],
      piece_id: w.pieces[0]!.id,
    });
    expect(tag.statusCode).toBe(410);
    const { mintItemLink } = await import('../src/looks/look-links.js');
    const item = await ctx.pool.query(`select li.id, o.id as offer_id from look_items li join offers o on o.variant_id = li.variant_id where li.look_id = $1 limit 1`, [w.lookOne]);
    const placement = await ctx.pool.query(
      `select pl.id from placements pl join campaigns ca on ca.id = pl.campaign_id where pl.property_id = $1 and ca.programme_id = $2`,
      [ctx.net.props.ig, ctx.programmeId],
    );
    await expect(
      mintItemLink(
        ORG,
        w.lookOne,
        { property_id: ctx.net.props.ig, programme_id: ctx.programmeId, offer_id: String(item.rows[0]!.offer_id), placement_id: String(placement.rows[0]!.id), look_item_id: String(item.rows[0]!.id) },
        { requirePublished: false },
      ),
    ).rejects.toMatchObject({ code: 'GONE' });
  });

  it('is recorded: audit rows (action, per look, completed), an outbox event, the snapshot; a second pull returns the same takedown', async () => {
    const audit = await ctx.pool.query(`select action, entity_id from audit_log where org_id = $1 and action like 'takedown.%' order by created_at`, [ORG]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['takedown.action', 'takedown.completed']));
    const perLook = await ctx.pool.query(`select count(*)::int as n from audit_log where org_id = $1 and action = 'look.withdrawn' and entity_id = $2`, [ORG, w.lookOne]);
    expect(perLook.rows[0]!.n).toBe(1);
    const outbox = await ctx.pool.query(`select count(*)::int as n from outbox where org_id = $1 and event_type = 'takedown.actioned'`, [ORG]);
    expect(outbox.rows[0]!.n).toBe(1);
    const snap = await ctx.pool.query(`select previous_status from takedown_looks where takedown_id = $1`, [takedownId]);
    expect(snap.rows.map((r) => r.previous_status)).toEqual(['published']);
    const again = await inject('POST', '/v1/takedowns', 'editor', { scope: 'celebrity', celebrity_id: w.starOne, reason_code: 'legal_notice' });
    expect(again.statusCode).toBe(200);
    expect((await json(again)).data).toMatchObject({ created: false, takedown: { id: takedownId } });
    const list = (await json(await inject('GET', '/v1/takedowns?status=active', 'reviewer'))).data.items;
    expect(list.map((t: { id: string }) => t.id)).toEqual([takedownId]);
  });

  it('records the owner’s confirmation that the in-house post was deleted', async () => {
    const res = await inject('POST', `/v1/takedowns/${takedownId}/posts-removed`, 'editor', { look_ids: [w.lookOne] });
    expect((await json(res)).data.marked).toBe(1);
    const td = (await json(await inject('GET', `/v1/takedowns/${takedownId}`, 'editor'))).data;
    expect(td.looks[0].post_removed_at).not.toBeNull();
  });
});

describe('restore', () => {
  it('only the rights reviewer, and only after a new rights review', async () => {
    expect((await inject('POST', `/v1/takedowns/${takedownId}/restore`, 'admin', { note: 'TEST: lifted' })).statusCode).toBe(403);
    const early = await inject('POST', `/v1/takedowns/${takedownId}/restore`, 'reviewer', { note: 'TEST: lifted' });
    expect(early.statusCode).toBe(409);
    expect((await json(early)).error.message).toMatch(/new rights review/);
  });

  it('after the review: the look is published again, its links active, its pages 200; the rules stay off', async () => {
    const review = await inject('POST', `/v1/celebrities/${w.starOne}/rights-review`, 'reviewer', {
      rights_status: 'cleared',
      max_display: 'name_and_image',
      shoppable: true,
      evidence_ref: 'TEST-COUNSEL-RESTORE-1',
      note: 'TEST: the notice was withdrawn by the rights holder',
    });
    expect(review.statusCode).toBe(200);
    const res = await inject('POST', `/v1/takedowns/${takedownId}/restore`, 'reviewer', { note: 'TEST: notice withdrawn' });
    expect(res.statusCode).toBe(200);
    const out = (await json(res)).data;
    expect(out.takedown).toMatchObject({ status: 'restored', restore_note: 'TEST: notice withdrawn' });
    expect(out.looks).toEqual([{ look_id: w.lookOne, status: 'published', gate_ok: true, shoppable: true }]);
    expect(out.links_reactivated).toBe(tokens.length);
    expect((await inject('GET', `/v1/public/afflino/looks/${w.lookOne}`)).statusCode).toBe(200);
    expect((await inject('GET', '/v1/public/afflino/celebrities/demo-star-one')).statusCode).toBe(200);
    const r = await ctx.redirect.inject({ method: 'GET', url: `/r/${tokens[0]}`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
    expect(r.statusCode).toBe(302);
    const rules = (await json(await inject('GET', `/v1/replies/rules?look_id=${w.lookOne}`, 'editor'))).data.items;
    expect(rules[0].enabled).toBe(false);
    const on = await inject('POST', `/v1/replies/rules/${rules[0].id}`, 'editor', { enabled: true });
    expect(on.statusCode).toBe(200);
    expect((await inject('POST', `/v1/takedowns/${takedownId}/restore`, 'reviewer', { note: 'again' })).statusCode).toBe(409);
  });
});

describe('look takedown', () => {
  it('withdraws one look only (the celebrity’s other looks stay); a look that was never public stays a 404', async () => {
    const res = await inject('POST', '/v1/takedowns', 'reviewer', { scope: 'look', look_id: w.lookTwo, reason_code: 'licence_expired' });
    expect(res.statusCode).toBe(201);
    const out = (await json(res)).data;
    expect(out.looks_withdrawn).toBe(1);
    // Demo Star Two's look was a draft: a 410 would tell anyone probing that it exists and a notice arrived.
    expect((await inject('GET', `/v1/public/afflino/looks/${w.lookTwo}`)).statusCode).toBe(404);
    expect((await inject('GET', '/v1/public/afflino/celebrities/demo-star-two')).statusCode).toBe(404);
    expect((await inject('GET', `/v1/public/afflino/looks/${w.lookOne}`)).statusCode).toBe(200);
    const two = await ctx.pool.query(`select status, takedown_id from looks where id = $1`, [w.lookTwo]);
    expect(two.rows[0]).toMatchObject({ status: 'withdrawn', takedown_id: out.takedown.id });
    // Restoring needs a review of Demo Star Two newer than the takedown.
    expect((await inject('POST', `/v1/takedowns/${out.takedown.id}/restore`, 'reviewer', { note: 'TEST: licence renewed' })).statusCode).toBe(409);
    await inject('POST', `/v1/celebrities/${w.starTwo}/rights-review`, 'reviewer', { rights_status: 'blocked', note: 'TEST: hold' });
    const restored = await inject('POST', `/v1/takedowns/${out.takedown.id}/restore`, 'reviewer', { note: 'TEST: licence renewed' });
    expect(restored.statusCode).toBe(200);
    // It was a draft: it goes back to draft, and stays out of every public page (blocked).
    expect((await json(restored)).data.looks).toEqual([{ look_id: w.lookTwo, status: 'draft', gate_ok: null, shoppable: false }]);
    expect((await inject('GET', `/v1/public/afflino/looks/${w.lookTwo}`)).statusCode).toBe(404);
  });

  it('refuses a malformed takedown', async () => {
    expect((await inject('POST', '/v1/takedowns', 'editor', { scope: 'look', celebrity_id: w.starOne, reason_code: 'other' })).statusCode).toBe(400);
    expect((await inject('POST', '/v1/takedowns', 'editor', { scope: 'celebrity', celebrity_id: w.starOne, reason_code: 'because' })).statusCode).toBe(400);
    expect((await inject('POST', '/v1/takedowns', 'analyst', { scope: 'celebrity', celebrity_id: w.starOne, reason_code: 'other' })).statusCode).toBe(403);
  });
});
