// Suspense queue operations: GET /v1/suspense, POST /v1/suspense/:id/retry,
// POST /v1/suspense/:id/review — against pg-mem (same harness notes as
// money-loop.test.ts apply: DATABASE_URL/JWT_SECRET set before importing src,
// API_PORT=0 so the import side effect cannot collide with a real server).
//
// Seed model per org: merchant -> programmes (one per connector) -> full
// click chain (publisher/property/campaign/placement/link/click) so the
// retry-success path can insert a real matching click.

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_test';
process.env.JWT_SECRET ??= 'suspense-ops-test-secret';
process.env.API_PORT ??= '0';

import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDatabase } from './pgmem.js';

type PoolLike = TestDatabase['Pool'] extends new () => infer P ? P : never;

let pool: PoolLike;
let app: FastifyInstance;

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const USERS = {
  OP: { id: '00000000-0000-0000-0000-000000000011', role: 'finance_operator' },
  AD: { id: '00000000-0000-0000-0000-000000000012', role: 'network_admin' },
  ED: { id: '00000000-0000-0000-0000-000000000013', role: 'editor' },
} as const;

function bearer(user: { id: string; role: string }, orgId: string) {
  const token = jwt.sign(
    { sub: user.id, org_id: orgId, role: user.role },
    process.env.JWT_SECRET as string,
  );
  return { authorization: `Bearer ${token}` };
}

async function insertReturningId(text: string, params: unknown[]): Promise<string> {
  const { rows } = await pool.query(text, params);
  return String(rows[0]!.id);
}

interface Chain {
  publisherId: string;
  propertyId: string;
  programmeId: string;
  linkId: string;
}

/** Full click chain so a click row (with a chosen provider click_id) can be minted. */
async function seedChain(orgId: string, merchantId: string, programmeId: string, tag: string): Promise<Chain> {
  const publisherId = await insertReturningId(
    `insert into publishers (org_id, legal_name, country, status) values ($1, $2, 'IN', 'approved') returning id`,
    [orgId, `pub-${tag}`],
  );
  const propertyId = await insertReturningId(
    `insert into properties (org_id, publisher_id, platform, external_account_id, status)
     values ($1, $2, 'instagram', $3, 'approved') returning id`,
    [orgId, publisherId, `ig-${tag}`],
  );
  const campaignId = await insertReturningId(
    `insert into campaigns (org_id, publisher_id, programme_id, name) values ($1, $2, $3, $4) returning id`,
    [orgId, publisherId, programmeId, `camp-${tag}`],
  );
  const placementId = await insertReturningId(
    `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
     values ($1, $2, $3, 'instagram', $4) returning id`,
    [orgId, campaignId, propertyId, `plc-${tag}`],
  );
  const productId = await insertReturningId(
    `insert into products (org_id, brand, model, category) values ($1, 'brand', 'model', 'cat') returning id`,
    [orgId],
  );
  const variantId = await insertReturningId(
    `insert into variants (org_id, product_id) values ($1, $2) returning id`,
    [orgId, productId],
  );
  const offerId = await insertReturningId(
    `insert into offers (org_id, variant_id, programme_id, merchant_id, price_minor, offer_url, fresh_until, status)
     values ($1, $2, $3, $4, 99900, $5, $6::timestamptz, 'active') returning id`,
    [
      orgId,
      variantId,
      programmeId,
      merchantId,
      `https://shop.example.com/${tag}`,
      new Date(Date.now() + 30 * 86_400_000).toISOString(),
    ],
  );
  const linkId = await insertReturningId(
    `insert into links (org_id, token, placement_id, offer_id, route_signature)
     values ($1, $2, $3, $4, 'sig') returning id`,
    [orgId, `tok-${tag}`, placementId, offerId],
  );
  return { publisherId, propertyId, programmeId, linkId };
}

async function insertClick(orgId: string, linkId: string, clickRef: string): Promise<string> {
  return insertReturningId(
    `insert into clicks (org_id, link_id, click_id) values ($1, $2, $3) returning id`,
    [orgId, linkId, clickRef],
  );
}

/** A suspense conversion: click_id NULL by construction. */
async function insertSuspense(
  orgId: string,
  programmeId: string,
  opts: {
    ref: string | null;
    txn: string;
    raw: Record<string, unknown>;
    receivedAt?: string;
    reviewed?: boolean;
  },
): Promise<string> {
  const { rows } = await pool.query(
    `insert into conversions
       (org_id, programme_id, provider_account_id, source_transaction_id, line_id,
        returned_click_ref, currency, eligible_value_minor, commission_minor,
        provider_status, status, occurred_at, received_at, raw,
        reviewed_at, reviewed_by, review_note)
     values ($1, $2, 'acct-1', $3, $4, $5, 'INR', 100000, 16000,
             'approved', 'received', now(), $6, $7::jsonb,
             $8, $9, $10)
     returning id`,
    [
      orgId,
      programmeId,
      opts.txn,
      `line-${opts.txn}`,
      opts.ref,
      opts.receivedAt ?? new Date().toISOString(),
      JSON.stringify(opts.raw),
      opts.reviewed ? new Date().toISOString() : null,
      opts.reviewed ? USERS.OP.id : null,
      opts.reviewed ? 'checked against provider report; stays unknown' : null,
    ],
  );
  return String(rows[0]!.id);
}

let progA1: string; // stub-network, ORG_A
let progA2: string; // csv-file, ORG_A
let progB: string; // stub-network, ORG_B
let chainA: Chain;

let s1: string; // ORG_A, ref present, unmatched
let s2: string; // ORG_A, ref NULL
let s3: string; // ORG_A, csv-file programme, received 40d ago, already reviewed
let s9: string; // ORG_B

beforeAll(async () => {
  const tdb = createTestDb();
  pool = new tdb.Pool();

  const dbMod = await import('../src/db.js');
  dbMod.__setPool(pool as unknown as Parameters<typeof dbMod.__setPool>[0]);
  const { buildApp } = await import('../src/index.js');
  app = await buildApp();
  await app.ready();

  for (const [orgId, slug] of [[ORG_A, 'org-a'], [ORG_B, 'org-b']] as const) {
    await pool.query(`insert into organisations (id, name, slug) values ($1, $2, $3)`, [orgId, slug, slug]);
  }
  for (const u of Object.values(USERS)) {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [u.id, `${u.role}@suspense.example.com`]);
  }

  const merchantA = await insertReturningId(`insert into merchants (org_id, name) values ($1, 'mA') returning id`, [ORG_A]);
  const merchantB = await insertReturningId(`insert into merchants (org_id, name) values ($1, 'mB') returning id`, [ORG_B]);

  progA1 = await insertReturningId(
    `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis)
     values ($1, $2, 'stub-network', 'A1 stub', 'active', 'sale') returning id`,
    [ORG_A, merchantA],
  );
  progA2 = await insertReturningId(
    `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis)
     values ($1, $2, 'csv-file', 'A2 csv', 'active', 'sale') returning id`,
    [ORG_A, merchantA],
  );
  progB = await insertReturningId(
    `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis)
     values ($1, $2, 'stub-network', 'B stub', 'active', 'sale') returning id`,
    [ORG_B, merchantB],
  );

  chainA = await seedChain(ORG_A, merchantA, progA1, 'a');

  s1 = await insertSuspense(ORG_A, progA1, {
    ref: 'click-ref-1',
    txn: 'TXN-1',
    raw: { provider_txn: 'TXN-1', click_ref: 'click-ref-1', gross: 100000 },
  });
  s2 = await insertSuspense(ORG_A, progA1, {
    ref: null,
    txn: 'TXN-2',
    raw: { provider_txn: 'TXN-2', gross: 50000 },
  });
  s3 = await insertSuspense(ORG_A, progA2, {
    ref: 'click-ref-3',
    txn: 'TXN-3',
    raw: { provider_txn: 'TXN-3', click_ref: 'click-ref-3' },
    receivedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    reviewed: true,
  });
  s9 = await insertSuspense(ORG_B, progB, {
    ref: 'click-ref-9',
    txn: 'TXN-9',
    raw: { provider_txn: 'TXN-9', click_ref: 'click-ref-9' },
  });

  // An ATTRIBUTED conversion in ORG_A — must never appear in the queue.
  const usedClickId = await insertClick(ORG_A, chainA.linkId, 'click-used');
  await pool.query(
    `insert into conversions
       (org_id, programme_id, provider_account_id, source_transaction_id, line_id,
        returned_click_ref, click_id, currency, eligible_value_minor, commission_minor,
        provider_status, status, occurred_at, raw)
     values ($1, $2, 'acct-1', 'TXN-USED', 'line-used', 'click-used', $3,
             'INR', 100000, 16000, 'approved', 'received', now(), '{}'::jsonb)`,
    [ORG_A, progA1, usedClickId],
  );
  // A DECLINED suspense-shaped row — also excluded from the queue.
  await pool.query(
    `insert into conversions
       (org_id, programme_id, provider_account_id, source_transaction_id, line_id,
        returned_click_ref, currency, eligible_value_minor, commission_minor,
        provider_status, status, occurred_at, raw)
     values ($1, $2, 'acct-1', 'TXN-DECL', 'line-decl', 'click-ref-8',
             'INR', 100000, 16000, 'declined', 'declined', now(), '{}'::jsonb)`,
    [ORG_A, progA1],
  );
}, 30000);

async function getJson(res: Awaited<ReturnType<FastifyInstance['inject']>>) {
  expect(res.statusCode).toBeLessThan(400);
  return res.json() as { data: unknown; request_id: string };
}

interface Item {
  id: string;
  programme_id: string;
  programme_name: string;
  provider_account_id: string;
  source_transaction_id: string;
  returned_click_ref: string | null;
  currency: string;
  eligible_value_minor: number;
  commission_minor: number;
  provider_status: string;
  received_at: string;
  raw: Record<string, unknown>;
  reason_code: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
}

async function list(params = '', user = USERS.OP, org = ORG_A): Promise<{ items: Item[]; total: number }> {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/suspense${params}`,
    headers: bearer(user, org),
  });
  const body = await getJson(res);
  return body.data as { items: Item[]; total: number };
}

async function convClickId(id: string): Promise<string | null> {
  const { rows } = await pool.query(`select click_id from conversions where id = $1`, [id]);
  return (rows[0]?.click_id as string | null) ?? null;
}

async function outboxCount(orgId: string, eventType: string, conversionId: string): Promise<number> {
  // buildEnvelope nests the event payload one level down (column payload -> envelope -> payload).
  const { rows } = await pool.query(
    `select count(*) as n from outbox
      where org_id = $1 and event_type = $2 and payload->'payload'->>'conversion_id' = $3`,
    [orgId, eventType, conversionId],
  );
  return Number(rows[0]!.n);
}

// ---------------------------------------------------------------------------
// (a) list: tenant-scoped, reason codes, raw payload, filters
// ---------------------------------------------------------------------------

describe('GET /v1/suspense', () => {
  it('lists only the org\'s suspense rows, newest first, with reason codes and raw payload', async () => {
    const { items, total } = await list();
    expect(total).toBe(3);
    expect(items.map((i) => i.id).sort()).toEqual([s1, s2, s3].sort());
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId[s1]!.reason_code).toBe('CLICK_REF_UNMATCHED');
    expect(byId[s1]!.returned_click_ref).toBe('click-ref-1');
    expect(byId[s1]!.raw).toEqual({ provider_txn: 'TXN-1', click_ref: 'click-ref-1', gross: 100000 });
    expect(byId[s2]!.reason_code).toBe('NO_CLICK_REF');
    expect(byId[s2]!.returned_click_ref).toBeNull();
    expect(byId[s1]!.programme_name).toBe('A1 stub');
    expect(byId[s1]!.eligible_value_minor).toBe(100000);
    expect(byId[s1]!.commission_minor).toBe(16000);
    expect(byId[s1]!.reviewed_at).toBeNull();
    expect(byId[s3]!.reviewed_by).toBe(USERS.OP.id);
    // declined + already-attributed conversions are not in the queue
    expect(items.every((i) => i.source_transaction_id !== 'TXN-DECL')).toBe(true);
    expect(items.every((i) => i.source_transaction_id !== 'TXN-USED')).toBe(true);
  });

  it('filters by connector, programme_id, reviewed, and date range', async () => {
    const byConnector = await list(`?connector=csv-file`);
    expect(byConnector.items.map((i) => i.id)).toEqual([s3]);

    const byProg = await list(`?programme_id=${progA2}`);
    expect(byProg.items.map((i) => i.id)).toEqual([s3]);

    const reviewedOnly = await list(`?reviewed=true`);
    expect(reviewedOnly.items.map((i) => i.id)).toEqual([s3]);

    const unreviewedOnly = await list(`?reviewed=false`);
    expect(unreviewedOnly.items.map((i) => i.id).sort()).toEqual([s1, s2].sort());

    const from30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const recent = await list(`?received_from=${encodeURIComponent(from30d)}`);
    expect(recent.items.map((i) => i.id).sort()).toEqual([s1, s2].sort());

    const to30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const old = await list(`?received_to=${encodeURIComponent(to30d)}`);
    expect(old.items.map((i) => i.id)).toEqual([s3]);

    // pagination: limit + offset
    const page = await list(`?limit=2&offset=0`);
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
    const page2 = await list(`?limit=2&offset=2`);
    expect(page2.items).toHaveLength(1);
  });

  it('rejects non-finance roles', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/suspense',
      headers: bearer(USERS.ED, ORG_A),
    });
    expect(res.statusCode).toBe(403);
  });

  it('is tenant-isolated: org B sees only its own row', async () => {
    const { items, total } = await list('', USERS.OP, ORG_B);
    expect(total).toBe(1);
    expect(items.map((i) => i.id)).toEqual([s9]);
  });
});

// ---------------------------------------------------------------------------
// (b) retry with no click present: stays in suspense, nothing written
// ---------------------------------------------------------------------------

describe('POST /v1/suspense/:id/retry', () => {
  it('leaves the row untouched when the click ref still matches nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/suspense/${s1}/retry`,
      headers: bearer(USERS.OP, ORG_A),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { attributed: boolean; reason: string } };
    expect(body.data.attributed).toBe(false);
    expect(body.data.reason).toBe('CLICK_REF_UNMATCHED');

    expect(await convClickId(s1)).toBeNull();
    expect(await outboxCount(ORG_A, 'suspense.attributed', s1)).toBe(0);
    const { rows } = await pool.query(`select count(*) as n from ledger_entries where org_id = $1`, [ORG_A]);
    expect(Number(rows[0]!.n)).toBe(0);
    // still listed as suspense afterwards
    const { items } = await list();
    expect(items.map((i) => i.id)).toContain(s1);
  });

  it('answers a bodyless POST sent with a JSON content type as a 400, not a 500', async () => {
    // Fastify's parser rejects an empty body declared as JSON before the
    // handler runs; that is a client error (VALIDATION_ERROR), never INTERNAL.
    const res = await app.inject({
      method: 'POST',
      url: `/v1/suspense/${s1}/retry`,
      headers: { ...bearer(USERS.OP, ORG_A), 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/empty/i);
    expect(await convClickId(s1)).toBeNull();
  });

  it('422s when the conversion has no returned click ref — never fuzzy-matches', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/suspense/${s2}/retry`,
      headers: bearer(USERS.OP, ORG_A),
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(await convClickId(s2)).toBeNull();
  });

  it('404s for unknown ids and for other orgs\' rows', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: `/v1/suspense/${randomUUID()}/retry`,
      headers: bearer(USERS.OP, ORG_A),
    });
    expect(missing.statusCode).toBe(404);

    const cross = await app.inject({
      method: 'POST',
      url: `/v1/suspense/${s9}/retry`,
      headers: bearer(USERS.OP, ORG_A),
    });
    expect(cross.statusCode).toBe(404);
    expect(await convClickId(s9)).toBeNull();
  });

  it('binds click_id, writes audit + outbox once the matching click exists', async () => {
    await insertClick(ORG_A, chainA.linkId, 'click-ref-1');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/suspense/${s1}/retry`,
      headers: bearer(USERS.AD, ORG_A),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { attributed: boolean; click_id: string } };
    expect(body.data.attributed).toBe(true);
    expect(body.data.click_id).toBeTruthy();

    expect(await convClickId(s1)).toBe(body.data.click_id);
    const audit = await pool.query(
      `select action, entity, entity_id from audit_log
        where org_id = $1 and action = 'suspense.attributed' and entity_id = $2`,
      [ORG_A, s1],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: 'suspense.attributed', entity: 'conversion', entity_id: s1 });
    expect(await outboxCount(ORG_A, 'suspense.attributed', s1)).toBe(1);
    // attributed rows leave the queue
    const { items } = await list();
    expect(items.map((i) => i.id)).not.toContain(s1);
  });

  it('409s when retried after the row is already attributed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/suspense/${s1}/retry`,
      headers: bearer(USERS.OP, ORG_A),
    });
    expect(res.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// (d) review: requires a note, writes audit, touches nothing else
// ---------------------------------------------------------------------------

describe('POST /v1/suspense/:id/review', () => {
  it('rejects missing or too-short notes', async () => {
    const empty = await app.inject({
      method: 'POST',
      url: `/v1/suspense/${s2}/review`,
      headers: bearer(USERS.OP, ORG_A),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    const short = await app.inject({
      method: 'POST',
      url: `/v1/suspense/${s2}/review`,
      headers: bearer(USERS.OP, ORG_A),
      payload: { note: 'looks ok' },
    });
    expect(short.statusCode).toBe(400);
  });

  it('marks reviewed with audit, and changes nothing else', async () => {
    const note = 'Provider CSV re-issued without a click ref; stays unknown per policy.';
    const res = await app.inject({
      method: 'POST',
      url: `/v1/suspense/${s2}/review`,
      headers: bearer(USERS.OP, ORG_A),
      payload: { note },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { id: string; reviewed_at: string; reviewed_by: string; review_note: string };
    };
    expect(body.data.id).toBe(s2);
    expect(body.data.review_note).toBe(note);
    expect(body.data.reviewed_by).toBe(USERS.OP.id);
    expect(body.data.reviewed_at).toBeTruthy();

    // click_id untouched, no ledger entries, no outbox event for reviews
    expect(await convClickId(s2)).toBeNull();
    const { rows } = await pool.query(`select count(*) as n from ledger_entries where org_id = $1`, [ORG_A]);
    expect(Number(rows[0]!.n)).toBe(0);
    expect(await outboxCount(ORG_A, 'suspense.reviewed', s2)).toBe(0);
    const audit = await pool.query(
      `select action from audit_log where org_id = $1 and action = 'suspense.reviewed' and entity_id = $2`,
      [ORG_A, s2],
    );
    expect(audit.rows).toHaveLength(1);

    // reviewed=true filter now includes s2
    const { items } = await list(`?reviewed=true`);
    expect(items.map((i) => i.id)).toContain(s2);
  });

  it('404s for another org\'s row', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/suspense/${s9}/review`,
      headers: bearer(USERS.OP, ORG_A),
      payload: { note: 'cross-tenant review attempt, must not land' },
    });
    expect(res.statusCode).toBe(404);
    const { rows } = await pool.query(`select reviewed_at from conversions where id = $1`, [s9]);
    expect(rows[0]!.reviewed_at).toBeNull();
  });
});
