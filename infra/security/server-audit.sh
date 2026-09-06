#!/usr/bin/env bash
# Read-only security audit of the fleet host. Run on the server as root from the repo root:
#   ./infra/security/server-audit.sh
# Changes nothing. Pair with ./infra/security/harden-host.sh to fix what it flags.
cd "$(dirname "$0")/../.."
ok()   { printf '  [ok]   %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*"; }
info() { printf '  [info] %s\n' "$*"; }
hr()   { echo; echo "== $*"; }

hr "host"
info "$(. /etc/os-release && echo "$PRETTY_NAME") · kernel $(uname -r) · up $(uptime -p 2>/dev/null | sed 's/up //')"
if [ -f /var/run/reboot-required ]; then warn "reboot required (kernel/libc update pending)"; else ok "no reboot pending"; fi
upd=$(apt-get -s upgrade 2>/dev/null | grep -c '^Inst ' || echo 0)
sec=$(apt-get -s upgrade 2>/dev/null | grep '^Inst ' | grep -ci security || echo 0)
if [ "$sec" -gt 0 ]; then warn "$upd package updates available, $sec of them security"; else ok "$upd package updates available, none tagged security"; fi
if dpkg -s unattended-upgrades >/dev/null 2>&1 && systemctl is-enabled --quiet unattended-upgrades 2>/dev/null; then ok "unattended-upgrades enabled"; else warn "unattended-upgrades not installed/enabled - security patches wait for a human"; fi

hr "ssh"
sshd_cfg() { sshd -T 2>/dev/null | awk -v k="$1" '$1==k{print $2}'; }
prl=$(sshd_cfg permitrootlogin); pa=$(sshd_cfg passwordauthentication); port=$(sshd_cfg port)
case "$prl" in prohibit-password|without-password|no) ok "PermitRootLogin $prl";; *) warn "PermitRootLogin $prl - root can log in with a password";; esac
if [ "$pa" = "no" ]; then ok "PasswordAuthentication no"; else warn "PasswordAuthentication $pa - every account is brute-forceable"; fi
info "sshd port $port · authorized keys for root: $(grep -cE '^(ssh|ecdsa)-' /root/.ssh/authorized_keys 2>/dev/null || echo 0)"
fails=$(journalctl -u ssh -u sshd --since "24 hours ago" 2>/dev/null | grep -c 'Failed password' || echo 0)
info "failed SSH password attempts in the last 24h: $fails"
if systemctl is-active --quiet fail2ban 2>/dev/null; then ok "fail2ban running · sshd jail: $(fail2ban-client status sshd 2>/dev/null | awk -F: '/Currently banned/{gsub(/ /,"",$2); print $2" banned"}')"; else warn "fail2ban not running"; fi

hr "firewall"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ok "ufw active"; ufw status numbered 2>/dev/null | grep -E '^\[' | sed 's/^/         /'
else
  warn "ufw not active - only Docker's own port publishing limits exposure"
fi
info "listening on all interfaces:"
ss -tlnpH 2>/dev/null | awk '$4 ~ /^(0\.0\.0\.0|\*|\[::\]):/ {print "         "$4"  "$6}' | sed 's/users:((//; s/,.*//' | sort -u

hr "docker"
info "$(docker --version 2>/dev/null) · compose $(docker compose version --short 2>/dev/null)"
pub=$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E '0\.0\.0\.0|:::' || true)
if [ "$(echo "$pub" | grep -vE '^proxy ' | grep -c .)" -gt 0 ]; then warn "containers other than proxy publish host ports:"; echo "$pub" | grep -vE '^proxy ' | sed 's/^/         /'; else ok "only the proxy publishes host ports (80/443)"; fi
for c in $(docker ps --format '{{.Names}}'); do
  st=$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null); [ "$st" = "unhealthy" ] && warn "$c is unhealthy"
done
ok "$(docker ps -q | wc -l) containers running, $(docker ps -q --filter health=unhealthy | wc -l) unhealthy"
info "image ages (a very old image means unpatched PHP/MariaDB/nginx):"
for img in $(docker ps --format '{{.Image}}' | sort -u); do
  created=$(docker image inspect -f '{{.Created}}' "$img" 2>/dev/null | cut -c1-10)
  printf '         %-34s built %s\n' "$img" "$created"
done

hr "secrets and files"
p=$(stat -c '%a %U' .env 2>/dev/null || echo "missing")
case "$p" in 600\ root|400\ root) ok ".env is $p";; *) warn ".env is $p - should be 600 root (chmod 600 .env)";; esac
if git -C . status --porcelain 2>/dev/null | grep -q '^?? .env$'; then warn ".env shows as untracked in git status - check .gitignore"; fi
if [ -f .env ]; then
  for k in WP_ADMIN_PASSWORD DB_ROOT_PASSWORD; do
    v=$(grep -E "^$k=" .env | cut -d= -f2-); n=${#v}
    if [ "$n" -lt 16 ]; then warn "$k is $n chars - use 24+ random characters"; else ok "$k length $n"; fi
  done
  if grep -qE '^WP_ADMIN_USER=admin$' .env; then warn "WP_ADMIN_USER=admin - rename the administrator account (see init-sites.sh output)"; else ok "admin login is not 'admin'"; fi
fi
info "docker socket mounts (a container with the socket can control the host):"
docker ps -q | xargs -r docker inspect -f '{{.Name}} {{range .Mounts}}{{if eq .Source "/var/run/docker.sock"}}docker.sock:{{.Mode}}{{end}}{{end}}' | grep sock | sed 's/^\//         /'

hr "wordpress (per site)"
for s in $(docker ps --format '{{.Names}}' | grep '^wp_' | sed 's/^wp_//'); do
  wp() { docker compose run --rm -T "cli_$s" "$@" </dev/null 2>/dev/null; }
  echo "  -- $s"
  core=$(wp core version); upd=$(wp core check-update --format=count 2>/dev/null || echo 0)
  if [ "${upd:-0}" -gt 0 ]; then warn "core $core - update available"; else ok "core $core current"; fi
  pl=$(wp plugin list --update=available --format=count 2>/dev/null || echo 0)
  if [ "${pl:-0}" -gt 0 ]; then warn "$pl plugin update(s) pending: $(wp plugin list --update=available --field=name | tr '\n' ' ')"; else ok "plugins current"; fi
  inactive=$(wp plugin list --status=inactive --field=name | tr '\n' ' ')
  [ -n "$inactive" ] && warn "inactive plugins still installed (dead code is still attack surface): $inactive"
  if wp plugin is-active limit-login-attempts-reloaded; then ok "Limit Login Attempts active"; else warn "Limit Login Attempts NOT active"; fi
  admins=$(wp user list --role=administrator --fields=user_login,user_email --format=csv | tail -n +2 | tr '\n' ' ')
  info "administrators: $admins"
  wp user list --fields=user_login,user_nicename,roles --format=csv | tail -n +2 | awk -F, '$1==$2 {print "  [WARN] nicename equals login for "$1" (/author/"$1"/ confirms the account)"}'
  autop=$(wp user application-password list "${WP_AUTOPUB_USER:-autopub}" --format=count 2>/dev/null || echo 0)
  info "application passwords on autopub user: ${autop:-0} (expect 1)"
  if [ "$(wp option get users_can_register)" = "0" ]; then ok "registration closed"; else warn "registration OPEN"; fi
  dbg=$(wp config get WP_DEBUG 2>/dev/null || echo false); [ "$dbg" = "true" ] && warn "WP_DEBUG is on" || ok "WP_DEBUG off"
done

hr "tls (from the server itself)"
for d in $(python3 -c "import yaml; print(' '.join(s['domain'] for s in yaml.safe_load(open('autopub/config/sites.yaml'))['sites']))"); do
  exp=$(echo | openssl s_client -connect "$d:443" -servername "$d" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  iss=$(echo | openssl s_client -connect "$d:443" -servername "$d" 2>/dev/null | openssl x509 -noout -issuer 2>/dev/null | sed 's/.*O = //; s/,.*//')
  if [ -n "$exp" ]; then
    left=$(( ( $(date -d "$exp" +%s) - $(date +%s) ) / 86400 ))
    if [ "$left" -lt 14 ]; then warn "$d cert expires in $left days ($iss)"; else ok "$d cert valid $left more days ($iss)"; fi
  else warn "$d: could not read certificate"; fi
done

hr "backups"
if [ -d /var/backups/marketing-fleet ] || crontab -l 2>/dev/null | grep -qi backup; then ok "a backup job/dir exists"; else warn "no backup job found - enable Linode Backups on the instance or add a volume snapshot cron (README 'Backups')"; fi
echo
echo "done. WARN lines are the to-do list; ./infra/security/harden-host.sh fixes the host-level ones."
