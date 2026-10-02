"""Per-site settings the owner edits in each site's own wp-admin (the Autopub screen, plugins/autopub-control).

sites.yaml stays the baseline. Every cycle autopub asks the site for its overrides, runs that cycle on a
copy of the site with them applied, and checks in with the baseline and the effective values so the
screen can show what is actually live. A site without the plugin, or one that cannot be reached, runs on
sites.yaml exactly as before.
"""
from __future__ import annotations

import dataclasses
import logging
import re

from .config import Site

log = logging.getLogger(__name__)

ROUTE = "autopub/v1"
MAX_POSTS_PER_RUN = 20
SUBREDDIT = re.compile(r"^[A-Za-z0-9_]{2,21}$")
TOGGLES = ("paused", "nostalgia", "scorecards", "watchlists", "trailers", "scenes", "deepdives", "buzz_meter", "tags_cast")
FIELDS = TOGGLES + ("max_posts_per_run", "news_hours", "reddit_subreddits")


def baseline(site: Site) -> dict:
    return {name: getattr(site, name) for name in FIELDS}


def _hours(value) -> list[int] | None:
    if value is None:
        return None
    if not isinstance(value, list) or not all(isinstance(h, int) and not isinstance(h, bool) for h in value):
        raise ValueError("news_hours must be a list of whole hours, or null for every cycle")
    return sorted({h % 24 for h in value})


def sanitize(raw) -> dict:
    """The overrides worth applying: known fields of the right type. Anything else is dropped with a warning."""
    if not isinstance(raw, dict):
        return {}
    out: dict = {}
    for name, value in raw.items():
        try:
            if name in TOGGLES:
                if not isinstance(value, bool):
                    raise ValueError("must be true or false")
                out[name] = value
            elif name == "max_posts_per_run":
                if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= MAX_POSTS_PER_RUN:
                    raise ValueError(f"must be a whole number from 0 to {MAX_POSTS_PER_RUN}")
                out[name] = value
            elif name == "news_hours":
                out[name] = _hours(value)
            elif name == "reddit_subreddits":
                if not isinstance(value, list) or not all(isinstance(s, str) and SUBREDDIT.match(s) for s in value):
                    raise ValueError("must be a list of subreddit names")
                out[name] = list(dict.fromkeys(value))
            else:
                raise ValueError("not a setting the screen controls")
        except ValueError as exc:
            log.warning("ignoring the override %s=%r: %s", name, value, exc)
    return out


def apply(site: Site, wp) -> Site:
    """This cycle's site: sites.yaml with the wp-admin overrides on top, or sites.yaml alone when the site has none."""
    try:
        resp = wp.plugin_request("GET", f"{ROUTE}/settings")
    except Exception as exc:  # noqa: BLE001 - no plugin, or the site is down: run on sites.yaml
        log.debug("[%s] no wp-admin overrides: %s", site.key, exc)
        return site
    overrides = sanitize(resp.get("overrides") if isinstance(resp, dict) else None)
    live = dataclasses.replace(site, **overrides)
    if overrides:
        log.info("[%s] wp-admin overrides: %s", site.key, overrides)
    try:
        wp.plugin_request("POST", f"{ROUTE}/checkin", json={"baseline": baseline(site), "effective": baseline(live)})
    except Exception as exc:  # noqa: BLE001 - the check-in only feeds the screen
        log.debug("[%s] check-in failed: %s", site.key, exc)
    return live
