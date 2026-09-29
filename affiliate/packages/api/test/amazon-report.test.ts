// Amazon.in Associates earnings-report import and tracking-ID attribution:
// the layout table (header-driven, BOM / title line / quotes, TSV or CSV,
// unknown layout refused), exact paise, stable keys, 10 identical imports =
// 1 financial effect, a changed amount refused (409, nothing written),
// tracking ID → the ONE mapped placement → the same ledger / contract logic
// as a click (11200 / 4800 at 70/30), returns as reversals (5600 / 2400 after
// half), unknown / default / too-new tracking IDs and sub-tag conflicts →
// suspense, revision ordering on the tracking-ID path, and the suspense retry.
// pg-mem; TEST data only.

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_amazon_report';
process.env.JWT_SECRET ??= 'amazon-report-test-secret';
process.env.API_PORT ??= '0';

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { checkBooksBalanced } from '@paparazzi/shared';
import { createTestDb } from './pgmem.js';
import { AMZ, declarations, earningsTsv, seedOwnNetwork, type OwnNetwork, type PoolLike } from './amazon-fixtures.js';
import { parseEarningsReport, parseReportDate, EARNINGS_COLUMNS } from '../src/amazon/report-format.js';
import type * as SetupModule from '../src/amazon/setup.js';
import type * as IngestModule from '../src/conversion-ingest.js';

let pool: PoolLike;
let app: FastifyInstance;
let net: OwnNetwork;
let summary: SetupModule.AmazonSetupSummary;
let ingest: typeof IngestModule;

const ORG = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const ADMIN = { id: '00000000-0000-0000-0000-00000000b001', role: 'network_admin' };
const EDITOR = { id: '00000000-0000-0000-0000-00000000b002', role: 'editor' };
const OPS = { id: '00000000-0000-0000-0000-00000000b003', role: 'finance_operator' };

const bearer = (user: { id: string; role: string }) => ({
  authorization: `Bearer ${jwt.sign({ sub: user.id, org_id: ORG, role: user.role }, process.env.JWT_SECRET as string)}`,
});

async function importReport(text: string, filename = 'earnings-test.tsv') {
  return app.inject({
    method: 'POST',
    url: '/v1/integrations/amazon-associates/reports',
    headers: bearer(EDITOR),
    payload: { filename, report_text: text },
  });
}

async function conversionBy(sourcePrefix: string) {
  const { rows } = await pool.query(
    `select id, click_id, placement_id, status, suspense_reason, returned_tracking_ref, item_ref,
            eligible_value_minor, commission_minor, contract_version_id
       from conversions where org_id = $1 and source_transaction_id like $2 order by received_at, id`,
    [ORG, `${sourcePrefix}%`],
  );
  return rows;
}

async function ledgerFor(conversionId: string) {
  const { rows } = await pool.query(
    `select account, debit_minor, credit_minor, publisher_id, idempotency_key
       from ledger_entries where org_id = $1 and (conversion_id = $2 or adjustment_id in (select id from adjustments where conversion_id = $2))
      order by idempotency_key, account`,
    [ORG, conversionId],
  );
  return rows.map((r) => ({ ...r, debit_minor: Number(r.debit_minor), credit_minor: Number(r.credit_minor) }));
}

async function publisherNet(publisherId: string): Promise<number> {
  const { rows } = await pool.query(
    `select coalesce(sum(credit_minor - debit_minor), 0) as net from ledger_entries
      where org_id = $1 and account = 'publisher_liability' and publisher_id = $2`,
    [ORG, publisherId],
  );
  return Number(rows[0]!.net);
}

async function booksBalanced(): Promise<boolean> {
  const r = await checkBooksBalanced(
    async (sql, params) => ({ rows: (await pool.query(sql, params as unknown[])).rows as Array<{ currency: string; debit: string; credit: string }> }),
    ORG,
  );
  return r.imbalances.length === 0;
}

const log = { info: () => undefined } as unknown as IngestModule.IngestLog;

beforeAll(async () => {
  const tdb = createTestDb({ rollback: true });
  pool = new tdb.Pool();
  const dbMod = await import('../src/db.js');
  dbMod.__setPool(pool as unknown as Parameters<typeof dbMod.__setPool>[0]);
  const { buildApp } = await import('../src/index.js');
  app = await buildApp();
  await app.ready();
  ingest = await import('../src/conversion-ingest.js');
  const setup = await import('../src/amazon/setup.js');

  net = await seedOwnNetwork(pool, ORG, 'amzreport', ADMIN.id);
  for (const u of [EDITOR, OPS]) await pool.query(`insert into users (id, email) values ($1, $2)`, [u.id, `${u.role}@amzreport.example.com`]);
  // Mappings effective from a date before the report rows (the CLI stamps
  // "now"; the tests backdate the rows instead of the mappings).
  summary = await setup.setupAmazonAssociates({
    orgSlug: net.slug,
    storeId: AMZ.STORE,
    declarations: declarations(net),
    publisherShareBps: 7000,
    now: new Date('2026-09-01T00:00:00Z'),
  });
}, 30000);

describe('report layout (src/amazon/report-format.ts)', () => {
  it('reads the documented TSV with a title line and a BOM, header-driven', () => {
    const r = parseEarningsReport(earningsTsv([{}], { title: true, bom: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.delimiter).toBe('tab');
    expect(r.report.headerRow).toBe(2);
    expect(r.report.currency).toBe('INR');
    expect(r.report.rows[0]).toMatchObject({
      kind: 'shipped',
      trackingId: AMZ.IG_TAG,
      asin: AMZ.ASIN,
      date: '2026-09-20',
      revenueMinor: 100000,
      adFeesMinor: 16000,
      priceMinor: 100000,
      itemsShipped: 1,
    });
  });

  it('reads the comma-separated form with quoted grouped numbers and columns in another order', () => {
    const csv =
      'Name,Tracking ID,ASIN,Items Dispatched,Date Dispatched,Earnings (₹),Revenue (₹)\n' +
      `"Demo Kettle, 1.5 L",${AMZ.IG_TAG},${AMZ.ASIN},2,"Sep 20, 2026",320.00,"2,000.00"\n`;
    const r = parseEarningsReport(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.delimiter).toBe('comma');
    expect(r.report.rows[0]).toMatchObject({ itemsShipped: 2, date: '2026-09-20', revenueMinor: 200000, adFeesMinor: 32000, itemName: 'Demo Kettle, 1.5 L' });
  });

  it('refuses an unknown layout, the XML download and another currency with a clear message', () => {
    const unknown = parseEarningsReport('Date\tClicks\tConversion\n2026-09-20\t10\t1\n');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.message).toMatch(/Unknown report layout/);
      expect(unknown.message).toMatch(/tracking id, asin, date shipped, items shipped, revenue, ad fees/);
      expect(unknown.message).toMatch(/EARNINGS_COLUMNS/);
    }
    const xml = parseEarningsReport('<?xml version="1.0"?><Data/>');
    expect(xml.ok).toBe(false);
    if (!xml.ok) expect(xml.message).toMatch(/XML download/);
    const usd = parseEarningsReport(earningsTsv([{}]).replace(/\(Rs\.\)/g, '($)'));
    expect(usd.ok).toBe(false);
    if (!usd.ok) expect(usd.message).toMatch(/USD/);
  });

  it('money is exact: a third decimal, a float-looking or a symbol-prefixed value refuses the whole file', () => {
    for (const bad of ['160.005', '1.6e2', '₹160.00', '160.5']) {
      const r = parseEarningsReport(earningsTsv([{}, { 'Ad Fees(Rs.)': bad }]));
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.errors[0]!.row).toBe(3);
    }
  });

  it('dates: ISO and month names only; a numeric day/month form is refused (never guessed)', () => {
    expect(parseReportDate('2026-09-20')).toBe('2026-09-20');
    expect(parseReportDate('2026-09-20 13:45:00')).toBe('2026-09-20');
    expect(parseReportDate('20 Sep 2026')).toBe('2026-09-20');
    expect(parseReportDate('20-Sep-2026')).toBe('2026-09-20');
    expect(parseReportDate('September 20, 2026')).toBe('2026-09-20');
    expect(parseReportDate('09/10/2026')).toBeNull();
    expect(parseReportDate('2026-02-30')).toBeNull();
  });

  it('a row mixing shipped and returned values is refused (layout to confirm)', () => {
    const r = parseEarningsReport(earningsTsv([{ Returns: '1' }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.reason).toMatch(/mixes shipped and returned/);
  });

  it('the shipped TEST fixtures parse (they are what the CLI docs and the end-to-end run use)', async () => {
    const fx = (f: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', f), 'utf8');
    const earnings = parseEarningsReport(fx('amazon-earnings.example.tsv'));
    expect(earnings.ok).toBe(true);
    if (earnings.ok) expect(earnings.report.rows.map((r) => [r.kind, r.trackingId, r.adFeesMinor])).toEqual([
      ['shipped', 'demo-ig-21', 16000],
      ['shipped', 'demo-fb-21', 7984],
      ['shipped', 'demo-unknown-21', 16000],
      ['shipped', 'demo-fb-21', 3992],
    ]);
    const returns = parseEarningsReport(fx('amazon-earnings-returns.example.tsv'));
    expect(returns.ok && returns.report.rows[0]).toMatchObject({ kind: 'return', adFeesMinor: -8000, returns: 1 });
    const setup = await import('../src/amazon/setup.js');
    expect(setup.parsePropertiesFile(fx('amazon-properties.example.csv')).problems).toEqual([]);
    const offers = await import('../src/amazon/offers.js');
    expect(offers.parseOffersFile(fx('amazon-offers.example.csv')).offers.map((o) => o.asin)).toEqual(['B0DEMO0001', 'B0DEMO0002']);
  });

  it('the CLI flag parser (src/cli/amazon.ts); the removed flags are refused with their reason', async () => {
    const { parseFlags } = await import('../src/cli/amazon.js');
    const { command, flags } = parseFlags(['offers', '--file', 'x.csv', '--reactivate', '--ttl-days=30']);
    expect(command).toBe('offers');
    expect(Object.fromEntries(flags)).toEqual({ file: 'x.csv', reactivate: true, 'ttl-days': '30' });
    expect(() => parseFlags(['setup', '--store-id'])).toThrow(/needs a value/);
    expect(() => parseFlags(['setup', '--all-owner-operated'])).toThrow(/removed: declare exactly the pages/);
    expect(() => parseFlags(['setup', '--third-party-publishers-allowed'])).toThrow(/removed: .*own properties only/);
    expect(() => parseFlags(['setup', '--subtag-approval-ref', 'X'])).toThrow(/removed: no click id/);
    expect(() => parseFlags(['setup', '--subtag-param=ascsubtag'])).toThrow(/removed: no click id/);
  });

  it('the column table names every required field once', () => {
    const required = Object.entries(EARNINGS_COLUMNS).filter(([, s]) => s.required).map(([f]) => f);
    expect(required.sort()).toEqual(['ad_fees', 'asin', 'date', 'items_shipped', 'revenue', 'tracking_id']);
  });
});

describe('POST /v1/integrations/amazon-associates/reports', () => {
  it('a shipped row with a mapped tracking ID is attributed to that placement: 11200 / 4800 at 70/30, balanced', async () => {
    const res = await importReport(earningsTsv([{}], { title: true }));
    expect(res.statusCode).toBe(202);
    const data = res.json().data;
    expect(data.shipped).toMatchObject({ created: 1, attributed_tracking_id: 1, suspense: 0 });
    const [c] = await conversionBy('amzn-earn:2026-09-20:B0DEMO0001');
    expect(c).toMatchObject({
      click_id: null,
      placement_id: summary.placements.find((p) => p.platform === 'instagram')!.placement_id,
      status: 'approved',
      returned_tracking_ref: AMZ.IG_TAG,
      item_ref: AMZ.ASIN,
      suspense_reason: null,
    });
    expect(Number(c!.commission_minor)).toBe(16000);
    expect(c!.contract_version_id).toBe(summary.campaigns[0]!.contract_id);
    const entries = await ledgerFor(String(c!.id));
    expect(entries.map((e) => [e.account, e.debit_minor, e.credit_minor])).toEqual([
      ['merchant_receivable', 16000, 0],
      ['platform_commission', 0, 4800],
      ['publisher_liability', 0, 11200],
    ]);
    expect(entries.find((e) => e.account === 'publisher_liability')!.publisher_id).toBe(net.publisherId);
    expect(await booksBalanced()).toBe(true);
  });

  it('10 identical imports = 1 conversion and 1 financial effect', async () => {
    const text = earningsTsv([{ 'Date Shipped': '2026-09-21' }]);
    for (let i = 0; i < 10; i += 1) {
      const res = await importReport(text);
      expect(res.statusCode).toBe(202);
      expect(res.json().data.shipped.created).toBe(i === 0 ? 1 : 0);
    }
    const rows = await conversionBy('amzn-earn:2026-09-21:');
    expect(rows).toHaveLength(1);
    expect(await ledgerFor(String(rows[0]!.id))).toHaveLength(3);
  });

  it('a row imported before with a different amount refuses the whole file (409), writing nothing', async () => {
    const before = (await pool.query(`select count(*)::int as n from conversions where org_id = $1`, [ORG])).rows[0]!.n;
    const res = await importReport(
      earningsTsv([{ 'Date Shipped': '2026-09-22' }, { 'Date Shipped': '2026-09-21', 'Ad Fees(Rs.)': '170.00' }]),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
    expect(res.json().errors[0].row).toBe(3);
    expect((await pool.query(`select count(*)::int as n from conversions where org_id = $1`, [ORG])).rows[0]!.n).toBe(before);
  });

  it('two rows the report does not tell apart refuse the file (422)', async () => {
    const res = await importReport(earningsTsv([{ 'Date Shipped': '2026-09-23' }, { 'Date Shipped': '2026-09-23' }]));
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0].reason).toMatch(/as row 2/);
  });

  it('unknown tracking ID, the store ID, a mapping younger than the sale → suspense, never guessed', async () => {
    const res = await importReport(
      earningsTsv([
        { 'Date Shipped': '2026-09-24', 'Tracking ID': 'demo-unknown-21' },
        { 'Date Shipped': '2026-09-24', 'Tracking ID': AMZ.STORE },
        { 'Date Shipped': '2026-08-15', 'Tracking ID': AMZ.FB_TAG },
      ]),
    );
    expect(res.statusCode).toBe(202);
    expect(res.json().data.shipped).toMatchObject({ created: 3, attributed_tracking_id: 0, suspense: 3 });
    const reasons = Object.fromEntries(
      [...(await conversionBy('amzn-earn:2026-09-24:')), ...(await conversionBy('amzn-earn:2026-08-15:'))].map((c) => [
        c.returned_tracking_ref,
        [c.suspense_reason, c.placement_id, c.click_id],
      ]),
    );
    expect(reasons).toEqual({
      'demo-unknown-21': ['TRACKING_ID_UNMAPPED', null, null],
      [AMZ.STORE]: ['TRACKING_ID_IS_STORE_DEFAULT', null, null],
      [AMZ.FB_TAG]: ['TRACKING_ID_MAPPED_AFTER_SALE', null, null],
    });
    // Unposted: nothing in the ledger for any of them.
    for (const c of await conversionBy('amzn-earn:2026-09-24:')) expect(await ledgerFor(String(c.id))).toEqual([]);

    const queue = await app.inject({ method: 'GET', url: '/v1/suspense', headers: bearer(OPS) });
    expect(queue.statusCode).toBe(200);
    const items = queue.json().data.items as Array<{ returned_tracking_ref: string; reason_code: string }>;
    expect(items.find((i) => i.returned_tracking_ref === 'demo-unknown-21')?.reason_code).toBe('TRACKING_ID_UNMAPPED');
    expect(items.find((i) => i.returned_tracking_ref === AMZ.STORE)?.reason_code).toBe('TRACKING_ID_IS_STORE_DEFAULT');
    // Attributed rows are not in the queue.
    expect(items.some((i) => i.returned_tracking_ref === AMZ.IG_TAG)).toBe(false);
  });

  it('suspense retry re-runs the same exact rules: an unmapped tracking ID stays unattributed', async () => {
    const [c] = await conversionBy('amzn-earn:2026-09-24:');
    const unmapped = (await conversionBy('amzn-earn:2026-09-24:')).find((x) => x.returned_tracking_ref === 'demo-unknown-21')!;
    expect(c).toBeDefined();
    const retry = await app.inject({ method: 'POST', url: `/v1/suspense/${unmapped.id}/retry`, headers: bearer(OPS) });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data).toMatchObject({ attributed: false, reason: 'TRACKING_ID_UNMAPPED' });
  });

  it('a return row reverses the matching sale once: 5600 / 2400 remain after half; a re-import is a no-op', async () => {
    const [sale] = await conversionBy('amzn-earn:2026-09-20:B0DEMO0001');
    const text = earningsTsv([
      { 'Date Shipped': '2026-09-26', 'Items Shipped': '0', Returns: '1', 'Revenue(Rs.)': '-500.00', 'Ad Fees(Rs.)': '-80.00' },
    ]);
    // Before: the 2026-09-20 sale and the 2026-09-21 one share tracking ID and ASIN, so the return is
    // AMBIGUOUS and must not be applied.
    const ambiguous = await importReport(text);
    expect(ambiguous.statusCode).toBe(202);
    expect(ambiguous.json().data.returns).toEqual({ applied: 0, deduped: 0, unmatched: 1 });
    expect(ambiguous.json().data.unmatched_returns[0]).toMatchObject({ reason: 'AMBIGUOUS', fee_minor: -8000 });
    expect((await pool.query(`select count(*)::int as n from adjustments where org_id = $1`, [ORG])).rows[0]!.n).toBe(0);

    // A return for an ASIN with exactly one sale on that tracking ID is applied.
    const one = await importReport(
      earningsTsv([
        { 'Date Shipped': '2026-09-20', ASIN: AMZ.ASIN2, 'Tracking ID': AMZ.FB_TAG },
        { 'Date Shipped': '2026-09-27', ASIN: AMZ.ASIN2, 'Tracking ID': AMZ.FB_TAG, 'Items Shipped': '0', Returns: '1', 'Revenue(Rs.)': '-500.00', 'Ad Fees(Rs.)': '-80.00' },
      ]),
    );
    expect(one.statusCode).toBe(202);
    expect(one.json().data.returns).toEqual({ applied: 1, deduped: 0, unmatched: 0 });
    const [fbSale] = await conversionBy(`amzn-earn:2026-09-20:${AMZ.ASIN2}`);
    const entries = await ledgerFor(String(fbSale!.id));
    const netOf = (account: string) =>
      entries.filter((e) => e.account === account).reduce((s, e) => s + e.credit_minor - e.debit_minor, 0);
    expect(netOf('publisher_liability')).toBe(5600);
    expect(netOf('platform_commission')).toBe(2400);
    expect(await booksBalanced()).toBe(true);

    const again = await importReport(
      earningsTsv([
        { 'Date Shipped': '2026-09-20', ASIN: AMZ.ASIN2, 'Tracking ID': AMZ.FB_TAG },
        { 'Date Shipped': '2026-09-27', ASIN: AMZ.ASIN2, 'Tracking ID': AMZ.FB_TAG, 'Items Shipped': '0', Returns: '1', 'Revenue(Rs.)': '-500.00', 'Ad Fees(Rs.)': '-80.00' },
      ]),
    );
    expect(again.json().data.returns).toEqual({ applied: 0, deduped: 1, unmatched: 0 });
    expect(again.json().data.shipped.deduped).toBe(1);
    expect(await ledgerFor(String(fbSale!.id))).toHaveLength(entries.length);
    expect(sale).toBeDefined();
  });

  it('refuses the file when the org has no Amazon account for the body (404) and validates the body (400)', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/integrations/amazon-associates/reports',
      headers: bearer(EDITOR),
      payload: { account_id: '22222222-2222-2222-2222-222222222222', filename: 'x.tsv', report_text: 'x' },
    });
    expect(missing.statusCode).toBe(404);
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/integrations/amazon-associates/reports',
      headers: bearer(EDITOR),
      payload: { filename: 'x.tsv' },
    });
    expect(invalid.statusCode).toBe(400);
    const forbidden = await app.inject({
      method: 'POST',
      url: '/v1/integrations/amazon-associates/reports',
      headers: bearer(OPS),
      payload: { filename: 'x.tsv', report_text: 'x' },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe('tracking-ID attribution on the one money path (conversion-ingest.ts)', () => {
  const base = () => ({
    connector: 'amazon-associates',
    receivedVia: 'test',
    programmeId: summary.programme_id,
    providerAccountId: summary.account_ref,
    lineId: 'shipped',
    returnedClickRef: null,
    trackingRef: AMZ.IG_TAG,
    itemRef: AMZ.ASIN,
    currency: 'INR',
    eligibleValueMinor: 100000,
    commissionMinor: 16000,
    occurredAt: '2026-09-25T00:00:00.000Z',
  });

  it('revision ordering: pending → approved posts once; a delayed pending never downgrades; declined reverses', async () => {
    const stid = 'test-rev-ordering-1';
    const pending = await ingest.ingestConversionEvent(ORG, { ...base(), sourceTransactionId: stid, providerStatus: 'pending', providerRevision: 1 }, log);
    expect(pending).toMatchObject({ kind: 'created', status: 'pending', ledger: 'skipped' });
    const approved = await ingest.ingestConversionEvent(ORG, { ...base(), sourceTransactionId: stid, providerStatus: 'approved', providerRevision: 2 }, log);
    expect(approved).toMatchObject({ kind: 'status_changed', status: 'approved', ledger: 'posted' });
    const stale = await ingest.ingestConversionEvent(ORG, { ...base(), sourceTransactionId: stid, providerStatus: 'pending', providerRevision: 1 }, log);
    expect(stale.kind).toBe('deduped');
    const late = await ingest.ingestConversionEvent(ORG, { ...base(), sourceTransactionId: stid, providerStatus: 'pending', providerRevision: 3 }, log);
    expect(late).toMatchObject({ kind: 'deduped', status: 'approved' });
    const before = await publisherNet(net.publisherId);
    const reversed = await ingest.ingestConversionEvent(ORG, { ...base(), sourceTransactionId: stid, providerStatus: 'reversed', providerRevision: 4 }, log);
    expect(reversed).toMatchObject({ kind: 'auto_reversed', autoReversed: true, ledger: 'posted' });
    expect(before - (await publisherNet(net.publisherId))).toBe(11200);
    expect(await booksBalanced()).toBe(true);
  });

  it('a sub-tag that is a known click wins; a click whose tag disagrees with the tracking ID → ATTRIBUTION_CONFLICT', async () => {
    const ig = summary.placements.find((p) => p.platform === 'instagram')!;
    const { rows: o } = await pool.query(`select id from offers where org_id = $1 limit 1`, [ORG]);
    let offerId = o[0]?.id as string | undefined;
    if (!offerId) {
      const { rows: pr } = await pool.query(`insert into products (org_id, brand, model, category) values ($1, 'Demo Brand', 'Demo Kettle', 'Home') returning id`, [ORG]);
      const { rows: v } = await pool.query(`insert into variants (org_id, product_id, merchant_sku) values ($1, $2, $3) returning id`, [ORG, pr[0]!.id, AMZ.ASIN]);
      const { rows: m } = await pool.query(`select merchant_id from programmes where id = $1`, [summary.programme_id]);
      const { rows: of } = await pool.query(
        `insert into offers (org_id, variant_id, programme_id, merchant_id, price_minor, offer_url, fresh_until, status, merchant_item_ref)
         values ($1, $2, $3, $4, null, $5, now() + interval '30 days', 'active', $6) returning id`,
        [ORG, v[0]!.id, summary.programme_id, m[0]!.merchant_id, `https://www.amazon.in/dp/${AMZ.ASIN}`, AMZ.ASIN],
      );
      offerId = String(of[0]!.id);
    }
    const { rows: l } = await pool.query(
      `insert into links (org_id, token, placement_id, offer_id, route_signature) values ($1, $2, $3, $4, 'sig') returning id`,
      [ORG, 'a'.repeat(32), ig.placement_id, offerId],
    );
    await pool.query(`insert into clicks (org_id, link_id, click_id) values ($1, $2, 'demo-click-amz-1')`, [ORG, l[0]!.id]);

    const hit = await ingest.ingestConversionEvent(
      ORG,
      { ...base(), sourceTransactionId: 'test-subtag-1', returnedClickRef: 'demo-click-amz-1', providerStatus: 'approved', providerRevision: 0 },
      log,
    );
    const { rows: c1 } = await pool.query(`select click_id, placement_id, suspense_reason from conversions where id = $1`, [hit.conversionId]);
    expect(c1[0]!.click_id).not.toBeNull();
    expect(c1[0]!.placement_id).toBeNull();

    const conflict = await ingest.ingestConversionEvent(
      ORG,
      { ...base(), sourceTransactionId: 'test-subtag-2', returnedClickRef: 'demo-click-amz-1', trackingRef: AMZ.FB_TAG, providerStatus: 'approved', providerRevision: 0 },
      log,
    );
    expect(conflict).toMatchObject({ kind: 'created', ledger: 'skipped' });
    const { rows: c2 } = await pool.query(`select click_id, placement_id, suspense_reason from conversions where id = $1`, [conflict.conversionId]);
    expect(c2[0]).toEqual({ click_id: null, placement_id: null, suspense_reason: 'ATTRIBUTION_CONFLICT' });

    // An unknown sub-tag falls through to the tracking ID (the task's rule), exactly.
    const fallThrough = await ingest.ingestConversionEvent(
      ORG,
      { ...base(), sourceTransactionId: 'test-subtag-3', returnedClickRef: 'demo-click-unknown', providerStatus: 'approved', providerRevision: 0 },
      log,
    );
    const { rows: c3 } = await pool.query(`select click_id, placement_id from conversions where id = $1`, [fallThrough.conversionId]);
    expect(c3[0]).toEqual({ click_id: null, placement_id: ig.placement_id });
  });

  it('earnings: tracking-ID conversions count in the publisher balance like click-attributed ones', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/publisher/earnings?publisher_id=${net.publisherId}`,
      headers: bearer(ADMIN),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.balances.INR.approved).toBe(await publisherNet(net.publisherId));
    expect(res.json().data.balances.INR.approved).toBeGreaterThan(0);
  });
});

describe('unmatched returns: the operator applies one to the sale they choose (src/amazon/returns.ts)', () => {
  const returnText = earningsTsv([
    { 'Date Shipped': '2026-09-26', 'Items Shipped': '0', Returns: '1', 'Revenue(Rs.)': '-500.00', 'Ad Fees(Rs.)': '-80.00' },
  ]);

  it('lists the ambiguous return with its candidate sales; applying it is deterministic (a re-run and a re-import do nothing)', async () => {
    const returns = await import('../src/amazon/returns.js');
    const { amazonAccountById } = await import('../src/amazon/account.js');
    const account = (await amazonAccountById(ORG, summary.account_id))!;
    const listed = await returns.listUnmatchedReturns(ORG, account);
    const r = listed.find((x) => x.date === '2026-09-26');
    expect(r).toMatchObject({ tracking_id: AMZ.IG_TAG, asin: AMZ.ASIN, fee_minor: 8000, reason: 'AMBIGUOUS', currency: 'INR' });
    expect(r!.candidates.length).toBeGreaterThanOrEqual(2);
    const [sale] = await conversionBy('amzn-earn:2026-09-20:B0DEMO0001');
    const candidate = r!.candidates.find((c) => c.conversion_id === sale!.id);
    expect(candidate).toMatchObject({ date: '2026-09-20', remainder_minor: 16000, attributed_by: 'tracking_id', dated_on_or_before_return: true });

    // Another item's sale is refused, writing nothing.
    const [fbSale] = await conversionBy(`amzn-earn:2026-09-20:${AMZ.ASIN2}`);
    const wrong = await returns.applyUnmatchedReturn(ORG, account, { returnKey: r!.return_key, conversionId: String(fbSale!.id), actorId: null });
    expect(wrong).toMatchObject({ kind: 'refused' });
    expect(await returns.applyUnmatchedReturn(ORG, account, { returnKey: 'no-such-key', conversionId: String(sale!.id), actorId: null })).toMatchObject({
      kind: 'refused',
    });

    const before = await publisherNet(net.publisherId);
    const applied = await returns.applyUnmatchedReturn(ORG, account, { returnKey: r!.return_key, conversionId: String(sale!.id), actorId: ADMIN.id });
    expect(applied).toMatchObject({ kind: 'applied', conversionId: sale!.id, ledger: 'posted' });
    expect(before - (await publisherNet(net.publisherId))).toBe(5600);
    expect(await booksBalanced()).toBe(true);
    const audit = await pool.query(`select action, actor_id from audit_log where org_id = $1 and entity_id = $2`, [ORG, sale!.id]);
    expect(audit.rows).toEqual([{ action: 'amazon.return_applied', actor_id: ADMIN.id }]);

    const again = await returns.applyUnmatchedReturn(ORG, account, { returnKey: r!.return_key, conversionId: String(sale!.id), actorId: ADMIN.id });
    expect(again).toMatchObject({ kind: 'deduped' });
    // The same return row imported again dedupes on the same deterministic id.
    const reimport = await importReport(returnText);
    expect(reimport.json().data.returns).toEqual({ applied: 0, deduped: 1, unmatched: 0 });
    expect(before - (await publisherNet(net.publisherId))).toBe(5600);
    expect((await returns.listUnmatchedReturns(ORG, account)).some((x) => x.return_key === r!.return_key)).toBe(false);
  });

  it('a reversal never exceeds the commission: the atomic insert refuses what does not fit', async () => {
    const [sale] = await conversionBy('amzn-earn:2026-09-20:B0DEMO0001');
    // 16000 - 8000 already reversed = 8000 left.
    expect(
      await ingest.insertReversalWithinRemainder(ORG, {
        adjustmentId: ingest.deterministicUuid('test-atomic-1'),
        conversionId: String(sale!.id),
        commissionMinor: 8001,
        reason: 'test',
      }),
    ).toBe('exceeds');
    const id = ingest.deterministicUuid('test-atomic-2');
    expect(await ingest.insertReversalWithinRemainder(ORG, { adjustmentId: id, conversionId: String(sale!.id), commissionMinor: 8000, reason: 'test' })).toBe(
      'inserted',
    );
    expect(await ingest.insertReversalWithinRemainder(ORG, { adjustmentId: id, conversionId: String(sale!.id), commissionMinor: 8000, reason: 'test' })).toBe(
      'exists',
    );
    expect(
      await ingest.insertReversalWithinRemainder(ORG, {
        adjustmentId: ingest.deterministicUuid('test-atomic-3'),
        conversionId: String(sale!.id),
        commissionMinor: 1,
        reason: 'test',
      }),
    ).toBe('exceeds');
    const { rows } = await pool.query(`select coalesce(sum(commission_delta_minor), 0) as s from adjustments where org_id = $1 and conversion_id = $2`, [
      ORG,
      sale!.id,
    ]);
    expect(Number(rows[0]!.s)).toBe(16000);
  });

  it('one import at a time per account: while another holds the lock, an import is refused (409), writing nothing', async () => {
    const reportImport = await import('../src/amazon/report-import.js');
    const { amazonAccountById } = await import('../src/amazon/account.js');
    const account = (await amazonAccountById(ORG, summary.account_id))!;
    const held = await reportImport.acquireImportLock(ORG, account.account_ref, 0);
    expect(held).not.toBeNull();
    const count = async () => Number((await pool.query(`select count(*) as n from conversions where org_id = $1`, [ORG])).rows[0]!.n);
    const before = await count();
    try {
      const refused = await reportImport.importAmazonEarningsReport({
        orgId: ORG,
        account,
        text: earningsTsv([{ 'Date Shipped': '2026-09-29' }]),
        receivedVia: 'cli',
        log,
        lockWaitMs: 300,
      });
      expect(refused).toMatchObject({ ok: false, status: 409, code: 'CONFLICT' });
      expect(await count()).toBe(before);
    } finally {
      await reportImport.releaseImportLock(held!, ORG, account.account_ref);
    }
    const ok = await reportImport.importAmazonEarningsReport({
      orgId: ORG,
      account,
      text: earningsTsv([{ 'Date Shipped': '2026-09-29' }]),
      receivedVia: 'cli',
      log,
      lockWaitMs: 300,
    });
    expect(ok.ok).toBe(true);
    expect(await count()).toBe(before + 1);
  });
});

describe('the generic CSV and webhook adapters never write the Amazon report path', () => {
  const csv = (stid: string) =>
    'source_transaction_id,line_id,currency,eligible_value_minor,commission_minor,provider_status,occurred_at,provider_revision\n' +
    `${stid},shipped,INR,100000,16000,declined,2026-09-20T00:00:00.000Z,1\n`;

  it('CSV upload: the Amazon programme or the Amazon account_ref → 422, nothing written', async () => {
    const [sale] = await conversionBy(`amzn-earn:2026-09-20:${AMZ.ASIN2}`);
    const { rows } = await pool.query(`select source_transaction_id from conversions where id = $1`, [sale!.id]);
    const before = await publisherNet(net.publisherId);
    const byProgramme = await app.inject({
      method: 'POST',
      url: '/v1/integrations/csv/uploads',
      headers: bearer(EDITOR),
      payload: { provider_account_id: 'demo-other-acct', programme_id: summary.programme_id, filename: 'x.csv', csv_text: csv('demo-claim-1') },
    });
    expect(byProgramme.statusCode).toBe(422);
    expect(byProgramme.json().error.message).toMatch(/amazon-associates\/reports/);
    const { rows: other } = await pool.query(
      `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis)
       select org_id, merchant_id, 'stub-network', 'Demo CSV Programme', 'active', 'sale' from programmes where id = $1 returning id`,
      [summary.programme_id],
    );
    const byAccount = await app.inject({
      method: 'POST',
      url: '/v1/integrations/csv/uploads',
      headers: bearer(EDITOR),
      payload: { provider_account_id: summary.account_ref, programme_id: other[0]!.id, filename: 'x.csv', csv_text: csv(String(rows[0]!.source_transaction_id)) },
    });
    expect(byAccount.statusCode).toBe(422);
    expect(await publisherNet(net.publisherId)).toBe(before);
    expect((await pool.query(`select count(*)::int as n from conversions where source_transaction_id = 'demo-claim-1'`)).rows[0]!.n).toBe(0);
    await pool.query(`update programmes set status = 'paused' where id = $1`, [other[0]!.id]);
  });

  it('webhook (stub-network): the Amazon account_ref, a reversal of an Amazon sale → 422', async () => {
    const [sale] = await conversionBy(`amzn-earn:2026-09-20:${AMZ.ASIN2}`);
    const { rows } = await pool.query(`select source_transaction_id from conversions where id = $1`, [sale!.id]);
    const conv = await app.inject({
      method: 'POST',
      url: '/v1/integrations/stub-network/events',
      headers: bearer(EDITOR),
      payload: {
        provider_account_id: summary.account_ref,
        source_transaction_id: 'amzn-earn:2026-12-01:B0DEMO0001:claimed',
        line_id: 'shipped',
        currency: 'INR',
        eligible_value_minor: 100000,
        commission_minor: 16000,
        provider_status: 'approved',
        occurred_at: '2026-12-01T00:00:00.000Z',
      },
    });
    expect(conv.statusCode).toBe(422);
    const rev = await app.inject({
      method: 'POST',
      url: '/v1/integrations/stub-network/events',
      headers: bearer(EDITOR),
      payload: {
        kind: 'reversal',
        provider_account_id: summary.account_ref,
        source_transaction_id: rows[0]!.source_transaction_id,
        line_id: 'shipped',
        reversal_commission_minor: 100,
      },
    });
    expect(rev.statusCode).toBe(422);
  });

  it('the shared ingest refuses a non-Amazon connector on an Amazon programme (defence in depth)', async () => {
    await expect(
      ingest.ingestConversionEvent(
        ORG,
        {
          connector: 'csv',
          receivedVia: 'test',
          programmeId: summary.programme_id,
          providerAccountId: 'demo-other-acct',
          sourceTransactionId: 'demo-cross-1',
          lineId: 'x',
          returnedClickRef: null,
          currency: 'INR',
          eligibleValueMinor: 1,
          commissionMinor: 1,
          providerStatus: 'approved',
          providerRevision: 0,
          occurredAt: '2026-09-20T00:00:00.000Z',
        },
        log,
      ),
    ).rejects.toThrow('CONVERSION_PROGRAMME_CONNECTOR_MISMATCH');
  });
});
