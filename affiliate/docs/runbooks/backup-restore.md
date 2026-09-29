# Runbook: database backup & restore

Scope: the platform Postgres database — the publisher ledger, attribution
records, and all money-adjacent state. Losing it means losing the ability to
prove who is owed what, so backups are treated as a financial control, not
just an ops chore.

Scripts: `scripts/backup.sh` (take + verify + manifest) and
`scripts/restore.sh` (restore drill into a scratch DB + validation).
Assumptions and open items: [scripts/ASSUMPTIONS.md](../../scripts/ASSUMPTIONS.md).

## Owner

On-call engineer owns the schedule and the monthly drill; finance_operator
signs the pilot-gate evidence (they are the consumer of the ledger
correctness it proves).

## Schedule (recommended)

- **Daily full logical backup**, `02:00 UTC` (deliberately offset from the
  03:00 UTC retention-purge job): `BACKUP_DIR=/var/backups/paparazzi scripts/backup.sh`
  from cron/systemd timer on the backup host. Keep the cron minimal — the
  script itself does dump → verify → hash → manifest, and exits non-zero on
  any failure so the scheduler alerts.
- **WAL archiving: assumed enabled** (or the managed-DB equivalent, e.g. RDS
  automated backups / Cloud SQL PITR). This is the assumption in
  scripts/ASSUMPTIONS.md §6: without it, point-in-time recovery between
  dailies is impossible and RPO is "up to 24 h".
- **Monthly restore drill** (or after every schema migration that touches
  money tables): run `scripts/restore.sh` against the latest dump on a
  scratch host and file the report under the evidence checklist below.

## Retention (proposed — needs sign-off, see Open questions)

| Tier | Window | Example |
|---|---|---|
| Daily dumps | 30 days | `paparazzi-*-20260922T020000Z.dump` |
| Weekly dumps (Sunday) | 12 weeks | promote Sunday's dump |
| Monthly dumps (1st) | 12 months | promote the 1st's dump |

Promotion = copy, not re-dump. Old tiers are pruned by a scheduled job that
deletes `*.dump` + `*.manifest.json` pairs older than the tier window and
logs the deletion (audit trail: what was destroyed, when, by which job).
**Do not prune by hand.**

## Encryption at rest (assumption pending infra choice)

- Dumps must be encrypted at rest. Until the infra choice lands, the accepted
  mechanisms are: (a) managed-DB automated backups (encrypted by the
  provider), or (b) self-hosted: volume encryption (LUKS/EBS) **plus**
  age/gpg-encrypting each dump with the finance KMS key before it leaves the
  DB host. The scripts themselves encrypt nothing — `BACKUP_DIR`
  permissions are sandbox-grade only.
- Decryption keys live in the secret manager, never next to the dumps.

## Offsite copy (assumption pending infra choice)

- Every dump + manifest is copied offsite (different region/account) within
  24 h of creation — e.g. `aws s3 cp` to a versioned, Object-Locked bucket.
- The offsite copy is the one the restore drill should periodically target,
  not just the local `BACKUP_DIR` copy; a backup you cannot fetch is not a
  backup.
- Quarterly: restore from the offsite copy specifically (proves the copy
  path, not just the dump).

## Taking a backup (operator steps)

1. Confirm you are on the right host/database. The script prints its resolved
   target before doing anything; read it.
2. `BACKUP_DIR=/var/backups/paparazzi scripts/backup.sh`
3. On success you get two files, e.g.:
   - `paparazzi-paparazzi-20260922T020000Z.dump`
   - `paparazzi-paparazzi-20260922T020000Z.manifest.json` (UTC timestamp, DB
     name, PG version, SHA-256, byte size, row counts of
     `ledger_entries`, `adjustments`, `conversions`, `clicks`, `links`,
     `publishers`, `merchants`, `payout_batches`, `payout_items`,
     `merchant_settlements`)
4. Verify the manifest's `sha256` matches a fresh `sha256sum` of the dump
   (paranoia is cheap; the script already hashed it post-verification).
5. Copy both files offsite (see above). The local copy is not the backup
   until the offsite copy exists.
6. If the target looked production-like, the script will have refused unless
   `PAPARAZZI_ALLOW_PROD=yes` was set — that refusal is logged; treat any
   `PAPARAZZI_ALLOW_PROD=yes` invocation as a privileged action and note it
   in the ops log.

## Restore procedure (operator steps — real incident)

1. **Stop the bleeding first**: pause the programmes / put the app in
   maintenance if the database is corrupt — do not let new writes land on a
   database you are about to replace. (`POST /v1/programmes/:id/pause`.)
2. Pick the restore point: latest manifest whose `sha256` still verifies
   against the offsite copy. If WAL/PITR is available, pick the dump
   *before* the incident and plan to replay WAL to just before the bad
   event; otherwise the dump timestamp is your recovery point (RPO = up to
   24 h — communicate this).
3. Provision the target Postgres (same major version as `pg_version` in the
   manifest; minor drift is tolerated, major drift is not).
4. `sha256sum` the dump; compare to the manifest. Mismatch → do not
   restore; escalate and take the next-older dump.
5. Restore: `pg_restore -d <target> <dump>` (add `--no-owner` if the target
   roles differ from the source, e.g. managed clouds).
6. Run the validation from the drill, pointed at the restored DB:
   `scripts/restore.sh <dump> <manifest>` restores into a *scratch* DB — for
   a real recovery, run its checks (row counts vs manifest; ledger balance
   per currency) against the restored target instead, then run the
   application's acceptance path (`pnpm demo` / money-loop smoke) against
   it before cutting traffic over.
7. Cut over connection strings, unpause programmes, watch the canary link
   and the ledger-balance monitor for 30 min.

## Restore drill (sandbox / dev machine)

```sh
docker compose up -d          # postgres :5432 (+ run migrations/seed if empty)
BACKUP_DIR=./backups scripts/backup.sh
scripts/restore.sh ./backups/paparazzi-paparazzi-<timestamp>.dump
# -> per-check PASS/FAIL lines, final RESULT, and a .report.txt next to the dump
```

The drill drops and recreates `paparazzi_restore_drill` (override with
`PAPARAZZI_RESTORE_DB`). It hard-refuses any target that looks
production-like or equals the source DB — there is no override flag, by
design.

## Evidence checklist (pilot gate)

The pilot checklist requires backup-restore evidence before contracting.
File one completed checklist per drill; the finance_operator signs it.

- [ ] **Last successful restore date**: ______________ (from the drill
      report's `started:` line; must be within the last 30 days)
- [ ] **Dump integrity hash**: `sha256:________________` matches a fresh
      `sha256sum` of the dump file used
- [ ] **Row-count match**: all tables `manifest == restored` (see drill
      report `[PASS] row count …` lines)
- [ ] **Ledger balance check**: `sum(debit_minor) == sum(credit_minor)` for
      every currency in `ledger_entries` (see `[PASS] ledger nets to zero`)
- [ ] **Restore target**: scratch host/DB name (never the source DB)
- [ ] **Offsite copy verified**: the dump was fetched from offsite storage
      at least once this quarter (note date)
- [ ] **Application smoke**: `pnpm demo` (money loop) run against the
      restored DB — PASS / FAIL / skipped-with-reason

## Open questions (need a human decision)

1. **RPO/RTO targets**: is "up to 24 h RPO, RTO < 4 h" acceptable to
   finance and the pilot merchants, or do we need WAL-level PITR from day
   one? (Drives the scripts/ASSUMPTIONS.md §6 decision.)
2. **Retention sign-off**: do counsel (financial-record retention, DPDP
   minimisation) and finance approve daily-30d / weekly-12w / monthly-12m?
3. **Encryption mechanism**: managed-DB backups vs self-hosted volume +
   KMS-encrypted dumps — who owns the KMS key, and who can decrypt in an
   incident?
4. **Offsite destination**: which bucket/account/region, and who has write
   (backup job) vs read (incident responder) access?
5. **Credential custody**: where do the backup job's DB credentials live,
   and what is the rotation story?
6. **Backup window vs load**: 02:00 UTC avoids the retention purge, but is
   there a pilot-traffic trough that suits better once real traffic exists?
