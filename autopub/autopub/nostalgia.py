"""Ad features: the viral ad of the moment and the classic ad revisited, five a day, on the marketing sites.

Five slots a day (settings.ad_hours, on sites with `nostalgia: true`) alternate two kinds:

- current: an ad film everyone is sharing this week. It is found the way the news is found, from
  the creative-industry feeds and Google News, so it is real and this week's, never the model's
  memory; the source article is the grounding and the official upload is embedded.
- nostalgic: an iconic campaign at least a few years old that the site has not covered, Indian and
  international in turn; the model names it, YouTube must have the film under the brand's name.

Either way the film is embedded (never downloaded or re-hosted: it plays with its own sound in
YouTube's player, the rights stay where they are) and the model writes an original feature around
it in the site's own format: the psychology of the ad on Marketing Mentalist, a campaign breakdown
on Crazy4Marketing, an ad-watch report on Marketing Junkies. The feature then takes the same road
as the news: cards, story, a narrated reel, WordPress, every social.

`nostalgia_used` in site_notes lists every campaign covered; the film's URL is the claim, so two
sites never run the same ad, and a current pick also claims its source article so the hourly news
does not run it again.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import replace
from datetime import date
from pathlib import Path

from pydantic import BaseModel, Field

from . import carousels, extract, followups, sources, youtube
from .config import Settings, Site
from .rewrite import JSON_CONTRACT, CuratedPost, Rewriter, schema_for
from .state import State

log = logging.getLogger(__name__)

NOTE = "nostalgia"            # timestamps of the features that went out (slot logic shared with carousels)
USED_NOTE = "nostalgia_used"  # every campaign already covered, "brand | campaign | year" per line
KINDS = ("current", "nostalgic")
KICKERS = {"current": "Viral now", "nostalgic": "Throwback"}
CATEGORY_NOSTALGIC = "Throwback"
CATEGORY_CURRENT = {"CRAZY": "Viral Campaigns", "JUNKIES": "Campaigns"}     # else "Viral Ads"
MIN_AGE_YEARS = 5
ATTEMPTS = 3                  # picks tried before giving the slot up to the next cycle
MIN_SOURCE_WORDS = 150        # a current ad needs a source worth grounding in

# where this week's viral ads are found: the creative-industry desks and the searches that catch
# the ones everyone is sharing. Read for the ad features only; the sites' own feeds are untouched.
VIRAL_FEEDS = ["https://musebycl.io/rss.xml", "https://www.adweek.com/category/creativity/feed/",
               "https://campaignbrief.com/feed/", "https://brandequity.economictimes.indiatimes.com/rss/advertising",
               "https://www.afaqs.com/rss"]
VIRAL_QUERIES = ["viral ad film", "ad campaign goes viral", "new ad film brand campaign", "viral advertisement India",
                 "brand campaign video viral social media"]


class Pick(BaseModel):
    brand: str = Field(max_length=60)
    campaign: str = Field(max_length=120)          # the campaign or film's name, or its tagline
    year: int | None = None
    country: str = Field(default="", max_length=40)
    agency: str | None = Field(default=None, max_length=80)
    hook: str = Field(max_length=200)              # one line on why it is remembered, or why it is spreading
    index: int | None = None                       # current picks: which candidate story


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

CURRENT_PICK_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["index", "brand", "campaign", "hook"],
    "properties": {
        "index": {"type": "integer", "description": "The number of the story you chose, or -1 if none is about a specific new ad film"},
        "brand": {"type": "string", "description": "The advertiser in that story"},
        "campaign": {"type": "string", "description": "The ad film or campaign's name as the story gives it"},
        "hook": {"type": "string", "description": "One sentence, max 180 characters, on why it is spreading"},
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

CURRENT_PICK_PROMPT = """You are the features editor of {name} ({domain}). Beat: {niche} Audience: {audience}

Below are this week's stories from the advertising press. Choose the ONE that is about a specific new ad
film or campaign video people are sharing right now: a brand, a named film, a reason it is spreading.
Not a trend piece, not an industry story, not a list, not one of these already covered:
{used}

Answer with the story's number, the brand and the campaign as the story names them. If none qualifies,
answer index -1.
"""

# the site's own format: the sections its feature walks through, current and nostalgic
FORMATS = {
    "MENTALIST": {
        "name": "The psychology of the ad",
        "current": "the ad in one paragraph (what happens, who it is for); the levers it pulls (two or three named "
                   "principles from behavioural science and exactly how the film uses each); what it does for the brand; "
                   "what to borrow for your next campaign",
        "nostalgic": "the ad and when it ran; the levers it pulled (two or three named principles from behavioural science "
                     "and exactly how the film used each); what it did for the brand and the culture around it; what still "
                     "works today and what would not",
    },
    "CRAZY": {
        "name": "Campaign breakdown",
        "current": "the hook (what the first three seconds do); the structure of the film; why it spread (formats, "
                   "platforms, creators, the share trigger); the numbers, only where the source gives them; steal this "
                   "(three moves for a smaller brand)",
        "nostalgic": "the hook and when it ran; how the film was built; why it spread in its day; what it did for the "
                     "brand; steal this (three moves that still work)",
    },
    "JUNKIES": {
        "name": "Ad watch",
        "current": "the campaign (brand, agency and director where the source names them, release); what the film says "
                   "and how; the response so far, as the source reports it; the category context; what to watch next",
        "nostalgic": "the campaign (brand, agency, when it ran); what the film said and how; the response it got; what it "
                     "changed in the category; where the brand and the idea are now",
    },
}
DEFAULT_FORMAT = {
    "name": "The ad, examined",
    "current": "what the ad is; why it works; what it does for the brand; what to take from it",
    "nostalgic": "what the ad was and when it ran; why it worked; what it did for the brand; what a marketer takes from it now",
}

FEATURE_PROMPT = """You are the editor-in-chief of {name} ({domain}). Tagline: "{tagline}".

Beat: {niche}
Audience: {audience}
Voice: {tone}

Write today's {label} feature, "{format_name}": an original piece about an ad film the reader can watch right
there (the film is embedded above your text; do not describe frame by frame what they can see).
- Sections, each an <h2>, in this order: {sections}.
- 450-700 words. Short paragraphs, one bullet list where it helps. Concrete, specific, warm; no cliches, no hype.
- {grounding}
- Never quote the ad's dialogue at length; its tagline is fine.
- Do not link out; do not mention YouTube or that a video is embedded; the page handles that.
- Never mention that you are an AI.
- `category` must be "{category}". `image_kicker` must be "{kicker}". `image_headline` names the brand and the campaign.
- Captions must be platform-native and must not include any URL. Instagram: no URL and no 'link in bio'.
- `story_frames`: 2-3 frames telling the ad's story and its lesson for a viewer who sees only images.
- `mentions`: the brand (and agency if certain), with Instagram usernames only when confident.
- `card`: only material you are certain of; the ad's tagline as `quote` with `quote_by` the brand is ideal.
- `hot_take`: one bold, arguable sentence about this campaign, max 140 characters, that a marketer could
  disagree with. An opinion, stated flat, no hedging, no question mark.
- `hook`: 3-7 words set large on the card ("The ad that sold friendship"); `caption_hook`: the caption's
  first line, one sentence that opens a gap.
"""
GROUNDING = {
    "current": "Facts, names, figures and quotes only from SOURCE_TEXT; report the news in your own words and never copy "
               "its sentences. If the source is thin on a section, keep that section short rather than inventing.",
    "nostalgic": "Facts, names, years and figures only where you are certain; when unsure, write around it (\"in the "
                 "mid-1990s\", \"the campaign is credited with lifting sales\") rather than inventing a number.",
}


# ---- slots -----------------------------------------------------------------------------------------

def due(settings: Settings, state: State, site: Site) -> bool:
    if not settings.ad_hours:
        return False
    log_ = carousels.parse_log(state.note(site.key, NOTE))
    return carousels.due(time.time(), log_, settings.ad_hours, settings.timezone)


def kind_for_slot(settings: Settings, now: float | None = None) -> str:
    """Current and nostalgic alternate through the day's slots, current first: with five slots that
    is three of this week's ads and two classics."""
    slot = carousels.slot(now or time.time(), settings.ad_hours, settings.timezone)
    if slot is None:
        return "current"
    hours = sorted({int(h) % 24 for h in settings.ad_hours})
    return KINDS[hours.index(slot[1]) % 2]


def category_for(site: Site, kind: str) -> str:
    return CATEGORY_NOSTALGIC if kind == "nostalgic" else CATEGORY_CURRENT.get(site.key, "Viral Ads")


# ---- the covered list --------------------------------------------------------------------------------

def parse_used(raw: str | None) -> list[str]:
    return [line.strip() for line in (raw or "").splitlines() if line.strip()]


def fleet_used(state: State) -> list[str]:
    """Every campaign any site has covered, so two sites never pick the same ad."""
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


# ---- picking --------------------------------------------------------------------------------------------

def pick(rewriter: Rewriter, site: Site, used: list[str], day_index: int) -> Pick:
    """The nostalgic pick: the model names a classic, Indian and international in turn."""
    region = ("an INDIAN campaign (made for India, by an Indian or India-based brand)" if day_index % 2 == 0
              else "an INTERNATIONAL campaign (made outside India, for a global or foreign market)")
    system = PICK_PROMPT.format(name=site.name, domain=site.domain, niche=site.niche, audience=site.audience,
                                min_age=MIN_AGE_YEARS, region=region,
                                used="\n".join(f"- {u}" for u in used[-120:]) or "- (none yet)")
    system += JSON_CONTRACT.format(schema=json.dumps(PICK_SCHEMA))
    return rewriter.ask(system, f"Today is {time.strftime('%d %B %Y')}. Name today's campaign: {region}.", PICK_SCHEMA,
                        Pick.model_validate, max_tokens=6000)   # a reasoning model thinks inside this budget too


def current_candidates(site: Site, settings: Settings, state: State) -> list[sources.Candidate]:
    """This week's stories from the advertising press, not yet used by any site."""
    scout = replace(site, feeds=list(VIRAL_FEEDS), google_news_queries=list(VIRAL_QUERIES), include_keywords=[],
                    max_age_hours=96)
    cands = sources.collect(scout, timeout=settings.request_timeout)
    return [c for c in cands if not state.is_used(c.url, site.key)][:30]


def pick_current(rewriter: Rewriter, site: Site, cands: list[sources.Candidate], used: list[str]) -> Pick | None:
    """The model chooses, from the week's stories, the one about a specific ad film people are sharing."""
    if not cands:
        return None
    listing = "\n".join(f"{i + 1}. {c.title} ({c.source})" for i, c in enumerate(cands))
    system = CURRENT_PICK_PROMPT.format(name=site.name, domain=site.domain, niche=site.niche, audience=site.audience,
                                        used="\n".join(f"- {u}" for u in used[-120:]) or "- (none yet)")
    system += JSON_CONTRACT.format(schema=json.dumps(CURRENT_PICK_SCHEMA))
    p = rewriter.ask(system, f"Today is {time.strftime('%d %B %Y')}.\n\nSTORIES:\n{listing}", CURRENT_PICK_SCHEMA,
                     Pick.model_validate, max_tokens=6000)
    if p.index is None or p.index < 1 or p.index > len(cands):
        return None
    p.year = date.today().year
    return p


# ---- writing ----------------------------------------------------------------------------------------------

def embed_block(video_url: str, caption: str) -> str:
    """The WordPress embed block for a YouTube URL: the editor's own markup, so the front end renders
    the player and the block editor shows the embed rather than a bare link."""
    return ('<!-- wp:embed {"url":"' + video_url + '","type":"video","providerNameSlug":"youtube","responsive":true,'
            '"className":"wp-embed-aspect-16-9 wp-has-aspect-ratio"} -->\n'
            '<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube '
            'wp-embed-aspect-16-9 wp-has-aspect-ratio"><div class="wp-block-embed__wrapper">\n'
            f"{video_url}\n</div><figcaption class=\"wp-element-caption\">{caption}</figcaption></figure>\n"
            "<!-- /wp:embed -->\n")


def write(rewriter: Rewriter, site: Site, choice: Pick, film: dict | None, kind: str = "nostalgic",
          source: extract.Article | None = None) -> CuratedPost:
    fmt = FORMATS.get(site.key, DEFAULT_FORMAT)
    category, kicker = category_for(site, kind), KICKERS[kind]
    schema = schema_for(site)
    schema["properties"]["category"] = {"type": "string", "enum": [category]}
    schema["properties"]["hot_take"] = {"type": "string", "description": "One bold, arguable sentence about this campaign, max 140 characters, no question mark"}
    schema["required"] = [*schema["required"], "hot_take"]
    system = FEATURE_PROMPT.format(name=site.name, domain=site.domain, tagline=site.tagline, niche=site.niche,
                                   audience=site.audience, tone=site.tone, category=category, kicker=kicker,
                                   label="THROWBACK" if kind == "nostalgic" else "VIRAL NOW", format_name=fmt["name"],
                                   sections=fmt[kind], grounding=GROUNDING[kind])
    system += JSON_CONTRACT.format(schema=json.dumps(schema))
    brief = (f"BRAND: {choice.brand}\nCAMPAIGN: {choice.campaign}\nYEAR: {choice.year or 'not certain'}\n"
             f"COUNTRY: {choice.country or 'not certain'}\nAGENCY: {choice.agency or 'not certain'}\n"
             f"{'WHY IT IS SPREADING' if kind == 'current' else 'WHY IT IS REMEMBERED'}: {choice.hook}\n"
             f"FILM ON YOUTUBE: {film['title'] + ' (' + film['channel'] + ')' if film else 'none found; write without describing footage'}\n"
             f"SITE_HASHTAGS (use some in instagram/twitter captions): {' '.join('#' + h for h in site.hashtags)}")
    if source is not None:
        brief += (f"\n\nSOURCE_URL: {source.url}\nSOURCE_NAME: {source.sitename or source.url.split('/')[2]}\n"
                  f"SOURCE_TITLE: {source.title}\n\nSOURCE_TEXT:\n{source.text}")
    post = rewriter.ask(system, brief, schema, CuratedPost.model_validate)
    post.tags = [t.strip() for t in post.tags if t and t.strip()][:8]
    tag = "Throwback" if kind == "nostalgic" else "Viral ads"
    if tag.lower() not in [t.lower() for t in post.tags]:
        post.tags = (post.tags + [tag])[:8]
    post.category = category
    post.image_kicker = kicker
    post.mood = post.mood or ("nostalgic" if kind == "nostalgic" else "upbeat")
    if film:
        caption = f"{choice.brand}: {choice.campaign}" + (f" ({choice.year})" if choice.year and kind == "nostalgic" else "") + f". Video: {film['channel']} on YouTube."
        post.body_html = embed_block(film["url"], caption) + post.body_html
        post.body_html += (f'<p><em>Watch the original: <a href="{film["url"]}" rel="nofollow noopener" target="_blank">'
                           f'{choice.brand} on YouTube</a></em></p>')
    if source is not None:
        post.body_html += (f'<p><em>Source: <a href="{source.url}" rel="nofollow noopener" target="_blank">'
                           f'{source.sitename or source.url.split("/")[2]}</a></em></p>')
    return post


# ---- publishing -------------------------------------------------------------------------------------------

def _find_nostalgic(rewriter, site, settings, state, used, tried, day_index):
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
        return candidate, found, found["url"], None
    return None


def _find_current(rewriter, site, settings, state, used, tried):
    cands = current_candidates(site, settings, state)
    if not cands:
        log.info("[%s] no viral-ad stories this week", site.key)
        return None
    for _ in range(ATTEMPTS):
        choice = pick_current(rewriter, site, cands, tried)
        if choice is None:
            log.info("[%s] the model found no story about a specific ad film", site.key)
            return None
        cand = cands[choice.index - 1]
        key = key_of(choice)
        cands = [c for c in cands if c is not cand]
        if any(_same(key, u) for u in used):
            tried.append(key)
            continue
        try:
            article = extract.extract(cand.url, timeout=settings.request_timeout)
        except Exception as exc:  # noqa: BLE001
            log.info("[%s] could not read %s: %s", site.key, cand.url, exc)
            tried.append(key + " (source unreadable)")
            continue
        if article.word_count < MIN_SOURCE_WORDS:
            tried.append(key + " (source too thin)")
            continue
        found = youtube.find_ad(choice.brand, choice.campaign, choice.year, timeout=settings.request_timeout)
        if found is None:
            log.info("[%s] no upload found for %r; trying another story", site.key, key)
            tried.append(key + " (no film found)")
            continue
        if not state.claim(found["url"], site.key, f"Viral now: {choice.brand} {choice.campaign}"):
            tried.append(key)
            continue
        state.claim(cand.url, site.key, cand.title)     # the news must not run the same story again
        article.title = article.title or cand.title
        article.sitename = article.sitename or cand.source
        return choice, found, found["url"], article
    return None


def publish_daily(site: Site, settings: Settings, state: State, rewriter: Rewriter, wp, publishers,
                  work_dir: Path, report, kind: str | None = None) -> bool:
    """Pick, find the film, claim it, write, publish. Returns True when the feature went out."""
    from . import pipeline   # local: pipeline imports this module

    kind = kind or kind_for_slot(settings)
    used = parse_used(state.note(site.key, USED_NOTE))
    slot_log = carousels.parse_log(state.note(site.key, NOTE))
    day_index = len(slot_log) + (0 if site.key in ("MENTALIST", "JUNKIES") else 1)   # sites alternate out of step
    tried = fleet_used(state)     # the whole network's list goes to the model; this site's own decides the repeat check
    found = (_find_current(rewriter, site, settings, state, used, tried) if kind == "current"
             else _find_nostalgic(rewriter, site, settings, state, used, tried, day_index))
    if found is None and kind == "current":
        log.info("[%s] no viral ad this slot; a classic instead", site.key)
        kind = "nostalgic"
        found = _find_nostalgic(rewriter, site, settings, state, used, tried, day_index)
    if found is None:
        log.warning("[%s] no ad feature this slot: nothing usable", site.key)
        return False
    choice, film, url, article = found
    log.info("[%s] %s: %s, %s (%s) -> %s", site.key, KICKERS[kind], choice.brand, choice.campaign, choice.year or "year unsure", url)
    try:
        post = write(rewriter, site, choice, film, kind, article)
    except Exception as exc:  # noqa: BLE001 - release the claim so another day can use the film
        state.release(url, site.key)
        if article is not None:
            state.release(article.url, site.key)
        raise RuntimeError(f"ad feature could not be written: {exc}") from exc
    ok = pipeline.publish_post(site, settings, state, url, post, wp, publishers, work_dir, report,
                               image_url=film["thumbnail"], credit=f"{film['channel']} on YouTube",
                               use_source_image=True, force_reel=True, force_story=True)
    if ok:
        state.set_note(site.key, USED_NOTE, dump_used(used + [key_of(choice)]))
        state.set_note(site.key, NOTE, carousels.dump_log(slot_log + [time.time()]))
        take = " ".join((post.hot_take or "").split())
        if kind == "nostalgic" and len(take) >= 20 and any(p.platform in followups.FEED for p in publishers):
            # the hot take follows a throwback: one arguable line, as a quote card, for the comments
            followups.schedule(state, site.key, "hot_take", time.time() + settings.followup_delay_minutes * 60,
                               {"take": take, "link": report.published[-1] if report.published else film["url"],
                                "title": post.title, "subject": f"{choice.brand}'s {choice.campaign}",
                                "by": f"{site.name} on {choice.brand}"})
        log.info("[%s] %s feature published for the %s slot", site.key, kind,
                 carousels.slot(time.time(), settings.ad_hours, settings.timezone))
    return ok
