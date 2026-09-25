"""ScreenStat's actor scorecards: an actor's career in numbers, five a day.

Every figure comes from Wikipedia (autopub/wiki.py): the films and years from the filmography
table, each recent film's budget and box office from its infobox, the date of birth and awards
from Wikidata. The scorecard's numbers - how many films, how many hits, the return multiples,
the biggest hit, the trend - are computed here and laid out in a table and a summary box that
the code writes. The model names the day's actor and writes the analysis around the figures; it
is told the figures and told not to add any.

ScreenStat's verdict rule is fixed and printed on every scorecard so a reader can disagree with
it: a film with a known budget is a blockbuster at 2.5x its budget or more, a hit at 1.75x, average
at 1.25x, and a flop below that. Films Wikipedia has no figures for are counted but not judged.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import date

from pydantic import BaseModel, Field

from . import carousels, wiki
from .cards import CardBrief, CardIdeas
from .config import Settings, Site
from .rewrite import JSON_CONTRACT, CuratedPost, Rewriter, schema_for
from .state import State

log = logging.getLogger(__name__)

NOTE = "scorecards"
USED_NOTE = "scorecards_used"
CATEGORY = "Scorecards"
KICKER = "Scorecard"
RECENT_YEARS = 12            # the window the money table covers; older infoboxes rarely carry figures
MAX_RECENT = 14              # films whose infoboxes are fetched
MIN_WITH_DATA = 5            # films with both budget and gross needed for a verdict-worthy scorecard
ATTEMPTS = 3
INDUSTRIES = ("Hindi", "Tamil", "Telugu", "Malayalam", "Kannada")
RULE = ((2.5, "Blockbuster"), (1.75, "Hit"), (1.25, "Average"), (0.0, "Flop"))


class Pick(BaseModel):
    actor: str = Field(max_length=80)          # the English Wikipedia page title, exactly
    industry: str = Field(default="", max_length=30)
    why_now: str = Field(max_length=200)


PICK_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["actor", "why_now"],
    "properties": {
        "actor": {"type": "string", "description": "The actor's English Wikipedia page title, exactly as Wikipedia titles it (e.g. 'Vijay (actor)', 'Alia Bhatt')"},
        "industry": {"type": "string", "description": "Hindi, Tamil, Telugu, Malayalam or Kannada"},
        "why_now": {"type": "string", "description": "One line on why readers would want this actor's numbers today, max 180 characters"},
    },
}

PICK_PROMPT = """You are the data editor of {name} ({domain}). Beat: {niche} Audience: {audience}

Name ONE Indian film actor for today's scorecard: a career told in numbers (films, hits, flops, returns).
Hard rules:
- Today's actor MUST be from the {industry} film industry.
- A working star with at least 15 released films and at least 8 films in the last twelve years, so the
  box office record is deep enough to judge, and with an English Wikipedia page that has a filmography.
- Not any of these, already covered:
{used}

Give the Wikipedia page title exactly; a wrong title means no scorecard.
"""

FEATURE_PROMPT = """You are the editor-in-chief of {name} ({domain}). Tagline: "{tagline}".

Beat: {niche}
Audience: {audience}
Voice: {tone}

Write today's SCORECARD: an actor's career read through the numbers. You are given the figures as FACTS.
- Use ONLY the figures in FACTS. Do not add a number, a film, a year, an award or a collection from memory.
  Round nothing; quote figures as given. If FACTS lacks something, do not mention it.
- The table of recent films and the summary box are inserted above your text by the page; do not
  reproduce the table. Refer to it ("in the table above").
- Sections, each an <h2>: what the numbers say (the headline reading of the record); the hits and the
  misses (name the biggest hit and the weakest return, with their multiples); the trend (the recent
  five against the five before); what it means for the actor's next film and for the industry.
- 450-650 words. Specific, fair, unsentimental; a scorecard, not a fan piece and not a hit job. Where a
  film has no figures, say Wikipedia carries none rather than guessing.
- Never mention that you are an AI.
- `category` must be "{category}". `image_kicker` must be "{kicker}". `image_headline` names the actor and
  the one number that defines the record (e.g. "Vijay: 7 hits in 9 films").
- Captions must be platform-native and must not include any URL. Instagram: no URL and no 'link in bio'.
- `story_frames`: 2-3 frames of the record for a viewer who sees only images, figures from FACTS only.
- `mentions`: the actor, with their Instagram username only when confident.
- `card` is filled by the page from FACTS; leave it empty.
"""


@dataclass
class Facts:
    actor: str
    page: str
    industry: str
    born: str | None
    awards: int
    films_total: int
    debut_year: int
    latest_year: int
    films_last_decade: int
    with_data: int
    hits: int                       # hit + blockbuster
    blockbusters: int
    average: int
    flops: int
    hit_rate: float | None          # hits / with_data, percent
    avg_multiple: float | None
    biggest_hit: dict | None        # by gross
    best_multiple: dict | None
    worst_multiple: dict | None
    recent_five_avg: float | None
    previous_five_avg: float | None
    total_gross_cr: float
    recent: list[dict] = field(default_factory=list)   # year, title, budget_cr, gross_cr, multiple, verdict
    as_of: str = ""
    photo: dict | None = None       # the actor's lead image on Wikimedia Commons: url, artist, license


def verdict(multiple: float | None) -> str | None:
    if multiple is None:
        return None
    for floor, label in RULE:
        if multiple >= floor:
            return label
    return "Flop"


def gather(actor_title: str) -> Facts | None:
    """Everything the scorecard says, or None when Wikipedia has too little to judge."""
    got = wiki.filmography(actor_title)
    if got is None:
        log.info("no filmography found for %r", actor_title)
        return None
    page, films = got
    films = sorted(films, key=lambda f: f.year)
    this_year = date.today().year
    recent = [f for f in films if f.year >= this_year - RECENT_YEARS and f.year <= this_year and f.page][-MAX_RECENT:]
    rows = []
    for f in recent:
        try:
            budget, gross = wiki.film_money(f.page)
        except Exception as exc:  # noqa: BLE001 - one film page failing is one row without figures
            log.debug("%s: %s", f.page, exc)
            budget, gross = None, None
        multiple = round(gross / budget, 2) if budget and gross and budget > 0 else None
        rows.append({"year": f.year, "title": f.title, "page": f.page, "budget_cr": budget, "gross_cr": gross,
                     "multiple": multiple, "verdict": verdict(multiple)})
    judged = [r for r in rows if r["multiple"] is not None]
    if len(judged) < MIN_WITH_DATA:
        log.info("%r: only %d recent films with budget and gross; not enough for a scorecard", actor_title, len(judged))
        return None
    # the actor's own page title carries the disambiguation ("Vijay (actor)"), which Wikidata needs;
    # the display name drops it
    own_page = actor_title if not actor_title.endswith(" filmography") else actor_title[:-len(" filmography")]
    try:
        who = wiki.person(own_page)
    except Exception as exc:  # noqa: BLE001
        log.debug("wikidata: %s", exc)
        who = wiki.Person(title=own_page)
    display = re.sub(r"\s*\([^)]*\)\s*$", "", own_page).strip() or own_page
    try:
        photo = wiki.lead_image(own_page)
    except Exception as exc:  # noqa: BLE001 - no picture is not no scorecard
        log.debug("lead image: %s", exc)
        photo = None
    counts = {label: sum(1 for r in judged if r["verdict"] == label) for _, label in RULE}
    multiples = [r["multiple"] for r in judged]
    by_gross = max((r for r in rows if r["gross_cr"]), key=lambda r: r["gross_cr"], default=None)
    recent_five, previous_five = judged[-5:], judged[-10:-5]
    return Facts(
        actor=display, page=page, industry="", born=who.born, awards=who.awards,
        films_total=len(films), debut_year=films[0].year, latest_year=max(f.year for f in films if f.year <= this_year),
        films_last_decade=sum(1 for f in films if this_year - 10 <= f.year <= this_year),
        with_data=len(judged), hits=counts["Hit"] + counts["Blockbuster"], blockbusters=counts["Blockbuster"],
        average=counts["Average"], flops=counts["Flop"],
        hit_rate=round(100 * (counts["Hit"] + counts["Blockbuster"]) / len(judged)),
        avg_multiple=round(sum(multiples) / len(multiples), 2),
        biggest_hit=by_gross, best_multiple=max(judged, key=lambda r: r["multiple"]),
        worst_multiple=min(judged, key=lambda r: r["multiple"]),
        recent_five_avg=round(sum(r["multiple"] for r in recent_five) / len(recent_five), 2) if recent_five else None,
        previous_five_avg=round(sum(r["multiple"] for r in previous_five) / len(previous_five), 2) if previous_five else None,
        total_gross_cr=round(sum(r["gross_cr"] for r in rows if r["gross_cr"]), 1),
        recent=rows, as_of=date.today().strftime("%d %B %Y"), photo=photo,
    )


def credit_line(photo: dict) -> str:
    """The attribution a Creative Commons image asks for, short enough for a card's credit."""
    return f"{photo['artist'][:28].rstrip(', ')}, {photo['license']} via Wikimedia Commons"


def photo_html(photo: dict, actor: str, src: str) -> str:
    return (f'<figure class="wp-block-image size-large screenstat-portrait"><img src="{src}" alt="{actor}">'
            f'<figcaption class="wp-element-caption">{actor}. Photo: <a href="{photo["page"]}" rel="nofollow noopener" target="_blank">'
            f'{photo["artist"]}</a>, <a href="{photo["license_url"] or photo["page"]}" rel="nofollow noopener" target="_blank">'
            f'{photo["license"]}</a>, via Wikimedia Commons.</figcaption></figure>')


def fetch_photo(photo: dict, out_dir) -> "Path | None":
    """Download the Commons original for the article and the cards, with the User-Agent Wikimedia asks for."""
    import requests
    from pathlib import Path
    try:
        resp = requests.get(photo["url"], headers=wiki.UA, timeout=30)
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        log.info("photo download failed: %s", exc)
        return None
    ext = ".png" if photo["name"].lower().endswith(".png") else ".jpg"
    out = Path(out_dir) / ("actor-" + re.sub(r"[^a-z0-9]+", "-", photo["name"].lower())[:40].strip("-") + ext)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(resp.content)
    return out


def _cr(v: float | None) -> str:
    return "-" if v is None else (f"₹{v:,.0f} cr" if v >= 10 else f"₹{v:,.1f} cr")


def table_html(f: Facts) -> str:
    """The summary box and the film table, written by the code so the numbers cannot drift."""
    rows = "".join(
        f"<tr><td>{r['year']}</td><td>{r['title']}</td><td>{_cr(r['budget_cr'])}</td><td>{_cr(r['gross_cr'])}</td>"
        f"<td>{'-' if r['multiple'] is None else f'{r[chr(109)+chr(117)+chr(108)+chr(116)+chr(105)+chr(112)+chr(108)+chr(101)]:.2f}x'}</td>"
        f"<td>{r['verdict'] or 'No figures'}</td></tr>"
        for r in reversed(f.recent))
    trend = ""
    if f.recent_five_avg is not None and f.previous_five_avg is not None:
        arrow = "up" if f.recent_five_avg > f.previous_five_avg else "down" if f.recent_five_avg < f.previous_five_avg else "flat"
        trend = f"<li><strong>Trend:</strong> last five films {f.recent_five_avg:.2f}x on average, the five before {f.previous_five_avg:.2f}x ({arrow})</li>"
    born = f"<li><strong>Born:</strong> {f.born}</li>" if f.born else ""
    awards = f"<li><strong>Awards on Wikidata:</strong> {f.awards}</li>" if f.awards else ""
    biggest = (f"<li><strong>Biggest hit:</strong> {f.biggest_hit['title']} ({f.biggest_hit['year']}), {_cr(f.biggest_hit['gross_cr'])}</li>"
               if f.biggest_hit else "")
    return (
        '<div class="screenstat-scorecard"><h2>By the numbers</h2><ul>'
        f"<li><strong>Films:</strong> {f.films_total} since {f.debut_year}; {f.films_last_decade} in the last ten years</li>"
        f"<li><strong>Recent films with figures:</strong> {f.with_data} of {len(f.recent)} since {f.recent[0]['year'] if f.recent else f.latest_year}</li>"
        f"<li><strong>Hits:</strong> {f.hits} ({f.blockbusters} blockbusters), <strong>average:</strong> {f.average}, <strong>flops:</strong> {f.flops} "
        f"- a hit rate of {f.hit_rate:.0f}%</li>"
        f"<li><strong>Average return:</strong> {f.avg_multiple:.2f}x budget; <strong>best:</strong> {f.best_multiple['title']} {f.best_multiple['multiple']:.2f}x; "
        f"<strong>weakest:</strong> {f.worst_multiple['title']} {f.worst_multiple['multiple']:.2f}x</li>"
        f"{biggest}{trend}{born}{awards}</ul></div>"
        '<figure class="wp-block-table"><table><thead><tr><th>Year</th><th>Film</th><th>Budget</th><th>Box office</th><th>Return</th><th>Verdict</th></tr></thead>'
        f"<tbody>{rows}</tbody></table>"
        f"<figcaption>Budget and worldwide box office as listed on each film's English Wikipedia page on {f.as_of}; "
        "figures in crore rupees, dollar figures converted at ₹83. ScreenStat's rule: blockbuster at 2.5x budget or more, "
        "hit at 1.75x, average at 1.25x, flop below. Films without both figures are not judged.</figcaption></figure>"
    )


def card_from(f: Facts) -> CardIdeas:
    takeaways = [f"{f.hits} hits in {f.with_data} recent films with figures",
                 f"Average return {f.avg_multiple:.2f}x budget",
                 f"Biggest hit: {f.biggest_hit['title']}, {_cr(f.biggest_hit['gross_cr'])}" if f.biggest_hit else f"{f.films_total} films since {f.debut_year}"]
    return CardIdeas(stat=f"{f.hit_rate:.0f}%", stat_label=f"of {f.actor}'s recent films were hits",
                     stat_context=f"{f.with_data} films since {f.recent[0]['year']} with budget and box office on record",
                     takeaways=takeaways, left_value=str(f.hits), left_label="hits and blockbusters",
                     right_value=str(f.flops), right_label="flops, by ScreenStat's rule",
                     question=None)


def card_brief(f: Facts, credit: str | None = None) -> CardBrief:
    """The scorecard card: the face, the name, and the record in tiles."""
    record = f"{f.films_total} films since {f.debut_year}"
    return CardBrief("scorecard", f.actor, KICKER, standfirst=f"{record} | {credit}" if credit else record,
                     stat=f"{f.hit_rate:.0f}%", stat_label="hit rate, recent films",
                     left_value=str(f.hits), left_label="hits", right_value=str(f.flops), right_label="flops",
                     term=f"{f.avg_multiple:.2f}x")


def due(settings: Settings, state: State, site: Site) -> bool:
    if not settings.scorecard_hours:
        return False
    log_ = carousels.parse_log(state.note(site.key, NOTE))
    return carousels.due(time.time(), log_, settings.scorecard_hours, settings.timezone)


def parse_used(raw: str | None) -> list[str]:
    return [line.strip() for line in (raw or "").splitlines() if line.strip()]


def pick(rewriter: Rewriter, site: Site, used: list[str], index: int) -> Pick:
    industry = INDUSTRIES[index % len(INDUSTRIES)]
    system = PICK_PROMPT.format(name=site.name, domain=site.domain, niche=site.niche, audience=site.audience,
                                industry=industry, used="\n".join(f"- {u}" for u in used[-150:]) or "- (none yet)")
    system += JSON_CONTRACT.format(schema=json.dumps(PICK_SCHEMA))
    p = rewriter.ask(system, f"Today is {time.strftime('%d %B %Y')}. Name today's {industry} actor.", PICK_SCHEMA,
                     Pick.model_validate, max_tokens=6000)
    p.industry = p.industry or industry
    return p


def write(rewriter: Rewriter, site: Site, facts: Facts, why_now: str) -> CuratedPost:
    schema = schema_for(site)
    schema["properties"]["category"] = {"type": "string", "enum": [CATEGORY]}
    system = FEATURE_PROMPT.format(name=site.name, domain=site.domain, tagline=site.tagline, niche=site.niche,
                                   audience=site.audience, tone=site.tone, category=CATEGORY, kicker=KICKER)
    system += JSON_CONTRACT.format(schema=json.dumps(schema))
    payload = asdict(facts)
    for r in payload["recent"]:
        r.pop("page", None)
    user = (f"ACTOR: {facts.actor}\nWHY NOW: {why_now}\n"
            f"SITE_HASHTAGS (use some in instagram/twitter captions): {' '.join('#' + h for h in site.hashtags)}\n\n"
            f"FACTS (the only figures you may use):\n{json.dumps(payload, ensure_ascii=False, indent=1)}")
    # the facts table is long and the model reasons over it inside the same budget as its answer
    post = rewriter.ask(system, user, schema, CuratedPost.model_validate, max_tokens=32000)
    post.tags = [t.strip() for t in post.tags if t and t.strip()][:8]
    if "scorecard" not in [t.lower() for t in post.tags]:
        post.tags = (post.tags + ["Scorecard"])[:8]
    post.category = CATEGORY
    post.image_kicker = KICKER
    post.card = card_from(facts)
    post.mood = post.mood or "serious"
    post.body_html = table_html(facts) + post.body_html
    post.body_html += (f'<p><em>Figures: <a href="https://en.wikipedia.org/wiki/{facts.page.replace(" ", "_")}" rel="nofollow noopener" target="_blank">'
                       f"{facts.page} on Wikipedia</a> and each film's page, read on {facts.as_of}.</em></p>")
    return post


def publish_daily(site: Site, settings: Settings, state: State, rewriter: Rewriter, wp, publishers, work_dir, report,
                  actor: str | None = None) -> bool:
    """Pick (or take the actor given), gather, claim, write, publish. True when the scorecard went out."""
    from . import pipeline   # local: pipeline imports this module

    used = parse_used(state.note(site.key, USED_NOTE))
    slot_log = carousels.parse_log(state.note(site.key, NOTE))
    facts = choice = url = None
    tried = list(used)
    for attempt in range(ATTEMPTS if actor is None else 1):
        if actor is not None:
            choice = Pick(actor=actor, why_now="requested by hand")
        else:
            choice = pick(rewriter, site, tried, len(slot_log) + attempt)
        if any(choice.actor.lower() == u.lower() for u in used):
            log.info("[%s] %r already has a scorecard; asking again", site.key, choice.actor)
            tried.append(choice.actor)
            continue
        facts = gather(choice.actor)
        if facts is None:
            tried.append(f"{choice.actor} (not enough figures on Wikipedia)")
            continue
        url = f"https://en.wikipedia.org/wiki/{facts.page.replace(' ', '_')}"
        if not state.claim(url, site.key, f"Scorecard: {facts.actor}"):
            tried.append(choice.actor)
            facts = None
            continue
        break
    if facts is None:
        log.warning("[%s] no scorecard this slot: no actor with enough figures", site.key)
        return False
    facts.industry = choice.industry
    log.info("[%s] scorecard: %s, %d films, %d with figures, hit rate %.0f%%", site.key, facts.actor, facts.films_total,
             facts.with_data, facts.hit_rate)
    try:
        post = write(rewriter, site, facts, choice.why_now)
    except Exception as exc:  # noqa: BLE001
        state.release(url, site.key)
        raise RuntimeError(f"scorecard could not be written: {exc}") from exc
    # the actor's picture: in the article with its credit, and as the photo behind the cards
    image_url = credit = None
    if facts.photo:
        local = fetch_photo(facts.photo, work_dir / site.slug)
        if local is not None:
            try:
                media = wp.upload_media(local, f"{facts.actor} (photo)", alt_text=facts.actor,
                                        caption=f"Photo: {facts.photo['artist']}, {facts.photo['license']}, via Wikimedia Commons")
                post.body_html = photo_html(facts.photo, facts.actor, media["source_url"]) + post.body_html
                image_url, credit = media["source_url"], credit_line(facts.photo)
            except Exception as exc:  # noqa: BLE001
                log.warning("[%s] photo upload failed: %s", site.key, exc)
    ok = pipeline.publish_post(site, settings, state, url, post, wp, publishers, work_dir, report,
                               image_url=image_url, credit=credit, use_source_image=image_url is not None,
                               card_brief=card_brief(facts, credit))
    if ok:
        state.set_note(site.key, USED_NOTE, "\n".join((used + [facts.actor])[-500:]))
        state.set_note(site.key, NOTE, carousels.dump_log(slot_log + [time.time()]))
    return ok
