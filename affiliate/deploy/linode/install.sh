#!/usr/bin/env bash
# Afflino (afflino.com): install or update on the owner's Linode, one command.
#
# Run as root on a fresh Ubuntu 24.04 / 22.04 or Debian 12 Linode dedicated to
# Afflino:
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)
#
# The first run installs; every later run of the same line updates (it is
# idempotent). What it does, in order:
#   1. Preflight: root; a supported OS; a server of its own (refuses a
#      machine that already runs other Docker compose projects, and ports
#      80/443 held by anything but Afflino's edge); warns under 2 GB of RAM
#      and adds a 2 GB swapfile under 4 GB of RAM when there is less than
#      1 GB of swap (the web image build needs the memory; Linode images
#      ship a 512 MB swap disk).
#   2. System: apt packages, Docker (get.docker.com, only when missing),
#      ufw (OpenSSH first, then 80/tcp, 443/tcp, 443/udp), fail2ban (sshd),
#      unattended security upgrades.
#   3. Code: clones branch claude/nifty-pasteur-flrulw of the public
#      repository into /opt/afflino (sparse: affiliate/ only), or fetches and
#      fast-forwards it, keeping the release that ran before as the git tag
#      afflino-previous (the rollback point, docs/runbooks/deploy.md §3);
#      stops if the checkout has local changes. Then the rest of the run is
#      the checkout's own copy of this script (the line above runs whatever
#      raw.githubusercontent.com served, which can lag a push by minutes).
#   4. Environment: /etc/afflino/afflino.env (root:root, 0600, outside the
#      checkout). The first run generates every secret with openssl and never
#      prints one; the only question is the optional ACME_EMAIL. Later runs
#      keep every value and only add keys that are missing. SITE_INDEXING=off.
#   5. Deploy: docker compose (project afflino, docker-compose.prod.yml +
#      docker-compose.single-host.yml): build the images, run the migrations
#      on their own (a failure stops here, the running services untouched),
#      then up -d --remove-orphans; waits for api, redirect and web to be
#      healthy, restarts the edge if its Caddyfile changed, and prints the
#      status: the server's addresses, whether afflino.com and
#      www.afflino.com resolve here, the DNS records to set if not, and how
#      to watch the certificates arrive.
#   6. Backups: a daily systemd timer (02:30 UTC) running backup.sh next to
#      this file (pg_dump inside the postgres container, gzip, 0600, the 14
#      newest kept, /var/backups/afflino), plus one backup before an update
#      that changed the code or the environment file.
#
# Nothing here prints a secret, puts one on a command line or in a log.
# docs/runbooks/deploy.md is the full procedure (DNS, checks, rollback).
#
# TEST-ONLY toggles (for rehearsing this script on a machine that is not the
# Linode; never needed there):
#   AFFLINO_SKIP_SYSTEM=1          skip step 2, the swapfile and the backup timer
#   AFFLINO_SKIP_DOCKER_INSTALL=1  skip installing / enabling Docker
#   AFFLINO_SKIP_FIREWALL=1        skip ufw
#   AFFLINO_SKIP_SWAP=1            skip the swapfile
#   AFFLINO_SKIP_GIT=1             use the checkout as it is (no clone / fetch)
#   AFFLINO_STOP_AFTER=preflight|system|code|env   stop after that step
#   AFFLINO_DIR=/opt/afflino       the checkout (the repository root)
#   AFFLINO_ENV_FILE=/etc/afflino/afflino.env
#   AFFLINO_PROJECT=afflino        compose project name
#   AFFLINO_BACKUP_DIR=/var/backups/afflino
#   AFFLINO_EDGE_TEST=1            edge in plain-HTTP test mode on 127.0.0.1:8088
#                                  (docker-compose.edge-test.yml): no ports 80/443,
#                                  no certificates
#   AFFLINO_EXTRA_COMPOSE_FILE=f   one more compose file, added last
#   AFFLINO_ALLOW_OTHER_STACKS=1   run beside other Docker compose projects
#                                  (a sandbox that hosts other stacks)
#   AFFLINO_PUBLIC_IPV4 / AFFLINO_PUBLIC_IPV6   the addresses to report, instead
#                                  of the ones found on the interfaces
#   <KEY>=<value>                  any variable of .env.prod.example preset in the
#                                  environment is written instead of generated /
#                                  asked, when the environment file lacks it
#                                  (ACME_EMAIL= set but empty = no prompt)
#
# The whole script is one function called on the last line, so a git update
# that rewrites this file while it runs cannot change what runs.

set -Eeuo pipefail

main() {
  local REPO_URL="https://github.com/sudhanshu6454/sud.git"
  local BRANCH="claude/nifty-pasteur-flrulw"
  local RAW_INSTALL="https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/${BRANCH}/affiliate/deploy/linode/install.sh"

  local DIR="${AFFLINO_DIR:-/opt/afflino}"
  local ENV_FILE="${AFFLINO_ENV_FILE:-/etc/afflino/afflino.env}"
  local PROJECT="${AFFLINO_PROJECT:-afflino}"
  local BACKUPS="${AFFLINO_BACKUP_DIR:-/var/backups/afflino}"
  local SKIP_SYSTEM="${AFFLINO_SKIP_SYSTEM:-}"
  local SKIP_DOCKER_INSTALL="${AFFLINO_SKIP_DOCKER_INSTALL:-}"
  local SKIP_FIREWALL="${AFFLINO_SKIP_FIREWALL:-}"
  local SKIP_SWAP="${AFFLINO_SKIP_SWAP:-}"
  local SKIP_GIT="${AFFLINO_SKIP_GIT:-}"
  local STOP_AFTER="${AFFLINO_STOP_AFTER:-}"
  local EDGE_TEST="${AFFLINO_EDGE_TEST:-}"
  local EXTRA_COMPOSE="${AFFLINO_EXTRA_COMPOSE_FILE:-}"
  local APP="$DIR/affiliate"
  local SELF="${BASH_SOURCE[0]:-$0}"

  local STARTED_AT
  STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # ----------------------------------------------------------------- helpers
  say()  { printf '\n== %s\n' "$*"; }
  info() { printf '   %s\n' "$*"; }
  warn() { printf '   WARNING: %s\n' "$*" >&2; }
  die()  { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }
  # shellcheck disable=SC2317,SC2329 # called by the ERR trap below
  on_error() {
    local rc="$1" line="$2"
    printf '\nSTOPPED: install.sh failed at line %s (exit %s). Nothing secret was printed; re-running is safe.\n' "$line" "$rc" >&2
    exit "$rc"
  }
  trap 'on_error "$?" "$LINENO"' ERR
  have() { command -v "$1" >/dev/null 2>&1; }
  is_on() { case "${1:-}" in 1|yes|true|on) return 0 ;; *) return 1 ;; esac; }
  has_systemd() { [ -d /run/systemd/system ] && have systemctl; }
  tty_ok() { { : </dev/tty; } 2>/dev/null; }
  stop_after() {
    if [ "$STOP_AFTER" = "$1" ]; then
      say "Stopping after step '$1' (AFFLINO_STOP_AFTER, test only)"
      exit 0
    fi
  }
  # Write $2 to file $1 only when the content differs; returns 0 when written.
  write_if_changed() {
    local path="$1" content="$2"
    if [ -f "$path" ] && [ "$(cat "$path")" = "$content" ]; then return 1; fi
    printf '%s\n' "$content" >"$path"
    return 0
  }

  # A listener on TCP port $2 of address $1 (0.0.0.0 = any address)?
  # Prints what holds it when ss can say.
  port_busy() {
    local addr="$1" port="$2" proto="${3:-tcp}" out=""
    if have ss; then
      if [ "$proto" = udp ]; then out="$(ss -Hlunp "sport = :$port" 2>/dev/null || true)"
      else out="$(ss -Hltnp "sport = :$port" 2>/dev/null || true)"; fi
      if [ "$addr" != 0.0.0.0 ] && [ -n "$out" ]; then
        # Only listeners that cover $addr: the address itself or a wildcard.
        out="$(printf '%s\n' "$out" | awk -v a="$addr:$port" -v p=":$port" '$4==a || $4=="0.0.0.0"p || $4=="*"p || $4=="[::]"p || $4=="[::ffff:"a"]"' || true)"
      fi
      [ -n "$out" ] && { printf '%s\n' "$out"; return 0; }
      return 1
    fi
    if have python3; then
      local bind="$addr"; [ "$bind" = 0.0.0.0 ] && bind=""
      if ! python3 - "$bind" "$port" "$proto" <<'PY' 2>/dev/null; then
import socket, sys
host, port, proto = sys.argv[1], int(sys.argv[2]), sys.argv[3]
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM if proto == "udp" else socket.SOCK_STREAM)
if proto != "udp":
    # Connections that just closed (TIME_WAIT) must not count as a
    # listener; a real listener still refuses the bind.
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind((host, port))
finally:
    s.close()
PY
        printf '(port %s/%s is in use; install iproute2 to see by what)\n' "$port" "$proto"
        return 0
      fi
      return 1
    fi
    # Last resort (no ss, no python3): a TCP connect to loopback.
    if [ "$proto" = tcp ] && (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      printf '(something answers on 127.0.0.1:%s)\n' "$port"
      return 0
    fi
    return 1
  }

  # Public addresses from the interfaces (no third-party lookup).
  public_ipv4() {
    if [ -n "${AFFLINO_PUBLIC_IPV4:-}" ]; then printf '%s\n' "$AFFLINO_PUBLIC_IPV4"; return; fi
    local list=""
    if have ip; then
      list="$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|br-|veth)/ {split($4, a, "/"); print a[1]}')"
    elif have hostname; then
      list="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' || true)"
    fi
    printf '%s\n' "$list" | grep -Ev '^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)' | grep -E '^[0-9]' | head -n 1 || true
  }
  public_ipv6() {
    if [ -n "${AFFLINO_PUBLIC_IPV6:-}" ]; then printf '%s\n' "$AFFLINO_PUBLIC_IPV6"; return; fi
    have ip || return 0
    ip -6 -o addr show scope global 2>/dev/null \
      | awk '$2 !~ /^(docker|br-|veth)/ && $0 !~ /temporary|deprecated|tentative/ {split($4, a, "/"); print a[1]}' \
      | grep -Evi '^f[cd]' | head -n 1 || true
  }

  # Env-file access (KEY=VALUE lines; the last occurrence wins, as in compose).
  env_has() { [ -f "$ENV_FILE" ] && grep -Eq "^[[:space:]]*$1=" "$ENV_FILE"; }
  env_get() {
    [ -f "$ENV_FILE" ] || return 0
    local line v
    line="$(grep -E "^[[:space:]]*$1=" "$ENV_FILE" | tail -n 1 || true)"
    v="${line#*=}"
    case "$v" in \"*\") v="${v#\"}"; v="${v%\"}" ;; \'*\') v="${v#\'}"; v="${v%\'}" ;; esac
    printf '%s' "$v"
  }

  # ================================================================ 1. preflight
  say "Afflino installer ($STARTED_AT)"
  [ "$(id -u)" -eq 0 ] || die "run this as root: log in to the Linode as root (or run sudo -i first), then run the line again."

  local OS_ID="" OS_VER="" OS_NAME=""
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    OS_ID="$(. /etc/os-release && printf '%s' "${ID:-}")"
    # shellcheck disable=SC1091
    OS_VER="$(. /etc/os-release && printf '%s' "${VERSION_ID:-}")"
    # shellcheck disable=SC1091
    OS_NAME="$(. /etc/os-release && printf '%s' "${PRETTY_NAME:-}")"
  fi
  case "$OS_ID:$OS_VER" in
    ubuntu:24.04|ubuntu:22.04|debian:12) info "OS: $OS_NAME" ;;
    *) die "unsupported OS '${OS_NAME:-unknown}'. Afflino's installer supports Ubuntu 24.04 (recommended), Ubuntu 22.04 and Debian 12. Rebuild the Linode with Ubuntu 24.04 LTS." ;;
  esac

  # A server of its own: no Docker compose project here but Afflino's.
  local ours="" others=""
  if have docker && docker info >/dev/null 2>&1; then
    ours="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null | head -n 1)"
    others="$(docker ps -a --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | sort -u | grep -vx -e '' -e "$PROJECT" | tr '\n' ' ' || true)"
    others="${others% }"
  fi
  if [ -n "$others" ]; then
    if is_on "${AFFLINO_ALLOW_OTHER_STACKS:-}"; then
      warn "other Docker compose projects on this machine ($others): allowed by AFFLINO_ALLOW_OTHER_STACKS (test only)"
    else
      die "this server already runs other Docker stacks (compose projects: $others). Afflino needs a Linode of its own: its edge takes ports 80 and 443, and this installer sets the firewall, fail2ban, kernel settings and swap for the whole server. Nothing was changed. Create a fresh Linode (Ubuntu 24.04 LTS) and run the line there."
    fi
  fi

  # Ports: free, or already Afflino's own (the project's containers exist).
  if [ -n "$ours" ]; then
    info "Afflino's stack ($PROJECT) is already running here: this run is an update."
  else
    local held="" p busy
    if is_on "$EDGE_TEST"; then
      busy="$(port_busy 127.0.0.1 8088 || true)"; [ -n "$busy" ] && held="$held"$'\n'"  8088/tcp: $busy"
    else
      for p in 80 443; do
        busy="$(port_busy 0.0.0.0 "$p" || true)"; [ -n "$busy" ] && held="$held"$'\n'"  $p/tcp: $busy"
      done
      busy="$(port_busy 0.0.0.0 443 udp || true)"; [ -n "$busy" ] && held="$held"$'\n'"  443/udp: $busy"
    fi
    for p in 3000 3001 3002; do
      busy="$(port_busy 127.0.0.1 "$p" || true)"; [ -n "$busy" ] && held="$held"$'\n'"  127.0.0.1:$p/tcp: $busy"
    done
    if [ -n "$held" ]; then
      die "ports Afflino needs are held by something that is not Afflino's stack:$held
Afflino needs this server to itself (its edge serves afflino.com on 80 and 443). Stop and disable whatever holds them, or use a fresh Linode."
    fi
  fi

  local mem_kb swap_kb mem_mb swap_mb
  mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
  swap_kb="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)"
  mem_mb=$((mem_kb / 1024)); swap_mb=$((swap_kb / 1024))
  info "memory: ${mem_mb} MiB RAM, ${swap_mb} MiB swap"
  if [ "$mem_mb" -lt 1792 ]; then
    warn "less than 2 GB of RAM: building the web image and running Postgres, Redis and five services may run out of memory. The recommended plan is Linode 4 GB (docs/capacity-plan.md: sizing for real traffic is unmeasured)."
  fi
  local avail_kb
  avail_kb="$(df -Pk /var/lib 2>/dev/null | awk 'NR==2 {print $4}')"
  if [ -n "$avail_kb" ] && [ "$avail_kb" -lt $((8 * 1024 * 1024)) ]; then
    warn "less than 8 GB free on /var/lib: the images, build cache and database need room."
  fi
  stop_after preflight

  # ================================================================ 2. system
  if is_on "$SKIP_SYSTEM"; then
    say "System setup skipped (AFFLINO_SKIP_SYSTEM, test only)"
  else
    say "System: packages, Docker, firewall, fail2ban, automatic security updates"
    export DEBIAN_FRONTEND=noninteractive
    local pkgs=(ca-certificates curl git ufw fail2ban python3-systemd unattended-upgrades openssl iproute2 python3 gzip)
    local missing=() pkg
    for pkg in "${pkgs[@]}"; do
      dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed' || missing+=("$pkg")
    done
    if [ "${#missing[@]}" -gt 0 ]; then
      info "installing: ${missing[*]}"
      apt-get update -q
      apt-get install -y -q --no-install-recommends "${missing[@]}"
    else
      info "packages already installed"
    fi

    # Automatic security updates (unattended-upgrades' own default policy).
    if write_if_changed /etc/apt/apt.conf.d/20auto-upgrades 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";'; then
      info "unattended-upgrades enabled (/etc/apt/apt.conf.d/20auto-upgrades)"
    fi

    # Docker, only when missing (get.docker.com also installs the compose plugin).
    if is_on "$SKIP_DOCKER_INSTALL"; then
      info "Docker install skipped (AFFLINO_SKIP_DOCKER_INSTALL, test only)"
    else
      if ! have docker; then
        info "installing Docker (get.docker.com)"
        local getdocker
        getdocker="$(mktemp)"
        curl -fsSL https://get.docker.com -o "$getdocker"
        sh "$getdocker"
        rm -f "$getdocker"
      fi
      if ! docker compose version >/dev/null 2>&1; then
        info "installing the Docker compose plugin"
        apt-get install -y -q docker-compose-plugin 2>/dev/null || apt-get install -y -q docker-compose-v2 \
          || die "Docker is installed but 'docker compose' is not, and neither docker-compose-plugin nor docker-compose-v2 installs. Install Docker from get.docker.com."
      fi
      if has_systemd; then systemctl enable --now docker >/dev/null 2>&1 || systemctl start docker; fi
      info "$(docker --version 2>/dev/null || echo 'docker: not reachable yet'); $(docker compose version 2>/dev/null || true)"
    fi

    # Firewall: SSH first, so the session running this is never cut off.
    if is_on "$SKIP_FIREWALL"; then
      info "ufw skipped (AFFLINO_SKIP_FIREWALL, test only)"
    else
      if ufw app info OpenSSH >/dev/null 2>&1; then ufw allow OpenSSH >/dev/null; else ufw allow 22/tcp >/dev/null; fi
      local sshport
      for sshport in $( (sshd -T 2>/dev/null || true) | awk '$1 == "port" {print $2}' | sort -u); do
        [ "$sshport" = 22 ] || ufw allow "$sshport/tcp" >/dev/null
      done
      ufw allow 80/tcp >/dev/null
      ufw allow 443/tcp >/dev/null
      ufw allow 443/udp >/dev/null
      if ! ufw status 2>/dev/null | grep -q '^Status: active'; then ufw --force enable >/dev/null; fi
      info "ufw: $(ufw status 2>/dev/null | head -n 1 | sed 's/^Status: //') (OpenSSH, 80/tcp, 443/tcp, 443/udp allowed; Docker's published ports bypass ufw, so only the edge listens publicly)"
    fi

    # fail2ban for sshd, reading the journal (works on Debian 12 without rsyslog).
    local jail_changed=""
    mkdir -p /etc/fail2ban/jail.d
    if write_if_changed /etc/fail2ban/jail.d/afflino-sshd.local '# Written by Afflino deploy/linode/install.sh
[sshd]
enabled = true
backend = systemd'; then jail_changed=1; fi
    if has_systemd; then
      systemctl enable fail2ban >/dev/null 2>&1 || true
      if [ -n "$jail_changed" ]; then systemctl restart fail2ban || true; else systemctl start fail2ban || true; fi
      if systemctl is-active --quiet fail2ban; then info "fail2ban: active (sshd jail)"; else warn "fail2ban did not start: journalctl -u fail2ban"; fi
    else
      warn "no systemd here: fail2ban and the backup timer are not enabled"
    fi

    # HTTP/3 (QUIC) wants larger UDP buffers than the kernel default.
    if write_if_changed /etc/sysctl.d/60-afflino-quic.conf '# Written by Afflino deploy/linode/install.sh: UDP buffers for the edge'"'"'s HTTP/3
net.core.rmem_max = 7500000
net.core.wmem_max = 7500000'; then
      sysctl -q -p /etc/sysctl.d/60-afflino-quic.conf >/dev/null 2>&1 || warn "could not apply /etc/sysctl.d/60-afflino-quic.conf now (it applies at boot)"
    fi
  fi

  # Swap: the web image build needs memory on small plans.
  if is_on "$SKIP_SYSTEM" || is_on "$SKIP_SWAP"; then
    :
  elif [ "$mem_mb" -lt 3584 ] && [ "$swap_mb" -lt 1024 ]; then
    if [ ! -f /swapfile-afflino ]; then
      info "adding a 2 GB swapfile (/swapfile-afflino): ${mem_mb} MiB RAM, ${swap_mb} MiB swap"
      fallocate -l 2G /swapfile-afflino 2>/dev/null || dd if=/dev/zero of=/swapfile-afflino bs=1M count=2048 status=none
      chmod 600 /swapfile-afflino
      mkswap /swapfile-afflino >/dev/null
    fi
    swapon --show=NAME --noheadings 2>/dev/null | grep -qx /swapfile-afflino || swapon /swapfile-afflino
    grep -q '^/swapfile-afflino ' /etc/fstab || printf '/swapfile-afflino none swap sw 0 0\n' >>/etc/fstab
  fi
  stop_after system

  # ================================================================ 3. code
  # head_now: the checkout when this pass started; head_before: when the
  # whole run started (the same, unless this pass is the re-executed one).
  local head_before="" head_after="" head_now=""
  if is_on "$SKIP_GIT"; then
    say "Code: using $DIR as it is (AFFLINO_SKIP_GIT, test only)"
    [ -f "$APP/docker-compose.prod.yml" ] || die "$APP/docker-compose.prod.yml not found (AFFLINO_DIR must be the repository root)."
  else
    say "Code: $REPO_URL, branch $BRANCH → $DIR"
    have git || die "git is not installed (the system step installs it)."
    if [ ! -e "$DIR" ]; then
      rm -rf "$DIR.partial"
      git clone --quiet --filter=blob:none --sparse --single-branch --branch "$BRANCH" "$REPO_URL" "$DIR.partial"
      git -C "$DIR.partial" sparse-checkout set affiliate
      mv "$DIR.partial" "$DIR"
      info "cloned (sparse checkout of affiliate/) at $(git -C "$DIR" rev-parse --short HEAD)"
    else
      git -C "$DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
        || die "$DIR exists but is not a git checkout. Move it away (it is not touched) and run the line again."
      local origin
      origin="$(git -C "$DIR" remote get-url origin 2>/dev/null || true)"
      case "${origin%.git}" in
        https://github.com/sudhanshu6454/sud|git@github.com:sudhanshu6454/sud|ssh://git@github.com/sudhanshu6454/sud) ;;
        *) die "$DIR is a checkout of '${origin:-no origin}', not of $REPO_URL. Move it away and run the line again." ;;
      esac
      local branch_now
      branch_now="$(git -C "$DIR" symbolic-ref --quiet --short HEAD 2>/dev/null || echo '(detached)')"
      if [ "$branch_now" != "$BRANCH" ]; then
        die "$DIR is on '$branch_now', not on $BRANCH (rolled back to afflino-previous, docs/runbooks/deploy.md §3?). Nothing was changed. To go back to the latest release: cd $DIR && git checkout $BRANCH && bash <(curl -fsSL $RAW_INSTALL)"
      fi
      if ! git -C "$DIR" diff --quiet || ! git -C "$DIR" diff --cached --quiet; then
        git -C "$DIR" status --short --untracked-files=no >&2
        die "$DIR has local changes (above). Nothing was discarded. Keep a copy of them elsewhere if you need them (settings belong in $ENV_FILE), then: cd $DIR && git stash && bash <(curl -fsSL $RAW_INSTALL)"
      fi
      local untracked
      untracked="$(git -C "$DIR" ls-files --others --exclude-standard | head -n 5)"
      [ -z "$untracked" ] || warn "untracked files in $DIR (kept, not touched): $(printf '%s ' "$untracked")"
      head_now="$(git -C "$DIR" rev-parse HEAD)"
      git -C "$DIR" fetch --quiet origin "$BRANCH"
      local remote
      remote="$(git -C "$DIR" rev-parse FETCH_HEAD)"
      if [ "$remote" = "$head_now" ]; then
        info "up to date at $(git -C "$DIR" rev-parse --short HEAD)"
      elif git -C "$DIR" merge-base --is-ancestor "$head_now" "$remote"; then
        # The release that ran until now is the rollback point (§3 of
        # docs/runbooks/deploy.md): a local tag, moved at every update.
        git -C "$DIR" tag -f afflino-previous "$head_now" >/dev/null
        local rec_dir
        rec_dir="$(dirname "$ENV_FILE")"
        install -d -m 0700 -o root -g root "$rec_dir"
        printf 'afflino-previous %s: the release that ran before the update of %s (docs/runbooks/deploy.md §3)\n' "$head_now" "$STARTED_AT" >"$rec_dir/previous-release"
        git -C "$DIR" merge --quiet --ff-only "$remote"
        info "updated $(git -C "$DIR" rev-parse --short "$head_now") → $(git -C "$DIR" rev-parse --short HEAD); the release before is kept as the git tag afflino-previous"
      else
        die "$DIR has commits that are not on origin/$BRANCH (or the branch was rewritten); a fast-forward is impossible and nothing was changed. Inspect with: cd $DIR && git log --oneline --left-right HEAD...FETCH_HEAD"
      fi
    fi
    head_after="$(git -C "$DIR" rev-parse HEAD)"
    head_before="$head_now"
    if [ -n "${AFFLINO_REEXECED:-}" ]; then
      head_before="${AFFLINO_HEAD_BEFORE:-$head_now}"
      [ "$head_before" = "$head_after" ] || info "this run updates $(git -C "$DIR" rev-parse --short "$head_before") → $(git -C "$DIR" rev-parse --short "$head_after")"
    fi
    # The rest of the run is the checkout's own copy of this script, once:
    # the install line runs whatever raw.githubusercontent.com served (from
    # /dev/fd/63, cached up to 5 minutes), which can be older than the
    # commit just checked out; a run started from the checkout's copy
    # continues with the new version when the update changed it.
    local new_self="$APP/deploy/linode/install.sh" reexec=""
    if [ -z "${AFFLINO_REEXECED:-}" ] && [ -f "$new_self" ]; then
      if [ "$(readlink -f "$SELF" 2>/dev/null || printf '%s' "$SELF")" != "$(readlink -f "$new_self")" ]; then
        reexec="continuing with the checkout's copy of the installer ($(git -C "$DIR" rev-parse --short HEAD))"
      elif [ -n "$head_now" ] && [ "$head_now" != "$head_after" ] \
        && ! git -C "$DIR" diff --quiet "$head_now" "$head_after" -- affiliate/deploy/linode/install.sh; then
        reexec="the installer itself changed: continuing with the new version"
      fi
    fi
    if [ -n "$reexec" ]; then
      info "$reexec"
      AFFLINO_REEXECED=1 AFFLINO_HEAD_BEFORE="$head_before" exec bash "$new_self" "$@"
    fi
  fi
  [ -f "$APP/.env.prod.example" ] || die "$APP/.env.prod.example not found; the checkout is incomplete."
  APP="$(cd "$APP" && pwd -P)"
  stop_after code

  # ================================================================ 4. environment
  say "Environment: $ENV_FILE"
  local env_dir
  env_dir="$(dirname "$ENV_FILE")"
  install -d -m 0700 -o root -g root "$env_dir"
  local created="" added=()
  if [ -f "$ENV_FILE" ]; then
    if [ "$(stat -c '%u:%g %a' "$ENV_FILE")" != "0:0 600" ]; then
      chown root:root "$ENV_FILE"; chmod 600 "$ENV_FILE"
      info "permissions reset to root:root 0600"
    fi
  else
    created=1
  fi

  # Every key the contract knows (.env.prod.example), for presets and for
  # keeping the shell's variables out of compose (below).
  local contract_keys=()
  mapfile -t contract_keys < <(grep -Eo '^[A-Z][A-Z0-9_]*=' "$APP/.env.prod.example" | tr -d '=' | sort -u)

  local new_lines=""
  append_key() { # $1 key, $2 value, $3 how
    new_lines="$new_lines$1=$2"$'\n'
    added+=("$1 ($3)")
  }
  local k v
  # Secrets: generated here, never printed.
  for k in POSTGRES_PASSWORD JWT_SECRET STUB_WEBHOOK_SECRET IP_HASH_KEY COMMENT_ID_HASH_KEY WEB_REVALIDATE_SECRET; do
    env_has "$k" && continue
    if [ -n "${!k+x}" ] && [ -n "${!k}" ]; then append_key "$k" "${!k}" "preset"; continue; fi
    if [ "$k" = JWT_SECRET ]; then v="$(openssl rand -hex 48)"; else v="$(openssl rand -hex 32)"; fi
    append_key "$k" "$v" "generated"
  done
  v=""
  if ! env_has SITE_HOST; then append_key SITE_HOST "${SITE_HOST:-afflino.com}" "$([ -n "${SITE_HOST:-}" ] && echo preset || echo default)"; fi
  if ! env_has SITE_INDEXING; then append_key SITE_INDEXING "${SITE_INDEXING:-off}" "$([ -n "${SITE_INDEXING:-}" ] && echo preset || echo 'default: pre-launch, noindex')"; fi
  if ! env_has ACME_EMAIL; then
    local email="" how="asked"
    if [ -n "${ACME_EMAIL+x}" ]; then
      email="$ACME_EMAIL"; how="preset"
    elif tty_ok; then
      printf '\n   Optional: an email for the Let'"'"'s Encrypt account (account and policy notices only;\n   Let'"'"'s Encrypt sends no expiry emails, and the edge renews certificates by itself).\n   Press Enter to skip. Email: ' >/dev/tty
      IFS= read -r email </dev/tty || email=""
    else
      how="no terminal: left empty"
    fi
    email="$(printf '%s' "$email" | tr -d '[:space:]')"
    if [ -n "$email" ] && ! printf '%s' "$email" | grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then
      warn "'$email' does not look like an email address; ACME_EMAIL left empty (edit $ENV_FILE to set it)."
      email=""
    fi
    append_key ACME_EMAIL "$email" "$how"
  fi
  # Any other contract key preset in the environment.
  for k in "${contract_keys[@]}"; do
    # (handled above, or read by scripts/backup.sh on a backup host, not by compose)
    case "$k" in POSTGRES_PASSWORD|JWT_SECRET|STUB_WEBHOOK_SECRET|IP_HASH_KEY|COMMENT_ID_HASH_KEY|WEB_REVALIDATE_SECRET|SITE_HOST|SITE_INDEXING|ACME_EMAIL|BACKUP_DIR|PAPARAZZI_ALLOW_PROD|PAPARAZZI_RESTORE_DB) continue ;; esac
    if [ -n "${!k+x}" ] && ! env_has "$k"; then append_key "$k" "${!k}" "preset"; fi
  done

  # A value in the environment never replaces one already in the file.
  local ignored=()
  for k in "${contract_keys[@]}"; do
    case "$k" in BACKUP_DIR|PAPARAZZI_ALLOW_PROD|PAPARAZZI_RESTORE_DB) continue ;; esac
    if [ -n "${!k+x}" ] && env_has "$k"; then ignored+=("$k"); fi
  done
  [ "${#ignored[@]}" -eq 0 ] || info "kept the file's ${ignored[*]} (the value set in this shell was ignored; edit $ENV_FILE to change one)"

  if [ -n "$new_lines" ]; then
    local tmp
    tmp="$(mktemp "$env_dir/.afflino.env.XXXXXX")"
    chmod 600 "$tmp"
    {
      if [ -n "$created" ]; then
        printf '# Afflino production environment, written by deploy/linode/install.sh on %s.\n' "$STARTED_AT"
        printf '# root:root 0600, outside the git checkout. Every variable is documented in\n'
        printf '# affiliate/.env.prod.example. The secrets below were generated on this server\n'
        printf '# with openssl and never printed. Edit a value, then run the installer line\n'
        printf '# again (it keeps every value and only adds keys that are missing).\n'
      else
        cat "$ENV_FILE"
        printf '# Added by deploy/linode/install.sh on %s\n' "$STARTED_AT"
      fi
      printf '%s' "$new_lines"
    } >"$tmp"
    chown root:root "$tmp"
    mv -f "$tmp" "$ENV_FILE"
    new_lines=""
    if [ -n "$created" ]; then info "created (root:root 0600)"; fi
    local a
    for a in "${added[@]}"; do info "set $a"; done
  else
    info "unchanged: every key present, every value kept"
  fi

  # Checks on the values (names only in messages).
  v="$(env_get POSTGRES_PASSWORD)"
  printf '%s' "$v" | grep -Eq '^[A-Za-z0-9._~-]+$' \
    || die "POSTGRES_PASSWORD in $ENV_FILE is empty or has characters that break the connection string (use hex: openssl rand -hex 32). Note: the password is fixed when the database volume is first created."
  v="$(env_get JWT_SECRET)"; [ "${#v}" -ge 32 ] || die "JWT_SECRET in $ENV_FILE is shorter than 32 characters."
  v="$(env_get STUB_WEBHOOK_SECRET)"; [ -n "$v" ] || die "STUB_WEBHOOK_SECRET in $ENV_FILE is empty."
  v="$(env_get IP_HASH_KEY)"
  if [ -z "$v" ]; then warn "IP_HASH_KEY is empty: click address hashes are plain SHA-256 (reversible for IPv4)."
  elif [ "${#v}" -lt 32 ]; then die "IP_HASH_KEY in $ENV_FILE is shorter than 32 characters; the redirect refuses to boot with it."; fi
  v=""
  local SITE_HOST_V SITE_INDEXING_V
  SITE_HOST_V="$(env_get SITE_HOST)"; SITE_HOST_V="${SITE_HOST_V:-afflino.com}"
  SITE_INDEXING_V="$(env_get SITE_INDEXING)"
  printf '%s' "$SITE_HOST_V" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' || die "SITE_HOST in $ENV_FILE is not a bare lowercase host name."
  case "$SITE_INDEXING_V" in
    on) info "SITE_INDEXING=on: search engines may index the public pages" ;;
    off|"") info "SITE_INDEXING=off: pre-launch, every page noindex, robots.txt Disallow: /" ;;
    *) warn "SITE_INDEXING='$SITE_INDEXING_V' is neither on nor off; the web treats it as off." ;;
  esac
  local env_changed=""
  [ "${#added[@]}" -gt 0 ] && env_changed=1
  stop_after env

  # ================================================================ 5. deploy
  say "Deploy: docker compose project '$PROJECT'"
  have docker || die "docker is not installed."
  docker info >/dev/null 2>&1 || die "the Docker daemon is not reachable (systemctl status docker)."
  docker compose version >/dev/null 2>&1 || die "'docker compose' is not available."

  local files=(-f "$APP/docker-compose.prod.yml" -f "$APP/docker-compose.single-host.yml")
  if is_on "$EDGE_TEST"; then files+=(-f "$APP/docker-compose.edge-test.yml"); fi
  if [ -n "$EXTRA_COMPOSE" ]; then files+=(-f "$EXTRA_COMPOSE"); fi
  # The environment file is the only source of the stack's variables: a
  # variable exported in this shell would otherwise win over it.
  local unset_args=() key
  for key in "${contract_keys[@]}" COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES EDGE_ADDRESS EDGE_BIND; do unset_args+=(-u "$key"); done
  # BUILDX_NO_DEFAULT_ATTESTATIONS: without it every build writes a new
  # provenance attestation, so an unchanged image gets a new id on Docker's
  # containerd image store and compose would recreate every service on each
  # run; with it, an unchanged checkout rebuilds to the same image ids and
  # the re-run changes nothing.
  dc() { env "${unset_args[@]}" BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker compose --project-directory "$APP" -p "$PROJECT" --env-file "$ENV_FILE" "${files[@]}" "$@"; }

  dc config -q

  # A backup before an update that changes something.
  local pg_running backup_note="the database backups are in $BACKUPS"
  pg_running="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=postgres --filter status=running | head -n 1)"
  if [ -n "$pg_running" ] && { [ "$head_before" != "$head_after" ] || [ -n "$env_changed" ]; }; then
    info "backup before the update:"
    AFFLINO_PROJECT="$PROJECT" AFFLINO_BACKUP_DIR="$BACKUPS" bash "$APP/deploy/linode/backup.sh" pre-update | sed 's/^/   /'
    backup_note="the backup taken before this update is the newest *-pre-update.sql.gz in $BACKUPS"
  fi

  info "building the images (the first build takes several minutes)"
  dc build
  # The migrations on their own, before anything is recreated: if one fails,
  # the running api, redirect, workers and web are not touched and keep
  # serving the release that ran before (fix forward, docs/runbooks/deploy.md
  # §2). On the first run this also starts postgres.
  info "running the database migrations"
  local mig_rc=0
  dc run --rm -T migrate 2>&1 | sed 's/^/   /' || mig_rc=$?
  if [ "$mig_rc" -ne 0 ]; then
    die "the database migrations failed (exit $mig_rc; the output is above). Nothing was recreated: the services that were running keep the release that ran before. Fix forward (docs/runbooks/deploy.md §2); $backup_note."
  fi

  info "starting the stack"
  dc up -d --remove-orphans

  # Caddy reads its Caddyfile once, at start: restart the edge when the
  # checkout's copy changed after the running edge started (a git update
  # writes a new file, which a running container's bind mount does not even
  # see; an edit in place is seen but not loaded).
  local edge_id edge_started file_changed
  edge_id="$(dc ps -q edge)"
  if [ -n "$edge_id" ]; then
    edge_started="$(date -d "$(docker inspect -f '{{.State.StartedAt}}' "$edge_id")" +%s 2>/dev/null || echo 0)"
    file_changed="$(stat -c %Y "$APP/docker/Caddyfile")"
    if [ "$file_changed" -ge "$edge_started" ]; then
      info "the Caddyfile changed after the edge started: restarting the edge"
      dc restart edge >/dev/null
    fi
  fi

  info "waiting for migrate and for api, redirect and web to be healthy (up to 5 minutes)"
  local deadline=$((SECONDS + 300)) state svc cid ready
  local mig_id
  while :; do
    ready=1
    mig_id="$(dc ps -a -q migrate)"
    if [ -n "$mig_id" ]; then
      state="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$mig_id")"
      case "$state" in
        "exited 0") ;;
        exited*) dc logs --no-color --tail 30 migrate >&2 || true; die "migrate failed ($state) when the stack started, after the same migrations had run on their own; its last lines are above." ;;
        *) ready="" ;;
      esac
    else
      ready=""
    fi
    for svc in api redirect web; do
      cid="$(dc ps -q "$svc")"
      if [ -z "$cid" ] || [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid")" != healthy ]; then ready=""; fi
    done
    [ -n "$ready" ] && break
    if [ "$SECONDS" -ge "$deadline" ]; then
      dc ps -a >&2 || true
      die "the stack is not healthy after 5 minutes (above). Logs: cd $APP && docker compose -p $PROJECT --env-file $ENV_FILE ${files[*]} logs --tail 50"
    fi
    sleep 3
  done

  # The edge: running and answering (a port another program took, or a bad
  # Caddyfile, shows here and not in the health checks above).
  local edge_state="" edge_answer="" tries
  for tries in 1 2 3 4 5 6 7 8 9 10; do
    edge_id="$(dc ps -q edge)"
    edge_state=""; [ -n "$edge_id" ] && edge_state="$(docker inspect -f '{{.State.Status}}' "$edge_id")"
    if is_on "$EDGE_TEST"; then
      edge_answer="$(curl -fsS --noproxy '*' --max-time 5 -H "Host: $SITE_HOST_V" http://127.0.0.1:8088/api/healthz 2>/dev/null || true)"
      [ "$edge_state" = running ] && [ "$edge_answer" = '{"ok":true}' ] && break
    else
      edge_answer="$(curl -s --noproxy '*' --max-time 5 -o /dev/null -w '%{http_code} %{redirect_url}' -H "Host: $SITE_HOST_V" http://127.0.0.1/ 2>/dev/null || true)"
      [ "$edge_state" = running ] && [ "${edge_answer%% *}" = 308 ] && break
    fi
    [ "$tries" = 10 ] && { dc logs --no-color --tail 20 edge >&2 || true; die "the edge is '${edge_state:-missing}' and answers '${edge_answer:-nothing}' (its last log lines are above; the client address is never logged)."; }
    sleep 2
  done

  # ---------------------------------------------------------------- status
  say "Status"
  dc ps -a --format 'table {{.Service}}\t{{.Status}}' | sed 's/^/   /'
  local u body
  for u in http://127.0.0.1:3000/healthz http://127.0.0.1:3001/healthz http://127.0.0.1:3002/api/healthz; do
    body="$(curl -fsS --noproxy '*' --max-time 5 "$u" 2>&1 || true)"
    info "$u → $body"
  done
  if is_on "$EDGE_TEST"; then
    info "edge (test mode) http://127.0.0.1:8088/api/healthz, Host $SITE_HOST_V → $edge_answer"
  else
    info "edge http://127.0.0.1/, Host $SITE_HOST_V → $edge_answer (HTTP → HTTPS)"
  fi

  local ip4 ip6
  ip4="$(public_ipv4)"; ip6="$(public_ipv6)"
  info "this server: IPv4 ${ip4:-none found}, IPv6 ${ip6:-none found} (from the interfaces)"

  local name got4 got6 a_ok=1 aaaa_ok=1 verdict apex4=""
  for name in "$SITE_HOST_V" "www.$SITE_HOST_V"; do
    got4="$(getent ahostsv4 "$name" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
    got6="$(getent ahostsv6 "$name" 2>/dev/null | awk '{print $1}' | grep -v '^::ffff:' | sort -u | tr '\n' ' ' || true)"
    got4="${got4% }"; got6="${got6% }"
    [ "$name" = "$SITE_HOST_V" ] && apex4="$got4"
    verdict="A points here"
    if [ -z "$ip4" ] || [ "$got4" != "$ip4" ]; then verdict="A NOT this server yet"; a_ok=""; fi
    if [ -n "$ip6" ]; then
      if [ "$got6" = "$ip6" ]; then verdict="$verdict, AAAA points here"; else verdict="$verdict, AAAA NOT this server yet"; aaaa_ok=""; fi
    elif [ -n "$got6" ]; then
      verdict="$verdict, AAAA exists but this server has no IPv6 address"; aaaa_ok=""
    fi
    info "DNS $name: A ${got4:-(none)}; AAAA ${got6:-(none)} → $verdict"
  done
  if [ -z "$a_ok" ] || [ -z "$aaaa_ok" ]; then
    printf '\n   Set these records at GoDaddy (My Products → %s → DNS → DNS Records):\n' "$SITE_HOST_V"
    if [ -n "$ip4" ]; then
      printf '     A      @     %-40s edit the A record for @ and delete every other A record for @\n' "$ip4"
      [ -n "$apex4" ] && printf '                  %-40s (now: %s)\n' "" "$apex4"
    else
      printf '     A      @     (no public IPv4 address found on this server: use the one Linode Cloud Manager shows)\n'
    fi
    if [ -n "$ip6" ]; then
      printf '     AAAA   @     %-40s add it (or edit the AAAA record for @)\n' "$ip6"
    else
      printf '     AAAA   @     (none: this server has no public IPv6 address; delete any AAAA record for @)\n'
    fi
    printf '     CNAME  www   %-40s keep it as it is (www → the apex)\n' "@"
    printf '   If Forwarding is on for %s at GoDaddy (Domain → Forwarding), delete it: it keeps\n' "$SITE_HOST_V"
    printf '   GoDaddy'"'"'s own A records in place. With GoDaddy API access, this sets them instead:\n'
    printf '     bash %s/deploy/linode/godaddy-dns.sh\n' "$APP"
    printf '   Check from here after the change (propagation takes minutes): getent ahosts %s\n' "$SITE_HOST_V"
  fi

  local edge_name=""
  [ -n "$edge_id" ] && edge_name="$(docker inspect -f '{{.Name}}' "$edge_id" | sed 's#^/##')"
  if is_on "$EDGE_TEST"; then
    info "certificates: none in test mode (plain HTTP on 127.0.0.1:8088)"
  elif curl -fsS --max-time 8 -o /dev/null --resolve "$SITE_HOST_V:443:127.0.0.1" "https://$SITE_HOST_V/api/healthz" 2>/dev/null; then
    info "HTTPS: https://$SITE_HOST_V answers here with a valid certificate"
  else
    info "HTTPS: no certificate yet. The edge requests certificates for $SITE_HOST_V and www.$SITE_HOST_V by itself and"
    info "retries until DNS points here (usually minutes after the change). Watch it with:"
    info "  docker logs -f ${edge_name:-afflino-edge-1} 2>&1 | grep -i certificate"
  fi

  # ================================================================ 6. backups
  if is_on "$SKIP_SYSTEM"; then
    info "backup timer: not installed (AFFLINO_SKIP_SYSTEM, test only)"
  elif ! has_systemd; then
    warn "backup timer: not installed (no systemd here)"
  else
    install -d -m 0700 -o root -g root "$BACKUPS"
    local unit_changed=""
    if write_if_changed /etc/systemd/system/afflino-backup.service "# Written by Afflino deploy/linode/install.sh
[Unit]
Description=Afflino daily database backup (pg_dump inside the postgres container)
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
Environment=AFFLINO_PROJECT=$PROJECT
Environment=AFFLINO_BACKUP_DIR=$BACKUPS
ExecStart=/bin/bash $APP/deploy/linode/backup.sh daily"; then unit_changed=1; fi
    if write_if_changed /etc/systemd/system/afflino-backup.timer "# Written by Afflino deploy/linode/install.sh
[Unit]
Description=Afflino daily database backup, 02:30 UTC (before the 03:00 UTC retention purge)

[Timer]
OnCalendar=*-*-* 02:30:00 UTC
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target"; then unit_changed=1; fi
    [ -n "$unit_changed" ] && systemctl daemon-reload
    systemctl enable --now afflino-backup.timer >/dev/null 2>&1
    info "backups: daily at 02:30 UTC into $BACKUPS (14 kept); next: $(systemctl show afflino-backup.timer -p NextElapseUSecRealtime --value 2>/dev/null || echo unknown)"
  fi
  if [ -z "$(find "$BACKUPS" -maxdepth 1 -name 'afflino-*.sql.gz' 2>/dev/null | head -n 1)" ]; then
    info "first backup now:"
    AFFLINO_PROJECT="$PROJECT" AFFLINO_BACKUP_DIR="$BACKUPS" bash "$APP/deploy/linode/backup.sh" manual | sed 's/^/   /'
  fi

  # ---------------------------------------------------------------- next
  local compose_line="cd $APP && docker compose"
  [ "$PROJECT" = afflino ] || compose_line="$compose_line -p $PROJECT"
  compose_line="$compose_line --env-file $ENV_FILE -f docker-compose.prod.yml -f docker-compose.single-host.yml"
  is_on "$EDGE_TEST" && compose_line="$compose_line -f docker-compose.edge-test.yml"
  [ -n "$EXTRA_COMPOSE" ] && compose_line="$compose_line -f $EXTRA_COMPOSE"
  say "Done ($(date -u +%H:%M:%SZ)). Useful lines"
  info "update (the same line as the install):  bash <(curl -fsSL $RAW_INSTALL)"
  info "status:   $compose_line ps"
  info "logs:     $compose_line logs -f --since 15m"
  info "backup:   bash $APP/deploy/linode/backup.sh manual"
  info "restore check (into a scratch database, the live one untouched):  bash $APP/deploy/linode/restore.sh"
  if ! is_on "$SKIP_GIT" && git -C "$DIR" rev-parse -q --verify refs/tags/afflino-previous >/dev/null 2>&1; then
    local rollback_line="cd $DIR && git checkout afflino-previous && ${compose_line} up -d --build"
    info "rollback to the release before the last update ($(git -C "$DIR" rev-parse --short afflino-previous); code-only releases, docs/runbooks/deploy.md §3):"
    info "  $rollback_line"
  fi
  info "indexing: SITE_INDEXING=on lets search engines in; the switch is yours (docs/runbooks/deploy.md)"
}

main "$@"; exit
