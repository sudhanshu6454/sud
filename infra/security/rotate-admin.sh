#!/usr/bin/env bash
# Replace the "admin" administrator on every site with a new, uniquely named administrator.
# Run on the server from the repo root:
#   ./infra/security/rotate-admin.sh newlogin
# One strong random password is generated and used on all sites; it is printed ONCE at the end
# and written to .env (WP_ADMIN_USER / WP_ADMIN_PASSWORD), which init-sites.sh reads from then on.
# The old "admin" account is deleted with all its content reassigned to the new administrator.
set -euo pipefail
cd "$(dirname "$0")/../.."
NEW="${1:-}"
[[ "$NEW" =~ ^[a-z0-9_.-]{4,40}$ ]] || { echo "usage: $0 newlogin   (4-40 chars: a-z 0-9 _ . -; not 'admin')"; exit 1; }
[ "$NEW" != "admin" ] && [ "$NEW" != "administrator" ] || { echo "pick something that is not admin/administrator"; exit 1; }
[ -f .env ] || { echo ".env missing"; exit 1; }
set -a; source .env; set +a
OLD="${WP_ADMIN_USER:-admin}"
EMAIL="${WP_ADMIN_EMAIL:?WP_ADMIN_EMAIL missing in .env}"
PASS=$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-28)

upsert_env() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '\n%s=%s\n' "$1" "$2" >> .env; fi; }

for slug in $(python3 -c "import yaml; print(' '.join(s['key'].lower() for s in yaml.safe_load(open('autopub/config/sites.yaml'))['sites']))"); do
  wp() { docker compose run --rm -T "cli_${slug}" "$@" </dev/null; }
  echo "== $slug"
  if wp user get "$NEW" --field=ID >/dev/null 2>&1; then
    wp user update "$NEW" --role=administrator --user_pass="$PASS" >/dev/null
    echo "   $NEW already existed: made administrator, password reset"
  else
    # the old admin's email must move to the new account (WordPress needs emails to be unique)
    wp user update "$OLD" --user_email="retired-${OLD}@${slug}.invalid" >/dev/null 2>&1 || true
    wp user create "$NEW" "$EMAIL" --role=administrator --user_pass="$PASS" --display_name="Editor" >/dev/null
    echo "   created administrator $NEW"
  fi
  NEW_ID=$(wp user get "$NEW" --field=ID | tr -d '\r')
  wp user update "$NEW" --user_nicename="editor-${slug}" >/dev/null 2>&1 || true
  if [ "$OLD" != "$NEW" ] && wp user get "$OLD" --field=ID >/dev/null 2>&1; then
    wp user delete "$OLD" --reassign="$NEW_ID" --yes >/dev/null
    echo "   deleted $OLD (content reassigned to $NEW)"
  fi
  # any session the old account had is gone with it; nothing else to invalidate
  echo "   administrators now: $(wp user list --role=administrator --field=user_login | tr '\n' ' ')"
done

upsert_env WP_ADMIN_USER "$NEW"
upsert_env WP_ADMIN_PASSWORD "$PASS"
chmod 600 .env
echo
echo "Done. Log in at https://<site>/wp-admin with:"
echo "   user:     $NEW"
echo "   password: $PASS"
echo "Store it in a password manager now - it is in .env on this server and nowhere else."
