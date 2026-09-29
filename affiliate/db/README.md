# db/

Postgres schema and migration runner for the Paparazzi Affiliate Commerce Platform.

## Layout

- `migrations/` — SQL migrations, applied **in lexical order** (`0001_core.sql`, `0002_money_loop.sql`, …).
- `migrate.mjs` — applies `migrations/*.sql` in lexical order, one transaction per file.
- `seed.ts` — exports `seedDemo(query)`; inserts the fixed demo graph (organisation, users,
  publisher/property, merchant/programme, contract, catalogue, look, campaign/placement).
  Executable directly against a real Postgres.
- `../scripts/demo-money-loop.ts` — the end-to-end money-loop demo (in-process pg-mem sandbox).

## Usage (real Postgres)

```sh
# 1. start postgres + redis
docker compose up -d        # or: pnpm dev:db

# 2. point at the database (see ../.env.example)
export DATABASE_URL=postgresql://paparazzi:changeme@localhost:5432/paparazzi

# 3. run migrations (also wired as `pnpm migrate`)
node db/migrate.mjs

# 4. seed the demo graph (also wired as `pnpm seed`)
pnpm seed
```

Each migration file runs inside its own transaction; the runner stops on the first
failure and exits non-zero. `pnpm seed` connects with `DATABASE_URL`, calls `seedDemo`,
and prints the seeded ids as JSON. Money is `bigint` minor units (paise) everywhere.

Re-running `pnpm seed` merges rows that carry a natural unique key
(`organisations.slug`, `users.email`, `properties(platform, external_account_id)`,
`placements.placement_key`, `contracts(publisher_id, programme_id, version)`); tables without
a natural key will insert duplicate rows — prefer a fresh database per run.

## In-process demo (sandbox — no Docker/Postgres/Redis needed)

```bash
pnpm demo
```

`scripts/demo-money-loop.ts` runs the full money loop without any external services:

1. Creates a pg-mem database and applies `db/migrations/*.sql` in lexical order, with the
   pg-mem shims listed under "pg-mem vs real Postgres" below.
2. Swaps the API's pool via the `__setPool` test seam (`packages/api/src/db.ts`).
3. Builds the API (`buildApp`) and redirect service (`buildRedirectApp({ pool })`) and listens
   on `127.0.0.1` with ephemeral ports; all demo traffic goes over real HTTP via `fetch`.
4. Seeds via `seedDemo`, then walks the loop asserting every step
   (`PASS <label>` / `FAIL <label> — <detail>`; any failure → non-zero exit).

### What the demo proves, step by step

| Step | Action | Assertion (minor units) |
|------|--------|--------------------------|
| 1 | `POST /v1/links` as publisher_owner | 201, 32-hex-char token captured |
| 2 | `GET /r/{token}` on the redirect app | 302, `Location` carries `subid=<click_id>` |
| 3 | conversion webhook as network_admin (`txn-demo-1`, INR 2000 order → INR 160 commission, occurred 40d ago) | 202 accepted |
| 4 | `GET /v1/publisher/earnings` + direct ledger read | publisher approved == **11200** (INR 112); `platform_commission` net == **4800** (INR 48); Σdebit == Σcredit per currency |
| 5 | re-post the identical webhook twice | both → `200 {deduped:true}`; exactly 1 conversion row, exactly 3 ledger entries |
| 6 | reversal webhook (`reversal_commission_minor` 8000, "partial return") | publisher net == **5600** (INR 56); platform net == **2400** (INR 24) |
| 7 | `merchant_settlements` row (`STMT-DEMO-1`, INR 160) | recorded |
| 8 | `POST /v1/payout-batches {currency: INR}` as finance_operator | 201, item == **5600** for the publisher |
| 9 | preparer approves own batch | **403** (maker-checker) |
| 10 | `.../approve` as finance_approver | status `approved` |
| 11 | `.../disburse` as finance_operator | status `processing`; one `payout_transfers` row, `provider_ref` captured |
| 12 | `POST /v1/integrations/stub-network/payout-callback {provider_ref, outcome: paid}` as network_admin | batch `paid`; `publisher_liability` net == 0; `payout_clearing` holds the paid 5600 Cr (relieved by out-of-scope bank reconciliation) |

It ends with a money-trail summary: `160 → 112/48 → reversal → 56/24 → payout 56`.

Demo auth is JWT bearer (`JWT_SECRET=demo-secret`); tokens are minted with
`{ sub, org_id, role }` via the api package's `jsonwebtoken`.

## pg-mem vs real Postgres — caveats

The demo is a sandbox approximation, not a second implementation. Known divergences:

- **`gen_random_uuid()`** is registered in-process (`impure: true` so pg-mem does not memoise
  it — without that flag every `default gen_random_uuid()` in a session returns the same uuid).
- **`create extension "pgcrypto";`** is stripped from the migration SQL before applying.
- **timestamptz `::text` casts are stripped for known columns** (demo-side query
  shim): pg-mem cannot cast `timestamptz` → `text`, but several service queries
  select `<ts_col>::text` (`fresh_until`, `occurred_at`, `last_status_query_at`,
  …). On real Postgres the cast yields a string the code feeds to `new Date()`;
  pg-mem's bare value parses identically, so the shim removes the cast for
  those columns only. Integer/numeric `::text` casts work in pg-mem and are
  left untouched.
- **`unique nulls not distinct` → `unique`**: pg-mem cannot parse the former. Real Postgres
  dedupes `(provider_account_id, source_transaction_id, line_id)` with NULL `line_id`;
  pg-mem treats NULLs as distinct, so the demo's conversion webhook carries an explicit
  `line_id: 'demo-line-1'` to exercise the identical dedupe path in the sandbox.
- **`0002`'s `ALTER TABLE ledger_entries … DROP CONSTRAINT` statements** reference
  Postgres's implicit constraint names, which pg-mem does not track. For pg-mem
  only, their end state is folded into the `0001` transform (the account check
  admits `payout_clearing`; the ledger dedupe key becomes
  `(idempotency_key, account)`), and the `ALTER`s are skipped — the resulting
  schema is identical to real Postgres after `0002`.
- pg-mem does not enforce every exotic constraint (deferrable FKs, some CHECK edge cases);
  the demo asserts behaviour (row counts, money nets, balances), not constraint violations.
- `bigint` aggregates are coerced with `Number(...)`/`BigInt(...)` in the demo — pg and
  pg-mem do not return identical JS types for every aggregate.
- No Redis/BullMQ in the sandbox: cache warming and event enqueueing are best-effort in the
  services and are skipped when `REDIS_URL` is unset; the database remains the source of truth.

`pnpm seed` + `pnpm migrate` against real Postgres remain the source of truth for schema
behaviour (especially the `nulls not distinct` dedupe key).

## Design notes

- **Where `pg` comes from:** `migrate.mjs` loads the driver from
  `packages/api/node_modules/pg` via `createRequire`. The `api` package owns
  the `pg` dependency, so the repo root doesn't need one just for migrations.
  This breaks if the api package ever drops `pg` — the runner will fail loudly
  with a module-not-found error.
- **No schema-migrations table (yet):** the runner applies every file every
  time. That's fine while there's a single migration; before `0002` lands,
  add a `schema_migrations` table and record applied filenames.
- **Redundant indexes:** `links(token)` and `clicks(click_id)` have both a
  UNIQUE constraint and an explicit `create index` per the build contract.
  The explicit ones are redundant — safe to drop if index bloat matters.
- **Dedupe:** `conversions` uses `unique nulls not distinct
  (provider_account_id, source_transaction_id, line_id)` so a NULL `line_id`
  never collapses distinct provider lines into one bucket.
- **`conversions.click_id` is nullable by design:** NULL means
  suspense/unattributed. It must never be guessed or back-filled heuristically.
