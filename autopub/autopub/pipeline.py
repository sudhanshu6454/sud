"""Per-site run: discover -> extract -> rewrite -> image -> WordPress -> socials."""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

from slugify import slugify

from . import cards, extract, images, rank, sources
from .config import Settings, Site
from .rewrite import CuratedPost, Rewriter, RewriteSkipped, effective_model
from .social import SocialPost, build_publishers, dispatch
from .state import State
from .wordpress import WordPress, WordPressError

log = logging.getLogger(__name__)

MAX_CONSECUTIVE_FAILURES = 3   # stop a site's run when the model/API keeps failing


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

    # 2. rewrite
    try:
        post: CuratedPost = rewriter.rewrite(site, article)
    except RewriteSkipped as exc:
        state.mark_skipped(url, site.key, str(exc))
        report.skipped += 1
        return False
    except Exception as exc:  # noqa: BLE001 - transient; release so we retry next cycle
        log.error("[%s] rewrite failed: %s", site.key, exc)
        state.release(url, site.key)
        report.failed += 1
        return False

    # 3. images. The Instagram card takes one of a small family of formats, chosen from what the
    # article's material can honestly fill and steered away from what this site posted last, so the
    # grid mixes headline, quote, number, takeaways and question cards without the brand moving.
    stem = slugify(post.slug or post.title)[:60] or f"post-{int(time.time())}"
    if use_source_image is None:
        use_source_image = site.use_source_image
    history = cards.parse_history(state.note(site.key, "card_formats"))
    kind = cards.choose(history, post.card, photo=bool(use_source_image and article.image))
    kicker = post.image_kicker or post.category or site.category
    brief = cards.brief(kind, post.card, post.image_headline or post.title,
                        kicker if kind == cards.HEADLINE else cards.KICKERS.get(kind, kicker), post.excerpt)
    log.info("[%s] instagram card: %s (recent: %s)", site.key, kind, ",".join(history[-cards.HISTORY:]) or "none")
    try:
        rendered = images.render_set(post.image_headline or post.title, kicker, site,
                                     work_dir / site.slug, stem, backdrop_url=article.image if use_source_image else None,
                                     standfirst=post.excerpt, credit=article.sitename if use_source_image else None,
                                     date_text=time.strftime("%d %b %Y"), card=brief)
    except Exception as exc:  # noqa: BLE001
        log.error("[%s] image generation failed: %s", site.key, exc)
        rendered = {}
    cards_by_shape = rendered

    # 3b. the card Instagram will actually accept, trimmed out of the 3:4 master; and the same card
    # framed 9:16 for the story publishers, drawn from the master before it is cropped
    if cards_by_shape.get("portrait"):
        try:
            cards_by_shape["story"] = images.story_asset(cards_by_shape["portrait"], site, work_dir / site.slug / f"{stem}-story.jpg")
        except Exception as exc:  # noqa: BLE001 - a story is a bonus; the feed post must not depend on it
            log.warning("[%s] could not build the story asset: %s", site.key, exc)
        try:
            cards_by_shape["portrait"] = images.instagram_asset(cards_by_shape["portrait"], ratio=settings.instagram_ratio)
        except Exception as exc:  # noqa: BLE001 - fall back to the master; the publisher walks shapes anyway
            log.warning("[%s] could not derive the Instagram asset: %s", site.key, exc)

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
            "twitter": post.captions.twitter, "facebook": post.captions.facebook,
            "instagram": post.captions.instagram, "linkedin": post.captions.linkedin,
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
    )
    for res in dispatch(publishers, social):
        state.record_social(url, site.key, res.platform, res.ok, res.remote_id, res.url, res.error)
        if res.ok:
            report.social_ok += 1
        else:
            report.social_failed += 1
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
        return report

    fresh = _by_relevance(site, settings, fresh)
    if not fresh:
        return report

    rewriter = rewriter or Rewriter(model=effective_model(settings.llm_model), effort=settings.llm_effort)
    wp = wp or make_wordpress(site)
    publishers = build_publishers(site) if publishers is None else publishers
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
