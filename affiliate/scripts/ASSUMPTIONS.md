# scripts/ — ASSUMPTIONS

Decisions baked into the operational scripts (`backup.sh`, `restore.sh`).
Recorded here so the operator can challenge them deliberately rather than
discover them by accident. Infra-level items that still need a human decision
are marked **open**.

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
