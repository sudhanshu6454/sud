#!/usr/bin/env bash
# Afflino single-host database backup: pg_dump INSIDE the postgres container
# (the server has no Postgres client and the database no published port),
# gzip, 0600, into /var/backups/afflino; the 14 newest of each kind are kept.
#
#   bash /opt/afflino/affiliate/deploy/linode/backup.sh manual
#
# Kinds (the argument, default daily): daily (the systemd timer the installer
# sets up, afflino-backup.timer, 02:30 UTC), pre-update (the installer, before
# an update that changes something), pre-restore (restore.sh --replace-live),
# manual. File: afflino-<UTC timestamp>-<kind>.sql.gz, a plain SQL dump
# (restore.sh restores it; zcat shows it). The dump is checked (gzip -t and
# pg_dump's closing line) before it is kept.
#
# A dump on the server's own disk is not a backup on its own: copy the files
# off the server too, or turn on Linode Backups (docs/runbooks/deploy.md §5).
#
# Settings (the installer's defaults): AFFLINO_PROJECT=afflino (compose
# project), AFFLINO_BACKUP_DIR=/var/backups/afflino, AFFLINO_BACKUP_KEEP=14.
# No password is needed or printed: pg_dump runs as the database owner over
# the container's local socket.

set -Eeuo pipefail

main() {
  local project="${AFFLINO_PROJECT:-afflino}"
  local dir="${AFFLINO_BACKUP_DIR:-/var/backups/afflino}"
  local keep="${AFFLINO_BACKUP_KEEP:-14}"
  local kind="${1:-daily}"

  log() { printf '[afflino-backup] %s\n' "$*"; }
  die() { printf '[afflino-backup] ERROR: %s\n' "$*" >&2; exit 1; }

  case "$kind" in daily|pre-update|pre-restore|manual) ;; *) die "unknown kind '$kind' (daily, pre-update, pre-restore or manual)" ;; esac
  case "$keep" in ''|*[!0-9]*) die "AFFLINO_BACKUP_KEEP must be a number" ;; esac
  [ "$keep" -ge 1 ] || die "AFFLINO_BACKUP_KEEP must be at least 1"
  command -v docker >/dev/null 2>&1 || die "docker not found"

  local cid
  cid="$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=postgres --filter status=running | head -n 1)"
  [ -n "$cid" ] || die "the postgres container of compose project '$project' is not running"

  umask 077
  install -d -m 0700 "$dir"
  local ts out
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  out="$dir/afflino-$ts-$kind.sql.gz"
  # Global (not local): the EXIT trap still needs it after an error unwinds main.
  tmp="$dir/.afflino-$ts-$kind.sql.gz.partial"
  trap 'rm -f "$tmp"' EXIT

  docker exec "$cid" sh -c 'exec pg_dump --no-password -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip -6 >"$tmp" \
    || die "pg_dump failed (its error is above); nothing kept"
  gzip -t "$tmp" || die "the compressed dump does not verify; nothing kept"
  gzip -dc "$tmp" | tail -n 5 | grep -q 'PostgreSQL database dump complete' \
    || die "the dump is incomplete (no closing line); nothing kept"
  chmod 600 "$tmp"
  mv -f "$tmp" "$out"
  trap - EXIT

  local bytes
  bytes="$(wc -c <"$out" | tr -d ' ')"
  log "wrote $out ($bytes bytes, verified)"

  # Keep the newest $keep of this kind (names sort by time).
  local files=() n i
  shopt -s nullglob
  files=("$dir"/afflino-*-"$kind".sql.gz)
  shopt -u nullglob
  n="${#files[@]}"
  if [ "$n" -gt "$keep" ]; then
    for ((i = 0; i < n - keep; i++)); do
      rm -f -- "${files[$i]}"
      log "removed ${files[$i]} (keeping the newest $keep $kind backups)"
    done
  fi
}

main "$@"; exit
