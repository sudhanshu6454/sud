"""Find the official upload of an ad on YouTube, so the article can embed it.

Embedding is what the article does with the film: the player is YouTube's, the views and the
rights stay with whoever uploaded it, and the ad plays with its own sound on our page. Nothing is
downloaded here (adclip.py does that, only when the operator switches it on). The search page carries its results as JSON (ytInitialData),
which is read here without an API key; if YouTube changes the page the lookup returns nothing and
the feature is written without an embed rather than with a wrong one.
"""
from __future__ import annotations

import json
import logging
import re

import requests

log = logging.getLogger(__name__)

SEARCH = "https://www.youtube.com/results"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
           "Accept-Language": "en-IN,en;q=0.9", "Cookie": "CONSENT=YES+1; SOCS=CAI"}
MIN_SECONDS, MAX_SECONDS = 10, 6 * 60      # an ad film, not a compilation or a documentary
_DATA = re.compile(r"var ytInitialData = (\{.*?\});</script>", re.S)


def _seconds(length: str | None) -> int | None:
    if not length:
        return None
    parts = length.split(":")
    try:
        return sum(int(p) * 60 ** i for i, p in enumerate(reversed(parts)))
    except ValueError:
        return None


def _views(text: str | None) -> int:
    digits = re.sub(r"[^\d]", "", text or "")
    return int(digits) if digits else 0


def parse(html: str) -> list[dict]:
    """Every video on a results page: id, title, channel, seconds, views."""
    m = _DATA.search(html)
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError:
        return []
    out = []

    def walk(node):
        if isinstance(node, dict):
            if "videoRenderer" in node:
                v = node["videoRenderer"]
                title = "".join(r.get("text", "") for r in v.get("title", {}).get("runs", []))
                out.append({"id": v.get("videoId"), "title": title,
                            "channel": (v.get("ownerText", {}).get("runs") or [{}])[0].get("text", ""),
                            "seconds": _seconds(v.get("lengthText", {}).get("simpleText")),
                            "views": _views(v.get("viewCountText", {}).get("simpleText"))})
            for x in node.values():
                walk(x)
        elif isinstance(node, list):
            for x in node:
                walk(x)

    walk(data)
    return [v for v in out if v["id"]]


def choose(results: list[dict], brand: str, campaign: str = "") -> dict | None:
    """The upload most likely to be the ad itself: brand in the title, ad-film length, the brand's
    own channel first, then the most watched."""
    brand_l = brand.lower()
    words = [w for w in re.findall(r"\w+", campaign.lower()) if len(w) > 3]

    def fits(v):
        return brand_l in v["title"].lower() and v["seconds"] and MIN_SECONDS <= v["seconds"] <= MAX_SECONDS

    good = [v for v in results if fits(v)]
    if not good:
        return None

    def score(v):
        named = sum(1 for w in words if w in v["title"].lower())
        return (is_official(v, brand), named, v["views"])

    return max(good, key=score)


def is_official(video: dict, brand: str) -> bool:
    """Whether the upload is the brand's own: the brand's name is in the channel's."""
    return brand.lower().replace(" ", "") in (video.get("channel") or "").lower().replace(" ", "")


def search(query: str, timeout: int = 20) -> list[dict]:
    try:
        resp = requests.get(SEARCH, params={"search_query": query, "sp": "EgIQAQ%3D%3D"}, headers=HEADERS, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException as exc:
        log.warning("youtube search failed for %r: %s", query, exc)
        return []
    return parse(resp.text)


TRAILER_WORDS = ("trailer", "teaser", "first look", "glimpse", "title reveal", "song")


def choose_trailer(results: list[dict], film: str, studio: str = "") -> dict | None:
    """The upload most likely to be the trailer itself: the film in the title with a trailer word, an
    ad-film length, the studio's (or the film's own) channel first, then the most watched."""
    film_l = film.lower()
    film_words = [w for w in re.findall(r"\w+", film_l) if len(w) > 2]
    studio_l = re.sub(r"[^a-z0-9]", "", (studio or "").lower())

    def fits(v):
        t = v["title"].lower()
        named = film_l in t or (film_words and sum(1 for w in film_words if w in t) >= max(1, len(film_words) - 1))
        return named and any(w in t for w in TRAILER_WORDS) and v["seconds"] and MIN_SECONDS <= v["seconds"] <= MAX_SECONDS

    good = [v for v in results if fits(v)]
    if not good:
        return None

    def score(v):
        return (is_official_trailer(v, film, studio), "official" in v["title"].lower(), v["views"])

    return max(good, key=score)


def is_official_trailer(video: dict, film: str, studio: str = "") -> bool:
    """Whether the upload is the studio's own, or the film's own channel: the studio's name (or the film's) in the channel."""
    ch = re.sub(r"[^a-z0-9]", "", (video.get("channel") or "").lower())
    studio_l = re.sub(r"[^a-z0-9]", "", (studio or "").lower())
    film_l = re.sub(r"[^a-z0-9]", "", film.lower())
    if studio_l and len(studio_l) >= 4 and (studio_l in ch or ch in studio_l):
        return True
    words = [re.sub(r"[^a-z0-9]", "", w) for w in (studio or "").lower().split() if len(w) > 3]
    if words and sum(1 for w in words if w in ch) >= max(1, len(words) - 1):
        return True
    return bool(film_l) and len(film_l) >= 5 and film_l in ch


def find_trailer(film: str, studio: str = "", year: int | str | None = None, timeout: int = 20) -> dict | None:
    """The trailer on YouTube, or None. Returns id, title, channel, url, thumbnail, and `official`."""
    query = " ".join(p for p in (film, "official trailer", str(year) if year else "") if p)
    pick = choose_trailer(search(query, timeout), film, studio)
    if pick is None:
        pick = choose_trailer(search(f"{film} teaser trailer {studio}".strip(), timeout), film, studio)
    if pick is None:
        return None
    pick["official"] = is_official_trailer(pick, film, studio)
    pick["url"] = f"https://www.youtube.com/watch?v={pick['id']}"
    pick["thumbnail"] = f"https://i.ytimg.com/vi/{pick['id']}/maxresdefault.jpg"
    return pick


def find_ad(brand: str, campaign: str, year: int | str | None = None, timeout: int = 20) -> dict | None:
    """The ad on YouTube, or None. Returns id, title, channel, url, thumbnail, and `official`: whether
    the upload is the brand's own (the only kind adclip will ever fetch)."""
    campaign = re.sub(r"[#\"'“”‘’]", " ", campaign or "").strip()   # a hashtag in the query buries the brand's own upload
    query = " ".join(p for p in (brand, campaign, str(year) if year else "", "ad") if p)
    pick = choose(search(query, timeout), brand, campaign)
    if pick is None and campaign:
        pick = choose(search(f"{brand} {campaign} commercial", timeout), brand, campaign)
    if pick is None:
        return None
    pick["official"] = is_official(pick, brand)
    pick["url"] = f"https://www.youtube.com/watch?v={pick['id']}"
    pick["thumbnail"] = f"https://i.ytimg.com/vi/{pick['id']}/maxresdefault.jpg"
    return pick
