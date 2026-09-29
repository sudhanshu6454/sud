# Runbook: deploy & rollback

Dated 2026-09-23 (commands revised 2026-09-29). Target: the pilot deployment described in
`docs/infrastructure-recommendation.md` (managed Postgres + Redis, four
services via `docker-compose.prod.yml`). **Nothing is provisioned yet —
the infra decision (Option A/B) and account access are PENDING with the
user.** This runbook is the procedure to follow once they exist.

## 0. Preconditions (do not deploy without these)

- [ ] `pnpm typecheck` and `pnpm test` green on the release commit
      (616/616 tests in 31 files on 2026-09-29; `pnpm demo` and `pnpm demo:pg` green).
- [ ] `docs/runbooks/dependency-review.md` re-run for the release; no
      unaddressed high/critical findings.
- [ ] Fresh database backup exists and is restorable (see
      `docs/runbooks/backup-restore.md`; RPO ≤ 24 h, RTO ≤ 4 h).
- [ ] Secrets are populated in the vault / `/run/secrets/paparazzi.env`
      (see `docs/credential-setup.md`) — never in the image or the repo.
      Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`,
      `STUB_WEBHOOK_SECRET`, `REDIRECT_BASE_URL`, and for the web
      `WEB_API_TOKEN` + `WEB_PLACEMENT_ID` (compose refuses to load the file
      without them; on a first deploy they come from the network seed and
      the api image — README.md "Running Afflino"); `WEB_HOST`, required
      for the first deploy: the shop's public hostname (without it the seed
      creates no shop placement, prints no `web_placement_id`, and
      `WEB_PLACEMENT_ID` comes out empty); `NETWORK_FILE` whenever the
      operator's own network file is used (§1, first deploy and every
      re-run of the seed); optional: `NEXT_PUBLIC_API_BASE`, `RETENTION_*`
      overrides.
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
   curl -fsS http://localhost:3002/api/healthz   # web (through its /api proxy to the api)
   docker compose -f docker-compose.prod.yml ps   # all "healthy"/"running"
   ```
5. **Verify money-path smoke.** Run the canary check: mint a link via the
   API, `GET /r/{token}`, expect a 302 to an allow-listed host with a
   fresh `subid`. Then run the kill-switch drill (§4) — a deploy is not
   done until the drill passes.
6. **Watch.** Tail logs for 15 minutes; confirm the BullMQ queues
   (`provider-events`, `click-events`, `reconciliation`) are draining and
   no `LEDGER_IMBALANCE` 409s appear at payout prepare.

**First deploy only** (a database with no rows yet): before step 2 —
compose cannot load the file until both web values exist — build the
migrate and api images with `docker build`, apply the migrations and run the
network seed with the migrate image, mint the web's read-only token with the
api image, and store `WEB_PLACEMENT_ID` and `WEB_API_TOKEN` in the vault;
after step 4, mint the shop's links. The exact
single lines are in README.md "Running Afflino" (production shape) and
`docker/README.md` "Operator scripts". The seed is idempotent and changes no
status an operator set, so it can be re-run on a later deploy, but a re-run
must read **the same network file as the first run**. For the operator's own
network: set `NETWORK_FILE=/app/config/network.yaml` in the vault env, keep
`network.yaml` next to `docker-compose.prod.yml` and uncomment the `migrate`
service's volume, then run the line below; `-e NODE_ENV=production` makes the
seed refuse the TEST example file, so a lost `NETWORK_FILE` fails instead of
seeding the five TEST properties into the real `afflino` organisation as
approved and `owner_operated`:

```sh
docker compose -f docker-compose.prod.yml run --rm -T -e NODE_ENV=production migrate ./node_modules/.bin/tsx db/seed-network.ts
```

A sandbox-shape deployment (the TEST example file, seeded with
`--with-demo-programme`, the only way to a placement until a programme is
contracted) re-runs the seed with that flag and without `NODE_ENV=production`,
which refuses both:

```sh
docker compose -f docker-compose.prod.yml run --rm -T migrate ./node_modules/.bin/tsx db/seed-network.ts --with-demo-programme
```

## 2. Migration rollback policy

**Migrations in this repo are append-only and forward-only — there are no
down-migrations.** `db/migrate.mjs` records every applied file in
`schema_migrations` (filename, applied_at) inside the same transaction as
the file itself, and skips recorded files on the next run, so a re-deploy
is a no-op when nothing is pending. `node db/migrate.mjs --status` lists
applied and pending files. A database created before tracking existed is
recorded once with `node db/migrate.mjs --baseline` (only when its schema
is already current). Consequences:

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
- **Known gap:** `schema_migrations` records filenames, not checksums,
  so an edited shipped file would not be noticed. Never edit a shipped
  migration; write a new numbered file instead. A restored snapshot
  carries its own `schema_migrations` rows, so the runner applies exactly
  the files the snapshot predates.

## 3. Rollback procedure (bad release)

1. Note the current `IMAGE_TAG` and the failure symptom; open an incident
   channel.
2. If the failure is **code-only** (no migration applied in this
   release): check out the previous release tag and redeploy it (§1 step 1
   tags every release `release-YYYYMMDD-HHMM`, so the second-newest tag is
   the one before this release; `--build` builds from the checkout, which is
   why the checkout comes first), then re-run the §1 verify steps. No
   database action needed.
   ```sh
   PREV="$(git tag --list 'release-*' | sort | tail -n 2 | head -n 1)" && git checkout "$PREV" && IMAGE_TAG="$PREV" docker compose -f docker-compose.prod.yml up -d --build
   ```
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
programme). Until a real programme exists the canary is the TEST "Demo
Network Programme" from the network seed; the lines below read its id and
the organisation's id from `seed-network.json` (the first deploy's output,
README.md "Running Afflino") and mint a `network_admin` token with the api
image (`JWT_SECRET` in the environment), against the api on this host. The
token's subject is the seeded `network_admin` user's id: the pause and resume
write an `audit_log` row whose `actor_id` references `users`, so a subject
that is not a user id fails the call with a 500.

1. **Baseline:** mint a link on the canary programme
   (`POST /v1/links` → 201, capture `token`). `GET /r/{token}` → expect
   **302** to the allow-listed host with `subid=` in the location.
2. **Pause** (as `network_admin`):
   ```sh
   curl -fsS -X POST "http://localhost:3000/v1/programmes/$(grep -m1 '"programme_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')/pause" -H "Authorization: Bearer $(docker run --rm --pull never -e JWT_SECRET "paparazzi/api:${IMAGE_TAG:-latest}" node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role network_admin --sub "$(grep -A1 '"network_admin": {' seed-network.json | sed -n 's/.*"id": "\(.*\)".*/\1/p')")"
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
   curl -fsS -X POST "http://localhost:3000/v1/programmes/$(grep -m1 '"programme_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')/resume" -H "Authorization: Bearer $(docker run --rm --pull never -e JWT_SECRET "paparazzi/api:${IMAGE_TAG:-latest}" node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role network_admin --sub "$(grep -A1 '"network_admin": {' seed-network.json | sed -n 's/.*"id": "\(.*\)".*/\1/p')")"
   ```
   Expect 200, `data.status == "active"`. (Resuming a non-paused
   programme is 409 — the drill uses a paused one.)
5. **Verify recovery:** `GET /r/{token}` → expect **302** with `subid=`
   again; mint a new link → 201.
6. **Negative control:** attempt pause as a non-admin role (`editor`)
   → expect **403** `FORBIDDEN` (the line prints the status code). If this
   ever returns 200, stop the drill and treat it as a security incident.
   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://localhost:3000/v1/programmes/$(grep -m1 '"programme_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')/pause" -H "Authorization: Bearer $(docker run --rm --pull never -e JWT_SECRET "paparazzi/api:${IMAGE_TAG:-latest}" node scripts/mint-dev-token.mjs --org-id "$(grep -m1 '"org_id"' seed-network.json | sed 's/.*: "\(.*\)".*/\1/')" --role editor --sub "$(grep -A1 '"network_admin": {' seed-network.json | sed -n 's/.*"id": "\(.*\)".*/\1/p')")"
   ```
7. Log the drill (date, operator, programme id, all six outcomes) in the
   ops log. Any step failing = deploy is not accepted; roll back per §3.

## PENDING (production-only, cannot be checked in the sandbox)

- Real snapshot restore drill against RDS (validates §2 end-to-end).
- Route 53 / ALB health-check wiring for the canary programme.
- Checksums in `schema_migrations` (filenames are tracked; content is not).
- CI gate running `pnpm audit`, typecheck, tests, and the load soak
  (`pnpm load:smoke`) on every release candidate.
