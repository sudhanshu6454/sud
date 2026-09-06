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
  [SCREENSTAT]="screenstat"
)

# Per-site header logo (PNG in the repo) set as the WordPress custom logo; block themes draw it
# with the Site Logo block, classic themes may ignore it in favour of their own asset.
declare -A SITE_LOGOS=(
  [SCREENSTAT]="themes/screenstat/assets/images/logo-white.png"
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

# MariaDB's init script only runs on the very first start, so a site added later has no database
# until this creates it. The script is idempotent (IF NOT EXISTS / ALTER USER) and reads the
# SITE_KEYS + WP_<KEY>_DB_PASSWORD env the compose file gives the db container.
echo "-- ensuring a database + user exists for every site"
for LINE in "${SITE_LINES[@]}"; do   # a site added after first boot has no DB password yet: generate one
  K="${LINE%%|*}"; V="WP_${K}_DB_PASSWORD"
  if [ -z "${!V:-}" ]; then
    upsert_env "$V" "$(openssl rand -hex 24)"; echo "   generated $V"
  fi
done
set -a; source .env; set +a
docker compose up -d db >/dev/null
until docker compose exec -T db healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; do sleep 3; done
docker compose exec -T db bash /docker-entrypoint-initdb.d/10-init-databases.sh 2>&1 | sed 's/^/   /'

for LINE in "${SITE_LINES[@]}"; do
  IFS='|' read -r KEY DOMAIN NAME TAGLINE CATEGORIES <<< "$LINE"
  [ -z "$KEY" ] && continue
  slug=$(echo "$KEY" | tr '[:upper:]' '[:lower:]')
  wp() { docker compose run --rm -T "cli_${slug}" "$@" </dev/null; }
  echo
  echo "=================  $DOMAIN  ================="

  docker compose up -d "wp_${slug}" >/dev/null 2>&1 || true   # a newly added site is not running yet
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

  # WordPress' sample content ("Hello world!", "Sample Page") would otherwise sit in the feed and
  # the Astra menu of a new site until someone notices
  for pid in $(wp post list --post_type=post,page --name=hello-world,sample-page --field=ID 2>/dev/null); do
    wp post delete "$pid" --force >/dev/null 2>&1 || true
  done
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
  # security fixes in plugins land without anyone logging in; core already auto-updates minors
  wp plugin auto-updates enable --all >/dev/null 2>&1 || true

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
  # (re)apply the hardening block: drop the previous copy so rule changes in the repo reach every site
  docker compose exec -T "wp_${slug}" sh -c "touch /var/www/html/.htaccess && sed -i '/# BEGIN Fleet hardening/,/# END Fleet hardening/d' /var/www/html/.htaccess"
  docker compose exec -T "wp_${slug}" sh -c 'cat >> /var/www/html/.htaccess' < infra/wp/hardening.htaccess
  docker compose exec -T "wp_${slug}" chown -R www-data:www-data /var/www/html/wp-content/mu-plugins /var/www/html/wp-content/uploads/.htaccess /var/www/html/.htaccess
  wp option update users_can_register 0 >/dev/null
  wp option update comment_moderation 1 >/dev/null
  wp option update comment_registration 1 >/dev/null
  wp option update close_comments_for_old_posts 1 >/dev/null
  wp option update close_comments_days_old 30 >/dev/null
  wp option update medium_large_size_w 0 >/dev/null     # drop the never-used 768px size: fewer files per upload

  # A fresh WordPress drops its default block widgets (Search, Recent Posts, Recent Comments,
  # Archives, Categories) into the first registered sidebar. Every theme here builds its own
  # sidebar, so those render unstyled underneath it - clear them once.
  for w in $(wp widget list sidebar-1 --format=ids 2>/dev/null | tr -d '\r'); do
    wp widget delete "$w" >/dev/null 2>&1 || true
  done

  echo "-- site icon (favicon)"
  # 512px icon built from the brand mark by infra/wp/setup-favicons.py; WordPress derives the
  # 32/180/192px tags from it. Re-runs replace the previous icon instead of piling up uploads.
  FAVICON_SRC="autopub/config/brand/favicon-${slug}.png"
  if [ -f "$FAVICON_SRC" ]; then
    # stage it inside the WordPress volume - the cli_ container shares /var/www/html, not /tmp
    STAGE="/var/www/html/wp-content/uploads/fleet-site-icon-src.png"
    docker compose cp "$FAVICON_SRC" "wp_${slug}:${STAGE}"
    docker compose exec -T "wp_${slug}" chown www-data:www-data "$STAGE"
    for old_id in $(wp post list --post_type=attachment --title="Fleet Site Icon" --field=ID 2>/dev/null); do
      wp post delete "$old_id" --force >/dev/null 2>&1 || true
    done
    ATTACH_ID=$(wp media import "$STAGE" --title="Fleet Site Icon" --porcelain 2>/dev/null | tr -d '\r' | tail -1)
    docker compose exec -T "wp_${slug}" rm -f "$STAGE"
    if [ -n "$ATTACH_ID" ]; then
      wp option update site_icon "$ATTACH_ID" >/dev/null
      echo "   site icon set (attachment $ATTACH_ID)"
    else
      echo "   WARNING: site icon upload failed"
    fi
  fi

  LOGO_SRC="${SITE_LOGOS[$KEY]:-}"
  if [ -n "$LOGO_SRC" ] && [ -f "$LOGO_SRC" ]; then
    echo "-- header logo"
    STAGE="/var/www/html/wp-content/uploads/fleet-site-logo-src.png"
    docker compose cp "$LOGO_SRC" "wp_${slug}:${STAGE}"
    docker compose exec -T "wp_${slug}" chown www-data:www-data "$STAGE"
    for old_id in $(wp post list --post_type=attachment --title="Fleet Site Logo" --field=ID 2>/dev/null); do
      wp post delete "$old_id" --force >/dev/null 2>&1 || true
    done
    LOGO_ID=$(wp media import "$STAGE" --title="Fleet Site Logo" --porcelain 2>/dev/null | tr -d '\r' | tail -1)
    docker compose exec -T "wp_${slug}" rm -f "$STAGE"
    [ -n "$LOGO_ID" ] && wp theme mod set custom_logo "$LOGO_ID" >/dev/null && echo "   custom logo set (attachment $LOGO_ID)"
  fi

  if [ "$KEY" = "SCREENSTAT" ]; then
    # one-off: the section was first created as "Ratings & Data"; WordPress' classic-to-block menu
    # conversion corrupts "&" in labels, so sites.yaml now spells it without one - rename in place
    # rather than leaving a duplicate category behind
    old_tid=$(wp term list category --fields=term_id,name --format=csv 2>/dev/null | awk -F, '$2=="Ratings & Data" || $2=="\"Ratings &amp; Data\"" || $2=="Ratings &amp; Data" {print $1}' | head -1)
    [ -n "$old_tid" ] && wp term update category "$old_tid" --name="Ratings and Data" --slug=ratings-and-data >/dev/null 2>&1 && echo "   renamed 'Ratings & Data' -> 'Ratings and Data'"
    echo "-- sourcing page (linked from the footer)"
    wp post list --post_type=page --name=sourcing --field=ID --posts_per_page=1 2>/dev/null | grep -q . || \
      wp post create --post_type=page --post_title="How we source our data" --post_name=sourcing --post_status=publish \
        --post_content="<!-- wp:paragraph --><p>Every story on ScreenStat is written from a named, linked source: the publication, tracker or company announcement it draws on is cited at the end of the article with the date it was recorded. Figures are reported as published by that source and are not independently audited. Where sources disagree we say so and give the range rather than choosing one.</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>Corrections: if a figure is wrong, write to the address on the contact page and we will correct the article and note the change.</p><!-- /wp:paragraph -->" >/dev/null
  fi

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
  # exactly one menu called Primary: create it if missing, drop accidental duplicates
  MENU_IDS=$(wp menu list --fields=term_id,name --format=csv 2>/dev/null | awk -F, -v m="$MENU" 'NR>1 && $2==m {print $1}')
  if [ -z "$MENU_IDS" ]; then
    wp menu create "$MENU" >/dev/null
  else
    for extra in $(echo "$MENU_IDS" | tail -n +2); do wp menu delete "$extra" >/dev/null 2>&1 || true; done
  fi
  # rebuild from scratch. NB: `menu item list` has no --field flag (WP-CLI rejects it, so the old
  # loop silently deleted nothing and every run appended another copy of every section).
  OLD_ITEMS=$(wp menu item list "$MENU" --format=ids 2>/dev/null | tr -d '\r')
  [ -z "$OLD_ITEMS" ] || wp menu item delete $OLD_ITEMS >/dev/null 2>&1 || true
  IFS=',' read -ra CATS <<< "$CATEGORIES"
  for cat in "${CATS[@]}"; do
    [ -z "$cat" ] && continue
    term_id=$(wp term list category --field=term_id --name="$cat" 2>/dev/null | head -1)
    if [ -z "$term_id" ]; then
      term_id=$(wp term create category "$cat" --porcelain)
    fi
    wp menu item add-term "$MENU" category "$term_id" >/dev/null
  done
  for loc in primary mobile footer-sections; do   # mobile exists only on Mentalist; others no-op
    wp menu location assign "$MENU" "$loc" >/dev/null 2>&1 || true
  done
  # block themes (screenstat) render the header from a wp_navigation snapshot of the classic menu;
  # remove old snapshots so the next page view rebuilds it from the sections just written
  for nav_id in $(wp post list --post_type=wp_navigation --field=ID 2>/dev/null); do
    wp post delete "$nav_id" --force >/dev/null 2>&1 || true
  done
  echo "   sections: $CATEGORIES  ($(wp menu item list "$MENU" --format=count 2>/dev/null | tr -d '\r') menu items)"

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

  echo "-- account hygiene"
  # An author archive is reachable at /author/<nicename>/; WordPress defaults the nicename to the
  # login, which lets anyone confirm account names. Give the admin and desk accounts a nicename that
  # is not their login (fleet-security.php then 404s any /author/<login>/ request).
  wp user update "$WP_ADMIN_USER" --user_nicename="$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-')editor" >/dev/null 2>&1 || true
  if [ "$WP_ADMIN_USER" = "admin" ]; then
    echo "   !! WP_ADMIN_USER is 'admin' - the most brute-forced login on the web. Create a new administrator"
    echo "      with a unique login and a long random password, then delete 'admin' (reassigning its posts):"
    echo "        docker compose run --rm cli_${slug} user create <newlogin> ${WP_ADMIN_EMAIL} --role=administrator --user_pass=\"\$(openssl rand -base64 24)\""
    echo "        docker compose run --rm cli_${slug} user delete admin --reassign=<newlogin-id> --yes"
  fi

  echo "-- autopub user + application password"
  AUTOPUB_USER="${WP_AUTOPUB_USER:-autopub}"
  # editor: may publish posts AND create categories/tags (author cannot manage terms -> REST 403)
  if ! wp user get "$AUTOPUB_USER" --field=ID >/dev/null 2>&1; then
    wp user create "$AUTOPUB_USER" "autopub@${DOMAIN}" --role=editor --display_name="${NAME} Desk" \
      --user_pass="$(openssl rand -base64 24)" >/dev/null
  fi
  wp user set-role "$AUTOPUB_USER" editor >/dev/null
  wp user update "$AUTOPUB_USER" --user_nicename="$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-')desk" >/dev/null 2>&1 || true
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
