#!/usr/bin/env bash
# One-shot: create the Linode, point DNS, push this repo + .env, bootstrap everything.
#
#   export LINODE_TOKEN=...            (Linode API token with Linodes + Domains r/w)
#   cp .env.example .env && edit it    (secrets, API keys)
#   ./infra/linode/provision.sh
#
# Optional env: LINODE_REGION (ap-west = Mumbai), LINODE_TYPE (g6-standard-2 = 4GB), LINODE_LABEL,
#               SSH_PUBKEY (default ~/.ssh/id_ed25519.pub or id_rsa.pub), DNS_PROVIDER (godaddy|linode)
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${LINODE_TOKEN:?LINODE_TOKEN is required}"
[ -f .env ] || { echo ".env missing - copy .env.example and fill it in"; exit 1; }
set -a; source .env; set +a

REGION="${LINODE_REGION:-ap-west}"
TYPE="${LINODE_TYPE:-g6-standard-2}"
LABEL="${LINODE_LABEL:-marketing-fleet}"
IMAGE="${LINODE_IMAGE:-linode/ubuntu24.04}"
DNS_PROVIDER="${DNS_PROVIDER:-godaddy}"
SSH_PUBKEY="${SSH_PUBKEY:-$(cat ~/.ssh/id_ed25519.pub 2>/dev/null || cat ~/.ssh/id_rsa.pub)}"
ROOT_PASS="${LINODE_ROOT_PASS:-$(openssl rand -base64 24)}"
API="https://api.linode.com/v4"
auth=(-H "Authorization: Bearer $LINODE_TOKEN" -H "Content-Type: application/json")

echo ">> looking for an existing Linode labelled '$LABEL'"
LINODE_JSON=$(curl -sS "${auth[@]}" "$API/linode/instances" | python3 -c "import sys,json; d=[l for l in json.load(sys.stdin)['data'] if l['label']=='$LABEL']; print(json.dumps(d[0]) if d else '')")
if [ -z "$LINODE_JSON" ]; then
  echo ">> creating Linode $TYPE in $REGION"
  USER_DATA=$(base64 -w0 infra/linode/cloud-init.yaml 2>/dev/null || base64 infra/linode/cloud-init.yaml | tr -d '\n')
  BODY=$(python3 - "$REGION" "$TYPE" "$LABEL" "$IMAGE" "$ROOT_PASS" "$SSH_PUBKEY" "$USER_DATA" <<'PY'
import json, sys
region, type_, label, image, root_pass, key, user_data = sys.argv[1:]
print(json.dumps({"region": region, "type": type_, "label": label, "image": image, "root_pass": root_pass,
                  "authorized_keys": [key.strip()], "booted": True, "tags": ["marketing-fleet"],
                  "metadata": {"user_data": user_data}}))
PY
)
  LINODE_JSON=$(curl -sS "${auth[@]}" -X POST "$API/linode/instances" -d "$BODY")
  echo "$LINODE_JSON" | grep -q '"id"' || { echo "create failed: $LINODE_JSON"; exit 1; }
  echo ">> root password (store it safely): $ROOT_PASS"
fi
IP=$(echo "$LINODE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['ipv4'][0])")
echo ">> server IP: $IP"

echo ">> pointing DNS ($DNS_PROVIDER) at $IP"
python3 infra/dns.py --ip "$IP" --provider "$DNS_PROVIDER"

echo ">> waiting for SSH"
for i in $(seq 1 60); do
  if ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 -o BatchMode=yes root@"$IP" true 2>/dev/null; then break; fi
  sleep 10
done
echo ">> waiting for cloud-init (docker install)"
ssh root@"$IP" 'cloud-init status --wait >/dev/null 2>&1 || true; command -v docker >/dev/null || (curl -fsSL https://get.docker.com | sh)'

echo ">> syncing repository to /opt/marketing-fleet"
rsync -az --delete --exclude .git --exclude '.venv' --exclude '__pycache__' --exclude 'autopub/data' ./ root@"$IP":/opt/marketing-fleet/
scp -q .env root@"$IP":/opt/marketing-fleet/.env

echo ">> bootstrapping (compose up + WordPress install). This takes a few minutes."
ssh root@"$IP" 'cd /opt/marketing-fleet && ./infra/bootstrap.sh'

echo ">> pulling back .env with the generated WordPress application passwords"
scp -q root@"$IP":/opt/marketing-fleet/.env .env

cat <<MSG

DONE. Server: $IP
Sites (HTTPS certificates appear a few minutes after DNS propagates):
$(python3 -c "import yaml; [print('  https://'+s['domain']+'/wp-admin') for s in yaml.safe_load(open('autopub/config/sites.yaml'))['sites']]")
Admin login: $WP_ADMIN_USER / (WP_ADMIN_PASSWORD from .env)

Watch the publisher:  ssh root@$IP 'cd /opt/marketing-fleet && docker compose logs -f autopub'
MSG
