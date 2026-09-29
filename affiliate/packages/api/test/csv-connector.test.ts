// CSV connector acceptance tests: POST /v1/integrations/csv/uploads against
// pg-mem.
//
// Same harness notes as money-loop.test.ts:
// - DATABASE_URL / JWT_SECRET are set below BEFORE the API modules are
//   imported (src/db.ts throws at import time without DATABASE_URL).
// - API_PORT=0 so the index.ts import side effect never collides with a
//   real server.
// - Auth is a JWT stub: only {sub, org_id, role} claims are verified.
// - Tests never send Idempotency-Key headers, so the header-idempotency
//   layer is a pass-through here; duplicate-delivery protection under test
//   comes from the provider-natural-key dedupe.
// - Known pg-mem gaps handled in test/pgmem.ts (gen_random_uuid impure,
//   ON CONFLICT (cols) rewritten, `unique nulls not distinct` -> `unique`
//   so every dedupe test supplies an explicit line_id).
//
// The "suspense list" assertion queries conversions with click_id IS NULL
// directly — that is the suspense queue's storage definition; the phase-4
// operations view will surface it via API.

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_test';
process.env.JWT_SECRET ??= 'csv-connector-test-secret';
process.env.API_PORT ??= '0';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { createTestDb, type TestDatabase } from './pgmem.js';

type PoolLike = TestDatabase['Pool'] extends new () => infer P ? P : never;

let pool: PoolLike;
let app: FastifyInstance;

const ORG = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const USERS = {
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

async function insertReturningId(text: string, params: unknown[]): Promise<string> {
  const { rows } = await pool.query(text, params);
  return String(rows[0]!.id);
}

// Minimal attributable chain: publisher -> property -> merchant -> programme
// (connector 'csv') -> contract -> product -> variant -> offer -> campaign ->
// placement -> link -> click.
async function seedChain(
  orgId: string,
  merchantId: string,
  opts: { publisher: string; clickRef: string; programme: string; programmeStatus?: string; bps: number },
): Promise<{ programmeId: string; clickRef: string }> {
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
     values ($1, $2, 'csv', $3, $4, 'sale', 30) returning id`,
    [orgId, merchantId, opts.programme, opts.programmeStatus ?? 'active'],
  );
  await insertReturningId(
    `insert into contracts (org_id, publisher_id, programme_id, version, publisher_share_bps, payout_threshold_minor, status)
     values ($1, $2, $3, 1, $4, 0, 'approved') returning id`,
    [orgId, publisherId, programmeId, opts.bps],
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
  return { programmeId, clickRef: opts.clickRef };
}

let progActive: string;
let progInactive: string;

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

  const dbMod = await import('../src/db.js');
  dbMod.__setPool(pool as unknown as Parameters<typeof dbMod.__setPool>[0]);
  const { buildApp } = await import('../src/index.js');
  app = await buildApp();
  await app.ready();

  await pool.query(`insert into organisations (id, name, slug) values ($1, 'org-csv', 'org-csv')`, [ORG]);
  for (const u of Object.values(USERS)) {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [u.id, `${u.role}@example.com`]);
  }
  const m = await insertReturningId(`insert into merchants (org_id, name) values ($1, 'm-csv') returning id`, [ORG]);

  const chain = await seedChain(ORG, m, {
    publisher: 'Pub CSV',
    clickRef: 'click-csv-1',
    programme: 'Prog CSV',
    bps: 7000,
  });
  progActive = chain.programmeId;
  const inactive = await seedChain(ORG, m, {
    publisher: 'Pub CSV Inactive',
    clickRef: 'click-csv-inactive',
    programme: 'Prog CSV Inactive',
    programmeStatus: 'paused',
    bps: 7000,
  });
  progInactive = inactive.programmeId;
}, 30000);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const UPLOADS = '/v1/integrations/csv/uploads';

const HEADER =
  'source_transaction_id,line_id,returned_click_ref,currency,eligible_value_minor,commission_minor,provider_status,provider_revision,occurred_at';

function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells
    .map((c) => {
      const s = c === null || c === undefined ? '' : String(c);
      // Quote when the field needs it (RFC 4180).
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

async function uploadCsv(
  csvText: string,
  opts: { programmeId?: string; providerAccountId?: string; filename?: string; orgId?: string } = {},
) {
  return app.inject({
    method: 'POST',
    url: UPLOADS,
    headers: bearer(USERS.ED, opts.orgId ?? ORG),
    payload: {
      provider_account_id: opts.providerAccountId ?? 'acct-csv',
      programme_id: opts.programmeId ?? progActive,
      filename: opts.filename ?? 'settlement.csv',
      csv_text: csvText,
    },
  });
}

async function countWhere(orgId: string, table: string, extra = '', params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as n from ${table} where org_id = $1 ${extra}`,
    [orgId, ...params],
  );
  return Number(rows[0]!.n);
}

async function conversionRow(
  orgId: string,
  txn: string,
): Promise<{ id: string; status: string; click_id: string | null } | null> {
  const { rows } = await pool.query(
    `select id, status, click_id from conversions where org_id = $1 and source_transaction_id = $2`,
    [orgId, txn],
  );
  const r = rows[0] as { id: string; status: string; click_id: string | null } | undefined;
  return r ? { id: String(r.id), status: String(r.status), click_id: r.click_id ? String(r.click_id) : null } : null;
}

async function ledgerCountForConversion(orgId: string, conversionId: string): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as n from ledger_entries where org_id = $1 and conversion_id = $2`,
    [orgId, conversionId],
  );
  return Number(rows[0]!.n);
}

/** Net (credit - debit) per account for a conversion. */
async function accountNets(orgId: string, conversionId: string): Promise<Map<string, number>> {
  const { rows } = await pool.query(
    `select account, debit_minor, credit_minor from ledger_entries
      where org_id = $1 and conversion_id = $2`,
    [orgId, conversionId],
  );
  const nets = new Map<string, number>();
  for (const r of rows as Array<{ account: string; debit_minor: number; credit_minor: number }>) {
    nets.set(r.account, (nets.get(r.account) ?? 0) + (Number(r.credit_minor) - Number(r.debit_minor)));
  }
  return nets;
}

const netsKey = (nets: Map<string, number>) =>
  JSON.stringify([...nets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Suspense queue: conversions whose attribution missed (click_id NULL). */
async function suspenseTxns(orgId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `select source_transaction_id from conversions where org_id = $1 and click_id is null`,
    [orgId],
  );
  return rows.map((r) => String((r as { source_transaction_id: string }).source_transaction_id));
}

const OCC = '2026-09-20T10:00:00.000Z';

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe('csv connector', () => {
  beforeEach(async () => {
    await cleanOrgMoney(ORG);
  });

  it('(a) duplicate full-file upload has exactly one financial effect', async () => {
    const csv = [
      HEADER,
      csvRow(['csv-dup-1', 'line-1', 'click-csv-1', 'INR', 100000, 16000, 'approved', 1, OCC]),
      csvRow(['csv-dup-2', 'line-1', 'click-csv-1', 'INR', 50000, 8000, 'pending', 1, OCC]),
    ].join('\n');

    const first = await uploadCsv(csv, { providerAccountId: 'acct-dup' });
    expect(first.statusCode).toBe(202);
    const firstBody = first.json().data;
    expect(firstBody.created).toBe(2);
    expect(firstBody.deduped).toBe(0);

    const ledgerAfterFirst = await countWhere(ORG, 'ledger_entries');
    const convAfterFirst = await countWhere(ORG, 'conversions');
    const outboxAfterFirst = await countWhere(ORG, 'outbox');
    expect(ledgerAfterFirst).toBeGreaterThan(0);

    const second = await uploadCsv(csv, { providerAccountId: 'acct-dup' });
    expect(second.statusCode).toBe(202);
    const secondBody = second.json().data;
    expect(secondBody.created).toBe(0);
    expect(secondBody.deduped).toBe(2);
    expect(secondBody.results.every((r: { outcome: string }) => r.outcome === 'deduped')).toBe(true);

    // Exactly one financial effect: no new conversions, ledger entries, or outbox events.
    expect(await countWhere(ORG, 'ledger_entries')).toBe(ledgerAfterFirst);
    expect(await countWhere(ORG, 'conversions')).toBe(convAfterFirst);
    expect(await countWhere(ORG, 'outbox')).toBe(outboxAfterFirst);
  });

  it('(b) malformed rows -> 422 with per-row reasons, zero conversions inserted', async () => {
    const csv = [
      HEADER,
      csvRow(['csv-bad-ok', 'line-1', 'click-csv-1', 'INR', 100000, 16000, 'approved', 1, OCC]), // valid — must NOT be ingested
      csvRow(['csv-bad-cur', 'line-1', 'click-csv-1', 'INRX', 100000, 16000, 'approved', 1, OCC]), // bad currency
      csvRow(['csv-bad-dec', 'line-1', 'click-csv-1', 'INR', 100000, '12.50', 'approved', 1, OCC]), // decimal money
      csvRow(['csv-bad-st', 'line-1', 'click-csv-1', 'INR', 100000, 16000, 'maybe', 1, OCC]), // bad status
      csvRow(['', 'line-1', 'click-csv-1', 'INR', 100000, 16000, 'approved', 1, OCC]), // missing required
    ].join('\n');

    const res = await uploadCsv(csv, { providerAccountId: 'acct-bad' });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    const errors = body.errors as Array<{ row: number; reason: string }>;
    expect(errors).toHaveLength(4);
    expect(errors.map((e) => e.row).sort()).toEqual([2, 3, 4, 5]);
    const byRow = new Map(errors.map((e) => [e.row, e.reason]));
    expect(byRow.get(2)).toMatch(/currency/i);
    expect(byRow.get(3)).toMatch(/commission_minor.*integer/i);
    expect(byRow.get(4)).toMatch(/provider_status/i);
    expect(byRow.get(5)).toMatch(/source_transaction_id/i);

    // All-or-nothing: not even the valid row was ingested.
    expect(await countWhere(ORG, 'conversions')).toBe(0);
    expect(await countWhere(ORG, 'ledger_entries')).toBe(0);
    expect(await countWhere(ORG, 'outbox')).toBe(0);
  });

  it('(c) out-of-order statuses: approved rev 2 then pending rev 1 stays approved, ledger unchanged', async () => {
    const approved = [
      HEADER,
      csvRow(['csv-ooo-1', 'line-1', 'click-csv-1', 'INR', 100000, 16000, 'approved', 2, OCC]),
    ].join('\n');
    const first = await uploadCsv(approved, { providerAccountId: 'acct-ooo' });
    expect(first.statusCode).toBe(202);
    const conv = await conversionRow(ORG, 'csv-ooo-1');
    expect(conv).not.toBeNull();
    expect(conv!.status).toBe('approved');
    const ledgerBefore = await ledgerCountForConversion(ORG, conv!.id);
    expect(ledgerBefore).toBeGreaterThan(0);

    const stalePending = [
      HEADER,
      csvRow(['csv-ooo-1', 'line-1', 'click-csv-1', 'INR', 100000, 16000, 'pending', 1, OCC]),
    ].join('\n');
    const second = await uploadCsv(stalePending, { providerAccountId: 'acct-ooo' });
    expect(second.statusCode).toBe(202);
    expect(second.json().data.results[0].outcome).toBe('deduped');

    const convAfter = await conversionRow(ORG, 'csv-ooo-1');
    expect(convAfter!.status).toBe('approved');
    expect(await ledgerCountForConversion(ORG, conv!.id)).toBe(ledgerBefore);
  });

  it('(d) unknown returned_click_ref -> suspense (click_id NULL)', async () => {
    const csv = [
      HEADER,
      csvRow(['csv-sus-1', 'line-1', 'no-such-click-ref', 'INR', 75000, 12000, 'approved', 1, OCC]),
    ].join('\n');
    const res = await uploadCsv(csv, { providerAccountId: 'acct-sus' });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.results[0].outcome).toBe('created');
    // Approved but unattributable: ledger skipped, never posted against a guess.
    expect(res.json().data.results[0].ledger).toBe('skipped');

    const conv = await conversionRow(ORG, 'csv-sus-1');
    expect(conv).not.toBeNull();
    expect(conv!.click_id).toBeNull();
    expect(await suspenseTxns(ORG)).toContain('csv-sus-1');
    expect(await ledgerCountForConversion(ORG, conv!.id)).toBe(0);

    // And it is visible in the suspense operations list.
    const list = await app.inject({
      method: 'GET',
      url: '/v1/suspense',
      headers: bearer(USERS.AD, ORG),
    });
    expect(list.statusCode).toBe(200);
    const items = list.json().data.items as Array<{ source_transaction_id: string; reason_code: string }>;
    const found = items.find((i) => i.source_transaction_id === 'csv-sus-1');
    expect(found).toBeDefined();
    expect(found!.reason_code).toBe('CLICK_REF_UNMATCHED');
  });

  it('(e) approved+attributable row posts the same ledger entries as the webhook event', async () => {
    // Webhook path first.
    const web = await app.inject({
      method: 'POST',
      url: '/v1/integrations/stub-network/events',
      headers: bearer(USERS.ED, ORG),
      payload: {
        provider_account_id: 'acct-parity',
        source_transaction_id: 'web-parity-1',
        line_id: 'line-1',
        returned_click_ref: 'click-csv-1',
        currency: 'INR',
        eligible_value_minor: 100000,
        commission_minor: 16000,
        provider_status: 'approved',
        provider_revision: 1,
        occurred_at: OCC,
      },
    });
    expect(web.statusCode).toBe(202);
    const webConv = await conversionRow(ORG, 'web-parity-1');
    expect(webConv).not.toBeNull();
    const webNets = await accountNets(ORG, webConv!.id);
    expect(webNets.size).toBeGreaterThan(0);

    // Equivalent CSV row.
    const csv = [
      HEADER,
      csvRow(['csv-parity-1', 'line-1', 'click-csv-1', 'INR', 100000, 16000, 'approved', 1, OCC]),
    ].join('\n');
    const res = await uploadCsv(csv, { providerAccountId: 'acct-parity' });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.results[0].ledger).toBe('posted');
    const csvConv = await conversionRow(ORG, 'csv-parity-1');
    expect(csvConv).not.toBeNull();
    const csvNets = await accountNets(ORG, csvConv!.id);

    expect(netsKey(csvNets)).toBe(netsKey(webNets));
  });

  it('(f) sample fixture uploads with the documented outcomes', async () => {
    const fixture = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample-settlement.csv'),
      'utf8',
    );
    const res = await uploadCsv(fixture, { providerAccountId: 'acct-fixture', filename: 'sample-settlement.csv' });
    expect(res.statusCode).toBe(202);
    const data = res.json().data;
    expect(data.rows_received).toBe(4);
    expect(data.created).toBe(4);

    const byTxn = new Map<string, { outcome: string; status: string; ledger?: string }>();
    for (const r of data.results as Array<{ row: number; outcome: string; status: string; ledger?: string }>) {
      byTxn.set(['csv-fixture-approved-1', 'csv-fixture-pending-1', 'csv-fixture-suspense-1', 'csv-fixture-declined-1'][r.row - 1]!, {
        outcome: r.outcome,
        status: r.status,
        ledger: r.ledger,
      });
    }
    expect(byTxn.get('csv-fixture-approved-1')).toMatchObject({ outcome: 'created', status: 'approved', ledger: 'posted' });
    expect(byTxn.get('csv-fixture-pending-1')).toMatchObject({ outcome: 'created', status: 'pending' });
    expect(byTxn.get('csv-fixture-suspense-1')).toMatchObject({ outcome: 'created', status: 'approved', ledger: 'skipped' });
    expect(byTxn.get('csv-fixture-declined-1')).toMatchObject({ outcome: 'created', status: 'declined' });

    // Suspense row is queryable as unattributed.
    expect(await suspenseTxns(ORG)).toContain('csv-fixture-suspense-1');
  });

  it('rejects unknown or inactive programmes before parsing rows', async () => {
    const csv = [HEADER, csvRow(['csv-pg-1', 'line-1', 'click-csv-1', 'INR', 100000, 16000, 'approved', 1, OCC])].join('\n');

    const unknown = await uploadCsv(csv, { programmeId: '00000000-0000-0000-0000-000000000099' });
    expect(unknown.statusCode).toBe(404);

    const inactive = await uploadCsv(csv, { programmeId: progInactive });
    expect(inactive.statusCode).toBe(422);
    expect(await countWhere(ORG, 'conversions')).toBe(0);
  });

  it('rejects an empty file with no data rows', async () => {
    const res = await uploadCsv(`${HEADER}\n\n`, { providerAccountId: 'acct-empty' });
    expect(res.statusCode).toBe(422);
    expect(await countWhere(ORG, 'conversions')).toBe(0);
  });
});
