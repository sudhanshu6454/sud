"""Per-site run: discover -> extract -> rewrite -> image -> WordPress -> socials."""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

from slugify import slugify

from . import cards, carousels, extract, followups, images, music, nostalgia, rank, scorecards, sources, speech, video
from .config import Settings, Site
from .rewrite import CuratedPost, Rewriter, RewriteSkipped, effective_model
from .social import SocialPost, build_publishers, dispatch
from .state import State
from .wordpress import WordPress, WordPressError

log = logging.getLogger(__name__)

MAX_CONSECUTIVE_FAILURES = 3   # stop a site's run when the model/API keeps failing
REEL_NOTE = "reels"            # site_notes key: when this site's last reels went out (same slot logic as carousels)


@dataclass
class RunReport:
    site: str
    candidates: int = 0
    published: list[str] = field(default_factory=list)
    skipped: int = 0
    failed: int = 0
    social_ok: int = 0
    social_failed: int = 0

    def summary(self) -> str:
        return (f"[{self.site}] candidates={self.candidates} published={len(self.published)} "
                f"skipped={self.skipped} failed={self.failed} social_ok={self.social_ok} social_failed={self.social_failed}")


def make_wordpress(site: Site) -> WordPress:
    user = site.env("WP", "USER", "autopub")
    password = site.env("WP", "APP_PASSWORD")
    if not password:
        raise WordPressError(f"WP_{site.key}_APP_PASSWORD is not set (run infra/wp/init-sites.sh)")
    return WordPress(site.wp_base_url(), user, password, public_host=site.domain)


_NARRATOR: dict = {}


def narrator_for(settings: Settings):
    """The reel's voice, loaded once per process; None when narration is off or unavailable."""
    key = settings.reel_voice
    if key not in _NARRATOR:
        _NARRATOR[key] = speech.Narrator.load(key, settings.data_dir / "voices") if key else None
    return _NARRATOR[key]


def _hooked(hook: str | None, caption: str) -> str:
    """The caption with its hook as the first line: the one line Instagram shows before 'more'."""
    hook = " ".join((hook or "").split())
    if len(hook) < 12 or hook.lower() in caption.lower()[:200]:
        return caption
    return f"{hook}\n\n{caption.strip()}"


def _story_texts(post: CuratedPost) -> list[tuple[str, str]]:
    """The text frames of the story: what the rewriter wrote, else the excerpt under the headline."""
    frames = [(f.heading, f.body) for f in post.story_frames if f.heading.strip() and f.body.strip()][:3]
    if not frames and post.excerpt:
        frames = [(post.image_headline or post.title, post.excerpt)]
    return frames


def publish_one(site: Site, settings: Settings, state: State, cand: sources.Candidate, rewriter: Rewriter,
                wp: WordPress, publishers, work_dir: Path, report: RunReport, use_source_image: bool | None = None) -> bool:
    url = cand.url
    log.info("[%s] working on: %s (%s)", site.key, cand.title, url)

    # 1. extract
    try:
        article = extract.extract(url, timeout=settings.request_timeout)
    except Exception as exc:  # noqa: BLE001
        log.warning("[%s] extraction failed for %s: %s", site.key, url, exc)
        state.mark_skipped(url, site.key, f"extract: {exc}")
        report.skipped += 1
        return False
    if article.word_count < site.min_words:
        state.mark_skipped(url, site.key, f"too short ({article.word_count} words)")
        report.skipped += 1
        return False
    if not article.title:
        article.title = cand.title
    if not article.sitename:
        article.sitename = cand.source

    # 2. rewrite. Twice a day the Instagram post is a carousel; those articles are asked for the
    # slides as part of the same rewrite, so the model writes them from the source it has in hand.
    carousel_log = carousels.parse_log(state.note(site.key, carousels.NOTE))
    want_carousel = (any(p.supports_carousel and p.needs_public_url for p in publishers)
                     and carousels.due(time.time(), carousel_log, settings.carousel_hours, settings.timezone))
    reel_log = carousels.parse_log(state.note(site.key, REEL_NOTE))
    want_reel = (any(p.wants_video for p in publishers)
                 and carousels.due(time.time(), reel_log, settings.reel_hours, settings.timezone))
    try:
        post: CuratedPost = rewriter.rewrite(site, article, carousel=want_carousel)
    except RewriteSkipped as exc:
        state.mark_skipped(url, site.key, str(exc))
        report.skipped += 1
        return False
    except Exception as exc:  # noqa: BLE001 - transient; release so we retry next cycle
        log.error("[%s] rewrite failed: %s", site.key, exc)
        state.release(url, site.key)
        report.failed += 1
        return False

    return publish_post(site, settings, state, url, post, wp, publishers, work_dir, report,
                        image_url=article.image, credit=article.sitename, use_source_image=use_source_image,
                        want_carousel=want_carousel, want_reel=want_reel, carousel_log=carousel_log, reel_log=reel_log)


def _queue_followups(site: Site, settings: Settings, state: State, post: CuratedPost, link: str, publishers) -> None:
    """One 'Steal this' card and one debate story a day: the first article after each hour that has
    the material takes the slot, and the piece is queued to go out after the article."""
    now = time.time()
    due = now + settings.followup_delay_minutes * 60
    names = {p.platform for p in publishers}
    if settings.steal_hour is not None and names & set(followups.FEED) and post.steal \
            and len(post.steal.idea.strip()) >= 12 and len(post.steal.how.strip()) >= 40:
        log_ = carousels.parse_log(state.note(site.key, followups.STEAL_NOTE))
        if carousels.due(now, log_, [settings.steal_hour], settings.timezone):
            followups.schedule(state, site.key, "steal", due, {"idea": post.steal.idea.strip(), "how": post.steal.how.strip(),
                                                                "link": link, "title": post.title})
            state.set_note(site.key, followups.STEAL_NOTE, carousels.dump_log(log_ + [now]))
    if settings.debate_hour is not None and names & set(followups.STORY) and post.debate \
            and post.debate.question.strip().endswith("?") and len([o for o in post.debate.options if o.strip()]) == 2:
        log_ = carousels.parse_log(state.note(site.key, followups.DEBATE_NOTE))
        if carousels.due(now, log_, [settings.debate_hour], settings.timezone):
            followups.schedule(state, site.key, "debate", now + settings.followup_delay_minutes * 30,
                               {"question": post.debate.question.strip(), "options": [o.strip() for o in post.debate.options][:2],
                                "link": link, "title": post.title})
            state.set_note(site.key, followups.DEBATE_NOTE, carousels.dump_log(log_ + [now]))


def publish_post(site: Site, settings: Settings, state: State, url: str, post: CuratedPost, wp: WordPress,
                 publishers, work_dir: Path, report: RunReport, *, image_url: str | None = None, credit: str | None = None,
                 use_source_image: bool | None = None, want_carousel: bool = False, want_reel: bool = False,
                 force_reel: bool = False, carousel_log: list[float] | None = None, reel_log: list[float] | None = None,
                 card_brief=None, force_story: bool = False) -> bool:
    """Everything after the words exist: cards, story frames, reel, carousel, WordPress, socials.

    `url` is the claimed source key in `state`; `image_url` and `credit` are the source photo and
    who it belongs to. Shared by the hourly news post and the daily throwback feature."""
    carousel_log = carousel_log if carousel_log is not None else carousels.parse_log(state.note(site.key, carousels.NOTE))
    reel_log = reel_log if reel_log is not None else carousels.parse_log(state.note(site.key, REEL_NOTE))
    # 3. images. The Instagram card takes one of a small family of formats, chosen from what the
    # article's material can honestly fill and steered away from what this site posted last, so the
    # grid mixes headline, quote, number, takeaways and question cards without the brand moving.
    stem = slugify(post.slug or post.title)[:60] or f"post-{int(time.time())}"
    if use_source_image is None:
        use_source_image = site.use_source_image
    history = cards.parse_history(state.note(site.key, "card_formats"))
    kind = card_brief.kind if card_brief is not None else cards.choose(history, post.card, photo=bool(use_source_image and image_url))
    kicker = post.image_kicker or post.category or site.category
    # the hook is what stops the scroll, so it is set large; the headline that would have been
    # there runs beneath it as the standfirst. Without a hook the card reads as before.
    hook = (post.hook or "").strip()
    card_headline = hook if len(hook) >= 8 else (post.image_headline or post.title)
    card_standfirst = (post.image_headline or post.title) if len(hook) >= 8 else post.excerpt
    brief = card_brief if card_brief is not None else cards.brief(
        kind, post.card, card_headline, kicker if kind == cards.HEADLINE else cards.KICKERS.get(kind, kicker), card_standfirst)
    log.info("[%s] instagram card: %s (recent: %s)", site.key, kind, ",".join(history[-cards.HISTORY:]) or "none")
    try:
        rendered = images.render_set(card_headline, kicker, site,
                                     work_dir / site.slug, stem, backdrop_url=image_url if use_source_image else None,
                                     standfirst=card_standfirst, credit=credit if use_source_image else None,
                                     date_text=time.strftime("%d %b %Y"), card=brief)
    except Exception as exc:  # noqa: BLE001
        log.error("[%s] image generation failed: %s", site.key, exc)
        rendered = {}
    cards_by_shape = rendered

    # 3b. the card Instagram will actually accept, trimmed out of the 3:4 master; and the same card
    # framed 9:16 for the story publishers, drawn from the master before it is cropped
    # Instagram counts every story frame against the account's 100 publishes a day, so the news gets a
    # story every `story_every`th article; the features that are the day's showpieces always do
    story_frames: list[Path] = []
    every = max(1, int(settings.story_every or 1))
    counter = int(state.note(site.key, "story_counter") or 0)
    want_story = force_story or every == 1 or counter % every == 0
    state.set_note(site.key, "story_counter", str(counter + 1))
    if not want_story:
        log.info("[%s] no story for this article (one every %d); next one is due", site.key, every)
    if cards_by_shape.get("portrait") and want_story:
        try:
            cards_by_shape["story"] = images.story_asset(cards_by_shape["portrait"], site, work_dir / site.slug / f"{stem}-story.jpg")
            # the rest of the story: the article's substance in one to three text frames, then the
            # closing frame that sends the viewer to the site. Stories carry no caption, so without
            # these a viewer gets a headline and nothing else.
            frames = _story_texts(post)
            for i, (heading, body) in enumerate(frames, 1):
                story_frames.append(images.story_text_frame(heading, body, i, len(frames), site,
                                                            work_dir / site.slug / f"{stem}-story-{i}.jpg",
                                                            kicker=post.image_kicker or post.category))
            story_frames.append(images.story_closing_frame(post.image_headline or post.title, site,
                                                           work_dir / site.slug / f"{stem}-story-end.jpg"))
        except Exception as exc:  # noqa: BLE001 - a story is a bonus; the feed post must not depend on it
            log.warning("[%s] could not build the story frames: %s", site.key, exc)
    if cards_by_shape.get("portrait"):
        try:
            cards_by_shape["portrait"] = images.instagram_asset(cards_by_shape["portrait"], ratio=settings.instagram_ratio)
        except Exception as exc:  # noqa: BLE001 - fall back to the master; the publisher walks shapes anyway
            log.warning("[%s] could not derive the Instagram asset: %s", site.key, exc)

    # 3b'. the reel: the story frames as a short video, when this article is the slot's reel
    reel_path: Path | None = None
    if (want_reel or force_reel) and cards_by_shape.get("story") and story_frames:
        try:
            frames = [cards_by_shape["story"], *story_frames]
            spoken = _story_texts(post)
            texts = [None, *[body for _, body in spoken], None][:len(frames)]
            texts += [None] * (len(frames) - len(texts))
            durations = video.plan(frames, texts)
            audio = None
            narrator = narrator_for(settings)
            if narrator is not None:
                # the narration sets the pace: each frame holds for as long as its lines take to say
                scripts = [post.image_headline or post.title, *[f"{h}. {b}" for h, b in spoken],
                           f"Read the full story on {site.domain}. Link in bio."][:len(frames)]
                scripts += [None] * (len(frames) - len(scripts))
                try:
                    audio, durations = narrator.soundtrack(scripts, work_dir / site.slug / f"{stem}-voice.wav",
                                                           floor=[speech.LEAD_IN + speech.PAD_AFTER + 1.5] * len(frames))
                except Exception as exc:  # noqa: BLE001 - a lost voice is a silent reel, not a lost reel
                    log.warning("[%s] narration failed (%s); the reel goes out silent", site.key, exc)
                    audio, durations = None, video.plan(frames, texts)
            voiced = audio is not None
            if settings.reel_music:
                # the music bed for the story's mood, under the voice when there is one
                try:
                    audio = music.soundtrack(post.mood or music.DEFAULT_MOOD, sum(durations),
                                             work_dir / site.slug / f"{stem}-mix.wav", voice_wav=audio,
                                             seed=post.title, music_dir=settings.data_dir / "music")
                except Exception as exc:  # noqa: BLE001 - no bed is not no reel
                    log.warning("[%s] music bed failed (%s); the reel goes out without one", site.key, exc)
            reel_path = video.render_reel(frames, work_dir / site.slug / f"{stem}-reel.mp4", durations,
                                          images.hex_to_rgb(site.brand.accent), audio=audio)
            log.info("[%s] reel: %d frames, %.0fs, %s%s, %d KB", site.key, len(frames), sum(durations),
                     "narrated" if voiced else "no voice", f", {music.mood_of(post.mood)} bed" if settings.reel_music else "",
                     reel_path.stat().st_size // 1024)
        except Exception as exc:  # noqa: BLE001 - the reel is a bonus; the feed post must not depend on it
            log.warning("[%s] could not render the reel: %s", site.key, exc)
            reel_path = None

    # 3c. the carousel slides, when this article is the slot's carousel and the source gave enough
    # for one. The cover is the feed card itself, so the grid still shows the format family.
    carousel_slides: list[Path] = []
    if want_carousel and cards_by_shape.get("portrait"):
        slides = carousels.usable(post.carousel_slides)
        if len(slides) < carousels.MIN_SLIDES:
            log.info("[%s] carousel slot open but the story gave %d slide(s), need %d; posting a single card",
                     site.key, len(slides), carousels.MIN_SLIDES)
        else:
            try:
                for i, (heading, body) in enumerate(slides, 1):
                    carousel_slides.append(images.carousel_text_slide(heading, body, i, len(slides), site,
                                                                      work_dir / site.slug / f"{stem}-slide-{i}.jpg",
                                                                      kicker=post.image_kicker or post.category))
                carousel_slides.append(images.carousel_closing_slide(post.image_headline or post.title, site,
                                                                     work_dir / site.slug / f"{stem}-slide-end.jpg"))
                log.info("[%s] carousel: cover + %d slides + closing", site.key, len(slides))
            except Exception as exc:  # noqa: BLE001 - the single card is the fallback
                log.warning("[%s] could not build the carousel slides: %s", site.key, exc)
                carousel_slides = []

    # 4. WordPress
    try:
        landscape_media = wp.upload_media(cards_by_shape["landscape"], post.title, alt_text=post.image_headline) if cards_by_shape.get("landscape") else None
        # the square and portrait cards exist for the social APIs that fetch an image by URL, so
        # they are only worth uploading when such a platform is actually switched on for this site.
        # With no credentials configured they would just accumulate in the media library forever.
        hosted = {shape for pub in publishers if pub.needs_public_url for shape in pub.image_shapes}
        media_by_shape: dict[str, dict] = {}
        for shape, title in (("square", f"{post.title} (square)"), ("portrait", f"{post.title} (portrait)"),
                             ("story", f"{post.title} (story)")):
            if not cards_by_shape.get(shape) or shape not in hosted:
                continue
            try:
                media_by_shape[shape] = wp.upload_media(cards_by_shape[shape], title, alt_text=post.image_headline)
            except WordPressError as exc:
                log.warning("[%s] %s card upload failed: %s", site.key, shape, exc)
        carousel_media: list[dict] = []
        if carousel_slides and media_by_shape.get("portrait"):
            for i, slide in enumerate(carousel_slides, 1):
                try:
                    carousel_media.append(wp.upload_media(slide, f"{post.title} (slide {i})", alt_text=post.image_headline))
                except WordPressError as exc:
                    log.warning("[%s] carousel slide %d upload failed: %s; posting a single card", site.key, i, exc)
                    carousel_media = []   # slides are a sequence; a gap in the middle is worse than no carousel
                    break
        reel_media: dict | None = None
        if reel_path is not None and any(p.wants_video and p.needs_public_url for p in publishers):
            try:
                reel_media = wp.upload_media(reel_path, f"{post.title} (reel)", alt_text=post.image_headline)
            except WordPressError as exc:
                log.warning("[%s] reel upload failed: %s", site.key, exc)
        story_media: list[dict] = []
        if "story" in hosted and media_by_shape.get("story"):
            for i, frame in enumerate(story_frames, 1):
                try:
                    story_media.append(wp.upload_media(frame, f"{post.title} (story {i})", alt_text=post.image_headline))
                except WordPressError as exc:
                    log.warning("[%s] story frame %d upload failed: %s", site.key, i, exc)
                    break   # frames are a sequence; a gap in the middle is worse than a shorter story
        cat_id = wp.ensure_term("categories", post.category or site.category)
        tag_ids = []
        for tag in post.tags[:8]:
            try:
                tid = wp.ensure_term("tags", tag)
                if tid:
                    tag_ids.append(tid)
            except WordPressError as exc:
                log.warning("tag %r failed: %s", tag, exc)
        wp_post = wp.create_post(
            title=post.title, content=post.body_html, excerpt=post.excerpt, slug=stem,
            category_ids=[cat_id] if cat_id else [], tag_ids=tag_ids,
            featured_media=landscape_media["id"] if landscape_media else None,
        )
    except WordPressError as exc:
        log.error("[%s] WordPress publish failed: %s", site.key, exc)
        state.release(url, site.key)
        report.failed += 1
        return False

    link = wp_post.get("link") or f"{site.public_url}/{stem}/"
    state.mark_published(url, site.key, wp_post["id"], link, post.title)
    if kind in cards.FORMATS:      # a bespoke card (the scorecard) is not part of the rotation
        state.set_note(site.key, "card_formats", cards.dump_history(cards.remember(history, kind)))
    report.published.append(link)
    log.info("[%s] PUBLISHED %s", site.key, link)

    # 5. socials - each platform gets the right shape (image+link, image-only, or link-only)
    mentions: list[str] = []
    ig = next((p for p in publishers if p.platform == "instagram"), None)
    if ig is not None and post.mentions:
        try:
            from .social.mentions import verify
            mentions = verify(post.mentions, ig.creds["USER_ID"], ig.creds["ACCESS_TOKEN"], state)
            log.info("[%s] tagging %s (of %d suggested)", site.key, ", ".join("@" + h for h in mentions) or "nobody",
                     len(post.mentions))
        except Exception as exc:  # noqa: BLE001 - tags are a bonus; the post must not depend on them
            log.warning("[%s] mention verification failed: %s", site.key, exc)
    social = SocialPost(
        title=post.title, link=link,
        captions={
            "twitter": post.captions.twitter, "facebook": _hooked(post.caption_hook, post.captions.facebook),
            "instagram": _hooked(post.caption_hook, post.captions.instagram), "linkedin": post.captions.linkedin,
            "pinterest": post.captions.pinterest, "telegram": post.captions.telegram,
            "threads": post.captions.threads,
        },
        hashtags=site.hashtags,
        images={shape: path for shape, path in cards_by_shape.items() if path},
        image_urls={shape: media["source_url"] for shape, media in
                    (("landscape", landscape_media or {}), *media_by_shape.items()) if media.get("source_url")},
        pinterest_title=post.captions.pinterest_title,
        alt_text=f"{post.image_kicker or post.category or site.category}: {post.image_headline or post.title}",
        mentions=mentions,
        story_urls=[m["source_url"] for m in ([media_by_shape["story"]] if media_by_shape.get("story") else []) + story_media
                    if m.get("source_url")],
        carousel_urls=[m["source_url"] for m in ([media_by_shape["portrait"]] if carousel_media else []) + carousel_media
                       if m.get("source_url")],
        video_url=(reel_media or {}).get("source_url"), video_path=reel_path,
        video_cover_url=(media_by_shape.get("story") or {}).get("source_url"),
        video_share_to_feed=settings.reel_share_to_feed,
    )
    _queue_followups(site, settings, state, post, link, publishers)
    results = dispatch(publishers, social)
    for res in results:
        state.record_social(url, site.key, res.platform, res.ok, res.remote_id, res.url, res.error)
        if res.ok:
            report.social_ok += 1
        else:
            report.social_failed += 1
    if any(res.ok and res.format in ("reel", "video") for res in results):
        state.set_note(site.key, REEL_NOTE, carousels.dump_log(reel_log + [time.time()]))
        log.info("[%s] reel posted for the %s slot", site.key,
                 carousels.slot(time.time(), settings.reel_hours, settings.timezone))
    if any(res.ok and res.format == "carousel" for res in results):
        # the slot is spent only once a carousel is actually up; a failed one leaves it for the next article
        state.set_note(site.key, carousels.NOTE, carousels.dump_log(carousel_log + [time.time()]))
        log.info("[%s] carousel posted for the %s slot", site.key,
                 carousels.slot(time.time(), settings.carousel_hours, settings.timezone))
    return True


def _by_relevance(site: Site, settings: Settings, fresh: list[sources.Candidate]) -> list[sources.Candidate]:
    """Fresh candidates in beat order, with the off-beat ones dropped.

    Publishing nothing beats publishing somebody else's story, so a site with no on-beat candidate
    stays quiet this cycle. A ranking that could not run is different: it returns None, and the
    recency order is used unchanged rather than letting an API hiccup silence the fleet.
    """
    if settings.min_relevance <= 0:
        return fresh
    scored = rank.rank(site, fresh, model=settings.llm_model, pool=settings.rank_pool)
    if scored is None:
        return fresh
    keep = [s for s in scored if s.score >= settings.min_relevance]
    for s in keep[:3]:
        log.info("[%s] on beat (%d/10, %s): %s", site.key, s.score, s.reason, s.candidate.title[:80])
    if not keep:
        best = scored[0] if scored else None
        log.warning("[%s] nothing on beat this cycle: %d candidates scored below %d%s", site.key,
                    len(scored), settings.min_relevance,
                    f"; best was {best.score}/10 {best.candidate.title[:60]!r}" if best else "")
    return [s.candidate for s in keep]


def run_site(site: Site, settings: Settings, state: State, rewriter: Rewriter | None = None,
             wp: WordPress | None = None, publishers=None, work_dir: Path | None = None,
             limit: int | None = None) -> RunReport:
    report = RunReport(site=site.key)
    work_dir = work_dir or settings.data_dir / "images"
    limit = site.max_posts_per_run if limit is None else limit

    def ready():
        nonlocal rewriter, wp, publishers
        rewriter = rewriter or Rewriter(model=effective_model(settings.llm_model), effort=settings.llm_effort)
        wp = wp or make_wordpress(site)
        publishers = build_publishers(site) if publishers is None else publishers

    # follow-ups whose time has come (the steal card, the debate story, the hot take) go first: they
    # are not new articles, so the gap between articles does not apply to them
    if followups.split_due(followups.load(state, site.key), time.time())[0]:
        try:
            ready()
            followups.run(site, settings, state, wp, publishers, work_dir, report)
        except Exception as exc:  # noqa: BLE001
            log.exception("[%s] follow-ups failed: %s", site.key, exc)

    last = state.last_published_at(site.key)
    gap = settings.min_gap_minutes_between_posts * 60
    if last and time.time() - last < gap:
        log.info("[%s] last post %.0f min ago; waiting for the %d min gap", site.key, (time.time() - last) / 60, gap / 60)
        return report

    candidates = sources.collect(site, timeout=settings.request_timeout)
    report.candidates = len(candidates)
    fresh = [c for c in candidates if not state.is_used(c.url, site.key)]
    if not fresh:
        log.info("[%s] nothing new", site.key)
    else:
        fresh = _by_relevance(site, settings, fresh)

    if fresh:
        ready()
        log.info("[%s] %d fresh candidates; socials: %s", site.key, len(fresh), [p.platform for p in publishers] or "none")
        for cand in fresh:
            if len(report.published) >= limit:
                break
            if report.failed >= MAX_CONSECUTIVE_FAILURES and not report.published:
                log.error("[%s] %d consecutive failures; aborting this run (will retry next cycle)", site.key, report.failed)
                break
            if not state.claim(cand.url, site.key, cand.title):
                continue
            ok = publish_one(site, settings, state, cand, rewriter, wp, publishers, work_dir, report)
            if ok and len(report.published) < limit and gap:
                # spread posts a little even inside one run
                time.sleep(min(gap, 60))

    # the ad features: this week's viral ad or a classic revisited, on top of the news. A slot is spent
    # only when a feature actually publishes, so a slot the model or YouTube let down is tried next cycle.
    if site.nostalgia and nostalgia.due(settings, state, site):
        try:
            ready()
            nostalgia.publish_daily(site, settings, state, rewriter, wp, publishers, work_dir, report)
        except Exception as exc:  # noqa: BLE001 - a feature that fails must not take the news down with it
            log.exception("[%s] throwback failed: %s", site.key, exc)
    # ScreenStat's actor scorecards: one per slot, figures from Wikipedia, on top of the news
    if site.scorecards and scorecards.due(settings, state, site):
        try:
            ready()
            scorecards.publish_daily(site, settings, state, rewriter, wp, publishers, work_dir, report)
        except Exception as exc:  # noqa: BLE001
            log.exception("[%s] scorecard failed: %s", site.key, exc)
    log.info(report.summary())
    return report


def run_all(settings: Settings, state: State, only: str | None = None, limit: int | None = None) -> list[RunReport]:
    reports = []
    for site in settings.sites:
        if only and site.key != only.upper():
            continue
        try:
            reports.append(run_site(site, settings, state, limit=limit))
        except Exception as exc:  # noqa: BLE001 - one site must not stop the fleet
            log.exception("[%s] run crashed: %s", site.key, exc)
    return reports
