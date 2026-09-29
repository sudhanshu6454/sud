# scripts/ — ASSUMPTIONS

Decisions baked into the operational scripts (`backup.sh`, `restore.sh`,
`demo-money-loop.ts`) and the database scripts they lean on (`db/migrate.mjs`,
`db/seed-network.ts`). Recorded here so the operator can challenge them
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

## 2026-09-29 — migration tracking, in-house network seed, demo on real Postgres

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

### 11. The in-house publisher skips the onboarding state machine

`db/seed-network.ts` creates "Afflino in-house network" directly as
`status = 'approved'`, `onboarding_state = 'active'`, with an
`owner_operated` verification (no expiry) on each network property. The
publisher is the operator itself — there is no counterparty to run
`application → identity_review → property_verification →
programme_eligibility → contract` against, and `POST /v1/links` would refuse
to mint for anything else. Third-party publishers still go through the state
machine; nothing in the API was changed for this.

### 12. Network rows are what the network file says; only the demo programme is TEST data

The organisation ("Afflino"), users, publisher and properties the network
seed creates are the in-house network as the network file lists it, so the
seed adds no "Demo" label of its own. The shipped default,
`db/network.example.yaml`, is TEST data (`Demo …` names, `demo` handles,
example.com urls, asserted warning-free by `packages/api/test/seed-network.test.ts`);
an operator's own file names real accounts, and a url outside the reserved
example names is seeded with a warning on stderr, never rejected — the seed
cannot tell a real account from a typo. The logins are RFC 2606
placeholders (`<role>@afflino.invalid`) until `SEED_*_EMAIL` supplies real
addresses. Everything behind `--with-demo-programme` (merchant, programme,
contract, product, offer, looks, campaign, placements) is TEST-labelled per
invariant 11 (`Demo …`, `shop.example.com`, `demo/network/*`) and the flag
refuses to run under `NODE_ENV=production`; so does the example network file
(a production re-run that lost `NETWORK_FILE` must fail, not seed the TEST
properties into the real organisation). Consequence: without a real,
contracted programme the network properties have no placements, so
`WEB_PLACEMENT_ID` only exists in the sandbox until a merchant is actually
signed — the seed does not invent one.

### 13. The network seed merges everything; `seed.ts` still duplicates

`seed-network.ts` merges every row on a natural key (unique-constraint
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

## 2026-09-29 (review fixes)

15. **Seed re-runs never change status.** `db/seed-network.ts` sets `status`, `onboarding_state`,
    contract terms and membership roles on insert only. Operators' suspensions, programme pauses
    (the kill switch), offer revocations, look withdrawals (rights takedowns) and role changes
    survive a re-run of the seed. Verified on Postgres 16: all seven operator changes held
    across a re-run, with identical row counts and a byte-identical summary.
16. **No cross-organisation takeover.** `properties (platform, external_account_id)` and
    `placements.placement_key` are unique across all organisations. The seed's upserts are
    guarded to its own org; a row owned elsewhere makes the whole seed fail and roll back, with
    the other org's row untouched (verified).
17. **`--baseline` refuses a database without schema.** It records files without running them,
    so it now requires 0001's `organisations` table and leaves nothing behind when it refuses.
18. **`DEMO_DATABASE_URL` is checked before migrating.** A caller-supplied database with any
    table in `public` is refused before anything runs against it (verified: the local database's
    `schema_migrations` stayed at 5 rows).

## 2026-09-29 — standalone app

19. **Standalone since 2026-09-29: the seed became `db/seed-network.ts`.**
    History, not instructions. The seed no longer reads another repository's site list; it
    reads a network file (`db/network.example.yaml` by default, `--network` / `NETWORK_FILE`
    for the operator's own) of `key`, `name`, `platform` (instagram | facebook | youtube | snapchat |
    telegram | web), `account` and `url`, and §11–13 and §15–16 above now describe it. Its
    safety properties are unchanged and were re-verified on fresh Postgres 16 databases the
    same day: two runs gave identical row counts and byte-identical JSON, the seven operator
    changes of §15 held, and another organisation owning one network account (or the shop's
    placement key) made the seed fail and roll back with that organisation's row untouched.
20. **The network seed reports the stored role and refuses TEST inputs in production.**
    `users.<role>.role` in the seed's JSON is read back from `memberships` after the insert, so
    a role an operator changed (§15) shows as changed instead of repeating the role the seed
    asked for. Under `NODE_ENV=production` the seed refuses the example network file as well
    as `--with-demo-programme` (`cliRefusal`): a production re-run that lost `NETWORK_FILE`
    fails instead of seeding the six TEST properties into the real organisation as approved
    and `owner_operated`. `--with-demo-programme` without `WEB_HOST` prints on stderr that no
    shop placement (so no `web_placement_id`) is created (`cliNotices`).
21. **`restore.sh` passes its target to `pg_restore` with `-d`.** It used to hand `pg_restore`
    the scratch database (or its URL) as a positional argument, which `pg_restore` reads as a
    second file name, so every drill stopped at `pg_restore: error: too many command-line
    arguments` in both connection modes. Verified 2026-09-29 on the sandbox's PostgreSQL 16:
    `backup.sh`, then README.md's `scripts/restore.sh "$(ls -t ./backups/*.dump | head -1)"`,
    ends `RESULT: PASS (3 passed, 0 failed)` with `DATABASE_URL` and with `PG*` variables. This
    is a local run, not the real-Postgres drill the pilot checklist still asks for.
