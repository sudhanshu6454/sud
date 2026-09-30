// Daily rollups (src/analytics/rollup.ts) on pg-mem: human clicks per IST day,
// link and surface (via), recomputed for today and yesterday and upserted —
// a second run gives the same rows; older days are not touched; reply events
// per day and rule; no money table is read or written. TEST data only.

import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDatabase } from '../../api/test/pgmem.js';
import { istBounds, istDay, lastIstDays, runRollups } from '../src/analytics/rollup.js';

type PgMemPool = TestDatabase['Pool'] extends new () => infer P ? P : never;
type AnyPool = Parameters<typeof runRollups>[0];

let pool: PgMemPool;
const ORG = randomUUID();
let linkA: string;
let linkB: string;
let ruleId: string;
// 2026-09-30 12:00 IST
const NOW = Date.parse('2026-09-30T06:30:00Z');

async function id(sql: string, params: unknown[]): Promise<string> {
  return String((await pool.query(sql, params)).rows[0]!.id);
}

async function click(link: string, at: string, via?: string) {
  await pool.query(`insert into clicks (org_id, link_id, click_id, occurred_at, context) values ($1, $2, $3, $4::timestamptz, $5::jsonb)`, [
    ORG,
    link,
    randomUUID(),
    at,
    JSON.stringify(via ? { ua: 'x', ip_hash: 'h', via } : { ua: 'x', ip_hash: 'h' }),
  ]);
}

beforeAll(async () => {
  pool = new (createTestDb().Pool)();
  await pool.query(`insert into organisations (id, name, slug) values ($1, 'Demo', $2)`, [ORG, `demo-rollup-${ORG.slice(0, 6)}`]);
  const merchant = await id(`insert into merchants (org_id, name) values ($1, 'Demo Merchant') returning id`, [ORG]);
  const programme = await id(
    `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis) values ($1, $2, 'stub-network', 'Demo', 'active', 'sale') returning id`,
    [ORG, merchant],
  );
  const publisher = await id(`insert into publishers (org_id, legal_name, country) values ($1, 'Demo', 'IN') returning id`, [ORG]);
  const property = await id(`insert into properties (org_id, publisher_id, platform, external_account_id) values ($1, $2, 'instagram', $3) returning id`, [ORG, publisher, `demo-${ORG}`]);
  const campaign = await id(`insert into campaigns (org_id, publisher_id, programme_id, name) values ($1, $2, $3, 'c') returning id`, [ORG, publisher, programme]);
  const placement = await id(`insert into placements (org_id, campaign_id, property_id, channel, placement_key) values ($1, $2, $3, 'post', $4) returning id`, [
    ORG,
    campaign,
    property,
    `plc-${ORG}`,
  ]);
  const product = await id(`insert into products (org_id, brand, model, category) values ($1, 'b', 'm', 'c') returning id`, [ORG]);
  const variant = await id(`insert into variants (org_id, product_id) values ($1, $2) returning id`, [ORG, product]);
  const offer = await id(
    `insert into offers (org_id, variant_id, programme_id, merchant_id, price_minor, offer_url, fresh_until) values ($1, $2, $3, $4, 100, 'https://shop.example.com/p', now() + interval '1 day') returning id`,
    [ORG, variant, programme, merchant],
  );
  linkA = await id(`insert into links (org_id, token, placement_id, offer_id, route_signature) values ($1, $2, $3, $4, 's') returning id`, [ORG, `tok-a-${ORG}`, placement, offer]);
  linkB = await id(`insert into links (org_id, token, placement_id, offer_id, route_signature) values ($1, $2, $3, $4, 's') returning id`, [ORG, `tok-b-${ORG}`, placement, offer]);
  // today (IST): 2 on A via the storefront, 1 on A without via, 1 on B
  await click(linkA, '2026-09-30T01:00:00Z', 's-demo');
  await click(linkA, '2026-09-30T05:00:00Z', 's-demo');
  await click(linkA, '2026-09-29T19:00:00Z'); // 00:30 IST on the 30th
  await click(linkB, '2026-09-30T06:00:00Z', 'look');
  // yesterday (IST): 1 on B
  await click(linkB, '2026-09-29T18:00:00Z', 'look'); // 23:30 IST on the 29th
  // three days ago: never recomputed by the default run
  await click(linkB, '2026-09-27T06:00:00Z');
  const celeb = await id(`insert into celebrities (org_id, name, name_key, slug) values ($1, 'Demo Star R', 'demo star r', 'demo-star-r') returning id`, [ORG]);
  const look = await id(`insert into looks (org_id, title, celebrity_id) values ($1, 'Demo', $2) returning id`, [ORG, celeb]);
  ruleId = await id(`insert into reply_rules (org_id, look_id, property_id, platform_post_id, keywords) values ($1, $2, $3, 'p', $4) returning id`, [ORG, look, property, ['link']]);
  for (const [status, at] of [
    ['sent', '2026-09-30T02:00:00Z'],
    ['sent', '2026-09-30T03:00:00Z'],
    ['skipped_suppressed', '2026-09-30T03:30:00Z'],
    ['unknown', '2026-09-30T04:00:00Z'],
    ['queued', '2026-09-30T04:30:00Z'],
  ] as const) {
    await pool.query(
      `insert into reply_events (org_id, rule_id, property_id, platform, meta_account_id, comment_id, commenter_hash, matched_keyword, status, received_at)
       values ($1, $2, $3, 'instagram', '1', $4, $5, 'link', $6, $7::timestamptz)`,
      [ORG, ruleId, property, randomUUID(), 'a'.repeat(64), status, at],
    );
  }
});

describe('IST days', () => {
  it('computes IST days and bounds without SQL time zones', () => {
    expect(istDay(Date.parse('2026-09-29T18:29:59Z'))).toBe('2026-09-29');
    expect(istDay(Date.parse('2026-09-29T18:30:00Z'))).toBe('2026-09-30');
    expect(istBounds('2026-09-30')).toEqual({ start: '2026-09-29T18:30:00.000Z', end: '2026-09-30T18:30:00.000Z' });
    expect(lastIstDays(2, NOW)).toEqual(['2026-09-29', '2026-09-30']);
  });
});

describe('runRollups', () => {
  it('counts clicks per day, link and via; a second run gives the same rows; older days untouched', async () => {
    const ledgerBefore = await pool.query(`select count(*)::int as n from ledger_entries`);
    const first = await runRollups(pool as unknown as AnyPool, { now: NOW });
    expect(first.click_days).toEqual(['2026-09-29', '2026-09-30']);
    const rows = async () =>
      (await pool.query(`select day, link_id, via, clicks from click_daily where org_id = $1 order by day, link_id, via`, [ORG])).rows.map((r) => [
        new Date(r.day as string).toISOString().slice(0, 10),
        r.link_id === linkA ? 'A' : 'B',
        r.via,
        Number(r.clicks),
      ]);
    const expected = [
      ['2026-09-29', 'B', 'look', 1],
      ['2026-09-30', 'A', '', 1],
      ['2026-09-30', 'A', 's-demo', 2],
      ['2026-09-30', 'B', 'look', 1],
    ].sort();
    expect((await rows()).sort()).toEqual(expected);
    await runRollups(pool as unknown as AnyPool, { now: NOW });
    expect((await rows()).sort()).toEqual(expected);
    // a new click today updates today's row on the next run
    await click(linkA, '2026-09-30T06:10:00Z', 's-demo');
    await runRollups(pool as unknown as AnyPool, { now: NOW });
    expect((await rows()).find((r) => r[1] === 'A' && r[2] === 's-demo')?.[3]).toBe(3);
    const ledgerAfter = await pool.query(`select count(*)::int as n from ledger_entries`);
    expect(ledgerAfter.rows[0]!.n).toBe(ledgerBefore.rows[0]!.n);
  });

  it('rolls reply events up per day and rule: received, sent, skipped, failed', async () => {
    await runRollups(pool as unknown as AnyPool, { now: NOW });
    const r = await pool.query(`select received, sent, skipped, failed from reply_daily where org_id = $1 and rule_id = $2`, [ORG, ruleId]);
    expect(r.rows.map((x) => [Number(x.received), Number(x.sent), Number(x.skipped), Number(x.failed)])).toEqual([[5, 2, 1, 1]]);
  });

  it('never recomputes a day the retention purge has reached: its stored counts stay', async () => {
    const days = (await pool.query(`select day from reply_daily where org_id = $1 and rule_id = $2`, [ORG, ruleId])).rows;
    expect(days.length).toBe(1);
    // The purge (a 0-day window here, as counsel might set a short one) deletes the events behind the stored row…
    await pool.query(`delete from reply_events where org_id = $1`, [ORG]);
    // …and a rollup told the window recomputes none of those days, so the counts stay as they were.
    const summary = await runRollups(pool as unknown as AnyPool, { now: NOW, replyRetentionDays: 0, clickContextDays: 0 });
    expect(summary.reply_days).toEqual([]);
    expect(summary.click_days).toEqual([]);
    const r = await pool.query(`select received, sent from reply_daily where org_id = $1 and rule_id = $2`, [ORG, ruleId]);
    expect(r.rows.map((x) => [Number(x.received), Number(x.sent)])).toEqual([[5, 2]]);
    // With a 30-day window, today's and the last week's days are recomputed as before.
    expect((await runRollups(pool as unknown as AnyPool, { now: NOW, replyRetentionDays: 30, clickContextDays: 365 })).reply_days).toHaveLength(8);
  });
});
