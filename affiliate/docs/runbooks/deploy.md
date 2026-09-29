# Runbook: deploy & rollback

Dated 2026-09-23. Target: the pilot deployment described in
`docs/infrastructure-recommendation.md` (managed Postgres + Redis, four
services via `docker-compose.prod.yml`). **Nothing is provisioned yet —
the infra decision (Option A/B) and account access are PENDING with the
user.** This runbook is the procedure to follow once they exist.

## 0. Preconditions (do not deploy without these)

- [ ] `pnpm typecheck` and `pnpm test` green on the release commit
      (94/94 tests; `pnpm demo` green).
- [ ] `docs/runbooks/dependency-review.md` re-run for the release; no
      unaddressed high/critical findings.
- [ ] Fresh database backup exists and is restorable (see
      `docs/runbooks/backup-restore.md`; RPO ≤ 24 h, RTO ≤ 4 h).
- [ ] Secrets are populated in the vault / `/run/secrets/paparazzi.env`
      (see `docs/credential-setup.md`) — never in the image or the repo.
      Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`,
      `STUB_WEBHOOK_SECRET`; optional: `REDIRECT_BASE_URL`,
      `NEXT_PUBLIC_API_BASE`, `RETENTION_*` overrides.
- [ ] The release's migration files are reviewed (see § Migration policy
      below): migrations are **append-only and forward-only**.
- [ ] On-call engineer + a `network_admin` user are available for the
      kill-switch drill (§ Kill-switch drill).

## 1. Deploy procedure

All commands run on the provisioned host with secrets injected into the
environment (`set -a; source /run/secrets/paparazzi.env; set +a`).

1. **Pin the release.** Tag the commit (`release-YYYYMMDD-HHMM`) and set
   `IMAGE_TAG` to the tag — never deploy `latest` to pilot.
2. **Build.**
   ```sh
   docker compose -f docker-compose.prod.yml build
   ```
   Validates all five Dockerfiles (`docker/Dockerfile.{api,redirect,workers,web,migrate}`).
   If the web build fails on `NEXT_PUBLIC_API_BASE`, the build arg was
   not passed — rebuild with it; the value is baked into the Next.js
   bundle at build time.
3. **Migrate.** The `migrate` one-shot service runs
   `node db/migrate.mjs` against `DATABASE_URL` before the app services
   start (`depends_on: migrate: service_completed_successfully`).
   ```sh
   docker compose -f docker-compose.prod.yml up -d
   docker compose -f docker-compose.prod.yml logs migrate
   ```
   The runner applies `db/migrations/*.sql` in lexical order, one
   transaction per file, and stops on the first failure. If `migrate`
   fails, **nothing else starts** — fix forward (new migration file) or
   roll back (§2); never hand-edit the database to "catch up" a failed
   migration.
4. **Verify health.**
   ```sh
   curl -fsS http://localhost:3000/healthz   # api
   curl -fsS http://localhost:3001/healthz   # redirect
   docker compose -f docker-compose.prod.yml ps   # all "healthy"/"running"
   ```
5. **Verify money-path smoke.** Run the canary check: mint a link via the
   API, `GET /r/{token}`, expect a 302 to an allow-listed host with a
   fresh `subid`. Then run the kill-switch drill (§3) — a deploy is not
   done until the drill passes.
6. **Watch.** Tail logs for 15 minutes; confirm the BullMQ queues
   (`provider-events`, `click-events`, `reconciliation`) are draining and
   no `LEDGER_IMBALANCE` 409s appear at payout prepare.

## 2. Migration rollback policy

**Migrations in this repo are append-only and forward-only — there are no
down-migrations, and there is no applied-migration tracking table.**
`db/migrate.mjs` re-applies `db/migrations/*.sql` in lexical order and
will fail if a file's DDL was already applied (e.g. plain `CREATE TABLE`
on re-run). Consequences:

- A **failed migration** leaves the database at the last fully-applied
  file (each file runs in its own transaction and rolls back on error).
  Do not partially re-run; do not hand-apply the missing statements.
- A **bad migration that applied cleanly** cannot be "rolled back" by
  the tooling. The only supported rollback is:
  1. Restore Postgres from the pre-deploy snapshot (point-in-time
     recovery per `docs/runbooks/backup-restore.md`).
  2. Redeploy the previous `IMAGE_TAG` (which contains the previous
     migration set).
  3. Write a **forward compensating migration** (new numbered file, e.g.
     `0005_*.sql`) that undoes the bad change's *effect* for any
     environments that already applied it — never edit or delete the
     shipped file.
- Because restores lose data written after the snapshot, prefer
  forward-fixes for anything that does not corrupt the ledger; reserve
  snapshot restore for corruption or a migration that blocks the app
  from booting.
- **Known gap:** without a `schema_migrations` tracking table, the
  runner cannot skip already-applied files. Adding one (applied filename
  + checksum) is recommended pre-launch so re-deploys and restores are
  idempotent. Until then, deploy logs are the record of which files
  applied.

## 3. Rollback procedure (bad release)

1. Note the current `IMAGE_TAG` and the failure symptom; open an incident
   channel.
2. If the failure is **code-only** (no migration applied in this
   release): `IMAGE_TAG=<previous> docker compose -f
   docker-compose.prod.yml up -d --build` and re-run the §1 verify steps.
   No database action needed.
3. If the release **included a migration** that applied: follow the
   migration rollback policy above (forward compensating migration
   preferred; snapshot restore for corruption).
4. If the redirect service is down but API/DB are up: pull the programme
   kill switch for affected programmes (`POST
   /v1/programmes/:id/pause`, `network_admin`) so links serve the paused
   page instead of silently dropping attribution — see
   `docs/runbooks/tracking-outage.md` § Immediate containment.
5. Postmortem within 48 h; record the rollback in the incident log with
   the tags involved.

## 4. Kill-switch drill procedure

Purpose: prove that pausing a programme stops commissionable traffic
end-to-end (eligibility flip + cache invalidation + blocked minting) and
that resume restores it. Run **after every deploy** and **monthly** in
pilot. Grounded in the tests at
`packages/api/test/phase3.test.ts` ("programme kill switch", lines
~426–536) — the drill is the live version of that test.

Use a **canary programme** (TEST-labelled, never a real merchant
programme).

1. **Baseline:** mint a link on the canary programme
   (`POST /v1/links` → 201, capture `token`). `GET /r/{token}` → expect
   **302** to the allow-listed host with `subid=` in the location.
2. **Pause** (as `network_admin`):
   ```sh
   curl -X POST $API_BASE/v1/programmes/$CANARY_ID/pause \
     -H "Authorization: Bearer <network_admin_jwt>"
   ```
   Expect 200, `data.status == "paused"`. (Pause is idempotent —
   re-pausing returns 200; the test asserts this.)
3. **Verify the kill:**
   - `GET /r/{token}` → expect **200** with the paused page (no 302, no
     click minted, no `subid`).
   - `POST /v1/links` for the canary programme → expect **403**
     `PROGRAMME_NOT_APPROVED`.
   - Confirm `route:{token}` was invalidated in Redis (no stale 302s).
   - Confirm the audit trail: `audit_log` row `programme.pause` and an
     `outbox` event `programme.paused`.
4. **Resume** (as `network_admin`):
   ```sh
   curl -X POST $API_BASE/v1/programmes/$CANARY_ID/resume \
     -H "Authorization: Bearer <network_admin_jwt>"
   ```
   Expect 200, `data.status == "active"`. (Resuming a non-paused
   programme is 409 — the drill uses a paused one.)
5. **Verify recovery:** `GET /r/{token}` → expect **302** with `subid=`
   again; mint a new link → 201.
6. **Negative control:** attempt pause as a non-admin role (e.g.
   `editor`) → expect **403** `FORBIDDEN`. If this ever returns 200, stop
   the drill and treat it as a security incident.
7. Log the drill (date, operator, programme id, all six outcomes) in the
   ops log. Any step failing = deploy is not accepted; roll back per §3.

## PENDING (production-only, cannot be checked in the sandbox)

- Real snapshot restore drill against RDS (validates §2 end-to-end).
- Route 53 / ALB health-check wiring for the canary programme.
- `schema_migrations` tracking table (recommended pre-launch).
- CI gate running `pnpm audit`, typecheck, tests, and the load soak
  (`pnpm load:smoke`) on every release candidate.
