"""Per-site run: discover -> extract -> rewrite -> image -> WordPress -> socials."""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

from slugify import slugify

from . import extract, images, sources
from .config import Settings, Site
from .rewrite import CuratedPost, Rewriter, RewriteSkipped
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
                wp: WordPress, publishers, work_dir: Path, report: RunReport, use_source_image: bool = False) -> bool:
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

    # 3. images
    stem = slugify(post.slug or post.title)[:60] or f"post-{int(time.time())}"
    try:
        cards = images.render_set(post.image_headline or post.title, post.image_kicker or site.category, site,
                                  work_dir / site.slug, stem, backdrop_url=article.image if use_source_image else None)
    except Exception as exc:  # noqa: BLE001
        log.error("[%s] image generation failed: %s", site.key, exc)
        cards = {}

    # 4. WordPress
    try:
        landscape_media = wp.upload_media(cards["landscape"], post.title, alt_text=post.image_headline) if cards.get("landscape") else None
        square_media = wp.upload_media(cards["square"], f"{post.title} (square)", alt_text=post.image_headline) if cards.get("square") else None
        cat_id = wp.ensure_term("categories", site.category)
        tag_ids = []
        for tag in post.tags[:8]:
            try:
                tag_ids.append(wp.ensure_term("tags", tag))
            except WordPressError as exc:
                log.warning("tag %r failed: %s", tag, exc)
        wp_post = wp.create_post(
            title=post.title, content=post.body_html, excerpt=post.excerpt, slug=stem,
            category_ids=[cat_id], tag_ids=tag_ids,
            featured_media=landscape_media["id"] if landscape_media else None,
        )
    except WordPressError as exc:
        log.error("[%s] WordPress publish failed: %s", site.key, exc)
        state.release(url, site.key)
        report.failed += 1
        return False

    link = wp_post.get("link") or f"{site.public_url}/{stem}/"
    state.mark_published(url, site.key, wp_post["id"], link, post.title)
    report.published.append(link)
    log.info("[%s] PUBLISHED %s", site.key, link)

    # 5. socials - each platform gets the right shape (image+link, image-only, or link-only)
    social = SocialPost(
        title=post.title, link=link,
        captions={
            "twitter": post.captions.twitter, "facebook": post.captions.facebook,
            "instagram": post.captions.instagram, "linkedin": post.captions.linkedin,
            "pinterest": post.captions.pinterest, "telegram": post.captions.telegram,
            "threads": post.captions.threads,
        },
        hashtags=site.hashtags,
        image_landscape=cards.get("landscape"), image_square=cards.get("square"),
        image_landscape_url=(landscape_media or {}).get("source_url"),
        image_square_url=(square_media or {}).get("source_url"),
        pinterest_title=post.captions.pinterest_title,
    )
    for res in dispatch(publishers, social):
        state.record_social(url, site.key, res.platform, res.ok, res.remote_id, res.url, res.error)
        if res.ok:
            report.social_ok += 1
        else:
            report.social_failed += 1
    return True


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

    rewriter = rewriter or Rewriter(model=settings.llm_model, effort=settings.llm_effort)
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
