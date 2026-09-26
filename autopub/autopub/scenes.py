"""Scenes: an iconic or viral scene, song or monologue, the rights holder's own upload, in the frame, credited.

Twice a day (settings.scene_hours, on sites with `scenes: true`) the feature picks a scene people quote,
share or argue about: from a film trending this week, one in this week's news, or a classic the editor
reaches for. It finds the clip on YouTube and takes it only from the rights holder's own channel (the
studio, the streamer, the label or the film's own channel; never a fan's or a reaction channel's),
fetches it with yt-dlp (adclip) and publishes: an article on why the scene works, with the clip as a
self-hosted video and a link to the original; and the clip inside the site's frame as the reel on
Instagram and the video on the Facebook Page, credited on the frame and in the caption. `repost_ads`
is the switch, as for trailers; without it the scene runs as an embed with a narrated reel.

`scenes_used` in site_notes lists every scene covered (film: scene); the upload's URL is the claim.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import date
from pathlib import Path

from pydantic import BaseModel, Field

from . import adclip, carousels, sources, tmdb, youtube
from .config import Settings, Site
from .rewrite import Film, JSON_CONTRACT, CuratedPost, Rewriter, schema_for
from .state import State

log = logging.getLogger(__name__)

NOTE = "scenes"
USED_NOTE = "scenes_used"
CATEGORY = "Scenes"
KICKER = "The scene"
ATTEMPTS = 3


class Pick(BaseModel):
    film: str = Field(max_length=80)
    year: int | None = None
    studio: str = Field(default="", max_length=80)      # whose channel the clip would be on
    scene: str = Field(max_length=140)                  # what happens, in one line, no spoilers beyond the moment itself
    kind: str = Field(default="scene", max_length=20)   # scene | song | monologue | climax
    query: str = Field(max_length=120)                  # the YouTube search that finds it
    hook: str = Field(max_length=200)                   # why people still talk about it


PICK_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["film", "year", "studio", "scene", "kind", "query", "hook"],
    "properties": {
        "film": {"type": "string", "description": "The film or show's title, as released, or an empty string if you have nothing"},
        "year": {"type": "integer", "description": "Its release year"},
        "studio": {"type": "string", "description": "The rights holder whose YouTube channel carries clips of it: the studio (Yash Raj Films, Dharma, Hombale...), the streamer (Netflix India, Prime Video India), the label for a song (T-Series, Zee Music, Sony Music India, Saregama), a catalogue channel (Shemaroo, Ultra, Rajshri, Goldmines) or the film's own channel; empty if unsure"},
        "scene": {"type": "string", "description": "The scene in one line, max 120 characters: who, where, what happens"},
        "kind": {"type": "string", "description": "scene, song, monologue or climax"},
        "query": {"type": "string", "description": "The YouTube search that finds the clip, e.g. 'Gangs of Wasseypur Ramadhir Singh cinema dialogue scene'"},
        "hook": {"type": "string", "description": "One sentence, max 180 characters, on why this scene is the one"},
    },
}

PICK_PROMPT = """You are the scenes editor of {name} ({domain}): {tagline}. Audience: {audience}. Tone: {tone}.
Choose ONE scene, song, monologue or climax that people quote, share or argue about, for a feature where the clip plays on
the page and goes out as a reel. Prefer, in this order: a scene from a film trending this week; a scene from a film in this
week's news; a classic scene everyone knows (any era, any language the site covers). Indian cinema first, world cinema when
the scene is the bigger one.
Rules:
- The clip must exist on the rights holder's own channel (studio, streamer, label, catalogue channel or the film's own),
  because that is the only kind the feature may use. Song videos on a label's channel count.
- Not any scene already covered (list below), and not a film covered in the last month.
- Give a search query that a person would type to find that exact clip.

TRENDING THIS WEEK:
{trending}

IN THIS WEEK'S NEWS:
{news}

ALREADY COVERED:
{used}
"""

WRITE_PROMPT = """You are the film-obsessed editor of {name} ({domain}): {tagline}. Audience: {audience}. Tone: {tone}.
Write today's scene feature. The clip plays at the top of the page, so do not narrate it shot by shot; write what a fan
wants after watching it, in the first person.

Structure: the setup in two sentences (where the scene sits in the film, no spoilers beyond it); why it works, as craft
(the writing, the performance, the staging, the cut, the music, whichever carries it); the line or beat people quote;
what it did for the film or the star; one honest note on what a first-time viewer should watch for. 300 to 550 words.
Category: {category}.
The share image is a poster set from the hook, so `hook` is 3 to 7 words a fan would say, `image_kicker` is "{kicker}",
`image_headline` names the film, and `film` is the film with its year.
Never mention that you are an AI. Do not link out; do not mention YouTube or that a video is embedded.
"""


def due(settings: Settings, state: State, site: Site) -> bool:
    if not settings.scene_hours:
        return False
    log_ = carousels.parse_log(state.note(site.key, NOTE))
    return carousels.due(time.time(), log_, settings.scene_hours, settings.timezone)


def parse_used(raw: str | None) -> list[str]:
    return [line.strip() for line in (raw or "").splitlines() if line.strip()]


def fleet_used(state: State) -> list[str]:
    seen: list[str] = []
    for value in state.notes(USED_NOTE).values():
        for item in parse_used(value):
            if item.lower() not in (s.lower() for s in seen):
                seen.append(item)
    return seen


def subjects(site: Site, settings: Settings, state: State) -> tuple[list[str], list[str]]:
    """What is trending on TMDB this week and what this week's news is about, as lines for the editor."""
    trending = []
    try:
        trending = [f"{t['title']} ({t['year'] or '?'}, {t['language']})" for t in tmdb.trending("movie", timeout=settings.request_timeout)]
        trending += [f"{t['title']} ({t['year'] or '?'}, {t['language']}, series)" for t in tmdb.trending("tv", timeout=settings.request_timeout)[:5]]
    except Exception as exc:  # noqa: BLE001
        log.debug("tmdb trending failed: %s", exc)
    news = []
    try:
        news = [c.title for c in sources.collect(site, timeout=settings.request_timeout)[:40]]
    except Exception as exc:  # noqa: BLE001
        log.debug("news candidates failed: %s", exc)
    return trending, news


def pick(rewriter: Rewriter, site: Site, trending: list[str], news: list[str], used: list[str]) -> Pick | None:
    system = PICK_PROMPT.format(name=site.name, domain=site.domain, tagline=site.tagline, audience=site.audience, tone=site.tone,
                                trending="\n".join(f"- {t}" for t in trending) or "- (unknown)",
                                news="\n".join(f"- {n}" for n in news[:30]) or "- (none)",
                                used="\n".join(f"- {u}" for u in used[-150:]) or "- (none yet)")
    system += JSON_CONTRACT.format(schema=json.dumps(PICK_SCHEMA))
    p = rewriter.ask(system, f"Today is {time.strftime('%d %B %Y')}. Choose the scene.", PICK_SCHEMA, Pick.model_validate, max_tokens=4000)
    if not p.film.strip() or not p.query.strip():
        return None
    p.year = p.year or date.today().year
    return p


def write(rewriter: Rewriter, site: Site, choice: Pick, clip: dict) -> CuratedPost:
    schema = schema_for(site)
    schema["properties"]["category"] = {"type": "string", "enum": [CATEGORY]}
    system = WRITE_PROMPT.format(name=site.name, domain=site.domain, tagline=site.tagline, audience=site.audience,
                                 tone=site.tone, category=CATEGORY, kicker=KICKER)
    system += JSON_CONTRACT.format(schema=json.dumps(schema))
    brief = (f"FILM: {choice.film} ({choice.year})\nSTUDIO / RIGHTS HOLDER: {choice.studio or 'not certain'}\n"
             f"THE {choice.kind.upper()}: {choice.scene}\nWHY: {choice.hook}\nUPLOAD: {clip['title']} ({clip['channel']})\n"
             f"SITE_HASHTAGS (use some in instagram/twitter captions): {' '.join('#' + h for h in site.hashtags)}")
    post = rewriter.ask(system, brief, schema, CuratedPost.model_validate)
    post.category = CATEGORY
    post.image_kicker = KICKER
    post.image_headline = post.image_headline or choice.film
    post.tags = ([t.strip() for t in post.tags if t and t.strip()] + [choice.film, "Scenes"])[:8]
    post.mood = post.mood or "nostalgic"
    if post.film is None:
        post.film = Film(title=choice.film, year=choice.year)
    caption = f"{choice.film} ({choice.year}): the {choice.kind}. Video: {clip['channel']} on YouTube."
    from .nostalgia import embed_block
    post.body_html = adclip.slot(embed_block(clip["url"], caption)) + post.body_html
    post.body_html += (f'<p><em>Watch the original: <a href="{clip["url"]}" rel="nofollow noopener" target="_blank">'
                       f'{clip["channel"]} on YouTube</a>. Shown for review and comment; the rights stay with the makers.</em></p>')
    return post


def fetch_clip(site: Site, settings: Settings, clip: dict, work_dir: Path) -> Path | None:
    if not settings.repost_ads:
        return None
    try:
        return adclip.fetch(clip["url"], work_dir / site.slug / "scenes", player_clients=settings.ad_clip_player_clients,
                            cookies=settings.ad_clip_cookies or None)
    except Exception as exc:  # noqa: BLE001
        log.warning("[%s] could not fetch the scene (%s); embed and narrated reel instead", site.key, exc)
        return None


def publish_daily(site: Site, settings: Settings, state: State, rewriter: Rewriter, wp, publishers, work_dir: Path,
                  report) -> bool:
    """Pick the scene, find it on the rights holder's channel, fetch, write, publish."""
    from . import pipeline   # local: pipeline imports this module

    used = parse_used(state.note(site.key, USED_NOTE))
    slot_log = carousels.parse_log(state.note(site.key, NOTE))
    tried = fleet_used(state)
    trending, news = subjects(site, settings, state)
    found = None
    for _ in range(ATTEMPTS):
        choice = pick(rewriter, site, trending, news, tried)
        if choice is None:
            log.info("[%s] the model offered no scene", site.key)
            break
        label = f"{choice.film}: {choice.scene}"
        if any(choice.film.lower() in u.lower() for u in used + tried):
            tried.append(label)
            continue
        clip = youtube.find_scene(choice.film, choice.query, choice.studio, choice.year, timeout=settings.request_timeout)
        if clip is None:
            log.info("[%s] no rights-holder upload for %r; trying another", site.key, label)
            tried.append(f"{label} (no upload on the rights holder's channel)")
            continue
        if not state.claim(clip["url"], site.key, f"Scene: {label}"):
            tried.append(label)
            continue
        found = (choice, clip)
        break
    if found is None:
        log.warning("[%s] no scene this slot: nothing usable", site.key)
        return False
    choice, clip = found
    log.info("[%s] scene: %s (%s) -> %s [%s]", site.key, choice.film, choice.year, clip["url"], clip["channel"])
    try:
        post = write(rewriter, site, choice, clip)
    except Exception as exc:  # noqa: BLE001
        state.release(clip["url"], site.key)
        raise RuntimeError(f"scene feature could not be written: {exc}") from exc
    video = fetch_clip(site, settings, clip, work_dir)
    credit = f"{choice.film} ({choice.year}): the {choice.kind}. Video: {clip['channel']} on YouTube. Shown for review."
    try:
        ok = pipeline.publish_post(site, settings, state, clip["url"], post, wp, publishers, work_dir, report,
                                   image_url=clip["thumbnail"], credit=f"{clip['channel']} on YouTube",
                                   use_source_image=True, force_reel=True, force_story=True,
                                   ad_clip=video, ad_caption=credit if video else None)
    finally:
        if video is not None:
            video.unlink(missing_ok=True)
    if ok:
        state.set_note(site.key, USED_NOTE, "\n".join((used + [f"{choice.film}: {choice.scene}"])[-500:]))
        state.set_note(site.key, NOTE, carousels.dump_log(slot_log + [time.time()]))
        log.info("[%s] scene published for the %s slot", site.key, carousels.slot(time.time(), settings.scene_hours, settings.timezone))
    return ok
