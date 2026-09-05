#!/usr/bin/env bash
# Server-side bootstrap. Idempotent; safe to re-run after `git pull` / rsync.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { curl -fsSL https://get.docker.com | sh; }
docker compose version >/dev/null 2>&1 || { echo "docker compose plugin missing"; exit 1; }
command -v python3 >/dev/null || apt-get install -y python3
python3 -c "import yaml" 2>/dev/null || apt-get install -y python3-yaml

[ -f .env ] || { echo ".env missing"; exit 1; }
python3 infra/gen_compose.py

echo ">> starting database, proxy and WordPress containers"
docker compose up -d --remove-orphans db proxy acme
docker compose up -d $(python3 -c "import yaml; print(' '.join('wp_'+s['key'].lower() for s in yaml.safe_load(open('autopub/config/sites.yaml'))['sites']))")

echo ">> installing WordPress sites"
./infra/wp/init-sites.sh

echo ">> starting the publisher"
docker compose up -d --build autopub
docker compose ps
