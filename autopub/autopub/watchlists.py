"""Watchlists: a theme, eight films, one honest line each. The curated list the reference account lives on.

"Films to watch in your 20s", "Horror on Netflix", "Good movies to watch with your parents": a
theme the model picks from the house list (rotating, never one the fleet has run), eight films
or shows it genuinely stands behind, each with its year, language and one line on why, written
as an article and posted as a poster carousel: the cover, one slide per film (on the film's own
poster when TMDB is configured, on the ink ground otherwise), the closing slide.

`watchlists_used` in site_notes lists every theme run, and the theme's slug is the claim, so a
theme is never repeated. Slots: settings.watchlist_hours on sites with `watchlists: true`.
"""
from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path

from pydantic import BaseModel, Field
from slugify import slugify

from . import carousels, tmdb
from .config import Settings, Site
from .rewrite import CuratedPost, JSON_CONTRACT, Rewriter, schema_for
from .state import State

log = logging.getLogger(__name__)

NOTE = "watchlists"             # site_notes key: when this site's last watchlists went out
USED_NOTE = "watchlists_used"   # site_notes key: themes covered
CATEGORY = "Watchlists"
KICKER = "Watchlist"
MIN_FILMS, MAX_FILMS = 6, 8
ATTEMPTS = 3

# Seeds the model chooses among, in the reference account's register: a mood, a constraint, a
# platform, a life stage, a craft. The model may also propose its own in the same spirit.
THEMES = [
    "Films to watch in your 20s", "Films to watch in your 30s", "Good films to watch with your parents",
    "Hindi films that get better on a second watch", "The best Malayalam films of the last decade",
    "Tamil thrillers that never let go", "Telugu films that travelled beyond Telugu", "Horror on OTT that is actually scary",
    "Comedies to watch when the week has been long", "Romances that do not end how you expect",
    "Films under two hours that say everything", "Courtroom dramas worth the verdict", "Heist films with a real plan",
    "Coming-of-age films from India", "Films about Mumbai", "Films about Delhi", "Films about small-town India",
    "Debut films that announced a director", "Films where the music is the lead", "Sports films that earn the last reel",
    "Biopics that do not flatter", "Films to watch alone on a Sunday", "Films to watch before the sequel arrives",
    "Slow cinema for people who think they hate slow cinema", "Black-and-white films that feel new",
    "Animated films that are not for children only", "Films about food", "Films about journalism",
    "Whodunits that play fair", "Films with a perfect first ten minutes", "Ensemble films where everyone gets a moment",
    "Underrated performances by big stars", "Films that were flops and deserved better", "The best film scores from India",
    "War films that are about people", "Films about families at a wedding", "Films to watch when you cannot sleep",
    "Bollywood films of the 90s that hold up", "South Indian films every Hindi viewer should start with",
    "Hollywood films every Bollywood fan should see",
]


class Entry(BaseModel):
    title: str = Field(max_length=80)
    year: int | None = None
    language: str = Field(default="", max_length=30)         # Hindi, Tamil, English...
    where: str = Field(default="", max_length=40)            # the platform, when the model is sure; else empty
    why: str = Field(max_length=220)                          # one line, first person, no spoilers


class Watchlist(BaseModel):
    theme: str = Field(max_length=90)
    subline: str = Field(max_length=90)                       # the small line under the theme on the cover
    intro: str = Field(max_length=500)
    entries: list[Entry]


PICK_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["theme", "subline", "intro", "entries"],
    "properties": {
        "theme": {"type": "string", "description": "The list's title, 3 to 8 words, as a fan would say it, e.g. 'Films to watch in your 20s'. Title case is not needed; it is set in capitals."},
        "subline": {"type": "string", "description": "A small line under the title, max 70 characters, e.g. 'coming of age cinema' or 'no sex scenes, promise'"},
        "intro": {"type": "string", "description": "Two or three sentences introducing the list in the first person, max 400 characters."},
        "entries": {"type": "array", "minItems": 6, "maxItems": 8, "items": {
            "type": "object", "additionalProperties": False, "required": ["title", "year", "language", "where", "why"],
            "properties": {
                "title": {"type": "string", "description": "The film or show's title as released"},
                "year": {"type": "integer", "description": "Release year"},
                "language": {"type": "string", "description": "Original language: Hindi, Tamil, Telugu, Malayalam, Kannada, Marathi, Bengali, English, Korean..."},
                "where": {"type": "string", "description": "The streaming platform in India if you are certain (Netflix, Prime Video, JioHotstar, Zee5, SonyLIV, Apple TV+), else an empty string"},
                "why": {"type": "string", "description": "One line, max 200 characters, first person, why this one belongs, no spoilers, no superlatives stacked"},
            }}},
    },
}

PICK_PROMPT = """You are the film-obsessed editor of {name} ({domain}): {tagline}. Audience: {audience}. Tone: {tone}.
Make ONE curated watchlist for Instagram and the site: a theme and {n_min} to {n_max} films or shows you genuinely stand behind.
The theme may be one of the house seeds below or your own in the same spirit (a mood, a constraint, a life stage, a
platform, a craft), and it must not be any of the themes already covered.

Rules:
- Real films and shows only, with the right year and original language. Mix Indian cinema (Hindi and at least one
  southern language) with world cinema unless the theme is explicitly about one; lean Indian.
- Nothing released in the last three months; nothing you are unsure exists.
- Every 'why' is one honest first-person line a friend would say, no spoilers, no hype.
- Order the list for reading, not ranking: open strong, close with the one people will save.

HOUSE SEEDS:
{seeds}

ALREADY COVERED (never repeat, nor a near-duplicate):
{used}
"""

WRITE_PROMPT = """You are the film-obsessed editor of {name} ({domain}): {tagline}. Audience: {audience}. Tone: {tone}.
Write the article for this watchlist for the site, in the first person, for a reader who loves the movies.

Structure: an opening of two short paragraphs on why this list and who it is for; then one section per film in the
given order, each headed with the title and year, with three to five sentences: what it is, why it belongs on THIS
list, and how it feels to watch, with no spoilers; then a closing paragraph inviting the reader's own picks.
Title: the theme as given (you may sharpen the wording slightly). Category: {category}.
The share image is set from the theme, so `hook` is the theme itself and `image_kicker` is "{kicker}".
`carousel_slides`: exactly one slide per film in order, heading "Title (Year)" and body the 'why' line expanded to two sentences.
Never mention that you are an AI. Do not link out.
"""


def due(settings: Settings, state: State, site: Site) -> bool:
    if not settings.watchlist_hours:
        return False
    log_ = carousels.parse_log(state.note(site.key, NOTE))
    return carousels.due(time.time(), log_, settings.watchlist_hours, settings.timezone)


def parse_used(raw: str | None) -> list[str]:
    return [line.strip() for line in (raw or "").splitlines() if line.strip()]


def fleet_used(state: State) -> list[str]:
    seen: list[str] = []
    for value in state.notes(USED_NOTE).values():
        for theme in parse_used(value):
            if theme.lower() not in (s.lower() for s in seen):
                seen.append(theme)
    return seen


def _same(a: str, b: str) -> bool:
    return slugify(a) == slugify(b)


def pick(rewriter: Rewriter, site: Site, used: list[str], seeds: list[str] | None = None) -> Watchlist:
    """The model chooses a theme and fills the list."""
    seeds = [t for t in (seeds or THEMES) if not any(_same(t, u) for u in used)]
    system = PICK_PROMPT.format(name=site.name, domain=site.domain, tagline=site.tagline, audience=site.audience,
                                tone=site.tone, n_min=MIN_FILMS, n_max=MAX_FILMS,
                                seeds="\n".join(f"- {t}" for t in seeds[:24]) or "- (your own)",
                                used="\n".join(f"- {u}" for u in used[-120:]) or "- (none yet)")
    system += JSON_CONTRACT.format(schema=json.dumps(PICK_SCHEMA))
    return rewriter.ask(system, "Make today's watchlist.", PICK_SCHEMA, Watchlist.model_validate, max_tokens=4000)


def _validate(wl: Watchlist) -> Watchlist:
    seen: set[str] = set()
    entries = []
    for e in wl.entries:
        key = slugify(f"{e.title}-{e.year or ''}")
        if key in seen or not e.title.strip():
            continue
        seen.add(key)
        entries.append(e)
    if len(entries) < MIN_FILMS:
        raise ValueError(f"only {len(entries)} distinct films; need {MIN_FILMS}")
    wl.entries = entries[:MAX_FILMS]
    return wl


def stills(wl: Watchlist, timeout: int = 15) -> tuple[dict[int, str], str | None, int]:
    """TMDB posters for the slides (1-based index -> URL), a backdrop for the cover, and how many were found."""
    photos: dict[int, str] = {}
    cover: str | None = None
    for i, e in enumerate(wl.entries, 1):
        hit = tmdb.find(e.title, e.year, timeout)
        if not hit:
            continue
        if hit.get("poster"):
            photos[i] = hit["poster"]
        if cover is None and hit.get("backdrop"):
            cover = hit["backdrop"]
    return photos, cover, len(photos)


def entries_html(wl: Watchlist) -> str:
    """The list as a table the article carries above the prose, so the reader can screenshot it."""
    from html import escape
    rows = "".join(
        f"<tr><td>{i}</td><td><strong>{escape(e.title)}</strong>{f' ({e.year})' if e.year else ''}</td><td>{escape(e.language)}</td><td>{escape(e.where) or '—'}</td></tr>"
        for i, e in enumerate(wl.entries, 1))
    return (f'<figure class="wp-block-table"><table><thead><tr><th>#</th><th>Film</th><th>Language</th><th>Where to watch</th></tr></thead>'
            f"<tbody>{rows}</tbody></table><figcaption class=\"wp-element-caption\">{escape(wl.theme)}: the list</figcaption></figure>\n")


def write(rewriter: Rewriter, site: Site, wl: Watchlist, used_tmdb: bool = False) -> CuratedPost:
    schema = schema_for(site, carousel=True)     # the slides are part of the ask: one per film
    schema["properties"]["category"] = {"type": "string", "enum": [CATEGORY]}
    system = WRITE_PROMPT.format(name=site.name, domain=site.domain, tagline=site.tagline, audience=site.audience,
                                 tone=site.tone, category=CATEGORY, kicker=KICKER)
    system += JSON_CONTRACT.format(schema=json.dumps(schema))
    brief = (f"THEME: {wl.theme}\nSUBLINE: {wl.subline}\nINTRO: {wl.intro}\n\nFILMS:\n"
             + "\n".join(f"{i}. {e.title} ({e.year or 'year?'}, {e.language}{', on ' + e.where if e.where else ''}): {e.why}"
                         for i, e in enumerate(wl.entries, 1))
             + f"\n\nSITE_HASHTAGS (use some in instagram/twitter captions): {' '.join('#' + h for h in site.hashtags)}")
    post = rewriter.ask(system, brief, schema, CuratedPost.model_validate, max_tokens=16000)
    post.category = CATEGORY
    post.image_kicker = KICKER
    post.hook = wl.theme
    post.image_headline = wl.theme
    post.excerpt = post.excerpt or wl.intro[:200]
    post.tags = ([t.strip() for t in post.tags if t and t.strip()] + ["Watchlist"])[:8]
    post.mood = post.mood or "upbeat"
    # the model's slides must be one per film, in order; rebuild them from the list when they are not
    def body(e: Entry) -> str:      # a slide needs a body of a few lines; a terse 'why' gets the film's facts after it
        why = e.why.strip().rstrip(".") + "."
        facts = ", ".join(p for p in (e.language, f"on {e.where}" if e.where else "") if p)
        return why if len(why) >= 60 or not facts else f"{why} {facts[0].upper() + facts[1:]}."
    slides = [carousels.CarouselSlide(heading=f"{e.title} ({e.year})" if e.year else e.title, body=body(e)) for e in wl.entries]
    if len(post.carousel_slides) != len(wl.entries):
        post.carousel_slides = slides
    post.body_html = entries_html(wl) + post.body_html
    if used_tmdb:
        post.body_html += f"<p><em>{tmdb.CREDIT}</em></p>"
    return post


def publish_daily(site: Site, settings: Settings, state: State, rewriter: Rewriter, wp, publishers, work_dir: Path,
                  report, theme: str | None = None) -> bool:
    """Pick, claim, look up stills, write, publish as an article and a poster carousel."""
    from . import pipeline   # local: pipeline imports this module

    used = parse_used(state.note(site.key, USED_NOTE))
    slot_log = carousels.parse_log(state.note(site.key, NOTE))
    tried = fleet_used(state)
    wl = url = None
    for _ in range(ATTEMPTS):
        candidate = pick(rewriter, site, tried, seeds=[theme] if theme else None)
        try:
            candidate = _validate(candidate)
        except ValueError as exc:
            log.info("[%s] watchlist %r unusable: %s", site.key, candidate.theme, exc)
            tried.append(candidate.theme)
            continue
        if any(_same(candidate.theme, u) for u in used + tried):
            tried.append(candidate.theme)
            continue
        url = f"https://{site.domain}/watchlist/{slugify(candidate.theme)}"
        if not state.claim(url, site.key, f"Watchlist: {candidate.theme}"):
            tried.append(candidate.theme)
            continue
        wl = candidate
        break
    if wl is None:
        log.warning("[%s] no watchlist this slot: nothing usable", site.key)
        return False
    photos, cover, found = stills(wl, settings.request_timeout)
    log.info("[%s] watchlist: %s (%d films, %d stills)", site.key, wl.theme, len(wl.entries), found)
    try:
        post = write(rewriter, site, wl, used_tmdb=found > 0)
    except Exception as exc:  # noqa: BLE001
        state.release(url, site.key)
        raise RuntimeError(f"watchlist could not be written: {exc}") from exc
    if found:
        post.captions.instagram = (post.captions.instagram + "\n\nFilm images: TMDB").strip()
    ok = pipeline.publish_post(site, settings, state, url, post, wp, publishers, work_dir, report,
                               image_url=cover, credit="TMDB" if cover else None, use_source_image=cover is not None,
                               want_carousel=True, force_story=True, slide_photos=photos)
    if ok:
        state.set_note(site.key, USED_NOTE, "\n".join((used + [wl.theme])[-500:]))
        state.set_note(site.key, NOTE, carousels.dump_log(slot_log + [time.time()]))
        log.info("[%s] watchlist published for the %s slot", site.key,
                 carousels.slot(time.time(), settings.watchlist_hours, settings.timezone))
    return ok
