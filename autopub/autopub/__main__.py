"""CLI: python -m autopub {serve|run|check|sources|status}"""
from __future__ import annotations

import argparse
import logging
import os
import random
import sys
import time

from pathlib import Path

from . import cards, carousels, config, images, nostalgia, rank, sources, video
from .pipeline import make_wordpress, run_all
from .rewrite import effective_model
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
    # the model actually used, not just what sites.yaml says - ANTHROPIC_MODEL overrides it
    model = effective_model(settings.llm_model)
    endpoint = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
    print(f"model={model} effort={settings.llm_effort} endpoint={endpoint} "
          f"api_key={'set' if os.environ.get('ANTHROPIC_API_KEY') else 'MISSING'}")
    if not os.environ.get("ANTHROPIC_API_KEY"):
        ok = False
    expires = os.environ.get("LINKEDIN_TOKEN_EXPIRES")
    if expires:
        try:
            days = (time.mktime(time.strptime(expires, "%Y-%m-%d")) - time.time()) / 86400
            note = "EXPIRED - run: python3 infra/linkedin-auth.py refresh" if days < 0 else (
                f"renew soon: python3 infra/linkedin-auth.py refresh" if days < 10 else "ok")
            print(f"linkedin token expires {expires} ({days:.0f} days): {note}")
        except ValueError:
            print(f"linkedin token expiry {expires!r} is not a date")
    if settings.carousel_hours:
        print(f"carousels: the first article at or after {', '.join(f'{h:02d}:00' for h in settings.carousel_hours)} "
              f"{settings.timezone} each day goes out as a carousel")
    else:
        print("carousels: off (settings.carousel_hours is empty)")
    if settings.reel_hours:
        print(f"reels: the first article at or after {', '.join(f'{h:02d}:00' for h in settings.reel_hours)} "
              f"{settings.timezone} each day also goes out as a reel and a Page video")
    else:
        print("reels: off (settings.reel_hours is empty)")
    from . import speech as _speech
    v = settings.reel_voice
    if v.startswith("azure:"):
        have = bool(os.environ.get("AZURE_SPEECH_KEY")) and bool(os.environ.get("AZURE_SPEECH_REGION"))
        where = f"Microsoft, key {'set' if have else 'MISSING: set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env'}"
    elif v.startswith("google:"):
        where = f"Google, key {'set' if os.environ.get('GOOGLE_TTS_API_KEY') else 'MISSING: set GOOGLE_TTS_API_KEY in .env'}"
    elif v:
        where = f"{'Kokoro' if _speech.is_kokoro(v) else 'Piper'}, in {settings.data_dir / 'voices'}"
    print(f"reel voice: {v or 'none (silent reels)'}" + (f" ({where})" if v else ""))
    print(f"reel music: {'on, own tracks from ' + str(settings.data_dir / 'music') + '/<mood>/ else composed' if settings.reel_music else 'off'}")
    print(f"follow-ups: steal card at or after {settings.steal_hour:02d}:00, debate story at or after {settings.debate_hour:02d}:00 "
          f"{settings.timezone}, posted {settings.followup_delay_minutes} min after their article"
          if settings.steal_hour is not None and settings.debate_hour is not None else "follow-ups: partly off")
    if settings.nostalgia_hour is not None:
        on = [s.key for s in settings.sites if s.nostalgia]
        print(f"throwback: one classic ad a day at or after {settings.nostalgia_hour:02d}:00 {settings.timezone} on {on or 'no site'}")
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
    """What each site could publish right now, seen the way the live run sees it.

    A story the site has already used is marked `used`, so a feed that looks rich here but produces
    nothing in the log ("nothing on beat this cycle: 1 candidates") is explained rather than puzzling.
    """
    state = State(settings.data_dir / "autopub.db", settings.dedupe_across_sites)
    for site in settings.sites:
        if args.site and site.key != args.site.upper():
            continue
        cands = sources.collect(site, timeout=settings.request_timeout)
        used = {c.url for c in cands if state.is_used(c.url, site.key)}
        print(f"\n[{site.key}] {len(cands)} candidates, {len(cands) - len(used)} not yet used")
        if args.rank:
            # what the beat filter would actually keep, without writing or publishing anything
            scored = rank.rank(site, cands, model=effective_model(settings.llm_model), pool=settings.rank_pool)
            if scored is None:
                print("  (ranking unavailable; showing newest first)")
            else:
                fresh = [s for s in scored if s.candidate.url not in used]
                on_beat = sum(1 for s in fresh if s.score >= settings.min_relevance)
                print(f"  {on_beat}/{len(fresh)} unused stories at or above min_relevance={settings.min_relevance}"
                      f" (the live run publishes only from these)")
                for s in scored[: args.limit or 15]:
                    mark = "used" if s.candidate.url in used else ("KEEP" if s.score >= settings.min_relevance else "drop")
                    age = f"{s.candidate.age_hours:.0f}h" if s.candidate.age_hours is not None else "?"
                    print(f"  {mark} {s.score:>2}/10 {age:>4} {s.reason[:22]:<22} {s.candidate.title[:70]}")
                continue
        for c in cands[: args.limit or 15]:
            age = f"{c.age_hours:.0f}h" if c.age_hours is not None else "?"
            mark = "used" if c.url in used else "    "
            print(f"  {mark} {age:>4} {c.source[:28]:<28} {c.title[:80]}  {c.url}")
    return 0


SAMPLE_CARD = cards.CardIdeas(
    quote="People do not buy what you sell. They buy what it says about them.", quote_by="Rory Sutherland, Ogilvy",
    stat="68%", stat_label="of shoppers say price is no longer their first filter",
    stat_context="Kantar's 2026 India consumer pulse, 4,200 respondents",
    takeaways=["Status signals beat discounts for the top quartile", "Scarcity cues work only when the story is credible",
               "Pricing anchors reset faster than loyalty does"],
    question="Why does a higher price make some products feel more trustworthy?",
    left_value="₹1,299", left_label="what shoppers said they would pay", right_value="₹1,899", right_label="what they actually paid",
    term="Anchoring bias", definition="The first number a buyer sees becomes the reference every later price is judged against, whether or not it was ever a real price.",
    dos=["Show the premium option first", "Explain what the price buys", "Anchor on value, not on discount"],
    donts=["Lead with the cheapest tier", "Change prices without a story", "Discount the flagship"],
)


def cmd_cards(settings, args) -> int:
    """Render the share cards for one or every site, so a design change can be looked at before it ships.

    `--formats` renders the whole Instagram family - headline, quote, number, takeaways, question -
    from sample material, which is how a change to one format is checked against the other four.
    """
    out_dir = Path(args.out) if args.out else settings.data_dir / "preview"
    headline = args.headline or SAMPLE_HEADLINE
    for site in settings.sites:
        if args.site and site.key != args.site.upper():
            continue
        if args.reel:
            # the whole reel from sample frames, so the motion and timing can be watched before it ships
            print(f"[{site.key}] {site.domain}")
            kicker = args.kicker or site.category
            card = images.render_card(headline, kicker, site, out_dir / f"{site.slug}-reel-card.jpg", "portrait",
                                      backdrop_url=args.image,
                                      card=cards.brief(cards.INVERSE, None, headline, kicker, None))
            frames = [images.story_asset(card, site, out_dir / f"{site.slug}-reel-0.jpg")]
            texts: list = [None]
            sample = [(sl.heading, sl.body) for sl in carousels.SAMPLE_SLIDES[:3]]
            for i, (heading, body) in enumerate(sample, 1):
                frames.append(images.story_text_frame(heading, body, i, len(sample), site,
                                                      out_dir / f"{site.slug}-reel-{i}.jpg", kicker=kicker))
                texts.append(body)
            frames.append(images.story_closing_frame(headline, site, out_dir / f"{site.slug}-reel-end.jpg"))
            texts.append(None)
            durations = video.plan(frames, texts)
            audio = None
            from .pipeline import narrator_for
            from . import speech
            narrator = narrator_for(settings)
            if narrator is not None:
                scripts = [headline, *[f"{h}. {b}" for h, b in sample], f"Read the full story on {site.domain}. Link in bio."]
                audio, durations = narrator.soundtrack(scripts, out_dir / f"{site.slug}-reel-voice.wav",
                                                       floor=[speech.LEAD_IN + speech.PAD_AFTER + 1.5] * len(frames))
            voiced = audio is not None
            mood = args.mood or "calm"
            if settings.reel_music:
                from . import music
                audio = music.soundtrack(mood, sum(durations), out_dir / f"{site.slug}-reel-mix.wav", voice_wav=audio,
                                         seed=headline, music_dir=settings.data_dir / "music")
            path = video.render_reel(frames, out_dir / f"{site.slug}-reel.mp4", durations, images.hex_to_rgb(site.brand.accent), audio=audio)
            info = video.probe(path)
            print(f"   {path.stat().st_size // 1024:>5} KB  {info.get('width')}x{info.get('height')} {info.get('codec')} "
                  f"{info.get('duration', 0):.1f}s  {'narrated by ' + settings.reel_voice if voiced else 'no voice loaded'}"
                  f"{', ' + mood + ' music' if settings.reel_music else ''}  {path}")
            continue
        if args.carousel:
            # the whole swipe from sample slides: cover card, content slides, closing slide
            print(f"[{site.key}] {site.domain}")
            kicker = args.kicker or site.category
            brief = cards.brief(cards.HEADLINE, None, headline, kicker, None)
            cover = images.render_card(headline, kicker, site, out_dir / f"{site.slug}-carousel-0.jpg", "portrait",
                                       backdrop_url=args.image, card=brief)
            paths = [images.instagram_asset(cover, ratio=settings.instagram_ratio,
                                            out_path=out_dir / f"{site.slug}-carousel-cover.jpg")]
            slides = carousels.usable(carousels.SAMPLE_SLIDES)
            for i, (heading, body) in enumerate(slides, 1):
                paths.append(images.carousel_text_slide(heading, body, i, len(slides), site,
                                                        out_dir / f"{site.slug}-carousel-{i}.jpg", kicker=kicker))
            paths.append(images.carousel_closing_slide(headline, site, out_dir / f"{site.slug}-carousel-end.jpg"))
            for path in paths:
                print(f"   {path.stat().st_size // 1024:>4} KB  {path}")
            continue
        if args.formats:
            print(f"[{site.key}] {site.domain}")
            for kind in cards.FORMATS:
                kicker = args.kicker or site.category
                brief = cards.brief(kind, SAMPLE_CARD, headline, kicker if kind == cards.HEADLINE else cards.KICKERS[kind], None)
                path = images.render_card(headline, kicker, site, out_dir / f"{site.slug}-{kind}.jpg", "portrait",
                                          backdrop_url=args.image, card=brief)
                print(f"   {kind:<9} {path.stat().st_size // 1024:>4} KB  {path}")
            continue
        rendered = images.render_set(headline, args.kicker or site.category, site, out_dir, site.slug,
                                     backdrop_url=args.image)
        print(f"[{site.key}] {site.domain}")
        for shape, path in rendered.items():
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


def cmd_nostalgia(settings, args) -> int:
    """Run today's throwback for a site now, or with --dry-run only show what it would pick and embed."""
    from .pipeline import RunReport
    from .rewrite import Rewriter
    state = State(settings.data_dir / "autopub.db", settings.dedupe_across_sites)
    rewriter = Rewriter(model=effective_model(settings.llm_model), effort=settings.llm_effort)
    rc = 0
    for site in settings.sites:
        if args.site and site.key != args.site.upper():
            continue
        if not site.nostalgia and not args.site:
            continue
        used = nostalgia.parse_used(state.note(site.key, nostalgia.USED_NOTE))
        print(f"\n[{site.key}] {site.domain}: {len(used)} throwbacks so far")
        if args.dry_run:
            try:
                choice = nostalgia.pick(rewriter, site, nostalgia.fleet_used(state) or used, len(used) + (0 if site.key in ("MENTALIST", "JUNKIES") else 1))
            except RuntimeError as exc:
                print(f"  pick failed: {exc}")
                rc = 1
                continue
            film = nostalgia.youtube.find_ad(choice.brand, choice.campaign, choice.year)
            print(f"  pick: {choice.brand} - {choice.campaign} ({choice.year or 'year unsure'}) {choice.country}")
            print(f"  why:  {choice.hook}")
            print(f"  film: {film['url'] + '  ' + film['title'][:60] + '  [' + film['channel'] + ']' if film else 'NOT FOUND (would ask again)'}")
            continue
        report = RunReport(site=site.key)
        ok = nostalgia.publish_daily(site, settings, state, rewriter, make_wordpress(site), build_publishers(site),
                                     settings.data_dir / "images", report)
        print(f"  {'published' if ok else 'nothing published'}: {report.summary()}")
        for link in report.published:
            print("  ->", link)
        rc = rc or (0 if ok else 1)
    return rc


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
    so.add_argument("--rank", action="store_true", help="score each candidate against the site beat and show what would be kept")
    st = sub.add_parser("status", help="show what has been published"); st.add_argument("--limit", type=int)
    c = sub.add_parser("cards", help="render the share cards for a site so they can be eyeballed")
    c.add_argument("--site"); c.add_argument("--headline"); c.add_argument("--kicker")
    c.add_argument("--image", help="URL of a photo to use as the backdrop, as a real article would")
    c.add_argument("--out", help="directory to write into (default: <data_dir>/preview)")
    c.add_argument("--formats", action="store_true", help="render every Instagram card format from sample material")
    c.add_argument("--carousel", action="store_true", help="render a sample carousel: cover, content slides, closing")
    c.add_argument("--reel", action="store_true", help="render a sample reel (MP4) from the story frames")
    c.add_argument("--mood", help="music mood for the sample reel: upbeat, calm, serious or nostalgic")
    n = sub.add_parser("nostalgia", help="publish today's classic-ad throwback now (or --dry-run to see the pick)")
    n.add_argument("--site"); n.add_argument("--dry-run", action="store_true", help="pick and look up the film, publish nothing")
    ip = sub.add_parser("instagram-probe", help="ask Instagram whether it accepts a taller card yet (posts nothing)")
    ip.add_argument("--site"); ip.add_argument("--ratio", help="3:4 (default), 4:5 or 1:1"); ip.add_argument("--out")
    args = p.parse_args(argv)
    settings = config.load(args.config)
    commands = {"serve": cmd_serve, "run": cmd_run, "check": cmd_check, "sources": cmd_sources,
                "status": cmd_status, "cards": cmd_cards, "instagram-probe": cmd_instagram_probe,
                "nostalgia": cmd_nostalgia}
    return commands[args.cmd](settings, args)


if __name__ == "__main__":
    sys.exit(main())
