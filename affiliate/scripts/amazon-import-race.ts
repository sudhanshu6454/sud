// SANDBOX GUARD — first, before any import side effect.
if (process.env.NODE_ENV === 'production') {
  console.error('REFUSING TO RUN: NODE_ENV=production. scripts/amazon-import-race.ts is sandbox-only (a scratch database, TEST data).');
  process.exit(1);
}

/**
 * Amazon.in Associates report imports running AT THE SAME TIME, on a real
 * PostgreSQL (`pnpm race:pg`; CI runs it after `pnpm demo:pg`). pg-mem has
 * no concurrency, so this is the proof that:
 *
 *   A. concurrent imports of several return rows for ONE sale never reverse
 *      more than its commission (10 rounds × 6 concurrent return files of
 *      −160.00 each against one 160.00 sale: exactly 16000 paise reversed
 *      per round, the publisher's liability on those sales never below 0);
 *   B. concurrent imports of the same row with different amounts never both
 *      land (10 pairs, 160.00 vs 999.00: exactly one 202 and one 409 per
 *      pair, one conversion carrying the winner's fee);
 *   C. the books stay balanced (checkBooksBalanced).
 *
 * Before the fix (2026-09-29) A reversed up to 5× the commission and B
 * accepted both files in 9 of 10 pairs. The guards: one import at a time per
 * account (a session advisory lock, src/amazon/report-import.ts) and the
 * atomic reversal insert (insertReversalWithinRemainder, conversion row
 * locked, remainder re-checked in the insert).
 *
 * DATABASE_URL names a server: a scratch database `paparazzi_demo_race_<8
 * hex>` is created there, migrated with db/migrate.mjs, and dropped at the
 * end (also on failure). TEST values only (demo-21, demo-ig-21, B0RACE…,
 * *.example.com).
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
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

const PREFIX = 'paparazzi_demo_race_';
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
    console.error('race: DATABASE_URL is required (a scratch database is created on that server)');
    process.exit(1);
  }
  const name = `${PREFIX}${randomBytes(4).toString('hex')}`;
  const adminUrl = new URL(serverUrl);
  adminUrl.pathname = '/postgres';
  const scratch = new URL(serverUrl);
  scratch.pathname = `/${name}`;
  await admin(adminUrl.toString(), (q) => q(`create database "${name}"`));
  console.log(`  created scratch database ${name}`);
  // The api's pool is built from DATABASE_URL at import time: point it at the scratch database first.
  process.env.DATABASE_URL = scratch.toString();
  process.env.JWT_SECRET ??= 'race-test-secret';

  let pool: { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>; end: () => Promise<void> } | null =
    null;
  try {
    const { runMigrations } = (await import('../db/migrate.mjs')) as {
      runMigrations(url: string, opts?: { log?: (l: string) => void }): Promise<{ applied: string[] }>;
    };
    const m = await runMigrations(scratch.toString(), { log: () => undefined });
    console.log(`  ${m.applied.length} migration(s) applied`);

    const db = await import('../packages/api/src/db.js');
    pool = db.getPool() as unknown as NonNullable<typeof pool>;
    const q = async (sql: string, p: unknown[] = []) => (await pool!.query(sql, p)).rows;
    const { setupAmazonAssociates } = await import('../packages/api/src/amazon/setup.js');
    const { amazonAccountById } = await import('../packages/api/src/amazon/account.js');
    const { importAmazonEarningsReport } = await import('../packages/api/src/amazon/report-import.js');
    const { checkBooksBalanced } = await import('../packages/shared/src/index.js');

    // -- TEST organisation shaped like the in-house network --------------------------------
    const org = String((await q(`insert into organisations (name, slug) values ('Demo race', 'demo-race') returning id`))[0]!.id);
    const user = String((await q(`insert into users (email) values ('network_admin@race.example.com') returning id`))[0]!.id);
    const publisher = String(
      (await q(
        `insert into publishers (org_id, legal_name, country, status, onboarding_state)
         values ($1, 'Demo in-house network', 'IN', 'approved', 'active') returning id`,
        [org],
      ))[0]!.id,
    );
    const ig = String(
      (await q(
        `insert into properties (org_id, publisher_id, platform, external_account_id, status)
         values ($1, $2, 'instagram', 'demo.race', 'approved') returning id`,
        [org, publisher],
      ))[0]!.id,
    );
    await q(
      `insert into verifications (org_id, property_id, method, verified_by, verified_at) values ($1, $2, 'owner_operated', $3, now())`,
      [org, ig, user],
    );
    const summary = await setupAmazonAssociates({
      orgSlug: 'demo-race',
      storeId: 'demo-21',
      declarations: [{ row: 1, platform: 'instagram', account: 'demo.race', trackingId: 'demo-ig-21' }],
      publisherShareBps: 7000,
      now: new Date('2026-09-01T00:00:00Z'),
    });
    const account = (await amazonAccountById(org, summary.account_id))!;
    const log = { info: () => undefined } as unknown as Parameters<typeof importAmazonEarningsReport>[0]['log'];

    const cols = ['Category', 'Name', 'ASIN', 'Seller', 'Tracking ID', 'Date Shipped', 'Price(Rs.)', 'Items Shipped', 'Returns', 'Revenue(Rs.)', 'Ad Fees(Rs.)', 'Device Type Group'];
    const def: Record<string, string> = {
      Category: 'Home',
      Name: 'Demo Kettle',
      ASIN: 'B0RACE0000',
      Seller: 'Demo Seller',
      'Tracking ID': 'demo-ig-21',
      'Date Shipped': '2026-09-10',
      'Price(Rs.)': '1000.00',
      'Items Shipped': '1',
      Returns: '0',
      'Revenue(Rs.)': '1000.00',
      'Ad Fees(Rs.)': '160.00',
      'Device Type Group': 'PHONE',
    };
    const tsv = (rows: Array<Record<string, string>>) => [cols.join('\t'), ...rows.map((r) => cols.map((c) => r[c] ?? def[c]).join('\t'))].join('\n') + '\n';
    const run = (text: string) => importAmazonEarningsReport({ orgId: org, account, text, receivedVia: 'cli', log });

    // -- A: concurrent returns against one sale ------------------------------------------------
    let worst = 0;
    let exact = 0;
    for (let k = 0; k < 10; k += 1) {
      const asin = `B0RACE${String(k).padStart(4, '0')}`;
      await run(tsv([{ ASIN: asin }]));
      const returns = Array.from({ length: 6 }, (_, i) =>
        tsv([{ ASIN: asin, 'Date Shipped': `2026-09-${11 + i}`, 'Items Shipped': '0', Returns: '1', 'Revenue(Rs.)': '-1000.00', 'Ad Fees(Rs.)': '-160.00' }]),
      );
      const results = await Promise.all(returns.map((t) => run(t)));
      const reversed = Number(
        (await q(
          `select coalesce(sum(a.commission_delta_minor), 0)::bigint as s
             from adjustments a join conversions c on c.id = a.conversion_id
            where c.org_id = $1 and c.item_ref = $2`,
          [org, asin],
        ))[0]!.s,
      );
      worst = Math.max(worst, reversed);
      if (reversed === 16000 && results.every((r) => r.ok)) exact += 1;
    }
    check(worst <= 16000, `A: 10 rounds × 6 concurrent return files — never more than the 16000-paise commission reversed (worst ${worst})`);
    check(exact === 10, `A: every round reversed exactly 16000 (one return applied, the others unmatched): ${exact}/10`);
    const net = Number(
      (await q(
        `select coalesce(sum(credit_minor - debit_minor), 0)::bigint as n from ledger_entries
          where org_id = $1 and account = 'publisher_liability'`,
        [org],
      ))[0]!.n,
    );
    check(net === 0, `A: the publisher's liability on the 10 fully returned sales is 0 (got ${net}), never negative`);

    // -- B: concurrent imports of one row with different amounts ---------------------------------
    let onePerPair = 0;
    for (let k = 0; k < 10; k += 1) {
      const day = `2026-08-${String(10 + k)}`;
      const asin = `B0RACEB${String(k).padStart(3, '0')}`;
      const [a, b] = await Promise.all([
        run(tsv([{ ASIN: asin, 'Date Shipped': day, 'Ad Fees(Rs.)': '160.00' }])),
        run(tsv([{ ASIN: asin, 'Date Shipped': day, 'Ad Fees(Rs.)': '999.00' }])),
      ]);
      const oks = [a, b].filter((r) => r.ok).length;
      const conflicts = [a, b].filter((r) => !r.ok && r.status === 409).length;
      const rows = await q(`select commission_minor::bigint as c from conversions where org_id = $1 and item_ref = $2`, [org, asin]);
      const winnerFee = a.ok ? 16000 : 99900;
      if (oks === 1 && conflicts === 1 && rows.length === 1 && Number(rows[0]!.c) === winnerFee) onePerPair += 1;
    }
    check(onePerPair === 10, `B: 10 concurrent pairs of one row at 160.00 vs 999.00 — exactly one 202 and one 409 each, one conversion with the winner's fee: ${onePerPair}/10`);

    // -- C ------------------------------------------------------------------------------------------
    const books = await checkBooksBalanced(
      async (sql: string, params?: unknown[]) => ({ rows: (await pool!.query(sql, params)).rows as Array<{ currency: string; debit: string; credit: string }> }),
      org,
    );
    check(books.imbalances.length === 0, 'C: the books are balanced');
  } finally {
    await pool?.end().catch(() => undefined);
    await admin(adminUrl.toString(), async (qq) => {
      if (!name.startsWith(PREFIX)) throw new Error(`race: refusing to drop '${name}'`);
      try {
        await qq(`drop database if exists "${name}" with (force)`);
      } catch {
        await qq(`drop database if exists "${name}"`);
      }
    });
    console.log(`  dropped scratch database ${name}`);
  }
  console.log(failures === 0 ? 'RACE: ALL PASS' : `RACE: ${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
