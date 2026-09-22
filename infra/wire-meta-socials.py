#!/usr/bin/env python3
"""Point autopub's Instagram (and optionally Facebook) publishing at accounts the Meta System User can see.

    python3 infra/wire-meta-socials.py SCREENSTAT=screenstat CRAZY=crazy4marketingg [--facebook]

Each SITE=username names an Instagram handle from pulse-worker/config/assets.json (written by
`npm run inventory`). For every site this writes INSTAGRAM_<SITE>_USER_ID and _ACCESS_TOKEN into
.env, and with --facebook also FACEBOOK_<SITE>_PAGE_ID and _PAGE_TOKEN from the Page that account
is connected to. The token is the System User token already in .env: it carries
instagram_content_publish and pages_manage_posts, and does not expire.

All accounts are checked before anything is written, so a handle the token cannot see fails the
whole run and .env is left exactly as it was. The token is never printed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def upsert(lines: list[str], key: str, value: str) -> list[str]:
    out, done = [], False
    for line in lines:
        if line.startswith(f"{key}="):
            out.append(f"{key}={value}")
            done = True
        else:
            out.append(line)
    if not done:
        out.append(f"{key}={value}")
    return out


def main(argv: list[str]) -> int:
    facebook = "--facebook" in argv
    env_path = ROOT / ".env"
    assets_path = ROOT / "pulse-worker" / "config" / "assets.json"
    for i, a in enumerate(argv):          # test hooks; defaults are the fleet's real files
        if a == "--env":
            env_path = Path(argv[i + 1])
        if a == "--assets":
            assets_path = Path(argv[i + 1])
    pairs = [a for a in argv if "=" in a and not a.startswith("--")]
    if not pairs:
        print(__doc__)
        return 2

    if not env_path.exists():
        print(f"{env_path} not found")
        return 1
    lines = env_path.read_text(encoding="utf-8").splitlines()
    token = next((l.split("=", 1)[1] for l in lines if l.startswith("META_SYSTEM_USER_TOKEN=")), "").strip()
    if not token:
        print("META_SYSTEM_USER_TOKEN is not set in .env - generate the System User token first")
        return 1
    if not assets_path.exists():
        print(f"{assets_path} not found - run `npm run inventory` in pulse-worker first")
        return 1
    by_user = {a["username"].lower(): a for a in json.loads(assets_path.read_text(encoding="utf-8")).get("ig", [])}

    # validate everything before writing anything
    plan, missing = [], []
    for pair in pairs:
        site, user = pair.split("=", 1)
        site, user = site.strip().upper(), user.strip().lstrip("@").lower()
        acct = by_user.get(user)
        if not acct:
            missing.append(f"{site}: @{user}")
        else:
            plan.append((site, acct))
    if missing:
        print("These Instagram accounts are not visible to the System User (not in assets.json):")
        for m in missing:
            print(f"  {m}")
        print("\nFor each: make sure it is a Professional account, connected to a Facebook Page, and that"
              " Page is assigned to the system user in Business Settings. Then re-run `npm run inventory`."
              "\nNothing was written.")
        return 1

    for site, acct in plan:
        lines = upsert(lines, f"INSTAGRAM_{site}_USER_ID", acct["ig_user_id"])
        lines = upsert(lines, f"INSTAGRAM_{site}_ACCESS_TOKEN", token)
        if facebook:
            lines = upsert(lines, f"FACEBOOK_{site}_PAGE_ID", acct["page_id"])
            lines = upsert(lines, f"FACEBOOK_{site}_PAGE_TOKEN", token)
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    for site, acct in plan:
        extra = f", Facebook Page {acct['page_id']} ({acct['page_name']})" if facebook else ""
        print(f"{site}: Instagram @{acct['username']} -> {acct['ig_user_id']}{extra}")
    print(f"\nWrote {len(plan)} site(s) to {env_path.name}. Token reused from META_SYSTEM_USER_TOKEN (not shown)."
          "\nVerify with:  docker compose run --rm autopub python -m autopub check"
          "\nThen restart: docker compose up -d autopub   (wait for any Meta rate limit to clear first)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
