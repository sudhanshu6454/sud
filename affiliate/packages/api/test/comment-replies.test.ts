// Comment replies, the api side, on pg-mem: the Meta webhook's verification
// (GET), the signature over the RAW body (POST: 401 without it, 503 while the
// secrets are unset), both Instagram payload shapes, Facebook `feed` comments
// with verb=add only, the account's own comments dropped, opt-outs, the
// rules (keywords normalised, no link in a public reply, enabled only for a
// public look) and one event per comment however often Meta delivers it —
// with no raw commenter id and no comment text anywhere. TEST data only.

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_comment_replies';
process.env.JWT_SECRET ??= 'comment-replies-test-secret';
process.env.API_PORT ??= '0';
process.env.REDIRECT_PORT ??= '0';
process.env.REDIRECT_BASE_URL = 'https://afflino.example.com';
process.env.SITE_URL = 'https://afflino.example.com';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { json, publishDemoStarOne, setupCelebrityWorld, type CelebCtx, type PublishedLook } from './celebrity-fixtures.js';

const ORG = 'bbbb2222-bbbb-2222-bbbb-222222222222';
const APP_SECRET = 'demo-meta-app-secret-for-tests';
const VERIFY = 'demo-verify-token';
const HASH_KEY = 'demo-comment-hash-key-0000000000000000000000';
const IG_ID = '17841400000000009';
const PAGE_ID = '100000000000009';
const IG_POST = '17900000000000001';

let ctx: CelebCtx;
let w: PublishedLook;
let ruleId: string;

function setSecrets(on: boolean) {
  for (const [k, v] of [
    ['META_APP_SECRET', APP_SECRET],
    ['META_VERIFY_TOKEN', VERIFY],
    ['COMMENT_ID_HASH_KEY', HASH_KEY],
  ] as const) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
}

function sign(raw: string, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(raw, 'utf8')).digest('hex')}`;
}

async function deliver(raw: string, signature: string | null = sign(raw)) {
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/integrations/meta/webhook',
    headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) },
    payload: raw,
  });
}

function igComment(commentId: string, text: string, from = '9000000000001', shape: 'changes' | 'flat' = 'changes', idField: 'id' | 'comment_id' = 'id') {
  const value = { from: { id: from, username: 'demo_fan' }, [idField]: commentId, text, media: { id: IG_POST, media_product_type: 'FEED' } };
  const entry = shape === 'changes' ? { id: IG_ID, time: Math.floor(Date.now() / 1000), changes: [{ field: 'comments', value }] } : { id: IG_ID, time: Math.floor(Date.now() / 1000), field: 'comments', value };
  return JSON.stringify({ object: 'instagram', entry: [entry] });
}

beforeAll(async () => {
  ctx = await setupCelebrityWorld({ orgId: ORG });
  w = await publishDemoStarOne(ctx);
  const map = await ctx.app.inject({
    method: 'POST',
    url: '/v1/replies/accounts',
    headers: ctx.as('editor'),
    payload: { property_id: ctx.net.props.ig, meta_account_id: IG_ID, linked_page_id: PAGE_ID },
  });
  expect(map.statusCode).toBe(200);
  const fbMap = await ctx.app.inject({
    method: 'POST',
    url: '/v1/replies/accounts',
    headers: ctx.as('editor'),
    payload: { property_id: ctx.net.props.fb, meta_account_id: PAGE_ID },
  });
  expect(fbMap.statusCode).toBe(200);
}, 60000);

afterEach(() => setSecrets(false));

describe('GET verification', () => {
  it('echoes the challenge only for the verify token (constant-time), 403 otherwise, 503 while unset', async () => {
    const url = (token: string, challenge = '1158201444') => `/v1/integrations/meta/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=${challenge}`;
    expect((await ctx.app.inject({ method: 'GET', url: url(VERIFY) })).statusCode).toBe(503);
    setSecrets(true);
    const ok = await ctx.app.inject({ method: 'GET', url: url(VERIFY) });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('1158201444');
    expect(ok.headers['content-type']).toMatch(/^text\/plain/);
    expect((await ctx.app.inject({ method: 'GET', url: url('wrong-token') })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'GET', url: url(VERIFY, '<script>') })).statusCode).toBe(403);
  });
});

describe('rules', () => {
  it('normalises keywords, refuses a link in the public reply and opt-out words as keywords', async () => {
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/v1/replies/rules',
      headers: ctx.as('editor'),
      payload: { look_id: w.lookOne, keywords: ['LINK!'], public_reply: 'Sent! see www.example.com' },
    });
    expect(bad.statusCode).toBe(400);
    const stop = await ctx.app.inject({ method: 'POST', url: '/v1/replies/rules', headers: ctx.as('editor'), payload: { look_id: w.lookOne, keywords: ['STOP'] } });
    expect(stop.statusCode).toBe(400);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/replies/rules',
      headers: ctx.as('editor'),
      payload: { look_id: w.lookOne, keywords: ['LINK', 'Price please', 'link'], public_reply: 'Demo Star One wore this! She loves it. Check your DMs', enabled: true },
    });
    // The public reply sits under the celebrity's post: only one of the fixed texts, never free text.
    expect(res.statusCode).toBe(400);
    expect((await json(res)).error.message).toMatch(/fixed texts/);
    const templates = (await json(await ctx.app.inject({ method: 'GET', url: '/v1/replies/rules', headers: ctx.as('editor') }))).data.public_reply_templates;
    expect(templates).toContain('We sent you a message with the link.');
    const res2 = await ctx.app.inject({
      method: 'POST',
      url: '/v1/replies/rules',
      headers: ctx.as('editor'),
      payload: { look_id: w.lookOne, keywords: ['LINK', 'Price please', 'link'], public_reply: 'We sent you a message with the link.', enabled: true },
    });
    expect(res2.statusCode).toBe(201);
    const rule = (await json(res2)).data;
    ruleId = rule.id;
    expect(rule).toMatchObject({ keywords: ['link', 'price please'], platform_post_id: IG_POST, property_id: ctx.net.props.ig, enabled: true });
    // A draft look (Demo Star Two, unreviewed) cannot have a rule turned on.
    await ctx.pool.query(`update looks set property_id = $2, platform_post_id = 'demo-post-2' where id = $1`, [w.lookTwo, ctx.net.props.ig]);
    const draft = await ctx.app.inject({ method: 'POST', url: '/v1/replies/rules', headers: ctx.as('editor'), payload: { look_id: w.lookTwo, keywords: ['link'], enabled: true } });
    expect(draft.statusCode).toBe(409);
  });
});

describe('POST deliveries', () => {
  it('503 while the secrets are unset; 401 without or with a wrong signature; nothing is read', async () => {
    const raw = igComment('demo-c-0', 'link please');
    expect((await deliver(raw)).statusCode).toBe(503);
    setSecrets(true);
    expect((await deliver(raw, null)).statusCode).toBe(401);
    expect((await deliver(raw, sign(raw, 'another-secret'))).statusCode).toBe(401);
    expect((await deliver(raw, 'sha256=zz')).statusCode).toBe(401);
    // The signature is over the raw bytes: the same JSON re-serialised is refused.
    const escaped = raw.replace('link please', 'link pl\\u00e9ase');
    expect((await deliver(escaped, sign(JSON.stringify(JSON.parse(escaped))))).statusCode).toBe(401);
    const n = await ctx.pool.query(`select count(*)::int as n from reply_events where org_id = $1`, [ORG]);
    expect(n.rows[0]!.n).toBe(0);
  });

  it('a keyword comment becomes one event; ten deliveries of it still one; both Instagram shapes', async () => {
    setSecrets(true);
    const raw = igComment('demo-c-1', 'LINK please!!');
    for (let i = 0; i < 10; i += 1) {
      const res = await deliver(raw);
      expect(res.statusCode).toBe(200);
      expect((await json(res)).data).toMatchObject(i === 0 ? { comments: 1, queued: 1 } : { comments: 1, queued: 0, duplicates: 1 });
    }
    expect((await json(await deliver(igComment('demo-c-2', 'price please', '9000000000002', 'flat', 'comment_id')))).data.queued).toBe(1);
    const rows = await ctx.pool.query(`select * from reply_events where org_id = $1 order by comment_id`, [ORG]);
    expect(rows.rows.map((r) => [r.comment_id, r.status, r.matched_keyword])).toEqual([
      ['demo-c-1', 'queued', 'link'],
      ['demo-c-2', 'queued', 'price please'],
    ]);
    // Only the keyed hash: no raw commenter id, no username, no comment text in any row.
    const all = JSON.stringify(rows.rows);
    expect(all).not.toContain('9000000000001');
    expect(all).not.toContain('demo_fan');
    expect(all).not.toContain('LINK please');
    expect(rows.rows[0]!.commenter_hash).toBe(createHmac('sha256', HASH_KEY).update(`instagram:${IG_ID}:9000000000001`).digest('hex'));
  });

  it('ignores the account’s own comments, other posts, non-keyword comments and unmapped accounts', async () => {
    setSecrets(true);
    const own = (await json(await deliver(igComment('demo-c-3', 'link', IG_ID)))).data;
    expect(own).toMatchObject({ own_comments: 1, queued: 0 });
    const page = (await json(await deliver(igComment('demo-c-4', 'link', PAGE_ID)))).data;
    expect(page.own_comments).toBe(1);
    const noKeyword = (await json(await deliver(igComment('demo-c-5', 'linked in bio?')))).data;
    expect(noKeyword).toMatchObject({ no_rule: 1, queued: 0 });
    const other = JSON.stringify({ object: 'instagram', entry: [{ id: '17841499999999999', changes: [{ field: 'comments', value: { id: 'demo-c-6', text: 'link', from: { id: '1' }, media: { id: IG_POST } } }] }] });
    expect((await json(await deliver(other))).data.unmapped_accounts).toBe(1);
  });

  it('Facebook feed: only item=comment with verb=add', async () => {
    setSecrets(true);
    await ctx.pool.query(`update looks set platform_post_id = $2 where id = $1`, [w.lookOne, IG_POST]);
    const fbRule = await ctx.app.inject({
      method: 'POST',
      url: '/v1/replies/rules',
      headers: ctx.as('editor'),
      payload: { look_id: w.lookOne, platform_post_id: `${PAGE_ID}_555`, keywords: ['link'], enabled: true },
    });
    // The look's page is Instagram: a Facebook post needs the Facebook page's own look; the API refuses a duplicate post only.
    expect(fbRule.statusCode).toBe(201);
    await ctx.pool.query(`update reply_rules set property_id = $2 where id = $1`, [(await json(fbRule)).data.id, ctx.net.props.fb]);
    const feed = (verb: string, item: string, id: string) =>
      JSON.stringify({
        object: 'page',
        entry: [{ id: PAGE_ID, time: 1790000000, changes: [{ field: 'feed', value: { item, verb, comment_id: id, post_id: `${PAGE_ID}_555`, from: { id: '7000000000001', name: 'Demo Fan' }, message: 'link pls', created_time: Math.floor(Date.now() / 1000) } }] }],
      });
    expect((await json(await deliver(feed('edited', 'comment', 'fb-c-1')))).data.queued).toBe(0);
    expect((await json(await deliver(feed('add', 'reaction', 'fb-c-2')))).data.queued).toBe(0);
    expect((await json(await deliver(feed('add', 'comment', 'fb-c-3')))).data.queued).toBe(1);
  });

  it('STOP (a comment or a message) adds the author to the opt-out list, hashed', async () => {
    setSecrets(true);
    expect((await json(await deliver(igComment('demo-c-7', 'STOP', '9000000000003')))).data.opt_outs).toBe(1);
    const msg = JSON.stringify({ object: 'instagram', entry: [{ id: IG_ID, time: 1, messaging: [{ sender: { id: '9000000000004' }, recipient: { id: IG_ID }, message: { mid: 'm1', text: 'stop' } }] }] });
    expect((await json(await deliver(msg))).data.opt_outs).toBe(1);
    const sup = await ctx.pool.query(`select * from reply_suppressions where org_id = $1`, [ORG]);
    expect(sup.rows).toHaveLength(2);
    expect(JSON.stringify(sup.rows)).not.toContain('9000000000003');
  });

  it('the rule’s counts are readable; no commenter data is exposed', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/replies/rules/${ruleId}/events`, headers: ctx.as('editor') });
    const by = (await json(res)).data.by_status;
    expect(by.find((b: { status: string }) => b.status === 'queued').count).toBe(2);
    expect(res.body).not.toContain('commenter_hash');
  });
});
