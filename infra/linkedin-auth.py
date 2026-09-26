#!/usr/bin/env python3
"""Connect autopub to the LinkedIn Company Pages, from one login.

    python3 infra/linkedin-auth.py auth                      # one-time consent; stores a member token
    python3 infra/linkedin-auth.py orgs                      # the Pages that login administers
    python3 infra/linkedin-auth.py wire CRAZY=crazy4marketing MENTALIST="Marketing Mentalist" ...
    python3 infra/linkedin-auth.py refresh                   # renew before the 60-day expiry

LinkedIn posting is the most gated of the platforms: it needs a Developer app associated with a
verified Company Page and approved for the Community Management API, and its tokens expire after
60 days (the refresh token after a year). This script hides that plumbing behind four commands.

`auth` asks for the app's client ID and secret at hidden prompts (stored in .env for `refresh`),
prints the consent URL, and takes the URL LinkedIn redirects to in exchange for a token. `wire`
maps each site to one of the administered Pages by name or vanity URL and writes
LINKEDIN_<SITE>_ORG_URN and _ACCESS_TOKEN. `refresh` renews the token and rewrites every site's
copy. Nothing that is a secret is ever printed.
"""
from __future__ import annotations

import getpass
import json
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
API = "https://api.linkedin.com/rest"
VERSION = "202409"
SCOPES = "w_organization_social r_organization_social rw_organization_admin"
REDIRECT = "https://crazy4marketing.com/bio/"     # any page we serve; the code arrives in its query string
SITES = ("MENTALIST", "CRAZY", "JUNKIES", "SCREENSTAT", "FILMYBUFF")


# ---- .env -------------------------------------------------------------------------------------

def read_env(path: Path) -> tuple[list[str], dict[str, str]]:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    values = {}
    for line in lines:
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip()
    return lines, values


def upsert(lines: list[str], key: str, value: str) -> list[str]:
    out, done = [], False
    for line in lines:
        if line.startswith(f"{key}="):
            out.append(f"{key}={value}"); done = True
        else:
            out.append(line)
    if not done:
        out.append(f"{key}={value}")
    return out


# ---- HTTP (swapped out by tests) -------------------------------------------------------------

def post_form(url: str, data: dict) -> dict:
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        try:
            err = json.load(exc)
        except Exception:  # noqa: BLE001
            err = {}
        raise RuntimeError(err.get("error_description") or err.get("message") or f"HTTP {exc.code}") from None


def get_json(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}", "LinkedIn-Version": VERSION, "X-Restli-Protocol-Version": "2.0.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        try:
            err = json.load(exc)
        except Exception:  # noqa: BLE001
            err = {}
        raise RuntimeError(err.get("message") or f"HTTP {exc.code}") from None


# ---- steps ------------------------------------------------------------------------------------

def store_tokens(lines: list[str], tok: dict) -> list[str]:
    lines = upsert(lines, "LINKEDIN_ACCESS_TOKEN", tok["access_token"])
    lines = upsert(lines, "LINKEDIN_TOKEN_EXPIRES", time.strftime("%Y-%m-%d", time.gmtime(time.time() + int(tok.get("expires_in", 0)))))
    if tok.get("refresh_token"):
        lines = upsert(lines, "LINKEDIN_REFRESH_TOKEN", tok["refresh_token"])
    return lines


def cmd_auth(env_path: Path) -> int:
    lines, values = read_env(env_path)
    client_id = values.get("LINKEDIN_CLIENT_ID") or getpass.getpass("LinkedIn app Client ID (hidden): ").strip()
    secret = values.get("LINKEDIN_CLIENT_SECRET") or getpass.getpass("LinkedIn app Client Secret (hidden): ").strip()
    if not client_id or not secret:
        print("Client ID and secret are both needed; find them under Auth in the app at linkedin.com/developers/apps")
        return 1
    state = secrets.token_urlsafe(12)
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "response_type": "code", "client_id": client_id, "redirect_uri": REDIRECT, "scope": SCOPES, "state": state})
    print("\n1. Open this URL in a browser logged in as the account that administers the Company Pages:\n")
    print(url)
    print(f"\n2. Approve. LinkedIn sends the browser to {REDIRECT} with ?code=...&state=... in the address bar.")
    print("3. Copy that whole address and paste it here (it is not shown as you paste).\n")
    pasted = getpass.getpass("Redirected URL (hidden): ").strip()
    q = urllib.parse.parse_qs(urllib.parse.urlparse(pasted).query)
    code = (q.get("code") or [""])[0]
    if not code:
        print("No code in that URL. Paste the full address LinkedIn redirected to, including everything after '?'.")
        return 1
    if (q.get("state") or [""])[0] != state:
        print("The state does not match the one this run issued; start again and paste the URL from this attempt.")
        return 1
    tok = post_form(TOKEN_URL, {"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT,
                               "client_id": client_id, "client_secret": secret})
    lines = upsert(lines, "LINKEDIN_CLIENT_ID", client_id)
    lines = upsert(lines, "LINKEDIN_CLIENT_SECRET", secret)
    lines = store_tokens(lines, tok)
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    days = int(tok.get("expires_in", 0)) // 86400
    print(f"\nToken stored (valid about {days} days; refresh token {'stored' if tok.get('refresh_token') else 'NOT issued - re-run auth before expiry'}).")
    print("Next:  python3 infra/linkedin-auth.py orgs")
    return 0


def organizations(token: str) -> list[dict]:
    """The Pages this member administers: [{urn, id, name, vanity}]."""
    acls = get_json(f"{API}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED", token)
    out = []
    for el in acls.get("elements", []):
        urn = el.get("organization", "")
        oid = urn.rsplit(":", 1)[-1]
        try:
            org = get_json(f"{API}/organizations/{oid}", token)
        except RuntimeError as exc:
            org = {"localizedName": f"(could not read: {exc})", "vanityName": ""}
        out.append({"urn": urn, "id": oid, "name": org.get("localizedName", ""), "vanity": org.get("vanityName", "")})
    return out


def cmd_orgs(env_path: Path) -> int:
    _, values = read_env(env_path)
    token = values.get("LINKEDIN_ACCESS_TOKEN")
    if not token:
        print("No LinkedIn token in .env yet - run: python3 infra/linkedin-auth.py auth")
        return 1
    orgs = organizations(token)
    if not orgs:
        print("That login administers no Company Pages that the app may act for. Check the Page admin role and the app's Community Management API access.")
        return 1
    print(f"{'Page':<32} {'vanity':<24} URN")
    for o in orgs:
        print(f"{o['name'][:31]:<32} {o['vanity'][:23]:<24} {o['urn']}")
    print("\nNext, matching each site to a Page by its name or vanity URL, for example:")
    print("  python3 infra/linkedin-auth.py wire MENTALIST=\"Marketing Mentalist\" CRAZY=crazy4marketing JUNKIES=\"Marketing Junkies\" SCREENSTAT=screenstat")
    return 0


def match(orgs: list[dict], wanted: str) -> dict | None:
    w = wanted.strip().lower().lstrip("@")
    for o in orgs:
        if w in (o["vanity"].lower(), o["name"].lower(), o["urn"].lower(), o["id"]):
            return o
    hits = [o for o in orgs if w and (w in o["name"].lower() or w in o["vanity"].lower())]
    return hits[0] if len(hits) == 1 else None


def cmd_wire(env_path: Path, pairs: list[str], orgs: list[dict] | None = None) -> int:
    lines, values = read_env(env_path)
    token = values.get("LINKEDIN_ACCESS_TOKEN")
    if not token:
        print("No LinkedIn token in .env yet - run: python3 infra/linkedin-auth.py auth")
        return 1
    if not pairs:
        print("Give SITE=Page pairs, e.g. CRAZY=crazy4marketing. Run `orgs` to see the Pages.")
        return 2
    orgs = orgs if orgs is not None else organizations(token)
    plan, missing = [], []
    for pair in pairs:
        site, wanted = pair.split("=", 1)
        site = site.strip().upper()
        if site not in SITES:
            missing.append(f"{site}: not a site key ({', '.join(SITES)})"); continue
        org = match(orgs, wanted)
        if org is None:
            missing.append(f"{site}: no single Page matches {wanted!r}")
        else:
            plan.append((site, org))
    if missing:
        print("Cannot wire:")
        for m in missing:
            print(f"  {m}")
        print("\nNothing was written. Run `orgs` and use a Page's exact name or vanity URL.")
        return 1
    for site, org in plan:
        lines = upsert(lines, f"LINKEDIN_{site}_ORG_URN", org["urn"])
        lines = upsert(lines, f"LINKEDIN_{site}_ACCESS_TOKEN", token)
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    for site, org in plan:
        print(f"{site}: {org['name']} ({org['urn']})")
    print(f"\nWrote {len(plan)} site(s) to {env_path.name}; token expires {values.get('LINKEDIN_TOKEN_EXPIRES', 'unknown')}."
          "\nVerify:  docker compose run --rm autopub python -m autopub check"
          "\nRestart: docker compose up -d autopub")
    return 0


def cmd_refresh(env_path: Path) -> int:
    lines, values = read_env(env_path)
    rt, cid, sec = values.get("LINKEDIN_REFRESH_TOKEN"), values.get("LINKEDIN_CLIENT_ID"), values.get("LINKEDIN_CLIENT_SECRET")
    if not (rt and cid and sec):
        print("Refresh needs LINKEDIN_REFRESH_TOKEN, CLIENT_ID and CLIENT_SECRET in .env - run `auth` again instead.")
        return 1
    tok = post_form(TOKEN_URL, {"grant_type": "refresh_token", "refresh_token": rt, "client_id": cid, "client_secret": sec})
    old = values.get("LINKEDIN_ACCESS_TOKEN")
    lines = store_tokens(lines, tok)
    touched = []
    for site in SITES:
        key = f"LINKEDIN_{site}_ACCESS_TOKEN"
        if values.get(key) and (values[key] == old or values.get(f"LINKEDIN_{site}_ORG_URN")):
            lines = upsert(lines, key, tok["access_token"]); touched.append(site)
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    exp = time.strftime("%Y-%m-%d", time.gmtime(time.time() + int(tok.get("expires_in", 0))))
    print(f"Token renewed until {exp}; updated {', '.join(touched) or 'no sites'}. Restart: docker compose up -d autopub")
    return 0


def main(argv: list[str]) -> int:
    env_path = ROOT / ".env"
    if "--env" in argv:
        env_path = Path(argv[argv.index("--env") + 1])
        argv = [a for i, a in enumerate(argv) if a != "--env" and (i == 0 or argv[i - 1] != "--env")]
    cmd = argv[0] if argv else "help"
    if cmd == "auth":
        return cmd_auth(env_path)
    if cmd == "orgs":
        return cmd_orgs(env_path)
    if cmd == "wire":
        return cmd_wire(env_path, [a for a in argv[1:] if "=" in a])
    if cmd == "refresh":
        return cmd_refresh(env_path)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
