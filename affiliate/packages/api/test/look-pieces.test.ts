// Outfit pieces and product tagging on pg-mem: the garment categories equal
// the migration's CHECK; hotspots; the database's own checks behind EXACT
// (evidence, a reviewer other than the tagger) even when the API is
// bypassed; downgrade and reject; what may change on a published look;
// removing a product pauses its links; the editors' view; the analytics
// endpoints over the daily rollups. TEST data only.

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_look_pieces';
process.env.JWT_SECRET ??= 'look-pieces-test-secret';
process.env.API_PORT ??= '0';
process.env.REDIRECT_PORT ??= '0';
process.env.REDIRECT_BASE_URL = 'https://afflino.example.com';
process.env.SITE_URL = 'https://afflino.example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GARMENT_CATEGORIES } from '@paparazzi/shared';
import { json, publishDemoStarOne, setupCelebrityWorld, type CelebCtx, type PublishedLook } from './celebrity-fixtures.js';

const ORG = 'dddd4444-dddd-4444-dddd-444444444444';
let ctx: CelebCtx;
let w: PublishedLook;

async function inject(method: 'GET' | 'POST', url: string, who?: Parameters<CelebCtx['as']>[0], payload?: unknown) {
  return ctx.app.inject({ method, url, headers: who ? ctx.as(who) : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
}

beforeAll(async () => {
  ctx = await setupCelebrityWorld({ orgId: ORG });
  w = await publishDemoStarOne(ctx);
}, 60000);

describe('pieces', () => {
  it('the garment categories are exactly the migration’s CHECK list', () => {
    const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'db', 'migrations', '0007_celebrity_looks.sql'), 'utf8');
    const m = /garment_category text not null check \(garment_category in \(([^)]*)\)\)/.exec(sql);
    expect(m).not.toBeNull();
    const list = m![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    expect(list).toEqual([...GARMENT_CATEGORIES]);
  });

  it('adds pieces to a draft (hotspot both or neither, 0..1), not to a published look', async () => {
    expect((await inject('POST', `/v1/editorial/looks/${w.lookOne}/pieces`, 'editor', { label: 'The watch', garment_category: 'watch' })).statusCode).toBe(409);
    const ok = await inject('POST', `/v1/editorial/looks/${w.lookTwo}/pieces`, 'editor', { label: 'The shoes', garment_category: 'footwear', hotspot: { x: 0.5, y: 0.9 } });
    expect(ok.statusCode).toBe(201);
    expect((await inject('POST', `/v1/editorial/looks/${w.lookTwo}/pieces`, 'editor', { label: 'The cap', garment_category: 'headwear', hotspot: { x: 1.2, y: 0.1 } })).statusCode).toBe(400);
    expect((await inject('POST', `/v1/editorial/looks/${w.lookTwo}/pieces`, 'editor', { label: 'Her pick', garment_category: 'bag' })).statusCode).toBe(400);
    expect((await inject('POST', `/v1/editorial/looks/${w.lookTwo}/pieces`, 'editor', { label: 'The cape', garment_category: 'cape' })).statusCode).toBe(400);
    const pieces = await ctx.pool.query(`select label, position, hotspot_x, hotspot_y from look_pieces where look_id = $1 and removed_at is null order by position`, [w.lookTwo]);
    expect(pieces.rows.map((r) => [r.label, r.position])).toEqual([
      ['The bag', 0],
      ['The shoes', 1],
    ]);
  });

  it('on a published look only the order and the hotspot change; the label waits for an unpublish', async () => {
    const piece = w.pieces[2]!.id;
    expect((await inject('POST', `/v1/editorial/pieces/${piece}`, 'editor', { label: 'The shades' })).statusCode).toBe(409);
    expect((await inject('POST', `/v1/editorial/pieces/${piece}`, 'editor', { hotspot: { x: 0.43, y: 0.2 }, position: 5 })).statusCode).toBe(200);
    const look = (await json(await inject('GET', `/v1/public/afflino/looks/${w.lookOne}`))).data;
    expect(look.pieces.map((p: { label: string }) => p.label)).toEqual(['The shirt', 'The trousers', 'The sunglasses']);
    expect(look.pieces[2].hotspot).toEqual({ x: 0.43, y: 0.2 });
  });
});

describe('the database behind EXACT', () => {
  async function pieceItemInsert(extra: Record<string, unknown>) {
    const variant = (await ctx.pool.query(`select id from variants where org_id = $1 limit 1`, [ORG])).rows[0]!.id;
    const cols = { org_id: ORG, look_id: w.lookTwo, variant_id: variant, piece_id: null as unknown, match_type: 'exact', review_state: 'pending', tagged_by: '00000000-0000-0000-0000-0000000c0002', ...extra };
    cols.piece_id = cols.piece_id ?? (await ctx.pool.query(`select id from look_pieces where look_id = $1 and label = 'The bag'`, [w.lookTwo])).rows[0]!.id;
    const keys = Object.keys(cols);
    return ctx.pool.query(`insert into look_items (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
  }

  it('refuses an EXACT piece item without evidence, and an approval by its own tagger', async () => {
    await expect(pieceItemInsert({ evidence: null, evidence_source: null })).rejects.toThrow(/check constraint/i);
    await expect(pieceItemInsert({ evidence: 'short', evidence_source: 'src' })).rejects.toThrow(/check constraint/i);
    await expect(
      pieceItemInsert({
        evidence: 'TEST: a long enough evidence text',
        evidence_source: 'demo-src',
        review_state: 'approved',
        match_reviewed_by: '00000000-0000-0000-0000-0000000c0002',
        match_reviewed_at: new Date().toISOString(),
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(pieceItemInsert({ match_type: 'similar', review_state: 'pending' })).rejects.toThrow(/check constraint/i);
  });
});

describe('reviews of an EXACT tag', () => {
  it('downgrade turns it SIMILAR (approved); reject removes it', async () => {
    const bag = (await ctx.pool.query(`select id from look_pieces where look_id = $1 and label = 'The bag'`, [w.lookTwo])).rows[0]!.id;
    const offers = (await ctx.pool.query(`select id from offers where org_id = $1 order by merchant_item_ref limit 2`, [ORG])).rows.map((r) => r.id);
    const tag = async (offer: unknown) =>
      (await json(await inject('POST', `/v1/editorial/pieces/${bag}/items`, 'editor', { offer_id: offer, match_type: 'exact', evidence: 'TEST: the clasp and the stitching match', evidence_source: 'demo-src-1' }))).data;
    const first = await tag(offers[0]);
    expect(first).toMatchObject({ match_type: 'exact', review_state: 'pending' });
    const down = await inject('POST', `/v1/editorial/look-items/${first.item_id}/review`, 'editor2', { decision: 'downgrade' });
    expect((await json(down)).data).toMatchObject({ match_type: 'similar', review_state: 'approved' });
    const second = await tag(offers[1]);
    const rej = await inject('POST', `/v1/editorial/look-items/${second.item_id}/review`, 'editor2', { decision: 'reject' });
    expect((await json(rej)).data.removed).toBe(true);
    expect((await inject('POST', `/v1/editorial/look-items/${first.item_id}/review`, 'editor2', { decision: 'approve' })).statusCode).toBe(409);
  });
});

describe('removing a product', () => {
  it('pauses its links at once (the redirect serves the paused page) and drops it from the page', async () => {
    const view = (await json(await inject('GET', `/v1/editorial/looks/${w.lookOne}`, 'editor'))).data;
    expect(view.gate.ok).toBe(true);
    expect(view.look_url).toBe(`https://afflino.example.com/looks/${w.lookOne}`);
    const item = view.pieces[2].items[0];
    expect(item.links.length).toBeGreaterThanOrEqual(1);
    const token = String(item.links[0].url).split('/r/')[1];
    const res = await inject('POST', `/v1/editorial/look-items/${item.id}/remove`, 'editor');
    expect((await json(res)).data.links_paused).toBeGreaterThanOrEqual(1);
    const r = await ctx.redirect.inject({ method: 'GET', url: `/r/${token}`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('This link is paused');
    const look = (await json(await inject('GET', `/v1/public/afflino/looks/${w.lookOne}`))).data;
    expect(look.pieces[2].similar).toEqual([]);
  });

  it('unpublishing pauses every look link; publishing again reactivates them', async () => {
    const paused = await inject('POST', `/v1/editorial/looks/${w.lookOne}/transition`, 'editor', { to: 'paused' });
    expect((await json(paused)).data.links_paused).toBeGreaterThanOrEqual(2);
    expect((await inject('GET', `/v1/public/afflino/looks/${w.lookOne}`)).statusCode).toBe(404);
    // The sunglasses piece has no product now: publishing is refused until it has one.
    const refused = await inject('POST', `/v1/editorial/looks/${w.lookOne}/transition`, 'editor', { to: 'published' });
    expect(refused.statusCode).toBe(409);
    const offer = (await ctx.pool.query(`select id from offers where org_id = $1 and merchant_item_ref = 'B0DEMO0901'`, [ORG])).rows[0]!.id;
    expect((await inject('POST', `/v1/editorial/pieces/${w.pieces[2]!.id}/items`, 'editor', { offer_id: offer })).statusCode).toBe(201);
    const again = await inject('POST', `/v1/editorial/looks/${w.lookOne}/transition`, 'editor', { to: 'published' });
    expect(again.statusCode).toBe(200);
    expect((await json(again)).data.links.reactivated).toBeGreaterThanOrEqual(2);
  });
});

describe('analytics from the rollups', () => {
  it('groups human clicks by look, celebrity, piece, page, surface and day', async () => {
    const look = (await json(await inject('GET', `/v1/public/afflino/looks/${w.lookOne}`))).data;
    const shirt = String(look.pieces[0].similar[0].link.url).split('/r/')[1];
    const trousers = String(look.pieces[1].similar[0].link.url).split('/r/')[1];
    const ua = { 'user-agent': 'Mozilla/5.0 (iPhone) Demo' };
    for (const url of [`/r/${shirt}?via=s-demo-ig`, `/r/${shirt}?via=s-demo-ig`, `/r/${trousers}?via=look`, `/r/${trousers}`]) {
      expect((await ctx.redirect.inject({ method: 'GET', url, headers: ua })).statusCode).toBe(302);
    }
    // a bot is no click
    expect((await ctx.redirect.inject({ method: 'GET', url: `/r/${shirt}`, headers: { 'user-agent': 'facebookexternalhit/1.1' } })).statusCode).toBe(200);
    const { runRollups } = await import('../../workers/src/analytics/rollup.js');
    await runRollups(ctx.pool as unknown as Parameters<typeof runRollups>[0]);
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const get = async (group: string) => (await json(await inject('GET', `/v1/analytics/clicks?from=${today}&to=${today}&group_by=${group}`, 'editor'))).data;
    expect((await get('look')).groups).toEqual([{ key: w.lookOne, label: expect.any(String), clicks: 4 }]);
    expect((await get('celebrity')).groups).toEqual([{ key: w.starOne, label: 'Demo Star One', clicks: 4 }]);
    const pieces = (await get('piece')).groups;
    expect(pieces.map((g: { label: string; clicks: number }) => [g.label, g.clicks]).sort()).toEqual([
      ['The shirt', 2],
      ['The trousers', 2],
    ]);
    // The look page's links are afflino.com's own (its placement and tag), never the Instagram page's.
    expect((await get('property')).groups).toEqual([{ key: ctx.net.props.web, label: expect.stringMatching(/^web:/), clicks: 4 }]);
    const via = (await get('via')).groups.map((g: { key: string; clicks: number }) => [g.key, g.clicks]).sort();
    expect(via).toEqual([
      ['', 1],
      ['look', 1],
      ['s-demo-ig', 2],
    ]);
    expect((await get('day')).groups).toEqual([{ key: today, label: today, clicks: 4 }]);
    expect((await inject('GET', `/v1/analytics/clicks?from=${today}&to=2020-01-01`, 'editor')).statusCode).toBe(400);
    expect((await inject('GET', `/v1/analytics/clicks?from=${today}&to=${today}`, 'analyst')).statusCode).toBe(403);
    const replies = (await json(await inject('GET', `/v1/analytics/replies?from=${today}&to=${today}`, 'editor'))).data;
    expect(replies).toMatchObject({ days: [], rules: [] });
  });
});
