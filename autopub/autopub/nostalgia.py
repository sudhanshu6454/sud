"""The daily throwback: one classic ad campaign, revisited, on each marketing site.

Once a day (settings.nostalgia_hour, on sites with `nostalgia: true`) the model names an iconic
campaign the site has not covered - Indian and global in turn, at least a few years old, the kind
readers remember - the official upload is found on YouTube and embedded (never downloaded or
re-hosted: the film plays with its own sound in YouTube's player, and the rights stay where they
are), and the model writes an original feature around it: the ad, why it worked for this site's
beat, its legacy, what a marketer takes from it now. The feature then goes down the same road as
the news: cards, story, a narrated reel, WordPress, every social.

Two lists keep it honest. `nostalgia_used` in site_notes is every campaign already run, so nothing
repeats. And a pick is only kept when YouTube actually has the film under the brand's name: a
campaign the model misremembers has no upload to find and is dropped, not written up.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from pydantic import BaseModel, Field

from . import carousels, followups, youtube
from .config import Settings, Site
from .rewrite import JSON_CONTRACT, CuratedPost, Rewriter, schema_for
from .state import State

log = logging.getLogger(__name__)

NOTE = "nostalgia"            # timestamps of the throwbacks that went out (slot logic shared with carousels)
USED_NOTE = "nostalgia_used"  # every campaign already covered, "brand | campaign | year" per line
CATEGORY = "Throwback"
KICKER = "Throwback"
MIN_AGE_YEARS = 5
ATTEMPTS = 3                  # picks tried before giving today's slot up to the next cycle


class Pick(BaseModel):
    brand: str = Field(max_length=60)
    campaign: str = Field(max_length=120)          # the campaign or film's name, or its tagline
    year: int | None = None
    country: str = Field(default="", max_length=40)
    agency: str | None = Field(default=None, max_length=80)
    hook: str = Field(max_length=200)              # one line on why it is remembered


PICK_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["brand", "campaign", "hook"],
    "properties": {
        "brand": {"type": "string", "description": "The advertiser, as commonly named"},
        "campaign": {"type": "string", "description": "The campaign or film's name, or the line everyone remembers it by"},
        "year": {"type": "integer", "description": "The year it first ran, only if you are certain"},
        "country": {"type": "string", "description": "Where it ran first"},
        "agency": {"type": "string", "description": "The agency, only if you are certain"},
        "hook": {"type": "string", "description": "One sentence, max 180 characters, on why it is still remembered"},
    },
}

PICK_PROMPT = """You are the features editor of {name} ({domain}). Beat: {niche} Audience: {audience}

Name ONE iconic advertising campaign for today's throwback feature. Hard rules:
- Today's campaign MUST be {region}. Not the other kind.
- At least {min_age} years old and genuinely famous: the kind of ad this audience remembers, quotes or still
  sees referenced, with a film that exists on YouTube under the brand's name.
- Not any of these, already covered anywhere in our network (nor another film from the same campaign):
{used}

Only name facts you are certain of; leave year or agency out rather than guess. Prefer a campaign whose
lesson speaks to this site's beat.
"""

FEATURE_PROMPT = """You are the editor-in-chief of {name} ({domain}). Tagline: "{tagline}".

Beat: {niche}
Audience: {audience}
Voice: {tone}

Write today's THROWBACK feature: an original piece revisiting a classic ad campaign that the reader can watch
right there (the film is embedded above your text; do not describe frame by frame what they can see).
- Sections, each an <h2>: what the ad was and when it ran; why it worked, seen through this site's beat;
  what it did for the brand and the culture around it; what a marketer should take from it today.
- 450-700 words. Short paragraphs, one bullet list where it helps. Concrete, specific, warm; no nostalgia
  cliches ("simpler times"), no hype.
- Facts, names, years and figures only where you are certain; when unsure, write around it ("in the
  mid-1990s", "the campaign is credited with lifting sales") rather than inventing a number. Never quote
  the ad's dialogue at length; its tagline is fine.
- Do not link out; do not mention YouTube or that a video is embedded; the page handles that.
- Never mention that you are an AI.
- `category` must be "{category}". `image_kicker` must be "{kicker}". `image_headline` names the brand and the campaign.
- Captions must be platform-native and must not include any URL. Instagram: no URL and no 'link in bio'.
- `story_frames`: 2-3 frames telling the ad's story and its lesson for a viewer who sees only images.
- `mentions`: the brand (and agency if certain), with Instagram usernames only when confident.
- `card`: only material you are certain of; the ad's tagline as `quote` with `quote_by` the brand is ideal.
- `hot_take`: one bold, arguable sentence about this campaign seen from today, max 140 characters, that a
  marketer could disagree with ("This ad would be cancelled in a week today, and it would deserve it").
  An opinion, stated flat, no hedging, no question mark.
- `hook`: 3-7 words set large on the card ("The ad that sold friendship"); `caption_hook`: the caption's
  first line, one sentence that opens a gap.
"""


def due(settings: Settings, state: State, site: Site) -> bool:
    if settings.nostalgia_hour is None:
        return False
    log_ = carousels.parse_log(state.note(site.key, NOTE))
    return carousels.due(time.time(), log_, [settings.nostalgia_hour], settings.timezone)


def parse_used(raw: str | None) -> list[str]:
    return [line.strip() for line in (raw or "").splitlines() if line.strip()]


def fleet_used(state: State) -> list[str]:
    """Every campaign any site has covered, so two sites never pick the same classic."""
    seen: list[str] = []
    for value in state.notes(USED_NOTE).values():
        for key in parse_used(value):
            if not any(_same(key, s) for s in seen):
                seen.append(key)
    return seen


def dump_used(used: list[str]) -> str:
    return "\n".join(used[-400:])


def key_of(pick: Pick) -> str:
    return f"{pick.brand} | {pick.campaign} | {pick.year or ''}".strip(" |")


def _same(a: str, b: str) -> bool:
    """Same brand and the same campaign name (first dozen letters), whatever the year field says."""
    def parts(key: str) -> tuple[str, str]:
        bits = [x.strip().lower() for x in key.split("|")]
        return bits[0], (bits[1] if len(bits) > 1 else "")[:12]
    return parts(a) == parts(b)


def pick(rewriter: Rewriter, site: Site, used: list[str], day_index: int) -> Pick:
    region = ("an INDIAN campaign (made for India, by an Indian or India-based brand)" if day_index % 2 == 0
              else "an INTERNATIONAL campaign (made outside India, for a global or foreign market)")
    system = PICK_PROMPT.format(name=site.name, domain=site.domain, niche=site.niche, audience=site.audience,
                                min_age=MIN_AGE_YEARS, region=region,
                                used="\n".join(f"- {u}" for u in used[-120:]) or "- (none yet)")
    system += JSON_CONTRACT.format(schema=json.dumps(PICK_SCHEMA))
    return rewriter.ask(system, f"Today is {time.strftime('%d %B %Y')}. Name today's campaign: {region}.", PICK_SCHEMA,
                        Pick.model_validate, max_tokens=6000)   # a reasoning model thinks inside this budget too


def embed_block(video_url: str, caption: str) -> str:
    """The WordPress embed block for a YouTube URL: the editor's own markup, so the front end renders
    the player and the block editor shows the embed rather than a bare link."""
    return ('<!-- wp:embed {"url":"' + video_url + '","type":"video","providerNameSlug":"youtube","responsive":true,'
            '"className":"wp-embed-aspect-16-9 wp-has-aspect-ratio"} -->\n'
            '<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube '
            'wp-embed-aspect-16-9 wp-has-aspect-ratio"><div class="wp-block-embed__wrapper">\n'
            f"{video_url}\n</div><figcaption class=\"wp-element-caption\">{caption}</figcaption></figure>\n"
            "<!-- /wp:embed -->\n")


def write(rewriter: Rewriter, site: Site, choice: Pick, film: dict | None) -> CuratedPost:
    schema = schema_for(site)
    schema["properties"]["category"] = {"type": "string", "enum": [CATEGORY]}
    schema["properties"]["hot_take"] = {"type": "string", "description": "One bold, arguable sentence about this campaign seen from today, max 140 characters, no question mark"}
    schema["required"] = [*schema["required"], "hot_take"]
    system = FEATURE_PROMPT.format(name=site.name, domain=site.domain, tagline=site.tagline, niche=site.niche,
                                   audience=site.audience, tone=site.tone, category=CATEGORY, kicker=KICKER)
    system += JSON_CONTRACT.format(schema=json.dumps(schema))
    brief = (f"BRAND: {choice.brand}\nCAMPAIGN: {choice.campaign}\nYEAR: {choice.year or 'not certain'}\n"
             f"COUNTRY: {choice.country or 'not certain'}\nAGENCY: {choice.agency or 'not certain'}\n"
             f"WHY IT IS REMEMBERED: {choice.hook}\n"
             f"FILM ON YOUTUBE: {film['title'] + ' (' + film['channel'] + ')' if film else 'none found; write without describing footage'}\n"
             f"SITE_HASHTAGS (use some in instagram/twitter captions): {' '.join('#' + h for h in site.hashtags)}")
    post = rewriter.ask(system, brief, schema, CuratedPost.model_validate)
    post.tags = [t.strip() for t in post.tags if t and t.strip()][:8]
    if "throwback" not in [t.lower() for t in post.tags]:
        post.tags = (post.tags + ["Throwback"])[:8]
    post.category = CATEGORY
    post.image_kicker = KICKER
    if film:
        caption = f"{choice.brand}: {choice.campaign}" + (f" ({choice.year})" if choice.year else "") + f". Video: {film['channel']} on YouTube."
        post.body_html = embed_block(film["url"], caption) + post.body_html
        post.body_html += (f'<p><em>Watch the original: <a href="{film["url"]}" rel="nofollow noopener" target="_blank">'
                           f'{choice.brand} on YouTube</a></em></p>')
    return post


def publish_daily(site: Site, settings: Settings, state: State, rewriter: Rewriter, wp, publishers,
                  work_dir: Path, report) -> bool:
    """Pick, find the film, claim it, write, publish. Returns True when the feature went out."""
    from . import pipeline   # local: pipeline imports this module

    used = parse_used(state.note(site.key, USED_NOTE))
    slot_log = carousels.parse_log(state.note(site.key, NOTE))
    day_index = len(slot_log) + (0 if site.key in ("MENTALIST", "JUNKIES") else 1)   # sites alternate out of step
    choice = film = url = None
    tried = fleet_used(state)     # the whole network's list goes to the model; this site's own decides the repeat check
    for _ in range(ATTEMPTS):
        candidate = pick(rewriter, site, tried, day_index)
        key = key_of(candidate)
        if any(_same(key, u) for u in used):
            log.info("[%s] throwback pick %r already covered; asking again", site.key, key)
            tried.append(key)
            continue
        found = youtube.find_ad(candidate.brand, candidate.campaign, candidate.year, timeout=settings.request_timeout)
        if found is None:
            log.info("[%s] no upload found for %r; asking again", site.key, key)
            tried.append(key + " (no film found)")
            continue
        if not state.claim(found["url"], site.key, f"Throwback: {candidate.brand} {candidate.campaign}"):
            log.info("[%s] %s already used by another site; asking again", site.key, found["url"])
            tried.append(key)
            continue
        choice, film, url = candidate, found, found["url"]
        break
    if choice is None:
        log.warning("[%s] no throwback today: %d picks, none usable", site.key, ATTEMPTS)
        return False
    log.info("[%s] throwback: %s, %s (%s) -> %s", site.key, choice.brand, choice.campaign, choice.year or "year unsure", url)
    try:
        post = write(rewriter, site, choice, film)
    except Exception as exc:  # noqa: BLE001 - release the claim so another day can use the film
        state.release(url, site.key)
        raise RuntimeError(f"throwback feature could not be written: {exc}") from exc
    ok = pipeline.publish_post(site, settings, state, url, post, wp, publishers, work_dir, report,
                               image_url=film["thumbnail"], credit=f"{film['channel']} on YouTube",
                               use_source_image=True, force_reel=True)
    if ok:
        state.set_note(site.key, USED_NOTE, dump_used(used + [key_of(choice)]))
        state.set_note(site.key, NOTE, carousels.dump_log(slot_log + [time.time()]))
        take = " ".join((post.hot_take or "").split())
        if len(take) >= 20 and any(p.platform in followups.FEED for p in publishers):
            # the hot take follows the feature: one arguable line, as a quote card, for the comments
            followups.schedule(state, site.key, "hot_take", time.time() + settings.followup_delay_minutes * 60,
                               {"take": take, "link": report.published[-1] if report.published else film["url"],
                                "title": post.title, "subject": f"{choice.brand}'s {choice.campaign}",
                                "by": f"{site.name} on {choice.brand}"})
        log.info("[%s] throwback published for the %s slot", site.key,
                 carousels.slot(time.time(), [settings.nostalgia_hour], settings.timezone))
    return ok
