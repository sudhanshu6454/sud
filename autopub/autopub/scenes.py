"""Scenes: a clip already viral on YouTube, from the rights holder's own channel, posted with the scene broken down.

Twice a day (settings.scene_hours, on sites with `scenes: true`) the feature starts from YouTube itself:
the scene clips YouTube ranks highest by views, this month and all time, on the searches fans make
(`youtube.viral_scenes`). Only clips on a rights holder's own channel qualify (the studio, the streamer,
the label, a catalogue channel like Shemaroo, Ultra or Goldmines, or the film's own channel; never a
fan's or a reaction channel's), of a scene's length, past `scene_min_views`. The editor picks one from
that list and names the film and the moment; the clip is fetched with yt-dlp (adclip) and published as
the page: the scene broken down beat by beat (the setup, the turn, the line, the performance, the
craft, why it travels) with the clip as a self-hosted video and a link to the original, and the clip
inside the site's frame as the reel on Instagram and the video on the Facebook Page, credited on the
frame and in the caption. `repost_ads` is the switch; without it the scene runs as an embed with a
narrated reel.

`scenes_used` in site_notes lists every scene covered (film: scene); the upload's URL is the claim.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import date
from pathlib import Path

from pydantic import BaseModel, Field

from . import adclip, carousels, youtube
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
    index: int
    film: str = Field(default="", max_length=80)
    year: int | None = None
    studio: str = Field(default="", max_length=80)
    scene: str = Field(default="", max_length=140)      # what happens, in one line
    kind: str = Field(default="scene", max_length=20)   # scene | song | monologue | climax
    hook: str = Field(default="", max_length=200)       # why people share it


PICK_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["index", "film", "year", "studio", "scene", "kind", "hook"],
    "properties": {
        "index": {"type": "integer", "description": "The number of the clip you chose, or -1 if none of them is a scene, song or monologue from a specific film or show"},
        "film": {"type": "string", "description": "The film or show the clip is from, as released"},
        "year": {"type": "integer", "description": "Its release year"},
        "studio": {"type": "string", "description": "The rights holder whose channel carries it, as the listing names the channel"},
        "scene": {"type": "string", "description": "The moment in one line, max 120 characters: who, where, what happens"},
        "kind": {"type": "string", "description": "scene, song, monologue or climax"},
        "hook": {"type": "string", "description": "One sentence, max 180 characters, on why people share this one"},
    },
}

PICK_PROMPT = """You are the scenes editor of {name} ({domain}): {tagline}. Audience: {audience}. Tone: {tone}.
Below are the scene clips people are watching most on YouTube right now, all on the rights holders' own channels.
Choose the ONE to break down today for a feature where the clip plays on the page and goes out as a reel.
Rules:
- A scene, song, monologue or climax from a specific film or show that you can name with its year; not a compilation,
  a mashup, an interview or a promo.
- Prefer the clip people are sharing this month over an evergreen one; Indian cinema first, world cinema when the
  clip is the bigger one; the languages the site covers.
- Not a film already covered (list below).
Return -1 if nothing qualifies.

ALREADY COVERED:
{used}
"""

WRITE_PROMPT = """You are the film-obsessed editor of {name} ({domain}): {tagline}. Audience: {audience}. Tone: {tone}.
Write today's scene breakdown. The clip plays at the top of the page, so the reader has just watched it; take it apart
for them, in the first person, as a fan who knows craft.

Use these sections, as <h2> headings, in this order:
1. The setup: where the scene sits in the film and what is at stake, in two or three sentences, no spoilers beyond it.
2. The turn: the beat where the scene changes gear, and how the film gets there.
3. The line: the line or the moment people quote, and why it lands (the writing, the timing, the delivery).
4. The performance: what the actor or actors do, precisely, that a lesser scene would not.
5. The craft: the staging, the cut, the music, the sound, the camera, whichever carries it, with one specific choice
   named for each you mention.
6. Why it travels: why this scene is the one people share, decades or days later.
350 to 650 words. Category: {category}.
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


def _views(n: int) -> str:
    return f"{n / 1_000_000:.1f}M" if n >= 1_000_000 else f"{n // 1000}K"


def _length(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def candidates(site: Site, settings: Settings, state: State) -> list[dict]:
    """The viral scene clips YouTube ranks highest, on rights holders' channels, not yet used by this site."""
    clips = youtube.viral_scenes(min_views=settings.scene_min_views, timeout=settings.request_timeout)
    return [c for c in clips if not state.is_used(c["url"], site.key)]


def listing(clips: list[dict]) -> str:
    return "\n".join(f"{i + 1}. {c['title'][:90]} | {c['channel']} | {_views(c.get('views') or 0)} views | {_length(c['seconds'])}"
                     f"{' | this month' if c.get('this_month') else ''}" for i, c in enumerate(clips))


def pick(rewriter: Rewriter, site: Site, clips: list[dict], used: list[str]) -> Pick | None:
    if not clips:
        return None
    system = PICK_PROMPT.format(name=site.name, domain=site.domain, tagline=site.tagline, audience=site.audience, tone=site.tone,
                                used="\n".join(f"- {u}" for u in used[-150:]) or "- (none yet)")
    system += JSON_CONTRACT.format(schema=json.dumps(PICK_SCHEMA))
    p = rewriter.ask(system, f"Today is {time.strftime('%d %B %Y')}.\n\nCLIPS:\n{listing(clips)}", PICK_SCHEMA, Pick.model_validate, max_tokens=4000)
    if p.index is None or p.index < 1 or p.index > len(clips) or not p.film.strip():
        return None
    p.year = p.year or date.today().year
    return p


def write(rewriter: Rewriter, site: Site, choice: Pick, clip: dict) -> CuratedPost:
    schema = schema_for(site)
    schema["properties"]["category"] = {"type": "string", "enum": [CATEGORY]}
    system = WRITE_PROMPT.format(name=site.name, domain=site.domain, tagline=site.tagline, audience=site.audience,
                                 tone=site.tone, category=CATEGORY, kicker=KICKER)
    system += JSON_CONTRACT.format(schema=json.dumps(schema))
    brief = (f"FILM: {choice.film} ({choice.year})\nRIGHTS HOLDER / CHANNEL: {clip['channel']}\n"
             f"THE {choice.kind.upper()}: {choice.scene}\nWHY PEOPLE SHARE IT: {choice.hook}\n"
             f"UPLOAD: {clip['title']} ({_views(clip.get('views') or 0)} views, {_length(clip['seconds'])})\n"
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
    """Find what is viral, let the editor pick, fetch the clip, write the breakdown, publish."""
    from . import pipeline   # local: pipeline imports this module

    used = parse_used(state.note(site.key, USED_NOTE))
    slot_log = carousels.parse_log(state.note(site.key, NOTE))
    tried = fleet_used(state)
    clips = candidates(site, settings, state)
    if not clips:
        log.info("[%s] no viral scene clips on rights holders' channels right now", site.key)
        return False
    found = None
    for _ in range(ATTEMPTS):
        choice = pick(rewriter, site, clips, tried)
        if choice is None:
            log.info("[%s] the editor found no scene worth breaking down among %d clips", site.key, len(clips))
            break
        clip = clips[choice.index - 1]
        clips = [c for c in clips if c is not clip]
        label = f"{choice.film}: {choice.scene}"
        if any(choice.film.lower() in u.lower() for u in used + tried):
            tried.append(label)
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
    log.info("[%s] scene: %s (%s) -> %s [%s, %s views]", site.key, choice.film, choice.year, clip["url"], clip["channel"], _views(clip.get("views") or 0))
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
