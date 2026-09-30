// TEST fixtures for the celebrity-looks suites: the in-house network of
// amazon-fixtures.ts under the slug 'afflino' (so db/fixtures/library.example.csv's
// pages demo.afflino match), an Amazon account whose Instagram, Facebook and
// web placements each have their own tracking ID, the people who act (two
// editors for maker-checker, a network admin, counsel's rights reviewer, the
// shop's read-only analyst) and a fake Redis that records deletes.
// Every value is TEST-labelled: "Demo Star …" people, demo-* tags, B0DEMO…
// ASINs, *.example.com hosts.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import type { Redis } from 'ioredis';
import { createTestDb } from './pgmem.js';
import { AMZ, seedOwnNetwork, type OwnNetwork, type PoolLike } from './amazon-fixtures.js';

export const LIBRARY_FIXTURE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'db', 'fixtures', 'library.example.csv'), 'utf8');

export const WEB_TAG = 'demo-web-21';

// The suites change rows directly between reads: the api's own cache of public answers is off here
// (src/public-guard.ts; its own test turns it on), and the per-client limit is out of the way.
process.env.PUBLIC_API_CACHE ??= 'off';
process.env.PUBLIC_RATE_PER_MINUTE ??= '100000';
process.env.WEBHOOK_RATE_PER_MINUTE ??= '100000';

export const PEOPLE = {
  admin: { id: '00000000-0000-0000-0000-0000000c0001', role: 'network_admin' },
  editor: { id: '00000000-0000-0000-0000-0000000c0002', role: 'editor' },
  editor2: { id: '00000000-0000-0000-0000-0000000c0003', role: 'editor' },
  reviewer: { id: '00000000-0000-0000-0000-0000000c0004', role: 'rights_reviewer' },
  analyst: { id: '00000000-0000-0000-0000-0000000c0005', role: 'publisher_analyst' },
  owner: { id: '00000000-0000-0000-0000-0000000c0006', role: 'publisher_owner' },
} as const;

export class FakeRedis {
  readonly deleted: string[][] = [];
  readonly store = new Map<string, string>();
  async del(...keys: string[]): Promise<number> {
    this.deleted.push(keys);
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n += 1;
    return n;
  }
  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async incr(key: string): Promise<number> {
    const n = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(n));
    return n;
  }
}

export interface CelebCtx {
  pool: PoolLike;
  app: FastifyInstance;
  redirect: FastifyInstance;
  net: OwnNetwork;
  orgId: string;
  programmeId: string;
  redis: FakeRedis;
  as: (who: keyof typeof PEOPLE, orgId?: string) => { authorization: string };
}

export async function setupCelebrityWorld(opts: { orgId: string; otherOrg?: { id: string; slug: string } }): Promise<CelebCtx> {
  const tdb = createTestDb({ rollback: true });
  const pool = new tdb.Pool();
  const dbMod = await import('../src/db.js');
  dbMod.__setPool(pool as unknown as Parameters<typeof dbMod.__setPool>[0]);
  const { buildApp } = await import('../src/index.js');
  const app = await buildApp({ logStream: { write: (l: string) => (process.env.CELEB_TEST_LOG ? process.stderr.write(l) : undefined) } });
  await app.ready();
  const { buildRedirectApp } = await import('../../redirect/src/index.js');
  const redirect = await buildRedirectApp({
    pool: pool as unknown as Parameters<typeof buildRedirectApp>[0]['pool'],
    ipHashKey: null,
    logStream: { write: () => undefined },
  });
  await redirect.ready();
  const redisMod = await import('../src/redis.js');
  const redis = new FakeRedis();
  redisMod.__setRedis(redis as unknown as Redis);
  const programmes = await import('../src/routes/programmes.js');
  programmes.__setRouteCacheSecondDeleteDelay(5);

  const net = await seedOwnNetwork(pool, opts.orgId, 'afflino', PEOPLE.admin.id);
  for (const [key, p] of Object.entries(PEOPLE)) {
    if (p.id === PEOPLE.admin.id) continue;
    await pool.query(`insert into users (id, email) values ($1, $2)`, [p.id, `${key}@afflino.example.com`]);
  }
  for (const p of Object.values(PEOPLE)) {
    await pool.query(`insert into memberships (user_id, org_id, role) values ($1, $2, $3)`, [p.id, opts.orgId, p.role]);
  }
  if (opts.otherOrg) {
    await pool.query(`insert into organisations (id, name, slug) values ($1, $2, $3)`, [opts.otherOrg.id, 'Demo other org', opts.otherOrg.slug]);
  }
  const setup = await import('../src/amazon/setup.js');
  const summary = await setup.setupAmazonAssociates({
    orgSlug: 'afflino',
    storeId: AMZ.STORE,
    declarations: [
      { row: 1, platform: 'instagram', account: 'demo.afflino', trackingId: AMZ.IG_TAG },
      { row: 2, platform: 'facebook', account: 'demo.afflino', trackingId: AMZ.FB_TAG },
      { row: 3, platform: 'web', account: `afflino.${AMZ.SHOP_HOST}`, trackingId: WEB_TAG },
    ],
    publisherShareBps: 7000,
    shopHost: `afflino.${AMZ.SHOP_HOST}`,
  });
  const secret = process.env.JWT_SECRET as string;
  const as = (who: keyof typeof PEOPLE, orgId = opts.orgId) => {
    const p = PEOPLE[who];
    return { authorization: `Bearer ${jwt.sign({ sub: p.id, org_id: orgId, role: p.role }, secret)}` };
  };
  return { pool, app, redirect, net, orgId: opts.orgId, programmeId: summary.programme_id, redis, as };
}

/** Days ago as YYYY-MM-DD (UTC). */
export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** The fixture with its moment dates moved into the past relative to today (they are fixed dates in the file). */
export function libraryFixture(): string {
  return LIBRARY_FIXTURE;
}

export async function json(res: { body: string }): Promise<any> {
  return JSON.parse(res.body);
}

export interface PublishedLook {
  lookOne: string;
  lookTwo: string;
  starOne: string;
  starTwo: string;
  pieces: Array<{ id: string; label: string }>;
  stillId: string;
}

/**
 * The library fixture imported, Demo Star One cleared by the rights reviewer
 * (name, image, products), the still screened, one SIMILAR Amazon product per
 * piece, and the look published. Demo Star Two stays unreviewed (draft).
 */
export async function publishDemoStarOne(ctx: CelebCtx): Promise<PublishedLook> {
  const { importLibrary } = await import('../src/looks/library-import.js');
  await importLibrary({ orgSlug: 'afflino', text: libraryFixture(), actorId: null });
  // By library reference, so a world that imported the fixture already (a second import changes nothing) works too.
  const byRef = async (ref: string) => String((await ctx.pool.query(`select id from looks where library_ref = $1`, [ref])).rows[0]!.id);
  const lookOne = await byRef('demo-vid-0001');
  const lookTwo = await byRef('demo-vid-0002');
  const starOne = String((await ctx.pool.query(`select id from celebrities where slug = 'demo-star-one'`)).rows[0]!.id);
  const starTwo = String((await ctx.pool.query(`select id from celebrities where slug = 'demo-star-two'`)).rows[0]!.id);
  const pieces = (await ctx.pool.query(`select id, label from look_pieces where look_id = $1 order by position`, [lookOne])).rows.map((r) => ({
    id: String(r.id),
    label: String(r.label),
  }));
  const stillId = String((await ctx.pool.query(`select still_asset_id from looks where id = $1`, [lookOne])).rows[0]!.still_asset_id);
  const post = (url: string, who: keyof typeof PEOPLE, payload: unknown) =>
    ctx.app.inject({ method: 'POST', url, headers: ctx.as(who), payload: payload as Record<string, unknown> });
  const review = await post(`/v1/celebrities/${starOne}/rights-review`, 'reviewer', {
    rights_status: 'cleared',
    max_display: 'name_and_image',
    shoppable: true,
    evidence_ref: 'TEST-LICENCE-DEMO-STAR-ONE',
    note: 'TEST: written licence from the agency',
  });
  if (review.statusCode !== 200) throw new Error(`review: ${review.body}`);
  const screen = await post(`/v1/editorial/assets/${stillId}`, 'editor', { screen_status: 'passed' });
  if (screen.statusCode !== 200) throw new Error(`screen: ${screen.body}`);
  let n = 0;
  for (const p of pieces) {
    n += 1;
    const res = await post('/v1/editorial/instant-links', 'editor', {
      asin_or_url: `B0DEMO09${String(n).padStart(2, '0')}`,
      brand: 'Demo Brand',
      model: `Demo ${p.label.replace(/^The /, '')} ${n}`,
      category: 'Clothing',
      property_ids: [ctx.net.props.ig],
      piece_id: p.id,
    });
    if (res.statusCode !== 201) throw new Error(`instant links: ${res.body}`);
  }
  const pub = await post(`/v1/editorial/looks/${lookOne}/transition`, 'editor', { to: 'published' });
  if (pub.statusCode !== 200) throw new Error(`publish: ${pub.body}`);
  return { lookOne, lookTwo, starOne, starTwo, pieces, stillId };
}
