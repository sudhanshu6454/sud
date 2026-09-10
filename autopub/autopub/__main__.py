"""CLI: python -m autopub {serve|run|check|sources|status}"""
from __future__ import annotations

import argparse
import logging
import os
import random
import sys
import time

from pathlib import Path

from . import config, images, sources
from .pipeline import make_wordpress, run_all
from .social import build_publishers
from .state import State

SAMPLE_HEADLINE = "Ad spend shifts to retail media as brands chase measurable reach"


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


def cmd_cards(settings, args) -> int:
    """Render the share cards for one or every site, so a design change can be looked at before it ships."""
    out_dir = Path(args.out) if args.out else settings.data_dir / "preview"
    headline = args.headline or SAMPLE_HEADLINE
    for site in settings.sites:
        if args.site and site.key != args.site.upper():
            continue
        cards = images.render_set(headline, args.kicker or site.category, site, out_dir, site.slug,
                                  backdrop_url=args.image)
        print(f"[{site.key}] {site.domain}")
        for shape, path in cards.items():
            from PIL import Image as _Image
            with _Image.open(path) as im:
                w, h = im.size
            print(f"   {shape:<9} {w}x{h}  ratio {w / h:.3f}  {path.stat().st_size // 1024:>4} KB  {path}")
        if cards.get("portrait"):
            feed = images.instagram_asset(cards["portrait"], ratio=settings.instagram_ratio,
                                          out_path=out_dir / f"{site.slug}-instagram.jpg")
            from PIL import Image as _Image
            with _Image.open(feed) as im:
                w, h = im.size
            print(f"   {'instagram':<9} {w}x{h}  ratio {w / h:.3f}  (what actually gets posted, ratio={settings.instagram_ratio})")
    return 0


def cmd_instagram_probe(settings, args) -> int:
    """Ask Instagram whether it accepts a 3:4 card yet, for real, without publishing anything.

    Meta documents a 4:5 floor for feed images and refuses 3:4 with error 36003/2207009, but the
    behaviour has changed before without a changelog entry. This uploads a throwaway card, tries
    to create a media container, reports the verdict and cleans up after itself.
    """
    ratio = args.ratio or "3:4"
    size = {"3:4": (1080, 1440), "4:5": (1080, 1350), "1:1": (1080, 1080)}.get(ratio)
    if not size:
        print(f"unknown ratio {ratio!r}; use 3:4, 4:5 or 1:1")
        return 2
    worst = 0
    for site in settings.sites:
        if args.site and site.key != args.site.upper():
            continue
        pub = next((p for p in build_publishers(site) if p.platform == "instagram"), None)
        if not pub:
            print(f"[{site.key}] no Instagram credentials (INSTAGRAM_{site.key}_USER_ID / _ACCESS_TOKEN); skipped")
            continue
        out = Path(args.out) if args.out else settings.data_dir / "preview"
        card = images.render_card(SAMPLE_HEADLINE, site.category, site, out / f"{site.slug}-probe.jpg", "portrait")
        card = images.resize_to(card, size, out / f"{site.slug}-probe-{ratio.replace(':', 'x')}.jpg")
        wp = make_wordpress(site)
        media = wp.upload_media(card, f"Instagram {ratio} ratio probe")
        try:
            ok, detail = pub.probe_ratio(media["source_url"])
            print(f"[{site.key}] {ratio} ({size[0]}x{size[1]}, ratio {size[0] / size[1]:.3f}): "
                  f"{'ACCEPTED' if ok else 'REFUSED'} - {detail}")
            if ok and ratio == "3:4":
                print('   -> Instagram now takes 3:4. Set instagram_ratio: "3:4" under settings in sites.yaml.')
            worst = max(worst, 0 if ok else 1)
        finally:
            try:
                wp.delete_media(media["id"])
            except Exception as exc:  # noqa: BLE001
                print(f"   (could not delete the probe upload {media['id']}: {exc})")
    return worst


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
    c = sub.add_parser("cards", help="render the share cards for a site so they can be eyeballed")
    c.add_argument("--site"); c.add_argument("--headline"); c.add_argument("--kicker")
    c.add_argument("--image", help="URL of a photo to use as the backdrop, as a real article would")
    c.add_argument("--out", help="directory to write into (default: <data_dir>/preview)")
    ip = sub.add_parser("instagram-probe", help="ask Instagram whether it accepts a taller card yet (posts nothing)")
    ip.add_argument("--site"); ip.add_argument("--ratio", help="3:4 (default), 4:5 or 1:1"); ip.add_argument("--out")
    args = p.parse_args(argv)
    settings = config.load(args.config)
    commands = {"serve": cmd_serve, "run": cmd_run, "check": cmd_check, "sources": cmd_sources,
                "status": cmd_status, "cards": cmd_cards, "instagram-probe": cmd_instagram_probe}
    return commands[args.cmd](settings, args)


if __name__ == "__main__":
    sys.exit(main())
