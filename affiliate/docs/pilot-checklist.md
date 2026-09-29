# Pre-pilot checklist

What is built and proven in this sandbox vs what still needs engineering or a
human before the pilot. Last verified test run: **94/94 green** (the old
checklist said 57 — stale). Legend: ✅ verified in this repo · ⏳ not done —
needs engineering work · 👤 needs a human (see
[EXTERNAL DEPENDENCIES](#external-dependencies) and the
[action tracker](./action-tracker.md)).

**This checklist is not a production-readiness statement.** Everything under
COMPLETED & VERIFIED was exercised against pg-mem and stub connectors in this
sandbox, not against real Postgres, real Redis, real merchants, or real
money.

## COMPLETED & VERIFIED

- ✅ `pnpm typecheck` clean across all 5 packages.
- ✅ `pnpm test` green — 94 tests: ledger math
  ([`packages/shared/src/ledger.test.ts`](../packages/shared/src/ledger.test.ts)),
  money-loop API incl. idempotency ×10, revision ordering, suspense,
  reversals, payout gates, maker-checker
  ([`packages/api/test/money-loop.test.ts`](../packages/api/test/money-loop.test.ts),
  [`packages/api/test/suspense-ops.test.ts`](../packages/api/test/suspense-ops.test.ts)),
  provider-events worker
  ([`packages/workers/test/provider-events.test.ts`](../packages/workers/test/provider-events.test.ts)),
  retention purge
  ([`packages/workers/test/retention.test.ts`](../packages/workers/test/retention.test.ts)),
  phase-3 acceptance: tenant isolation, link guards, kill switch, onboarding,
  disputes, contract versioning
  ([`packages/api/test/phase3.test.ts`](../packages/api/test/phase3.test.ts)),
  OpenAPI contract
  ([`packages/api/test/openapi.test.ts`](../packages/api/test/openapi.test.ts)
  against [`docs/openapi.yaml`](./openapi.yaml)).
- ✅ `pnpm demo` green —
  [`scripts/demo-money-loop.ts`](../scripts/demo-money-loop.ts): full money
  loop in-process — link → click → conversion (INR 160 commission) → ledger
  112/48 → webhook dedupe → 50% reversal → 56/24 → merchant settlement →
  payout batch (maker-checker enforced, self-approve 403) → disburse →
  provider callback → liability cleared. Includes payout-failure handling;
  all demo data is TEST-labelled.
- ✅ Kill switch exercised: pause → paused page + `route:{token}` cache
  invalidation + blocked minting → resume → 302 (see
  [`packages/api/test/phase3.test.ts`](../packages/api/test/phase3.test.ts)).
- ✅ **CSV import path built and tested** — supersedes the old "untested"
  line: connector
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
  [`docs/runbooks/`](./runbooks/) — tracking outage, wrong-product/rights,
  merchant nonpayment, publisher fraud, data incident.
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
real infrastructure yet:

- ⏳ Full backup/restore drill against **real Postgres**: restore a backup
  to a scratch host, run migrations, run `pnpm demo` against it, record
  RPO/RTO. Open sub-items from
  [`scripts/ASSUMPTIONS.md`](../scripts/ASSUMPTIONS.md): WAL archiving /
  point-in-time recovery, encryption at rest + offsite copies, retention
  windows (needs counsel + finance sign-off).
- ⏳ Load soak on a **real deployment** (staging, Postgres + Redis):
  [`scripts/load/redirect-soak.js`](../scripts/load/redirect-soak.js) exists
  but only runs against stubs here — pg-mem numbers say nothing about the
  real hot path. Gates: `pnpm load:smoke` (50 rps, 30 s) PASS;
  `pnpm load:soak` (500 rps, 15 min) PASS with p95 < 150 ms service
  processing on `GET /r/{token}` and error rate < 0.1%; brief targets also
  include 99.9% redirect availability and p75 LCP ≤ 2.5 s on the PWA.
- ⏳ Restore pg-mem-shimmed semantics on real Postgres: `unique nulls not
  distinct`, targeted `ON CONFLICT (cols)` arbiters, `gen_random_uuid`,
  pgcrypto — the migration harness shims these (see README "pg-mem fidelity
  notes" and `docs/threat-model.md` §4.5), so the current green run proves
  logic, not Postgres semantics.
- ⏳ Replace the JWT auth stub (`packages/api/src/middleware.ts`) with a
  production IdP: self-minted tokens with unchecked `sub`/`org_id`/`role`
  are dev-grade. (IdP *choice* is a human decision —
  [action tracker](./action-tracker.md); the wiring is engineering.)
- ⏳ Per-connector signature verification on the API webhook ingress
  (`POST /v1/integrations/:connector/events` currently trusts a platform
  JWT, which real merchants cannot hold). The HMAC-SHA256 pattern exists in
  the workers-side stub (`packages/workers/src/connectors/stub-network.ts`)
  — copy the pattern, don't ship the stub wiring.
- ⏳ Secrets-manager wiring: `JWT_SECRET`/`STUB_WEBHOOK_SECRET` and the
  Postgres password are dev placeholders (`.env.example`,
  `docker-compose.yml`); nothing is wired to a vault yet.
- ⏳ Production CSV ingestion: move from inline `csv_text` (2 MB cap,
  whole file in API memory) to multipart or object-storage references.
- ⏳ Rate limiting on `/r/:token`, webhook, and CSV endpoints
  (`docs/threat-model.md` §4.8); CSP headers + token-storage hardening for
  the web app (§4.7).
- ⏳ Real-rail payout callbacks: signed callbacks + unknown-state requery
  discipline (already modelled in `payout-rail.ts`) once the fake
  `stub-network` rail is replaced.

## EXTERNAL DEPENDENCIES

Items only a human can clear. Every row also appears in the
[action tracker](./action-tracker.md) with exact input, owner, dependency,
and acceptance criteria.

- 👤 Merchant programme approvals: signed insertion terms per pilot merchant
  (commission basis, attribution window, validation delay, payment terms,
  allowed domains). *A machine cannot sign commercial terms with a merchant.*
- 👤 Channel exports: fresh 28/90-day audience + content-vertical exports
  from pilot publishers, on file before contracting. *Only the publishers
  can provide their own data.*
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
  HA/persistence decided, backups + WAL archiving, monitoring. *Sandbox has
  no real infrastructure to provision.*
- 👤 Load soak executed on the real staging deployment and results
  recorded. *The soak must run against real Postgres + Redis, which only a
  human can stand up and approve for traffic.*
- 👤 Backup-restore drill evidence recorded on real Postgres, RPO/RTO
  declared. *Only a real cluster can produce real recovery numbers.*
- 👤 External pentest of the API + redirect surface, scoped per
  [`docs/threat-model.md` §5](./threat-model.md), scheduled or waived in
  writing. *Independent security testing cannot be done by the builders.*
- 👤 Payout rail: pilot payout account credentials in the vault; the fake
  `stub-network` rail replaced or explicitly approved for the pilot's money
  path; maker-checker roles assigned to real humans (`finance_operator` ≠
  `finance_approver`). *Only humans hold credentials and job titles.*
- 👤 Alerts wired: click-volume drop, redirect 5xx/p95, webhook backlog,
  settlement gap, books-balanced sweep on a schedule. *Only the operator of
  the real deployment can wire and validate alerting.*
- 👤 Kill-switch drill with the on-call rotation: pause + resume a canary
  programme, worst-case staleness under Redis best-effort documented.
  *Only the on-call rotation can rehearse an incident.*
- 👤 App-handoff / device matrix: in-app browsers, deferred deep links run
  before pilot traffic. *Only humans have the physical devices.*
