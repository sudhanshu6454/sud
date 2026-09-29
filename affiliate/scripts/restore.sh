#!/usr/bin/env bash
#
# Paparazzi Affiliate Commerce Platform — restore drill.
#
# Restores a backup produced by scripts/backup.sh into a SCRATCH database and
# validates the restore. This is the pilot-gate evidence procedure: it proves
# a backup is actually restorable and that the money in it still balances.
#
# Usage:
#   scripts/restore.sh <dump-file> [manifest-file]
#   # manifest defaults to <dump-file> with .dump -> .manifest.json
#
# Scratch database: ${PAPARAZZI_RESTORE_DB:-paparazzi_restore_drill}
#   It is DROPPED and recreated, so it must never be a real database. The
#   script hard-refuses (no override flag exists) when the scratch name looks
#   production-like or equals the source database name.
#
# Connection: same resolution as backup.sh — DATABASE_URL first, else
# PGHOST/PGPORT/PGUSER/PGPASSWORD (+ a maintenance connection to the
# built-in "postgres" database for CREATE/DROP DATABASE).
#
# Validation (all reported PASS/FAIL, exit 0 only if every check passes):
#   1. pg_restore of the dump completes.
#   2. Per-table row counts in the scratch DB match the backup manifest.
#   3. Ledger double-entry invariant: per currency,
#      sum(debit_minor) == sum(credit_minor) over ledger_entries
#      (mirrors checkBooksBalanced in packages/shared/src/ledger.ts —
#      money is stored in integer minor units, never floats).
#
# Requires: pg_restore, psql, createdb/dropdb not needed (uses psql -d
# postgres), python3 (manifest + balance parsing).

set -euo pipefail

log()  { printf '[restore] %s\n' "$*" >&2; }
die()  { printf '[restore] ERROR: %s\n' "$*" >&2; exit 1; }

for bin in pg_restore psql python3 date; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin not found on PATH"
done

[ $# -ge 1 ] || die "usage: scripts/restore.sh <dump-file> [manifest-file]"
DUMP="$1"
[ -f "$DUMP" ] || die "dump file not found: $DUMP"
if [ $# -ge 2 ]; then
  MANIFEST="$2"
else
  MANIFEST="${DUMP%.dump}.manifest.json"
fi
[ -f "$MANIFEST" ] || die "manifest file not found: $MANIFEST (pass it explicitly as 2nd arg)"

# ------------------------------------------------- connection resolution
# (same defaults as backup.sh; see scripts/ASSUMPTIONS.md)

PROD_PATTERN='prod|prd|production|live'

# Parse a postgres:// URL into _U_USER _U_HOST _U_PORT _U_DB.
# The password is discarded — it is never needed separately from the URL.
parse_pg_url() {
  local rest="${1#*://}"        # strip scheme
  rest="${rest%%\?*}"           # strip query string
  local auth="${rest%%/*}"      # user[:pw]@host[:port]
  _U_DB=""; _U_USER=""; _U_HOST=""; _U_PORT=5432
  case "$rest" in */*) _U_DB="${rest#*/}" ;; esac
  case "$auth" in
    *@*) _U_USER="${auth%%:*}"; _U_USER="${_U_USER%%@*}" ;;
  esac
  local hostport="${auth##*@}"  # after the LAST @ (passwords may contain @)
  _U_HOST="${hostport%%:*}"
  case "$hostport" in *:*) _U_PORT="${hostport##*:}" ;; esac
}
looks_like_prod() { printf '%s' "$1" | grep -Eiq "$PROD_PATTERN"; }

if [ -n "${DATABASE_URL:-}" ]; then
  parse_pg_url "$DATABASE_URL"
  SRC_NAME="$_U_DB"
  SRV_HOST="$_U_HOST"
  SRV_PORT="$_U_PORT"
  SRV_USER="$_U_USER"
  [ -n "$SRC_NAME" ] || die "could not determine source database name from DATABASE_URL"
  # Maintenance + target connection strings with the dbname swapped out.
  swap_db() { printf '%s' "$DATABASE_URL" | sed -E "s#(^[a-zA-Z]+://[^/]*/)[^?]*#\1$1#"; }
  MAINT_URL="$(swap_db postgres)"
else
  SRC_NAME="${PGDATABASE:-paparazzi}"
  SRV_HOST="${PGHOST:-localhost}"
  SRV_PORT="${PGPORT:-5432}"
  SRV_USER="${PGUSER:-paparazzi}"
fi

DRILL_DB="${PAPARAZZI_RESTORE_DB:-paparazzi_restore_drill}"

# ------------------------------------------------- scratch safety gate
# No override: a restore drill must NEVER point at a real database.

if looks_like_prod "$DRILL_DB"; then
  die "scratch database name '$DRILL_DB' looks production-like — refusing. This check has no override; pick a scratch name."
fi
if [ "$DRILL_DB" = "$SRC_NAME" ]; then
  die "scratch database '$DRILL_DB' equals the source database — refusing (the drill drops its target). Set PAPARAZZI_RESTORE_DB to a scratch name."
fi

# psql takes the database (or URL) as a positional argument; pg_restore's only
# positional argument is the dump file, so it gets the same target through -d.
if [ -n "${DATABASE_URL:-}" ]; then
  MAINT_CONN=("$MAINT_URL")
  DRILL_CONN=("$(swap_db "$DRILL_DB")")
  RESTORE_CONN=(-d "$(swap_db "$DRILL_DB")")
else
  MAINT_CONN=(-h "$SRV_HOST" -p "$SRV_PORT" -U "$SRV_USER" postgres)
  DRILL_CONN=(-h "$SRV_HOST" -p "$SRV_PORT" -U "$SRV_USER" "$DRILL_DB")
  RESTORE_CONN=(-h "$SRV_HOST" -p "$SRV_PORT" -U "$SRV_USER" -d "$DRILL_DB")
fi

# ------------------------------------------------- report plumbing

BACKUP_DIR="$(dirname "$DUMP")"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="${BACKUP_DIR}/restore-${DRILL_DB}-${TS}.report.txt"
exec > >(tee "$REPORT") 2>&1

PASS=0; FAIL=0
check() { # $1: name, $2: 0=pass/1=fail, $3: detail
  if [ "$2" -eq 0 ]; then PASS=$((PASS+1)); printf '  [PASS] %s — %s\n' "$1" "$3";
  else                  FAIL=$((FAIL+1)); printf '  [FAIL] %s — %s\n' "$1" "$3"; fi
}

printf 'Restore drill report\n'
printf '  dump:     %s\n' "$DUMP"
printf '  manifest: %s\n' "$MANIFEST"
printf '  target:   %s@%s:%s/%s (scratch)\n' "$SRV_USER" "$SRV_HOST" "$SRV_PORT" "$DRILL_DB"
printf '  started:  %s\n\n' "$TS"

# ------------------------------------------------- 1. recreate scratch DB

log "dropping/recreating scratch database '$DRILL_DB'..."
# Quote the identifier; the name is validated above (no prod pattern, not the
# source db). Double any embedded double-quotes defensively.
SAFE_DB="$(printf '%s' "$DRILL_DB" | sed 's/"/""/g')"
psql "${MAINT_CONN[@]}" -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS \"$SAFE_DB\";" \
  -c "CREATE DATABASE \"$SAFE_DB\";" >/dev/null
log "scratch database ready"

# ------------------------------------------------- 2. restore

log "pg_restore -> $DRILL_DB ..."
if pg_restore "${RESTORE_CONN[@]}" "$DUMP" >/tmp/pg_restore_drill.log 2>&1; then
  check "pg_restore completes" 0 "dump restored into $DRILL_DB"
else
  rc=$?
  tail -n 20 /tmp/pg_restore_drill.log >&2
  check "pg_restore completes" 1 "pg_restore exited $rc (see above)"
  printf '\nRESULT: FAIL (%d passed, %d failed)\n' "$PASS" "$FAIL"
  printf 'report: %s\n' "$REPORT"
  exit 1
fi

# ------------------------------------------------- 3. row counts vs manifest

log "comparing row counts against manifest..."
COUNT_DIFF="$(psql "${DRILL_CONN[@]}" -tAX -F$'\t' <<'SQL'
select 'ledger_entries',       count(*) from ledger_entries       union all
select 'adjustments',          count(*) from adjustments          union all
select 'conversions',          count(*) from conversions          union all
select 'clicks',               count(*) from clicks               union all
select 'links',                count(*) from links                union all
select 'publishers',           count(*) from publishers           union all
select 'merchants',            count(*) from merchants            union all
select 'payout_batches',       count(*) from payout_batches       union all
select 'payout_items',         count(*) from payout_items         union all
select 'merchant_settlements', count(*) from merchant_settlements;
SQL
)"
export COUNT_DIFF
if python3 - "$MANIFEST" <<'PYEOF'
import json, os, sys
with open(sys.argv[1]) as f:
    manifest = json.load(f)
expected = manifest.get("row_counts", {})
actual = {}
for line in os.environ["COUNT_DIFF"].splitlines():
    line = line.strip()
    if not line:
        continue
    table, n = line.split("\t", 1)
    actual[table] = int(n)
ok = True
for table in sorted(set(expected) | set(actual)):
    e, a = expected.get(table), actual.get(table)
    status = "PASS" if (e is not None and a is not None and e == a) else "FAIL"
    if status == "FAIL":
        ok = False
    print(f"  [{status}] row count {table}: manifest={e} restored={a}")
sys.exit(0 if ok else 1)
PYEOF
then check "row counts match manifest" 0 "all tables agree"; else check "row counts match manifest" 1 "see per-table lines above"; fi

# ------------------------------------------------- 4. ledger balance check
# Double-entry invariant: per currency, total debits == total credits.
# Mirrors checkBooksBalanced() in packages/shared/src/ledger.ts. Amounts are
# integer minor units (paise); the comparison is exact integer math.

log "checking ledger double-entry invariant (per currency)..."
BALANCE_TSV="$(psql "${DRILL_CONN[@]}" -tAX -F$'\t' \
  -c "select currency, coalesce(sum(debit_minor),0), coalesce(sum(credit_minor),0) from ledger_entries group by currency order by currency;")"
export BALANCE_TSV
if python3 - <<'PYEOF'
import os, sys
rows = [l for l in os.environ.get("BALANCE_TSV", "").splitlines() if l.strip()]
if not rows:
    print("  [PASS] ledger balance: ledger_entries is empty — trivially balanced")
    sys.exit(0)
ok = True
for line in rows:
    currency, d, c = line.split("\t")
    status = "PASS" if int(d) == int(c) else "FAIL"
    if status == "FAIL":
        ok = False
    print(f"  [{status}] ledger nets to zero: currency={currency} debits={d} credits={c}")
sys.exit(0 if ok else 1)
PYEOF
then check "ledger balances per currency" 0 "sum(debit_minor)=sum(credit_minor) for every currency"; else check "ledger balances per currency" 1 "see per-currency lines above"; fi

# ------------------------------------------------- verdict

printf '\nRESULT: %s (%d passed, %d failed)\n' "$([ $FAIL -eq 0 ] && echo PASS || echo FAIL)" "$PASS" "$FAIL"
printf 'report: %s\n' "$REPORT"
[ $FAIL -eq 0 ]
