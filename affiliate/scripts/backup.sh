#!/usr/bin/env bash
#
# Paparazzi Affiliate Commerce Platform — database backup.
#
# Takes a pg_dump custom-format (-Fc) backup of the platform Postgres database,
# verifies the dump immediately (pg_restore --list), records its SHA-256
# digest, and writes a JSON manifest (timestamp, DB name, PG version, digest,
# row counts of key tables) alongside the dump.
#
# Usage:
#   scripts/backup.sh
#
# Connection — first match wins:
#   1. DATABASE_URL
#   2. PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
#      Defaults match docker-compose.yml: host=localhost, port=5432,
#      user=paparazzi, db=paparazzi. There is NO default password — supply
#      PGPASSWORD, ~/.pgpass, or put the password in DATABASE_URL.
#
# Output:
#   ${BACKUP_DIR:-./backups}/paparazzi-<db>-<UTC timestamp>.dump
#   ${BACKUP_DIR:-./backups}/paparazzi-<db>-<UTC timestamp>.manifest.json
#
# Sandbox safety:
#   The script REFUSES to run when the target host or database name looks
#   production-like (case-insensitive match on: prod, prd, production, live),
#   unless you explicitly opt in with PAPARAZZI_ALLOW_PROD=yes.
#   See docs/runbooks/backup-restore.md.
#
# Exit codes: 0 only when dump + verification + manifest all complete.
# Any failure aborts (set -euo pipefail) with a non-zero status.

set -euo pipefail

log()  { printf '[backup] %s\n' "$*" >&2; }
die()  { printf '[backup] ERROR: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- prerequisites

for bin in pg_dump pg_restore psql date; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin not found on PATH (need PostgreSQL client tools)"
done
# Portable SHA-256 (sha256sum on Linux, shasum on macOS).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "no SHA-256 tool found (need sha256sum or shasum)"
  fi
}

# ------------------------------------------------- connection resolution
# We keep ONE canonical connection target: CONN (either a URL or a db name
# passed with -h/-p/-U flags). The password is never interpolated into argv
# or logs — libpq picks it up from PGPASSWORD / ~/.pgpass / the URL.

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
redact_url() { # strip the password segment for safe logging
  printf '%s' "$1" | sed -E 's#(://[^:/@]+:)[^@]+@#\1***@#'
}
looks_like_prod() { # $1: text to test — exit 0 when production-like
  printf '%s' "$1" | grep -Eiq "$PROD_PATTERN"
}

if [ -n "${DATABASE_URL:-}" ]; then
  parse_pg_url "$DATABASE_URL"
  CONN=("$DATABASE_URL")
  DB_NAME="$_U_DB"
  DB_HOST="$_U_HOST"
  DB_PORT="$_U_PORT"
  DB_USER="$_U_USER"
  log "using DATABASE_URL ($(redact_url "$DATABASE_URL"))"
else
  DB_NAME="${PGDATABASE:-paparazzi}"
  DB_HOST="${PGHOST:-localhost}"
  DB_PORT="${PGPORT:-5432}"
  DB_USER="${PGUSER:-paparazzi}"
  CONN=(-h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME")
  log "using PG* vars: user=$DB_USER host=$DB_HOST port=$DB_PORT db=$DB_NAME"
fi

[ -n "$DB_NAME" ] || die "could not determine database name (check DATABASE_URL or PGDATABASE)"

# ------------------------------------------------- production safety gate

if looks_like_prod "$DB_NAME" || looks_like_prod "$DB_HOST"; then
  if [ "${PAPARAZZI_ALLOW_PROD:-}" = "yes" ]; then
    log "WARNING: target looks production-like (db='$DB_NAME' host='$DB_HOST'); proceeding because PAPARAZZI_ALLOW_PROD=yes"
  else
    die "target looks production-like (db='$DB_NAME' host='$DB_HOST'). Refusing to back up what may be production from a sandbox script. If this is intentional, re-run with PAPARAZZI_ALLOW_PROD=yes"
  fi
fi

# ------------------------------------------------- output files

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="paparazzi-${DB_NAME}-${TS}"
DUMP="${BACKUP_DIR}/${BASE}.dump"
MANIFEST="${BACKUP_DIR}/${BASE}.manifest.json"

log "pg_dump (custom format) -> $DUMP"
pg_dump -Fc "${CONN[@]}" -f "$DUMP"

# ------------------------------------------------- immediate verification
# 1) The dump's table of contents must parse — a truncated/corrupt dump
#    fails here, before we ever record a manifest for it.

log "verifying dump (pg_restore --list)..."
pg_restore --list "$DUMP" >/dev/null
log "dump TOC parses cleanly"

# 2) Record the digest *after* verification so the manifest can only ever
#    describe a dump that passed the TOC check.

SHA256="$(sha256_of "$DUMP")"
BYTES="$(wc -c <"$DUMP" | tr -d ' ')"
log "sha256: $SHA256 ($BYTES bytes)"

# ------------------------------------------------- manifest data

PG_VERSION="$(psql "${CONN[@]}" -tAX -c 'select version();')"
log "server: $PG_VERSION"

# Key tables for the manifest row counts: money-critical tables first,
# then the high-volume tracking tables the money is derived from.
KEY_TABLES="ledger_entries adjustments conversions clicks links publishers merchants payout_batches payout_items merchant_settlements"

log "collecting row counts..."
COUNTS_TSV="$(mktemp)"
trap 'rm -f "$COUNTS_TSV"' EXIT
for t in $KEY_TABLES; do
  n="$(psql "${CONN[@]}" -tAX -c "select count(*) from \"$t\";")"
  printf '%s\t%s\n' "$t" "$n" >>"$COUNTS_TSV"
  log "  $t: $n"
done

log "writing manifest -> $MANIFEST"
if command -v python3 >/dev/null 2>&1; then
  python3 - "$MANIFEST" "$TS" "$DB_NAME" "$DB_HOST" "$DB_PORT" "$DB_USER" \
          "$PG_VERSION" "$BASE.dump" "$SHA256" "$BYTES" "$COUNTS_TSV" <<'PYEOF'
import json, sys
_, manifest, ts, db, host, port, user, pgver, dumpfile, sha, size, tsv = sys.argv
counts = {}
with open(tsv) as f:
    for line in f:
        line = line.rstrip("\n")
        if not line:
            continue
        table, n = line.split("\t", 1)
        counts[table] = int(n)
doc = {
    "generated_by": "scripts/backup.sh",
    "timestamp_utc": ts,
    "db_name": db,
    "host": host,
    "port": int(port),
    "user": user,
    "pg_version": pgver,
    "dump_file": dumpfile,
    "sha256": sha,
    "bytes": int(size),
    "row_counts": counts,
}
with open(manifest, "w") as f:
    json.dump(doc, f, indent=2)
    f.write("\n")
PYEOF
else
  # Fallback when python3 is unavailable: hand-rolled JSON. Values are
  # tool-controlled (db/host names), so escaping needs are minimal, but we
  # still guard quotes/backslashes.
  json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
  {
    printf '{\n'
    printf '  "generated_by": "scripts/backup.sh",\n'
    printf '  "timestamp_utc": "%s",\n' "$TS"
    printf '  "db_name": "%s",\n' "$(json_escape "$DB_NAME")"
    printf '  "host": "%s",\n' "$(json_escape "$DB_HOST")"
    printf '  "port": %s,\n' "$DB_PORT"
    printf '  "user": "%s",\n' "$(json_escape "$DB_USER")"
    printf '  "pg_version": "%s",\n' "$(json_escape "$PG_VERSION")"
    printf '  "dump_file": "%s",\n' "$BASE.dump"
    printf '  "sha256": "%s",\n' "$SHA256"
    printf '  "bytes": %s,\n' "$BYTES"
    printf '  "row_counts": {'
    first=1
    while IFS=$'\t' read -r table n; do
      [ $first -eq 1 ] || printf ','
      printf '\n    "%s": %s' "$table" "$n"
      first=0
    done <"$COUNTS_TSV"
    printf '\n  }\n}\n'
  } >"$MANIFEST"
fi

log "done: $DUMP"
log "manifest: $MANIFEST"
