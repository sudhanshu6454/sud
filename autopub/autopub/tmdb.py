"""Film stills and posters from TMDB, for the poster cards and the watchlist slides.

Optional: with TMDB_API_KEY in .env (a free v3 key from themoviedb.org/settings/api) a film's
title and year resolve to its poster and a backdrop still; without it every call returns None and
the cards stay typographic. TMDB's terms ask for a credit wherever its images appear, which the
article footer and the caption carry (CREDIT).
"""
from __future__ import annotations

import logging
import os

import requests

log = logging.getLogger(__name__)

API = "https://api.themoviedb.org/3"
IMG = "https://image.tmdb.org/t/p"
POSTER_SIZE, BACKDROP_SIZE = "original", "original"   # the full-size files: a poster is blown up to 1440x1920
CREDIT = "Film images from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB."


def key() -> str | None:
    return os.environ.get("TMDB_API_KEY") or None


def _get(path: str, params: dict, timeout: int = 15) -> dict | None:
    k = key()
    if not k:
        return None
    try:
        resp = requests.get(f"{API}{path}", params={**params, "api_key": k}, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        log.warning("tmdb %s failed: %s", path, exc)
        return None


def find(title: str, year: int | str | None = None, timeout: int = 15) -> dict | None:
    """The film (or, failing that, the show) TMDB matches to the title and year: id, title, year,
    poster and backdrop URLs (None where TMDB has none), overview."""
    if not key() or not title:
        return None
    params = {"query": title, "include_adult": "false"}
    if year:
        params["year"] = str(year)
    data = _get("/search/movie", params, timeout)
    results = (data or {}).get("results") or []
    kind = "movie"
    if not results:
        data = _get("/search/tv", {"query": title, **({"first_air_date_year": str(year)} if year else {})}, timeout)
        results = (data or {}).get("results") or []
        kind = "tv"
    if not results:
        return None
    hit = results[0]
    date = hit.get("release_date") or hit.get("first_air_date") or ""
    return {
        "id": hit.get("id"), "kind": kind,
        "title": hit.get("title") or hit.get("name") or title,
        "year": int(date[:4]) if date[:4].isdigit() else year,
        "poster": f"{IMG}/{POSTER_SIZE}{hit['poster_path']}" if hit.get("poster_path") else None,
        "backdrop": f"{IMG}/{BACKDROP_SIZE}{hit['backdrop_path']}" if hit.get("backdrop_path") else None,
        "overview": (hit.get("overview") or "")[:300],
    }


MIN_STILL_WIDTH = 1280


def stills(kind: str, tmdb_id: int, timeout: int = 15) -> list[dict]:
    """The film's backdrops (frames from it, mostly without text), best first: the ones with no language
    (no title art burned in) ahead of the rest, then by TMDB's own vote, wide enough to fill a poster."""
    data = _get(f"/{kind}/{tmdb_id}/images", {"include_image_language": "null,en"}, timeout) or {}
    out = []
    for b in data.get("backdrops") or []:
        if not b.get("file_path") or int(b.get("width") or 0) < MIN_STILL_WIDTH:
            continue
        out.append({"url": f"{IMG}/{BACKDROP_SIZE}{b['file_path']}", "textless": not b.get("iso_639_1"),
                    "vote": float(b.get("vote_average") or 0), "votes": int(b.get("vote_count") or 0), "width": int(b["width"])})
    return sorted(out, key=lambda b: (b["textless"], b["vote"], b["votes"], b["width"]), reverse=True)


def film_still(title: str, year: int | str | None = None, timeout: int = 15, exact: bool = False) -> dict | None:
    """An original frame from the film for the poster: the best textless backdrop, else the film's own
    backdrop. `exact` insists the match's title is the one asked for (for lookups from a tag rather than
    the model). Returns url, title, year, kind, id and a credit line; None when TMDB has nothing."""
    hit = find(title, year, timeout)
    if not hit:
        return None
    if exact and _norm(hit["title"]) != _norm(title):
        return None
    frames = stills(hit["kind"], hit["id"], timeout) if hit.get("id") else []
    url = frames[0]["url"] if frames else hit.get("backdrop")
    if not url:
        return None
    when = f" ({hit['year']})" if hit.get("year") else ""
    return {"url": url, "frames": [f["url"] for f in frames] or [url], "title": hit["title"], "year": hit.get("year"),
            "kind": hit["kind"], "id": hit.get("id"), "credit": f"Still: {hit['title']}{when}, via TMDB"}


MIN_PORTRAIT_WIDTH = 800


def person_still(name: str, timeout: int = 15, exact: bool = False) -> dict | None:
    """A portrait of the person from TMDB (its profile photos are tall and sharp, unlike a press photo): the
    best-voted one wide enough for a poster. `exact` insists the match's name is the one asked for."""
    if not key() or not name:
        return None
    data = _get("/search/person", {"query": name, "include_adult": "false"}, timeout)
    results = (data or {}).get("results") or []
    if not results:
        return None
    hit = results[0]
    if exact and _norm(hit.get("name") or "") != _norm(name):
        return None
    shots = _get(f"/person/{hit['id']}/images", {}, timeout) or {}
    good = [pr for pr in shots.get("profiles") or [] if pr.get("file_path") and int(pr.get("width") or 0) >= MIN_PORTRAIT_WIDTH]
    good.sort(key=lambda pr: (float(pr.get("vote_average") or 0), int(pr.get("vote_count") or 0), int(pr.get("width") or 0)), reverse=True)
    path = good[0]["file_path"] if good else hit.get("profile_path")
    if not path:
        return None
    return {"url": f"{IMG}/original{path}", "name": hit.get("name") or name, "id": hit.get("id"),
            "credit": f"Photo: {hit.get('name') or name}, via TMDB"}


def _norm(text: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())
