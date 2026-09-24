"""Find the official upload of an ad on YouTube, so the article can embed it.

Embedding is what the article does with the film: the player is YouTube's, the views and the
rights stay with whoever uploaded it, and the ad plays with its own sound on our page. Nothing is
downloaded and nothing is re-hosted. The search page carries its results as JSON (ytInitialData),
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
        official = brand_l.replace(" ", "") in v["channel"].lower().replace(" ", "")
        named = sum(1 for w in words if w in v["title"].lower())
        return (official, named, v["views"])

    return max(good, key=score)


def search(query: str, timeout: int = 20) -> list[dict]:
    try:
        resp = requests.get(SEARCH, params={"search_query": query, "sp": "EgIQAQ%3D%3D"}, headers=HEADERS, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException as exc:
        log.warning("youtube search failed for %r: %s", query, exc)
        return []
    return parse(resp.text)


def find_ad(brand: str, campaign: str, year: int | str | None = None, timeout: int = 20) -> dict | None:
    """The ad on YouTube, or None. Returns id, title, channel, url, thumbnail."""
    query = " ".join(p for p in (brand, campaign, str(year) if year else "", "ad") if p)
    pick = choose(search(query, timeout), brand, campaign)
    if pick is None and campaign:
        pick = choose(search(f"{brand} {campaign} commercial", timeout), brand, campaign)
    if pick is None:
        return None
    pick["url"] = f"https://www.youtube.com/watch?v={pick['id']}"
    pick["thumbnail"] = f"https://i.ytimg.com/vi/{pick['id']}/maxresdefault.jpg"
    return pick
