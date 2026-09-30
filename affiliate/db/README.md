# db/

Postgres schema and migration runner for the Paparazzi Affiliate Commerce Platform.

## Layout

- `migrations/` — SQL migrations, applied **in lexical order** (`0001_core.sql`, `0002_money_loop.sql`, …,
  `0006_amazon_associates.sql`).
- `migrate.mjs` — applies `migrations/*.sql` in lexical order, one transaction per file, and
  records each file in `schema_migrations` (see "Migration tracking"). Exports
  `runMigrations(databaseUrl, opts)`; CLI flags `--status` and `--baseline`.
- `seed.ts` — exports `seedDemo(query)`; inserts the fixed demo graph (organisation, users,
  publisher/property, merchant/programme, contract, catalogue, look, campaign/placement).
  Executable directly against a real Postgres.
- `seed-network.ts` — exports `seedNetwork(query, opts)` and the network-file parser
  `networkFromYaml`; Afflino's in-house publisher network, read from a network file (see
  "Network seed"). Idempotent.
- `meta-network.ts` — turns the owner's Meta channel exports
  (`meta-channels-28d-<platform>-<date>.csv`) into a network file on stdout:
  Facebook pages by page ID, Instagram accounts by handle, unique names and
  keys, checked with `networkFromYaml` before anything is written. Its output
  is real account data and belongs on the server (`/etc/afflino/network.yaml`),
  never in this repository (`docs/runbooks/deploy.md`, "The in-house network").
- `network.example.yaml` — the seed's default network file: six TEST properties, one per
  platform (Instagram, Facebook, YouTube, Snapchat, Telegram, web), on reserved example.com names.
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

# 5. or seed the in-house publisher network (also wired as `pnpm seed:network`)
./packages/api/node_modules/.bin/tsx db/seed-network.ts --with-demo-programme
```

Each migration file runs inside its own transaction; the runner stops on the first
failure and exits non-zero. `pnpm seed` connects with `DATABASE_URL`, calls `seedDemo`,
and prints the seeded ids as JSON. Money is `bigint` minor units (paise) everywhere.

Re-running `pnpm seed` merges rows that carry a natural unique key
(`organisations.slug`, `users.email`, `properties(platform, external_account_id)`,
`placements.placement_key`, `contracts(publisher_id, programme_id, version)`); tables without
a natural key will insert duplicate rows — prefer a fresh database per run.
(`seed-network.ts` is different: it merges every row, see below.)

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

## Network seed (in-house publisher network)

`seed-network.ts` registers Afflino's own publisher network — the accounts and sites Afflino
runs itself, beside the third-party creators and publishers who come through onboarding.
It reads a **network file** (YAML), by default `db/network.example.yaml` (override with
`--network <path>` or `NETWORK_FILE`; the flag wins):

```yaml
properties:
  - key: demo-ig                 # unique, 1-40 of [a-z0-9-]
    name: Demo Instagram         # unique (case-insensitive), at most 80 characters
    platform: instagram          # instagram | facebook | youtube | snapchat | telegram | web
    account: demo.afflino        # handle (social) or bare hostname (web)
    url: https://instagram.example.com/demo.afflino   # https; for web, host == account
```

**Validation** (`networkFromYaml`, unit-tested in `packages/api/test/seed-network.test.ts`):
the whole file is rejected — nothing is seeded — for a missing or empty `properties:` list, a
top-level key other than `properties`, a field other than the five above, a missing or empty
field, a key outside `[a-z0-9-]`, a name longer than 80 characters, a platform outside the
five, a web account that is not a bare hostname or a handle outside `[a-z0-9._-]` (a leading
`@` is dropped, handles are lower-cased), a url that is not https or carries credentials, a web
url whose host differs from its account, and a duplicate key, name or platform + account. A url whose host is **not** a reserved example
name (example.com / .net / .org and subdomains, `.example`, `.test`, `.invalid`, `.localhost`;
RFC 2606 / RFC 6761) is a **warning** on stderr, not an error: an operator's own file lists real
accounts, which the seed has no way to verify. The shipped example file is TEST data only and
must stay warning-free (tested).

It creates, all within one transaction:

| Row | Natural key it merges on | Values |
|-----|--------------------------|--------|
| organisation | `slug` | `afflino` / "Afflino" |
| users + memberships | `email` / `(user_id, org_id)` | `publisher_owner`, `finance_operator`, `finance_approver`, `network_admin` at `<role>@afflino.invalid` (RFC 2606 placeholder; override with `SEED_OWNER_EMAIL`, `SEED_OPERATOR_EMAIL`, `SEED_APPROVER_EMAIL`, `SEED_ADMIN_EMAIL`) |
| publisher | `(org_id, legal_name)` | "Afflino in-house network", country `IN`, status `approved`, onboarding_state `active` |
| property per network entry | `(platform, external_account_id)` | platform from the file, external_account_id = the account, canonical_url = the url, status `approved` |
| verification per property | first row for the property | method `owner_operated`, verified_by the network_admin user, `expires_at` null — created only when the property has none |
| shop property (only with `WEB_HOST` / `--web-host`) | as above | platform `web`, external_account_id = the host, canonical_url `https://<host>`; refused if the host is also a web entry of the network file |

With `--with-demo-programme` it adds a TEST-labelled sandbox programme so the network can mint
links: merchant "Demo Merchant (network sandbox)", programme "Demo Network Programme"
(`stub-network`, active, `order_value`, 30/7/30-day windows, capabilities `IN`/`INR`/
`shop.example.com`), contract v1 approved (7000 bps, threshold 5000 minor), product
"Demo Brand" / "Demo Network Tee" / apparel with one variant and one offer
(`https://shop.example.com/p/demo-network-sku`, 149900 minor, fresh 30 days — refreshed on
re-run), one published look per property ("Demo look — <name>", `source_page` = the name,
`sponsored` false, locale `en`, category Fashion, cover asset `demo/network/<key>.jpg`, one
`exact` look item), campaign "Demo Network Campaign", and one placement per property
(`network-<key>-<channel>`, channel `instagram_bio` / `facebook_post` /
`youtube_description` / `snapchat_profile` / `telegram_post` / `web_article` by platform; `network-shop-web`, channel
`shop_web`, for the shop host). The demo programme refuses to seed under
`NODE_ENV=production`, and so does the example network file (`db/network.example.yaml`,
whether by default or by `--network`): a production run names the operator's own file, so a
re-run that lost `NETWORK_FILE` fails instead of seeding the six TEST properties into the
real organisation. `--with-demo-programme` without `WEB_HOST` prints a notice on stderr: no
shop placement, so no `web_placement_id`.

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
zero new rows and converges descriptive columns (canonical_url, offer price and
`fresh_until`, look `cover_asset_id`, …). **Status is set on insert only**: a re-run never
lifts a suspended publisher or property, un-pauses a programme (the kill switch), un-revokes
an offer, republishes a withdrawn look (a rights takedown), rewrites an existing contract
version or re-grants a membership role. `(platform, external_account_id)` and
`placement_key` are unique across all organisations, so the seed refuses (and rolls back)
rather than take over a property or placement another organisation owns. Verified on a
fresh database with the example file and `WEB_HOST` set: two consecutive
`--with-demo-programme` runs give identical counts (organisations 1, users 4, publishers 1,
properties 6 (5 + the shop), verifications 6, programmes 1, contracts 1, offers 1,
campaigns 1, assets 5, looks 5, look_items 5, placements 6) and byte-identical JSON.

It prints one JSON document on stdout (progress and warnings go to stderr): `org_id`,
`org_slug`, `publisher_id`, `users.<role>.{id,email,role}` (`role` is the one the
membership holds in the database, so a role an operator changed shows as changed),
`properties[].{key,name,platform,account,url,property_id,verification_id,placement_id,look_id}`,
`shop_property`, `demo_programme.{merchant_id,programme_id,contract_id,product_id,variant_id,
offer_id,campaign_id,looks[]}` and, when the shop host has a placement, `web_placement_id` —
the value for `WEB_PLACEMENT_ID`.

```sh
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi ./packages/api/node_modules/.bin/tsx db/seed-network.ts --with-demo-programme
WEB_HOST=shop.example.com DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi ./packages/api/node_modules/.bin/tsx db/seed-network.ts --with-demo-programme
```

The `yaml` parser and the `pg` driver are borrowed from `packages/api/node_modules` via
`createRequire`, like `migrate.mjs`; no new dependency at the repo root.

## Amazon.in Associates (0006)

`0006_amazon_associates.sql` is additive (new tables, nullable columns, checks every existing row
satisfies; no triggers, so pg-mem runs it too). Verified 2026-09-29 on PostgreSQL 16.13: 0001–0006
on a fresh database (a second run: `0 migration(s) applied, 6 already applied`), and 0006 on top
of a database migrated to 0005 and seeded like production (`seed-network.ts` with a TEST network
file under `NODE_ENV=production`, no demo programme): `1 migration(s) applied, 5 already
applied`, every row count unchanged, and a second network seed printing byte-identical output.

- `amazon_associates_accounts` — the Associates account behind an Amazon programme: one per
  organisation and marketplace, one per programme. `store_id` (the default tracking ID, never an
  attribution basis), `account_ref` (= `conversions.provider_account_id` of its report rows,
  `amazon-associates:<store id>`), `marketplace_host`, `disclosure_text`, `status`,
  `api_paused_until` (the workers' product-API back-off after a 429 / 401 / 403). There is no
  sub-tag and no third-party column: no click id ever goes on an Amazon URL (LR: "Under no
  circumstances may you associate any sub-tag with a specific end user"), and links go on
  owner-operated properties only (PR 9) — nothing can switch either on.
- `amazon_tracking_ids` — a tracking ID → exactly one placement (unique per account both ways),
  `effective_from` (when the mapping began; earlier report rows are not attributed by it).
- `offers.price_minor` may be NULL (a price that may not be shown), with `price_as_of` (when the
  product API gave it; a check: no time without a price), `merchant_item_ref` (the ASIN) and
  `stale_reason` (`merchant_not_accessible`: Amazon's product API reported the item gone; the
  offers CLI keeps such an offer stale unless `--reactivate`);
  `programme_capabilities.price_max_age_hours` (1 for Amazon — the Creators API's "Offers | 1
  hour", stricter than OA §11's 24 hours; NULL = the rule before 0006).
- `conversions.placement_id` (attributed through a tracking-ID mapping, never together with
  `click_id` — a check), `returned_tracking_ref`, `item_ref` (the ASIN) and `suspense_reason`.

The rows are written by the api image's CLI, not by a seed in this directory:
`node dist/cli/amazon.js setup | offers | template | links | import-report | returns |
apply-return | status | pause | resume` (`packages/api/src/cli/amazon.ts`; on the Linode through
`deploy/linode/amazon.sh`,
`docs/runbooks/deploy.md` §1A; `offers` also writes the shop's looks for rows with a `look`;
real values in files on the server; the TEST fixtures are
`packages/api/test/fixtures/amazon-*.example.*`, refused under `NODE_ENV=production`).

## Celebrity looks (0007)

`0007_celebrity_looks.sql` is additive too (new tables, nullable columns, columns with defaults,
checks every existing row satisfies, no triggers, no regular expressions in a CHECK). Verified
2026-09-30 on PostgreSQL 16: 0001–0007 on a fresh database (`scripts/celebrity-looks-pg.ts`), and
0007 on top of a database migrated to 0006 and seeded like production (`seed-network.ts` with a
copy of the example network under `NODE_ENV=production`, the Amazon setup with TEST values under
development): `1 migration(s) applied, 6 already applied`, every row count unchanged, a second
network seed byte-identical. The three `place_confirmed_*` columns were added to 0007 in place
during the reviews of 2026-09-30, before 0007 was ever committed or applied outside scratch
databases (as 0006 was); the two verifications were re-run on the edited file.

- `memberships.role` admits `rights_reviewer` (counsel's reviewer: the only role that sets a
  celebrity beyond `blocked` and restores a takedown).
- `celebrities` — `rights_status` (`unreviewed` default | `editorial` | `cleared` | `blocked`),
  `max_display` (`none` default | `name_only` | `name_and_image`), `shoppable`, `is_minor`,
  `never_list`, `name_key` / `aliases` (normalised, for matching library rows), `slug`, the
  reviewer, time and evidence reference, `takedown_id`. The checks are the floor under the
  capability matrix (`@paparazzi/shared` `celebrity.ts`): unreviewed / blocked allow nothing; a
  minor or never-listed celebrity can never leave unreviewed / blocked; any other status names
  its reviewer and time; editorial / cleared carry an evidence reference; `none` is never
  shoppable. `celebrity_rights_reviews` keeps every decision (append-only; `review`, `rename`,
  `minor_flag`).
- `assets` gains the licence facts a library row must carry (`kind`, `commercial_reuse`
  default `unknown`, `source_ref`, `copyright_owner`, `author`, `acquisition`,
  `assignment_ref`, `live_performance`, `minor_in_frame`, `bystanders`, `sensitive_location`,
  `screen_status` / `screened_by` / `screened_at`, and `licence_via`: `import` = the file's
  own columns, `statement` = the owner's ownership statement, `review` = a person's edit through
  the API, which a later import never widens); unique `(org_id, kind, storage_key)`.
- `library_ownership_statements` — the owner's dated statement that the organisation owns its
  library footage (`kind` `owned` | `withdrawn`, the copyright owner, `acquisition` `staff` |
  `other`, the words the owner confirmed, who recorded it and when). Append-only, ordered by
  `seq` (unique per organisation); the highest row decides. Added to 0007 in place on
  2026-09-30 (the owner: "all clips are owned by us"), before 0007 was committed or applied
  outside scratch databases, with `assets.licence_via`.
- `looks` gains the moment (`celebrity_id`, `event_name`, `place`, `place_kind`,
  `moment_date`, the video and still assets, `property_id` = the in-house page that posted
  it, `post_permalink` https only, `platform_post_id`, `library_ref` = the library's video
  reference, unique per organisation, the import's idempotency key), `celebrity_display`,
  `takedown_id`, `withdrawn_at`, and the rights reviewer's confirmation of a `street` /
  `other` place (`place_confirmed_by` / `place_confirmed_at`, both or neither, and an
  optional `place_confirmed_note` of up to 300 characters; cleared by the API when the event,
  the place or its kind changes).
- `look_pieces` — the outfit piece by piece: label (1–60), `garment_category` (the 24 of
  `GARMENT_CATEGORIES`, tested equal), `position`, an optional hotspot (both coordinates or
  neither, 0..1), `removed_at`.
- `look_items` belong to a piece (`piece_id`; `asset_id` now nullable). Four checks scoped to
  piece items (legacy and Amazon shelf items untouched): a piece item has a match type, a review
  state and its tagger; SIMILAR is always `approved`; EXACT carries evidence (≥ 10 characters)
  and its source; an approved EXACT names a reviewer other than the tagger. Two partial unique
  indexes over rows not removed: one EXACT per piece, a product variant once per piece.
- `storefronts` — one per in-house property (its link-in-bio), `slug` unique per organisation,
  `draft` | `live` | `hidden`.
- `takedowns` (scope `celebrity` | `look`, `reason_code`, an opaque `requester_ref`,
  `requested_at` = when the notice arrived, `actioned_at` = when the row committed,
  `completed_at` = when the caches were cleared, restore fields, counts) and `takedown_looks`
  (each withdrawn look's previous status; `post_removed_at`, the owner's confirmation).
- `links.look_item_id`, `paused_by_takedown_id`, `paused_reason` (`takedown` |
  `rights_review` | `item_removed` | `look_unpublished`): a restore or a rights upgrade
  reactivates exactly the links it paused.
- Comment replies: `meta_accounts` (a Meta account id → an in-house property), `reply_rules`
  (keywords → one look; `enabled` default false; the public reply may not carry a link),
  `reply_events` (unique `(platform, comment_id)`; `commenter_hash` = HMAC-SHA256 hex of the
  scoped id — no comment text, username, raw id or token is stored anywhere),
  `reply_suppressions` (opt-outs), `reply_daily`.
- `click_daily` (`org_id`, IST `day`, `link_id`, `via`) and `idx_clicks_org_occurred` for the
  hourly rollup.

The rows are written by the API and by the api image's CLI (`node dist/cli/looks.js import |
status | celebrities | review | takedown | restore | takedowns | storefronts`,
`packages/api/src/cli/looks.ts`; on the Linode `deploy/linode/looks.sh`, `docs/runbooks/deploy.md`
§1C), not by a seed here. The library file lives on the server (`/etc/afflino/library/`), never
in this repository; the TEST example is `db/fixtures/library.example.csv` (people "Demo Star One" / "Demo Star
Two", `example.com` hosts; the tests' world is `packages/api/test/celebrity-fixtures.ts`), and
TEST rows are refused under `NODE_ENV=production`.

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
- **0007 (2026-09-30):** `char_length(text)` is registered in-process (pg-mem lacks it; the
  checks use it); the memberships role check is dropped by pg-mem's name for it
  (`memberships_constraint_1`); pg-mem answers any query whose WHERE shares a predicate with a
  partial index from that index alone, so the two partial indexes whose predicate is only
  `<col> is not null` become plain unique indexes (the same constraint, NULLs being distinct)
  and the two on `look_items` (one EXACT per piece, a variant once per piece) are not created
  under pg-mem. The API pre-checks both (409) and `scripts/celebrity-looks-pg.ts` proves the
  indexes themselves (23505) on a real PostgreSQL. The same shims are in
  `packages/api/test/pgmem.ts` and `scripts/demo-money-loop.ts`.
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
