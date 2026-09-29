# Paparazzi Affiliate Commerce Platform

Paparazzi/entertainment content → attributable affiliate purchases.
India-first, INR. The platform owns discovery, attribution, and the publisher
ledger; merchants own checkout.

> Foundation scaffold (weeks 3–6 core product). No real merchant credentials,
> no production secrets, no real money movement.

## Running Afflino

**What it is.** Afflino is a standalone website and app: an India-first
affiliate network with a marketing site, onboarding, creator / brand /
agency / admin areas and a consumer shop at `/shop`, on top of this
platform's API, click redirect, workers and Postgres ledger. It runs from
this directory alone — its own dev stack (`docker-compose.yml`: Postgres 16 +
Redis 7), production stack (`docker-compose.prod.yml`), images (`docker/`) and
CI workflow (`.github/workflows/afflino.yml` at the repository root, run on
changes under `affiliate/`).

**The in-house publisher network.** Afflino runs its own publisher network
beside the creators and publishers who sign up through `/join`.
`db/seed-network.ts` registers it from a **network file** (YAML; per property
`key`, `name` (at most 80 characters), `platform` = `instagram` | `youtube` |
`snapchat` | `telegram` | `web`, `account` = handle or hostname, `url`). The default,
[`db/network.example.yaml`](db/network.example.yaml), is TEST data only (five
"Demo …" properties on reserved `example.com` names); `--network <path>` or
`NETWORK_FILE` points the seed at the operator's own file. What it creates
(idempotent, one transaction):

| Input | Platform rows |
|---|---|
| — | organisation `afflino` ("Afflino"); publisher "Afflino in-house network", `approved` / `active` — it skips the onboarding state machine because it *is* the operator ([`scripts/ASSUMPTIONS.md`](scripts/ASSUMPTIONS.md) §11) |
| each network-file entry | one property (`platform`, `account` as `external_account_id`, `url` as canonical URL; `approved`, `owner_operated` verification); with `--with-demo-programme` one placement `network-<key>-<channel>` and one published TEST look "Demo look — <name>" |
| `WEB_HOST` / `--web-host` (the shop's host) | the shop's own `web` property and, with `--with-demo-programme`, the placement `network-shop-web` (channel `shop_web`); its id is printed as `web_placement_id` and becomes `WEB_PLACEMENT_ID` |
| `SEED_OWNER_EMAIL` / `SEED_OPERATOR_EMAIL` / `SEED_APPROVER_EMAIL` / `SEED_ADMIN_EMAIL` | the `publisher_owner`, `finance_operator`, `finance_approver`, `network_admin` logins; `<role>@afflino.invalid` (RFC 2606) until set |

Only the rows behind `--with-demo-programme` are TEST data ("Demo Merchant
(network sandbox)", "Demo Network Programme", `shop.example.com`, one offer at
149900 minor); **no real merchant programme exists** — those are human-gated
in [`docs/action-tracker.md`](docs/action-tracker.md). Under
`NODE_ENV=production` the seed refuses the flag and the example network file.
Re-runs never lift a suspension, pause, revocation or withdrawal, and the
seed refuses (rolling back) to take over a property or placement another
organisation owns ([`db/README.md`](db/README.md) "Network
seed", including the network file's validation rules).

**Local development**, from this directory (Node 22, pnpm 9.12.0, Docker):

```sh
pnpm install --frozen-lockfile
docker compose up -d postgres redis
cp .env.example .env
set -a; . ./.env; set +a
node db/migrate.mjs
./packages/api/node_modules/.bin/tsx db/seed.ts
WEB_HOST=shop.example.com ./packages/api/node_modules/.bin/tsx db/seed-network.ts --with-demo-programme
```

(`seed.ts` adds the separate TEST demo organisation — the same graph the
money-loop demo seeds into its own database; `seed-network.ts` prints its
JSON summary on stdout.) Then the dev servers,
one terminal each with the same `.env` loaded — the API on 3000, the
redirect on 3001 and the web on its own port, 3002, so it does not collide
with the API:

```sh
pnpm --filter @paparazzi/api dev
pnpm --filter @paparazzi/redirect dev
pnpm --filter @paparazzi/workers dev
PORT=3002 pnpm --filter @paparazzi/web dev
```

The web reads the API at `API_BASE` (default `http://localhost:3000`) and
proxies the browser's `/api/*` calls there; open `http://localhost:3002/`
(marketing site) and `http://localhost:3002/shop`. Without `WEB_API_TOKEN`
the shop shows TEST demo looks with a "Demo data" badge; with one (below)
it reads the seeded looks live. Checks:

```sh
pnpm typecheck
./node_modules/.bin/vitest run
./packages/api/node_modules/.bin/tsx scripts/demo-money-loop.ts
DEMO_TARGET=postgres ./packages/api/node_modules/.bin/tsx scripts/demo-money-loop.ts
pnpm --filter @paparazzi/web build
```

(`tsx` is not at the repo root, hence the api package's copy; `pnpm demo`,
`pnpm demo:pg`, `pnpm seed` and `pnpm seed:network` wrap the same lines.) A
database migrated before `schema_migrations` existed needs
`node db/migrate.mjs --baseline` once — the plain run fails loudly on `0001`
with a hint, by design ([`db/README.md`](db/README.md)).

**Minting the shop's links (dev)** — consumers only see links that exist.
`packages/api/scripts/mint-links.mjs` (shipped in the api image) mints one
tracked link per live offer for a placement, idempotently
(`Idempotency-Key: mint-links:<placement>:<offer_id>`; re-runs are no-ops).
Against the API on 3000 with the network seed applied, the shop's read-only
token and a dry run of the links:

```sh
JWT_SECRET=dev-only-change-me node packages/api/scripts/mint-dev-token.mjs --org-id "$(PGPASSWORD=changeme psql -h 127.0.0.1 -U paparazzi -d paparazzi -tAc "select id from organisations where slug='afflino'")" --role publisher_analyst --sub web-shop
API_BASE=http://127.0.0.1:3000 API_TOKEN="$(JWT_SECRET=dev-only-change-me node packages/api/scripts/mint-dev-token.mjs --org-id "$(PGPASSWORD=changeme psql -h 127.0.0.1 -U paparazzi -d paparazzi -tAc "select id from organisations where slug='afflino'")" --role publisher_owner)" node packages/api/scripts/mint-links.mjs --placement "$(PGPASSWORD=changeme psql -h 127.0.0.1 -U paparazzi -d paparazzi -tAc "select id from placements where placement_key='network-shop-web'")" --dry-run
```

The first line prints the value for `WEB_API_TOKEN`; `web_placement_id` from
the seed's JSON is `WEB_PLACEMENT_ID` (both for the web server's environment).
Drop `--dry-run` to mint. The tokens are the JWT dev stub
(`mint-dev-token.mjs`, default TTL 8 h) until an identity provider lands.

**Production shape.** [`docker-compose.prod.yml`](docker-compose.prod.yml)
runs `api` (3000), `redirect` (3001), `workers` and `web` (3002) against
**managed** Postgres and Redis supplied through the environment (no database
containers), after a one-shot `migrate` service that applies pending
migrations and exits; the app services wait for it. Every value comes from
the environment ([`.env.prod.example`](.env.prod.example), filled in a vault
or `/run/secrets/paparazzi.env`, never committed). Compose interpolates the
whole file for every command and the web requires `WEB_API_TOKEN` and
`WEB_PLACEMENT_ID`, which come from the database — so the **first deploy**
migrates, seeds and mints with the images directly, from this directory.
`WEB_HOST`, the shop's public hostname, must be set in that environment for
it: without it the seed creates no shop placement and prints no
`web_placement_id`, so `WEB_PLACEMENT_ID` comes out empty and compose refuses
to start. Every `docker run` that carries a secret uses `--pull never`, so a
missing local image fails instead of being pulled from a registry:

```sh
set -a; . /run/secrets/paparazzi.env; set +a
docker build -f docker/Dockerfile.migrate -t "paparazzi/migrate:${IMAGE_TAG:-latest}" .
docker build -f docker/Dockerfile.api -t "paparazzi/api:${IMAGE_TAG:-latest}" .
docker run --rm --pull never -e DATABASE_URL "paparazzi/migrate:${IMAGE_TAG:-latest}"
docker run --rm --pull never -e DATABASE_URL -e WEB_HOST "paparazzi/migrate:${IMAGE_TAG:-latest}" ./node_modules/.bin/tsx db/seed-network.ts --with-demo-programme > seed-network.json
WEB_PLACEMENT_ID=$(grep -m1 '"web_placement_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')
WEB_API_TOKEN=$(docker run --rm --pull never -e JWT_SECRET "paparazzi/api:${IMAGE_TAG:-latest}" node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role publisher_analyst --sub web-shop --ttl 365d)
export WEB_PLACEMENT_ID WEB_API_TOKEN
docker compose -f docker-compose.prod.yml up -d --build
```

Store the two values in the vault next to the other secrets so later
deploys have them; from then on a deploy is the last line alone
([`docs/runbooks/deploy.md`](docs/runbooks/deploy.md)). The seed line above
uses the TEST example network inside the image; for the operator's own
network add `-e NETWORK_FILE=/app/config/network.yaml -v "$PWD/network.yaml:/app/config/network.yaml:ro"`
to it (the `migrate` service documents the same mount), and keep
`NETWORK_FILE=/app/config/network.yaml` in the vault with that volume
uncommented, so a later re-run of the seed reads the same file
([`docs/runbooks/deploy.md`](docs/runbooks/deploy.md) §1; under
`NODE_ENV=production` the seed refuses the example file).
`seed-network.json` stays in this directory for the lines below and is
gitignored: it holds the organisation and user ids and the `SEED_*_EMAIL`
addresses. Until a real programme is contracted, `--with-demo-programme` is the only way to get a
placement, so `WEB_PLACEMENT_ID` points at TEST rows — a sandbox shape, not a
launch. With the stack up, the links for the shop's placement are minted
from the api image with an owner token (both scripts ship in it;
`docker/README.md` "Operator scripts"):

```sh
OWNER_TOKEN=$(docker run --rm --pull never -e JWT_SECRET "paparazzi/api:${IMAGE_TAG:-latest}" node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role publisher_owner --sub network-owner)
docker compose -f docker-compose.prod.yml run --rm --no-deps -e API_BASE=http://api:3000 -e API_TOKEN="$OWNER_TOKEN" api node scripts/mint-links.mjs --placement "$WEB_PLACEMENT_ID"
```

**Environment contract** (every read documented in
[`.env.prod.example`](.env.prod.example)):

| Env | Read by | Meaning |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | api, redirect, workers; migrate (`DATABASE_URL`) | managed Postgres 16 / Redis (dev: `docker-compose.yml`) |
| `JWT_SECRET` | api | signs API tokens (the dev stub), including `WEB_API_TOKEN` |
| `STUB_WEBHOOK_SECRET` | workers | the stub connector's HMAC until a real feed lands |
| `REDIRECT_BASE_URL` | api | public origin of the redirect service; every tracked link is `<this>/r/<token>` |
| `API_BASE` | web (server runtime) | catalogue client and the `/api/*` proxy target; compose default `http://api:3000` |
| `WEB_API_TOKEN` | web (server-only) | read-only `publisher_analyst` bearer; never `NEXT_PUBLIC_`; missing → TEST demo data with a badge |
| `WEB_PLACEMENT_ID` | web | the shop's placement (`web_placement_id`); items carry tracked links only for it |
| `NEXT_PUBLIC_API_BASE` | web (build arg) | browser API base; default `/api`, the same-origin proxy |
| `NEXT_PUBLIC_SITE_NAME` | web (runtime) | site name in titles, footer, manifest; default `Afflino` (a rename is a restart) |
| `NETWORK_FILE`, `WEB_HOST`, `SEED_*_EMAIL` | migrate (`seed-network.ts`) | the network file (default the TEST example), the shop's host, the four logins |
| `RETENTION_*_DAYS`, `RETENTION_CRON` | workers | 365-day placeholders, `0 3 * * *` |
| `LOG_LEVEL`, `IMAGE_TAG` | compose | log level (`info`); the image tag to run |
| `DEMO_TARGET`, `DEMO_DATABASE_URL` | dev only | `postgres` runs the demo on a scratch database of the `DATABASE_URL` server |

**Hosting** is still a human decision: nothing is provisioned, and
[`docs/infrastructure-recommendation.md`](docs/infrastructure-recommendation.md)
(AWS ap-south-1 ≈₹6,700/mo, or DigitalOcean blr1 ≈₹5,200/mo) needs the
owner's approval first; [`docs/capacity-plan.md`](docs/capacity-plan.md) says
why its sizes must be revisited against a measured click-through.

**Real-Postgres demo** — `DEMO_TARGET=postgres` runs the 51-assertion money
loop on a scratch database `paparazzi_demo_<8 hex>` created on the
`DATABASE_URL` server and dropped at exit (verified on PostgreSQL 16.13:
51 PASS, 0 FAIL, 0 scratch databases left). Same assertions as pg-mem, no
shims ([`db/README.md`](db/README.md)).

## Setup

Prerequisites: **Node 22** (`engines` ≥ 20), **pnpm 9.12.0** (`packageManager`;
CI and the images use the same version), **Docker**.

```sh
pnpm install                 # already run at scaffold time; re-run after pulling
docker compose up -d         # postgres :5432 + redis :6379 (or: pnpm dev:db)

cp .env.example .env         # adjust as needed
node db/migrate.mjs          # or: pnpm migrate
```

Per-package dev servers:

```sh
pnpm --filter @paparazzi/api dev
pnpm --filter @paparazzi/redirect dev
pnpm --filter @paparazzi/workers dev
pnpm --filter @paparazzi/web dev
```

Typecheck everything:

```sh
pnpm typecheck
```

## Demo

The end-to-end money loop runs **in-process** — no Docker, no real database,
no real money:

```sh
pnpm demo
```

`scripts/demo-money-loop.ts` boots a pg-mem Postgres, applies `db/migrations/*.sql`
(with the pg-mem shims documented at the top of the script), swaps the API's pool
via the `__setPool` test seam, and serves the API + redirect apps over real HTTP
on `127.0.0.1` ephemeral ports. It then walks the full money loop and asserts
every step — **51 assertions, all PASS** (any failure sets a non-zero exit code):

1. Mint a tracked link (`POST /v1/links` → 201, 32-hex token).
2. Click the redirect (`GET /r/{token}` → 302, `subid=<click_id>` in Location).
3. Approved conversion webhook: INR 2000 order → INR 160 commission (202).
4. Earnings + ledger: 70/30 split → publisher INR 112 / platform INR 48; books balance.
5. Duplicate webhooks dedupe (200 `{deduped:true}`; exactly 1 conversion, 3 ledger rows).
6. 50% reversal → publisher INR 56 / platform INR 24.
7. Merchant settlement `STMT-DEMO-1` (INR 160 collected).
8. Prepare payout batch → 201, item INR 56 (threshold INR 50, deliberately low).
9. Maker-checker: preparer approving own batch → 403.
10. Approver approves → `approved`.
11. Disburse → `processing`, one `payout_transfers` row.
12. Provider callback `paid` → batch `paid`; `publisher_liability` nets to 0;
    `payout_clearing` holds the 5600 Cr pending bank reconciliation.
13. **PAYOUT-FAILURE scenario** (second conversion, INR 80 commission → new INR 56 batch):
    - ambiguous provider outcome → callback `unknown`, batch stays `processing`, no ledger;
    - **blind re-disburse refused**: 409 `TRANSFER_STATUS_UNKNOWN`, still exactly one
      transfer row, `provider_ref` unchanged — a status query is required before any retry;
    - `POST /v1/payout-transfers/{providerRef}/status-query` → 200, records
      `last_status_query_at` and arms the 5-minute retry guard;
    - informed retry re-initiates the **same** transfer (`unknown` → `processing`),
      still one row — **no double payout**;
    - provider callback `paid` → batch paid, `publisher_liability` 0,
      `payout_clearing` holds 11200 Cr (2 × 5600), books still balanced.

Expected output: `PASS …` lines per step, then the money-trail summary
(commission 16000 → split 11200/4800 → post-reversal 5600/2400 → settlement
`STMT-DEMO-1` → two paid INR-56 batches → clearing 11200), ending with
`All demo assertions passed.`

Sandbox guards: the script **refuses to run with `NODE_ENV=production`**
(loud `REFUSING TO RUN` + exit 1). All demo/seed data is unmistakably fake —
`Demo …` names, `demo.`-prefixed accounts/URLs, `txn-demo-*` / `demo-line-*`
transaction refs, `STMT-DEMO-*` statements, RFC 2606 `example.com` domains —
and the payout rail is a stub (see `packages/api/src/payout-rail.ts`).

The same 51 assertions run on a **real Postgres** with `DEMO_TARGET=postgres`
(`pnpm demo:pg`): the migrations are applied verbatim through
`db/migrate.mjs` (no pg-mem shims), on a scratch database
`paparazzi_demo_<8 hex>` created on the `DATABASE_URL` server and dropped at
exit even when a step fails; `DEMO_DATABASE_URL` names an *empty* database to
use as-is instead. Verified on PostgreSQL 16.13 — no assertion differs between
the two targets ([db/README.md](db/README.md)).

## Retention purge

Raw tracking payloads age out on a schedule; financial and governance records
never do. Three classes — aged `clicks.context` / `conversions.raw` payloads
are nulled, aged **published** outbox rows are deleted — with per-class
windows from `RETENTION_CLICK_CONTEXT_DAYS` / `RETENTION_CONVERSION_RAW_DAYS` /
`RETENTION_OUTBOX_DAYS` (conservative sandbox default: 365 days each; counsel
may shorten — see `docs/counsel-briefing.md` §1). `ledger_entries`,
`audit_log`, and `adjustments` are never touched, so publisher statements stay
reproducible after every purge.

```sh
# one-off run (same code path the scheduled job uses)
pnpm --filter @paparazzi/workers purge:retention
# dry-run: report what would be purged, write nothing
pnpm --filter @paparazzi/workers purge:retention -- --dry-run
```

In production the workers service registers a daily BullMQ repeatable job
(`retention` queue, `RETENTION_CRON`, default `0 3 * * *`) at startup. Each run
writes one `audit_log` row per org per class (`action='retention.purge'`).
Details: [workers README](packages/workers/README.md) ·
[assumptions](packages/workers/ASSUMPTIONS.md).

## Backup & restore

Daily `pg_dump -Fc` of the Postgres database, verified immediately
(`pg_restore --list`), hashed (SHA-256), and described by a JSON manifest
(timestamp, DB name, PG version, digest, row counts of the money-critical
tables) written next to the dump. The restore drill replays a dump into a
scratch database and validates it: per-table row counts vs the manifest,
plus the ledger double-entry invariant
(`sum(debit_minor) == sum(credit_minor)` per currency over `ledger_entries`).

```sh
BACKUP_DIR=./backups scripts/backup.sh
scripts/restore.sh "$(ls -t ./backups/*.dump | head -1)"
```

Connection: `DATABASE_URL` first, else `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/
`PGDATABASE` (defaults match `docker-compose.yml`; no default password —
supply `PGPASSWORD`, `~/.pgpass`, or a URL). **Safety:** `backup.sh` refuses
targets whose host or DB name looks production-like (`prod|prd|production|
live`) unless `PAPARAZZI_ALLOW_PROD=yes` is set explicitly; `restore.sh`
drops and recreates its scratch target (`paparazzi_restore_drill` by
default) and hard-refuses anything production-like with no override.
Full procedure, schedule, retention proposal, and the pilot-gate evidence
checklist: [backup/restore runbook](docs/runbooks/backup-restore.md) ·
[assumptions](scripts/ASSUMPTIONS.md).

## Infrastructure & deployment

Sandbox only — nothing is provisioned and no real credentials exist. The
pilot recommendation (AWS ap-south-1 Mumbai, with a DigitalOcean blr1
alternative), dated cost estimates (~₹5,200–6,700/mo), backup strategy,
monitoring stack, and the DPDP open questions for counsel live in
[docs/infrastructure-recommendation.md](docs/infrastructure-recommendation.md)
— **it needs your approval before anything is provisioned.**

Deployment shape: [docker-compose.prod.yml](docker-compose.prod.yml) runs
`api`, `redirect`, `workers`, `web` plus a one-shot `migrate` service
against **managed** Postgres/Redis supplied via environment (no Postgres or
Redis containers in prod). The five images in `docker/` build and boot end
to end ([docker/README.md](docker/README.md): build steps, runtime layout,
sizes, the recorded smoke test from migrate to a `302` with `subid`); the
first-deploy order is in "Running Afflino" above. Environment contract: [.env.prod.example](.env.prod.example) — every
`process.env` read in the codebase is documented there with a comment; the
filled copy is never committed. Secret generation, vault-vs-env rules,
rotation cadence, and the pre-launch checklist:
[docs/credential-setup.md](docs/credential-setup.md).

## Repo map

| Path | What lives there |
|---|---|
| `packages/shared/` | Cross-package contract: error codes, event envelope, domain entities, connector interface, ledger math. Zero runtime deps. See [README](packages/shared/README.md) · [assumptions](packages/shared/ASSUMPTIONS.md) |
| `packages/api/` | Merchant/publisher-facing HTTP API (Fastify). See [README](packages/api/README.md) · [assumptions](packages/api/ASSUMPTIONS.md) |
| `packages/redirect/` | Click-tracking redirect service (Fastify). See [README](packages/redirect/README.md) · [assumptions](packages/redirect/ASSUMPTIONS.md) |
| `packages/workers/` | BullMQ workers: ingestion, attribution, ledger posting, payouts. See [README](packages/workers/README.md) · [assumptions](packages/workers/ASSUMPTIONS.md) |
| `packages/web/` | The Afflino web app (Next.js 14): marketing site, onboarding, creator / brand / agency areas, admin, and the consumer shop at `/shop` (live against the catalogue API). Route map, artboards and live / demo status: [README](packages/web/README.md) · [assumptions](packages/web/ASSUMPTIONS.md) |
| `db/` | Postgres schema, migration runner with `schema_migrations` tracking, demo seed, in-house network seed and its example network file. See [README](db/README.md) |
| `docker/` | The five images (api, redirect, workers, web, migrate) and their build script. See [README](docker/README.md) · [assumptions](docker/ASSUMPTIONS.md) |
| `docs/` | OpenAPI spec, pilot checklist, action tracker, capacity plan, threat model, runbooks, alert definitions, infrastructure recommendation |

## API reference (OpenAPI)

[docs/openapi.yaml](docs/openapi.yaml) is the OpenAPI 3.1 spec for the v1 API,
written from the real route handlers (`packages/api/src/routes/*.ts`) — every
registered route is documented, nothing is invented. It covers the catalogue
(`GET /v1/looks`, `GET /v1/looks/{id}` with the live offer and tracked link
per item; never a merchant URL), link minting with its guard error codes (`PROGRAMME_NOT_APPROVED`, `OFFER_STALE`,
`PROPERTY_FORBIDDEN`, `PUBLISHER_NOT_ACTIVE`), the stub-network webhook and CSV
uploads, suspense ops, payout batches (prepare/approve/disburse + provider
callback), publisher earnings, disputes, programme pause/resume, publisher
onboarding, and contracts. The bearer-JWT auth scheme is explicitly marked as
a temporary stub to be replaced by a production IdP.

To view it:

- Paste the file into [editor.swagger.io](https://editor.swagger.io) (import
  file → renders instantly, no install).
- Or serve it locally with Redocly (not installed here; one-time setup):
  `npm i -g @redocly/cli && redocly preview-docs docs/openapi.yaml`.
- Conformance is CI-checked: `packages/api/test/openapi.test.ts` parses the
  YAML, pins the expected route list to the real app via
  `app.hasRoute()`, and asserts the spec documents exactly those routes plus
  the shared error-code enum. Run with `vitest run packages/api/test/openapi.test.ts`.

## Security

[docs/threat-model.md](docs/threat-model.md) is the pre-pentest review for this
sandbox: trust boundaries (public `/r/:token` path, the web app's creator and admin areas, finance
endpoints, webhook/CSV ingestion, workers, database), a per-component STRIDE
analysis with every mitigation tied to the code or test that implements it
(tenant isolation via `tenantQuery`, payout maker-checker, the no-guess
attribution rule, link-mint guards, the programme kill switch), residual risks
that must be fixed before any shared environment (JWT auth stub, no
provider-signature verification on the webhook ingress, dev secrets, pg-mem vs
real Postgres divergence, counsel-pending retention windows), a proposed
pentest scope, and open questions for humans (IdP choice, webhook signing,
payout rail, retention windows, secrets management).

## Assumptions (global)

- **HTTP:** Fastify 4 for `api` and `redirect` — one framework, shared plugins.
- **Queues/events:** BullMQ 5 + Redis for background jobs and the event pipeline
  (ingestion → attribution → ledger posting → payouts).
- **Data access:** raw SQL via `pg`, no ORM. The ledger is money; every insert
  is explicit, auditable SQL with no hidden queries.
- **Auth:** JWT bearer stub for now; a real identity provider replaces the
  stub before any shared environment. `JWT_SECRET` in `.env.example` is
  dev-only.
- **Dev-run / typecheck:** `tsx` for dev servers (`pnpm --filter … dev`),
  `tsc --noEmit` for typechecking (`pnpm typecheck`).
- **Web:** Next.js 14 (App Router, CSS Modules) for the Afflino web app and the shop.
- **Money:** integer minor units (paise) everywhere — see `MinorUnits` in
  `packages/shared`. Negatives are rejected; deductions are positive amounts
  on the opposite ledger side.
- **No secrets in the repo:** `.env.example` carries placeholders only;
  real `.env` files are gitignored.
- **Backup/restore:** `scripts/backup.sh` (verified `pg_dump -Fc` + JSON
  manifest) and `scripts/restore.sh` (scratch-DB drill with row-count and
  ledger-balance checks); production guards and open infra questions in
  [scripts/ASSUMPTIONS.md](scripts/ASSUMPTIONS.md).

## Integration notes (2026-09-29, the Afflino web app)

`packages/web` was rebuilt to the owner's design handover for **Afflino**, an
India-first affiliate network, and the consumer shop moved under it:

- **Routes** (`packages/web/README.md` has the full map with artboard ids):
  `/` marketing site, `/login` dev sign-in (paste the JWT stub; no real
  sign-in exists), `/join` onboarding, `/app/*` creator app, `/brand/*`
  brand workspace (`?workspace=<client id>` for an agency), `/agency`,
  `/admin/*`, and the consumer shop at `/shop`, `/looks/[id]`,
  `/looks/[id]/items/[itemId]`, `/saved`. The old `/portal/*` and
  `/console/*` URLs 307 to their new homes.
- **Live today** (through the web's same-origin `/api` proxy, with the dev
  token from `/login`): `GET /v1/publisher/earnings` (overview and payouts
  balances), `POST /v1/links` (the tracked `/r/{32-hex}` link), `GET` /
  `POST /v1/disputes`, `GET /v1/suspense` + retry / review, `POST
  /v1/publishers` (creator / publisher sign-up); server-side, the shop's
  `GET /v1/looks` and `GET /v1/looks/:id`. **Everything else is TEST demo
  data** with a visible "Demo data" badge, and the demo flows (OTP, platform
  connect, PAN "Verified", wallet top-up, withdrawals, brand approvals,
  admin decisions) say that nothing was verified, sent or charged.
- **Placeholders**: every marketing figure, price, fee, the TDS rate, the
  7-day validation window, the ₹500 minimum withdrawal and the `#ad`
  disclosure line are in `packages/web/lib/site-copy.ts`, pending business
  and counsel confirmation (`docs/pilot-checklist.md`,
  `docs/action-tracker.md`). Offer copy says "attribution window", never
  "cookie": the redirect sets none, and the design's readable
  `/r/{handle}/{offer}` links are not implemented.
- **Site name**: the deployed default is now `Afflino`
  (`NEXT_PUBLIC_SITE_NAME`); a rename is a restart.
- No API, database or image layout changed; `docker/Dockerfile.web` is
  unchanged. The web build gained one dependency, `qrcode-generator` (MIT,
  the QR download on `/app/links`).

## Integration notes (2026-09-22, phase 4 — suspense queue operations view)

- **Migration** `db/migrations/0004_suspense_ops.sql`: nullable
  `conversions.reviewed_at` / `reviewed_by` / `review_note` (+ index on
  `(org_id, received_at desc)`). No worker, connector, or webhook path ever
  writes them — the suspense read model (`click_id IS NULL`) is untouched.
- **Ops API** (`packages/api/src/routes/suspense.ts`, roles
  `finance_operator` / `finance_approver` / `network_admin`):
  - `GET /v1/suspense` — list suspense entries with programme name, raw
    provider payload (`conversions.raw`), and a data-derived `reason_code`
    (`CLICK_REF_UNMATCHED` = ref present but no click; `NO_CLICK_REF` = no
    ref). Filters: `connector`, `programme_id`, `received_from`/`received_to`,
    `reviewed`; `limit`/`offset` pagination with `total`.
  - `POST /v1/suspense/:id/retry` — re-runs attribution: binds `click_id` in
    a transaction only on an EXACT `returned_click_ref` → `clicks.click_id`
    match, then writes `audit_log` + `suspense.attributed` outbox event.
    No match → `{attributed:false}` with the row untouched; NULL ref → 422
    (nothing deterministic to retry against — no fuzzy matching, ever).
  - `POST /v1/suspense/:id/review` — marks reviewed with a required note
    (min 10 chars) + `audit_log` entry. Changes no attribution and posts no
    ledger entries, by construction.
- **Policy** (enforced in code): unknown attribution stays unknown. Retry
  never guesses a publisher (no LIKE, no timestamp/IP correlation); items
  without a reference can only be resolved by human review with recorded
  evidence. A late-attributed row emits `suspense.attributed` on the outbox
  so a downstream consumer can run ledger posting — the API itself posts no
  ledger entries from this path.
- **Web**: operator console page at `/console/suspense` (since 2026-09-29
  `/admin/suspense`, `packages/web/app/admin/suspense/SuspenseQueue.tsx`): filters, per-row raw
  payload viewer, retry + mark-reviewed actions wired to the API, falling
  back to clearly-labelled demo data (`DEMO_SUSPENSE_ITEMS` in
  `lib/portal-demo.ts`, rendered with `<DemoBadge/>`) when the API is
  unreachable. Actions are disabled in demo mode.
- **Tests**: `packages/api/test/suspense-ops.test.ts` (12 tests) covers
  list/scoping/filters, retry no-match, retry after the matching click
  arrives (bind + audit + outbox), review note validation + audit,
  cross-tenant isolation, and the NULL-ref 422.

## Integration notes (2026-09-22, phase 4 — CSV merchant connector)

- **Endpoint** `POST /v1/integrations/csv/uploads` (roles `network_admin` /
  `editor`; body `{ provider_account_id, programme_id, filename, csv_text }`
  — the CSV travels as an inline string, no multipart; deliberate sandbox
  choice, 2 MB cap). Brief §8 file-based reporting for direct merchants
  without APIs.
- **One money path, two ingestion shapes**: webhook events and CSV rows both
  run the shared state machine in `packages/api/src/conversion-ingest.ts` —
  same idempotency key, same `provider_revision` ordering (approved never
  downgraded), same suspense rule (unknown `returned_click_ref` → `click_id
  NULL`, never guessed), same ledger posting on approved, same outbox events
  (`conversion.received` / `.status_changed` / `.reversed`).
- **Programme is uploader-supplied** (must exist in the org and be `active`;
  404/422 otherwise) — the webhook's click-chain resolution is not used.
- **All-or-nothing validation**: every row validated before anything is
  ingested; any invalid row → `422 VALIDATION_ERROR` with per-row `errors:
  [{row, reason}]` and zero inserts.
- **CSV format** (header required, names case-insensitive, extra columns
  ignored, blank lines skipped, UTF-8, LF/CRLF):
  `source_transaction_id` (req), `line_id` (opt), `returned_click_ref`
  (opt), `currency` (req, 3-letter, e.g. `INR`), `eligible_value_minor`
  (req, int ≥ 0), `commission_minor` (req, int ≥ 0),
  `provider_status` (req: `approved|pending|declined|reversed`),
  `provider_revision` (opt, int ≥ 0, default 0), `occurred_at` (req, ISO
  8601). Money is integer minor units — decimals (e.g. `12.50`) are rejected
  with a clear reason, never rounded. Sample:
  `packages/api/test/fixtures/sample-settlement.csv`.
- **Tests**: `packages/api/test/csv-connector.test.ts` (8 tests) — duplicate
  full-file upload (exactly one financial effect), malformed rows (422 +
  per-row reasons, zero inserts), out-of-order statuses (approved rev 2 then
  pending rev 1 → still approved, ledger unchanged), unknown click ref →
  suspense (also visible in `GET /v1/suspense` as `CLICK_REF_UNMATCHED`),
  ledger parity with the equivalent webhook event, fixture upload, programme
  guards, empty-file rejection.

## Integration notes (2026-09-22, phase 3 — pilot hardening)

- **Migration** `db/migrations/0003_phase3.sql`: `publishers.onboarding_state`
  (application → identity_review → property_verification →
  programme_eligibility → contract → active); `disputes` gains nullable
  `conversion_id`, `kind`, `publisher_id`, `subject`, `claim_ref`,
  `resolution_note`/`resolved_by`/`resolved_at` for missing-commission
  tickets; contract effective-dating is enforced by the API (no new columns).
- **Kill switch**: `POST /v1/programmes/:id/pause|resume` (network_admin).
  Pause sets status `paused` (blocks `POST /v1/links` immediately),
  deletes `route:{token}` keys for the programme's active links (Redis;
  DB fallback keeps behaviour correct without it), emits a `programme.paused`
  outbox event (picked up by the workers' outbox relay onto the `events`
  stream) and an `audit_log` row. Existing links serve the paused page;
  resume invalidates the cache again so a payload cached while paused cannot
  linger. Covered by tests incl. a fake-Redis invalidation assertion.
- **Link guards** (all in `POST /v1/links`): unapproved property → 403
  `PROPERTY_FORBIDDEN`; publisher onboarding not `active` → 403
  `PUBLISHER_NOT_ACTIVE` (new shared error code); stale/expired offer → 422
  `OFFER_STALE`; offer destination host not in the programme's
  `allowed_domains` → 403 `PROGRAMME_NOT_APPROVED` (no commissionable link
  is minted for unsupported merchant URLs). `GET /v1/offers` still only
  serves live offers — no fabricated prices.
- **Publisher onboarding**: `POST /v1/publishers` opens an application;
  `POST /v1/publishers/:id/onboarding/advance` (network_admin) walks the
  state machine one step at a time (409 on skips). Pending accounts can
  draft but not mint monetised links.
- **Disputes**: `POST /v1/disputes` (missing-commission tickets may name no
  conversion), `GET /v1/disputes[/:id]`, `POST /v1/disputes/:id/resolve`
  (network_admin/editor). Resolving requires `provider_verified: true` plus
  a resolution note — screenshots alone can never create a payable sale
  (422 otherwise). Resolution never posts ledger entries; the provider must
  re-report through the webhook path. Portal UI: `/portal/disputes` (since 2026-09-29 `/app/payouts/disputes`).
- **Contract versioning**: `POST /v1/contracts` (version = max+1,
  effective_from not earlier than the previous version's), `POST
  /v1/contracts/:id/approve` (network_admin), `GET /v1/contracts`. Ledger
  posting uses the latest approved contract whose `effective_from` has
  arrived; posted conversions keep their `contract_version_id` snapshot
  forever (tested: v1 11200 stays 11200 after v2 9600 takes effect).
- **Consent**: the API and redirect set no cookies and read none — denying
  consent changes nothing observable on the click path (asserted in tests);
  DPDP consent UX remains a counsel-gated pilot item.
- **Load**: `scripts/load/redirect-soak.js` (node stdlib only) + `pnpm
  load:smoke` / `pnpm load:soak`. Cannot run meaningfully against pg-mem;
  the pre-pilot gate (500 rps/15 min, p95 < 150 ms, 99.9% availability,
  p75 LCP ≤ 2.5 s) is recorded in `docs/pilot-checklist.md` as human-run.
- **Runbooks**: `docs/runbooks/` (tracking outage, wrong-product/rights,
  merchant nonpayment, publisher fraud, data incident) + pre-pilot gates in
  `docs/pilot-checklist.md`, with human-gated items honestly marked.
- **Deferred with notes**: app-handoff/device tests (manual).

## Integration notes (2026-09-22, phase 2 — money loop)

Four workstreams built in parallel against written contracts, then reconciled:

- **Money pipeline** (`api`, `redirect`, `workers`): `db/migrations/0002_money_loop.sql`
  adds `conversions.contract_version_id`, `merchant_settlements` (collected-cash
  pools), `payout_transfers` (fake-rail transfers), and the `payout_clearing`
  ledger account. Conversion state machine with `provider_revision` ordering
  (higher revision may advance received→pending→approved; never downgrades;
  approved→declined at higher revision becomes a reversal adjustment, never a
  status flip). Reversals via `POST /v1/integrations/{connector}/events` with
  `kind: 'reversal'`. Payout flow: prepare (return-window exclusion, collected
  pro-rata cap, threshold) → approve (maker-checker) → disburse → fake-rail
  callback → `paid`, posting Dr `publisher_liability` / Cr `payout_clearing`.
  Test seams: `__setPool()` in `packages/api/src/db.ts` (also covers
  idempotency), `buildRedirectApp()` in `packages/redirect/src/index.ts`,
  `buildApp()` in `packages/api/src/index.ts` (no listen on import).
- **pg-mem fidelity notes**: several pg-mem 3.x limitations are worked around
  in app code with real-Postgres-equivalent behavior (bare `ON CONFLICT DO
  NOTHING` at insert-if-absent sites with re-select, `IN (...)` expansion
  instead of `= ANY($array)`, JS-side timestamp normalisation, no LATERAL —
  earnings pending bucket is two queries + JS math). Revisit on real Postgres
  before pilot: restore targeted `ON CONFLICT (cols)` arbiters and confirm
  `unique nulls not distinct` semantics.
- **Seed + demo**: `pnpm seed` seeds a real Postgres (needs `DATABASE_URL`);
  `pnpm demo` runs the full money loop in-process on pg-mem (no Docker
  needed): link → click → webhook → 160→112/48 ledger → duplicate dedupe →
  50% reversal → 56/24 → settlement → prepare → 403 self-approve → approve →
  disburse → paid callback → liability 0. Demo contract threshold is INR 50
  (deliberately low so the INR 56 post-reversal earnings clear it; the
  threshold gate itself is covered by tests).
- **Tests**: `pnpm test` — vitest, 31 tests across ledger math, money-loop API
  (idempotency ×10, revision ordering, suspense, reversals, payout gates,
  maker-checker), and the provider-events worker. All green in this
  environment.
- **Web**: publisher portal (`/portal`, `/portal/links`, `/portal/statements`)
  and editorial console (`/console`, `/console/looks/[id]`) added (since
  2026-09-29 under `/app` and `/admin`; the old URLs redirect); live
  against `GET /v1/publisher/earnings` and `POST /v1/links` when
  `NEXT_PUBLIC_API_BASE` is reachable, labelled demo-data fallback otherwise.

## Integration notes (2026-09-22, foundation build)

Workstreams were built in parallel against a written contract and reconciled
afterwards. Decisions made at integration:

- `LedgerEntryDraft` / `buildConversionEntries` / `buildAdjustmentEntries`
  accept `publisher_id` and `memo` (mirrors `ledger_entries.publisher_id`;
  needed for per-publisher payout accounting).
- The temporary `src/shared-shim.d.ts` files in `packages/api` and
  `packages/redirect` were deleted once the real `@paparazzi/shared` landed.
  Shim-invented error codes were remapped to the contract's 12 codes:
  `INTERNAL_ERROR` → `INTERNAL`, `CONVERSION_PROGRAMME_UNKNOWN` and
  `PAYOUT_BELOW_THRESHOLD` → `VALIDATION_ERROR`, `INVALID_BATCH_STATE` →
  `CONFLICT`.
- `ConversionStatus` (domain/DB enum, includes `received`) and the
  connector-side enum collide by name; the barrel exports the latter as
  `ProviderConversionStatus`. A unified enum is a phase-2 decision.
- No Docker/Postgres/Redis exists in this build environment, so migrations
  were validated with pg-mem (all 31 tables created; `NULLS NOT DISTINCT`
  and the `pgcrypto` extension are real-Postgres-only and were shimmed in
  the harness, not the migration). `docker compose up -d` + `node
  db/migrate.mjs` remain the first thing to run on a dev machine.
- `pnpm` must be on PATH as `/usr/bin/pnpm` in non-interactive shells here;
  the npm-global shim is unreliable in this environment.
