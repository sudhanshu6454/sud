#!/usr/bin/env bash
# Afflino: the owner's Amazon.in Associates steps on the Linode, one line each.
# Run as root on the Linode, after the installer (docs/runbooks/deploy.md,
# "Amazon.in Associates", has the order and what to expect):
#
#   bash /opt/afflino/affiliate/deploy/linode/amazon.sh keys       Store ID, the in-house share, optional Creators API keys
#   bash /opt/afflino/affiliate/deploy/linode/amazon.sh template   a starting tracking-ID file of the in-house Facebook /
#                                                                  Instagram pages and afflino.com
#   bash /opt/afflino/affiliate/deploy/linode/amazon.sh plan 50    tracking-ids.csv for the 50 most-viewed pages (the Meta
#                                                                  exports in /etc/afflino/meta) and afflino.com, and the
#                                                                  list of tracking IDs to create in Associates Central
#   bash /opt/afflino/affiliate/deploy/linode/amazon.sh setup      the programme, the account, placements, tracking IDs;
#                                                                  the Associate statement in every page's footer
#   bash /opt/afflino/affiliate/deploy/linode/amazon.sh offers     the ASIN list (and the shop's product shelves; never a celebrity look)
#   bash /opt/afflino/affiliate/deploy/linode/amazon.sh links      the tracked links → /etc/afflino/amazon/links.csv
#                                                                  (refused until the privacy notice is published)
#   bash /opt/afflino/affiliate/deploy/linode/amazon.sh shop       the shop shows the Amazon looks (same condition)
#   bash /opt/afflino/affiliate/deploy/linode/amazon.sh import     every new earnings report in /etc/afflino/amazon/reports
#   bash /opt/afflino/affiliate/deploy/linode/amazon.sh returns    the returns an import could not match: you pick the sale
#   bash /opt/afflino/affiliate/deploy/linode/amazon.sh check      counts, and one /r/ link's Location header
#   bash /opt/afflino/affiliate/deploy/linode/amazon.sh pause      the kill switch: every Amazon link serves the paused page
#   bash /opt/afflino/affiliate/deploy/linode/amazon.sh resume     … and back
#
# Files (outside the checkout, so updates keep working):
#   /etc/afflino/afflino.env                 AMAZON_STORE_ID, AMAZON_PUBLISHER_SHARE_BPS,
#                                            AMAZON_CREATORS_CREDENTIAL_ID / _SECRET (keys),
#                                            AMAZON_ASSOCIATE (setup), WEB_PLACEMENT_ID, WEB_API_TOKEN (shop)
#   /etc/afflino/amazon/tracking-ids.csv     platform,account,tracking_id[,url] — one row per page
#                                            listed on the Associates account (setup)
#   /etc/afflino/amazon/asins.csv            asin_or_url,brand,model,category[,look] (offers; brand / model /
#                                            category and look in your own words: never a celebrity's name,
#                                            never "worn by", "dupe", "<Brand> style" …: the whole file is refused)
#   /etc/afflino/amazon/reports/             earnings downloads; imported ones move to reports/imported/
#   /etc/afflino/amazon/setup.json, links.csv, tracking-ids.template.csv   written here
#
# Secrets: the Store ID and the Creators API id and secret are read at hidden
# prompts (from standard input; on a terminal nothing is echoed), written
# only to /etc/afflino/afflino.env (root:root 0600) and never printed, logged
# or put on a command line: they reach a container through the environment
# (docker compose run -e NAME, the value in this script's environment only)
# or through compose's own reading of the environment file. The shop's
# read-only token is minted inside the api container and goes straight into
# the environment file.
#
# Every step is idempotent (the Amazon CLI in the api image never remaps a
# tracking ID, never re-mints an existing link, never re-imports a row).
#
# TEST-ONLY settings (rehearsing this script off the Linode; never needed there):
#   AFFLINO_DIR=/opt/afflino  AFFLINO_ENV_FILE=/etc/afflino/afflino.env  AFFLINO_PROJECT=afflino
#   AFFLINO_EDGE_TEST=1  AFFLINO_EXTRA_COMPOSE_FILE=f     as for install.sh
#   AFFLINO_AMAZON_DIR=/etc/afflino/amazon                the files above
#   AFFLINO_META_DIR=/etc/afflino/meta                    the Meta exports plan ranks pages by
#   AFFLINO_REDIRECT_URL=http://127.0.0.1:3001            where check asks the redirect
#   AFFLINO_WEB_URL=http://127.0.0.1:3002                 where links / shop read /privacy
#   AFFLINO_AMAZON_ALLOW_TEST_VALUES=1                    let the CLI accept TEST values (demo-21,
#                                                         B0DEMO…): it runs with NODE_ENV=development
#   AFFLINO_AMAZON_SKIP_PRIVACY_CHECK=1                   let links / shop run while /privacy is the stub
#
# The privacy notice: `links` and `shop` refuse while afflino.com/privacy is
# still the stub page (it carries data-document-status="stub"). OA §5: the
# Associate must disclose "how you collect, use, store, and disclose data
# collected from visitors, including … that third parties (including us and
# other advertisers) may … place or recognize cookies on visitors' browsers".
# Counsel's text replaces the stub in the web app; then both steps run.

set -Eeuo pipefail

main() {
  local DIR="${AFFLINO_DIR:-/opt/afflino}"
  local ENV_FILE="${AFFLINO_ENV_FILE:-/etc/afflino/afflino.env}"
  local PROJECT="${AFFLINO_PROJECT:-afflino}"
  local AMZ="${AFFLINO_AMAZON_DIR:-/etc/afflino/amazon}"
  local REDIRECT="${AFFLINO_REDIRECT_URL:-http://127.0.0.1:3001}"
  local WEB="${AFFLINO_WEB_URL:-http://127.0.0.1:3002}"
  local APP="$DIR/affiliate"
  local SELF_LINE="bash $APP/deploy/linode/amazon.sh"
  local UPDATE_LINE="bash <(curl -fsSL https://raw.githubusercontent.com/sudhanshu6454/sud/refs/heads/claude/nifty-pasteur-flrulw/affiliate/deploy/linode/install.sh)"
  local cmd="${1:-}"

  say()  { printf '%s\n' "$*"; }
  info() { printf '   %s\n' "$*"; }
  warn() { printf '   WARNING: %s\n' "$*" >&2; }
  die()  { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }
  next() { printf '\nNext: %s\n' "$*"; }
  have() { command -v "$1" >/dev/null 2>&1; }
  is_on() { case "${1:-}" in 1|yes|true|on) return 0 ;; *) return 1 ;; esac; }

  case "$cmd" in
    keys|template|plan|setup|offers|links|shop|import|returns|check|pause|resume) ;;
    *)
      say "usage: $SELF_LINE keys|template|plan <pages>|setup|offers|links|shop|import|returns|check|pause|resume"
      say "(docs/runbooks/deploy.md, \"Amazon.in Associates\", has the order)"
      [ -z "$cmd" ] && exit 2
      die "unknown step '$cmd'"
      ;;
  esac

  [ "$(id -u)" -eq 0 ] || die "run this as root on the Linode."
  [ -f "$APP/docker-compose.prod.yml" ] || die "no Afflino checkout at $APP (run the installer first: $UPDATE_LINE)"
  [ -f "$ENV_FILE" ] || die "no $ENV_FILE (run the installer first: $UPDATE_LINE)"
  have docker || die "docker is not installed (run the installer first)"
  have python3 || die "python3 is not installed"

  # ------------------------------------------------------------ env file
  env_get() {
    local line v
    line="$(grep -E "^[[:space:]]*$1=" "$ENV_FILE" | tail -n 1 || true)"
    v="${line#*=}"
    case "$v" in \"*\") v="${v#\"}"; v="${v%\"}" ;; \'*\') v="${v#\'}"; v="${v%\'}" ;; esac
    printf '%s' "$v"
  }
  # Replace (or add) KEY=VALUE lines in one atomic write, root:root 0600.
  # Arguments: KEY VALUE [KEY VALUE ...]. Values are never printed.
  env_set() {
    local dir tmp k v keep
    dir="$(dirname "$ENV_FILE")"
    tmp="$(mktemp "$dir/.afflino.env.XXXXXX")"
    chmod 600 "$tmp"
    # (the marker line of an earlier run goes too: the keys move to the end)
    keep="$(grep -v '^# Set by deploy/linode/amazon.sh on ' "$ENV_FILE" || true)"
    local args=("$@") i
    for ((i = 0; i < ${#args[@]}; i += 2)); do
      k="${args[i]}"
      keep="$(printf '%s\n' "$keep" | grep -Ev "^[[:space:]]*$k=" || true)"
    done
    {
      printf '%s\n' "$keep"
      printf '# Set by deploy/linode/amazon.sh on %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      for ((i = 0; i < ${#args[@]}; i += 2)); do
        k="${args[i]}"; v="${args[i + 1]}"
        printf '%s=%s\n' "$k" "$v"
      done
    } >"$tmp"
    chown root:root "$tmp" 2>/dev/null || true
    mv -f "$tmp" "$ENV_FILE"
  }
  # A value the environment file can hold unquoted (compose reads it with
  # interpolation: no $, quotes, backslashes, # or whitespace).
  safe_value() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._~+/=:@,-]+$'; }

  # --------------------------------------------------------------- compose
  local files=(-f "$APP/docker-compose.prod.yml" -f "$APP/docker-compose.single-host.yml")
  if is_on "${AFFLINO_EDGE_TEST:-}"; then files+=(-f "$APP/docker-compose.edge-test.yml"); fi
  if [ -n "${AFFLINO_EXTRA_COMPOSE_FILE:-}" ]; then files+=(-f "$AFFLINO_EXTRA_COMPOSE_FILE"); fi
  # As install.sh: the environment file is the only source of the stack's
  # variables (a variable exported in the owner's shell would win over it),
  # except the two this script passes on purpose (set below from the file).
  local unset_args=() key
  while IFS= read -r key; do
    case "$key" in AMAZON_STORE_ID|AMAZON_PUBLISHER_SHARE_BPS) continue ;; esac
    unset_args+=(-u "$key")
  done < <(grep -Eo '^[A-Z][A-Z0-9_]*=' "$APP/.env.prod.example" | tr -d '=' | sort -u; printf '%s\n' COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES)
  unset AMAZON_STORE_ID AMAZON_PUBLISHER_SHARE_BPS
  dc() { env "${unset_args[@]}" docker compose --project-directory "$APP" -p "$PROJECT" --env-file "$ENV_FILE" "${files[@]}" "$@"; }
  # The api image's Amazon CLI (node dist/cli/amazon.js) with the Amazon
  # files mounted read-only at /app/config/amazon. Standard input is never
  # handed to the container.
  local node_env_args=()
  if is_on "${AFFLINO_AMAZON_ALLOW_TEST_VALUES:-}"; then
    node_env_args=(-e NODE_ENV=development)
    warn "AFFLINO_AMAZON_ALLOW_TEST_VALUES: the CLI accepts TEST values (test only; never on the Linode)"
  fi
  cli() {
    dc run --rm --no-deps -T -v "$AMZ:/app/config/amazon:ro" "${node_env_args[@]}" \
      -e AMAZON_STORE_ID -e AMAZON_PUBLISHER_SHARE_BPS api node dist/cli/amazon.js "$@" </dev/null
  }
  stack_up() {
    [ -n "$(dc ps -q --status running api 2>/dev/null)" ] || die "the api is not running (run the installer line first: $UPDATE_LINE)"
  }
  # Input files: readable by the containers' user (node, uid 1000).
  share_inputs() {
    install -d -m 0755 "$AMZ" "$AMZ/reports"
    find "$AMZ" -maxdepth 2 -type f \( -name '*.csv' -o -name '*.tsv' -o -name '*.txt' \) -exec chmod 0644 {} +
  }
  json_get() { python3 -c 'import json,sys
v=json.load(open(sys.argv[1]))
for k in sys.argv[2].split("."):
    v=v.get(k) if isinstance(v, dict) else None
print("" if v is None else v)' "$1" "$2"; }
  # Amazon's proprietary terms (PR 12; OA §7's list of its marks is non-exhaustive:
  # the owner checks the rest), on the ID without hyphens, as the CLI checks them.
  has_amazon_term() {
    local stem="${1%-21}"
    stem="${stem//-/}"
    case "$stem" in
      *amazon*|*amzn*|*amazn*|*amzon*|*amaz0n*|*amaozn*|*amzaon*|*kindle*|*kindel*|*kindl*|*kndle*) return 0 ;;
      *alexa*|*echo*|*prime*|*audible*|*firetv*|*firestick*|*imdb*|*zappos*|*wholefoods*) return 0 ;;
      *) return 1 ;;
    esac
  }
  # The privacy notice is published: /privacy answers 200 and is no longer the stub page.
  privacy_gate() {
    if is_on "${AFFLINO_AMAZON_SKIP_PRIVACY_CHECK:-}"; then
      warn "AFFLINO_AMAZON_SKIP_PRIVACY_CHECK: the privacy-notice check is skipped (test only; never on the Linode)"
      return 0
    fi
    local body code
    body="$(mktemp)"
    code="$(curl -s --noproxy '*' --max-time 15 -o "$body" -w '%{http_code}' "$WEB/privacy" || true)"
    if [ "$code" != 200 ]; then
      rm -f "$body"
      die "the site's /privacy page did not answer (HTTP ${code:-none} from $WEB); is the web running? ($SELF_LINE check)"
    fi
    if grep -q 'data-document-status="stub"' "$body"; then
      rm -f "$body"
      die "afflino.com/privacy is still the stub page. Amazon requires a privacy notice that says third parties, Amazon included, may place or recognise cookies (OA §5): counsel's text goes on /privacy first (docs/runbooks/deploy.md §1A, \"What you need first\"); nothing was changed"
    fi
    rm -f "$body"
  }
  # The Associate statement is in every page's footer (AMAZON_ASSOCIATE=on, set by setup).
  associate_gate() {
    [ "$(env_get AMAZON_ASSOCIATE)" = on ] || die "the Associate statement is not in the site's footer yet (AMAZON_ASSOCIATE): run $SELF_LINE setup first"
  }
  # Restart the web with the environment file's settings and wait until it is healthy.
  restart_web() {
    local upout web_id i
    upout="$(dc up -d --no-deps web 2>&1)" || { printf '%s\n' "$upout" >&2; die "the web did not restart (above)"; }
    for i in $(seq 1 40); do
      web_id="$(dc ps -q web)"
      [ -n "$web_id" ] && [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$web_id")" = healthy ] && break
      [ "$i" = 40 ] && die "the web is not healthy after 2 minutes: $SELF_LINE check, and the logs (docs/runbooks/deploy.md §1 step 8)"
      sleep 3
    done
  }

  case "$cmd" in
    # ------------------------------------------------------------------ keys
    keys)
      say "Amazon.in Associates settings in $ENV_FILE (values are never printed)"
      local store cur_store share cur_share bps cid csec cur_cid pairs=() set_names=()
      cur_store="$(env_get AMAZON_STORE_ID)"
      cur_share="$(env_get AMAZON_PUBLISHER_SHARE_BPS)"
      cur_cid="$(env_get AMAZON_CREATORS_CREDENTIAL_ID)"

      if [ -n "$cur_store" ]; then
        printf '\n   Store ID (your amazon.in Associates ID, ends in -21), hidden. Press Enter to keep the one already set: ' >&2
      else
        printf '\n   Store ID (your amazon.in Associates ID, ends in -21), hidden: ' >&2
      fi
      IFS= read -r -s store || store=""
      printf '\n' >&2
      store="$(printf '%s' "$store" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
      if [ -z "$store" ]; then
        [ -n "$cur_store" ] || die "no Store ID entered; nothing changed"
        info "Store ID: kept"
      else
        printf '%s' "$store" | grep -Eq '^[a-z0-9][a-z0-9-]{0,59}-21$' \
          || die "that is not an amazon.in Store ID (letters, digits and hyphens ending in -21); nothing changed"
        if has_amazon_term "$store"; then
          die "that Store ID contains an Amazon trademark (amazon, kindle, alexa, echo, prime, audible, fire tv, imdb, …), which Amazon forbids in an Associates ID (PR 12); nothing changed"
        fi
        pairs+=(AMAZON_STORE_ID "$store"); set_names+=(AMAZON_STORE_ID)
      fi
      store=""

      if printf '%s' "$cur_share" | grep -Eq '^[0-9]+$'; then
        printf '   The in-house network'"'"'s share of Amazon'"'"'s fee, in percent (0-100). Press Enter to keep %s%%: ' "$((10#$cur_share / 100)).$(printf '%02d' $((10#$cur_share % 100)))" >&2
      else
        printf '   The in-house network'"'"'s share of Amazon'"'"'s fee, in percent (0-100; the rest is the platform'"'"'s): ' >&2
      fi
      IFS= read -r share || share=""
      share="$(printf '%s' "$share" | tr -d '[:space:]%')"
      if [ -z "$share" ]; then
        [ -n "$cur_share" ] || die "no share entered; nothing changed (it sets the first contract: every Amazon fee is split by it)"
        info "share: kept"
      else
        printf '%s' "$share" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,2})?$' || die "the share must be a percentage such as 70 or 72.5; nothing changed"
        local whole="${share%%.*}" frac=""
        [ "$whole" != "$share" ] && frac="${share#*.}"
        frac="${frac}00"; frac="${frac:0:2}"
        bps=$((10#$whole * 100 + 10#$frac))
        [ "$bps" -le 10000 ] || die "the share cannot be more than 100%; nothing changed"
        pairs+=(AMAZON_PUBLISHER_SHARE_BPS "$bps"); set_names+=(AMAZON_PUBLISHER_SHARE_BPS)
      fi

      if [ -n "$cur_cid" ]; then
        printf '   Creators API credential ID, hidden. Press Enter to keep the one already set: ' >&2
      else
        printf '   Optional: Creators API credential ID (Amazon issues it only after final acceptance and\n   10 qualifying sales in 30 days), hidden. Press Enter to skip: ' >&2
      fi
      IFS= read -r -s cid || cid=""
      printf '\n' >&2
      cid="$(printf '%s' "$cid" | tr -d '[:space:]')"
      if [ -n "$cid" ]; then
        safe_value "$cid" || die "the credential ID has characters the environment file cannot hold; nothing changed"
        printf '   Creators API secret, hidden: ' >&2
        IFS= read -r -s csec || csec=""
        printf '\n' >&2
        csec="$(printf '%s' "$csec" | tr -d '[:space:]')"
        [ -n "$csec" ] || die "no secret entered; nothing changed"
        safe_value "$csec" || die "the secret has characters the environment file cannot hold; nothing changed"
        pairs+=(AMAZON_CREATORS_CREDENTIAL_ID "$cid" AMAZON_CREATORS_CREDENTIAL_SECRET "$csec")
        set_names+=(AMAZON_CREATORS_CREDENTIAL_ID AMAZON_CREATORS_CREDENTIAL_SECRET)
      elif [ -n "$cur_cid" ]; then
        info "Creators API credentials: kept"
      else
        info "Creators API: skipped (Amazon offers show no price until they are set; links and earnings work without)"
      fi
      cid=""; csec=""

      if [ "${#pairs[@]}" -gt 0 ]; then
        env_set "${pairs[@]}"
        pairs=()
        info "set in $ENV_FILE (root:root 0600): ${set_names[*]}"
        next "the update line, so the workers read the new settings: $UPDATE_LINE"
      else
        info "nothing changed"
      fi
      ;;

    # -------------------------------------------------------------- template
    template)
      stack_up
      share_inputs
      local out="$AMZ/tracking-ids.template.csv"
      cli template >"$out.new" || { rm -f "$out.new"; die "the template could not be written (above)"; }
      mv -f "$out.new" "$out"; chmod 0644 "$out"
      info "written: $out ($(($(wc -l <"$out") - 1)) pages: Facebook, Instagram and afflino.com only; Amazon links never go on"
      info "Snapchat, Telegram or WhatsApp)"
      info "Keep only the rows of the pages listed on your Associates account (at most 100 tracking IDs"
      info "per account), write one tracking ID per row, and save it as $AMZ/tracking-ids.csv."
      ;;

    # ------------------------------------------------------------------ plan
    # plan <N>: tracking-ids.csv for the N most-viewed Facebook / Instagram
    # pages of the template (views from the Meta exports the network was built
    # from) plus afflino.com. The IDs are numbered under the Store ID, after
    # the pattern Amazon's own help gives ("storeid-1-21 ... storeid-2-21"), as
    # <store>-p01-21 ... (the "p" keeps page 21's name from being the Store ID
    # itself), so no other Associate holds them and they carry no Amazon term. Tracking IDs are
    # public by nature (every link carries its tag), so the list is printed; the
    # Store ID itself is not.
    plan)
      local n="${2:-}" meta="${AFFLINO_META_DIR:-/etc/afflino/meta}" tpl="$AMZ/tracking-ids.template.csv" out="$AMZ/tracking-ids.csv" store
      if ! printf '%s' "$n" | grep -Eq '^[0-9]{1,2}$' || [ "$((10#$n))" -lt 1 ] || [ "$((10#$n))" -gt 99 ]; then
        die "usage: $SELF_LINE plan <pages, 1-99> (afflino.com takes one more tracking ID; Amazon allows 100 per account)"
      fi
      n="$((10#$n))"
      store="$(env_get AMAZON_STORE_ID)"
      [ -n "$store" ] || die "no Store ID yet: run $SELF_LINE keys first"
      [ -f "$tpl" ] || die "no $tpl yet: run $SELF_LINE template first"
      ls "$meta"/*.csv >/dev/null 2>&1 || die "no Meta exports in $meta to rank the pages by (docs/runbooks/deploy.md, \"The in-house network\", step 2)"
      if [ -f "$out" ]; then
        out="$AMZ/tracking-ids.plan.csv"
        warn "$AMZ/tracking-ids.csv already exists and is kept; this plan is written to $out instead"
      fi
      AFFLINO_PLAN_STORE="$store" python3 "$APP/deploy/linode/amazon-plan.py" "$tpl" "$meta" "$n" "$out.new" || { rm -f "$out.new"; die "the plan could not be written (above); nothing changed"; }
      mv -f "$out.new" "$out"; chmod 0644 "$out"
      info "written: $out"
      if [ "$out" = "$AMZ/tracking-ids.csv" ]; then
        next "create those tracking IDs and list those pages on the Associates account, then: $SELF_LINE setup"
      else
        next "compare $out with $AMZ/tracking-ids.csv; to use the plan: mv $out $AMZ/tracking-ids.csv"
      fi
      ;;

    # ----------------------------------------------------------------- setup
    setup)
      stack_up
      share_inputs
      [ -s "$AMZ/tracking-ids.csv" ] || die "no $AMZ/tracking-ids.csv yet (docs/runbooks/deploy.md, \"Amazon.in Associates\", step 3)"
      AMAZON_STORE_ID="$(env_get AMAZON_STORE_ID)"
      AMAZON_PUBLISHER_SHARE_BPS="$(env_get AMAZON_PUBLISHER_SHARE_BPS)"
      [ -n "$AMAZON_STORE_ID" ] || die "no AMAZON_STORE_ID in $ENV_FILE yet: run $SELF_LINE keys"
      export AMAZON_STORE_ID AMAZON_PUBLISHER_SHARE_BPS
      local site_host
      site_host="$(env_get SITE_HOST)"; site_host="${site_host:-afflino.com}"
      local out="$AMZ/setup.json"
      if ! cli setup --properties /app/config/amazon/tracking-ids.csv --shop-host "$site_host" >"$out.new"; then
        rm -f "$out.new"
        die "setup refused or failed (the reasons are above); nothing was written"
      fi
      mv -f "$out.new" "$out"; chmod 0600 "$out"
      unset AMAZON_STORE_ID AMAZON_PUBLISHER_SHARE_BPS
      python3 - "$out" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
pl = s["placements"]
own = [p for p in pl if p["tracking_id"]]
print(f"   programme {s['programme_id']} ({s['programme_status']}), account {s['account_id']}")
print(f"   {len(pl)} declared page(s): {len(own)} with their own tracking ID, {len(pl) - len(own)} on the store ID; {s['tracking_ids_added']} tracking ID(s) added now")
print(f"   the shop's placement (web_placement_id): {s['web_placement_id'] or 'none: afflino.com is not in the file'}")
if len(pl) - len(own):
    print("   note: pages on the store ID get no links (their sales could not be attributed); give each its own tracking ID")
PY
      info "written: $out"
      # Identify the site as an Amazon Associate from now on, shop placement or not
      # (help GPXFHVYZMTGPUMPE: "identify yourself on your Site as an Amazon Associate").
      if [ "$(env_get AMAZON_ASSOCIATE)" != on ]; then
        env_set AMAZON_ASSOCIATE on
        restart_web
        info "set in $ENV_FILE: AMAZON_ASSOCIATE; the web runs with it (healthy): every page's footer shows the Associate statement"
      else
        info "every page's footer already shows the Associate statement (AMAZON_ASSOCIATE=on)"
      fi
      next "$SELF_LINE offers"
      ;;

    # ---------------------------------------------------------------- offers
    offers)
      stack_up
      share_inputs
      [ -s "$AMZ/asins.csv" ] || die "no $AMZ/asins.csv yet (docs/runbooks/deploy.md, \"Amazon.in Associates\", step 3)"
      local out="$AMZ/offers.json"
      if ! cli offers --file /app/config/amazon/asins.csv >"$out.new"; then
        rm -f "$out.new"; die "the ASIN list was refused (the reasons are above); nothing was written"
      fi
      mv -f "$out.new" "$out"; chmod 0600 "$out"
      python3 - "$out" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
o = s["offers"]
print(f"   {len(o)} offer(s): {sum(1 for x in o if x['created'])} new, {sum(1 for x in o if x['status'] == 'active')} active; no prices until the product API supplies them")
kept = s.get("kept_not_accessible", [])
if kept:
    print(f"   {len(kept)} stay paused: Amazon's product API reported them not accessible ({', '.join(kept[:5])}{' …' if len(kept) > 5 else ''}); the price refresh brings each back when Amazon lists it again")
for l in s.get("looks", []):
    print(f"   shelf '{l['title']}': {l['status']}, {l['items_added']} product(s) added (no match verdict: celebrity looks come from the library)")
PY
      next "$SELF_LINE links"
      ;;

    # ----------------------------------------------------------------- links
    links)
      stack_up
      associate_gate
      privacy_gate
      share_inputs
      local out="$AMZ/links.csv" rc=0
      cli links --format csv >"$out.new" || rc=$?
      if [ ! -s "$out.new" ]; then rm -f "$out.new"; die "no links were written (the reasons are above)"; fi
      mv -f "$out.new" "$out"; chmod 0644 "$out"
      info "written: $out ($(($(wc -l <"$out") - 1)) links: platform, account, tracking ID, ASIN, product, look, post label, link)"
      info "every post starts with its post_label (the link-level disclosure) and follows the rules of docs/runbooks/deploy.md §1A step 6"
      [ "$rc" -eq 0 ] || die "some links were refused (listed above); the sheet holds the others"
      next "$SELF_LINE shop"
      ;;

    # ------------------------------------------------------------------ shop
    shop)
      stack_up
      [ -s "$AMZ/setup.json" ] || die "run $SELF_LINE setup first"
      associate_gate
      privacy_gate
      local wp org
      wp="$(json_get "$AMZ/setup.json" web_placement_id)"
      org="$(json_get "$AMZ/setup.json" org_id)"
      [ -n "$wp" ] || die "the tracking-ID file has no row for the shop itself (web,$(env_get SITE_HOST)): add it, run setup again, then this"
      python3 - "$AMZ/setup.json" <<'PY' || warn "the shop's page carries the store ID: its items show no link until it has its own tracking ID (add it to the file, run setup and links again)"
import json, sys
s = json.load(open(sys.argv[1]))
p = next(p for p in s["placements"] if p["placement_id"] == s["web_placement_id"])
sys.exit(0 if p["tracking_id"] else 1)
PY
      local pairs=() names=() token
      [ "$(env_get WEB_PLACEMENT_ID)" = "$wp" ] || { pairs+=(WEB_PLACEMENT_ID "$wp"); names+=(WEB_PLACEMENT_ID); }
      if [ -z "$(env_get WEB_API_TOKEN)" ]; then
        token="$(dc run --rm --no-deps -T api node scripts/mint-dev-token.mjs --org-id "$org" --role publisher_analyst --sub web-shop --ttl 365d </dev/null)" \
          || die "the shop's token could not be minted"
        printf '%s' "$token" | grep -Eq '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' || die "the shop's token came back malformed"
        pairs+=(WEB_API_TOKEN "$token"); names+=(WEB_API_TOKEN)
        token=""
      fi
      if [ "${#pairs[@]}" -gt 0 ]; then
        env_set "${pairs[@]}"
        pairs=()
        info "set in $ENV_FILE: ${names[*]}"
        restart_web
        info "the web runs with them (healthy): /shop shows the live looks"
      else
        info "unchanged: the shop already uses its Amazon placement"
      fi
      next "$SELF_LINE check"
      ;;

    # ---------------------------------------------------------------- import
    import)
      stack_up
      share_inputs
      install -d -m 0755 "$AMZ/reports/imported"
      local f name n=0 failed=0
      while IFS= read -r f; do
        [ -n "$f" ] || continue
        name="$(basename "$f")"
        n=$((n + 1))
        say "== $name"
        if dc run --rm --no-deps -T -v "$AMZ/reports:/app/config/reports:ro" "${node_env_args[@]}" \
             api node dist/cli/amazon.js import-report --file "/app/config/reports/$name" </dev/null >"$AMZ/reports/.last.json"; then
          python3 - "$AMZ/reports/.last.json" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
sh, rt = s["shipped"], s["returns"]
print(f"   {s['rows_received']} row(s): shipped {sh['created']} new ({sh['attributed_tracking_id']} by tracking ID, {sh['attributed_click']} by click, {sh['suspense']} to suspense), {sh['deduped']} already imported")
print(f"   returns {rt['applied']} applied, {rt['deduped']} already applied, {rt['unmatched']} matched no single sale (nothing applied for them)")
if rt['unmatched']:
    print("   the unmatched ones: the returns step lists each with its possible sales")
PY
          mv -f "$f" "$AMZ/reports/imported/$name"
          info "moved to $AMZ/reports/imported/"
        else
          failed=$((failed + 1))
          info "NOT imported (the reason is above); the file stays in $AMZ/reports"
        fi
      done < <(find "$AMZ/reports" -maxdepth 1 -type f \( -name '*.tsv' -o -name '*.csv' -o -name '*.txt' \) -printf '%T@ %p\n' | sort -n | cut -d' ' -f2-)
      rm -f "$AMZ/reports/.last.json"
      [ "$n" -gt 0 ] || info "no new report in $AMZ/reports (copy one there first)"
      [ "$failed" -eq 0 ] || die "$failed report(s) were not imported"
      ;;

    # --------------------------------------------------------------- returns
    # The returns an import left unmatched (no single sale covered them): each
    # is listed with the sales it could belong to, you type the number of the
    # right one (a visible prompt; no secret), and the CLI's apply-return
    # reverses that sale under the import's own deterministic id, so running
    # this again, or importing the same report again, changes nothing.
    returns)
      stack_up
      install -d -m 0755 "$AMZ"
      local out="$AMZ/returns.json" total i count pick key conv res
      cli returns >"$out" || die "the unmatched returns could not be listed (above)"
      chmod 0600 "$out"
      total="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["unmatched"]))' "$out")"
      if [ "$total" -eq 0 ]; then
        rm -f "$out"
        info "no unmatched return: every return in the imported reports was applied to its sale"
        exit 0
      fi
      say "$total return(s) the import could not match to exactly one sale. For each, type the number of"
      say "the sale it belongs to (Associates Central's order reports tell), or press Enter to leave it."
      i=0
      while [ "$i" -lt "$total" ]; do
        python3 - "$out" "$i" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))["unmatched"][int(sys.argv[2])]
fee = r["fee_minor"]
print(f"\n   return {int(sys.argv[2]) + 1}: {r['date']}, tracking ID {r['tracking_id']}, ASIN {r['asin']}, fee to reverse {r['currency']} {fee // 100}.{fee % 100:02d} ({r['reason']})")
if not r["candidates"]:
    print("     no sale can take it yet (none imported with that tracking ID and ASIN, or too little left to reverse):")
    print("     import the report of the sale's month, then the report with the return again")
for n, c in enumerate(r["candidates"], 1):
    rem = c["remainder_minor"]
    when = "on or before the return" if c["dated_on_or_before_return"] else "AFTER the return"
    by = c["attributed_by"] or "nothing (in suspense)"
    print(f"     {n}) the sale of {c['date']} ({when}), {r['currency']} {rem // 100}.{rem % 100:02d} left to reverse, attributed by {by}")
PY
        count="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["unmatched"][int(sys.argv[2])]["candidates"]))' "$out" "$i")"
        if [ "$count" -gt 0 ]; then
          printf '   which sale (1-%s; Enter to leave it): ' "$count" >&2
          IFS= read -r pick || pick=""
          pick="$(printf '%s' "$pick" | tr -d '[:space:]')"
          if [ -z "$pick" ]; then
            info "left for now"
          elif printf '%s' "$pick" | grep -Eq '^[0-9]+$' && [ "$pick" -ge 1 ] && [ "$pick" -le "$count" ]; then
            key="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["unmatched"][int(sys.argv[2])]["return_key"])' "$out" "$i")"
            conv="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["unmatched"][int(sys.argv[2])]["candidates"][int(sys.argv[3]) - 1]["conversion_id"])' "$out" "$i" "$pick")"
            if res="$(cli apply-return --return-key "$key" --conversion-id "$conv")"; then
              printf '%s' "$res" | python3 -c 'import json,sys; r=json.load(sys.stdin); print("   " + ("applied: that sale is reversed by the fee, the ledger mirrored" if r["kind"] == "applied" else "already applied before: nothing changed"))'
            else
              info "not applied (the reason is above)"
            fi
          else
            info "'$pick' is not one of 1-$count: left for now"
          fi
        fi
        i=$((i + 1))
      done
      rm -f "$out"
      ;;

    # ----------------------------------------------------------------- check
    check)
      stack_up
      local out="$AMZ/status.json"
      install -d -m 0755 "$AMZ"
      cli status >"$out" || die "no status (above)"
      python3 - "$out" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
c = s["conversions"]
print(f"   programme {s['programme_status']}, account {s['account_status']}")
print(f"   pages {s['placements']} ({s['placements_with_tracking_id']} with their own tracking ID)")
o = s["offers"]
print(f"   offers active {o['active']}, stale {o['stale']}, revoked {o['revoked']}, priced now {o['priced_now']}; looks with Amazon products {s['looks_with_amazon_items']}")
print(f"   links {s['links_active']}, clicks {s['clicks']}")
print(f"   conversions {c['total']} {json.dumps(c['by_status'])}: by tracking ID {c['attributed_by_tracking_id']}, by click {c['attributed_by_click']}, in suspense {c['suspense']} {json.dumps(c['suspense_by_reason'])}")
PY
      local token
      token="$(json_get "$out" sample_link.token)"
      if [ -n "$token" ]; then
        info "one link ($(json_get "$out" sample_link.platform)/$(json_get "$out" sample_link.account), $(json_get "$out" sample_link.asin)), asked once without following it (one click row, user agent afflino-check; nothing reaches Amazon):"
        curl -s --noproxy '*' --max-time 10 -o /dev/null -D - -A 'afflino-check' "$REDIRECT/r/$token" \
          | tr -d '\r' | grep -i '^HTTP\|^location\|^set-cookie\|^x-robots-tag' | sed 's/^/     /' || true
        info "expected: 302, location https://www.amazon.in/dp/<ASIN>?tag=<that page's tracking ID>, x-robots-tag noindex, nofollow, no set-cookie"
      else
        info "no active link yet: run $SELF_LINE links"
      fi
      ;;

    # ---------------------------------------------------------- pause / resume
    pause|resume)
      stack_up
      install -d -m 0755 "$AMZ"
      local out="$AMZ/$cmd.json"
      cli "$cmd" >"$out" || die "$cmd refused (above)"
      python3 - "$out" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
print(f"   programme {s['programme_id']}: {s['status']}; cached routes cleared: {s['invalidated_routes']} (Redis reachable: {s['redis_available']})")
PY
      if [ "$cmd" = pause ]; then
        info "every Amazon link now serves the paused page (HTTP 200, no redirect, no click) and none can be minted"
        next "$SELF_LINE resume  (when it may run again)"
      else
        next "$SELF_LINE check"
      fi
      ;;
  esac
}

main "$@"
