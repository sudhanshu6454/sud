# CLAUDE.md — Paparazzi Affiliate Commerce Platform

India-first affiliate commerce platform (INR, mobile-first web/PWA, merchant-owned
checkout). This repo is a **sandbox-complete** implementation: the full money loop
works end to end against stubbed integrations. No real merchant credentials, no
production secrets, no real money movement.

## Verified state (2026-09-29)

- `tsc --noEmit` clean on all 5 packages (`packages/*`)
- 96/96 tests green across 8 test files (`vitest run`)
- Demo: 51/51 assertions pass (`scripts/demo-money-loop.ts`) — link → click →
  conversion → attribution → ledger posting → 50% reversal → payout batch →
  maker-checker → payout, **including payout-failure handling** (unknown outcome →
  blind retry refused 409 → status query → informed retry → paid, no double payout)

## Commands

```bash
./node_modules/.bin/vitest run          # tests (96)
./node_modules/.bin/tsx scripts/demo-money-loop.ts   # end-to-end demo (51 assertions)
docker compose up -d postgres redis     # real Postgres + Redis (dev machine)
node db/migrate.mjs                     # run migrations in db/migrations/
./node_modules/.bin/tsx db/seed.ts      # seed demo data
node scripts/load/redirect-soak.js --smoke   # load smoke (needs real deployment for meaning)
```

Notes: `pnpm` may not be on PATH in every shell — the `./node_modules/.bin/`
invocations above are the reliable fallback. Each package typechecks with its own
`./node_modules/.bin/tsc -p tsconfig.json --noEmit`. `pnpm install
--frozen-lockfile` is known-broken in this repo (root lockfile importer predates
the fix); `pnpm test`/`typecheck` work where pnpm exists. Tests run against
**pg-mem**, not real Postgres — see caveats.

## Architecture

- `packages/shared` — ledger math, error-code contract, money types. Single source
  of truth for financial invariants.
- `packages/api` — Fastify v1 API. `src/conversion-ingest.ts` is the **one money
  path**: webhook (`routes/integrations.ts`) and CSV upload
  (`routes/csv-uploads.ts`) are thin adapters over `ingestConversionEvent`.
  `src/finance.ts` (ledger posting), `src/payout-rail.ts` (fake rail + unknown-
  outcome guard), `src/idempotency.ts`.
- `packages/redirect` — standalone `GET /r/{token}` click service. Persists click
  records binding `click_id → placement`; sets **no cookies**.
- `packages/workers` — BullMQ workers: provider events, ledger mirror, outbox,
  suspense retry, retention purge (`src/retention/`).
- `packages/web` — Next.js 14: publisher portal (dashboard, link builder,
  statements, disputes) + editorial console (looks pipeline, suspense ops view).
- `db/migrations/` — `0001_core.sql` → `0004_suspense_ops.sql`, append-only.
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
- `docs/action-tracker.md` — 36-row table of every external requirement
  (input needed, owner, dependency, acceptance criteria)
- `docs/threat-model.md` — trust boundaries, mitigations cited to code/tests,
  10 residual risks, pentest scope input
- `docs/pentest-scope.md`, `docs/runbooks/` (deploy, backup-restore, alerts,
  incidents), `docs/monitoring/alerts.yaml`
- `docs/infrastructure-recommendation.md` — AWS ap-south-1 ≈₹6,700/mo (or DO
  blr1 ≈₹5,200/mo) estimates; `docker-compose.prod.yml`, `docs/credential-setup.md`
- `docs/vendor-rfp.md`, `docs/merchant-outreach.md`, `docs/counsel-briefing.md`
  — sendable docx versions in `~/workspace/your_files/paparazzi-gate-docs/`
- Per-package `ASSUMPTIONS.md` files record deliberate simplifications

## Known caveats

- pg-mem diverges from real Postgres in places (`unique nulls not distinct`,
  targeted `ON CONFLICT` arbiters are shimmed) — revisit on real Postgres.
- Auth is a **JWT stub**; production needs a real IdP + membership validation.
- No webhook signature verification on API ingress; no rate limiting; no CSP;
  `localStorage` bearer token — all flagged in the threat model as pre-launch work.
- CSV upload takes inline `csv_text` (2 MB cap) — production needs
  multipart/object-storage ingestion.
- Retention defaults are 365-day placeholders; counsel sets real windows.
- "No cookies, hashed IPs" is an **implementation detail for counsel to assess**,
  not proof of DPDP/ASCI compliance — never present it as such.
- `pnpm audit` couldn't reach the npm endpoint from the sandbox; OSV showed zero
  known vulns on 171 pinned packages — re-run `pnpm audit` on CI.

## Working rules

- Extend in place; keep per-package `ASSUMPTIONS.md` and the root README current.
- New behavior needs tests; new routes need OpenAPI spec updates (the
  bidirectional test enforces this).
- Never invent merchant names, credentials, approvals, or legal conclusions.
  Mark open questions as such; counsel/merchant/infra decisions belong to humans
  (see `docs/action-tracker.md`).
- Nothing here is production-ready until the external gates in
  `docs/pilot-checklist.md` are closed.
