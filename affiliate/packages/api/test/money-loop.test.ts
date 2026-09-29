// Money-loop acceptance tests: conversion ingestion -> attribution -> ledger
// -> reversals -> payout prepare/approve/disburse/callback, against pg-mem.
//
// Environment notes:
// - DATABASE_URL / JWT_SECRET are set below BEFORE the API modules are
//   imported (src/db.ts throws at import time without DATABASE_URL).
// - API_PORT=0: importing src/index.ts runs its module-level main(), which
//   calls app.listen(). Port 0 asks the OS for an ephemeral port so the
//   import side effect can never collide with a real server. (Seam gap:
//   importing index.ts should not boot a server; reported separately.)
// - Auth is a JWT stub: only {sub, org_id, role} claims are verified.
// - Tests never send Idempotency-Key headers, so the header-idempotency
//   layer is a pass-through here.
// - Known pg-mem gaps handled in test/pgmem.ts: gen_random_uuid must be
//   impure, ON CONFLICT (cols) DO NOTHING is rewritten to the target-less
//   form, `unique nulls not distinct` becomes plain `unique` (so every
//   dedupe test below supplies an explicit line_id).

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_test';
process.env.JWT_SECRET ??= 'money-loop-test-secret';
process.env.API_PORT ??= '0';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { checkBooksBalanced } from '@paparazzi/shared';
import { createTestDb, type TestDatabase } from './pgmem.js';

type PoolLike = TestDatabase['Pool'] extends new () => infer P ? P : never;

let pool: PoolLike;
let app: FastifyInstance;

const ORG1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // conversions + reversals
const ORG2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // payouts

const USERS = {
  OP: { id: '00000000-0000-0000-0000-000000000001', role: 'finance_operator' },
  AP: { id: '00000000-0000-0000-0000-000000000002', role: 'finance_approver' },
  AD: { id: '00000000-0000-0000-0000-000000000003', role: 'network_admin' },
  ED: { id: '00000000-0000-0000-0000-000000000004', role: 'editor' },
} as const;

function bearer(user: { id: string; role: string }, orgId: string) {
  const token = jwt.sign(
    { sub: user.id, org_id: orgId, role: user.role },
    process.env.JWT_SECRET as string,
  );
  return { authorization: `Bearer ${token}` };
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

interface Chain {
  publisherId: string;
  programmeId: string;
  clickRef: string;
}

async function insertReturningId(text: string, params: unknown[]): Promise<string> {
  const { rows } = await pool.query(text, params);
  return String(rows[0]!.id);
}

// Minimal attributable chain: publisher -> property -> merchant -> programme
// -> contract -> product -> variant -> offer -> campaign -> placement ->
// link -> click. One merchant per org; one programme per call.
async function seedChain(
  orgId: string,
  merchantId: string,
  opts: {
    publisher: string;
    clickRef: string;
    programme: string;
    bps: number;
    threshold: number;
    returnsWindowDays?: number;
  },
): Promise<Chain> {
  const publisherId = await insertReturningId(
    `insert into publishers (org_id, legal_name, country, status) values ($1, $2, 'IN', 'approved') returning id`,
    [orgId, opts.publisher],
  );
  const propertyId = await insertReturningId(
    `insert into properties (org_id, publisher_id, platform, external_account_id, status)
     values ($1, $2, 'instagram', $3, 'approved') returning id`,
    [orgId, publisherId, `ig-${opts.clickRef}`],
  );
  const programmeId = await insertReturningId(
    `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis, returns_window_days)
     values ($1, $2, 'stub-network', $3, 'active', 'sale', $4) returning id`,
    [orgId, merchantId, opts.programme, opts.returnsWindowDays ?? 30],
  );
  await insertReturningId(
    `insert into contracts (org_id, publisher_id, programme_id, version, publisher_share_bps, payout_threshold_minor, status)
     values ($1, $2, $3, 1, $4, $5, 'approved') returning id`,
    [orgId, publisherId, programmeId, opts.bps, String(opts.threshold)],
  );
  const productId = await insertReturningId(
    `insert into products (org_id, brand, model, category) values ($1, 'brand', 'model', 'cat') returning id`,
    [orgId],
  );
  const variantId = await insertReturningId(`insert into variants (org_id, product_id) values ($1, $2) returning id`, [
    orgId,
    productId,
  ]);
  const offerId = await insertReturningId(
    `insert into offers (org_id, variant_id, programme_id, merchant_id, price_minor, offer_url, fresh_until, status)
     values ($1, $2, $3, $4, 99900, 'https://example.com/p', now() + interval '30 days', 'active') returning id`,
    [orgId, variantId, programmeId, merchantId],
  );
  const campaignId = await insertReturningId(
    `insert into campaigns (org_id, publisher_id, programme_id, name) values ($1, $2, $3, 'camp') returning id`,
    [orgId, publisherId, programmeId],
  );
  const placementId = await insertReturningId(
    `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
     values ($1, $2, $3, 'post', $4) returning id`,
    [orgId, campaignId, propertyId, `plc-${opts.clickRef}`],
  );
  const linkId = await insertReturningId(
    `insert into links (org_id, token, placement_id, offer_id, route_signature)
     values ($1, $2, $3, $4, 'sig') returning id`,
    [orgId, `tok-${opts.clickRef}`, placementId, offerId],
  );
  await pool.query(`insert into clicks (org_id, link_id, click_id) values ($1, $2, $3)`, [
    orgId,
    linkId,
    opts.clickRef,
  ]);
  return { publisherId, programmeId, clickRef: opts.clickRef };
}

let chain1: Chain; // ORG1: single publisher/programme for conversion tests
let chainA: Chain; // ORG2: publisher A, threshold 500
let chainB: Chain; // ORG2: publisher B, threshold 50000 (never qualifies)

async function cleanOrgMoney(orgId: string) {
  await pool.query(`delete from payout_transfers where payout_batch_id in (select id from payout_batches where org_id = $1)`, [orgId]);
  await pool.query(`delete from payout_items where payout_batch_id in (select id from payout_batches where org_id = $1)`, [orgId]);
  for (const t of ['ledger_entries', 'adjustments', 'conversions', 'outbox', 'payout_batches', 'merchant_settlements', 'idempotency_keys']) {
    await pool.query(`delete from ${t} where org_id = $1`, [orgId]);
  }
}

beforeAll(async () => {
  const tdb = createTestDb();
  pool = new tdb.Pool();

  // Swap the API's pool BEFORE any request is served. Seam gap (reported):
  // src/idempotency.ts imports the module-level `pool` directly and bypasses
  // __setPool; these tests never send Idempotency-Key headers so that path
  // is never exercised.
  const dbMod = await import('../src/db.js');
  dbMod.__setPool(pool as unknown as Parameters<typeof dbMod.__setPool>[0]);
  const { buildApp } = await import('../src/index.js');
  app = await buildApp();
  await app.ready();

  for (const [orgId, slug] of [[ORG1, 'org-one'], [ORG2, 'org-two']] as const) {
    await pool.query(`insert into organisations (id, name, slug) values ($1, $2, $3)`, [orgId, slug, slug]);
  }
  for (const u of Object.values(USERS)) {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [u.id, `${u.role}@example.com`]);
  }
  const m1 = await insertReturningId(`insert into merchants (org_id, name) values ($1, 'm1') returning id`, [ORG1]);
  const m2 = await insertReturningId(`insert into merchants (org_id, name) values ($1, 'm2') returning id`, [ORG2]);

  chain1 = await seedChain(ORG1, m1, { publisher: 'Pub One', clickRef: 'click-one', programme: 'Prog One', bps: 7000, threshold: 10000 });
  chainA = await seedChain(ORG2, m2, { publisher: 'Pub A', clickRef: 'click-a', programme: 'Prog A', bps: 7000, threshold: 500 });
  chainB = await seedChain(ORG2, m2, { publisher: 'Pub B', clickRef: 'click-b', programme: 'Prog B', bps: 7000, threshold: 50000 });
}, 30000);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const EVENTS = (org: string) => `/v1/integrations/stub-network/events`;

function conversionBody(
  txn: string,
  clickRef: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    provider_account_id: 'acct-1',
    source_transaction_id: txn,
    line_id: 'line-1',
    returned_click_ref: clickRef,
    currency: 'INR',
    eligible_value_minor: 100000,
    commission_minor: 16000,
    provider_status: 'approved',
    provider_revision: 1,
    occurred_at: new Date().toISOString(),
    ...overrides,
  };
}

async function postEvent(body: Record<string, unknown>, orgId: string, user = USERS.ED) {
  return app.inject({
    method: 'POST',
    url: EVENTS(orgId),
    headers: bearer(user, orgId),
    payload: body,
  });
}

async function conversionCount(orgId: string, txn: string): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as n from conversions where org_id = $1 and source_transaction_id = $2`,
    [orgId, txn],
  );
  return Number(rows[0]!.n);
}

async function ledgerCountForConversion(orgId: string, conversionId: string): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as n from ledger_entries where org_id = $1 and conversion_id = $2`,
    [orgId, conversionId],
  );
  return Number(rows[0]!.n);
}

async function conversionStatus(orgId: string, txn: string): Promise<string> {
  const { rows } = await pool.query(
    `select status from conversions where org_id = $1 and source_transaction_id = $2`,
    [orgId, txn],
  );
  return String(rows[0]!.status);
}

/** Net (credit - debit) per account across a conversion and its adjustments. */
async function accountNets(orgId: string, conversionId: string): Promise<Map<string, number>> {
  const { rows } = await pool.query(
    `select account, debit_minor, credit_minor from ledger_entries
      where org_id = $1 and (conversion_id = $2
        or adjustment_id in (select id from adjustments where org_id = $1 and conversion_id = $2))`,
    [orgId, conversionId],
  );
  const nets = new Map<string, number>();
  for (const r of rows as Array<{ account: string; debit_minor: number; credit_minor: number }>) {
    nets.set(r.account, (nets.get(r.account) ?? 0) + (Number(r.credit_minor) - Number(r.debit_minor)));
  }
  return nets;
}

describe('conversion ingestion', () => {
  beforeEach(async () => {
    await cleanOrgMoney(ORG1);
  });

  it('is idempotent: 10 identical approved webhooks -> 1 conversion, 3 ledger entries, {deduped:true} on repeats', async () => {
    const body = conversionBody('dup-1', chain1.clickRef);
    const first = await postEvent(body, ORG1);
    expect(first.statusCode).toBe(202);
    const conversionId = String(first.json().data.conversion_id);

    for (let i = 0; i < 9; i++) {
      const repeat = await postEvent(body, ORG1);
      expect(repeat.statusCode).toBe(200);
      expect(repeat.json().data).toEqual({ deduped: true });
    }

    expect(await conversionCount(ORG1, 'dup-1')).toBe(1);
    expect(await ledgerCountForConversion(ORG1, conversionId)).toBe(3);
  });

  it('keeps the newer revision: approved rev2 then pending rev1 stays approved with no new ledger entries', async () => {
    const approved = await postEvent(
      conversionBody('ooo-1', chain1.clickRef, { provider_revision: 2 }),
      ORG1,
    );
    expect(approved.statusCode).toBe(202);
    const conversionId = String(approved.json().data.conversion_id);
    expect(await ledgerCountForConversion(ORG1, conversionId)).toBe(3);

    const stale = await postEvent(
      conversionBody('ooo-1', chain1.clickRef, { provider_revision: 1, provider_status: 'pending' }),
      ORG1,
    );
    expect(stale.statusCode).toBe(200);
    expect(stale.json().data).toEqual({ deduped: true });
    expect(await conversionStatus(ORG1, 'ooo-1')).toBe('approved');
    expect(await ledgerCountForConversion(ORG1, conversionId)).toBe(3);
  });

  it('advances pending rev1 -> approved rev2 with exactly one ledger posting', async () => {
    const pending = await postEvent(
      conversionBody('ooo-2', chain1.clickRef, { provider_revision: 1, provider_status: 'pending' }),
      ORG1,
    );
    expect(pending.statusCode).toBe(202);
    expect(pending.json().data.status).toBe('pending');
    const conversionId = String(pending.json().data.conversion_id);
    expect(await ledgerCountForConversion(ORG1, conversionId)).toBe(0);

    const approved = await postEvent(
      conversionBody('ooo-2', chain1.clickRef, { provider_revision: 2, provider_status: 'approved' }),
      ORG1,
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.status).toBe('approved');
    expect(await ledgerCountForConversion(ORG1, conversionId)).toBe(3);
  });

  it('turns approved->declined at a higher revision into a reversal adjustment, never a status flip', async () => {
    const approved = await postEvent(conversionBody('auto-1', chain1.clickRef), ORG1);
    expect(approved.statusCode).toBe(202);
    const conversionId = String(approved.json().data.conversion_id);

    const declined = await postEvent(
      conversionBody('auto-1', chain1.clickRef, { provider_revision: 2, provider_status: 'declined' }),
      ORG1,
    );
    expect(declined.statusCode).toBe(200);
    expect(declined.json().data.status).toBe('approved');
    expect(declined.json().data.auto_reversed).toBe(true);

    // Status column is terminal: still 'approved' in the DB.
    expect(await conversionStatus(ORG1, 'auto-1')).toBe('approved');

    // A reversal adjustment for the FULL commission was recorded...
    const { rows } = await pool.query(
      `select kind, commission_delta_minor from adjustments where org_id = $1 and conversion_id = $2`,
      [ORG1, conversionId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('reversal');
    expect(Number(rows[0]!.commission_delta_minor)).toBe(16000);

    // ...and the ledger nets to zero per account.
    const nets = await accountNets(ORG1, conversionId);
    for (const [account, net] of nets) {
      expect(net, `account ${account}`).toBe(0);
    }
  });

  it('routes unknown returned_click_ref to suspense: stored with click_id NULL, zero ledger entries', async () => {
    const res = await postEvent(
      conversionBody('susp-1', 'click-that-does-not-exist'),
      ORG1,
    );
    expect(res.statusCode).toBe(202);
    const conversionId = String(res.json().data.conversion_id);

    const { rows } = await pool.query(
      `select click_id from conversions where org_id = $1 and id = $2`,
      [ORG1, conversionId],
    );
    expect(rows[0]!.click_id).toBeNull();
    expect(await ledgerCountForConversion(ORG1, conversionId)).toBe(0);
  });

  it('rejects unauthenticated webhook calls with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: EVENTS(ORG1),
      payload: conversionBody('noauth-1', chain1.clickRef),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });
});

describe('explicit reversals', () => {
  beforeEach(async () => {
    await cleanOrgMoney(ORG1);
  });

  it('posts a 50% reversal: publisher_liability nets 5600, platform_commission nets 2400', async () => {
    const created = await postEvent(conversionBody('rev-1', chain1.clickRef), ORG1);
    expect(created.statusCode).toBe(202);
    const conversionId = String(created.json().data.conversion_id);

    const res = await postEvent(
      {
        kind: 'reversal',
        provider_account_id: 'acct-1',
        source_transaction_id: 'rev-1',
        line_id: 'line-1',
        reversal_commission_minor: 8000,
        provider_revision: 2,
        reason: 'customer return',
      },
      ORG1,
    );
    expect(res.statusCode).toBe(202);
    expect(res.json().data.conversion_id).toBe(conversionId);
    expect(res.json().data.ledger).toBe('posted');

    const nets = await accountNets(ORG1, conversionId);
    // 16000 @7000bps: publisher 11200 - 5600; platform 4800 - 2400.
    expect(nets.get('publisher_liability')).toBe(5600);
    expect(nets.get('platform_commission')).toBe(2400);
    expect(nets.get('merchant_receivable')).toBe(-8000);
  });

  it('rejects an over-reversal with 409', async () => {
    await postEvent(conversionBody('rev-2', chain1.clickRef), ORG1);
    const res = await postEvent(
      {
        kind: 'reversal',
        provider_account_id: 'acct-1',
        source_transaction_id: 'rev-2',
        line_id: 'line-1',
        reversal_commission_minor: 99999,
      },
      ORG1,
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('returns 404 when reversing an unknown transaction', async () => {
    const res = await postEvent(
      {
        kind: 'reversal',
        provider_account_id: 'acct-1',
        source_transaction_id: 'txn-never-seen',
        line_id: 'line-1',
        reversal_commission_minor: 100,
      },
      ORG1,
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('payout prepare gates', () => {
  beforeEach(async () => {
    await cleanOrgMoney(ORG2);
  });

  async function prepareBatch(orgId: string, user = USERS.OP) {
    return app.inject({
      method: 'POST',
      url: '/v1/payout-batches',
      headers: bearer(user, orgId),
      payload: { currency: 'INR' },
    });
  }

  // Publisher A: mature 8000-minor conversion @7000bps -> 5600 eligible.
  // Publisher B: mature 16000-minor conversion @7000bps -> 11200 eligible,
  //   but a 50000 threshold keeps B out of every batch.
  async function setupCapScenario() {
    const a = await postEvent(
      conversionBody('cap-a', chainA.clickRef, {
        commission_minor: 8000,
        eligible_value_minor: 50000,
        occurred_at: daysAgo(40),
      }),
      ORG2,
    );
    expect(a.statusCode).toBe(202);
    const b = await postEvent(
      conversionBody('cap-b', chainB.clickRef, { occurred_at: daysAgo(40) }),
      ORG2,
    );
    expect(b.statusCode).toBe(202);
    await pool.query(
      `insert into merchant_settlements (org_id, programme_id, currency, amount_minor, statement_ref)
       values ($1, $2, 'INR', 1000, 'stmt-a')`,
      [ORG2, chainA.programmeId],
    );
    await pool.query(
      `insert into merchant_settlements (org_id, programme_id, currency, amount_minor, statement_ref)
       values ($1, $2, 'INR', 100000, 'stmt-b')`,
      [ORG2, chainB.programmeId],
    );
  }

  it('blocks prepare with 409 LEDGER_IMBALANCE when the books do not balance', async () => {
    await pool.query(
      `insert into ledger_entries (org_id, currency, account, debit_minor, credit_minor, idempotency_key)
       values ($1, 'INR', 'merchant_receivable', 100, 0, 'evil-imbalance-1')`,
      [ORG2],
    );
    const res = await prepareBatch(ORG2);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LEDGER_IMBALANCE');
    await pool.query(`delete from ledger_entries where org_id = $1 and idempotency_key = 'evil-imbalance-1'`, [ORG2]);
  });

  it('excludes conversions inside the returns window: 1-day-old earning with a 30d window -> 422', async () => {
    // Posted and ledged, but occurred 1 day ago — inside the 30d window.
    const created = await postEvent(
      conversionBody('fresh-1', chainA.clickRef, { occurred_at: daysAgo(1) }),
      ORG2,
    );
    expect(created.statusCode).toBe(202);
    expect(created.json().data.ledger).toBe('posted');
    // Plenty of collected cash, so the collected cap cannot be the cause.
    await pool.query(
      `insert into merchant_settlements (org_id, programme_id, currency, amount_minor, statement_ref)
       values ($1, $2, 'INR', 100000, 'stmt-fresh')`,
      [ORG2, chainA.programmeId],
    );

    const res = await prepareBatch(ORG2);
    expect(res.statusCode).toBe(422);
  });

  it('caps the batch item at collected cash: 5600 eligible vs 1000 settled -> item 1000', async () => {
    await setupCapScenario();
    const res = await prepareBatch(ORG2);
    expect(res.statusCode).toBe(201);
    const items = res.json().data.items as Array<{ publisher_id: string; amount_minor: number }>;
    expect(items).toHaveLength(1);
    expect(items[0]!.publisher_id).toBe(chainA.publisherId);
    expect(items[0]!.amount_minor).toBe(1000);
  });

  it('excludes publishers below their threshold even when collected cash is ample', async () => {
    await setupCapScenario();
    const res = await prepareBatch(ORG2);
    expect(res.statusCode).toBe(201);
    const items = res.json().data.items as Array<{ publisher_id: string; amount_minor: number }>;
    // Publisher B: 11200 eligible, 100000 collected, but threshold 50000.
    expect(items.some((i) => i.publisher_id === chainB.publisherId)).toBe(false);
  });

  it('enforces maker-checker: the preparer cannot approve their own batch (403)', async () => {
    await setupCapScenario();
    const prepared = await prepareBatch(ORG2, USERS.AP);
    expect(prepared.statusCode).toBe(201);
    const batchId = String(prepared.json().data.id);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/payout-batches/${batchId}/approve`,
      headers: bearer(USERS.AP, ORG2),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });
});

describe('payout completion', () => {
  beforeEach(async () => {
    await cleanOrgMoney(ORG2);
  });

  async function prepareApproveDisburse(txn: string, settlement: number) {
    const created = await postEvent(
      conversionBody(txn, chainA.clickRef, {
        commission_minor: 8000,
        eligible_value_minor: 50000,
        occurred_at: daysAgo(40),
      }),
      ORG2,
    );
    expect(created.statusCode).toBe(202);
    await pool.query(
      `insert into merchant_settlements (org_id, programme_id, currency, amount_minor, statement_ref)
       values ($1, $2, 'INR', $3, 'stmt')`,
      [ORG2, chainA.programmeId, String(settlement)],
    );

    const prepared = await app.inject({
      method: 'POST',
      url: '/v1/payout-batches',
      headers: bearer(USERS.OP, ORG2),
      payload: { currency: 'INR' },
    });
    expect(prepared.statusCode).toBe(201);
    const batchId = String(prepared.json().data.id);

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/payout-batches/${batchId}/approve`,
      headers: bearer(USERS.AP, ORG2),
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.status).toBe('approved');

    const disbursed = await app.inject({
      method: 'POST',
      url: `/v1/payout-batches/${batchId}/disburse`,
      headers: bearer(USERS.OP, ORG2),
    });
    expect(disbursed.statusCode).toBe(200);
    expect(disbursed.json().data.status).toBe('processing');
    return { batchId, disbursed: disbursed.json().data };
  }

  async function payoutCallback(providerRef: string, outcome: string) {
    return app.inject({
      method: 'POST',
      url: '/v1/integrations/stub-network/payout-callback',
      headers: bearer(USERS.AD, ORG2),
      payload: { provider_ref: providerRef, outcome },
    });
  }

  async function batchStatus(batchId: string): Promise<string> {
    const { rows } = await pool.query(`select status from payout_batches where id = $1`, [batchId]);
    return String(rows[0]!.status);
  }

  it('approve -> disburse -> callback paid: batch paid, publisher_liability nets to 0, books balanced', async () => {
    // Settlement covers the full 5600 eligible: the item equals the whole liability.
    const { batchId, disbursed } = await prepareApproveDisburse('done-1', 100000);
    const transfers = disbursed.transfers as Array<{ provider_ref: string; status: string }>;
    expect(transfers).toHaveLength(1);
    expect(transfers[0]!.status).toBe('processing');
    expect(transfers[0]!.provider_ref.startsWith('stub-')).toBe(true);

    const cb = await payoutCallback(transfers[0]!.provider_ref, 'paid');
    expect(cb.statusCode).toBe(200);
    expect(cb.json().data.batch_status).toBe('paid');

    expect(await batchStatus(batchId)).toBe('paid');

    // The payout entries relieved the full liability: 5600 Cr - 5600 Dr = 0.
    const { rows } = await pool.query(
      `select debit_minor, credit_minor from ledger_entries
        where org_id = $1 and account = 'publisher_liability' and publisher_id = $2`,
      [ORG2, chainA.publisherId],
    );
    const net = rows.reduce(
      (s: number, r: { debit_minor: number; credit_minor: number }) =>
        s + (Number(r.credit_minor) - Number(r.debit_minor)),
      0,
    );
    expect(net).toBe(0);

    // Completion entries (Dr liability / Cr payout_clearing) keep the books balanced.
    const report = await checkBooksBalanced(async (sql, params) => {
      const r = await pool.query(sql, params as unknown[]);
      return { rows: r.rows as Array<{ currency: string; debit: string; credit: string }> };
    }, ORG2);
    expect(report.balanced).toBe(true);
  });

  it("refuses to re-disburse an 'unknown' transfer without a fresh status query (TRANSFER_STATUS_UNKNOWN)", async () => {
    const { batchId, disbursed } = await prepareApproveDisburse('unk-1', 100000);
    const transfers = disbursed.transfers as Array<{ provider_ref: string; status: string }>;

    const cb = await payoutCallback(transfers[0]!.provider_ref, 'unknown');
    expect(cb.statusCode).toBe(200);
    expect(cb.json().data.batch_status).toBe('processing');

    const retry = await app.inject({
      method: 'POST',
      url: `/v1/payout-batches/${batchId}/disburse`,
      headers: bearer(USERS.OP, ORG2),
    });
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe('TRANSFER_STATUS_UNKNOWN');
  });

  it('status-query arms the unknown guard: re-disburse then succeeds without duplicating the transfer', async () => {
    const { batchId, disbursed } = await prepareApproveDisburse('unk-2', 100000);
    const transfers = disbursed.transfers as Array<{ provider_ref: string; status: string }>;
    const providerRef = transfers[0]!.provider_ref;

    const cb = await payoutCallback(providerRef, 'unknown');
    expect(cb.statusCode).toBe(200);
    expect(cb.json().data.batch_status).toBe('processing');

    // Blind retry is refused…
    const retry = await app.inject({
      method: 'POST',
      url: `/v1/payout-batches/${batchId}/disburse`,
      headers: bearer(USERS.OP, ORG2),
    });
    expect(retry.statusCode).toBe(409);

    // …then a status query arms the guard…
    const q = await app.inject({
      method: 'POST',
      url: `/v1/payout-transfers/${providerRef}/status-query`,
      headers: bearer(USERS.OP, ORG2),
    });
    expect(q.statusCode).toBe(200);
    expect(q.json().data.provider_ref).toBe(providerRef);
    expect(q.json().data.status).toBe('unknown');
    expect(q.json().data.last_status_query_at).toBeTruthy();

    // …and re-disburse succeeds, re-initiating the SAME transfer row.
    const retry2 = await app.inject({
      method: 'POST',
      url: `/v1/payout-batches/${batchId}/disburse`,
      headers: bearer(USERS.OP, ORG2),
    });
    expect(retry2.statusCode).toBe(200);
    expect(retry2.json().data.status).toBe('processing');

    const rows = await pool.query(
      `select provider_ref, status from payout_transfers where payout_batch_id = $1`,
      [batchId],
    );
    expect(rows.rows).toHaveLength(1); // never a duplicate transfer row → no double payout
    expect(rows.rows[0]!.provider_ref).toBe(providerRef);
    expect(rows.rows[0]!.status).toBe('processing');
  });

  it('status-query returns 404 for an unknown provider_ref', async () => {
    const q = await app.inject({
      method: 'POST',
      url: '/v1/payout-transfers/stub-does-not-exist/status-query',
      headers: bearer(USERS.OP, ORG2),
    });
    expect(q.statusCode).toBe(404);
    expect(q.json().error.code).toBe('NOT_FOUND');
  });
});
