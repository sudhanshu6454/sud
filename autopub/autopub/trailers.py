"""Trailers: the studio's own upload, fetched and posted in the site's frame, credited.

Twice a day (settings.trailer_hours, on sites with `trailers: true`) the feature takes this week's
story about a specific trailer, teaser, first look or song from the site's own feeds, finds the
upload on YouTube, and, when it is the studio's or the film's own channel (never a fan's), fetches
it with yt-dlp (adclip) and publishes: an article in the site's house "poster" shape with the
film as a self-hosted video and a link to the original, and the film inside the site's frame as
the reel on Instagram and the video on the Facebook Page, with the credit on the frame and in the
caption. The rights stay with the studio; `repost_ads` in settings is the switch, as for the ad
films, and without it the feature runs with the embed and a narrated reel.

`trailers_used` in site_notes lists every film covered; the upload's URL is the claim.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import replace
from datetime import date
from pathlib import Path

from pydantic import BaseModel, Field

from . import adclip, carousels, extract, sources, youtube
from .config import Settings, Site
from .rewrite import Film, JSON_CONTRACT, CuratedPost, Rewriter, schema_for
from .state import State

log = logging.getLogger(__name__)

NOTE = "trailers"
USED_NOTE = "trailers_used"
CATEGORY = "Trailers"
KICKER = "Trailer"
ATTEMPTS = 3
MIN_SOURCE_WORDS = 120
STORY_WORDS = re.compile(r"\b(trailer|teaser|first look|glimpse|title reveal|song|motion poster)\b", re.I)


class Pick(BaseModel):
    index: int
    film: str = Field(max_length=80)
    studio: str = Field(default="", max_length=80)      # the producer or studio whose channel carries the trailer
    year: int | None = None
    kind: str = Field(default="trailer", max_length=20)  # trailer | teaser | first look | song
    hook: str = Field(max_length=200)                     # one line on why this one


PICK_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["index", "film", "studio", "year", "kind", "hook"],
    "properties": {
        "index": {"type": "integer", "description": "The number of the story you chose, or -1 if none is about a specific trailer, teaser, first look or song that is out now"},
        "film": {"type": "string", "description": "The film or show's title, as released"},
        "studio": {"type": "string", "description": "The production house or studio that released it (the YouTube channel it would be on): Yash Raj Films, Dharma Productions, Hombale Films, Netflix India, Marvel... or an empty string if unsure"},
        "year": {"type": "integer", "description": "The film's release year (this year or next for an upcoming one)"},
        "kind": {"type": "string", "description": "trailer, teaser, first look or song"},
        "hook": {"type": "string", "description": "One sentence, max 180 characters, on what makes this trailer worth watching"},
    },
}

PICK_PROMPT = """You are the trailers editor of {name} ({domain}). Beat: {niche} Audience: {audience}

From the stories below, choose the ONE that is about a specific trailer, teaser, first look, title reveal or song
that has just been released, for a feature where the film plays on the page. Rules:
- A specific film with a specific new video; not a rumour, not a release date alone, not a review.
- Prefer a film people are talking about this week; Indian cinema first, world cinema when it is the bigger story.
- Not any film already covered (list below).
Return -1 if nothing qualifies.

ALREADY COVERED:
{used}
"""

WRITE_PROMPT = """You are the film-obsessed editor of {name} ({domain}): {tagline}. Audience: {audience}. Tone: {tone}.
Write today's trailer feature: the film's new {kind} plays at the top of the page, so do not describe it shot by
shot; write what a fan needs after watching it, in the first person.

Structure: what it is (film, makers, cast, when it releases, as the source gives them); what the {kind} promises and
what it holds back; the one moment everyone will talk about; where this film sits for its star or its studio; the
honest verdict on whether the film looks worth the ticket. 350 to 600 words. Category: {category}.
The share image is a poster set from the hook, so `hook` is 3 to 7 words a fan would say ('{film} looks like the one'),
`image_kicker` is "{kicker}", and `image_headline` names the film.
Never mention that you are an AI. Do not link out; do not mention YouTube or that a video is embedded.
"""


def due(settings: Settings, state: State, site: Site) -> bool:
    if not settings.trailer_hours:
        return False
    log_ = carousels.parse_log(state.note(site.key, NOTE))
    return carousels.due(time.time(), log_, settings.trailer_hours, settings.timezone)


def parse_used(raw: str | None) -> list[str]:
    return [line.strip() for line in (raw or "").splitlines() if line.strip()]


def fleet_used(state: State) -> list[str]:
    seen: list[str] = []
    for value in state.notes(USED_NOTE).values():
        for film in parse_used(value):
            if film.lower() not in (s.lower() for s in seen):
                seen.append(film)
    return seen


def candidates(site: Site, settings: Settings, state: State) -> list[sources.Candidate]:
    """This week's trailer stories from the site's own feeds, not yet used, the ones whose title says so."""
    scout = replace(site, include_keywords=[], max_age_hours=96,
                    google_news_queries=["new trailer released", "teaser out", "first look poster"])
    cands = sources.collect(scout, timeout=settings.request_timeout)
    return [c for c in cands if STORY_WORDS.search(c.title) and not state.is_used(c.url, site.key)][:30]


def pick(rewriter: Rewriter, site: Site, cands: list[sources.Candidate], used: list[str]) -> Pick | None:
    if not cands:
        return None
    listing = "\n".join(f"{i + 1}. {c.title} ({c.source})" for i, c in enumerate(cands))
    system = PICK_PROMPT.format(name=site.name, domain=site.domain, niche=site.niche, audience=site.audience,
                                used="\n".join(f"- {u}" for u in used[-120:]) or "- (none yet)")
    system += JSON_CONTRACT.format(schema=json.dumps(PICK_SCHEMA))
    p = rewriter.ask(system, f"Today is {time.strftime('%d %B %Y')}.\n\nSTORIES:\n{listing}", PICK_SCHEMA,
                     Pick.model_validate, max_tokens=4000)
    if p.index is None or p.index < 1 or p.index > len(cands):
        return None
    p.year = p.year or date.today().year
    return p


def write(rewriter: Rewriter, site: Site, choice: Pick, film: dict, source: extract.Article) -> CuratedPost:
    schema = schema_for(site)
    schema["properties"]["category"] = {"type": "string", "enum": [CATEGORY]}
    system = WRITE_PROMPT.format(name=site.name, domain=site.domain, tagline=site.tagline, audience=site.audience,
                                 tone=site.tone, kind=choice.kind or "trailer", category=CATEGORY, kicker=KICKER, film=choice.film)
    system += JSON_CONTRACT.format(schema=json.dumps(schema))
    brief = (f"FILM: {choice.film}\nSTUDIO: {choice.studio or 'not certain'}\nYEAR: {choice.year or 'not certain'}\n"
             f"WHAT IS OUT: the {choice.kind}\nWHY: {choice.hook}\nUPLOAD: {film['title']} ({film['channel']})\n"
             f"SITE_HASHTAGS (use some in instagram/twitter captions): {' '.join('#' + h for h in site.hashtags)}\n\n"
             f"SOURCE_URL: {source.url}\nSOURCE_NAME: {source.sitename or source.url.split('/')[2]}\n"
             f"SOURCE_TITLE: {source.title}\n\nSOURCE_TEXT:\n{source.text}")
    post = rewriter.ask(system, brief, schema, CuratedPost.model_validate)
    post.category = CATEGORY
    post.image_kicker = KICKER
    post.image_headline = post.image_headline or choice.film
    post.tags = ([t.strip() for t in post.tags if t and t.strip()] + ["Trailers"])[:8]
    post.mood = post.mood or "upbeat"
    caption = f"{choice.film}: the {choice.kind}. Video: {film['channel']} on YouTube."
    from .nostalgia import embed_block
    post.body_html = adclip.slot(embed_block(film["url"], caption)) + post.body_html
    post.body_html += (f'<p><em>Watch the original: <a href="{film["url"]}" rel="nofollow noopener" target="_blank">'
                       f'{film["channel"]} on YouTube</a></em></p>'
                       f'<p><em>Source: <a href="{source.url}" rel="nofollow noopener" target="_blank">'
                       f'{source.sitename or source.url.split("/")[2]}</a></em></p>')
    return post


def fetch_film(site: Site, settings: Settings, film: dict, choice: Pick, work_dir: Path) -> Path | None:
    """The trailer itself, when repost_ads is on and the upload is the studio's or the film's own."""
    if not settings.repost_ads:
        return None
    if not film.get("official"):
        log.info("[%s] %s is not %s's own upload; embed only", site.key, film["url"], choice.studio or choice.film)
        return None
    try:
        return adclip.fetch(film["url"], work_dir / site.slug / "trailers", player_clients=settings.ad_clip_player_clients,
                            cookies=settings.ad_clip_cookies or None)
    except Exception as exc:  # noqa: BLE001
        log.warning("[%s] could not fetch the trailer (%s); embed and narrated reel instead", site.key, exc)
        return None


def publish_daily(site: Site, settings: Settings, state: State, rewriter: Rewriter, wp, publishers, work_dir: Path,
                  report) -> bool:
    """Pick the week's trailer story, find and fetch the studio's upload, write, publish."""
    from . import pipeline   # local: pipeline imports this module

    used = parse_used(state.note(site.key, USED_NOTE))
    slot_log = carousels.parse_log(state.note(site.key, NOTE))
    tried = fleet_used(state)
    cands = candidates(site, settings, state)
    if not cands:
        log.info("[%s] no trailer stories this week", site.key)
        return False
    found = None
    for _ in range(ATTEMPTS):
        choice = pick(rewriter, site, cands, tried)
        if choice is None:
            log.info("[%s] the model found no story about a specific trailer", site.key)
            break
        cand = cands[choice.index - 1]
        cands = [c for c in cands if c is not cand]
        if any(choice.film.lower() == u.lower() for u in used + tried):
            tried.append(choice.film)
            continue
        try:
            article = extract.extract(cand.url, timeout=settings.request_timeout)
        except Exception as exc:  # noqa: BLE001
            log.info("[%s] could not read %s: %s", site.key, cand.url, exc)
            tried.append(f"{choice.film} (source unreadable)")
            continue
        if article.word_count < MIN_SOURCE_WORDS:
            tried.append(f"{choice.film} (source too thin)")
            continue
        film = youtube.find_trailer(choice.film, choice.studio, choice.year, timeout=settings.request_timeout)
        if film is None:
            log.info("[%s] no upload found for %r; trying another story", site.key, choice.film)
            tried.append(f"{choice.film} (no upload found)")
            continue
        if not state.claim(film["url"], site.key, f"Trailer: {choice.film}"):
            tried.append(choice.film)
            continue
        state.claim(cand.url, site.key, cand.title)     # the news must not run the same story again
        article.title = article.title or cand.title
        article.sitename = article.sitename or cand.source
        found = (choice, film, article)
        break
    if found is None:
        log.warning("[%s] no trailer this slot: nothing usable", site.key)
        return False
    choice, film, article = found
    log.info("[%s] trailer: %s (%s) -> %s [%s]", site.key, choice.film, choice.studio or "studio?", film["url"],
             "official" if film.get("official") else "not the studio")
    try:
        post = write(rewriter, site, choice, film, article)
    except Exception as exc:  # noqa: BLE001
        state.release(film["url"], site.key)
        state.release(article.url, site.key)
        raise RuntimeError(f"trailer feature could not be written: {exc}") from exc
    if post.film is None:
        post.film = Film(title=choice.film, year=choice.year)     # the poster's still is a frame from the film, not the thumbnail
    clip = fetch_film(site, settings, film, choice, work_dir)
    credit = f"{choice.film} ({choice.year}): the {choice.kind}. Video: {film['channel']} on YouTube. Shown for review."
    try:
        ok = pipeline.publish_post(site, settings, state, film["url"], post, wp, publishers, work_dir, report,
                                   image_url=film["thumbnail"], credit=f"{film['channel']} on YouTube",
                                   use_source_image=True, force_reel=True, force_story=True,
                                   ad_clip=clip, ad_caption=credit if clip else None)
    finally:
        if clip is not None:
            clip.unlink(missing_ok=True)
    if ok:
        state.set_note(site.key, USED_NOTE, "\n".join((used + [choice.film])[-500:]))
        state.set_note(site.key, NOTE, carousels.dump_log(slot_log + [time.time()]))
        log.info("[%s] trailer published for the %s slot", site.key,
                 carousels.slot(time.time(), settings.trailer_hours, settings.timezone))
    return ok
