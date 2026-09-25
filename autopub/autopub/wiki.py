"""Facts about an actor's films from Wikipedia, for the ScreenStat scorecards.

Everything numeric in a scorecard comes from here, never from the model: the filmography table
on the actor's (or their filmography) page gives the films and years; each recent film's infobox
gives its budget and box office; Wikidata gives the date of birth and the awards. The model is
handed the figures and writes the analysis around them.

Wikipedia is read through the MediaWiki API with a descriptive User-Agent, as its policy asks,
and one page at a time with a short pause, so a scorecard costs a dozen requests and no ill will.
"""
from __future__ import annotations

import html as htmllib
import logging
import re
import time
from dataclasses import dataclass, field

import requests

log = logging.getLogger(__name__)

API = "https://en.wikipedia.org/w/api.php"
WIKIDATA = "https://www.wikidata.org/w/api.php"
UA = {"User-Agent": "autopub/1.0 (ScreenStat scorecards; contact@screenstat.in)"}
PAUSE = 0.8                  # seconds between requests
USD_INR = 83.0               # a round conversion for the odd film whose figures Wikipedia gives in dollars
_TAG = re.compile(r"<[^>]+>")
_SUP = re.compile(r"<sup.*?</sup>|<span class=\"reference.*?</span>", re.S)


def _text(fragment: str) -> str:
    fragment = _SUP.sub("", fragment)
    fragment = re.sub(r"<br\s*/?>", " ", fragment)
    return " ".join(htmllib.unescape(_TAG.sub("", fragment)).split())


def get(params: dict, timeout: int = 20, api: str = API) -> dict:
    """One API call, backing off on 429 the way Wikimedia asks (Retry-After, else doubling)."""
    delay = PAUSE
    for attempt in range(5):
        time.sleep(delay)
        resp = requests.get(api, params={**params, "format": "json"}, headers=UA, timeout=timeout)
        if resp.status_code == 429 and attempt < 4:
            delay = float(resp.headers.get("Retry-After") or 2 ** (attempt + 1))
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError("wikipedia kept answering 429")


def page_html(title: str) -> tuple[str, str] | None:
    """(resolved title, rendered HTML) or None when there is no such page."""
    data = get({"action": "parse", "page": title, "prop": "text", "redirects": 1})
    if "error" in data:
        return None
    return data["parse"]["title"], data["parse"]["text"]["*"]


def search(query: str) -> list[str]:
    data = get({"action": "query", "list": "search", "srsearch": query, "srlimit": 5})
    return [hit["title"] for hit in data.get("query", {}).get("search", [])]


# ---- the filmography table ---------------------------------------------------------------------

@dataclass
class Film:
    year: int
    title: str
    page: str | None = None          # the film's Wikipedia page title, when linked
    notes: str = ""
    budget_cr: float | None = None   # crore INR
    gross_cr: float | None = None    # crore INR, worldwide where given
    language: str = ""


def _cells(row_html: str) -> list[tuple[str, int, str | None]]:
    """(text, rowspan, linked page title) for each th/td in a row."""
    out = []
    for m in re.finditer(r"<(t[hd])([^>]*)>(.*?)</\1>", row_html, re.S):
        attrs, inner = m.group(2), m.group(3)
        span = re.search(r'rowspan="?(\d+)', attrs)
        link = re.search(r'<a[^>]+href="/wiki/([^"#?]+)"[^>]*>', inner)
        page = htmllib.unescape(link.group(1)).replace("_", " ") if link and ":" not in link.group(1) else None
        out.append((_text(inner), int(span.group(1)) if span else 1, page))
    return out


def parse_filmography(page: str) -> list[Film]:
    """Every (year, film) row from tables headed Year and Film/Title, rowspans unrolled.

    Wikipedia filmographies put the year once with a rowspan across that year's films, which is
    what trips a naive reader; the carry-down here is the whole trick."""
    films: list[Film] = []
    # a filmography page also lists television, music videos, hosting and songs, all under a "Title"
    # column like the films. What tells them apart is the section heading each table sits under:
    # "Films", "Feature films", "Hindi films" on one side; "Television", "Short films", "Music
    # videos", "Discography", "As host" on the other.
    film_tables, all_tables = [], []
    heading = ""
    for part in re.split(r"(<h[2-4][^>]*>.*?</h[2-4]>)", page, flags=re.S):
        if part.startswith("<h"):
            heading = _text(part).lower()
            continue
        for table in re.findall(r"<table[^>]*class=\"[^\"]*wikitable[^\"]*\"[^>]*>(.*?)</table>", part, re.S):
            all_tables.append(table)
            if "film" in heading and not any(w in heading for w in ("short", "television", "music", "video", "web", "host", "dubb", "award", "upcoming")):
                film_tables.append(table)
    def header_of(table):
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S)
        return [c[0].lower() for c in _cells(rows[0])] if rows else []
    if not film_tables:
        film_tables = [t for t in all_tables if any(h in ("film", "films", "movie") for h in header_of(t))]
    for table in (film_tables or all_tables):
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S)
        if not rows:
            continue
        headers = [c[0].lower() for c in _cells(rows[0])]
        if not headers or not any(h.startswith("year") for h in headers):
            continue
        title_col = next((i for i, h in enumerate(headers) if h in ("film", "films", "movie", "title")), None)
        year_col = next(i for i, h in enumerate(headers) if h.startswith("year"))
        if title_col is None:
            continue
        notes_col = next((i for i, h in enumerate(headers) if h.startswith("note")), None)
        lang_col = next((i for i, h in enumerate(headers) if h.startswith("language")), None)
        carry: dict[int, tuple[tuple[str, int, str | None], int]] = {}
        for row in rows[1:]:
            cells = _cells(row)
            if not cells:
                continue
            # rebuild the logical row: cells carried down by rowspan fill the columns they own
            logical: list[tuple[str, int, str | None]] = []
            it = iter(cells)
            col = 0
            while col < len(headers):
                if col in carry:
                    cell, left = carry[col]
                    logical.append(cell)
                    if left - 1 <= 0:
                        del carry[col]
                    else:
                        carry[col] = (cell, left - 1)
                else:
                    cell = next(it, None)
                    if cell is None:
                        break
                    logical.append(cell)
                    if cell[1] > 1:
                        carry[col] = (cell, cell[1] - 1)
                col += 1
            if len(logical) <= max(year_col, title_col):
                continue
            ym = re.search(r"(19|20)\d\d", logical[year_col][0])
            title = logical[title_col][0]
            if not ym or not title or title.lower() in ("tba", "tbd"):
                continue
            if "†" in title or "‡" in title:      # the dagger marks a film not yet released: no record yet
                continue
            title = title.strip(" *")
            films.append(Film(year=int(ym.group()), title=title, page=logical[title_col][2],
                              notes=logical[notes_col][0] if notes_col is not None and notes_col < len(logical) else "",
                              language=logical[lang_col][0] if lang_col is not None and lang_col < len(logical) else ""))
    # the same film can appear twice (two tables, dubbed versions): keep the first
    seen, out = set(), []
    for f in films:
        key = (f.year, f.title.lower())
        if key not in seen:
            seen.add(key)
            out.append(f)
    return out


def filmography(actor: str) -> tuple[str, list[Film]] | None:
    """The actor's films from their filmography page, else from their own page's table."""
    for title in (f"{actor} filmography", actor):
        got = page_html(title)
        if got is None:
            continue
        resolved, page = got
        films = parse_filmography(page)
        if len(films) >= 5:
            return resolved, films
    return None


# ---- money --------------------------------------------------------------------------------------

_NUM = re.compile(r"(\d[\d,]*(?:\.\d+)?)")


def crore(text: str) -> float | None:
    """The first figure in a Wikipedia money string as crore INR: '₹1,050–1,160 crore' -> 1050,
    'est. ₹300 crore' -> 300, '$45 million' -> 373.5, '₹3.5 billion' -> 350."""
    t = text.replace(" ", " ").replace("\xa0", " ")
    m = _NUM.search(t)
    if not m:
        return None
    value = float(m.group(1).replace(",", ""))
    tail = t[m.end():m.end() + 40].lower()
    head = t[:m.start()].lower()
    unit = 1.0
    if "crore" in tail or "cr" in tail.split()[:1]:
        unit = 1.0
    elif "billion" in tail:
        unit = 100.0
    elif "million" in tail:
        unit = 0.1
    elif "lakh" in tail:
        unit = 0.01
    elif value > 100000:            # a bare rupee figure like ₹3,500,000,000
        unit = 1e-7
    if "$" in head or "us$" in head or "usd" in head:
        unit *= USD_INR
    return round(value * unit, 2)


def film_money(page_title: str) -> tuple[float | None, float | None]:
    """(budget, gross) in crore INR from the film's infobox, None where Wikipedia has nothing."""
    got = page_html(page_title)
    if got is None:
        return None, None
    _, page = got
    out = {}
    for label in ("Budget", "Box office"):
        m = re.search(r'<th[^>]*class="infobox-label"[^>]*>\s*' + label + r'\s*</th>\s*<td[^>]*>(.*?)</td>', page, re.S)
        out[label] = crore(_text(m.group(1))) if m else None
    return out["Budget"], out["Box office"]


# ---- wikidata ---------------------------------------------------------------------------------------

@dataclass
class Person:
    title: str
    born: str | None = None
    awards: int = 0
    description: str = ""
    labels: list[str] = field(default_factory=list)


def person(title: str) -> Person:
    data = get({"action": "wbgetentities", "sites": "enwiki", "titles": title, "props": "claims|descriptions"}, api=WIKIDATA)
    ent = next(iter(data.get("entities", {}).values()), {})
    claims = ent.get("claims", {})
    born = None
    if claims.get("P569"):
        t = claims["P569"][0]["mainsnak"].get("datavalue", {}).get("value", {}).get("time", "")
        born = t[1:11] if t else None
    return Person(title=title, born=born, awards=len(claims.get("P166", [])),
                  description=ent.get("descriptions", {}).get("en", {}).get("value", ""))
