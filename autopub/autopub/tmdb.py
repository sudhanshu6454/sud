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
POSTER_SIZE, BACKDROP_SIZE = "w780", "w1280"
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
