"""Give the posts already on a poster-style site the 3:4 poster as their featured image.

The website carries the same poster the Instagram grid does, and the theme sets its type beside it.
This re-renders the poster for the posts already published, from the post's own title, section and
standfirst and the same still the story came from: the source article's photo, a trailer's or ad's
YouTube thumbnail, the article's own image, or a TMDB backdrop for a watchlist's first film; the ink
ground when there is nothing to fetch. The old media stays in the library; only the post's featured
image changes.
"""
from __future__ import annotations

import html
import logging
import re
from pathlib import Path

from . import extract, poster, tmdb
from .config import Settings, Site
from .state import State

log = logging.getLogger(__name__)

_YT = re.compile(r"(?:youtube\.com/watch\?v=|youtu\.be/)([A-Za-z0-9_-]{6,})")
_IMG = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.I)
_FILM = re.compile(r"<td><strong>([^<]+)</strong>(?:\s*\((\d{4})\))?</td>")


def still_in_post(content: str, timeout: int = 15) -> str | None:
    """A still from the article itself: the first image it carries (a scorecard's portrait), else the
    backdrop TMDB has for the first film in a watchlist's table."""
    m = _IMG.search(content or "")
    if m:
        return m.group(1)
    for title, year in _FILM.findall(content or "")[:4]:
        try:
            hit = tmdb.find(title, year or None, timeout)
        except Exception as exc:  # noqa: BLE001
            log.debug("tmdb lookup failed for %r: %s", title, exc)
            hit = None
        if hit and hit.get("backdrop"):
            return hit["backdrop"]
    return None


def source_still(url: str, site: Site, timeout: int = 20, content: str = "") -> str | None:
    """Where the story's still comes from: a trailer's or ad's YouTube thumbnail, the source article's
    own photo, or what the post itself carries. None when there is nothing to fetch."""
    m = _YT.search(url or "")
    if m:
        return f"https://i.ytimg.com/vi/{m.group(1)}/maxresdefault.jpg"
    if url.startswith("http") and site.domain not in url and site.use_source_image:
        try:
            got = extract.extract(url, timeout=timeout).image
        except Exception as exc:  # noqa: BLE001 - a source that is gone gets the ground, not a crash
            log.warning("[%s] could not re-read %s: %s", site.key, url, exc)
            got = None
        if got:
            return got
    return still_in_post(content, timeout)


def _text(rendered: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", rendered or "")).replace("[&hellip;]", "").strip()


def refresh(site: Site, settings: Settings, state: State, wp, work_dir: Path, *, limit: int | None = None,
            dry_run: bool = False) -> list[tuple[int, str]]:
    """Replace the featured image of every published post on the site with its poster. Returns
    (post id, still url or 'ground') for each post touched (or that would be, when dry_run)."""
    done: list[tuple[int, str]] = []
    rows = state.published(site.key)
    if limit:
        rows = rows[:limit]
    out_dir = work_dir / site.slug / "featured"
    out_dir.mkdir(parents=True, exist_ok=True)
    sections: dict[int, str] = {}
    for row in rows:
        post_id, url, title = int(row["wp_post_id"]), row["url"], row["title"] or ""
        content, standfirst, kicker = "", "", site.category
        if wp is not None:
            try:
                post = wp.get_post(post_id)
                content = (post.get("content") or {}).get("rendered") or ""
                title = _text((post.get("title") or {}).get("rendered") or "") or title
                standfirst = _text((post.get("excerpt") or {}).get("rendered") or "")
                for cid in post.get("categories") or []:
                    if cid not in sections:
                        sections[cid] = (wp.get_category(cid) or {}).get("name") or ""
                    if sections[cid] and sections[cid].lower() != "uncategorized":
                        kicker = sections[cid]
                        break
            except Exception as exc:  # noqa: BLE001 - the post may be gone; the state's title is the fallback
                log.warning("[%s] could not read post %s: %s", site.key, post_id, exc)
        still = source_still(url, site, settings.request_timeout, content)
        label = still or "ground"
        if dry_run:
            done.append((post_id, label))
            continue
        try:
            path = poster.card(title, kicker, site, out_dir / f"{post_id}.jpg", "portrait", backdrop_url=still,
                               standfirst=standfirst or None)
            media = wp.upload_media(path, title, alt_text=title)
            wp.update_post(post_id, featured_media=media["id"])
        except Exception as exc:  # noqa: BLE001 - one bad post must not stop the rest
            log.warning("[%s] post %s kept its image: %s", site.key, post_id, exc)
            continue
        log.info("[%s] post %s: featured image replaced (%s)", site.key, post_id, label)
        done.append((post_id, label))
    return done
