"""Give the posts already on a poster-style site the clean featured image.

Until now the website's featured image was the poster with the title baked in; the theme lays its own
title over it and crops it into 2:3 posters, so the type doubled and was sliced. New posts get the clean
still from `poster.featured`; this re-renders it for the posts already published, from the same source
the story came from: the article's own photo, a trailer's or ad's YouTube thumbnail, or the ink ground
with the lockup when there is nothing to fetch. The old media stays in the library; only the post's
featured image changes.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from . import extract, poster
from .config import Settings, Site
from .state import State

log = logging.getLogger(__name__)

_YT = re.compile(r"(?:youtube\.com/watch\?v=|youtu\.be/)([A-Za-z0-9_-]{6,})")


def source_still(url: str, site: Site, timeout: int = 20) -> str | None:
    """Where the story's still comes from, or None when the post has no source photo to fetch."""
    m = _YT.search(url or "")
    if m:
        return f"https://i.ytimg.com/vi/{m.group(1)}/maxresdefault.jpg"
    if not url.startswith("http") or site.domain in url or not site.use_source_image:
        return None
    try:
        return extract.extract(url, timeout=timeout).image
    except Exception as exc:  # noqa: BLE001 - a source that is gone gets the ground, not a crash
        log.warning("[%s] could not re-read %s: %s", site.key, url, exc)
        return None


def refresh(site: Site, settings: Settings, state: State, wp, work_dir: Path, *, limit: int | None = None,
            dry_run: bool = False) -> list[tuple[int, str]]:
    """Replace the featured image of every published post on the site with the clean still. Returns
    (post id, still url or 'ground') for each post touched (or that would be, when dry_run)."""
    done: list[tuple[int, str]] = []
    rows = state.published(site.key)
    if limit:
        rows = rows[:limit]
    out_dir = work_dir / site.slug / "featured"
    out_dir.mkdir(parents=True, exist_ok=True)
    for row in rows:
        post_id, url, title = int(row["wp_post_id"]), row["url"], row["title"] or ""
        still = source_still(url, site, settings.request_timeout)
        label = still or "ground"
        if dry_run:
            done.append((post_id, label))
            continue
        try:
            path = poster.featured(site, out_dir / f"{post_id}.jpg", still)
            media = wp.upload_media(path, title, alt_text=title)
            wp.update_post(post_id, featured_media=media["id"])
        except Exception as exc:  # noqa: BLE001 - one bad post must not stop the rest
            log.warning("[%s] post %s kept its image: %s", site.key, post_id, exc)
            continue
        log.info("[%s] post %s: featured image replaced (%s)", site.key, post_id, label)
        done.append((post_id, label))
    return done
