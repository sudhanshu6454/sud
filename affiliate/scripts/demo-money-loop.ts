// SANDBOX GUARD — this file must be the first thing that runs, before any
// import side effects. The demo boots an in-memory pg-mem database and a
// fake payout rail (no real money ever moves); it must never run with
// production markers set.
if (process.env.NODE_ENV === 'production') {
  console.error(
    'REFUSING TO RUN: NODE_ENV=production. scripts/demo-money-loop.ts is ' +
      'sandbox-only (pg-mem + fake payout rail); it must never run against production.',
  );
  process.exit(1);
}

/**
 * End-to-end money-loop demo (in-process sandbox).
 *
 * Two targets, same assertions:
 *
 *  - default (`pnpm demo`): boots a pg-mem Postgres and applies
 *    db/migrations/*.sql in lexical order with the pg-mem shims in
 *    transformForPgMem. No external services.
 *  - `DEMO_TARGET=postgres` (`pnpm demo:pg`): a real Postgres. With
 *    DATABASE_URL set, creates a scratch database `paparazzi_demo_<8 hex>` on
 *    that server (via the `postgres` maintenance database, same credentials),
 *    applies the migrations verbatim through db/migrate.mjs's runMigrations,
 *    runs every step, and drops the scratch database at the end even on
 *    failure (it refuses to drop any name not starting with `paparazzi_demo_`).
 *    With DEMO_DATABASE_URL set, uses that database as-is: nothing is created
 *    or dropped, so it must be empty (migrations are applied into it).
 *
 * Either way the API's pool is swapped via the `__setPool` test seam and the
 * API + redirect apps are served over real HTTP on 127.0.0.1 ephemeral ports.
 * Then it walks the full money loop:
 *
 *    link → click → conversion (INR 160 commission) → ledger 112/48
 *      → webhook dedupe → 50% reversal → 56/24 → merchant settlement
 *      → payout batch (maker-checker) → disburse → provider callback (paid)
 *      → liability cleared
 *      → PAYOUT-FAILURE scenario: second conversion → batch 2 → ambiguous
 *        ('unknown') provider outcome → blind re-disburse refused with
 *        TRANSFER_STATUS_UNKNOWN (no duplicate transfer row, provider_ref
 *        unchanged) → POST /v1/payout-transfers/{providerRef}/status-query
 *        arms the 5-minute retry guard → informed re-initiate moves the SAME
 *        transfer unknown → processing (never a second row: no double
 *        payout) → provider callback (paid) → liability cleared again
 *
 * Test-data convention: every seeded/demo-visible name is unmistakably
 * sandbox data — "Demo …" prefixes on orgs, users, publishers, merchants,
 * programmes, products, campaigns and looks (db/seed.ts), `demo.`-prefixed
 * accounts/URLs, `txn-demo-*` / `demo-line-*` transaction references,
 * `STMT-DEMO-*` settlement references, and RFC 2606 `example.com` domains.
 * Nothing in the demo resembles a real brand, merchant, or account.
 *
 * Sandbox guard: the file refuses to run when NODE_ENV=production.
 *
 * Every step is asserted; PASS/FAIL lines go to stdout and any failure sets
 * a non-zero exit code.
 *
 * Requires the API workstream contracts (see checkContracts()): if any are
 * missing the demo stops before booting and prints exactly what is missing
 * instead of reimplementing the API.
 *
 * pg-mem accommodations (see db/README.md "pg-mem vs real Postgres"):
 *  - gen_random_uuid is registered in-process (impure: fresh value per call).
 *  - the `create extension "pgcrypto"` line is stripped.
 *  - `unique nulls not distinct` is rewritten to `unique`; because pg-mem
 *    treats NULLs as distinct, the demo conversion carries an explicit
 *    `line_id` so the sandbox exercises the same dedupe path real Postgres
 *    takes with a NULL line_id.
 *  - 0002's ledger_entries ALTERs (drop/re-add check + unique constraints)
 *    cannot resolve in pg-mem (it doesn't track Postgres's implicit
 *    constraint names), so their end state is folded into the 0001
 *    transform: the account check admits 'payout_clearing' and the ledger
 *    dedupe key is (idempotency_key, account).
 *  - a query shim strips `::text` on timestamptz columns (fresh_until,
 *    occurred_at, last_status_query_at, …): pg-mem cannot cast timestamptz →
 *    text, but `new Date()` parses its bare value identically.
 */
// Demo target: 'pgmem' (default) or 'postgres'. Captured before the env
// defaults below so the postgres path can tell a real DATABASE_URL from the
// pg-mem placeholder.
const DEMO_TARGET = (process.env.DEMO_TARGET ?? 'pgmem').toLowerCase();
const USER_DATABASE_URL = process.env.DATABASE_URL;
const DEMO_DATABASE_URL = process.env.DEMO_DATABASE_URL;
if (DEMO_TARGET !== 'pgmem' && DEMO_TARGET !== 'postgres') {
  console.error(`demo: DEMO_TARGET must be 'pgmem' (default) or 'postgres' (got '${DEMO_TARGET}')`);
  process.exit(1);
}
if (DEMO_TARGET === 'postgres' && !USER_DATABASE_URL && !DEMO_DATABASE_URL) {
  console.error(
    'demo: DEMO_TARGET=postgres needs DATABASE_URL (a scratch database is created on that server) ' +
      'or DEMO_DATABASE_URL (an existing EMPTY database, used as-is).',
  );
  process.exit(1);
}

process.env.JWT_SECRET ??= 'demo-secret';
process.env.DATABASE_URL ??= 'dummy-not-used';
// The app entrypoints run unguarded main() on import; keep any stray
// listeners on ephemeral ports so they can never collide with the demo's.
process.env.API_PORT ??= '0';
process.env.REDIRECT_PORT ??= '0';

import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDb, DataType } from 'pg-mem';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// jsonwebtoken lives in the api package's node_modules (repo root has none).
const requireApi = createRequire(path.join(repoRoot, 'packages/api', 'package.json'));
const jwt = requireApi('jsonwebtoken') as {
  sign(payload: Record<string, unknown>, secret: string): string;
};

// ---------------------------------------------------------------------------
// Minimal structural types (kept loose: the demo talks to the apps over
// HTTP and SQL, and these files sit outside the packages' tsconfig).
// ---------------------------------------------------------------------------
type Queryable = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

type AppLike = {
  listen(opts: { port: number; host: string }): Promise<string>;
  close(): Promise<void>;
};

type DemoPool = Queryable & { end(): Promise<void> };

/** What a boot path hands back: the pool to inject, and how to tear it down. */
type Booted = {
  pool: DemoPool;
  /** Human-readable target (no credentials). */
  label: string;
  /** Ends the pool and (postgres) drops the scratch database. Must run even on failure. */
  teardown(): Promise<void>;
};

interface SeedIds {
  orgId: string;
  publisherId: string;
  propertyId: string;
  programmeId: string;
  offerId: string;
  placementId: string;
  users: { owner: string; operator: string; approver: string };
}

// ---------------------------------------------------------------------------
// Tiny assertion harness.
// ---------------------------------------------------------------------------
let failures = 0;

function pass(label: string): void {
  console.log(`PASS ${label}`);
}

function fail(label: string, detail?: unknown): void {
  failures += 1;
  const rendered =
    detail === undefined
      ? ''
      : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`FAIL ${label}${rendered}`);
}

function assert(cond: boolean, label: string, detail?: unknown): void {
  if (cond) pass(label);
  else fail(label, detail);
}

// ---------------------------------------------------------------------------
// Contract check: the demo builds against the API workstream's contracts.
// Static checks run BEFORE importing the app modules (importing the redirect
// module runs its unguarded main(), so we never import it blind).
// ---------------------------------------------------------------------------
async function checkContracts(): Promise<string[]> {
  const missing: string[] = [];
  const read = (p: string): Promise<string> =>
    readFile(path.join(repoRoot, p), 'utf8');

  const dbSrc = await read('packages/api/src/db.ts');
  if (!/export\s+(async\s+)?function\s+__setPool/.test(dbSrc)) {
    missing.push('packages/api/src/db.ts: missing `__setPool(pool)` test seam');
  }

  const redirectSrc = await read('packages/redirect/src/index.ts');
  if (!/export\s+(async\s+)?function\s+buildRedirectApp/.test(redirectSrc)) {
    missing.push(
      'packages/redirect/src/index.ts: missing `buildRedirectApp(deps?)` export',
    );
  }

  const migFiles = (await readdir(path.join(repoRoot, 'db/migrations')))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (!migFiles.includes('0002_money_loop.sql')) {
    missing.push(
      'db/migrations/0002_money_loop.sql: missing (conversions.contract_version_id, ' +
        'merchant_settlements, payout_transfers, ledger_entries.payout_clearing)',
    );
  }

  const integrationsSrc = await read('packages/api/src/routes/integrations.ts');
  if (!/['"]reversal['"]/.test(integrationsSrc)) {
    missing.push(
      "packages/api/src/routes/integrations.ts: no `kind: 'reversal'` handling on " +
        'POST /v1/integrations/{connector}/events',
    );
  }
  if (!/payout-callback/.test(integrationsSrc)) {
    missing.push(
      'packages/api/src/routes/integrations.ts: missing ' +
        'POST /v1/integrations/stub-network/payout-callback',
    );
  }

  const payoutsSrc = await read('packages/api/src/routes/payouts.ts');
  if (!/disburse/.test(payoutsSrc)) {
    missing.push(
      'packages/api/src/routes/payouts.ts: missing POST /v1/payout-batches/{id}/disburse',
    );
  }
  if (!/status-query/.test(payoutsSrc)) {
    missing.push(
      'packages/api/src/routes/payouts.ts: missing ' +
        'POST /v1/payout-transfers/{providerRef}/status-query',
    );
  }

  return missing;
}

// ---------------------------------------------------------------------------
// Demo.
// ---------------------------------------------------------------------------

/**
 * pg-mem migration transform.
 *
 * Real Postgres applies the files verbatim (`pnpm migrate`). pg-mem needs:
 *  - `create extension "pgcrypto"` stripped (no such extension in pg-mem);
 *  - `unique nulls not distinct` → `unique` (syntax unsupported);
 *  - 0001: apply 0002's ledger_entries end state up front. pg-mem does not
 *    track Postgres's implicit constraint names, so 0002's
 *    `ALTER TABLE … DROP CONSTRAINT ledger_entries_account_check` /
 *    `…_idempotency_key_key` cannot resolve. The end state is identical:
 *    the account check admits 'payout_clearing', and the ledger dedupe key
 *    is (idempotency_key, account).
 *  - 0002: the two ledger_entries ALTER pairs above become no-ops (their
 *    end state is already in place); everything else applies verbatim.
 */
function transformForPgMem(filename: string, sql: string): string {
  sql = sql.replace(/^create extension[^;]*;/gim, '');
  sql = sql.replace(/unique nulls not distinct/gi, 'unique');
  if (filename === '0001_core.sql') {
    sql = sql.replace(
      "check (account in ('merchant_receivable','publisher_liability','platform_commission'))",
      "check (account in ('merchant_receivable','publisher_liability','platform_commission','payout_clearing'))",
    );
    sql = sql.replace('idempotency_key text not null unique,', 'idempotency_key text not null,');
    sql +=
      '\ncreate unique index ledger_entries_idempotency_key_account_key ' +
      'on ledger_entries(idempotency_key, account);';
  }
  if (filename === '0002_money_loop.sql') {
    sql = sql.replace(/alter table ledger_entries[^;]*;/gi, '');
  }
  return sql;
}

/**
 * Default target: in-process pg-mem with the shims in transformForPgMem and
 * the demo-side `::text` query shim. No external services.
 */
async function bootPgMem(): Promise<Booted> {
  const db = newDb();
  // impure: true — pg-mem memoises pure functions; uuids must be fresh per call.
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    impure: true,
    implementation: () => randomUUID(),
  });

  const migDir = path.join(repoRoot, 'db', 'migrations');
  const migFiles = (await readdir(migDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of migFiles) {
    const raw = await readFile(path.join(migDir, f), 'utf8');
    await db.public.query(transformForPgMem(f, raw));
    console.log(`  applied ${f}`);
  }

  const { Pool } = db.adapters.createPg();
  const rawPool = new Pool() as unknown as DemoPool;
  // pg-mem query shim (demo-side only): pg-mem cannot cast timestamptz →
  // text, but several service queries select `<ts_col>::text` (redirect's
  // fresh_until, finance's occurred_at, payout-rail's last_status_query_at).
  // On real Postgres the cast yields a string the code feeds to `new
  // Date(...)`; pg-mem returns a value `new Date(...)` parses identically
  // without the cast, so the shim strips it for those columns only.
  // Integer/numeric `::text` casts work in pg-mem and are left untouched.
  const TS_TEXT_CAST = /\b(fresh_until|occurred_at|last_status_query_at|published_at|created_at)::text\b/g;
  const pool = new Proxy(rawPool, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return (sqlText: unknown, params?: unknown[]) => {
          if (typeof sqlText === 'string') sqlText = sqlText.replace(TS_TEXT_CAST, '$1');
          else if (sqlText && typeof (sqlText as { text?: unknown }).text === 'string') {
            const q = sqlText as { text: string };
            sqlText = { ...q, text: q.text.replace(TS_TEXT_CAST, '$1') };
          }
          return (target.query as (...a: unknown[]) => unknown)(sqlText, params);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as unknown as DemoPool;

  return {
    pool,
    label: 'pg-mem (in-process)',
    teardown: async () => {
      await pool.end().catch(() => undefined);
    },
  };
}

const SCRATCH_DB_PREFIX = 'paparazzi_demo_';

/** Host + database of a connection URL, for logs — never the credentials. */
function describeDbUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname.replace(/^\//, '')} on ${u.hostname}${u.port ? `:${u.port}` : ''}`;
  } catch {
    return '<unparseable DATABASE_URL>';
  }
}

/**
 * DEMO_TARGET=postgres: the SAME migrations (verbatim, via db/migrate.mjs)
 * and the SAME steps against a real Postgres.
 *
 *  - DATABASE_URL set (and no DEMO_DATABASE_URL): a scratch database
 *    `paparazzi_demo_<8 hex>` is created on that server through the
 *    `postgres` maintenance database with the same credentials, and dropped
 *    in teardown (also when a step or the migration fails). Only names with
 *    the `paparazzi_demo_` prefix are ever dropped.
 *  - DEMO_DATABASE_URL set: that database is used as-is (must be empty);
 *    nothing is created or dropped.
 *
 * No query shim on this path: `::text` on timestamptz and `unique nulls not
 * distinct` are native here, and 0002's ledger_entries ALTERs run for real.
 */
async function bootPostgres(): Promise<Booted> {
  const pg = requireApi('pg') as {
    Pool: new (opts: { connectionString: string; max?: number }) => DemoPool;
    Client: new (opts: { connectionString: string }) => {
      connect(): Promise<void>;
      query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
      end(): Promise<void>;
    };
  };
  const { runMigrations } = (await import('../db/migrate.mjs')) as {
    runMigrations(
      databaseUrl: string,
      opts?: { mode?: 'apply' | 'baseline' | 'status'; log?: (line: string) => void },
    ): Promise<{ applied: string[]; skipped: string[] }>;
  };

  async function withAdmin<T>(adminUrl: string, fn: (q: (sql: string) => Promise<unknown>) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: adminUrl });
    await client.connect();
    try {
      return await fn((sql) => client.query(sql));
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  let scratchUrl: string;
  let created: { name: string; adminUrl: string } | null = null;

  if (DEMO_DATABASE_URL) {
    scratchUrl = DEMO_DATABASE_URL;
  } else {
    const base = new URL(USER_DATABASE_URL as string);
    const name = `${SCRATCH_DB_PREFIX}${randomBytes(4).toString('hex')}`;
    const admin = new URL(base.toString());
    admin.pathname = '/postgres';
    // Identifier is [a-z0-9_] by construction; quoted anyway.
    await withAdmin(admin.toString(), (q) => q(`create database "${name}"`));
    const scratch = new URL(base.toString());
    scratch.pathname = `/${name}`;
    scratchUrl = scratch.toString();
    created = { name, adminUrl: admin.toString() };
    console.log(`  created scratch database ${describeDbUrl(scratchUrl)}`);
  }

  const dropScratch = async (): Promise<void> => {
    if (!created) return;
    if (!created.name.startsWith(SCRATCH_DB_PREFIX)) {
      throw new Error(`demo: refusing to drop '${created.name}' (not a ${SCRATCH_DB_PREFIX}* database)`);
    }
    const ident = `"${created.name}"`;
    await withAdmin(created.adminUrl, async (q) => {
      try {
        // Postgres 13+: terminate any straggling session (e.g. the api's
        // default pool) so the drop cannot fail on "being accessed by other users".
        await q(`drop database if exists ${ident} with (force)`);
      } catch {
        await q(`drop database if exists ${ident}`);
      }
    });
    console.log(`  dropped scratch database ${created.name}`);
    created = null;
  };

  // The api module builds its default pool from DATABASE_URL at import time;
  // point it at the scratch database so nothing in-process can ever touch
  // the caller's real database, even before __setPool swaps the pool.
  process.env.DATABASE_URL = scratchUrl;

  let pool: DemoPool | null = null;
  try {
    const r = await runMigrations(scratchUrl, { log: (line) => console.log(`  ${line}`) });
    if (r.skipped.length > 0) {
      throw new Error(
        `demo: ${describeDbUrl(scratchUrl)} already had ${r.skipped.length} migration(s) recorded — ` +
          'the demo needs an empty database (it seeds and asserts absolute row counts).',
      );
    }
    pool = new pg.Pool({ connectionString: scratchUrl, max: 10 });
    // Fail fast with a clear message if the scratch database is unreachable.
    await pool.query('select 1');
  } catch (err) {
    await pool?.end().catch(() => undefined);
    await dropScratch();
    throw err;
  }

  const livePool = pool;
  return {
    pool: livePool,
    label: `postgres: ${describeDbUrl(scratchUrl)}${created ? ' (scratch, dropped at exit)' : ' (DEMO_DATABASE_URL, kept)'}`,
    teardown: async () => {
      await livePool.end().catch(() => undefined);
      await dropScratch();
    },
  };
}

async function main(): Promise<void> {
  const missing = await checkContracts();
  if (missing.length > 0) {
    console.log('DEMO BLOCKED — the following contract pieces are missing:');
    for (const m of missing) console.log(`  - ${m}`);
    console.log(
      'The demo builds against these contracts and does not reimplement the API;',
    );
    console.log('see the workstream report for the full gap list.');
    process.exitCode = 1;
    return;
  }

  // -- boot: pg-mem (default) or a real Postgres scratch database ----------------
  const booted = DEMO_TARGET === 'postgres' ? await bootPostgres() : await bootPgMem();
  const { pool } = booted;
  console.log(`  target: ${booted.label}`);

  // Dynamic imports: env above must be set before these modules initialise.
  const { __setPool } = (await import('../packages/api/src/db.js')) as {
    __setPool(p: unknown): void;
  };
  const { buildApp } = (await import('../packages/api/src/index.js')) as {
    buildApp(): Promise<AppLike>;
  };
  const { buildRedirectApp } = (await import('../packages/redirect/src/index.js')) as {
    buildRedirectApp(deps?: { pool?: unknown }): Promise<AppLike>;
  };

  __setPool(pool);
  const api = await buildApp();
  const redirectApp = await buildRedirectApp({ pool });
  const apiBase = await api.listen({ port: 0, host: '127.0.0.1' });
  const redirectBase = await redirectApp.listen({ port: 0, host: '127.0.0.1' });
  console.log(`  api on ${apiBase}, redirect on ${redirectBase}`);

  let payoutCompleted = false;
  try {
    payoutCompleted = await runSteps(pool, apiBase, redirectBase);
  } finally {
    await api.close().catch(() => undefined);
    await redirectApp.close().catch(() => undefined);
    // Ends the pool; on the postgres target also drops the scratch database.
    // A teardown failure must be visible (a leaked scratch DB is a bug), so
    // it is not swallowed — but it runs after the apps are closed.
    await booted.teardown();
  }

  printSummary(payoutCompleted);
  if (failures > 0) {
    console.log(`\n${failures} assertion(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log('\nAll demo assertions passed.');
  }
  // Explicit exit: importing the app entrypoints may have started stray
  // listeners (unguarded main()), which would otherwise keep the loop alive.
  process.exit(process.exitCode ?? 0);
}

interface ApiResult {
  status: number;
  body: any;
}

async function runSteps(
  pool: Queryable,
  apiBase: string,
  redirectBase: string,
): Promise<boolean> {
  // -- seed ---------------------------------------------------------------------
  const ids = await (async () => {
    const { seedDemo } = (await import('../db/seed.js')) as {
      seedDemo(
        q: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
      ): Promise<SeedIds>;
    };
    return seedDemo(async (sql, params) => pool.query(sql, params));
  })();
  assert(
    !!ids.orgId && !!ids.publisherId && !!ids.programmeId,
    'seed: demo graph inserted',
    ids,
  );

  // The API trusts JWT claims (no membership lookup); the demo mints tokens
  // for the seeded users. network_admin has no seeded user — a synthetic sub
  // is fine for the sandbox.
  const networkAdminSub = randomUUID();
  const token = (sub: string, role: string): string =>
    jwt.sign({ sub, org_id: ids.orgId, role }, process.env.JWT_SECRET as string);

  async function apiFetch(
    role: string,
    sub: string,
    p: string,
    init?: { method?: string; body?: unknown },
  ): Promise<ApiResult> {
    const hasBody = init?.body !== undefined;
    const res = await fetch(`${apiBase}${p}`, {
      method: init?.method ?? 'GET',
      headers: {
        // Fastify rejects an empty body when content-type: application/json is
        // set (FST_ERR_CTP_EMPTY_JSON_BODY), so only send the header with a body.
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${token(sub, role)}`,
      },
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  const num = (v: unknown): number => Number(v);

  // -- 1. mint a tracked link ------------------------------------------------------
  console.log('\n[1] create link');
  const linkRes = await apiFetch('publisher_owner', ids.users.owner, '/v1/links', {
    method: 'POST',
    body: {
      property_id: ids.propertyId,
      programme_id: ids.programmeId,
      offer_id: ids.offerId,
      placement_id: ids.placementId,
    },
  });
  assert(linkRes.status === 201, 'POST /v1/links → 201', linkRes);
  const linkToken = linkRes.body?.data?.token as string | undefined;
  assert(
    typeof linkToken === 'string' && /^[0-9a-f]{32}$/.test(linkToken),
    'link token captured (32 hex chars)',
    linkToken,
  );
  if (!linkToken) return false;

  // -- 2. click the redirect ---------------------------------------------------------
  console.log('\n[2] click redirect');
  const clickRes = await fetch(`${redirectBase}/r/${linkToken}`, {
    redirect: 'manual',
  });
  assert(clickRes.status === 302, 'GET /r/{token} → 302', clickRes.status);
  const location = clickRes.headers.get('location') ?? '';
  const clickId = (() => {
    try {
      return new URL(location).searchParams.get('subid');
    } catch {
      return null;
    }
  })();
  assert(
    typeof clickId === 'string' && clickId.length > 0,
    'Location carries subid=<click_id>',
    location,
  );
  if (!clickId) return false;

  // -- 3. approved conversion: INR 2000 order → INR 160 commission ----------------------
  console.log('\n[3] conversion webhook (approved)');
  const occurredAt = new Date(Date.now() - 40 * 86_400_000).toISOString(); // 40d ago: outside the 30d returns window
  const conversionBody = {
    kind: 'conversion',
    provider_account_id: 'stub-acct-1',
    source_transaction_id: 'txn-demo-1',
    // pg-mem cannot enforce `nulls not distinct`; an explicit line_id keeps the
    // sandbox on the same dedupe path real Postgres takes with NULL line_id.
    line_id: 'demo-line-1',
    returned_click_ref: clickId,
    currency: 'INR',
    eligible_value_minor: 200000,
    commission_minor: 16000,
    provider_status: 'approved',
    provider_revision: 1,
    occurred_at: occurredAt,
  };
  const convRes = await apiFetch(
    'network_admin',
    networkAdminSub,
    '/v1/integrations/stub-network/events',
    { method: 'POST', body: conversionBody },
  );
  assert(convRes.status === 202, 'conversion accepted → 202', convRes);

  // -- 4. earnings: 70/30 split of INR 160 → INR 112 / INR 48 ------------------------------
  console.log('\n[4] earnings + ledger (70/30 split)');
  const earnRes = await apiFetch(
    'publisher_owner',
    ids.users.owner,
    `/v1/publisher/earnings?publisher_id=${ids.publisherId}`,
  );
  const approvedEarn = earnRes.body?.data?.balances?.INR?.approved;
  assert(
    earnRes.status === 200 && approvedEarn === 11200,
    'publisher approved earnings == 11200 minor (INR 112)',
    earnRes.body?.data?.balances,
  );

  const nets = await pool.query(
    `select account, sum(credit_minor - debit_minor)::text as net
       from ledger_entries where org_id = $1 group by account`,
    [ids.orgId],
  );
  const netBy = new Map(nets.rows.map((r) => [String(r.account), num(r.net)]));
  assert(
    netBy.get('platform_commission') === 4800,
    'platform_commission net == 4800 minor (INR 48)',
    Object.fromEntries(netBy),
  );

  const books = await pool.query(
    `select currency, sum(debit_minor)::text as d, sum(credit_minor)::text as c
       from ledger_entries where org_id = $1 group by currency`,
    [ids.orgId],
  );
  const balanced =
    books.rows.length > 0 && books.rows.every((r) => BigInt(String(r.d)) === BigInt(String(r.c)));
  assert(balanced, 'books balance per currency (Σdebit == Σcredit)', books.rows);

  // -- 5. duplicate webhooks dedupe ---------------------------------------------------------
  console.log('\n[5] duplicate webhook dedupe');
  const dup1 = await apiFetch(
    'network_admin',
    networkAdminSub,
    '/v1/integrations/stub-network/events',
    { method: 'POST', body: conversionBody },
  );
  const dup2 = await apiFetch(
    'network_admin',
    networkAdminSub,
    '/v1/integrations/stub-network/events',
    { method: 'POST', body: conversionBody },
  );
  assert(
    dup1.status === 200 && dup1.body?.data?.deduped === true,
    'duplicate #1 → 200 {deduped:true}',
    dup1,
  );
  assert(
    dup2.status === 200 && dup2.body?.data?.deduped === true,
    'duplicate #2 → 200 {deduped:true}',
    dup2,
  );
  const convCount = await pool.query(
    `select count(*)::text as n from conversions
      where org_id = $1 and source_transaction_id = 'txn-demo-1'`,
    [ids.orgId],
  );
  assert(num(convCount.rows[0]?.n) === 1, 'exactly 1 conversion row for txn-demo-1', convCount.rows[0]);
  const leCount = await pool.query(
    `select count(*)::text as n from ledger_entries
      where org_id = $1
        and conversion_id = (select id from conversions
                              where org_id = $1 and source_transaction_id = 'txn-demo-1'
                              limit 1)`,
    [ids.orgId],
  );
  assert(num(leCount.rows[0]?.n) === 3, 'exactly 3 ledger_entries for the conversion', leCount.rows[0]);

  // -- 6. 50% reversal → publisher 56 / platform 24 ----------------------------------------------
  console.log('\n[6] reversal (50% partial return)');
  const revRes = await apiFetch(
    'network_admin',
    networkAdminSub,
    '/v1/integrations/stub-network/events',
    {
      method: 'POST',
      body: {
        kind: 'reversal',
        provider_account_id: 'stub-acct-1',
        source_transaction_id: 'txn-demo-1',
        // must match the conversion's natural key (findConversion), hence the
        // same explicit line_id used in step 3.
        line_id: 'demo-line-1',
        reversal_commission_minor: 8000,
        reason: 'partial return',
      },
    },
  );
  assert(revRes.status === 200 || revRes.status === 202, 'reversal accepted (2xx)', revRes);

  const pubNet = await pool.query(
    `select sum(credit_minor - debit_minor)::text as net from ledger_entries
      where org_id = $1 and publisher_id = $2 and account = 'publisher_liability'`,
    [ids.orgId, ids.publisherId],
  );
  assert(num(pubNet.rows[0]?.net) === 5600, 'publisher net == 5600 (INR 56) after reversal', pubNet.rows[0]);
  const platNet = await pool.query(
    `select sum(credit_minor - debit_minor)::text as net from ledger_entries
      where org_id = $1 and account = 'platform_commission'`,
    [ids.orgId],
  );
  assert(num(platNet.rows[0]?.net) === 2400, 'platform net == 2400 (INR 24) after reversal', platNet.rows[0]);

  // -- 7. merchant settlement ----------------------------------------------------------
  console.log('\n[7] merchant settlement');
  try {
    await pool.query(
      `insert into merchant_settlements
         (org_id, programme_id, currency, amount_minor, statement_ref, collected_at)
       values ($1, $2, 'INR', 16000, 'STMT-DEMO-1', now())`,
      [ids.orgId, ids.programmeId],
    );
    pass('merchant settlement STMT-DEMO-1 recorded (INR 160 collected)');
  } catch (err) {
    fail('merchant settlement STMT-DEMO-1 recorded', err instanceof Error ? err.message : err);
  }

  // -- 8. prepare payout batch -------------------------------------------------------------
  console.log('\n[8] prepare payout batch');
  const prepRes = await apiFetch('finance_operator', ids.users.operator, '/v1/payout-batches', {
    method: 'POST',
    body: { currency: 'INR' },
  });
  assert(prepRes.status === 201, 'POST /v1/payout-batches → 201', prepRes);
  const batchId = prepRes.body?.data?.id as string | undefined;
  const items = prepRes.body?.data?.items as
    | Array<{ publisher_id: string; amount_minor: number }>
    | undefined;
  const item = items?.find((i) => i.publisher_id === ids.publisherId);
  assert(item?.amount_minor === 5600, 'batch item == 5600 minor (INR 56) for the publisher', items);
  if (!batchId) return false;

  // -- 9. maker-checker: preparer cannot approve --------------------------------------------------
  console.log('\n[9] maker-checker (self-approval refused)');
  const selfApprove = await apiFetch(
    'finance_operator',
    ids.users.operator,
    `/v1/payout-batches/${batchId}/approve`,
    { method: 'POST' },
  );
  assert(selfApprove.status === 403, 'preparer approving own batch → 403', selfApprove);

  // -- 10. approver approves -------------------------------------------------------------------------
  console.log('\n[10] approve batch');
  const approveRes = await apiFetch(
    'finance_approver',
    ids.users.approver,
    `/v1/payout-batches/${batchId}/approve`,
    { method: 'POST' },
  );
  assert(
    approveRes.status === 200 && approveRes.body?.data?.status === 'approved',
    "batch → status 'approved'",
    approveRes.body?.data,
  );

  // -- 11. disburse --------------------------------------------------------------------------------------
  console.log('\n[11] disburse batch');
  const disburseRes = await apiFetch(
    'finance_operator',
    ids.users.operator,
    `/v1/payout-batches/${batchId}/disburse`,
    { method: 'POST' },
  );
  assert(
    (disburseRes.status === 200 || disburseRes.status === 202) &&
      disburseRes.body?.data?.status === 'processing',
    "disburse → status 'processing'",
    disburseRes.body?.data,
  );
  const transfers = await pool.query(
    `select provider_ref, status from payout_transfers where payout_batch_id = $1`,
    [batchId],
  );
  assert(transfers.rows.length === 1, 'one payout_transfer row for the batch', transfers.rows);
  const providerRef = transfers.rows[0]?.provider_ref as string | undefined;
  if (!providerRef) return false;

  // -- 12. provider callback: paid → liability cleared ------------------------------------------
  console.log('\n[12] payout callback (paid)');
  const cbRes = await apiFetch(
    'network_admin',
    networkAdminSub,
    '/v1/integrations/stub-network/payout-callback',
    { method: 'POST', body: { provider_ref: providerRef, outcome: 'paid' } },
  );
  assert(cbRes.status === 200 || cbRes.status === 202, 'payout callback accepted (2xx)', cbRes);
  const batchRow = await pool.query(`select status from payout_batches where id = $1`, [batchId]);
  assert(batchRow.rows[0]?.status === 'paid', "batch → status 'paid'", batchRow.rows[0]);

  const liabNet = await pool.query(
    `select sum(credit_minor - debit_minor)::text as net from ledger_entries
      where org_id = $1 and publisher_id = $2 and account = 'publisher_liability'`,
    [ids.orgId, ids.publisherId],
  );
  assert(num(liabNet.rows[0]?.net) === 0, 'publisher_liability net == 0 after payout', liabNet.rows[0]);
  // Single batch in this demo, so org-scoped payout_clearing == batch-scoped.
  // NOTE: the implemented design posts the payout completion as a single
  // double-entry leg (Dr publisher_liability / Cr payout_clearing) on the
  // 'paid' callback; the clearing account is relieved by bank reconciliation,
  // which is out of scope (see 0002). It therefore holds the paid amount as
  // a credit balance here — it does NOT net to zero in this design.
  const clearingNet = await pool.query(
    `select sum(credit_minor - debit_minor)::text as net from ledger_entries
      where org_id = $1 and account = 'payout_clearing'`,
    [ids.orgId],
  );
  // -- 13. second conversion → new earnings (payout-failure scenario) -------------------
  console.log('\n[13] second conversion (INR 80 commission)');
  const occurredAt2 = new Date(Date.now() - 45 * 86_400_000).toISOString(); // 45d ago: outside the 30d returns window
  const conv2Res = await apiFetch(
    'network_admin',
    networkAdminSub,
    '/v1/integrations/stub-network/events',
    {
      method: 'POST',
      body: {
        kind: 'conversion',
        provider_account_id: 'stub-acct-1',
        source_transaction_id: 'txn-demo-2',
        line_id: 'demo-line-2',
        returned_click_ref: clickId,
        currency: 'INR',
        eligible_value_minor: 100000,
        commission_minor: 8000,
        provider_status: 'approved',
        provider_revision: 1,
        occurred_at: occurredAt2,
      },
    },
  );
  assert(conv2Res.status === 202, 'second conversion accepted → 202', conv2Res);

  const earn2Res = await apiFetch(
    'publisher_owner',
    ids.users.owner,
    `/v1/publisher/earnings?publisher_id=${ids.publisherId}`,
  );
  assert(
    earn2Res.status === 200 && earn2Res.body?.data?.balances?.INR?.approved === 5600,
    'publisher approved earnings == 5600 minor (INR 56) after second conversion',
    earn2Res.body?.data?.balances,
  );

  // -- 14. prepare/approve/disburse batch 2 ---------------------------------------------
  console.log('\n[14] prepare/approve/disburse batch 2');
  const prep2Res = await apiFetch('finance_operator', ids.users.operator, '/v1/payout-batches', {
    method: 'POST',
    body: { currency: 'INR' },
  });
  assert(prep2Res.status === 201, 'POST /v1/payout-batches → 201 (batch 2)', prep2Res);
  const batch2Id = prep2Res.body?.data?.id as string | undefined;
  const items2 = prep2Res.body?.data?.items as
    | Array<{ publisher_id: string; amount_minor: number }>
    | undefined;
  const item2 = items2?.find((i) => i.publisher_id === ids.publisherId);
  assert(item2?.amount_minor === 5600, 'batch 2 item == 5600 minor (INR 56)', items2);
  if (!batch2Id) return false;

  const appr2Res = await apiFetch(
    'finance_approver',
    ids.users.approver,
    `/v1/payout-batches/${batch2Id}/approve`,
    { method: 'POST' },
  );
  assert(
    appr2Res.status === 200 && appr2Res.body?.data?.status === 'approved',
    "batch 2 → status 'approved'",
    appr2Res.body?.data,
  );

  const dis2Res = await apiFetch(
    'finance_operator',
    ids.users.operator,
    `/v1/payout-batches/${batch2Id}/disburse`,
    { method: 'POST' },
  );
  assert(
    dis2Res.status === 200 && dis2Res.body?.data?.status === 'processing',
    "batch 2 disburse → status 'processing'",
    dis2Res.body?.data,
  );
  const transfers2 = await pool.query(
    `select provider_ref, status from payout_transfers where payout_batch_id = $1`,
    [batch2Id],
  );
  assert(transfers2.rows.length === 1, 'one payout_transfer row for batch 2', transfers2.rows);
  const providerRef2 = transfers2.rows[0]?.provider_ref as string | undefined;
  if (!providerRef2) return false;

  // -- 15. ambiguous provider outcome: callback 'unknown' -----------------------------------
  console.log("\n[15] payout callback (unknown — ambiguous outcome)");
  const cbURes = await apiFetch(
    'network_admin',
    networkAdminSub,
    '/v1/integrations/stub-network/payout-callback',
    { method: 'POST', body: { provider_ref: providerRef2, outcome: 'unknown' } },
  );
  assert(cbURes.status === 200 || cbURes.status === 202, 'unknown callback accepted (2xx)', cbURes);
  assert(
    cbURes.body?.data?.batch_status === 'processing',
    "batch 2 stays 'processing' on ambiguous outcome (no ledger posted)",
    cbURes.body?.data,
  );
  const tUnknown = await pool.query(
    `select status from payout_transfers where provider_ref = $1`,
    [providerRef2],
  );
  assert(tUnknown.rows[0]?.status === 'unknown', "transfer → 'unknown'", tUnknown.rows[0]);

  // -- 16. blind retry refused: TRANSFER_STATUS_UNKNOWN, no double payout --------------------
  console.log('\n[16] blind retry of the ambiguous transfer is refused');
  const blindRetry = await apiFetch(
    'finance_operator',
    ids.users.operator,
    `/v1/payout-batches/${batch2Id}/disburse`,
    { method: 'POST' },
  );
  assert(blindRetry.status === 409, 'blind re-disburse → 409', blindRetry);
  assert(
    blindRetry.body?.error?.code === 'TRANSFER_STATUS_UNKNOWN',
    'error code == TRANSFER_STATUS_UNKNOWN',
    blindRetry.body?.error,
  );
  const tAfterBlind = await pool.query(
    `select provider_ref, status from payout_transfers where payout_batch_id = $1`,
    [batch2Id],
  );
  assert(
    tAfterBlind.rows.length === 1 && String(tAfterBlind.rows[0]?.provider_ref) === providerRef2,
    'still exactly one transfer row: no duplicate initiation (no double payout)',
    tAfterBlind.rows,
  );
  assert(
    tAfterBlind.rows[0]?.status === 'unknown',
    "transfer still 'unknown': nothing was re-initiated",
    tAfterBlind.rows[0],
  );

  // -- 17. status query arms the retry guard ---------------------------------------------------
  console.log('\n[17] transfer status query');
  const qRes = await apiFetch(
    'finance_operator',
    ids.users.operator,
    `/v1/payout-transfers/${providerRef2}/status-query`,
    { method: 'POST' },
  );
  assert(qRes.status === 200, 'POST status-query → 200', qRes);
  assert(
    qRes.body?.data?.provider_ref === providerRef2 && qRes.body?.data?.status === 'unknown',
    "status query reports provider_ref + 'unknown' (still ambiguous at provider)",
    qRes.body?.data,
  );
  assert(
    typeof qRes.body?.data?.last_status_query_at === 'string' &&
      qRes.body?.data?.last_status_query_at.length > 0,
    'last_status_query_at recorded (retry guard armed)',
    qRes.body?.data,
  );

  // -- 18. informed retry re-initiates the SAME transfer ------------------------------------------
  console.log('\n[18] informed retry after status query');
  const okRetry = await apiFetch(
    'finance_operator',
    ids.users.operator,
    `/v1/payout-batches/${batch2Id}/disburse`,
    { method: 'POST' },
  );
  assert(
    okRetry.status === 200 && okRetry.body?.data?.status === 'processing',
    "informed re-disburse → 'processing'",
    okRetry.body?.data,
  );
  const tAfterOk = await pool.query(
    `select provider_ref, status from payout_transfers where payout_batch_id = $1`,
    [batch2Id],
  );
  assert(
    tAfterOk.rows.length === 1,
    'still exactly one transfer row after informed retry (no double payout)',
    tAfterOk.rows,
  );
  assert(
    String(tAfterOk.rows[0]?.provider_ref) === providerRef2 &&
      tAfterOk.rows[0]?.status === 'processing',
    "same transfer re-initiated unknown → 'processing' (provider_ref unchanged)",
    tAfterOk.rows[0],
  );

  // -- 19. provider resolves: paid → batch 2 done, liability cleared --------------------------------
  console.log('\n[19] payout callback (paid) for batch 2');
  const cb2Res = await apiFetch(
    'network_admin',
    networkAdminSub,
    '/v1/integrations/stub-network/payout-callback',
    { method: 'POST', body: { provider_ref: providerRef2, outcome: 'paid' } },
  );
  assert(cb2Res.status === 200 || cb2Res.status === 202, 'paid callback accepted (2xx)', cb2Res);
  const batch2Row = await pool.query(`select status from payout_batches where id = $1`, [batch2Id]);
  assert(batch2Row.rows[0]?.status === 'paid', "batch 2 → status 'paid'", batch2Row.rows[0]);

  const liabNet2 = await pool.query(
    `select sum(credit_minor - debit_minor)::text as net from ledger_entries
      where org_id = $1 and publisher_id = $2 and account = 'publisher_liability'`,
    [ids.orgId, ids.publisherId],
  );
  assert(
    num(liabNet2.rows[0]?.net) === 0,
    'publisher_liability net == 0 after both payouts',
    liabNet2.rows[0],
  );
  const clearingNet2 = await pool.query(
    `select sum(credit_minor - debit_minor)::text as net from ledger_entries
      where org_id = $1 and account = 'payout_clearing'`,
    [ids.orgId],
  );
  assert(
    num(clearingNet2.rows[0]?.net) === 11200,
    'payout_clearing holds 11200 (2 × 5600 Cr) pending bank reconciliation',
    clearingNet2.rows[0],
  );
  const books2 = await pool.query(
    `select currency, sum(debit_minor)::text as d, sum(credit_minor)::text as c
       from ledger_entries where org_id = $1 group by currency`,
    [ids.orgId],
  );
  const balanced2 =
    books2.rows.length > 0 && books2.rows.every((r) => BigInt(String(r.d)) === BigInt(String(r.c)));
  assert(balanced2, 'books still balance per currency after both payouts', books2.rows);
  return true;
}

function printSummary(payoutCompleted: boolean): void {
  console.log('\nMoney trail (minor units / INR):');
  console.log('  commission recognised:   16000 (INR 160)');
  console.log('  70/30 split:             publisher 11200 (INR 112) | platform 4800 (INR 48)');
  console.log('  50% reversal:            publisher  5600 (INR 56)  | platform 2400 (INR 24)');
  console.log('  merchant settlement:     STMT-DEMO-1 — INR 160 collected');
  if (payoutCompleted) {
    console.log('  payout batch 1:          INR 56 batch → paid; publisher_liability 0,');
    console.log('                           payout_clearing holds 5600 Cr (relieved by bank reconciliation)');
    console.log('  second conversion:       INR 80 commission → publisher 5600 (INR 56) | platform 2400 (INR 24)');
    console.log('  PAYOUT-FAILURE:          batch 2 transfer went \'unknown\'; blind re-disburse');
    console.log('                           refused (409 TRANSFER_STATUS_UNKNOWN, still 1 transfer row);');
    console.log('                           POST status-query armed the guard; informed retry re-initiated');
    console.log('                           the SAME transfer (provider_ref unchanged — no double payout);');
    console.log('                           provider callback paid → batch 2 paid, liability 0,');
    console.log('                           payout_clearing holds 11200 Cr (2 × 5600)');
  } else {
    console.log('  payout:                  not completed (see FAIL lines above)');
  }
}

main().catch((err) => {
  console.error('demo crashed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
