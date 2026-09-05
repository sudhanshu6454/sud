"""CLI: python -m autopub {serve|run|check|sources|status}"""
from __future__ import annotations

import argparse
import logging
import os
import random
import sys
import time

from . import config, sources
from .pipeline import make_wordpress, run_all
from .social import build_publishers
from .state import State


def _logging() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("trafilatura").setLevel(logging.WARNING)


def cmd_run(settings, args) -> int:
    state = State(settings.data_dir / "autopub.db", settings.dedupe_across_sites)
    reports = run_all(settings, state, only=args.site, limit=args.limit)
    for r in reports:
        print(r.summary())
        for link in r.published:
            print("  ->", link)
    return 0


def cmd_serve(settings, args) -> int:
    log = logging.getLogger("autopub.serve")
    state = State(settings.data_dir / "autopub.db", settings.dedupe_across_sites)
    interval = (args.interval or settings.interval_minutes) * 60
    log.info("scheduler started: %d sites, every %d min", len(settings.sites), interval // 60)
    while True:
        started = time.time()
        try:
            for r in run_all(settings, state):
                log.info(r.summary())
        except Exception:  # noqa: BLE001
            log.exception("cycle crashed")
        elapsed = time.time() - started
        sleep_for = max(60, interval - elapsed) + random.uniform(0, 120)
        log.info("cycle done in %.0fs; next in %.0f min", elapsed, sleep_for / 60)
        time.sleep(sleep_for)


def cmd_check(settings, args) -> int:
    """Verify config, WordPress credentials and which socials are wired per site."""
    ok = True
    print(f"model={settings.llm_model} effort={settings.llm_effort} anthropic_key={'set' if os.environ.get('ANTHROPIC_API_KEY') else 'MISSING'}")
    if not os.environ.get("ANTHROPIC_API_KEY"):
        ok = False
    for site in settings.sites:
        print(f"\n[{site.key}] {site.domain} -> {site.wp_base_url()}")
        try:
            me = make_wordpress(site).ping()
            print(f"  wordpress: ok (user {me.get('slug')}, caps: {'publish_posts' in (me.get('capabilities') or {})})")
        except Exception as exc:  # noqa: BLE001
            ok = False
            print(f"  wordpress: FAIL {exc}")
        pubs = build_publishers(site)
        enabled = [p.platform for p in pubs]
        missing = [s for s in site.socials if s not in enabled]
        print(f"  socials enabled: {enabled or 'none'}")
        if missing:
            print(f"  socials missing credentials: {missing}")
    return 0 if ok else 1


def cmd_sources(settings, args) -> int:
    for site in settings.sites:
        if args.site and site.key != args.site.upper():
            continue
        cands = sources.collect(site, timeout=settings.request_timeout)
        print(f"\n[{site.key}] {len(cands)} candidates")
        for c in cands[: args.limit or 15]:
            age = f"{c.age_hours:.0f}h" if c.age_hours is not None else "?"
            print(f"  {age:>4} {c.source[:28]:<28} {c.title[:80]}  {c.url}")
    return 0


def cmd_status(settings, args) -> int:
    state = State(settings.data_dir / "autopub.db", settings.dedupe_across_sites)
    for site in settings.sites:
        print(f"[{site.key}] published={state.count(site.key)} failed={state.count(site.key, 'failed')} skipped={state.count(site.key, 'skipped')}")
    print("\nrecent:")
    for row in state.recent(args.limit or 20):
        ts = time.strftime("%Y-%m-%d %H:%M", time.localtime(row["updated_at"]))
        print(f"  {ts} {row['site']:<9} {row['status']:<9} {(row['title'] or '')[:60]} {row['wp_url'] or row['error'] or ''}")
    return 0


def main(argv=None) -> int:
    _logging()
    p = argparse.ArgumentParser(prog="autopub", description="Automated curation -> WordPress -> socials")
    p.add_argument("--config", default=None, help="path to sites.yaml (default: $AUTOPUB_CONFIG)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="run forever on the configured interval"); s.add_argument("--interval", type=int, help="minutes")
    r = sub.add_parser("run", help="one cycle now"); r.add_argument("--site"); r.add_argument("--limit", type=int)
    sub.add_parser("check", help="validate credentials and connectivity")
    so = sub.add_parser("sources", help="list current candidate stories"); so.add_argument("--site"); so.add_argument("--limit", type=int)
    st = sub.add_parser("status", help="show what has been published"); st.add_argument("--limit", type=int)
    args = p.parse_args(argv)
    settings = config.load(args.config)
    return {"serve": cmd_serve, "run": cmd_run, "check": cmd_check, "sources": cmd_sources, "status": cmd_status}[args.cmd](settings, args)


if __name__ == "__main__":
    sys.exit(main())
