#!/usr/bin/env bash
# Idempotent WordPress bootstrap for every site in autopub/config/sites.yaml.
# Run on the server from the repo root AFTER `docker compose up -d`:
#   ./infra/wp/init-sites.sh
# It installs core, theme and plugins, creates the `autopub` author and an Application
# Password per site, and writes WP_<KEY>_APP_PASSWORD into .env, then restarts autopub.
set -euo pipefail
cd "$(dirname "$0")/../.."

[ -f .env ] || { echo ".env missing (copy .env.example)"; exit 1; }
set -a; source .env; set +a

: "${WP_ADMIN_USER:?set WP_ADMIN_USER in .env}"
: "${WP_ADMIN_PASSWORD:?set WP_ADMIN_PASSWORD in .env}"
: "${WP_ADMIN_EMAIL:?set WP_ADMIN_EMAIL in .env}"
THEME="${WP_THEME:-astra}"
PLUGINS="${WP_PLUGINS:-wordpress-seo wp-super-cache}"

# Per-site custom themes shipped in themes/<dir> (repo-local, not on wordpress.org).
# Add an entry here when a site gets its own design; every other site keeps $THEME.
declare -A LOCAL_THEMES=(
  [JUNKIES]="marketing-junkies"
  [MENTALIST]="marketing-mentalist"
)

# Per-site plugins on top of $PLUGINS (space-separated wordpress.org slugs).
declare -A EXTRA_PLUGINS=(
  [MENTALIST]="advanced-custom-fields redirection safe-svg"
)

upsert_env() {  # upsert_env KEY VALUE
  if grep -q "^$1=" .env; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    printf '\n%s=%s\n' "$1" "$2" >> .env
  fi
}

# key|domain|name|tagline|categories per line, read into an array up front: the loop body runs
# docker, which would otherwise swallow the rest of a piped/heredoc list and stop after the first site.
mapfile -t SITE_LINES < <(python3 - <<'PY'
import yaml
for s in yaml.safe_load(open("autopub/config/sites.yaml"))["sites"]:
    cats = s.get("categories") or [s.get("category", "News")]
    print("|".join([s["key"].upper(), s["domain"], s["name"], s.get("tagline", ""), ",".join(cats)]))
PY
)
echo "sites to set up: ${#SITE_LINES[@]}"

for LINE in "${SITE_LINES[@]}"; do
  IFS='|' read -r KEY DOMAIN NAME TAGLINE CATEGORIES <<< "$LINE"
  [ -z "$KEY" ] && continue
  slug=$(echo "$KEY" | tr '[:upper:]' '[:lower:]')
  wp() { docker compose run --rm -T "cli_${slug}" "$@" </dev/null; }
  echo
  echo "=================  $DOMAIN  ================="

  echo "-- waiting for wp-config.php in wp_${slug}"
  for i in $(seq 1 60); do
    if docker compose exec -T "wp_${slug}" test -f /var/www/html/wp-config.php 2>/dev/null; then break; fi
    sleep 5
  done
  echo "-- waiting for database"
  until wp db check >/dev/null 2>&1; do sleep 5; done

  if ! wp core is-installed >/dev/null 2>&1; then
    echo "-- installing WordPress"
    wp core install --url="https://${DOMAIN}" --title="${NAME}" \
      --admin_user="${WP_ADMIN_USER}" --admin_password="${WP_ADMIN_PASSWORD}" \
      --admin_email="${WP_ADMIN_EMAIL}" --skip-email
  else
    echo "-- already installed"
  fi

  wp option update blogdescription "${TAGLINE}" >/dev/null
  wp option update timezone_string "${TZ:-Asia/Kolkata}" >/dev/null
  wp option update blog_public 1 >/dev/null
  wp option update permalink_structure '/%postname%/' >/dev/null
  wp rewrite flush --hard >/dev/null 2>&1 || true
  wp option update default_comment_status closed >/dev/null

  echo "-- theme + plugins"
  LOCAL_THEME="${LOCAL_THEMES[$KEY]:-}"
  if [ -n "$LOCAL_THEME" ] && [ -d "themes/$LOCAL_THEME" ]; then
    echo "-- installing local theme $LOCAL_THEME"
    docker compose exec -T "wp_${slug}" rm -rf "/var/www/html/wp-content/themes/${LOCAL_THEME}"
    docker compose cp "themes/${LOCAL_THEME}" "wp_${slug}:/var/www/html/wp-content/themes/${LOCAL_THEME}"
    docker compose exec -T "wp_${slug}" chown -R www-data:www-data "/var/www/html/wp-content/themes/${LOCAL_THEME}"
    wp theme activate "$LOCAL_THEME"
  else
    wp theme is-installed "$THEME" >/dev/null 2>&1 || wp theme install "$THEME"
    wp theme activate "$THEME" >/dev/null 2>&1 || true
  fi
  for p in $PLUGINS ${EXTRA_PLUGINS[$KEY]:-}; do
    wp plugin is-installed "$p" >/dev/null 2>&1 || wp plugin install "$p"
    wp plugin activate "$p" >/dev/null 2>&1 || true
  done
  wp plugin delete hello akismet >/dev/null 2>&1 || true

  if [ "$KEY" = "MENTALIST" ]; then
    echo "-- essential pages (submit-campaign, advertise, newsletter, about)"
    for slug_title in "submit-campaign|Submit Campaign" "advertise|Advertise" "newsletter|Newsletter" "about|About"; do
      slug="${slug_title%%|*}"; title="${slug_title##*|}"
      wp post list --post_type=page --name="$slug" --field=ID --posts_per_page=1 2>/dev/null | grep -q . || \
        wp post create --post_type=page --post_title="$title" --post_name="$slug" --post_status=publish >/dev/null
    done
  fi

  echo "-- sections + primary menu"
  # Every section exists as a category, and the header/footer menus list them all -
  # menus (unlike the category fallback) show sections that have no posts yet.
  MENU="Primary"
  wp menu list --fields=name --format=csv 2>/dev/null | tail -n +2 | grep -qx "$MENU" || wp menu create "$MENU" >/dev/null
  for item in $(wp menu item list "$MENU" --field=db_id 2>/dev/null); do
    wp menu item delete "$item" >/dev/null 2>&1 || true
  done
  IFS=',' read -ra CATS <<< "$CATEGORIES"
  for cat in "${CATS[@]}"; do
    [ -z "$cat" ] && continue
    term_id=$(wp term list category --field=term_id --name="$cat" 2>/dev/null | head -1)
    if [ -z "$term_id" ]; then
      term_id=$(wp term create category "$cat" --porcelain)
    fi
    wp menu item add-term "$MENU" category "$term_id" >/dev/null
  done
  wp menu location assign "$MENU" primary >/dev/null 2>&1 || true
  wp menu location assign "$MENU" footer-sections >/dev/null 2>&1 || true
  echo "   sections: $CATEGORIES"

  echo "-- autopub user + application password"
  AUTOPUB_USER="${WP_AUTOPUB_USER:-autopub}"
  # editor: may publish posts AND create categories/tags (author cannot manage terms -> REST 403)
  if ! wp user get "$AUTOPUB_USER" --field=ID >/dev/null 2>&1; then
    wp user create "$AUTOPUB_USER" "autopub@${DOMAIN}" --role=editor --display_name="${NAME} Desk" \
      --user_pass="$(openssl rand -base64 24)" >/dev/null
  fi
  wp user set-role "$AUTOPUB_USER" editor >/dev/null
  # rotate: drop old app passwords named autopub, create a fresh one
  for uuid in $(wp user application-password list "$AUTOPUB_USER" --name=autopub --field=uuid 2>/dev/null || true); do
    wp user application-password delete "$AUTOPUB_USER" "$uuid" >/dev/null || true
  done
  APP_PW=$(wp user application-password create "$AUTOPUB_USER" autopub --porcelain | tr -d '\r')
  upsert_env "WP_${KEY}_USER" "$AUTOPUB_USER"
  upsert_env "WP_${KEY}_APP_PASSWORD" "$APP_PW"
  echo "-- ok: https://${DOMAIN}/wp-admin  (autopub credentials written to .env)"
done

echo
echo "-- restarting autopub with the new credentials"
docker compose up -d --build autopub
docker compose run --rm -T autopub python -m autopub check || true
