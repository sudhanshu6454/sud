#!/usr/bin/env bash
# Afflino single-host restore, from a backup.sh dump (afflino-*.sql.gz).
#
#   bash /opt/afflino/affiliate/deploy/linode/restore.sh
#       The restore CHECK (safe, the default): the newest dump in
#       /var/backups/afflino is restored into a scratch database
#       (afflino_restore_check) in the same postgres container, checked
#       (migrations recorded, tables present, row counts, the ledger balanced
#       per currency, debits = credits in integer minor units), and dropped.
#       The live database is not touched. Pass a dump file to check that one.
#
#   bash /opt/afflino/affiliate/deploy/linode/restore.sh --replace-live
#       REPLACES the live database with the newest dump (or the file given
#       after the flag). Asks you to type REPLACE on the terminal, takes a
#       pre-restore backup first, stops api, redirect, workers and web (the
#       edge stays up and answers 502 meanwhile), recreates the database from
#       the dump, and starts them again. Everything written after the dump was
#       taken is lost: use it for a lost or corrupted database, not to undo a
#       release (docs/runbooks/deploy.md §2 and §3).
#
# Settings (the installer's defaults): AFFLINO_PROJECT=afflino,
# AFFLINO_BACKUP_DIR=/var/backups/afflino. No password is needed or printed.

set -Eeuo pipefail

main() {
  local project="${AFFLINO_PROJECT:-afflino}"
  local dir="${AFFLINO_BACKUP_DIR:-/var/backups/afflino}"
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local scratch="afflino_restore_check"

  log() { printf '[afflino-restore] %s\n' "$*"; }
  die() { printf '[afflino-restore] ERROR: %s\n' "$*" >&2; exit 1; }

  local mode=check file=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --replace-live) mode=replace ;;
      -h|--help) sed -n '2,23p' "${BASH_SOURCE[0]}"; exit 0 ;;
      -*) die "unknown option $1" ;;
      *) file="$1" ;;
    esac
    shift
  done
  if [ -z "$file" ]; then
    local all=()
    shopt -s nullglob
    all=("$dir"/afflino-*.sql.gz)
    shopt -u nullglob
    [ "${#all[@]}" -gt 0 ] || die "no afflino-*.sql.gz in $dir (take one: bash $here/backup.sh manual)"
    file="${all[${#all[@]}-1]}"
  fi
  [ -f "$file" ] || die "not a file: $file"
  gzip -t "$file" || die "$file does not verify as gzip"
  gzip -dc "$file" | tail -n 5 | grep -q 'PostgreSQL database dump complete' || die "$file is not a complete pg_dump"

  # cid and ids are global (not local): the EXIT traps below still need them
  # after an error unwinds main.
  cid="$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=postgres --filter status=running | head -n 1)"
  [ -n "$cid" ] || die "the postgres container of compose project '$project' is not running"

  # psql inside the container as the database owner; $1 = database, rest = psql args.
  pg() { local db="$1"; shift; docker exec -i -e PGDB="$db" -e PGOPTIONS="-c client_min_messages=warning" "$cid" sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 --no-password -U "$POSTGRES_USER" -d "$PGDB" "$@"' psql "$@"; }
  local live
  live="$(docker exec "$cid" sh -c 'printf %s "$POSTGRES_DB"')"
  [ "$live" != "$scratch" ] || die "the live database is named $scratch; refusing"

  if [ "$mode" = check ]; then
    log "checking $file in the scratch database $scratch (the live database $live is not touched)"
    pg postgres -c "DROP DATABASE IF EXISTS $scratch" -c "CREATE DATABASE $scratch" >/dev/null
    trap 'pg postgres -c "DROP DATABASE IF EXISTS '"$scratch"'" >/dev/null 2>&1 || true' EXIT
    gzip -dc "$file" | pg "$scratch" >/dev/null
    local migrations tables balance fails=0
    migrations="$(pg "$scratch" -tAc 'select count(*) from schema_migrations')"
    tables="$(pg "$scratch" -tAc "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")"
    log "restored: $migrations migration(s) recorded, $tables tables"
    [ "$migrations" -ge 1 ] || { log "FAIL: no migration recorded"; fails=$((fails + 1)); }
    local t n
    for t in organisations publishers properties placements programmes offers links clicks conversions ledger_entries payout_batches audit_log; do
      n="$(pg "$scratch" -tAc "select count(*) from $t" 2>/dev/null || echo 'missing')"
      log "  $t: $n"
      [ "$n" != missing ] || fails=$((fails + 1))
    done
    balance="$(pg "$scratch" -tA -F ' ' -c 'select currency, coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0) from ledger_entries group by currency order by currency')"
    if [ -z "$balance" ]; then
      log "ledger: no entries (balanced trivially)"
    else
      local cur d c
      while read -r cur d c; do
        if [ "$d" = "$c" ]; then log "ledger $cur: debits $d = credits $c"; else log "FAIL: ledger $cur: debits $d != credits $c"; fails=$((fails + 1)); fi
      done <<<"$balance"
    fi
    pg postgres -c "DROP DATABASE IF EXISTS $scratch" >/dev/null
    trap - EXIT
    if [ "$fails" -eq 0 ]; then log "RESULT: PASS ($file restores; scratch database dropped)"; else die "RESULT: FAIL ($fails check(s) above)"; fi
    return 0
  fi

  # ---- replace the live database
  { : </dev/tty; } 2>/dev/null || die "--replace-live needs a terminal to confirm"
  printf '\nThis REPLACES the live database "%s" with\n  %s\nEverything written after that dump was taken is lost.\nType REPLACE to continue: ' "$live" "$file" >/dev/tty
  local answer=""
  IFS= read -r answer </dev/tty || true
  [ "$answer" = REPLACE ] || die "not confirmed; nothing changed"

  AFFLINO_PROJECT="$project" AFFLINO_BACKUP_DIR="$dir" bash "$here/backup.sh" pre-restore
  local svc id
  ids=()
  for svc in web api redirect workers; do
    id="$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$svc" | head -n 1)"
    [ -n "$id" ] && ids+=("$id")
  done
  if [ "${#ids[@]}" -gt 0 ]; then
    log "stopping web, api, redirect and workers"
    docker stop "${ids[@]}" >/dev/null
  fi
  start_again() {
    if [ "${#ids[@]}" -gt 0 ]; then
      local i
      # Reverse order: workers, redirect, api, web.
      for ((i = ${#ids[@]} - 1; i >= 0; i--)); do docker start "${ids[$i]}" >/dev/null || true; done
      log "started them again"
    fi
  }
  trap start_again EXIT
  log "recreating $live from $file"
  pg postgres -c "DROP DATABASE IF EXISTS \"$live\" WITH (FORCE)" -c "CREATE DATABASE \"$live\"" >/dev/null
  gzip -dc "$file" | pg "$live" >/dev/null
  log "restored: $(pg "$live" -tAc 'select count(*) from schema_migrations') migration(s) recorded"
  start_again
  trap - EXIT
  log "done. Check: curl -s http://127.0.0.1:3000/healthz; curl -s http://127.0.0.1:3001/healthz; curl -s http://127.0.0.1:3002/api/healthz"
}

main "$@"; exit
