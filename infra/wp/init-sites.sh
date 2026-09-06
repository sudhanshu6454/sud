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
PLUGINS="${WP_PLUGINS:-wordpress-seo wp-super-cache limit-login-attempts-reloaded}"

# Per-site custom themes shipped in themes/<dir> (repo-local, not on wordpress.org).
# Add an entry here when a site gets its own design; every other site keeps $THEME.
declare -A LOCAL_THEMES=(
  [JUNKIES]="marketing-junkies"
  [MENTALIST]="marketing-mentalist"
  [CRAZY]="crazy4marketing"
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

  echo "-- hardening + upload compression (mu-plugins, .htaccess, options)"
  # Must-use plugins load on every request and cannot be switched off from wp-admin:
  #   fleet-security.php  - XML-RPC off, no version/user leaks, security headers, spam guard
  #   fleet-media.php     - every upload re-encoded (<=1920px, q82) + WebP copies of all sizes
  docker compose exec -T "wp_${slug}" mkdir -p /var/www/html/wp-content/mu-plugins /var/www/html/wp-content/uploads
  for f in infra/wp/mu-plugins/*.php; do
    docker compose cp "$f" "wp_${slug}:/var/www/html/wp-content/mu-plugins/$(basename "$f")"
  done
  # nothing under uploads/ may execute; wp-config/xmlrpc/readme are unreachable from the web
  docker compose cp infra/wp/uploads.htaccess "wp_${slug}:/var/www/html/wp-content/uploads/.htaccess"
  if ! docker compose exec -T "wp_${slug}" grep -q "BEGIN Fleet hardening" /var/www/html/.htaccess 2>/dev/null; then
    docker compose exec -T "wp_${slug}" sh -c 'cat >> /var/www/html/.htaccess' < infra/wp/hardening.htaccess
  fi
  docker compose exec -T "wp_${slug}" chown -R www-data:www-data /var/www/html/wp-content/mu-plugins /var/www/html/wp-content/uploads/.htaccess /var/www/html/.htaccess
  wp option update users_can_register 0 >/dev/null
  wp option update comment_moderation 1 >/dev/null
  wp option update comment_registration 1 >/dev/null
  wp option update close_comments_for_old_posts 1 >/dev/null
  wp option update close_comments_days_old 30 >/dev/null
  wp option update medium_large_size_w 0 >/dev/null     # drop the never-used 768px size: fewer files per upload

  if [ "$KEY" = "MENTALIST" ]; then
    echo "-- essential pages (submit-campaign, advertise, newsletter, about)"
    # NB: never reuse $slug here - it is the site slug the wp() helper builds the cli_ container name from
    for page_spec in "submit-campaign|Submit Campaign" "advertise|Advertise" "newsletter|Newsletter" "about|About"; do
      page_slug="${page_spec%%|*}"; page_title="${page_spec##*|}"
      wp post list --post_type=page --name="$page_slug" --field=ID --posts_per_page=1 2>/dev/null | grep -q . || \
        wp post create --post_type=page --post_title="$page_title" --post_name="$page_slug" --post_status=publish >/dev/null
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

  if [ "$KEY" = "CRAZY" ]; then
    echo "-- Crazy4 Marketing: point homepage rails/hot-take/about at real sections"
    wp post list --post_type=page --name=about --field=ID --posts_per_page=1 2>/dev/null | grep -q . || \
      wp post create --post_type=page --post_title="About" --post_name=about --page_template=page-about.php --post_status=publish >/dev/null
    RAIL_SLUGS=""
    for cat in "${CATS[@]}"; do
      [ -z "$cat" ] && continue
      cat_slug=$(wp term list category --field=slug --name="$cat" 2>/dev/null | head -1)
      [ -n "$cat_slug" ] && RAIL_SLUGS="${RAIL_SLUGS:+$RAIL_SLUGS,}$cat_slug"
    done
    wp theme mod set c4_rail_cats "$(echo "$RAIL_SLUGS" | cut -d, -f1-4)" >/dev/null
    wp theme mod set c4_hot_take_cat "$(echo "$RAIL_SLUGS" | cut -d, -f1)" >/dev/null
  fi

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
