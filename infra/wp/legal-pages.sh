#!/usr/bin/env bash
# Create or refresh the Privacy Policy page on every site and register it as WordPress's privacy
# page, so it appears at https://<domain>/privacy-policy/ and the themes' footers link to it.
# Run on the server from the repo root:
#   ./infra/wp/legal-pages.sh                       # contact@<domain> on each site
#   EMAIL=privacy@example.com ./infra/wp/legal-pages.sh   # one address for all four
#   ./infra/wp/legal-pages.sh CRAZY                 # just one site
# Re-running updates the page in place (same slug), so edits to privacy-policy.html can be shipped.
set -euo pipefail
cd "$(dirname "$0")/../.."

OPERATOR="${OPERATOR:-Digital Sukoon}"
declare -A NAMES=( [MENTALIST]="Marketing Mentalist" [CRAZY]="Crazy4Marketing" [JUNKIES]="Marketing Junkies" [SCREENSTAT]="ScreenStat" [FILMYBUFF]="Filmybuff" )
declare -A DOMAINS=( [MENTALIST]="marketingmentalist.in" [CRAZY]="crazy4marketing.com" [JUNKIES]="marketingjunkies.in" [SCREENSTAT]="screenstat.in" [FILMYBUFF]="filmybuff.com" )

WANT="${1:-}"
for KEY in MENTALIST CRAZY JUNKIES SCREENSTAT FILMYBUFF; do
  [ -n "$WANT" ] && [ "$WANT" != "$KEY" ] && continue
  slug=$(echo "$KEY" | tr '[:upper:]' '[:lower:]')
  domain="${DOMAINS[$KEY]}"; name="${NAMES[$KEY]}"; email="${EMAIL:-contact@$domain}"
  body=$(sed -e "s/{{NAME}}/$name/g" -e "s/{{DOMAIN}}/$domain/g" -e "s/{{EMAIL}}/$email/g" \
             -e "s/{{OPERATOR}}/$OPERATOR/g" -e "s/{{DATE}}/$(date +'%-d %B %Y')/g" infra/wp/privacy-policy.html)
  echo "== $KEY  https://$domain/privacy-policy/  ($email)"
  existing=$(docker compose run --rm -T "cli_${slug}" post list --post_type=page --name=privacy-policy --post_status=any --field=ID </dev/null | tr -d '[:space:]' || true)
  if [ -n "$existing" ]; then
    printf '%s' "$body" | docker compose run --rm -T "cli_${slug}" post update "$existing" - --post_status=publish --post_title="Privacy Policy" >/dev/null
    id="$existing"; echo "   updated page $id"
  else
    id=$(printf '%s' "$body" | docker compose run --rm -T "cli_${slug}" post create - --post_type=page --post_status=publish \
          --post_title="Privacy Policy" --post_name=privacy-policy --comment_status=closed --ping_status=closed --porcelain | tr -d '[:space:]')
    echo "   created page $id"
  fi
  docker compose run --rm -T "cli_${slug}" option update wp_page_for_privacy_policy "$id" </dev/null >/dev/null
  docker compose run --rm -T "cli_${slug}" cache flush </dev/null >/dev/null 2>&1 || true
done
echo
echo "Check:  for d in ${DOMAINS[*]}; do curl -s -o /dev/null -w \"\$d %{http_code}\\n\" https://\$d/privacy-policy/; done"
