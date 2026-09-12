#!/usr/bin/env bash
# Copy the repo-local plugins into their WordPress containers and activate them. Run on the server
# from the repo root after `git pull`:
#   ./infra/wp/deploy-plugins.sh            # every site that has one
#   ./infra/wp/deploy-plugins.sh SCREENSTAT # just one
#
# `make up` does NOT do this. WordPress lives in a named volume, not a bind mount, so compose can
# recreate every container without a single plugin file changing - which looks like a successful
# deploy while the old code keeps running. init-sites.sh does copy them, but it also reinstalls
# themes and rotates the autopub application passwords, which is far more than a code update needs.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Keep in step with LOCAL_PLUGINS in init-sites.sh.
declare -A LOCAL_PLUGINS=(
  [SCREENSTAT]="screenstat-pulse"
)

WANT="${1:-}"
for KEY in "${!LOCAL_PLUGINS[@]}"; do
  [ -n "$WANT" ] && [ "$WANT" != "$KEY" ] && continue
  slug=$(echo "$KEY" | tr '[:upper:]' '[:lower:]')
  for lp in ${LOCAL_PLUGINS[$KEY]}; do
    [ -d "plugins/$lp" ] || { echo "!! plugins/$lp missing in the repo"; exit 1; }
    echo "== $lp -> wp_${slug}"
    # rm before cp so a file deleted in the repo does not linger in the container. The plugin is
    # briefly absent; WordPress keeps it in active_plugins and picks it straight back up.
    docker compose exec -T "wp_${slug}" rm -rf "/var/www/html/wp-content/plugins/${lp}"
    docker compose cp "plugins/${lp}" "wp_${slug}:/var/www/html/wp-content/plugins/${lp}"
    docker compose exec -T "wp_${slug}" chown -R www-data:www-data "/var/www/html/wp-content/plugins/${lp}"
    # Loading WordPress runs plugins_loaded, so any dbDelta migration the new code carries happens here.
    docker compose run --rm -T "cli_${slug}" plugin activate "$lp" </dev/null
    docker compose run --rm -T "cli_${slug}" plugin list --name="$lp" --fields=name,status,version </dev/null
  done
done
echo
echo "Done. If the plugin ships an admin app, hard-refresh its screen once (Ctrl/Cmd-Shift-R):"
echo "ES module imports are not cache-busted by WordPress's ?ver= query."
