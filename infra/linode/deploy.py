#!/usr/bin/env python3
"""Zero-SSH deployment: create the Linode, hand it a cloud-init that installs everything, set Linode DNS.

    python3 infra/linode/deploy.py            # uses .env in the repo root
    python3 infra/linode/deploy.py --dry-run  # print the cloud-init and exit

Needs in .env (or the environment): LINODE_TOKEN, ANTHROPIC_API_KEY, WP_ADMIN_EMAIL, LETSENCRYPT_EMAIL.
Missing passwords (DB_ROOT_PASSWORD, WP_*_DB_PASSWORD, WP_ADMIN_PASSWORD) are generated and written to .env.
Optional: LINODE_REGION (ap-west), LINODE_TYPE (g6-standard-2), LINODE_LABEL (marketing-fleet),
          REPO_URL, REPO_BRANCH (main), SSH_PUBKEY (adds a key so you can log in later).

The server clones this public repository on first boot, writes the .env you have here, runs
infra/bootstrap.sh (Docker, WordPress install on every site, application passwords, publisher) and
logs to /var/log/marketing-fleet-bootstrap.log. Nothing else has to reach the box.
"""
from __future__ import annotations

import argparse
import base64
import os
import secrets
import sys
import time
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infra"))
import dns as dns_tool  # noqa: E402  (infra/dns.py)

ENV_PATH = ROOT / ".env"
API = "https://api.linode.com/v4"
DEFAULT_REPO = "https://github.com/sudhanshu6454/sud.git"

CLOUD_INIT = """#cloud-config
package_update: true
package_upgrade: true
packages: [ca-certificates, curl, git, ufw, fail2ban, python3, python3-yaml, python3-requests, unattended-upgrades]
write_files:
  - path: /opt/marketing-fleet.env
    permissions: "0600"
    owner: root:root
    encoding: b64
    content: {env_b64}
  - path: /usr/local/bin/marketing-fleet-bootstrap
    permissions: "0755"
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      exec > >(tee -a /var/log/marketing-fleet-bootstrap.log) 2>&1
      echo "== $(date -Is) bootstrap start"
      command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
      systemctl enable --now docker
      if [ ! -d /opt/marketing-fleet/.git ]; then
        git clone --branch {branch} --depth 1 {repo} /opt/marketing-fleet
      else
        git -C /opt/marketing-fleet pull --ff-only || true
      fi
      mv -f /opt/marketing-fleet.env /opt/marketing-fleet/.env
      chmod 600 /opt/marketing-fleet/.env
      cd /opt/marketing-fleet
      ./infra/bootstrap.sh
      echo "== $(date -Is) bootstrap done"
runcmd:
  - ufw allow OpenSSH
  - ufw allow 80/tcp
  - ufw allow 443/tcp
  - ufw --force enable
  - systemctl enable --now fail2ban
  - /usr/local/bin/marketing-fleet-bootstrap
"""


ENV_FALLBACK_KEYS = ("LINODE_TOKEN", "ANTHROPIC_API_KEY", "WP_ADMIN_EMAIL", "WP_ADMIN_USER", "LETSENCRYPT_EMAIL",
                     "SSH_PUBKEY", "LINODE_REGION", "LINODE_TYPE", "LINODE_LABEL", "LINODE_IMAGE", "REPO_URL", "REPO_BRANCH")


def read_env(path: Path) -> dict[str, str]:
    """.env file first; only a known set of keys may fall back to the process environment."""
    out: dict[str, str] = {}
    if path.exists():
        for line in path.read_text().splitlines():
            s = line.strip()
            if s and not s.startswith("#") and "=" in s:
                k, v = s.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    for k in ENV_FALLBACK_KEYS:
        if not out.get(k) and os.environ.get(k):
            out[k] = os.environ[k]
    return out


def upsert_env(path: Path, key: str, value: str) -> None:
    lines = path.read_text().splitlines() if path.exists() else []
    for i, line in enumerate(lines):
        if line.split("=", 1)[0].strip() == key:
            lines[i] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n")


def sites() -> list[dict]:
    with open(ROOT / "autopub" / "config" / "sites.yaml") as fh:
        return yaml.safe_load(fh)["sites"]


def ensure_secrets(env: dict[str, str]) -> None:
    keys = ["DB_ROOT_PASSWORD", "WP_ADMIN_PASSWORD"] + [f"WP_{s['key'].upper()}_DB_PASSWORD" for s in sites()]
    for k in keys:
        if not env.get(k):
            env[k] = secrets.token_urlsafe(24)
            upsert_env(ENV_PATH, k, env[k])
            print(f"  generated {k}")
    env.setdefault("WP_ADMIN_USER", "admin")
    env.setdefault("TZ", "Asia/Kolkata")
    env.setdefault("DNS_PROVIDER", "linode")
    if not env.get("LETSENCRYPT_EMAIL") and env.get("WP_ADMIN_EMAIL"):
        env["LETSENCRYPT_EMAIL"] = env["WP_ADMIN_EMAIL"]
    for k in ("WP_ADMIN_USER", "TZ", "DNS_PROVIDER", "LETSENCRYPT_EMAIL"):
        if env.get(k):
            upsert_env(ENV_PATH, k, env[k])


def server_env_file(env: dict[str, str]) -> str:
    """Only what the server needs; laptop-only provisioning keys stay home."""
    skip = {"LINODE_TOKEN", "GODADDY_API_KEY", "GODADDY_API_SECRET", "SSH_PUBKEY", "LINODE_ROOT_PASS"}
    wanted_prefixes = ("WP_", "DB_", "ANTHROPIC_", "LETSENCRYPT_", "TZ", "TWITTER_", "FACEBOOK_", "INSTAGRAM_",
                       "LINKEDIN_", "PINTEREST_", "TELEGRAM_", "THREADS_", "AUTOPUB_", "LOG_LEVEL")
    lines = [f"{k}={v}" for k, v in sorted(env.items()) if k not in skip and k.startswith(wanted_prefixes) and v]
    return "\n".join(lines) + "\n"


def li(env: dict[str, str]) -> dict:
    return {"Authorization": f"Bearer {env['LINODE_TOKEN']}", "Content-Type": "application/json"}


def find_linode(env: dict[str, str], label: str) -> dict | None:
    r = requests.get(f"{API}/linode/instances", headers=li(env), params={"page_size": 500}, timeout=30)
    r.raise_for_status()
    return next((l for l in r.json()["data"] if l["label"] == label), None)


def create_linode(env: dict[str, str], label: str, user_data: str) -> dict:
    root_pass = env.get("LINODE_ROOT_PASS") or secrets.token_urlsafe(24)
    upsert_env(ENV_PATH, "LINODE_ROOT_PASS", root_pass)
    body = {
        "label": label,
        "region": env.get("LINODE_REGION", "ap-west"),
        "type": env.get("LINODE_TYPE", "g6-standard-2"),
        "image": env.get("LINODE_IMAGE", "linode/ubuntu24.04"),
        "root_pass": root_pass,
        "booted": True,
        "tags": ["marketing-fleet"],
        "metadata": {"user_data": base64.b64encode(user_data.encode()).decode()},
    }
    if env.get("SSH_PUBKEY"):
        body["authorized_keys"] = [env["SSH_PUBKEY"].strip()]
    r = requests.post(f"{API}/linode/instances", headers=li(env), json=body, timeout=60)
    if r.status_code >= 400:
        sys.exit(f"Linode create failed {r.status_code}: {r.text}")
    return r.json()


def wait_running(env: dict[str, str], linode_id: int) -> dict:
    for _ in range(60):
        r = requests.get(f"{API}/linode/instances/{linode_id}", headers=li(env), timeout=30)
        r.raise_for_status()
        data = r.json()
        if data["status"] == "running" and data.get("ipv4"):
            return data
        time.sleep(10)
    sys.exit("Linode did not reach 'running' in 10 minutes")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-dns", action="store_true")
    args = ap.parse_args()

    env = read_env(ENV_PATH)
    missing = [k for k in ("ANTHROPIC_API_KEY", "WP_ADMIN_EMAIL") if not env.get(k)]
    if not args.dry_run and not env.get("LINODE_TOKEN"):
        missing.insert(0, "LINODE_TOKEN")
    if missing:
        sys.exit(f"missing in .env: {', '.join(missing)}")

    print(">> secrets")
    ensure_secrets(env)
    repo = env.get("REPO_URL", DEFAULT_REPO)
    branch = env.get("REPO_BRANCH", "main")
    user_data = CLOUD_INIT.format(env_b64=base64.b64encode(server_env_file(env).encode()).decode(), repo=repo, branch=branch)
    if len(user_data) > 60_000:
        sys.exit("cloud-init too large for Linode metadata")
    yaml.safe_load(user_data)  # fail here rather than on the server if the template is malformed
    if args.dry_run:
        print(user_data)
        print(f"\n-- server .env would contain {server_env_file(env).count(chr(10))} variables; repo {repo}@{branch}")
        return 0

    label = env.get("LINODE_LABEL", "marketing-fleet")
    print(f">> linode '{label}'")
    linode = find_linode(env, label)
    if linode:
        print(f"  exists (id {linode['id']}, status {linode['status']}); not recreating")
    else:
        linode = create_linode(env, label, user_data)
        print(f"  created id {linode['id']} in {linode['region']} ({linode['type']})")
    linode = wait_running(env, linode["id"])
    ip = linode["ipv4"][0]
    print(f"  running at {ip}")

    if not args.skip_dns:
        print(">> Linode DNS")
        os.environ["LINODE_TOKEN"] = env["LINODE_TOKEN"]
        soa = env.get("LETSENCRYPT_EMAIL") or env["WP_ADMIN_EMAIL"]
        for s in sites():
            dns_tool.linode_set_a(s["domain"], ip, soa)

    domains = [s["domain"] for s in sites()]
    print(f"""
DEPLOY STARTED. Server {ip} is installing Docker + WordPress from {repo}@{branch} (about 5-10 minutes).

At GoDaddy, set the nameservers of each domain to: {', '.join(dns_tool.LINODE_NS)}
  {chr(10).join('  ' + d for d in domains)}
HTTPS certificates are issued automatically once the nameservers have propagated (usually under an hour).

WordPress admin on every site: user '{env['WP_ADMIN_USER']}', password in .env (WP_ADMIN_PASSWORD).
Root password for the server is in .env (LINODE_ROOT_PASS); bootstrap log: /var/log/marketing-fleet-bootstrap.log
Check progress without logging in: curl -sI http://{ip}/ (nginx answers once the stack is up).
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
