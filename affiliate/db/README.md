# db/

Postgres schema and migration runner for the Paparazzi Affiliate Commerce Platform.

## Layout

- `migrations/` — SQL migrations, applied **in lexical order** (`0001_core.sql`, `0002_money_loop.sql`, …).
- `migrate.mjs` — applies `migrations/*.sql` in lexical order, one transaction per file, and
  records each file in `schema_migrations` (see "Migration tracking"). Exports
  `runMigrations(databaseUrl, opts)`; CLI flags `--status` and `--baseline`.
- `seed.ts` — exports `seedDemo(query)`; inserts the fixed demo graph (organisation, users,
  publisher/property, merchant/programme, contract, catalogue, look, campaign/placement).
  Executable directly against a real Postgres.
- `seed-fleet.ts` — exports `seedFleet(query, opts)`; the in-house publisher network built
  from `autopub/config/sites.yaml` (see "Fleet seed"). Idempotent.
- `../scripts/demo-money-loop.ts` — the end-to-end money-loop demo (in-process pg-mem
  sandbox by default; `DEMO_TARGET=postgres` runs the same assertions on a real Postgres).

## Usage (real Postgres)

```sh
# 1. start postgres + redis
docker compose up -d        # or: pnpm dev:db

# 2. point at the database (see ../.env.example)
export DATABASE_URL=postgresql://paparazzi:changeme@localhost:5432/paparazzi

# 3. run pending migrations (also wired as `pnpm migrate`)
node db/migrate.mjs
node db/migrate.mjs --status      # applied / pending, read-only (pnpm migrate:status)

# 4. seed the demo graph (also wired as `pnpm seed`)
pnpm seed

# 5. or seed the in-house publisher network (also wired as `pnpm seed:fleet`)
./packages/api/node_modules/.bin/tsx db/seed-fleet.ts --with-demo-programme
```

Each migration file runs inside its own transaction; the runner stops on the first
failure and exits non-zero. `pnpm seed` connects with `DATABASE_URL`, calls `seedDemo`,
and prints the seeded ids as JSON. Money is `bigint` minor units (paise) everywhere.

Re-running `pnpm seed` merges rows that carry a natural unique key
(`organisations.slug`, `users.email`, `properties(platform, external_account_id)`,
`placements.placement_key`, `contracts(publisher_id, programme_id, version)`); tables without
a natural key will insert duplicate rows — prefer a fresh database per run.
(`seed-fleet.ts` is different: it merges every row, see below.)

## Migration tracking (`schema_migrations`)

`migrate.mjs` keeps `schema_migrations (filename text primary key, applied_at timestamptz
not null default now())`, created on first use. A file already recorded there is skipped;
a file that runs is recorded **inside the same transaction** as its SQL, so a failed file
leaves neither schema nor record. Migration files are append-only; never edit a recorded one.

- `node db/migrate.mjs` — apply pending files in lexical order; stop on the first failure.
- `node db/migrate.mjs --status` — list applied (with timestamp) / pending; read-only, never
  creates the table.
- `node db/migrate.mjs --baseline` — record every present file as applied **without running
  it**, printing what it recorded. For databases created before tracking existed.

**Databases created before tracking existed** (schema already at the latest file, no
`schema_migrations` table): a plain run creates the empty table, tries `0001_core.sql`,
and fails loudly with `relation "organisations" already exists` plus a hint naming
`--baseline`. That failure is the signal — it means the runner refused to guess. If the
schema really is current, run `node db/migrate.mjs --baseline` once, after which a plain run
is a no-op. If the schema is *not* current, do not baseline; fix the database by hand.
Baseline trusts the operator and verifies nothing.

Single-line commands for the existing dev database:

```sh
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi node db/migrate.mjs --baseline
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi node db/migrate.mjs --status
```

`runMigrations(databaseUrl, { mode: 'apply' | 'baseline' | 'status', log })` is exported for
other scripts and returns `{ files, applied, recorded, skipped, pending, trackingTable }`;
it throws a `MigrationError` (with `.file`, `.code`, `.hint`) on the first failing file.

## Fleet seed (in-house publisher network)

`seed-fleet.ts` turns the owner's five WordPress sites into the platform's first publisher.
It reads the `sites:` list (`key`, `domain`, `name`) from
`../autopub/config/sites.yaml` (override with `--sites <path>` or `FLEET_SITES_YAML`) and
creates, all within one transaction:

| Row | Natural key it merges on | Values |
|-----|--------------------------|--------|
| organisation | `slug` | `marketing-fleet` / "Marketing Fleet" |
| users + memberships | `email` / `(user_id, org_id)` | `publisher_owner`, `finance_operator`, `finance_approver`, `network_admin` at `<role>@marketing-fleet.invalid` (RFC 2606 placeholder; override with `FLEET_OWNER_EMAIL`, `FLEET_OPERATOR_EMAIL`, `FLEET_APPROVER_EMAIL`, `FLEET_ADMIN_EMAIL`) |
| publisher | `(org_id, legal_name)` | "Marketing Fleet (in-house)", country `IN`, status `approved`, onboarding_state `active` |
| property per site | `(platform, external_account_id)` | platform `web`, external_account_id = the domain, canonical_url `https://<domain>`, status `approved` |
| verification per property | first row for the property | method `owner_operated`, verified_by the network_admin user, `expires_at` null — created only when the property has none |
| shop property (only with `AFFILIATE_WEB_HOST` / `--web-host`) | as above | platform `web`, external_account_id = the host, canonical_url `https://<host>` |

With `--with-demo-programme` it adds a TEST-labelled sandbox programme so the sites can mint
links: merchant "Demo Merchant (fleet sandbox)", programme "Demo Fleet Programme"
(`stub-network`, active, `order_value`, 30/7/30-day windows, capabilities `IN`/`INR`/
`shop.example.com`), contract v1 approved (7000 bps, threshold 5000 minor), product
"Demo Brand" / "Demo Fleet Tee" / apparel with one variant and one offer
(`https://shop.example.com/p/demo-fleet-sku`, 149900 minor, fresh 30 days — refreshed on
re-run), one published look per site ("Demo look — <site name>", `source_page` = site
name, `sponsored` false, locale `en`, category Fashion, cover asset `demo/fleet/<key>.jpg`,
one `exact` look item), campaign "Demo Fleet Campaign", and one placement per property
(`fleet-<key>-web`, channel `web_article`; `fleet-shop-web`, channel `shop_web`, for the
shop host). The demo programme refuses to seed under `NODE_ENV=production`.

Placements need a campaign, so they (and therefore `web_placement_id`) exist only with
`--with-demo-programme` until a real programme is contracted.

**Deliberate shortcut:** the publisher is created directly as `status = 'approved'` and
`onboarding_state = 'active'`, skipping the onboarding state machine
(`application → identity_review → … → active`, `0003_phase3.sql`). The publisher *is* the
operator: there is no counterparty to review its identity, properties or eligibility, and
`POST /v1/links` would otherwise refuse to mint for it (`PUBLISHER_NOT_ACTIVE`). Every
third-party publisher still goes through the state machine.

**Idempotence:** every row is merged on the natural key in the table above (`on conflict`
where a unique constraint exists, select-then-insert otherwise), so a second run creates
zero new rows and converges mutable columns (status, canonical_url, offer `fresh_until`,
look `cover_asset_id`, …). Verified on a fresh database: two consecutive
`--with-demo-programme` runs give identical counts (organisations 1, users 4, publishers 1,
properties 5 (+1 with a shop host), verifications 5 (+1), programmes 1, looks 5,
look_items 5, placements 5 (+1), offers 1) and identical ids.

It prints one JSON document on stdout (progress goes to stderr): `org_id`, `publisher_id`,
`users.<role>.{id,email,role}`, `properties[].{key,name,domain,property_id,verification_id,
placement_id,look_id}`, `shop_property`, `demo_programme.{merchant_id,programme_id,
contract_id,product_id,variant_id,offer_id,campaign_id,looks[]}` and, when the shop host
has a placement, `web_placement_id` — the value for `WEB_PLACEMENT_ID`.

```sh
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi ./packages/api/node_modules/.bin/tsx db/seed-fleet.ts --with-demo-programme
AFFILIATE_WEB_HOST=shop.example.com DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi ./packages/api/node_modules/.bin/tsx db/seed-fleet.ts --with-demo-programme
```

The `yaml` parser and the `pg` driver are borrowed from `packages/api/node_modules` via
`createRequire`, like `migrate.mjs`; no new dependency at the repo root.

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

### The same demo on a real Postgres (`pnpm demo:pg`)

```sh
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi DEMO_TARGET=postgres ./packages/api/node_modules/.bin/tsx scripts/demo-money-loop.ts
```

`DEMO_TARGET=postgres` runs the identical steps and assertions against a real server with
**no** pg-mem shims: the migrations are applied verbatim through `runMigrations` from
`db/migrate.mjs` (so `unique nulls not distinct`, timestamptz `::text` and `0002`'s
`ledger_entries` `ALTER`s all run for real), and a real `pg.Pool` is injected through
`__setPool`. It creates a scratch database `paparazzi_demo_<8 hex>` on the `DATABASE_URL`
server (through the `postgres` maintenance database, same credentials) and drops it at the
end **even when a step throws or fails**; only names starting with `paparazzi_demo_` are ever
dropped. To use a database you manage yourself, set `DEMO_DATABASE_URL` to an *empty*
database: it is then used as-is, never created or dropped (a database that already has
migrations recorded is refused, because the demo asserts absolute row counts). The
`NODE_ENV=production` guard applies to both targets. Verified on Postgres 16: 51/51, no
`paparazzi_demo_*` row left in `pg_database`.

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
behaviour (especially the `nulls not distinct` dedupe key), and `pnpm demo:pg` proves the
money loop on it. Running both targets: no demo assertion had to change between pg-mem and
Postgres 16 — the demo already reads every `bigint` aggregate through `::text` +
`Number(...)`/`BigInt(...)`, so the string-vs-number difference in `pg` never reaches an
assertion.

## Design notes

- **Where `pg` comes from:** `migrate.mjs` loads the driver from
  `packages/api/node_modules/pg` via `createRequire`. The `api` package owns
  the `pg` dependency, so the repo root doesn't need one just for migrations.
  This breaks if the api package ever drops `pg` — the runner will fail loudly
  with a module-not-found error.
- **`schema_migrations` is the only record of what ran.** The runner does not
  hash file contents, so editing an already-recorded file changes nothing on
  any database that recorded it; new schema goes in a new file. `--baseline`
  is an operator assertion, not a check — see "Migration tracking".
- **Redundant indexes:** `links(token)` and `clicks(click_id)` have both a
  UNIQUE constraint and an explicit `create index` per the build contract.
  The explicit ones are redundant — safe to drop if index bloat matters.
- **Dedupe:** `conversions` uses `unique nulls not distinct
  (provider_account_id, source_transaction_id, line_id)` so a NULL `line_id`
  never collapses distinct provider lines into one bucket.
- **`conversions.click_id` is nullable by design:** NULL means
  suspense/unattributed. It must never be guessed or back-filled heuristically.
