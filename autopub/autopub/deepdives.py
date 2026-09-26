"""Deep dives: trivia and breakdowns on one film, the facts from its Wikipedia page, the frames from TMDB.

Three times a day (settings.deepdive_hours, on sites with `deepdives: true`) the feature takes one film: a
film turning a round number of years this week (TMDB), one trending this week, or one in this week's
news. It reads the film's English Wikipedia page by section (production, casting, filming, music,
release, reception, legacy) and writes in one of two shapes:

- "Did you know": six to nine pieces of trivia, each a slide with a frame from the film, and the article
  with each fact expanded; the reference account's trivia carousel.
- "The breakdown": how the film (or its defining scene) was made, as a story in six to nine beats.

Every fact must come from the page text (the writer is told so, and the article credits Wikipedia under
CC BY-SA). The film's slug is the claim; `deepdives_used` lists every film and kind run.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from pydantic import BaseModel, Field
from slugify import slugify

from . import carousels, poster, sources, tmdb, wiki
from .config import Settings, Site
from .rewrite import Film, JSON_CONTRACT, CuratedPost, Rewriter, schema_for
from .state import State

log = logging.getLogger(__name__)

NOTE = "deepdives"
USED_NOTE = "deepdives_used"
CATEGORY = "Trivia"
KINDS = {"trivia": "Did you know", "breakdown": "The breakdown"}
MIN_SLIDES, MAX_SLIDES = 6, 9
ATTEMPTS = 3
MIN_PAGE_CHARS = 1500
WIKI_CREDIT = ('<p><em>Facts from <a href="{url}" rel="nofollow noopener" target="_blank">Wikipedia: {title}</a>, '
               'available under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="nofollow noopener" target="_blank">CC BY-SA 4.0</a>.</em></p>')


class Pick(BaseModel):
    film: str = Field(max_length=80)
    year: int | None = None
    kind: str = Field(default="trivia", max_length=20)   # trivia | breakdown
    angle: str = Field(max_length=160)                   # what the piece is about, in one line
    why: str = Field(max_length=200)                     # why now


PICK_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["film", "year", "kind", "angle", "why"],
    "properties": {
        "film": {"type": "string", "description": "The film's title as released, or an empty string if nothing fits"},
        "year": {"type": "integer", "description": "Its release year"},
        "kind": {"type": "string", "enum": ["trivia", "breakdown"], "description": "trivia: 'Did you know' facts about the film; breakdown: how it (or its defining scene) was made"},
        "angle": {"type": "string", "description": "The piece in one line, max 140 characters, e.g. '8 things you did not know about Lagaan' or 'How the Kaminey climax was shot in one night'"},
        "why": {"type": "string", "description": "Why this film now, max 180 characters: an anniversary, a trend, the news"},
    },
}

PICK_PROMPT = """You are the features editor of {name} ({domain}): {tagline}. Audience: {audience}. Tone: {tone}.
Choose ONE film for today's deep dive and its shape. Prefer, in this order: a film with an anniversary this week; a film
trending this week; a film in this week's news; then any film a fan would love to know more about. Indian cinema first,
world cinema when it is the bigger story. Choose a film whose making is well documented (a page with production,
casting, filming, music and reception sections), because every fact must come from that page.
Never a film already covered (list below).

ANNIVERSARIES THIS WEEK:
{anniversaries}

TRENDING THIS WEEK:
{trending}

IN THIS WEEK'S NEWS:
{news}

ALREADY COVERED:
{used}
"""

WRITE_PROMPT = """You are the film-obsessed editor of {name} ({domain}): {tagline}. Audience: {audience}. Tone: {tone}.
Write today's {label} on {film} ({year}): {angle}

EVERY FACT MUST COME FROM THE SOURCE TEXT BELOW. Do not add anything you remember about the film that the text does not
say; do not invent numbers, names, dates or quotes; when the text is silent, leave it out. Attribute figures as the text
gives them.

Shape ({kind}):
- trivia: `carousel_slides` are {n_min} to {n_max} facts, each heading a hook of at most 60 characters ("The song was
  written in a night") and each body two or three sentences from the source; open with the most surprising fact and
  close with the one people will save.
- breakdown: `carousel_slides` are {n_min} to {n_max} beats of the making, in order, each heading a step and each body
  two or three sentences from the source.
The article: an opening on why this film and why now, then one short section per slide in the same order, expanded from
the source, then a closing line inviting the reader's own favourite fact. 450 to 800 words. Category: {category}.
The share image is a poster: `hook` is 3 to 7 words a fan would say ("{film} turns {turns}", "You never noticed this"),
`image_kicker` is "{label}", `image_headline` names the film, and `film` is the film with its year.
Never mention that you are an AI. Do not link out.
"""


def due(settings: Settings, state: State, site: Site) -> bool:
    if not settings.deepdive_hours:
        return False
    log_ = carousels.parse_log(state.note(site.key, NOTE))
    return carousels.due(time.time(), log_, settings.deepdive_hours, settings.timezone)


def parse_used(raw: str | None) -> list[str]:
    return [line.strip() for line in (raw or "").splitlines() if line.strip()]


def fleet_used(state: State) -> list[str]:
    seen: list[str] = []
    for value in state.notes(USED_NOTE).values():
        for item in parse_used(value):
            if item.lower() not in (s.lower() for s in seen):
                seen.append(item)
    return seen


def subjects(site: Site, settings: Settings) -> tuple[list[str], list[str], list[str]]:
    """Anniversaries this week, what is trending, and what the news is about, as lines for the editor."""
    anniv, trending, news = [], [], []
    try:
        anniv = [f"{a['title']} ({a['year']}, {a['language']}) turns {a['turns']}" for a in tmdb.anniversaries(timeout=settings.request_timeout)]
    except Exception as exc:  # noqa: BLE001
        log.debug("tmdb anniversaries failed: %s", exc)
    try:
        trending = [f"{t['title']} ({t['year'] or '?'}, {t['language']})" for t in tmdb.trending("movie", timeout=settings.request_timeout)]
    except Exception as exc:  # noqa: BLE001
        log.debug("tmdb trending failed: %s", exc)
    try:
        news = [c.title for c in sources.collect(site, timeout=settings.request_timeout)[:30]]
    except Exception as exc:  # noqa: BLE001
        log.debug("news candidates failed: %s", exc)
    return anniv, trending, news


def pick(rewriter: Rewriter, site: Site, anniv: list[str], trending: list[str], news: list[str], used: list[str]) -> Pick | None:
    system = PICK_PROMPT.format(name=site.name, domain=site.domain, tagline=site.tagline, audience=site.audience, tone=site.tone,
                                anniversaries="\n".join(f"- {a}" for a in anniv) or "- (unknown)",
                                trending="\n".join(f"- {t}" for t in trending) or "- (unknown)",
                                news="\n".join(f"- {n}" for n in news) or "- (none)",
                                used="\n".join(f"- {u}" for u in used[-150:]) or "- (none yet)")
    system += JSON_CONTRACT.format(schema=json.dumps(PICK_SCHEMA))
    p = rewriter.ask(system, f"Today is {time.strftime('%d %B %Y')}. Choose the film and the shape.", PICK_SCHEMA, Pick.model_validate, max_tokens=4000)
    if not p.film.strip():
        return None
    p.kind = p.kind if p.kind in KINDS else "trivia"
    return p


def write(rewriter: Rewriter, site: Site, choice: Pick, page: wiki.FilmPage, turns: int | None) -> CuratedPost:
    schema = schema_for(site, carousel=True)
    schema["properties"]["category"] = {"type": "string", "enum": [CATEGORY]}
    label = KINDS[choice.kind]
    system = WRITE_PROMPT.format(name=site.name, domain=site.domain, tagline=site.tagline, audience=site.audience, tone=site.tone,
                                 label=label, film=choice.film, year=choice.year or "?", angle=choice.angle, kind=choice.kind,
                                 n_min=MIN_SLIDES, n_max=MAX_SLIDES, category=CATEGORY, turns=turns or "N")
    system += JSON_CONTRACT.format(schema=json.dumps(schema))
    brief = (f"FILM: {choice.film} ({choice.year or '?'})\nWHY NOW: {choice.why}\n"
             f"SITE_HASHTAGS (use some in instagram/twitter captions): {' '.join('#' + h for h in site.hashtags)}\n\n"
             f"SOURCE: {page.url}\n\nSOURCE_TEXT:\n{page.text[:14000]}")
    post = rewriter.ask(system, brief, schema, CuratedPost.model_validate, max_tokens=16000)
    post.category = CATEGORY
    post.image_kicker = label
    post.image_headline = post.image_headline or choice.film
    post.tags = ([t.strip() for t in post.tags if t and t.strip()] + [choice.film, label])[:8]
    post.mood = post.mood or "nostalgic"
    if post.film is None:
        post.film = Film(title=choice.film, year=choice.year)
    slides = carousels.usable(post.carousel_slides)
    if len(slides) < MIN_SLIDES:
        raise ValueError(f"only {len(slides)} usable slides; need {MIN_SLIDES}")
    post.body_html += WIKI_CREDIT.format(url=page.url, title=page.title)
    post.body_html += f"<p><em>{tmdb.CREDIT}</em></p>"
    return post


def frames_for(choice: Pick, n: int, timeout: int = 15) -> tuple[dict[int, str], str | None, str | None]:
    """A different frame from the film for each slide (1-based), the cover's frame, and the credit line."""
    hit = tmdb.film_still(choice.film, choice.year, timeout)
    if not hit:
        return {}, None, None
    frames = hit.get("frames") or [hit["url"]]
    cover = poster.pick_frame(frames, timeout) or hit["url"]
    rest = [f for f in frames if f != cover] or [cover]
    return {i: rest[(i - 1) % len(rest)] for i in range(1, n + 1)}, cover, hit["credit"]


def publish_daily(site: Site, settings: Settings, state: State, rewriter: Rewriter, wp, publishers, work_dir: Path,
                  report) -> bool:
    """Pick the film and the shape, read its page, write, publish as an article and a poster carousel."""
    from . import pipeline   # local: pipeline imports this module

    used = parse_used(state.note(site.key, USED_NOTE))
    slot_log = carousels.parse_log(state.note(site.key, NOTE))
    tried = fleet_used(state)
    anniv, trending, news = subjects(site, settings)
    found = None
    for _ in range(ATTEMPTS):
        choice = pick(rewriter, site, anniv, trending, news, tried)
        if choice is None:
            log.info("[%s] the model offered no film", site.key)
            break
        label = f"{choice.film} ({choice.year or '?'}): {KINDS[choice.kind]}"
        if any(choice.film.lower() in u.lower() for u in used + tried):
            tried.append(label)
            continue
        page = wiki.film_page(choice.film, choice.year)
        if page is None or len(page.text) < MIN_PAGE_CHARS:
            log.info("[%s] no usable page for %r; trying another", site.key, choice.film)
            tried.append(f"{label} (no page)")
            continue
        url = f"https://{site.domain}/{choice.kind}/{slugify(choice.film + '-' + str(choice.year or ''))}"
        if not state.claim(url, site.key, f"Deep dive: {label}"):
            tried.append(label)
            continue
        found = (choice, page, url)
        break
    if found is None:
        log.warning("[%s] no deep dive this slot: nothing usable", site.key)
        return False
    choice, page, url = found
    turns = next((int(a.split("turns ")[-1]) for a in anniv if a.lower().startswith(choice.film.lower())), None)
    log.info("[%s] deep dive: %s (%s) %s, page %d chars", site.key, choice.film, choice.year, choice.kind, len(page.text))
    try:
        post = write(rewriter, site, choice, page, turns)
    except Exception as exc:  # noqa: BLE001
        state.release(url, site.key)
        raise RuntimeError(f"deep dive could not be written: {exc}") from exc
    photos, cover, credit = frames_for(choice, len(post.carousel_slides), settings.request_timeout)
    if cover:
        post.captions.instagram = (post.captions.instagram + "\n\nFilm images: TMDB. Facts: Wikipedia (CC BY-SA)").strip()
    ok = pipeline.publish_post(site, settings, state, url, post, wp, publishers, work_dir, report,
                               image_url=cover, credit=credit, use_source_image=cover is not None,
                               want_carousel=True, force_story=True, slide_photos=photos)
    if ok:
        state.set_note(site.key, USED_NOTE, "\n".join((used + [f"{choice.film} ({choice.year or '?'}): {KINDS[choice.kind]}"])[-500:]))
        state.set_note(site.key, NOTE, carousels.dump_log(slot_log + [time.time()]))
        log.info("[%s] deep dive published for the %s slot", site.key, carousels.slot(time.time(), settings.deepdive_hours, settings.timezone))
    return ok
