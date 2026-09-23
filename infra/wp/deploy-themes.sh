#!/usr/bin/env bash
# Copy the repo-local themes into their WordPress containers. Run on the server from the repo root
# after `git pull`:   ./infra/wp/deploy-themes.sh [SITE]
# Like deploy-plugins.sh, this exists because WordPress lives in a named volume: `make up` never
# changes a theme file, and init-sites.sh does far more than a code update needs.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Keep in step with LOCAL_THEMES in init-sites.sh.
declare -A LOCAL_THEMES=(
  [JUNKIES]="marketing-junkies"
  [MENTALIST]="marketing-mentalist"
  [CRAZY]="crazy4marketing"
  [SCREENSTAT]="screenstat"
)

WANT="${1:-}"
for KEY in "${!LOCAL_THEMES[@]}"; do
  [ -n "$WANT" ] && [ "$WANT" != "$KEY" ] && continue
  slug=$(echo "$KEY" | tr '[:upper:]' '[:lower:]'); theme="${LOCAL_THEMES[$KEY]}"
  [ -d "themes/$theme" ] || { echo "!! themes/$theme missing in the repo"; exit 1; }
  echo "== $theme -> wp_${slug}"
  # copy over the top, then remove files the repo no longer has, so a deleted template does not linger
  docker compose cp "themes/${theme}/." "wp_${slug}:/var/www/html/wp-content/themes/${theme}/"
  docker compose exec -T "wp_${slug}" chown -R www-data:www-data "/var/www/html/wp-content/themes/${theme}"
  docker compose run --rm -T "cli_${slug}" theme list --name="$theme" --fields=name,status,version </dev/null
  docker compose run --rm -T "cli_${slug}" cache flush </dev/null >/dev/null 2>&1 || true
done
echo "Done."
