// SANDBOX GUARD — first, before any import side effect.
if (process.env.NODE_ENV === 'production') {
  console.error('REFUSING TO RUN: NODE_ENV=production. scripts/celebrity-looks-pg.ts is sandbox-only (a scratch database, TEST data).');
  process.exit(1);
}

/**
 * Celebrity looks on a real PostgreSQL (`pnpm looks:pg`; CI runs it after
 * the Amazon race). A scratch database `paparazzi_demo_looks_<8 hex>` is
 * created on DATABASE_URL's server, migrated with db/migrate.mjs, seeded with
 * the example in-house network (db/network.example.yaml, TEST data) and a
 * TEST Amazon account, and dropped at the end (also on failure).
 *
 * E. the whole story through the api and the redirect in this process, and
 *    the workers' sender with a stub (no Meta call): the library import →
 *    draft looks for unreviewed "Demo" celebrities → publish refused → a
 *    rights review → products through instant links into the pieces (EXACT
 *    refused without evidence, pending until a second person approves;
 *    several SIMILAR) → publish → feed / hub / look / storefront / sitemap
 *    show what the status allows, piece by piece, with /r/ links → a signed
 *    Meta comment → one stub message carrying only the afflino URL → a
 *    replay changes nothing → a bad signature is 401 → takedown → 410
 *    everywhere and the links paused → restore after a new review → rollups.
 * R. what pg-mem cannot prove: the partial unique indexes (one EXACT per
 *    piece, a product once per piece), the CHECKs behind EXACT, 10 rounds of
 *    a link mint racing a takedown (never an active link on a withdrawn
 *    look), 10 rounds of a link mint racing a rights review that turns
 *    products off (never an active link once it committed), 10 concurrent
 *    deliveries of one comment (one event), 5 workers on one event (one
 *    message).
 * O. the owned default: rows without licence columns refused without the
 *    owner's ownership statement, licensed by it once recorded; an editor's
 *    narrowing kept by a re-import; 10 rounds of an import racing a
 *    withdrawal (nothing left licensed by a withdrawn statement).
 */
import { createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const requireApi = createRequire(path.join(repoRoot, 'packages/api', 'package.json'));
const pg = requireApi('pg') as {
  Client: new (opts: { connectionString: string }) => {
    connect(): Promise<void>;
    query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
    end(): Promise<void>;
  };
};

const PREFIX = 'paparazzi_demo_looks_';
const SITE = 'https://afflino.example.com';
let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};

async function admin<T>(url: string, fn: (q: (sql: string) => Promise<unknown>) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn((sql) => c.query(sql));
  } finally {
    await c.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const serverUrl = process.env.DATABASE_URL;
  if (!serverUrl) {
    console.error('looks: DATABASE_URL is required (a scratch database is created on that server)');
    process.exit(1);
  }
  const name = `${PREFIX}${randomBytes(4).toString('hex')}`;
  const adminUrl = new URL(serverUrl);
  adminUrl.pathname = '/postgres';
  const scratch = new URL(serverUrl);
  scratch.pathname = `/${name}`;
  await admin(adminUrl.toString(), (q) => q(`create database "${name}"`));
  console.log(`  created scratch database ${name}`);
  process.env.DATABASE_URL = scratch.toString();
  process.env.JWT_SECRET ??= 'looks-pg-secret';
  process.env.REDIRECT_BASE_URL = SITE;
  process.env.SITE_URL = SITE;
  process.env.META_APP_SECRET = 'demo-meta-app-secret';
  process.env.META_VERIFY_TOKEN = 'demo-verify-token';
  process.env.COMMENT_ID_HASH_KEY = 'demo-comment-hash-key-00000000000000000000';

  let pool: { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>; end: () => Promise<void> } | null = null;
  try {
    const { runMigrations } = (await import('../db/migrate.mjs')) as {
      runMigrations(url: string, opts?: { log?: (l: string) => void }): Promise<{ applied: string[] }>;
    };
    const m = await runMigrations(scratch.toString(), { log: () => undefined });
    check(m.applied.length === 7 && m.applied[6] === '0007_celebrity_looks.sql', `migrations 0001-0007 apply on a fresh PostgreSQL (${m.applied.length})`);

    const db = await import('../packages/api/src/db.js');
    pool = db.getPool() as unknown as NonNullable<typeof pool>;
    const q = async (sql: string, p: unknown[] = []) => (await pool!.query(sql, p)).rows;
    const { seedNetwork, loadNetworkFile, DEFAULT_NETWORK_FILE } = await import('../db/seed-network.js');
    const net = await loadNetworkFile(DEFAULT_NETWORK_FILE);
    const seeded = await seedNetwork((sql, params) => pool!.query(sql, params ?? []), { properties: net.properties, webHost: 'afflino.example.com' });
    const orgId = seeded.org_id;
    const { setupAmazonAssociates } = await import('../packages/api/src/amazon/setup.js');
    const amazon = await setupAmazonAssociates({
      orgSlug: 'afflino',
      storeId: 'demo-21',
      declarations: [
        { row: 1, platform: 'instagram', account: 'demo.afflino', trackingId: 'demo-ig-21' },
        { row: 2, platform: 'facebook', account: 'demo.afflino', trackingId: 'demo-fb-21' },
        { row: 3, platform: 'web', account: 'afflino.example.com', trackingId: 'demo-web-21' },
      ],
      publisherShareBps: 7000,
      shopHost: 'afflino.example.com',
    });
    const people: Record<string, string> = {};
    for (const role of ['editor', 'editor2', 'rights_reviewer'] as const) {
      const id = String((await q(`insert into users (email) values ($1) returning id`, [`${role}@afflino.example.com`]))[0]!.id);
      await q(`insert into memberships (user_id, org_id, role) values ($1, $2, $3)`, [id, orgId, role === 'editor2' ? 'editor' : role]);
      people[role] = id;
    }
    const jwt = (await import('../packages/api/node_modules/jsonwebtoken/index.js')).default as { sign(p: object, s: string): string };
    const as = (who: 'editor' | 'editor2' | 'rights_reviewer') => ({
      authorization: `Bearer ${jwt.sign({ sub: people[who], org_id: orgId, role: who === 'editor2' ? 'editor' : who }, process.env.JWT_SECRET as string)}`,
    });
    const { buildApp } = await import('../packages/api/src/index.js');
    const app = await buildApp({ logStream: { write: () => undefined } });
    await app.ready();
    const { buildRedirectApp } = await import('../packages/redirect/src/index.js');
    const redirect = await buildRedirectApp({ pool: pool as never, ipHashKey: null, logStream: { write: () => undefined } });
    await redirect.ready();
    type Who = 'editor' | 'editor2' | 'rights_reviewer' | null;
    const call = async (method: 'GET' | 'POST', url: string, who: Who, payload?: unknown) => {
      const r = await app.inject({ method, url, headers: who ? as(who) : {}, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
      let body: any = null;
      try {
        body = JSON.parse(r.body);
      } catch {
        body = r.body;
      }
      return { status: r.statusCode, body, raw: r.body };
    };
    const prop = async (platform: string, account: string) =>
      String((await q(`select id from properties where org_id = $1 and platform = $2 and external_account_id = $3`, [orgId, platform, account]))[0]!.id);
    const ig = await prop('instagram', 'demo.afflino');

    // ========================================================================== E
    console.log('-- E: the story');
    const { importLibrary } = await import('../packages/api/src/looks/library-import.js');
    const fixture = await readFile(path.join(repoRoot, 'db/fixtures/library.example.csv'), 'utf8');
    const imp = await importLibrary({ orgSlug: 'afflino', text: fixture });
    check(imp.looks_created === 2 && imp.celebrities_created === 2 && imp.pieces_created === 4, 'E1 library import: 2 draft looks, 2 unreviewed Demo celebrities, 4 pieces, assets with licences');
    const again = await importLibrary({ orgSlug: 'afflino', text: fixture });
    check(again.looks_created === 0 && again.assets_updated === 0 && again.looks_unchanged === 2, 'E1 a second import changes nothing');
    const lookOne = imp.created_looks.find((l) => l.celebrity === 'Demo Star One')!.look_id;
    const starOne = String((await q(`select id from celebrities where org_id = $1 and slug = 'demo-star-one'`, [orgId]))[0]!.id);
    const pieces = (await q(`select id, label from look_pieces where look_id = $1 order by position`, [lookOne])).map((r) => ({ id: String(r.id), label: String(r.label) }));
    check(pieces.map((p) => p.label).join('|') === 'The shirt|The trousers|The sunglasses', 'E1 the look has three pieces in order: The shirt, The trousers, The sunglasses');

    const refused = await call('POST', `/v1/editorial/looks/${lookOne}/transition`, 'editor', { to: 'published' });
    check(refused.status === 409 && refused.body.gate.checks.find((c: { code: string }) => c.code === 'rights_status').ok === false, 'E2 publish refused while unreviewed (409, rights_status in the gate report)');
    check((await call('GET', `/v1/public/afflino/looks/${lookOne}`, null)).status === 404, 'E2 the public look is 404 while unreviewed');

    const review = await call('POST', `/v1/celebrities/${starOne}/rights-review`, 'rights_reviewer', {
      rights_status: 'cleared',
      max_display: 'name_and_image',
      shoppable: true,
      evidence_ref: 'TEST-LICENCE-DEMO-STAR-ONE',
      note: 'TEST: licence from the agency',
    });
    check(review.status === 200 && review.body.data.celebrity.effective.shoppable === true, 'E3 rights review by the rights reviewer: cleared, name and image, shoppable (per the matrix)');
    const stillId = String((await q(`select still_asset_id from looks where id = $1`, [lookOne]))[0]!.still_asset_id);
    await call('POST', `/v1/editorial/assets/${stillId}`, 'editor', { screen_status: 'passed' });

    const noEvidence = await call('POST', '/v1/editorial/instant-links', 'editor', {
      asin_or_url: 'https://www.amazon.in/dp/B0DEMO0101',
      brand: 'Demo Brand',
      model: 'Demo Linen Shirt',
      category: 'Shirts',
      property_ids: [ig],
      piece_id: pieces[0]!.id,
      match_type: 'exact',
    });
    check(noEvidence.status === 422, 'E4 an EXACT instant link without evidence is refused (422)');
    const exact = await call('POST', '/v1/editorial/instant-links', 'editor', {
      asin_or_url: 'https://www.amazon.in/Demo/dp/B0DEMO0101?tag=someone-else-21',
      brand: 'Demo Brand',
      model: 'Demo Linen Shirt',
      category: 'Shirts',
      property_ids: [ig],
      piece_id: pieces[0]!.id,
      match_type: 'exact',
      evidence: 'TEST: the label and the pocket match the still at 00:14',
      evidence_source: 'https://evidence.example.com/demo-0001',
    });
    check(
      exact.status === 201 && exact.body.data.item.review_state === 'pending' && exact.body.data.links.length === 0 && /second person/.test(String(exact.body.data.links_withheld)),
      'E4 EXACT with evidence: tagged, pending a second person, and no link minted for it before the approval',
    );
    let igLinks = 0;
    for (const [piece, asin, model] of [
      [1, 'B0DEMO0201', 'Demo Pleated Trousers'],
      [1, 'B0DEMO0202', 'Demo Wide Trousers'],
      [2, 'B0DEMO0301', 'Demo Round Sunglasses'],
      [0, 'B0DEMO0102', 'Demo Cotton Shirt'],
    ] as const) {
      const r = await call('POST', '/v1/editorial/instant-links', 'editor', {
        asin_or_url: asin,
        brand: 'Demo Brand',
        model,
        category: 'Clothing',
        property_ids: [ig],
        piece_id: pieces[piece]!.id,
      });
      if (r.status === 201 && r.body.data.links[0]?.link_url?.startsWith(`${SITE}/r/`) && r.body.data.links[0].tracking_id === 'demo-ig-21') igLinks += 1;
    }
    check(igLinks === 4, 'E4 four SIMILAR products (two on the trousers) tagged, each with a tracked link for the Instagram page (demo-ig-21)');
    const exactItem = String(exact.body.data.item.item_id);
    const self = await call('POST', `/v1/editorial/look-items/${exactItem}/review`, 'editor', { decision: 'approve' });
    const other = await call('POST', `/v1/editorial/look-items/${exactItem}/review`, 'editor2', { decision: 'approve' });
    check(self.status === 403 && other.status === 200, 'E5 the tagger cannot approve the EXACT tag (403); a second editor can');
    const pub = await call('POST', `/v1/editorial/looks/${lookOne}/transition`, 'editor', { to: 'published' });
    check(pub.status === 200 && pub.body.data.gate.ok === true && pub.body.data.links.unlinked.length === 0, 'E6 publish: every gate check passes, every product linked on afflino.com’s own placement (the look page’s)');

    const look = await call('GET', `/v1/public/afflino/looks/${lookOne}`, null);
    const shirt = look.body.data?.pieces?.[0];
    const trousers = look.body.data?.pieces?.[1];
    check(
      look.status === 200 &&
        look.body.data.headline === 'Spotted at Demo Film Premiere' &&
        String(look.body.data.image?.url).startsWith(`/img/looks/${lookOne}?v=`) &&
        !look.raw.includes('cdn.example.com'),
      'E7 look page: a headline without the name, the still at its own address (the origin URL never public)',
    );
    check(shirt?.exact?.label === 'The same item' && shirt.similar.length === 1 && trousers?.exact === null && trousers.similar.length === 2, 'E7 piece by piece: the shirt’s EXACT first then its SIMILAR; the trousers two SIMILAR');
    check(
      String(trousers?.similar?.[0]?.detail) === 'Similar style. Demo Star One did not wear or endorse this product.' &&
        String(look.body.data.non_endorsement).includes('has not endorsed'),
      'E7 SIMILAR wording and the non-endorsement line',
    );
    check(!look.raw.includes('amazon.in/dp') && /\/r\/[0-9a-f]{32}/.test(look.raw), 'E7 only tracked /r/ links, never a merchant URL');
    const named = await call('POST', '/v1/editorial/storefronts', 'editor', { property_id: ig, slug: 'demo-star-two-fans', display_name: 'Demo Star Two Fans', status: 'live' });
    check(named.status === 422, 'E7 a storefront named after a celebrity is refused (422)');
    const sf = await call('POST', '/v1/editorial/storefronts', 'editor', { property_id: ig, slug: 'demo-afflino', display_name: 'Demo Afflino', status: 'live' });
    const feed = await call('GET', '/v1/public/afflino/spotted', null);
    const hub = await call('GET', '/v1/public/afflino/celebrities/demo-star-one', null);
    const store = await call('GET', '/v1/public/afflino/storefronts/demo-afflino', null);
    const sitemap = await call('GET', '/v1/public/afflino/sitemap', null);
    check(
      sf.status === 201 && feed.body.data.total === 1 && hub.status === 200 && store.body.data.looks.total === 1 && sitemap.body.data.looks.length === 1,
      'E7 feed, hub, storefront and sitemap list the look; Demo Star Two (unreviewed) nowhere',
    );
    check((await call('GET', '/v1/public/afflino/celebrities/demo-star-two', null)).status === 404, 'E7 the unreviewed celebrity’s hub is 404');
    const token = String(trousers.similar[0].link.url).split('/r/')[1];
    const click = await redirect.inject({ method: 'GET', url: `/r/${token}?via=s-demo-afflino`, headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Demo' } });
    check(click.statusCode === 302 && click.headers.location === 'https://www.amazon.in/dp/B0DEMO0201?tag=demo-web-21', `E8 /r/ → 302 ${click.headers.location} (afflino.com's own tag)`);
    const stillMod = await import('../packages/api/src/looks/still.js');
    stillMod.__setStillFetch(async () => new Response(Buffer.from('TEST-JPEG'), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    const still = await app.inject({ method: 'GET', url: `/v1/public/afflino/looks/${lookOne}/still` });
    check(still.statusCode === 200 && still.headers['content-type'] === 'image/jpeg' && still.body === 'TEST-JPEG', 'E8 the still’s own address serves the image while the page may show it');

    // Comment replies
    await call('POST', '/v1/replies/accounts', 'editor', { property_id: ig, meta_account_id: '17841400000000001', linked_page_id: '100000000000001' });
    const rule = await call('POST', '/v1/replies/rules', 'editor', { look_id: lookOne, keywords: ['link'], enabled: true });
    check(rule.status === 201, 'E9 a comment-reply rule on the look’s post, enabled (the look is public)');
    const comment = (id: string) =>
      JSON.stringify({ object: 'instagram', entry: [{ id: '17841400000000001', time: Math.floor(Date.now() / 1000), changes: [{ field: 'comments', value: { from: { id: '9000000000001', username: 'demo_fan' }, id, text: 'Link please', media: { id: '17900000000000001' } } }] }] });
    const sign = (raw: string, secret = 'demo-meta-app-secret') => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    const deliver = (raw: string, sig: string) =>
      app.inject({ method: 'POST', url: '/v1/integrations/meta/webhook', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, payload: raw });
    const first = await deliver(comment('demo-c-1'), sign(comment('demo-c-1')));
    check(first.statusCode === 200 && JSON.parse(first.body).data.queued === 1, 'E9 a signed comment with the keyword → one reply event');
    const { StubReplySender, processReplyEvent } = await import('../packages/workers/src/replies/sender.js');
    const sender = new StubReplySender();
    const ev = String((await q(`select id from reply_events where org_id = $1 and comment_id = 'demo-c-1'`, [orgId]))[0]!.id);
    const sent = await processReplyEvent(pool as never, ev, { sender, mode: 'on', siteOrigin: SITE });
    const text = sender.calls[0]?.target.text ?? '';
    check(sent === 'sent' && sender.calls.filter((c) => c.kind === 'private').length === 1, 'E10 one private reply (stub sender)');
    check((text.match(/https?:\/\/\S+/g) ?? []).join(' ') === `${SITE}/looks/${lookOne}` && !/\/r\/|amazon/i.test(text), `E10 the message carries only the look’s afflino URL: "${text.split('\n')[0]}"`);
    let replays = 0;
    for (let i = 0; i < 5; i += 1) {
      const r = await deliver(comment('demo-c-1'), sign(comment('demo-c-1')));
      if (JSON.parse(r.body).data.duplicates === 1) replays += 1;
    }
    const again2 = await processReplyEvent(pool as never, ev, { sender, mode: 'on', siteOrigin: SITE });
    const events = Number((await q(`select count(*)::int as n from reply_events where org_id = $1`, [orgId]))[0]!.n);
    check(replays === 5 && again2 === 'not_claimed' && events === 1 && sender.calls.filter((c) => c.kind === 'private').length === 1, 'E11 five replays: still one event, one message');
    const bad = await deliver(comment('demo-c-2'), sign(comment('demo-c-2'), 'wrong-secret'));
    check(bad.statusCode === 401, 'E11 a bad signature is 401');
    const stored = JSON.stringify(await q(`select * from reply_events where org_id = $1`, [orgId]));
    check(!stored.includes('9000000000001') && !stored.includes('demo_fan') && !stored.includes('Link please'), 'E11 no raw commenter id, username or comment text is stored');

    // Takedown
    const td = await call('POST', '/v1/takedowns', 'editor', {
      scope: 'celebrity',
      celebrity_id: starOne,
      reason_code: 'rights_holder_request',
      requester_ref: 'TEST-NOTICE-0001',
      requested_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    });
    check(td.status === 201 && td.body.data.looks_withdrawn === 1 && td.body.data.links_paused >= 5 && td.body.data.takedown.completed_at !== null, `E12 takedown: 1 look withdrawn, ${td.body.data.links_paused} links paused, requested / actioned / completed recorded`);
    const gone = await Promise.all([
      call('GET', `/v1/public/afflino/looks/${lookOne}`, null),
      call('GET', '/v1/public/afflino/celebrities/demo-star-one', null),
      call('GET', '/v1/public/afflino/spotted', null),
      call('GET', '/v1/public/afflino/storefronts/demo-afflino', null),
      call('GET', '/v1/public/afflino/sitemap', null),
    ]);
    check(
      gone[0].status === 410 && gone[1].status === 410 && gone[2].body.data.total === 0 && gone[3].body.data.looks.total === 0 && gone[4].body.data.looks.length === 0,
      'E12 410 on the look and the hub; nothing in the feed, the storefront or the sitemap',
    );
    const stillGone = await app.inject({ method: 'GET', url: `/v1/public/afflino/looks/${lookOne}/still` });
    check(
      stillGone.statusCode === 410 && Array.isArray(td.body.data.share_urls) && td.body.data.share_urls.includes(`${SITE}/looks/${lookOne}`) && td.body.data.stills.length === 1,
      'E12 the still’s address answers 410; the answer lists the share URLs to scrape again and the still',
    );
    const paused = await redirect.inject({ method: 'GET', url: `/r/${token}`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
    check(paused.statusCode === 200 && paused.body.includes('This link is paused'), 'E12 the /r/ link serves the paused page');
    const late = await deliver(comment('demo-c-3'), sign(comment('demo-c-3')));
    check(JSON.parse(late.body).data.queued === 0, 'E12 a new comment after the takedown queues nothing (the rule is off)');
    const early = await call('POST', `/v1/takedowns/${td.body.data.takedown.id}/restore`, 'rights_reviewer', { note: 'TEST: notice withdrawn' });
    check(early.status === 409, 'E13 restore refused without a new rights review (409)');
    await call('POST', `/v1/celebrities/${starOne}/rights-review`, 'rights_reviewer', {
      rights_status: 'cleared',
      max_display: 'name_and_image',
      shoppable: true,
      evidence_ref: 'TEST-COUNSEL-RESTORE',
      note: 'TEST: the rights holder withdrew the notice',
    });
    const restored = await call('POST', `/v1/takedowns/${td.body.data.takedown.id}/restore`, 'rights_reviewer', { note: 'TEST: notice withdrawn' });
    const back = await call('GET', `/v1/public/afflino/looks/${lookOne}`, null);
    const clickBack = await redirect.inject({ method: 'GET', url: `/r/${token}`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
    check(restored.status === 200 && back.status === 200 && clickBack.statusCode === 302, 'E13 after a new review the restore brings the look (200) and its links (302) back');

    // Rollups
    const { runRollups } = await import('../packages/workers/src/analytics/rollup.js');
    await runRollups(pool as never);
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const byLook = await call('GET', `/v1/analytics/clicks?from=${today}&to=${today}&group_by=look`, 'editor');
    const byVia = await call('GET', `/v1/analytics/clicks?from=${today}&to=${today}&group_by=via`, 'editor');
    check(byLook.body.data.total_clicks === 2 && byLook.body.data.groups[0].key === lookOne, `E14 rollups: 2 human clicks on the look today (${JSON.stringify(byLook.body.data.groups.map((g: { clicks: number }) => g.clicks))})`);
    check(byVia.body.data.groups.some((g: { key: string; clicks: number }) => g.key === 's-demo-afflino' && g.clicks === 1), 'E14 per surface: 1 click via the storefront');

    // ========================================================================== R
    console.log('-- R: what pg-mem cannot prove');
    const variant = async (asin: string) => String((await q(`select v.id from variants v where v.org_id = $1 and v.merchant_sku = $2`, [orgId, asin]))[0]!.id);
    const editor = people.editor!;
    const insertItem = (piece: string, v: string, match: string, extra: Record<string, unknown> = {}) => {
      const cols: Record<string, unknown> = { org_id: orgId, look_id: lookOne, variant_id: v, piece_id: piece, match_type: match, review_state: match === 'exact' ? 'pending' : 'approved', tagged_by: editor, ...extra };
      const keys = Object.keys(cols);
      return pool!.query(`insert into look_items (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(cols));
    };
    const code = async (p: Promise<unknown>) => {
      try {
        await p;
        return 'ok';
      } catch (err) {
        return String((err as { code?: string }).code);
      }
    };
    const ev1 = { evidence: 'TEST: evidence of the same item', evidence_source: 'demo-src' };
    check((await code(insertItem(pieces[0]!.id, await variant('B0DEMO0201'), 'exact', ev1))) === '23505', 'R1 a second EXACT on one piece: unique violation (uq_look_items_piece_exact)');
    check((await code(insertItem(pieces[1]!.id, await variant('B0DEMO0201'), 'similar'))) === '23505', 'R1 the same product twice in one piece: unique violation (uq_look_items_piece_variant)');
    await q(`update look_items set removed_at = now() where piece_id = $1 and variant_id = $2`, [pieces[1]!.id, await variant('B0DEMO0202')]);
    check((await code(insertItem(pieces[1]!.id, await variant('B0DEMO0202'), 'similar'))) === 'ok', 'R1 a removed product can be tagged again');
    check((await code(insertItem(pieces[2]!.id, await variant('B0DEMO0101'), 'exact', { evidence: 'short', evidence_source: 'x' }))) === '23514', 'R1 EXACT without real evidence: check violation');
    check(
      (await code(insertItem(pieces[2]!.id, await variant('B0DEMO0101'), 'exact', { ...ev1, review_state: 'approved', match_reviewed_by: editor, match_reviewed_at: new Date().toISOString() }))) === '23514',
      'R1 EXACT approved by its own tagger: check violation (maker-checker)',
    );

    // R2: a link mint racing a takedown, 10 rounds, each on a fresh published look.
    const { mintItemLink } = await import('../packages/api/src/looks/look-links.js');
    const { takeDown } = await import('../packages/api/src/looks/takedown.js');
    const offer = String((await q(`select id from offers where org_id = $1 and merchant_item_ref = 'B0DEMO0301'`, [orgId]))[0]!.id);
    const igPlacement = String(
      (await q(`select pl.id from placements pl join campaigns ca on ca.id = pl.campaign_id where pl.org_id = $1 and pl.property_id = $2 and ca.programme_id = $3`, [orgId, ig, amazon.programme_id]))[0]!.id,
    );
    let clean = 0;
    let minted = 0;
    for (let round = 0; round < 10; round += 1) {
      const l = String(
        (await q(
          `insert into looks (org_id, title, status, published_at, celebrity_id, property_id, moment_date, celebrity_display)
           values ($1, $2, 'published', now(), $3, $4, '2026-09-01', 'name_only') returning id`,
          [orgId, `race ${round}`, starOne, ig],
        ))[0]!.id,
      );
      const p = String((await q(`insert into look_pieces (org_id, look_id, label, garment_category) values ($1, $2, 'The sunglasses', 'eyewear') returning id`, [orgId, l]))[0]!.id);
      const item = String(
        (await q(
          `insert into look_items (org_id, look_id, variant_id, piece_id, match_type, review_state, tagged_by) values ($1, $2, $3, $4, 'similar', 'approved', $5) returning id`,
          [orgId, l, await variant('B0DEMO0301'), p, editor],
        ))[0]!.id,
      );
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const results = await Promise.allSettled([
        (async () => {
          await delay(round % 2 === 0 ? 0 : 3);
          return mintItemLink(orgId, l, { property_id: ig, programme_id: amazon.programme_id, offer_id: offer, placement_id: igPlacement, look_item_id: item }, { requirePublished: true });
        })(),
        (async () => {
          // a spread of head starts, so both orders happen (the mint's guards run before its lock)
          await delay(round % 2 === 0 ? 4 * round : 0);
          return takeDown(orgId, editor, { scope: 'look', look_id: l, reason_code: 'counsel_instruction' });
        })(),
      ]);
      if (results[0].status === 'fulfilled') minted += 1;
      const active = Number(
        (await q(`select count(*)::int as n from links k join look_items li on li.id = k.look_item_id where li.look_id = $1 and k.status = 'active'`, [l]))[0]!.n,
      );
      const status = String((await q(`select status from looks where id = $1`, [l]))[0]!.status);
      if (status === 'withdrawn' && active === 0 && results[1].status === 'fulfilled') clean += 1;
    }
    check(clean === 10, `R2 10 rounds of a mint racing a takedown: the look withdrawn and no active link on it every time (${clean}/10; the mint won ${minted} times and its link was paused)`);

    // R5: a link mint racing a rights review that turns products off, 10 rounds, each on a fresh published look.
    const { reviewCelebrity } = await import('../packages/api/src/looks/celebrities.js');
    const reviewer = { id: people.rights_reviewer!, role: 'rights_reviewer' };
    const cleared = (shoppable: boolean) => ({
      rights_status: 'cleared' as const,
      max_display: 'name_and_image' as const,
      shoppable,
      evidence_ref: 'TEST-RACE-REVIEW',
      note: shoppable ? 'TEST: products allowed' : 'TEST: products off',
    });
    let reviewClean = 0;
    for (let round = 0; round < 10; round += 1) {
      await reviewCelebrity(orgId, reviewer, starOne, cleared(true));
      const l = String(
        (await q(
          `insert into looks (org_id, title, status, published_at, celebrity_id, property_id, moment_date, celebrity_display)
           values ($1, $2, 'published', now(), $3, $4, '2026-09-01', 'name_only') returning id`,
          [orgId, `review race ${round}`, starOne, ig],
        ))[0]!.id,
      );
      const p = String((await q(`insert into look_pieces (org_id, look_id, label, garment_category) values ($1, $2, 'The sunglasses', 'eyewear') returning id`, [orgId, l]))[0]!.id);
      const item = String(
        (await q(
          `insert into look_items (org_id, look_id, variant_id, piece_id, match_type, review_state, tagged_by) values ($1, $2, $3, $4, 'similar', 'approved', $5) returning id`,
          [orgId, l, await variant('B0DEMO0301'), p, editor],
        ))[0]!.id,
      );
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const results = await Promise.allSettled([
        (async () => {
          await delay(round % 2 === 0 ? 0 : 3);
          return mintItemLink(orgId, l, { property_id: ig, programme_id: amazon.programme_id, offer_id: offer, placement_id: igPlacement, look_item_id: item }, { requirePublished: true });
        })(),
        (async () => {
          await delay(round % 2 === 0 ? 3 * round : 0);
          return reviewCelebrity(orgId, reviewer, starOne, cleared(false));
        })(),
      ]);
      const active = Number(
        (await q(`select count(*)::int as n from links k join look_items li on li.id = k.look_item_id where li.look_id = $1 and k.status = 'active'`, [l]))[0]!.n,
      );
      if (active === 0 && results[1].status === 'fulfilled') reviewClean += 1;
    }
    check(reviewClean === 10, `R5 10 rounds of a mint racing a review that turns products off: no active link once it committed (${reviewClean}/10)`);
    await reviewCelebrity(orgId, reviewer, starOne, cleared(true));

    // R3: 10 concurrent deliveries of one comment (the rule turned back on after the restore).
    const on = await call('POST', `/v1/replies/rules/${rule.body.data.id}`, 'editor', { enabled: true });
    check(on.status === 200, 'R3 the rule the takedown turned off is turned on again by an editor after the restore');
    const { ingestMetaDelivery } = await import('../packages/api/src/looks/replies.js');
    const body = JSON.parse(comment('demo-c-race'));
    const outs = await Promise.all(Array.from({ length: 10 }, () => ingestMetaDelivery(body, process.env.COMMENT_ID_HASH_KEY as string)));
    const raceEvents = Number((await q(`select count(*)::int as n from reply_events where org_id = $1 and comment_id = 'demo-c-race'`, [orgId]))[0]!.n);
    check(raceEvents === 1 && outs.filter((o) => o.queued === 1).length === 1, 'R3 10 concurrent deliveries of one comment: one event');

    // R4: 5 workers on one event.
    const raceEv = String((await q(`select id from reply_events where org_id = $1 and comment_id = 'demo-c-race'`, [orgId]))[0]!.id);
    const s2 = new StubReplySender();
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => processReplyEvent(pool as never, raceEv, { sender: s2, mode: 'on', siteOrigin: SITE })));
    check(outcomes.filter((o) => o === 'sent').length === 1 && s2.calls.filter((c) => c.kind === 'private').length === 1, `R4 5 workers on one event: one message (${outcomes.join(', ')})`);

    // ========================================================================== O
    console.log('-- O: the owned default (the owner\'s ownership statement)');
    const own = await import('../packages/api/src/looks/ownership.js');
    const recorder = String(
      (await q(`select user_id from memberships where org_id = $1 and role = 'network_admin' order by created_at limit 1`, [orgId]))[0]?.user_id ?? people.rights_reviewer,
    );
    const ownedHeader = 'video_ref,celebrity,moment_date,event,place,place_kind,platform,account,still_ref,still_url,piece_label,piece_category';
    const ownedFile = `${ownedHeader}\n` + ['0501', '0502'].map((n) => `demo-vid-${n},Demo Star One,2026-09-02,Demo Gala ${n},Demo City,event,instagram,demo.afflino,demo-stills/${n}.jpg,https://cdn.example.com/demo-stills/${n}.jpg,The jacket,outerwear`).join('\n') + '\n';
    const noStatement = await importLibrary({ orgSlug: 'afflino', text: ownedFile }).then(() => 'imported', (e: Error) => e.message);
    check(/no licence: /.test(noStatement), 'O1 without an ownership statement, rows without licence columns are refused');
    const rec = await own.recordOwnershipStatement(orgId, recorder, { copyright_owner: 'Demo Media (TEST)', acquisition: 'staff' });
    const owned = await importLibrary({ orgSlug: 'afflino', text: ownedFile });
    const ownedAssets = await q(`select commercial_reuse, territory, expires_at, assignment_ref, licence_via from assets where org_id = $1 and storage_key like 'demo-%050_%'`, [orgId]);
    check(
      owned.looks_created === 2 && owned.licence_from_statement === 2 && ownedAssets.length === 4 &&
        ownedAssets.every((a) => a.commercial_reuse === 'yes' && a.territory === 'WW' && a.expires_at === null && a.licence_via === 'statement' && String(a.assignment_ref).startsWith(`owner-statement:${rec.statement.id} `)),
      'O1 with the statement recorded: 2 looks, 4 assets licensed by it (commercial reuse, WW, no end, the statement as the reference)',
    );
    // A person's narrowing survives a re-import.
    const still501 = String((await q(`select id from assets where org_id = $1 and storage_key = 'demo-stills/0501.jpg'`, [orgId]))[0]!.id);
    const narrowed = await call('POST', `/v1/editorial/assets/${still501}`, 'editor', { commercial_reuse: 'no' });
    const reimport = await importLibrary({ orgSlug: 'afflino', text: ownedFile });
    const after501 = (await q(`select commercial_reuse, licence_via from assets where id = $1`, [still501]))[0]!;
    check(
      narrowed.status === 200 && after501.commercial_reuse === 'no' && after501.licence_via === 'review' && reimport.licence_kept.length === 1 && reimport.licence_kept[0]!.kept.join() === 'commercial_reuse',
      "O2 an editor's narrowing (commercial reuse off) is kept by a re-import, which lists it",
    );
    // 10 rounds of an import racing a withdrawal: once the withdrawal commits, no asset keeps the statement's licence.
    let ownedClean = 0;
    for (let round = 0; round < 10; round += 1) {
      await own.recordOwnershipStatement(orgId, recorder, { copyright_owner: `Demo Media Round ${round} (TEST)`, acquisition: round % 2 ? 'other' : 'staff' });
      const [imported, withdrawn] = await Promise.all([
        importLibrary({ orgSlug: 'afflino', text: ownedFile }).then(() => true, () => false),
        own.withdrawOwnershipStatement(orgId, recorder, `TEST round ${round}: the race`).then(() => true, () => false),
      ]);
      if (!withdrawn) await own.withdrawOwnershipStatement(orgId, recorder, `TEST round ${round}: after the race`);
      const left = Number((await q(`select count(*)::int as n from assets where org_id = $1 and licence_via = 'statement' and commercial_reuse = 'yes'`, [orgId]))[0]!.n);
      if (left === 0 && (imported || withdrawn)) ownedClean += 1;
    }
    check(ownedClean === 10, `O3 10 rounds of an import racing a withdrawal of the statement: nothing licensed by a withdrawn statement (${ownedClean}/10)`);

    await app.close();
    await redirect.close();
  } finally {
    await pool?.end().catch(() => undefined);
    await admin(adminUrl.toString(), async (qq) => {
      if (!name.startsWith(PREFIX)) throw new Error(`looks: refusing to drop '${name}'`);
      try {
        await qq(`drop database if exists "${name}" with (force)`);
      } catch {
        await qq(`drop database if exists "${name}"`);
      }
    });
    console.log(`  dropped scratch database ${name}`);
  }
  console.log(failures === 0 ? 'LOOKS: ALL PASS' : `LOOKS: ${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
