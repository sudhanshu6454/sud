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


# YouTube's own search filters, as the `sp` parameter carries them
FILTER_VIDEO = "EgIQAQ=="            # type: video
FILTER_VIRAL_MONTH = "CAMSBAgEEAE="  # sort by view count, uploaded this month, video
FILTER_VIRAL_ALL = "CAMSAhAB"        # sort by view count, video


def search(query: str, timeout: int = 20, sp: str = FILTER_VIDEO) -> list[dict]:
    try:
        resp = requests.get(SEARCH, params={"search_query": query, "sp": sp}, headers=HEADERS, timeout=timeout)
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


STUDIO_WORDS = ("productions", "production", "films", "film", "studios", "studio", "pictures", "movies", "motion pictures",
                "entertainment", "music", "records", "cinemas", "creations", "company", "international", "arts", "banner")
FAN_WORDS = ("reaction", "reacts", "review", "tv", "clips", "edits", "fan", "status", "bolta", "explained", "dubbed", "spoof",
             "recap", "shorts", "vlog", "podcast", "channel", "news", "updates", "trailers", "cinema stars", "buzz", "talkies",
             # entertainment press and trailer aggregators re-upload trailers; they are not the rights holder
             "entertainment tonight", "et canada", "access", "extra", "e!", "variety", "deadline", "hollywood reporter",
             "rotten tomatoes", "fandango", "movieclips", "ign", "collider", "screenrant", "screen rant", "kinocheck",
             "one media", "trailer zone", "insider", "tonight", "paps", "paparazzi", "times", "hungama", "pinkvilla",
             "filmibeat", "koimoi", "zoom", "spy", "bollywood now", "hindustan", "express", "ndtv", "india today", "abp",
             "aaj tak", "mirchi", "red fm", "radio", "magazine", "gossip", "masala", "filmfare", "jimmy", "late night",
             "the tonight show", "good morning", "today show", "cnn", "bbc", "cbs", "nbc", "abc")
KNOWN_STUDIOS = ("yash raj films", "dharma productions", "t-series", "zee music company", "zee studios", "sony pictures",
                 "sony music india", "excel movies", "maddock films", "hombale films", "mythri movie makers", "sun pictures",
                 "red chillies entertainment", "eros now", "tips official", "saregama", "aanand l rai", "colour yellow",
                 "jio studios", "netflix india", "netflix", "prime video india", "prime video", "jiohotstar", "disney plus hotstar",
                 "sonyliv", "zee5", "marvel entertainment", "warner bros", "universal pictures", "paramount pictures",
                 "20th century studios", "lionsgate", "a24", "lyca productions", "aashirvaad cinemas", "geetha arts",
                 "sithara entertainments", "haarika & hassine", "dvv entertainment", "vyjayanthi movies", "kvn productions",
                 "pen movies", "viacom18 studios", "balaji motion pictures", "nadiadwala grandson", "sajid nadiadwala",
                 "junglee pictures", "sikhya entertainment", "roy kapur films", "rsvp movies", "bhansali productions",
                 "phantom films", "clean slate filmz", "matchbox shots", "anil kapoor film company", "ajay devgn ffilms",
                 "salman khan films", "tips industries", "panorama studios", "abundantia entertainment", "cinema1 studios",
                 "hbo max", "hbo", "apple tv", "peacock", "hulu", "amazon mgm studios", "mgm", "paramount plus", "disney plus",
                 "pixar", "dreamworks", "focus features", "searchlight pictures", "neon", "mubi", "sony pictures classics",
                 "legendary", "blumhouse", "annapurna pictures", "studiocanal", "bleecker street", "ifc films", "magnolia pictures",
                 "aha video", "sun nxt", "manorama max", "hoichoi", "shemaroo", "ultra bollywood", "rajshri", "venus", "goldmines",
                 # the rights holders whose channels carry scenes and songs of the classics and the catalogue
                 "yrf", "ultra", "eros", "viacom18", "reliance entertainment", "nh studioz", "b4u", "zee cinema", "zee classic",
                 "sony max", "star gold", "colors cineplex", "&pictures", "moserbaer", "pen studios", "the criterion collection",
                 "warner bros. entertainment", "paramount movies", "sony pictures entertainment", "lionsgate movies", "20th century")


def is_official_trailer(video: dict, film: str, studio: str = "") -> bool:
    """Whether the upload is the studio's own (or the film's own channel), never a fan's, a reaction's or a
    review channel's. The named studio decides when there is one; otherwise the channel's own name does:
    a known studio, or a name that reads like one (Productions, Films, Pictures...) with no fan word in it."""
    channel = (video.get("channel") or "").lower()
    ch = re.sub(r"[^a-z0-9]", "", channel)
    studio_l = re.sub(r"[^a-z0-9]", "", (studio or "").lower())
    film_l = re.sub(r"[^a-z0-9]", "", film.lower())
    if studio_l and len(studio_l) >= 4 and (studio_l in ch or ch in studio_l):
        return True
    words = [re.sub(r"[^a-z0-9]", "", w) for w in (studio or "").lower().split() if len(w) > 3]
    if words and sum(1 for w in words if w in ch) >= max(1, len(words) - 1):
        return True
    if film_l and len(film_l) >= 5 and film_l in ch:
        return True
    if any(re.sub(r"[^a-z0-9]", "", k) in ch for k in KNOWN_STUDIOS):
        return True
    fan = any(re.search(r"\b" + re.escape(w) + r"\b", channel) for w in FAN_WORDS)
    looks_like_studio = any(re.search(r"\b" + re.escape(w) + r"\b", channel) for w in STUDIO_WORDS)
    return looks_like_studio and not fan and "official" in (video.get("title") or "").lower()


SCENE_WORDS = ("scene", "song", "monologue", "dialogue", "climax", "clip", "moment", "sequence", "best of", "full song", "video song")
MIN_SCENE_SECONDS, MAX_SCENE_SECONDS = 20, 12 * 60      # streamers cut a scene long; the reel takes the first ad_clip_max_seconds of it
# a studio's channel also carries what is not the scene: its trailer, the making, the press round, the review
NOT_A_SCENE = re.compile(r"\b(trailer|teaser|review|reaction|interview|making|behind the scenes|bts|press|podcast|full movie|full film|"
                         r"promo|announcement|first look|explained|recap)\b", re.I)


def _collapse(text: str) -> str:
    """Lowercase, letters and digits only, doubled letters folded: 'Deewaar' and 'Deewar' meet, 'Sholay' stays."""
    out = []
    for ch in re.sub(r"[^a-z0-9]", "", (text or "").lower()):
        if not out or out[-1] != ch:
            out.append(ch)
    return "".join(out)


def _names_film(title: str, film: str) -> bool:
    """Whether the upload's title names the film, forgiving transliteration (Deewar/Deewaar, Dilwale/Dilwaale)."""
    t = _collapse(title)
    if _collapse(film) in t:
        return True
    words = [_collapse(w) for w in re.findall(r"\w+", film) if len(w) > 2]
    return bool(words) and sum(1 for w in words if w in t) >= max(1, len(words) - 1)


def choose_scene(results: list[dict], film: str, studio: str = "", query: str = "") -> dict | None:
    """The upload most likely to be the scene itself: it names the film (or the scene the query names), it is
    a scene's length (never a full film), and it sits on the rights holder's channel; a fan's upload never
    qualifies. The most watched of those wins."""
    film_l = _collapse(film)
    asked = [_collapse(w) for w in re.findall(r"\w+", query) if len(w) > 3 and _collapse(w) not in film_l]

    def names_scene(t: str) -> bool:
        t = _collapse(t)
        return bool(asked) and sum(1 for w in asked if w in t) >= max(2, int(len(asked) * 0.6))

    def fits(v):
        t = v.get("title") or ""
        if NOT_A_SCENE.search(t):
            return False
        return (v.get("seconds") and MIN_SCENE_SECONDS <= v["seconds"] <= MAX_SCENE_SECONDS
                and (_names_film(t, film) or names_scene(t)))

    good = [v for v in results if fits(v) and is_official_trailer(v, film, studio)]
    if not good:
        return None
    return max(good, key=lambda v: (_names_film(v.get("title") or "", film), v.get("views") or 0))


def find_scene(film: str, query: str, studio: str = "", year: int | str | None = None, timeout: int = 20,
               scene: str = "") -> dict | None:
    """The scene on YouTube, on the rights holder's own channel, or None: the editor's query first, then the film
    with the scene's own words, then the film with the studio. Returns id, title, channel, url, thumbnail, official."""
    tries = [query]
    if scene:
        tries.append(f"{film} {' '.join(scene.split()[:7])}")
    tries.append(f"{film} {year or ''} scene {studio}".strip())
    pick = None
    for q in tries:
        pick = choose_scene(search(q, timeout), film, studio, query)
        if pick is not None:
            break
    if pick is None:
        return None
    pick["official"] = True
    pick["url"] = f"https://www.youtube.com/watch?v={pick['id']}"
    pick["thumbnail"] = f"https://i.ytimg.com/vi/{pick['id']}/maxresdefault.jpg"
    return pick


# what people search for when they want the scene, not the film: the discovery runs these on the
# rights holders' catalogue and on the languages the site covers, this month and all time
SCENE_QUERIES = ("best bollywood scene", "iconic hindi film scene", "bollywood dialogue scene", "hindi movie climax scene",
                 "tamil movie best scene", "telugu movie best scene", "malayalam movie best scene", "kannada movie best scene",
                 "hollywood iconic movie scene", "movie monologue scene", "bollywood full video song",
                 "shemaroo movies scene", "ultra bollywood scene", "goldmines scene", "yrf scene", "netflix india scene",
                 "prime video india scene", "jiohotstar scene", "sony pictures scene", "warner bros scene")


def viral_scenes(queries=SCENE_QUERIES, min_views: int = 500_000, timeout: int = 20, per_query: int = 20,
                 exclude=None, limit: int = 40) -> list[dict]:
    """The scene clips YouTube itself ranks highest by views, this month and all time, kept only when they sit
    on a rights holder's channel, run a scene's length and are not a trailer, review or full film. Most
    watched first; `exclude` is a set of URLs already used."""
    exclude = exclude or set()
    found: dict[str, dict] = {}
    for sp in (FILTER_VIRAL_MONTH, FILTER_VIRAL_ALL):
        for q in queries:
            for v in search(q, timeout, sp)[:per_query]:
                url = f"https://www.youtube.com/watch?v={v['id']}"
                if url in exclude or v["id"] in found:
                    continue
                t = v.get("title") or ""
                if NOT_A_SCENE.search(t) or not v.get("seconds") or not (MIN_SCENE_SECONDS <= v["seconds"] <= MAX_SCENE_SECONDS):
                    continue
                if (v.get("views") or 0) < min_views or not is_official_trailer(v, "", ""):
                    continue
                found[v["id"]] = {**v, "url": url, "thumbnail": f"https://i.ytimg.com/vi/{v['id']}/maxresdefault.jpg",
                                  "official": True, "this_month": sp == FILTER_VIRAL_MONTH}
    return sorted(found.values(), key=lambda v: (v.get("this_month", False), v.get("views") or 0), reverse=True)[:limit]


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
