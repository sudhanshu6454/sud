# docs/ — ASSUMPTIONS

Decisions baked into the documentation added 2026-09-23 (dependency
review, alerting, pentest scope, deploy runbook). Challenge deliberately
rather than discovering by accident. Items still needing a human decision
are marked **open**.

## 1. `pnpm audit` could not run from this sandbox — OSV was used instead

The npm security-audit endpoint (`POST registry.npmjs.org/-/npm/v1/security/audits`)
is reset by this environment's egress filter. Every package pinned in
`pnpm-lock.yaml` (171) plus `vitest`/`pg-mem` was instead queried against
the OSV API per name+version (2026-09-23: zero findings). OSV ingests the
same npm advisories, so coverage is equivalent for known npm CVEs — but
this is not a substitute for running `pnpm audit` (or an SCA tool) on CI
where the endpoint is reachable. **Open:** add `pnpm audit --audit-level=high`
as a CI gate when CI exists, and reconcile against
`docs/runbooks/dependency-review.md`.

## 2. Alert thresholds are pilot-loose and assumed, not tuned

`docs/monitoring/alerts.yaml` thresholds (50% click-volume drop, 5xx > 1%,
p95 > 500 ms, 30-min webhook lag, 14-day settlement window, 20% collected
ratio) are first guesses for ≤10k redirects/day and deliberately loose to
avoid paging on thin-traffic noise. They assume CloudWatch (Option A) or
the DO equivalent (Option B) can express weekday-hour baselines — if the
chosen stack cannot, the volume alert falls back to the fixed floor
documented in `alerts.yaml`. Thresholds must be re-tuned after 4 weeks of
baseline data; record changes with dates in `docs/runbooks/alerts.md`.

## 3. Metric names in alerts.yaml are logical, not provisioned

Metric identifiers (`click_observed_events_total`, ALB mappings, the daily
settlement-gap SQL, the hourly `checkBooksBalanced` sweep) assume
someone implements the metric publishers (redirect service counters, a
reconciliation-job gauge, a scheduled ledger sweep job). Those publishers
do not exist yet. Wiring the alerts to the monitoring stack is
**PENDING INFRA** — the alerts are definitions, not live alarms.

## 4. Migrations are append-only; rollback means restore or compensate

`db/migrate.mjs` applies `db/migrations/*.sql` in lexical order with no
down-migrations. Since 2026-09-29 it records each applied file in
`schema_migrations` (filename only, no checksum) and skips recorded files.
The deploy runbook therefore defines rollback as: forward compensating
migration (preferred) or pre-deploy snapshot restore (for corruption).
This assumes snapshots are taken before every deploy and restores are
drilled — both are **open** until the infra exists. Checksums are not
tracked, so shipped migration files must never be edited.

## 5. The pentest assumes a cooperative, sandbox-only engagement

`docs/pentest-scope.md` assumes the tester receives a seeded sandbox with
two test orgs, all seven roles, and the `JWT_SECRET` (the JWT layer is a
known dev stub — the tester's value is in everything the stub lets them
reach). It assumes no real merchant names, no real credentials, and no
production environment exist yet. If any of those come into existence
before the test, the scope must be re-issued.
