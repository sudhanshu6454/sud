# scripts/ — ASSUMPTIONS

Decisions baked into the operational scripts (`backup.sh`, `restore.sh`,
`demo-money-loop.ts`) and the database scripts they lean on (`db/migrate.mjs`,
`db/seed-fleet.ts`). Recorded here so the operator can challenge them
deliberately rather than discover them by accident. Infra-level items that
still need a human decision are marked **open**.

## 1. Connection defaults mirror docker-compose.yml — but there is no default password

`backup.sh`/`restore.sh` resolve the connection as: `DATABASE_URL` first,
else `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` with defaults
`localhost` / `5432` / `paparazzi` / `paparazzi` (db name and user only).
No password is invented: libpq is expected to find it via `PGPASSWORD`,
`~/.pgpass`, or the URL. Failing closed (no silent wrong-password retry) is
deliberate — a backup that "succeeds" against the wrong database is worse
than a loud failure.

## 2. Production guard is a name heuristic, not a guarantee

`backup.sh` refuses to run when the database name or host matches
`prod|prd|production|live` (case-insensitive) unless `PAPARAZZI_ALLOW_PROD=yes`
is set explicitly. `restore.sh` hard-refuses a scratch target that matches the
same pattern or equals the source database name — that check has **no**
override, because the drill drops its target. The heuristic catches naming
conventions; it cannot catch a production database reached via an innocuous
alias. It can also false-positive: substring matching means a database
literally named `products` trips the guard (use the explicit opt-in flag or
rename). The human running the script is the last line of defence.

## 3. pg_dump flags: plain `-Fc`, owners included

The dump is a faithful copy: default owner/ACL statements are kept so a
restore reproduces privileges, not just rows. Consequence: the restoring
role must be able to own those objects (true in the sandbox where the
`paparazzi` role owns the schema; on managed clouds the operator may need
`--no-owner` on the pg_dump side — see the runbook).

## 4. Manifest is evidence, not the source of truth

The `.manifest.json` written next to each dump (UTC timestamp, DB name, PG
version, SHA-256, byte size, row counts of the money-critical and
high-volume tables) exists so the restore drill can verify *fidelity*.
Row counts detect a truncated restore; they do not detect a subtly wrong
one. The ledger balance check (`sum(debit_minor) == sum(credit_minor)` per
currency, integer minor units — the same invariant as `checkBooksBalanced`
in `packages/shared/src/ledger.ts`) detects corrupted money, not corrupted
attribution. Neither replaces running the application's own acceptance
suite against a restored database before declaring recovery complete.

## 5. python3 is a hard requirement of restore.sh

Manifest parsing and balance comparison are done in embedded python3 (exact
integer arithmetic on minor units — shell arithmetic would be wrong for
`bigint` sums). `backup.sh` degrades to hand-rolled JSON if python3 is
absent; `restore.sh` fails fast instead, because a silently-skipped check is
worse than no drill.

## 6. **Open:** WAL archiving / point-in-time recovery

The scripts take full logical backups (`pg_dump -Fc`). The runbook
*assumes* continuous WAL archiving (or the managed-DB equivalent) is enabled
on the production cluster so restores can reach a point-in-time between
dailies. Until that is confirmed on the actual infrastructure, RPO is
"up to 24 h" and restores land on the last dump.

## 7. **Open:** encryption at rest and offsite copies

The runbook notes encryption-at-rest (pgcrypto/KMS or volume encryption)
and same-day offsite copies as requirements, but the mechanism is pending
the infra choice (managed Postgres vs self-hosted). The scripts encrypt
nothing themselves — `BACKUP_DIR` permissions are the only protection they
apply, which is sufficient for a sandbox and insufficient for anything else.

## 8. Retention windows are a proposal, not a policy

Daily 30 d / weekly 12 w / monthly 12 m in the runbook is a starting point.
Counsel and finance need to sign off (financial-record retention, DPDP
minimisation for tracking payloads) before it becomes policy.

## 2026-09-29 — migration tracking, fleet seed, demo on real Postgres

### 9. `schema_migrations` records filenames, not content hashes

`db/migrate.mjs` now skips files recorded in `schema_migrations` and records
each file inside the same transaction as its SQL. It deliberately stores only
the filename: hashing would turn a whitespace edit into a false "drifted"
alarm, and the migrations directory is append-only by rule anyway. The cost is
that an edit to a recorded file silently does nothing on databases that
already ran it — new schema always goes in a new file.

### 10. `--baseline` trusts the operator

A database created before tracking existed makes a plain run fail on `0001`
(`relation "organisations" already exists`) with a hint naming `--baseline`.
Baseline then records every present file as applied without executing or
verifying anything. Failing loudly rather than auto-detecting "looks applied"
is deliberate: the runner must never guess schema state on a money database.
The one existing dev database (`paparazzi` on 127.0.0.1) was baselined this
way; a plain run there is now a no-op.

### 11. The fleet publisher skips the onboarding state machine

`db/seed-fleet.ts` creates "Marketing Fleet (in-house)" directly as
`status = 'approved'`, `onboarding_state = 'active'`, with an
`owner_operated` verification (no expiry) on each site property. The
publisher is the operator itself — there is no counterparty to run
`application → identity_review → property_verification →
programme_eligibility → contract` against, and `POST /v1/links` would refuse
to mint for anything else. Third-party publishers still go through the state
machine; nothing in the API was changed for this.

### 12. Fleet rows are real-entity records; only the demo programme is TEST data

The organisation, users, publisher and properties the fleet seed creates
name the operator's real sites (from `autopub/config/sites.yaml`) — they are
the in-house network, not sandbox data, so they carry no "Demo" label. The
logins are RFC 2606 placeholders (`<role>@marketing-fleet.invalid`) until
`FLEET_*_EMAIL` supplies real addresses. Everything behind
`--with-demo-programme` (merchant, programme, contract, product, offer,
looks, campaign, placements) is TEST-labelled per invariant 11 (`Demo …`,
`shop.example.com`, `demo/fleet/*`) and the flag refuses to run under
`NODE_ENV=production`. Consequence: without a real, contracted programme the
fleet properties have no placements, so `WEB_PLACEMENT_ID` only exists in
the sandbox until a merchant is actually signed — the seed does not invent
one.

### 13. The fleet seed merges everything; `seed.ts` still duplicates

`seed-fleet.ts` merges every row on a natural key (unique-constraint
`on conflict` where one exists, select-then-insert otherwise) and runs in one
transaction, so re-running is safe and converges mutable columns (offer
`fresh_until` is pushed out 30 days on every run so sandbox links stay
mintable). `db/seed.ts` keeps its documented run-once semantics; it was only
touched to fill the `0005` look columns (`source_page 'Demo Candid Frames'`,
`sponsored false`, `cover_asset_id`).

### 14. `demo:pg` creates and drops its own database

With `DEMO_TARGET=postgres` the demo creates `paparazzi_demo_<8 hex>` through
the `postgres` maintenance database using the `DATABASE_URL` credentials —
so that role needs `CREATEDB` (true for the dev role). The drop runs in a
`finally` (also on a thrown step or a failed migration), uses
`drop database … with (force)` to clear stragglers, and refuses any name
without the `paparazzi_demo_` prefix. `DEMO_DATABASE_URL` opts out of
create/drop for operators who cannot grant `CREATEDB`; that database must be
empty and is refused if it already has migrations recorded. The demo also
repoints `process.env.DATABASE_URL` at the scratch database before importing
the API so the API's default pool can never touch the caller's real database.
No assertion differs between pg-mem and Postgres 16; the demo's
`bigint`-as-string handling (`::text` + `Number`/`BigInt`) already covered
the one known driver difference.
