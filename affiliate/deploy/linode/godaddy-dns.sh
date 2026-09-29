#!/usr/bin/env bash
# Optional: point afflino.com at this Linode through the GoDaddy DNS API.
#
#   bash /opt/afflino/affiliate/deploy/linode/godaddy-dns.sh
#
# Run it ON the Linode. It reads the server's public IPv4 and IPv6 from its
# network interfaces (no third-party lookup), asks through two hidden prompts
# for GoDaddy credentials — a personal access token (sent as
# `Authorization: Bearer <token>`; press Enter at the second prompt), or an
# API key and its secret (`sso-key <key>:<secret>`) — then:
#   A     @    → this server's IPv4 (replaces every A record for @, including
#                GoDaddy's parking / forwarding addresses)
#   AAAA  @    → this server's IPv6 (or removes AAAA @ when it has none)
#   CNAME www  kept as it is (created as www → @ only if www has no record)
# and prints each record before and after. The key and secret are held in
# memory for this run only: never written to disk, never printed, never on a
# command line (curl reads the header from a pipe).
#
# GoDaddy grants DNS API access only to eligible accounts (10 or more
# domains, or a Discount Domain Club plan) and to credentials that carry the
# domains / DNS scope; a 403 means one of those is missing. Without access,
# set the records by hand (docs/runbooks/deploy.md §1, or the installer's
# status output). Credentials: developer.godaddy.com — a personal access
# token with the DNS scope, or an API key (environment Production) and its
# secret (GoDaddy lists key/secret as deprecated for Domains). Domain
# forwarding (GoDaddy → Domain → Forwarding) is not reachable through this
# API: if it is on, turn it off by hand.
#
# TEST-ONLY settings (never needed on the Linode): AFFLINO_GODADDY_API (API
# base, default https://api.godaddy.com), AFFLINO_DNS_DOMAIN (default
# afflino.com), AFFLINO_PUBLIC_IPV4 / AFFLINO_PUBLIC_IPV6 (instead of the
# interfaces), GODADDY_API_KEY / GODADDY_API_SECRET in the environment instead
# of the prompts (GODADDY_API_SECRET unset or empty = the key is a personal
# access token; never type a real key on a command line: it lands in the
# shell history).

set -Eeuo pipefail

main() {
  local api="${AFFLINO_GODADDY_API:-https://api.godaddy.com}"
  local domain="${AFFLINO_DNS_DOMAIN:-afflino.com}"
  local ttl=600

  say()  { printf '%s\n' "$*"; }
  die()  { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }
  have() { command -v "$1" >/dev/null 2>&1; }
  have curl || die "curl is not installed"
  have python3 || die "python3 is not installed"

  # ---- this server's addresses
  local ip4="${AFFLINO_PUBLIC_IPV4:-}" ip6="${AFFLINO_PUBLIC_IPV6:-}"
  if [ -z "$ip4" ] && have ip; then
    ip4="$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|br-|veth)/ {split($4, a, "/"); print a[1]}' \
      | grep -Ev '^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)' | head -n 1 || true)"
  fi
  if [ -z "$ip6" ] && have ip; then
    ip6="$(ip -6 -o addr show scope global 2>/dev/null \
      | awk '$2 !~ /^(docker|br-|veth)/ && $0 !~ /temporary|deprecated|tentative/ {split($4, a, "/"); print a[1]}' \
      | grep -Evi '^f[cd]' | head -n 1 || true)"
  fi
  [ -n "$ip4" ] || die "no public IPv4 address found on this server's interfaces. Run this on the Linode itself."
  printf '%s' "$ip4" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || die "'$ip4' is not an IPv4 address"
  [ -z "$ip6" ] || printf '%s' "$ip6" | grep -Eq '^[0-9a-fA-F:]+$' || die "'$ip6' is not an IPv6 address"
  say "This server: IPv4 $ip4, IPv6 ${ip6:-none}"
  say "Domain: $domain (GoDaddy API $api)"

  # ---- credentials (hidden prompts; memory only). An empty secret means the
  # first value is a personal access token (Bearer); otherwise key + secret.
  local key="${GODADDY_API_KEY:-}" secret="${GODADDY_API_SECRET:-}" auth kind
  if [ -z "$key" ]; then
    { : </dev/tty; } 2>/dev/null || die "this needs a terminal for the hidden prompts"
    printf 'GoDaddy personal access token or API key, hidden: ' >/dev/tty
    IFS= read -r -s key </dev/tty || true
    printf '\n' >/dev/tty
    [ -n "$key" ] || die "nothing entered; nothing changed"
    printf 'API secret, hidden (press Enter if you pasted a personal access token): ' >/dev/tty
    IFS= read -r -s secret </dev/tty || true
    printf '\n' >/dev/tty
  fi
  [ -n "$key" ] || die "nothing entered; nothing changed"
  case "$key" in *[[:space:]\"\\]*) die "the token or key contains spaces, quotes or backslashes; paste it again" ;; esac
  case "$secret" in *[[:space:]\"\\]*) die "the secret contains spaces, quotes or backslashes; paste it again" ;; esac
  if [ -z "$secret" ]; then
    auth="Bearer $key"; kind="a personal access token"
  else
    auth="sso-key $key:$secret"; kind="an API key and secret"
  fi
  key=""; secret=""
  say "Credentials: $kind (held in memory for this run only)"

  # ---- API helper: gd METHOD PATH [JSON]; the response body lands in $resp.
  local code
  # Global (not local): the EXIT trap still needs it after an error unwinds main.
  resp="$(mktemp)"
  trap 'rm -f "$resp"' EXIT
  gd() {
    local method="$1" path="$2" body="${3:-}"
    local args=(-sS -o "$resp" -w '%{http_code}' -X "$method" -H 'Accept: application/json' --max-time 30 -K -)
    [ -n "$body" ] && args+=(-H 'Content-Type: application/json' --data-binary "$body")
    code="$(printf 'header = "Authorization: %s"\n' "$auth" | curl "${args[@]}" "$api$path")" || code="000"
  }
  message() { python3 -c 'import json,sys
try:
    d = json.load(open(sys.argv[1]))
    m = d.get("message") if isinstance(d, dict) else None
    f = d.get("fields") if isinstance(d, dict) else None
    print((m or "") + ("" if not f else " " + json.dumps(f)))
except Exception:
    print(open(sys.argv[1], errors="replace").read()[:300])' "$resp"; }
  check() { # $1 = what; exits on an error status
    case "$code" in
      2??) return 0 ;;
      401) die "GoDaddy rejected the credentials (401, $kind) while $1: a personal access token may have expired or been revoked (press Enter at the secret prompt for one); an API key must be a Production key (not OTE) with its own secret. Nothing further was changed." ;;
      403) die "GoDaddy refused API access (403) while $1: GoDaddy grants DNS API access only to accounts with 10 or more domains or a Discount Domain Club plan, or the token lacks the domains/DNS scope (create a personal access token with the DNS scope on developer.godaddy.com), or the credentials have no access to $domain. Set the records by hand at GoDaddy (DNS → DNS Records): A @ $ip4${ip6:+, AAAA @ $ip6}, keep CNAME www → @ (docs/runbooks/deploy.md §1)." ;;
      404) die "GoDaddy does not know $domain in this account (404) while $1: $(message)" ;;
      422) die "GoDaddy rejected the request as invalid (422) while $1: $(message)" ;;
      429) die "GoDaddy rate-limited the requests (429) while $1: wait a minute and run this again." ;;
      000) die "could not reach $api while $1 (network or TLS error)." ;;
      *) die "GoDaddy answered $code while $1: $(message)" ;;
    esac
  }
  records() { # $1 type, $2 name → "data1 data2" (empty when none)
    gd GET "/v1/domains/$domain/records/$1/$2"
    check "reading $1 $2"
    python3 -c 'import json,sys; print(" ".join(r.get("data","") for r in json.load(open(sys.argv[1]))))' "$resp"
  }

  # ---- before
  local a_before aaaa_before cname_before wwwa_before wwwaaaa_before
  a_before="$(records A @)"
  aaaa_before="$(records AAAA @)"
  cname_before="$(records CNAME www)"
  wwwa_before="$(records A www)"
  wwwaaaa_before="$(records AAAA www)"
  say ""
  say "Before:"
  say "  A     @    ${a_before:-(none)}"
  say "  AAAA  @    ${aaaa_before:-(none)}"
  say "  CNAME www  ${cname_before:-(none)}${wwwa_before:+   (A www: $wwwa_before)}${wwwaaaa_before:+   (AAAA www: $wwwaaaa_before)}"

  # ---- changes
  local changed=()
  if [ "$a_before" != "$ip4" ]; then
    gd PUT "/v1/domains/$domain/records/A/@" "[{\"data\":\"$ip4\",\"ttl\":$ttl}]"
    check "setting A @"
    changed+=("A @: ${a_before:-(none)} → $ip4")
  fi
  if [ -n "$ip6" ]; then
    if [ "$aaaa_before" != "$ip6" ]; then
      gd PUT "/v1/domains/$domain/records/AAAA/@" "[{\"data\":\"$ip6\",\"ttl\":$ttl}]"
      check "setting AAAA @"
      changed+=("AAAA @: ${aaaa_before:-(none)} → $ip6")
    fi
  elif [ -n "$aaaa_before" ]; then
    gd DELETE "/v1/domains/$domain/records/AAAA/@"
    check "removing AAAA @ (this server has no IPv6 address)"
    changed+=("AAAA @: $aaaa_before → (removed; this server has no IPv6)")
  fi
  if [ -n "$cname_before" ]; then
    case "$cname_before" in
      @|"$domain"|"$domain.") ;;
      *) printf '\nWARNING: CNAME www points at %s, not at %s; kept as it is. www.%s is only served here if it resolves to this server.\n' "$cname_before" "$domain" "$domain" >&2 ;;
    esac
  elif [ -z "$wwwa_before" ] && [ -z "$wwwaaaa_before" ]; then
    gd PUT "/v1/domains/$domain/records/CNAME/www" "[{\"data\":\"@\",\"ttl\":$ttl}]"
    check "creating CNAME www → @"
    changed+=("CNAME www: (none) → @")
  else
    printf '\nWARNING: www has A/AAAA records instead of the CNAME; kept as they are. Point them at this server by hand (A www %s%s) or replace them with CNAME www → @.\n' "$ip4" "${ip6:+, AAAA www $ip6}" >&2
  fi

  # ---- after
  local a_after aaaa_after cname_after
  a_after="$(records A @)"
  aaaa_after="$(records AAAA @)"
  cname_after="$(records CNAME www)"
  auth=""
  say ""
  say "After:"
  say "  A     @    ${a_after:-(none)}"
  say "  AAAA  @    ${aaaa_after:-(none)}"
  say "  CNAME www  ${cname_after:-(none)}"
  say ""
  if [ "${#changed[@]}" -eq 0 ]; then
    say "Nothing to change: the records already point at this server."
  else
    say "Changed:"
    local c
    for c in "${changed[@]}"; do say "  $c"; done
  fi
  [ "$a_after" = "$ip4" ] || die "A @ reads back as '${a_after:-none}', not $ip4. If Forwarding is on for $domain at GoDaddy, turn it off and run this again."
  say ""
  say "If Forwarding is on for $domain at GoDaddy (Domain → Forwarding), turn it off: it keeps its own records."
  say "DNS changes take minutes to propagate (TTL $ttl s). The edge fetches the certificates by itself once they do:"
  say "  docker logs -f afflino-edge-1 2>&1 | grep -i certificate"
  rm -f "$resp"
  trap - EXIT
}

main "$@"; exit
