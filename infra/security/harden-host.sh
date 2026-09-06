#!/usr/bin/env bash
# Host hardening for the fleet server (Ubuntu/Debian). Idempotent. Run as root from the repo root:
#   ./infra/security/harden-host.sh
# Does, in order: unattended security updates, ufw (22/80/443 only), fail2ban for sshd,
# .env permissions, and - ONLY when a root SSH key is installed - turns off SSH password logins.
# infra/bootstrap.sh calls this, so new servers get it automatically; existing ones run it once.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo ">> packages"
apt-get update -qq
apt-get install -y -qq ufw fail2ban unattended-upgrades apt-listchanges >/dev/null

echo ">> unattended security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
# security pocket only (the default), auto-remove unused kernels, never auto-reboot a live web host
sed -i 's|^//\s*"\${distro_id}:\${distro_codename}-security";|        "${distro_id}:${distro_codename}-security";|' /etc/apt/apt.conf.d/50unattended-upgrades
grep -q '^Unattended-Upgrade::Remove-Unused-Kernel-Packages' /etc/apt/apt.conf.d/50unattended-upgrades \
  || echo 'Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";' >> /etc/apt/apt.conf.d/50unattended-upgrades
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

echo ">> firewall: ssh, http, https only"
SSH_PORT=$(sshd -T 2>/dev/null | awk '$1=="port"{print $2; exit}'); SSH_PORT=${SSH_PORT:-22}
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp" comment ssh >/dev/null
ufw allow 80/tcp comment http >/dev/null
ufw allow 443/tcp comment https >/dev/null
ufw limit "${SSH_PORT}/tcp" >/dev/null   # rate-limit new SSH connections (6 per 30s per IP)
ufw --force enable >/dev/null
ufw status | sed 's/^/   /'
# Docker publishes ports with its own iptables rules that bypass ufw. Only the proxy publishes
# anything (80/443, both allowed above), so nothing else is reachable - server-audit.sh checks that.

echo ">> fail2ban: sshd jail"
cat > /etc/fail2ban/jail.d/fleet-sshd.local <<EOF
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true
port    = ${SSH_PORT}
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban
fail2ban-client status sshd 2>/dev/null | sed 's/^/   /' || true

echo ">> secrets file permissions"
[ -f .env ] && chmod 600 .env && chown root:root .env && echo "   .env -> 600 root"

echo ">> sshd"
KEYS=$(grep -cE '^(ssh|ecdsa|sk-)' /root/.ssh/authorized_keys 2>/dev/null || echo 0)
mkdir -p /etc/ssh/sshd_config.d
if [ "$KEYS" -gt 0 ]; then
  cat > /etc/ssh/sshd_config.d/10-fleet.conf <<'EOF'
# fleet hardening: keys only. Root stays allowed (this box is administered as root) but never by password.
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 4
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
  if sshd -t 2>/dev/null; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd
    echo "   password logins disabled ($KEYS root key(s) on file). Keep this terminal open and test a new"
    echo "   SSH session before you log out."
  else
    rm -f /etc/ssh/sshd_config.d/10-fleet.conf; echo "   !! sshd config test failed - left unchanged"
  fi
else
  echo "   !! no key in /root/.ssh/authorized_keys - NOT disabling password logins (you would be locked out)."
  echo "      add your public key, then re-run this script."
fi

echo ">> done. Review with: ./infra/security/server-audit.sh"
