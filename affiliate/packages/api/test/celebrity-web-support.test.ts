// The endpoints the web's celebrity pages and operator screens read (stage 2):
// the Spotted feed's facets, the trending row from the click rollups, the
// in-house pages list, the library check / import from the admin, the latest
// comment-reply events without personal data, and every rule's exact DM
// preview. pg-mem; TEST data only ("Demo Star …", *.example.com).

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_celebrity_web';
process.env.JWT_SECRET ??= 'celebrity-web-test-secret';
process.env.API_PORT ??= '0';
process.env.REDIRECT_PORT ??= '0';
process.env.REDIRECT_BASE_URL = 'https://afflino.example.com';
process.env.SITE_URL = 'https://afflino.example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { AMZ } from './amazon-fixtures.js';
import { json, libraryFixture, publishDemoStarOne, setupCelebrityWorld, WEB_TAG, type CelebCtx, type PublishedLook } from './celebrity-fixtures.js';

const ORG = 'abababab-abab-abab-abab-abababababab';

let ctx: CelebCtx;
let w: PublishedLook;

async function inject(method: 'GET' | 'POST', url: string, who?: Parameters<CelebCtx['as']>[0], payload?: unknown) {
  return ctx.app.inject({ method, url, headers: who ? ctx.as(who) : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
}

function istDay(offsetDays = 0): string {
  return new Date(Date.now() + 330 * 60_000 - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  ctx = await setupCelebrityWorld({ orgId: ORG });
}, 60000);

describe('the library check and import from the admin', () => {
  it('a dry run of the TEST fixture writes nothing and names who is new', async () => {
    const res = await inject('POST', '/v1/editorial/library/import', 'editor', { csv_text: libraryFixture() });
    expect(res.statusCode).toBe(200);
    const d = (await json(res)).data;
    expect(d).toMatchObject({ dry_run: true, ok: true, problems: [], rows: 4, looks: 2, looks_new: 2, looks_existing: 0, pieces: 4 });
    expect(d.celebrities).toEqual([
      { name: 'Demo Star One', known: false, rights_status: null, looks: 1 },
      { name: 'Demo Star Two', known: false, rights_status: null, looks: 1 },
    ]);
    expect(Number((await ctx.pool.query(`select count(*) as n from looks where celebrity_id is not null`)).rows[0]!.n)).toBe(0);
    expect(Number((await ctx.pool.query(`select count(*) as n from celebrities`)).rows[0]!.n)).toBe(0);
  });

  it('a file with a problem is refused by the check and by the import, and nothing is written', async () => {
    const broken = libraryFixture().replace('TEST staff footage,yes,IN,2027-12-31', ',yes,IN,2027-12-31');
    const check = (await json(await inject('POST', '/v1/editorial/library/import', 'editor', { csv_text: broken }))).data;
    expect(check.ok).toBe(false);
    expect(check.problems.join(' ')).toMatch(/licence/);
    const res = await inject('POST', '/v1/editorial/library/import', 'editor', { csv_text: broken, dry_run: false });
    expect(res.statusCode).toBe(422);
    const body = await json(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.problems.join(' ')).toMatch(/licence/);
    expect(Number((await ctx.pool.query(`select count(*) as n from looks where celebrity_id is not null`)).rows[0]!.n)).toBe(0);
  });

  it('only editors import; the read-only analyst and the rights reviewer may not', async () => {
    expect((await inject('POST', '/v1/editorial/library/import', 'analyst', { csv_text: libraryFixture() })).statusCode).toBe(403);
    expect((await inject('POST', '/v1/editorial/library/import', 'reviewer', { csv_text: libraryFixture() })).statusCode).toBe(403);
  });

  it('imports drafts with unreviewed celebrities, and a second run changes nothing', async () => {
    const first = (await json(await inject('POST', '/v1/editorial/library/import', 'editor', { csv_text: libraryFixture(), dry_run: false }))).data;
    expect(first).toMatchObject({ dry_run: false, ok: true });
    expect(first.summary).toMatchObject({ looks_created: 2, celebrities_created: 2, pieces_created: 4 });
    const again = (await json(await inject('POST', '/v1/editorial/library/import', 'editor', { csv_text: libraryFixture(), dry_run: false }))).data;
    expect(again.summary).toMatchObject({ looks_created: 0, looks_unchanged: 2, celebrities_created: 0, pieces_created: 0 });
    const check = (await json(await inject('POST', '/v1/editorial/library/import', 'editor', { csv_text: libraryFixture() }))).data;
    expect(check).toMatchObject({ ok: true, looks_new: 0, looks_existing: 2 });
    expect(check.celebrities.map((c: { known: boolean; rights_status: string }) => [c.known, c.rights_status])).toEqual([
      [true, 'unreviewed'],
      [true, 'unreviewed'],
    ]);
    const statuses = (await ctx.pool.query(`select status from looks where celebrity_id is not null`)).rows.map((r) => r.status);
    expect(statuses).toEqual(['draft', 'draft']);
  });
});

describe('the in-house pages list', () => {
  it('lists the Facebook, Instagram and web properties with owner-operated flags and their tracking IDs', async () => {
    const res = await inject('GET', '/v1/editorial/properties', 'editor');
    expect(res.statusCode).toBe(200);
    const items = (await json(res)).data.items as Array<{ id: string; platform: string; owner_operated: boolean; amazon_tracking_id: string | null }>;
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get(ctx.net.props.ig)).toMatchObject({ platform: 'instagram', owner_operated: true, amazon_tracking_id: AMZ.IG_TAG });
    expect(byId.get(ctx.net.props.fb)).toMatchObject({ platform: 'facebook', owner_operated: true, amazon_tracking_id: AMZ.FB_TAG });
    expect(items.some((i) => i.platform === 'web' && i.amazon_tracking_id === WEB_TAG)).toBe(true);
    expect(items.every((i) => ['facebook', 'instagram', 'web'].includes(i.platform))).toBe(true);
    expect((await inject('GET', '/v1/editorial/properties', 'analyst')).statusCode).toBe(403);
  });
});

describe('the Spotted facets and the trending row', () => {
  beforeAll(async () => {
    // The pieces of the imported look get products and the look is published (Demo Star One cleared).
    w = await publishDemoStarOne(ctx);
  }, 60000);

  it('facets name only the celebrities and live storefronts with public looks', async () => {
    const before = (await json(await inject('GET', '/v1/public/afflino/spotted'))).data;
    expect(before.facets.celebrities).toEqual([{ slug: 'demo-star-one', name: 'Demo Star One', looks: 1 }]);
    expect(before.facets.storefronts).toEqual([]);
    const sf = await inject('POST', '/v1/editorial/storefronts', 'editor', { property_id: ctx.net.props.ig, slug: 'demo-ig-page', display_name: 'Demo IG page', status: 'live' });
    expect(sf.statusCode).toBe(201);
    const after = (await json(await inject('GET', '/v1/public/afflino/spotted'))).data;
    expect(after.facets.storefronts).toEqual([{ slug: 'demo-ig-page', name: 'Demo IG page', looks: 1 }]);
    expect(JSON.stringify(after)).not.toContain('Demo Star Two');
  });

  it('trending is empty without clicks, ranks the look once the rollup has clicks, and never shows the counts', async () => {
    const empty = await inject('GET', '/v1/public/afflino/trending');
    expect(empty.statusCode).toBe(200);
    expect(empty.headers['cache-control']).toBe('public, max-age=30');
    expect((await json(empty)).data.items).toEqual([]);
    const link = (await ctx.pool.query(`select l.id from links l join look_items li on li.id = l.look_item_id where li.look_id = $1 limit 1`, [w.lookOne])).rows[0]!;
    await ctx.pool.query(`insert into click_daily (org_id, day, link_id, via, clicks) values ($1, $2::date, $3, '', 5)`, [ORG, istDay(1), link.id]);
    await ctx.pool.query(`insert into click_daily (org_id, day, link_id, via, clicks) values ($1, $2::date, $3, '', 7)`, [ORG, istDay(20), link.id]);
    const data = (await json(await inject('GET', '/v1/public/afflino/trending?days=7'))).data;
    expect(data.items.map((i: { id: string }) => i.id)).toEqual([w.lookOne]);
    expect(data.items[0].headline).toBe('Spotted at Demo Film Premiere');
    expect(JSON.stringify(data)).not.toMatch(/"clicks"/);
    expect((await inject('GET', '/v1/public/afflino/trending?days=31')).statusCode).toBe(400);
    expect((await inject('GET', '/v1/public/afflino/trending?limit=13')).statusCode).toBe(400);
  });

  it('a takedown empties the trending row and the facets at once', async () => {
    const td = await inject('POST', '/v1/takedowns', 'editor', { scope: 'look', look_id: w.lookOne, reason_code: 'operator_error' });
    expect(td.statusCode).toBe(201);
    expect((await json(await inject('GET', '/v1/public/afflino/trending'))).data.items).toEqual([]);
    const feed = (await json(await inject('GET', '/v1/public/afflino/spotted'))).data;
    expect(feed.facets).toEqual({ celebrities: [], storefronts: [] });
    const tdId = (await json(td)).data.takedown.id as string;
    // Restore (a new review, then the rights reviewer's restore) so the reply tests below have a public look.
    await inject('POST', `/v1/celebrities/${w.starOne}/rights-review`, 'reviewer', {
      rights_status: 'cleared',
      max_display: 'name_and_image',
      shoppable: true,
      evidence_ref: 'TEST-LICENCE-DEMO-STAR-ONE-2',
      note: 'TEST: reviewed again after the takedown',
    });
    const restored = await inject('POST', `/v1/takedowns/${tdId}/restore`, 'reviewer', { note: 'TEST: operator error' });
    expect(restored.statusCode).toBe(200);
    expect((await json(await inject('GET', '/v1/public/afflino/trending'))).data.items.map((i: { id: string }) => i.id)).toEqual([w.lookOne]);
  });
});

describe('comment replies: the DM preview and the latest events', () => {
  let ruleId: string;

  it('every rule carries its look URL and the exact message, with no tracked or merchant link', async () => {
    const res = await inject('POST', '/v1/replies/rules', 'editor', { look_id: w.lookOne, keywords: ['LINK', 'Price'] });
    expect(res.statusCode).toBe(201);
    const rule = (await json(res)).data;
    ruleId = rule.id;
    expect(rule.look_url).toBe(`https://afflino.example.com/looks/${w.lookOne}`);
    expect(rule.dm_preview).toContain(rule.look_url);
    expect(rule.dm_preview).toMatch(/^Ad · /);
    expect(rule.dm_preview).toContain('Reply STOP');
    expect(rule.dm_preview).not.toMatch(/\/r\/|amazon|Demo Star/i);
    expect(rule.dm_bytes).toBeLessThanOrEqual(1000);
    expect(rule.dm_refusal).toBeNull();
    const list = (await json(await inject('GET', `/v1/replies/rules?look_id=${w.lookOne}`, 'editor'))).data.items;
    expect(list[0].dm_preview).toBe(rule.dm_preview);
    const upd = (await json(await inject('POST', `/v1/replies/rules/${ruleId}`, 'editor', { keywords: ['shop'] }))).data;
    expect(upd.dm_preview).toBe(rule.dm_preview);
  });

  it('a site origin that is not https makes the preview null with the reason', async () => {
    const saved = process.env.SITE_URL;
    process.env.SITE_URL = 'http://afflino.example.com';
    try {
      const list = (await json(await inject('GET', '/v1/replies/rules', 'editor'))).data.items;
      expect(list[0]).toMatchObject({ dm_preview: null, dm_bytes: null, dm_refusal: 'site_origin_not_https' });
    } finally {
      process.env.SITE_URL = saved;
    }
  });

  it('the latest events carry no comment id, commenter hash, media id or message id', async () => {
    for (const [i, status] of (['queued', 'sent', 'skipped_suppressed'] as const).entries()) {
      await ctx.pool.query(
        `insert into reply_events (org_id, rule_id, property_id, platform, meta_account_id, comment_id, media_id, commenter_hash, matched_keyword, status, message_id, received_at)
         values ($1, $2, $3, 'instagram', '17800000000000001', $4, '17900000000000001', $5, 'shop', $6, $7, $8::timestamptz)`,
        [ORG, ruleId, ctx.net.props.ig, `1799000000000000${i}`, 'a'.repeat(63) + String(i), status, status === 'sent' ? 'mid.demo' : null, new Date(Date.now() - i * 60_000).toISOString()],
      );
    }
    const res = await inject('GET', '/v1/replies/events?limit=10', 'editor');
    expect(res.statusCode).toBe(200);
    const items = (await json(res)).data.items as Array<Record<string, unknown>>;
    expect(items.map((e) => e.status)).toEqual(['queued', 'sent', 'skipped_suppressed']);
    expect(items[0]).toMatchObject({ rule_id: ruleId, look_id: w.lookOne, platform: 'instagram', account: 'demo.afflino', matched_keyword: 'shop', attempts: 0 });
    const text = JSON.stringify(items);
    for (const bad of ['comment_id', 'commenter_hash', 'media_id', 'message_id', '17990000000000000', 'mid.demo', 'aaaaaaaa']) expect(text).not.toContain(bad);
    const sent = (await json(await inject('GET', '/v1/replies/events?status=sent', 'editor'))).data.items;
    expect(sent).toHaveLength(1);
    expect((await inject('GET', '/v1/replies/events', 'analyst')).statusCode).toBe(403);
    expect((await inject('GET', '/v1/replies/events?status=nope', 'editor')).statusCode).toBe(400);
  });
});
