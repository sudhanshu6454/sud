#!/usr/bin/env python3
"""Connect autopub to the brands' X accounts, one PIN each.

    python3 infra/x-auth.py MENTALIST=marketing_mentalist CRAZY=crazy4marketingg JUNKIES=marketing_junkies SCREENSTAT=screenstat
    python3 infra/x-auth.py check          # which account each site's stored credentials belong to

The X developer app's API key and secret are asked for once at hidden prompts and stored in .env
as X_API_KEY / X_API_SECRET. For each SITE=handle the script prints an authorization link: open it
in a browser logged in as that brand's X account, approve, and type the PIN X shows. X answers
with the account's tokens and its handle; the tokens are written as TWITTER_<SITE>_* only if the
handle is the one you named, so a wrong login is refused rather than wired. No secret is printed.

OAuth 1.0a is implemented here with the standard library so the server needs no extra packages.
"""
from __future__ import annotations

import base64
import getpass
import hmac
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from hashlib import sha1
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUEST_TOKEN = "https://api.x.com/oauth/request_token"
AUTHORIZE = "https://api.x.com/oauth/authorize"
ACCESS_TOKEN = "https://api.x.com/oauth/access_token"
SITES = ("MENTALIST", "CRAZY", "JUNKIES", "SCREENSTAT")


def pct(s: str) -> str:
    return urllib.parse.quote(str(s), safe="")


def sign(method: str, url: str, params: dict, consumer_secret: str, token_secret: str = "") -> str:
    """HMAC-SHA1 signature over the OAuth 1.0a base string."""
    normalized = "&".join(f"{pct(k)}={pct(v)}" for k, v in sorted(params.items()))
    base = "&".join([method.upper(), pct(url), pct(normalized)])
    key = f"{pct(consumer_secret)}&{pct(token_secret)}".encode()
    return base64.b64encode(hmac.new(key, base.encode(), sha1).digest()).decode()


def oauth_header(method: str, url: str, consumer_key: str, consumer_secret: str,
                 token: str = "", token_secret: str = "", extra: dict | None = None) -> str:
    oauth = {
        "oauth_consumer_key": consumer_key, "oauth_nonce": secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1", "oauth_timestamp": str(int(time.time())), "oauth_version": "1.0",
    }
    if token:
        oauth["oauth_token"] = token
    oauth.update(extra or {})
    oauth["oauth_signature"] = sign(method, url, oauth, consumer_secret, token_secret)
    return "OAuth " + ", ".join(f'{pct(k)}="{pct(v)}"' for k, v in sorted(oauth.items()))


def http_post(url: str, header: str) -> dict:
    """POST with an OAuth header; X answers these two endpoints as form-encoded bodies."""
    req = urllib.request.Request(url, data=b"", method="POST", headers={"Authorization": header})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        raise RuntimeError(f"HTTP {exc.code} from X: {detail}") from None
    return {k: v[0] for k, v in urllib.parse.parse_qs(body).items()}


def read_env(path: Path) -> tuple[list[str], dict[str, str]]:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    values = {k.strip(): v.strip() for k, v in (l.split("=", 1) for l in lines if "=" in l and not l.lstrip().startswith("#"))}
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


def authorize_one(consumer_key: str, consumer_secret: str, site: str, expected: str,
                  ask_pin=None) -> dict | None:
    """Run the PIN flow for one brand. Returns X's token response or None when refused."""
    ask_pin = ask_pin or (lambda prompt: getpass.getpass(prompt).strip())
    req = http_post(REQUEST_TOKEN, oauth_header("POST", REQUEST_TOKEN, consumer_key, consumer_secret,
                                                extra={"oauth_callback": "oob"}))
    if req.get("oauth_callback_confirmed") != "true" or not req.get("oauth_token"):
        raise RuntimeError("X did not issue a request token; check the app has OAuth 1.0a enabled with Read and write")
    print(f"\n[{site}] Log in as @{expected} in a browser, open this link and approve:\n")
    print(f"  {AUTHORIZE}?oauth_token={req['oauth_token']}\n")
    pin = ask_pin(f"[{site}] PIN shown by X (hidden): ")
    if not pin:
        print(f"[{site}] no PIN entered; skipped")
        return None
    tok = http_post(ACCESS_TOKEN, oauth_header("POST", ACCESS_TOKEN, consumer_key, consumer_secret,
                                               req["oauth_token"], req["oauth_token_secret"], {"oauth_verifier": pin}))
    handle = tok.get("screen_name", "")
    if handle.lower() != expected.lower().lstrip("@"):
        print(f"[{site}] that login is @{handle}, not @{expected}; nothing written for {site}")
        return None
    return tok


def cmd_wire(env_path: Path, pairs: list[str], ask_pin=None) -> int:
    lines, values = read_env(env_path)
    key = values.get("X_API_KEY") or getpass.getpass("X app API Key (hidden): ").strip()
    secret = values.get("X_API_SECRET") or getpass.getpass("X app API Key Secret (hidden): ").strip()
    if not key or not secret:
        print("The app's API Key and Secret are both needed; find them under Keys and tokens in the X developer portal")
        return 1
    lines = upsert(upsert(lines, "X_API_KEY", key), "X_API_SECRET", secret)
    wired, failed = [], []
    for pair in pairs:
        site, handle = pair.split("=", 1)
        site, handle = site.strip().upper(), handle.strip().lstrip("@")
        if site not in SITES:
            failed.append(f"{site}: not a site key ({', '.join(SITES)})"); continue
        try:
            tok = authorize_one(key, secret, site, handle, ask_pin)
        except RuntimeError as exc:
            failed.append(f"{site}: {exc}"); continue
        if tok is None:
            failed.append(f"{site}: not authorized"); continue
        lines = upsert(lines, f"TWITTER_{site}_API_KEY", key)
        lines = upsert(lines, f"TWITTER_{site}_API_SECRET", secret)
        lines = upsert(lines, f"TWITTER_{site}_ACCESS_TOKEN", tok["oauth_token"])
        lines = upsert(lines, f"TWITTER_{site}_ACCESS_SECRET", tok["oauth_token_secret"])
        wired.append(f"{site}: @{tok['screen_name']}")
        env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")   # after each success: a later refusal loses nothing
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print()
    for w in wired:
        print("wired  ", w)
    for f in failed:
        print("failed ", f)
    if wired:
        print("\nVerify:  docker compose run --rm autopub python -m autopub check"
              "\nRestart: docker compose up -d autopub")
    return 0 if wired and not failed else 1


def cmd_check(env_path: Path) -> int:
    _, values = read_env(env_path)
    any_ = False
    for site in SITES:
        tok = values.get(f"TWITTER_{site}_ACCESS_TOKEN")
        if not tok:
            continue
        any_ = True
        # the user id is the prefix of an X access token; it identifies the account without a request
        print(f"{site}: token for X user id {tok.split('-', 1)[0]} (verify the handle with `autopub check` once wired)")
    if not any_:
        print("No X credentials stored yet.")
    return 0


def main(argv: list[str]) -> int:
    env_path = ROOT / ".env"
    if "--env" in argv:
        i = argv.index("--env"); env_path = Path(argv[i + 1]); argv = argv[:i] + argv[i + 2:]
    if not argv:
        print(__doc__); return 2
    if argv[0] == "check":
        return cmd_check(env_path)
    return cmd_wire(env_path, [a for a in argv if "=" in a])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
