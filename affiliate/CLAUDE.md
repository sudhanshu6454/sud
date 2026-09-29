# CLAUDE.md — Paparazzi Affiliate Commerce Platform

India-first affiliate commerce platform (INR, mobile-first web/PWA, merchant-owned
checkout). This repo is a **sandbox-complete** implementation: the full money loop
works end to end against stubbed integrations. No real merchant credentials, no
production secrets, no real money movement.

In the Marketing Fleet repository it lives under `affiliate/` and is deployed with
the fleet's root `docker-compose.yml` (profile `affiliate`); the fleet is the
platform's first publisher and its five sites are the first properties
(`db/seed-fleet.ts`). The fleet-level rules are in the root `CLAUDE.md`.

## Verified state (2026-09-29)

- `pnpm typecheck` clean on all 5 packages (`packages/*`)
- **558/558 tests green across 28 test files** (`./node_modules/.bin/vitest run`:
  api 87, shared 11, workers 15, web 445)
- Demo: **51/51 assertions** on pg-mem (`tsx scripts/demo-money-loop.ts`) **and
  51/51 on a real PostgreSQL 16.13** (`DEMO_TARGET=postgres`, scratch database
  `paparazzi_demo_<8 hex>` created and dropped, no shims) — link → click →
  conversion → attribution → ledger posting → 50% reversal → payout batch →
  maker-checker → payout, **including payout-failure handling** (unknown outcome →
  blind retry refused 409 → status query → informed retry → paid, no double payout)
- Migrations `0001`–`0005` apply on a fresh Postgres 16 and are recorded in
  `schema_migrations`; a second run is a no-op (`0 migration(s) applied, 5 already
  applied`); `--status` and `--baseline` work
- `db/seed.ts` and `db/seed-fleet.ts --with-demo-programme` run on real Postgres;
  the fleet seed is idempotent (byte-identical JSON on a second run)
- `pnpm install --frozen-lockfile` passes (pnpm 9.12.0 locally, in CI and in the
  images)
- `pnpm --filter @paparazzi/web build` OK (all routes dynamic, standalone output);
  on the build (`next start`) all 36 routes of the web route map answer 200, the
  110 internal links they render resolve (200 or an intended 307), every page
  that shows TEST data carries the "Demo data" badge, no page requests Google
  Fonts, names a real merchant from the design mocks or mentions a cookie
- The five images (`docker/Dockerfile.{api,redirect,workers,web,migrate}`) build
  (`--no-cache`: 264 / 270 / 255 / 269 / 262 MB; the web image is 273 MB after
  the Afflino rebuild) and boot end to end: migrate → seeds → `/healthz` on api,
  redirect and the web proxy → `/` titled "Afflino", `/shop` renders the five
  fleet looks live → `mint-links.mjs` mints → the look page carries the tracked
  link → `GET /r/{token}` → 302 with `subid`, no `set-cookie` → one `clicks` row
  → workers log `click.observed` (`docker/README.md`, smoke test, re-run
  2026-09-29 after the rebuild)
- A CI job `affiliate` (`.github/workflows/ci.yml`) runs typecheck, vitest, both
  demos, the web build and the real-Postgres migrate + seeds; no run has been
  observed from this sandbox

## Commands

All from `affiliate/`. `pnpm` is `/opt/node22/bin/pnpm` in this sandbox; `tsx` is
not at the repo root, so the scripts that need it are given with the api package's
copy.

```bash
./node_modules/.bin/vitest run                                        # tests (558)
pnpm typecheck                                                        # 5 packages
./packages/api/node_modules/.bin/tsx scripts/demo-money-loop.ts       # demo on pg-mem (51 assertions)
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi DEMO_TARGET=postgres ./packages/api/node_modules/.bin/tsx scripts/demo-money-loop.ts   # same demo on real Postgres (scratch DB, dropped)
docker compose up -d postgres redis                                   # real Postgres + Redis (dev machine)
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi node db/migrate.mjs             # apply pending migrations
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi node db/migrate.mjs --status    # applied / pending
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi node db/migrate.mjs --baseline  # once, for a DB migrated before tracking existed
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi ./packages/api/node_modules/.bin/tsx db/seed.ts                                  # demo graph
DATABASE_URL=postgresql://paparazzi:changeme@127.0.0.1:5432/paparazzi ./packages/api/node_modules/.bin/tsx db/seed-fleet.ts --with-demo-programme      # the fleet as publisher + TEST programme
pnpm --filter @paparazzi/web build                                    # Next standalone build
node scripts/load/redirect-soak.js --smoke                            # load smoke (needs a real deployment for meaning)
```

Notes: `pnpm demo`, `pnpm demo:pg`, `pnpm seed`, `pnpm seed:fleet` call the api
package's `tsx` (`./packages/api/node_modules/.bin/tsx`); the root has none.
`pnpm install --frozen-lockfile` **works** (the earlier "known-broken" note is
obsolete; CI runs it). `packageManager` pins pnpm 9.12.0 and the Dockerfiles'
`PNPM_VERSION` default is the same version. Vitest runs against
**pg-mem**; the real-Postgres proofs are `DEMO_TARGET=postgres`, the migrate/seed
runs and the docker smoke test.

## Architecture

- `packages/shared` — ledger math, error-code contract, money types. Single source
  of truth for financial invariants.
- `packages/api` — Fastify v1 API. `src/conversion-ingest.ts` is the **one money
  path**: webhook (`routes/integrations.ts`) and CSV upload
  (`routes/csv-uploads.ts`) are thin adapters over `ingestConversionEvent`.
  `src/finance.ts` (ledger posting), `src/payout-rail.ts` (fake rail + unknown-
  outcome guard), `src/idempotency.ts`. `scripts/mint-dev-token.mjs` (JWT stub)
  and `scripts/mint-links.mjs` ship in the api image.
- **Catalogue endpoints** (`routes/looks.ts`, the consumer shop's read path):
  `GET /v1/looks` (published, paginated; each item carries `source_page`,
  `sponsored`, `cover_url`, `item_count`) and `GET /v1/looks/:id?placement_id=`
  (items with product, variant, the **live offer** = `offers.status='active' AND
  fresh_until > now() AND programmes.status='active'`, cheapest wins, and — only
  with a `placement_id` — the existing active `links` row as `{token, url}`).
  `offers.offer_url` is never selected; the consumer only ever gets the tracked
  `/r/{token}` URL or `null`. Visibility is 404-only: another org's look, a
  non-published look for any role but `editor`/`network_admin`, and a
  `placement_id` outside the org are all `404 NOT_FOUND`. `url` is built by
  `src/redirect-url.ts` (`REDIRECT_BASE_URL` + `/r/` + token), shared with
  `POST /v1/links`. Tests: `test/catalogue.test.ts`.
- `packages/redirect` — standalone `GET /r/{token}` click service. Persists click
  records binding `click_id → placement`; sets **no cookies**; Redis route cache
  (600 s on mint, 300 s on rebuild); fail-open (302 without `subid` if the click
  cannot be persisted).
- `packages/workers` — BullMQ workers: click events, provider events, ledger
  mirror, outbox, suspense retry, retention purge (`src/retention/`).
- `packages/web` — Next.js 14.2, the **Afflino** web app built to the design
  handover (tokens `app/globals.css`, self-hosted Archivo, primitives
  `components/ui`, shells `components/shell`; route map with artboard ids and
  live / demo status in `packages/web/README.md`): marketing site `/` (+
  `/login` dev sign-in, `/terms`, `/privacy`, `/contact` stubs), onboarding
  `/join`, creator app `/app/*` (overview, offers, links, reports, payouts +
  disputes + statements, settings), brand workspace `/brand/*`
  (`?workspace=<client id>` for an agency), agency `/agency`, admin
  `/admin/*` (review queue, brands, creators, offers, fraud, settlements,
  suspense, looks), and the fleet's **consumer shop** `/shop`,
  `/looks/[id]`, `/looks/[id]/items/[itemId]`, `/saved` live against the
  catalogue API. Live v1 calls from the app areas: `GET
  /v1/publisher/earnings`, `POST /v1/links`, `GET`/`POST /v1/disputes`,
  `GET /v1/suspense` + retry / review, `POST /v1/publishers`; everything
  else is TEST data (`lib/demo/*`) with `<DemoBadge />`. Old `/portal/*` and
  `/console/*` URLs 307 to their new routes. Marketing figures, prices,
  fees, TDS, the validation window, the minimum withdrawal and the #ad line
  are placeholders in `lib/site-copy.ts`. **Web contract:** `API_BASE` (server runtime; default `http://localhost:3000`),
  `WEB_API_TOKEN` (server-only bearer for a read-only `publisher_analyst`; never
  `NEXT_PUBLIC_`, never sent to the browser, missing → TEST demo data with a
  badge), `WEB_PLACEMENT_ID` (uuid appended as `placement_id` so items carry
  their links), `NEXT_PUBLIC_API_BASE` (browser, build-time; default `/api`),
  `NEXT_PUBLIC_SITE_NAME` (runtime). `/api/[...path]` is a per-request proxy to
  `API_BASE` (not a `rewrites()` entry — those are frozen at build). Every
  catalogue fetch is `revalidate: 60`; pages are `force-dynamic`. The merchant CTA
  is `<a href="{link.url}" rel="sponsored nofollow noopener">` or a visibly
  disabled control; no raw merchant URL exists in the bundle.
- `db/migrations/` — `0001_core.sql` → `0005_looks_web.sql`, append-only;
  `db/migrate.mjs` records files in `schema_migrations` (`--status`,
  `--baseline`); `db/seed.ts` (demo graph), `db/seed-fleet.ts` (the fleet as
  publisher, from `../autopub/config/sites.yaml`; `--with-demo-programme` adds the
  TEST programme and the placements, and refuses `NODE_ENV=production`).
- `docker/` — five Dockerfiles that build and boot (`docker/README.md`,
  `docker/ASSUMPTIONS.md`); `docker-compose.prod.yml` for managed infra; the fleet
  host uses the root `docker-compose.yml` profile `affiliate` instead.
- `docs/openapi.yaml` — OpenAPI 3.1 spec; `packages/api/test/openapi.test.ts`
  asserts the spec matches the registered routes in both directions. Keep in sync.

## Invariants — do not break these

1. **Money is integer minor units with explicit currency.** Never floats, never
   implicit currency, never rounding on ingest (CSV decimals are rejected).
2. **Ledger is double-entry, balanced, append-only.** Every posting debits =
   credits per currency; corrections are mirror adjustment entries, never
   updates/deletes. `packages/shared` owns this math.
3. **Every query is tenant-scoped.** Cross-tenant reads/mutations are tested as
   blocked (`phase3.test.ts`) — keep it that way.
4. **Idempotency on `(provider_account_id, source_transaction_id, line_id)`.**
   10 identical callbacks → 1 conversion, 1 financial effect (tested).
5. **Provider revision ordering.** A delayed `pending` must never overwrite
   `approved` (tested).
6. **Never guess attribution.** Unmapped `returned_click_ref` → suspense queue.
   Suspense retry only binds when the click actually exists; `NULL` refs are
   rejected, no fuzzy matching — enforced in code (`routes/suspense.ts`).
7. **Maker-checker on payouts.** Approver cannot be preparer, cannot approve own
   batch (403, tested). Payout eligibility: approved + collected + return-hold
   cleared + payee checks.
8. **Unknown payout outcome → status query before retry.** Blind re-disburse
   returns 409 `TRANSFER_STATUS_UNKNOWN`; informed retry re-initiates the *same*
   transfer row (tested — no double payout).
9. **Unsupported merchants stay untracked.** Link guards return
   `PROGRAMME_NOT_APPROVED` / `OFFER_STALE` / `PROPERTY_FORBIDDEN` /
   `PUBLISHER_NOT_ACTIVE`; minting is blocked at the redirect join too.
10. **Dispute resolution never posts ledger entries.** A ticket can never create a
    payable sale (enforced in code).
11. **Demo/seed data is always TEST-labeled** (`Demo-` / `demo.` / `txn-demo-*` /
    `example.com`); the demo refuses to run with `NODE_ENV=production`.

## Key acceptance numbers (don't regress)

- INR 160 commission at 70/30 → publisher 11200 / platform 4800 (minor units)
- 50% reversal → publisher 5600 / platform 2400 remaining

## Docs index (read before changing behavior)

- `docs/pilot-checklist.md` — completed / outstanding-engineering /
  external-dependencies, each completed item linked to its proof
- `docs/action-tracker.md` — table of every external requirement
  (input needed, owner, dependency, acceptance criteria) plus the
  sandbox-verified items that are not gates
- `docs/capacity-plan.md` — the owner's 12-billion-views figure turned into
  hot-path arithmetic (clicks/s, `clicks` growth, cache, replicas, the web),
  what the fleet's Linode can host, and what is still unmeasured
- `docs/threat-model.md` — trust boundaries, mitigations cited to code/tests,
  10 residual risks, pentest scope input
- `docs/pentest-scope.md`, `docs/runbooks/` (deploy incl. the fleet-compose
  path, backup-restore, alerts, incidents), `docs/monitoring/alerts.yaml`
- `docs/infrastructure-recommendation.md` — AWS ap-south-1 ≈₹6,700/mo (or DO
  blr1 ≈₹5,200/mo) estimates; `docker-compose.prod.yml`, `docs/credential-setup.md`
- `docker/README.md` — the five images, how they are built, the smoke test
- `docs/vendor-rfp.md`, `docs/merchant-outreach.md`, `docs/counsel-briefing.md`
  — sendable docx versions in `~/workspace/your_files/paparazzi-gate-docs/`
- Per-package `ASSUMPTIONS.md` files (and `db/README.md`, `scripts/ASSUMPTIONS.md`,
  `docker/ASSUMPTIONS.md`) record deliberate simplifications, dated

## Known caveats

- Vitest still runs on pg-mem, which diverges from real Postgres in places
  (`unique nulls not distinct`, targeted `ON CONFLICT` arbiters are shimmed). The
  migrations and the money loop are proven on Postgres 16 by `DEMO_TARGET=postgres`;
  the app code still carries the pg-mem-friendly query shapes (bare `ON CONFLICT
  DO NOTHING`, `IN (...)` expansion, no `LATERAL`).
- Auth is a **JWT stub** (`scripts/mint-dev-token.mjs`, claims trusted verbatim;
  default TTL 8 h, `exp` enforced); production needs a real IdP + membership
  validation. The shop's `WEB_API_TOKEN` is that stub too.
- No webhook signature verification on API ingress; no rate limiting (also not
  on `/r/{token}`); no CSP; `localStorage` bearer token in the web app's
  areas (`/login` writes it) — all flagged in the threat model as pre-launch
  work.
- The Afflino screens without a v1 endpoint are demo flows and say so: no
  OTP / identity provider, no KYC or PAN check, no platform OAuth, no brand
  self-serve offers or admin approval, no creator link listing or report
  aggregates, no publisher withdrawal, no agency roster
  (`docs/pilot-checklist.md`). The design's readable `/r/{handle}/{offer}`
  links and first-party attribution cookie are **not** implemented.
- No merchant programme exists. The only programme anywhere is the TEST "Demo
  Fleet Programme" from `db/seed-fleet.ts --with-demo-programme`
  (`shop.example.com`); the payout rail is the stub. Real ones are human-gated
  (`docs/action-tracker.md`).
- CSV upload takes inline `csv_text` (2 MB cap) — production needs
  multipart/object-storage ingestion.
- Retention defaults are 365-day placeholders; counsel sets real windows.
- "No cookies, hashed IPs" is an **implementation detail for counsel to assess**,
  not proof of DPDP/ASCI compliance — never present it as such.
- `pnpm audit` couldn't reach the npm endpoint from the sandbox; OSV showed zero
  known vulns on 171 pinned packages — re-run `pnpm audit` on CI.
- The load soak has never run on real infrastructure (`docs/capacity-plan.md`).

## Working rules

- Extend in place; keep per-package `ASSUMPTIONS.md` and the root README current.
- New behavior needs tests; new routes need OpenAPI spec updates (the
  bidirectional test enforces this: `EXPECTED_ROUTES` in
  `packages/api/test/openapi.test.ts` and `docs/openapi.yaml`).
- Never invent merchant names, credentials, approvals, or legal conclusions.
  Mark open questions as such; counsel/merchant/infra decisions belong to humans
  (see `docs/action-tracker.md`).
- Never write an AI model name or identifier into any file here.
- Nothing here is production-ready until the external gates in
  `docs/pilot-checklist.md` are closed.
