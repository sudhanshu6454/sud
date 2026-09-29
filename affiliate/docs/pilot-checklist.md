# Pre-pilot checklist

What is built and proven in this sandbox vs what still needs engineering or a
human before the pilot. Last verified test run (2026-09-29): **130/130 green
across 11 files** (`./node_modules/.bin/vitest run`; the earlier figures of 57
and 94 are stale). Legend: ✅ verified in this repo · ⏳ not done — needs
engineering work · 👤 needs a human (see
[EXTERNAL DEPENDENCIES](#external-dependencies) and the
[action tracker](./action-tracker.md)).

**This checklist is not a production-readiness statement.** Everything under
COMPLETED & VERIFIED was exercised in this sandbox: the unit tests against
pg-mem and stub connectors, the migrations, seeds, money-loop demo and the
five Docker images against a local PostgreSQL 16.13 and Redis 7. None of it
has seen real merchants, real money, real traffic or a real host.

## COMPLETED & VERIFIED

- ✅ `pnpm typecheck` clean across all 5 packages.
- ✅ `pnpm install --frozen-lockfile` passes (pnpm 9.12.0; the images also
  build with pnpm 10.34.6 — [`docker/README.md`](../docker/README.md)
  "pnpm version policy"). The old "known-broken" note is obsolete.
- ✅ `vitest run` green — 130 tests in 11 files: ledger math
  ([`packages/shared/src/ledger.test.ts`](../packages/shared/src/ledger.test.ts)),
  money-loop API incl. idempotency ×10, revision ordering, suspense,
  reversals, payout gates, maker-checker
  ([`packages/api/test/money-loop.test.ts`](../packages/api/test/money-loop.test.ts),
  [`packages/api/test/suspense-ops.test.ts`](../packages/api/test/suspense-ops.test.ts)),
  CSV connector
  ([`packages/api/test/csv-connector.test.ts`](../packages/api/test/csv-connector.test.ts)),
  provider-events worker
  ([`packages/workers/test/provider-events.test.ts`](../packages/workers/test/provider-events.test.ts)),
  retention purge
  ([`packages/workers/test/retention.test.ts`](../packages/workers/test/retention.test.ts)),
  phase-3 acceptance: tenant isolation, link guards, kill switch, onboarding,
  disputes, contract versioning
  ([`packages/api/test/phase3.test.ts`](../packages/api/test/phase3.test.ts)),
  **catalogue endpoints** — list fields, pagination, cheapest live offer,
  stale/paused → null, link read-back, 404-only visibility, no `offer_url`
  in any body
  ([`packages/api/test/catalogue.test.ts`](../packages/api/test/catalogue.test.ts)),
  the **consumer web's** catalogue client and fallback rules and
  `mint-links.mjs` end to end against a stub API
  ([`packages/web/test/catalogue.test.ts`](../packages/web/test/catalogue.test.ts),
  [`packages/web/test/mint-links.test.ts`](../packages/web/test/mint-links.test.ts)),
  OpenAPI contract
  ([`packages/api/test/openapi.test.ts`](../packages/api/test/openapi.test.ts)
  against [`docs/openapi.yaml`](./openapi.yaml)).
- ✅ Money-loop demo green on **both targets** —
  [`scripts/demo-money-loop.ts`](../scripts/demo-money-loop.ts), 51 assertions:
  link → click → conversion (INR 160 commission) → ledger 112/48 → webhook
  dedupe → 50% reversal → 56/24 → merchant settlement → payout batch
  (maker-checker enforced, self-approve 403) → disburse → provider callback →
  liability cleared, plus payout-failure handling (unknown outcome → 409 on
  blind retry → status query → informed retry → paid, one transfer row).
  `pnpm demo` runs it on pg-mem; `DEMO_TARGET=postgres` (`pnpm demo:pg`)
  runs the identical assertions on a **real PostgreSQL 16.13** with the
  migrations applied verbatim (no shims), on a scratch database
  `paparazzi_demo_<8 hex>` that is dropped at exit (verified: 0 left in
  `pg_database`). All demo data is TEST-labelled; both targets refuse
  `NODE_ENV=production`.
- ✅ Migrations `0001`–`0005` on real Postgres 16 with tracking —
  [`db/migrate.mjs`](../db/migrate.mjs) records each file in
  `schema_migrations` inside the file's own transaction; a fresh database
  applies 5, a second run reports `0 migration(s) applied, 5 already
  applied`; `--status` lists applied/pending; `--baseline` records the
  present files for a database migrated before tracking existed (a plain
  run on such a database fails loudly on `0001` with a hint, by design).
  Details: [`db/README.md`](../db/README.md) "Migration tracking".
- ✅ Seeds on real Postgres — [`db/seed.ts`](../db/seed.ts) (demo graph, now
  filling the `0005` look columns) and
  [`db/seed-fleet.ts`](../db/seed-fleet.ts) (the Marketing Fleet as the
  first publisher: organisation, four role users, five `web` properties from
  `autopub/config/sites.yaml`, and with `--with-demo-programme` the TEST
  programme, one published look per site and the placements incl.
  `web_placement_id`). The fleet seed is idempotent: two runs on a fresh
  database give identical row counts and byte-identical JSON.
- ✅ Docker images build and boot —
  [`docker/Dockerfile.{api,redirect,workers,web,migrate}`](../docker/):
  `--no-cache` builds of 264 / 270 / 255 / 269 / 262 MB, all running as the
  unprivileged `node` user under `cap_drop: [ALL]`. The recorded smoke test
  ([`docker/README.md`](../docker/README.md)) boots Postgres 16 + Redis 7 +
  all five images: migrate applies 0001–0005, both seeds run, `/healthz` on
  api, redirect and the web's `/api` proxy answer `{"ok":true}`, the shop
  renders the five fleet looks live (no demo badge), `mint-links.mjs` mints
  one link (`minted=1 … failed=0`), the look page shows
  `<a href="…/r/<token>" rel="sponsored nofollow noopener">View at
  merchant</a>`, `GET /r/<token>` answers `302` to the TEST destination with
  `subid=<click_id>` and no `set-cookie`, one row lands in `clicks`, and the
  workers log `click.observed`. Sandbox caveat: the builds needed a base
  image carrying the sandbox's egress CA; the Dockerfiles carry no such
  setting.
- ✅ Consumer shop live — [`packages/web`](../packages/web/README.md): `/`,
  `/looks/[id]`, `/looks/[id]/items/[itemId]` read the catalogue API
  server-side with a server-only token; every merchant CTA is the tracked
  `/r/{token}` link or a visibly disabled control; no raw merchant URL is
  returned by the API or rendered (asserted in
  `packages/api/test/catalogue.test.ts` and the web tests).
- ✅ Fleet wiring — the root `docker-compose.yml` (generated by
  `infra/gen_compose.py`) carries the seven `affiliate_*` services behind
  the `affiliate` profile with `AFFILIATE_*` env, `make affiliate-up |
  affiliate-migrate | affiliate-seed | affiliate-logs | affiliate-down |
  affiliate-test`, and a CI job `affiliate` (`.github/workflows/ci.yml`:
  frozen install, typecheck, vitest, both demos, web build, migrate + seeds
  on a Postgres 16 service). `docker compose --profile affiliate config -q`
  validates; **no CI run has been observed from this sandbox**.
- ✅ Kill switch exercised: pause → paused page + `route:{token}` cache
  invalidation + blocked minting → resume → 302 (see
  [`packages/api/test/phase3.test.ts`](../packages/api/test/phase3.test.ts)).
- ✅ **CSV import path built and tested** — connector
  ([`packages/api/test/csv-connector.test.ts`](../packages/api/test/csv-connector.test.ts)),
  fixture
  ([`packages/api/test/fixtures/sample-settlement.csv`](../packages/api/test/fixtures/sample-settlement.csv)),
  upload route
  ([`packages/api/src/routes/csv-uploads.ts`](../packages/api/src/routes/csv-uploads.ts)).
  Caveat: upload is an inline string (`csv_text`, 2 MB cap) — a deliberate
  sandbox simplification; production wants multipart or object-storage
  references (see [OUTSTANDING ENGINEERING](#outstanding-engineering)).
- ✅ Backup/restore scripts written with their assumptions recorded:
  [`scripts/backup.sh`](../scripts/backup.sh),
  [`scripts/restore.sh`](../scripts/restore.sh),
  [`scripts/ASSUMPTIONS.md`](../scripts/ASSUMPTIONS.md) (production guard,
  pg_dump flags, manifest-as-evidence, WAL archiving and encryption marked
  **open**), plus the runbook
  [`docs/runbooks/backup-restore.md`](./runbooks/backup-restore.md).
  The full drill against real Postgres is still outstanding (below).
- ✅ Threat model written:
  [`docs/threat-model.md`](./threat-model.md) — trust boundaries,
  per-component STRIDE with mitigations tied to code/tests, residual risks
  that must be fixed before any shared environment, and a proposed pentest
  scope.
- ✅ Runbooks written and reviewed:
  [`docs/runbooks/`](./runbooks/) — deploy (managed infra and the
  fleet-compose path), tracking outage, wrong-product/rights, merchant
  nonpayment, publisher fraud, data incident.
- ✅ Capacity plan written from the owner's figure:
  [`docs/capacity-plan.md`](./capacity-plan.md) — arithmetic only; nothing
  in it is measured.
- ✅ Data minimisation posture is an **implementation detail for counsel to
  assess, not evidence of compliance**: the API/redirect currently set no
  cookies and the click path hashes IPs; retention is window-agnostic and
  mechanically implemented
  ([`packages/workers/src/retention/`](../packages/workers/src/retention/))
  with 365-day sandbox defaults in
  [`packages/workers/src/retention/config.ts`](../packages/workers/src/retention/config.ts).
  Counsel sets the real windows and confirms whether this posture is
  sufficient — see [`docs/counsel-briefing.md`](./counsel-briefing.md) §1
  [DECISION] markers and the [action tracker](./action-tracker.md).

## OUTSTANDING ENGINEERING

Code-side work still buildable in this repo; none of it has been run against
real infrastructure or real traffic yet:

- ⏳ Full backup/restore drill against **real Postgres**: restore a backup
  to a scratch host, run `node db/migrate.mjs --status` (must show 0001–0005
  applied, 0 pending), run `scripts/restore.sh`'s row-count and
  ledger-balance checks, record RPO/RTO. (`DEMO_TARGET=postgres` cannot be
  pointed at a restored database — it refuses one with migrations recorded
  because it asserts absolute row counts.) Open sub-items from
  [`scripts/ASSUMPTIONS.md`](../scripts/ASSUMPTIONS.md): WAL archiving /
  point-in-time recovery, encryption at rest + offsite copies, retention
  windows (needs counsel + finance sign-off).
- ⏳ **No real load soak has run.**
  [`scripts/load/redirect-soak.js`](../scripts/load/redirect-soak.js)
  exists and only ever ran against stubs; pg-mem numbers say nothing about
  the real hot path, and the docker smoke test above sent one click. Gates:
  `pnpm load:smoke` (50 rps, 30 s) PASS; `pnpm load:soak` (500 rps, 15 min)
  PASS with p95 < 150 ms service processing on `GET /r/{token}` and error
  rate < 0.1%; brief targets also include 99.9% redirect availability and
  p75 LCP ≤ 2.5 s on the PWA. The fleet host (`make affiliate-up`) is a
  valid target for the first run; the estimate it must cover is in
  [`docs/capacity-plan.md`](./capacity-plan.md) (≈ 23–230 rps peak).
- ⏳ Vitest still runs on pg-mem. The migrations and the money loop are now
  proven on Postgres 16 (`pnpm demo:pg`, the seeds, the docker smoke), but
  the app code keeps its pg-mem-friendly query shapes (bare `ON CONFLICT DO
  NOTHING` + re-select, `IN (...)` expansion instead of `= ANY($array)`, no
  `LATERAL`, two-query pending bucket). Restoring targeted `ON CONFLICT
  (cols)` arbiters and running the suite itself on real Postgres are still
  open (README "pg-mem fidelity notes", `docs/threat-model.md` §4.5).
- ⏳ `clicks` partitioning by month (`docs/capacity-plan.md` §3): the table
  grows with every click and the retention purge nulls payloads but never
  removes rows. A `db/` migration decision.
- ⏳ Replace the JWT auth stub (`packages/api/src/middleware.ts`,
  `packages/api/scripts/mint-dev-token.mjs`) with a production IdP:
  self-minted tokens with unchecked `sub`/`org_id`/`role` are dev-grade —
  and the consumer shop's `WEB_API_TOKEN` is one of them today. (IdP
  *choice* is a human decision — [action tracker](./action-tracker.md); the
  wiring is engineering.)
- ⏳ **No signature verification** on the API webhook ingress
  (`POST /v1/integrations/:connector/events` currently trusts a platform
  JWT, which real merchants cannot hold). The HMAC-SHA256 pattern exists in
  the workers-side stub (`packages/workers/src/connectors/stub-network.ts`)
  — copy the pattern, don't ship the stub wiring.
- ⏳ Secrets-manager wiring: `JWT_SECRET`/`STUB_WEBHOOK_SECRET` and the
  Postgres password are dev placeholders (`.env.example`,
  `docker-compose.yml`) or, on the fleet host, plain values in the root
  `.env` (mode 600); nothing is wired to a vault yet.
- ⏳ Production CSV ingestion: move from inline `csv_text` (2 MB cap,
  whole file in API memory) to multipart or object-storage references.
- ⏳ **No rate limiting** on `/r/:token`, webhook, and CSV endpoints
  (`docs/threat-model.md` §4.8); CSP headers + token-storage hardening for
  the web app (§4.7). Bots hitting `/r/` today each write a `clicks` row.
- ⏳ Real-rail payout callbacks: signed callbacks + unknown-state requery
  discipline (already modelled in `payout-rail.ts`) once the fake
  `stub-network` rail is replaced.
- ⏳ Alert publishers: the metrics named in
  [`docs/monitoring/alerts.yaml`](./monitoring/alerts.yaml)
  (`click_observed_events_total`, conversion lag, settlement gap, ledger
  sweep) have no code emitting them yet; the `click-events` worker only
  logs. The pilot floor in `click-volume-drop` needs re-tuning against the
  capacity plan's estimate.
- ⏳ A `Cache-Control` policy for the shop so a CDN can front it (Next's
  dynamic default is no-store); LCP has never been measured.

## EXTERNAL DEPENDENCIES

Items only a human can clear. Every row also appears in the
[action tracker](./action-tracker.md) with exact input, owner, dependency,
and acceptance criteria.

- 👤 Merchant programme approvals: signed insertion terms per pilot merchant
  (commission basis, attribution window, validation delay, payment terms,
  allowed domains). **No merchant programme exists today**; the only
  programme in any database is the TEST "Demo Fleet Programme" that
  `db/seed-fleet.ts --with-demo-programme` creates (`shop.example.com`).
  *A machine cannot sign commercial terms with a merchant.*
- 👤 Channel exports: fresh 28/90-day audience + content-vertical exports
  from pilot publishers, on file before contracting. For the in-house
  publisher this is the fleet's own analytics; the "12 billion views"
  figure in the capacity plan is the owner's statement, not an export.
  *Only the publishers can provide their own data.*
- 👤 Counsel sign-off on every [DECISION] marker in
  [`docs/counsel-briefing.md`](./counsel-briefing.md): DPDP commencement map
  and build-now obligations, 90-day retention defensibility, data-principal
  rights workflows, minors policy, ASCI disclosure wording per format and
  sign-off process, celebrity image-rights assessment process and takedown
  timelines, publisher + merchant contract templates, principal-vs-agent
  determination, GST/tax mappings, publisher-funds holding characterisation,
  hosting jurisdiction, breach-notification mapping. *Only counsel can give
  legal answers; the "no cookies / hashed IPs" line above is an
  implementation detail for counsel to assess, not compliance evidence.*
- 👤 Media-rights assessment: pilot looks' asset licenses, territory, expiry
  dates recorded in `assets`; re-review queue empty; takedown workflow
  timelines from counsel. *Only a rights-holder review can clear celebrity
  imagery; owning footage ≠ advertising rights.*
- 👤 Infra provisioning: cloud/region choice, managed Postgres + Redis with
  HA/persistence decided, backups + WAL archiving, monitoring. The fleet's
  4 GB Linode can run the `affiliate` profile as a **pilot host** only
  ([`docs/capacity-plan.md`](./capacity-plan.md) §6); production is
  [`docs/infrastructure-recommendation.md`](./infrastructure-recommendation.md).
  *Sandbox has no real infrastructure to provision.*
- 👤 Load soak executed on a real deployment and results recorded. *The
  soak must run against real Postgres + Redis with real DNS and TLS in
  front, which only a human can stand up and approve for traffic.*
- 👤 Backup-restore drill evidence recorded on real Postgres, RPO/RTO
  declared. *Only a real cluster can produce real recovery numbers.*
- 👤 External pentest of the API + redirect surface, scoped per
  [`docs/threat-model.md` §5](./threat-model.md), scheduled or waived in
  writing. *Independent security testing cannot be done by the builders.*
- 👤 Payout rail: pilot payout account credentials in the vault; the fake
  `stub-network` rail replaced or explicitly approved for the pilot's money
  path; maker-checker roles assigned to real humans (`finance_operator` ≠
  `finance_approver`). The fleet seed's four role users are
  `<role>@marketing-fleet.invalid` placeholders until `FLEET_*_EMAIL`
  supplies real addresses. *Only humans hold credentials and job titles.*
- 👤 Alerts wired: click-volume drop, redirect 5xx/p95, webhook backlog,
  settlement gap, books-balanced sweep on a schedule. *Only the operator of
  the real deployment can wire and validate alerting.*
- 👤 Kill-switch drill with the on-call rotation: pause + resume a canary
  programme, worst-case staleness under Redis best-effort documented.
  *Only the on-call rotation can rehearse an incident.*
- 👤 App-handoff / device matrix: in-app browsers, deferred deep links run
  before pilot traffic. *Only humans have the physical devices.*
