"""ScreenStat's Buzz Meter: a daily ranked digest of the films, shows and celebs generating the most
hype right now, tracked from before release through `settings.buzz_meter_retire_days` after it.

Every score comes from data, never the model's impression: TMDB's own popularity index, a trailer's
YouTube view count (day over day), Wikipedia's daily reader count, and how many of today's news
candidates mention the subject. The model is handed each subject's score, movement and release
timing as FACTS and writes the colour around them; it does not invent or rank anything.

Intake: each slot, `discover_candidates` pulls upcoming and trending films, shows and people from
TMDB; a candidate joins the meter once its first reading clears `ENTRY_FLOOR` and there is room
under `settings.buzz_meter_max_tracked`. A subject with a release date drops off
`buzz_meter_retire_days` days after release; a dateless one (a celeb, or a title TMDB lists no date
for) drops off once its score has stayed under `RETIRE_FLOOR` for `RETIRE_STREAK` straight days.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from . import carousels, sources, tmdb, wiki, youtube
from .config import Settings, Site
from .rewrite import JSON_CONTRACT, CuratedPost, Rewriter, schema_for
from .state import State

log = logging.getLogger(__name__)

NOTE = "buzz_meter"          # site_notes key: when this site's last digest went out
CATEGORY = "Buzz Meter"
KICKER = "Buzz Meter"
ENTRY_FLOOR = 15.0           # a candidate needs at least this score to join the meter
RETIRE_FLOOR = 10.0          # a dateless subject below this score for RETIRE_STREAK days retires
RETIRE_STREAK = 3
WEIGHTS = {"popularity": 0.35, "views": 0.30, "mentions": 0.20, "pageviews": 0.15}
LABELS = {"movie": "film", "tv": "show", "person": "celeb"}   # tmdb kind -> the word the reader sees


def _clamp(x: float) -> float:
    return max(0.0, min(100.0, x))


def popularity_score(popularity: float) -> float:
    """TMDB's popularity index, scaled so a genuinely buzzy title sits near the top of the range."""
    return _clamp(popularity / 5)


def view_score(views: int | None, previous: int | None) -> float | None:
    """How fast a trailer's view count is moving: a first reading is scaled on its raw size, a later
    one on its overnight growth, so a spike counts for more than a big but static number."""
    if not views:
        return None
    if not previous:
        return _clamp(views / 100_000)
    growth = (views - previous) / max(previous, 1)
    return _clamp(50 + growth * 200)


def pageview_score(views: int | None, previous: int | None) -> float | None:
    """Wikipedia's daily reader count, scored the same way."""
    if views is None:
        return None
    if not previous:
        return _clamp(views / 2000)
    growth = (views - previous) / max(previous, 1)
    return _clamp(50 + growth * 100)


def mention_score(count: int) -> float:
    return _clamp(count * 10)


def composite(breakdown: dict[str, float | None]) -> float:
    """The weighted score across whatever signals came back; a signal that is missing (no trailer
    found, a pageviews lookup that failed) is left out and the rest reweighted, never zeroed."""
    have = {k: v for k, v in breakdown.items() if v is not None}
    if not have:
        return 0.0
    total_weight = sum(WEIGHTS[k] for k in have)
    return round(sum(have[k] * WEIGHTS[k] for k in have) / total_weight, 1)


def movement(previous: float | None, score: float) -> str:
    if previous is None:
        return "new"
    if score - previous >= 2:
        return "up"
    if previous - score >= 2:
        return "down"
    return "steady"


def subject_id(kind: str, tmdb_id: int) -> str:
    return f"tmdb:{kind}:{tmdb_id}"


def _today(tz: str) -> str:
    return datetime.now(ZoneInfo(tz)).strftime("%Y-%m-%d")


def _days_label(release_date: str | None, today: str) -> str:
    if not release_date:
        return ""
    try:
        released = date.fromisoformat(release_date)
    except ValueError:
        return ""
    delta = (released - date.fromisoformat(today)).days
    if delta > 0:
        return f"in {delta} day{'s' if delta != 1 else ''}"
    if delta == 0:
        return "out today"
    ago = -delta
    return f"{ago} day{'s' if ago != 1 else ''} since release"


@dataclass
class Reading:
    subject_id: str
    kind: str          # movie | tv | person
    tmdb_id: int
    title: str
    release_date: str | None
    score: float
    breakdown: dict
    movement: str
    raw: dict


def gather_reading(kind: str, tmdb_id: int, title: str, release_date: str | None, settings: Settings,
                   previous_raw: dict, mention_pool: list[str], timeout: int) -> tuple[dict, dict, str | None, str]:
    """One subject's signals today: the breakdown, the raw inputs to diff against tomorrow, and the
    title and release date refreshed from TMDB (a pre-release date can firm up or move)."""
    breakdown: dict[str, float | None] = {}
    raw: dict = {}
    info = tmdb.detail(kind, tmdb_id, timeout)
    if info:
        breakdown["popularity"] = popularity_score(info["popularity"])
        release_date = info.get("release_date") or release_date
        title = info.get("title") or title
    if kind in ("movie", "tv"):
        trailer = youtube.find_trailer(title, year=(release_date or "")[:4] or None, timeout=timeout)
        views = trailer.get("views") if trailer else None
        breakdown["views"] = view_score(views, previous_raw.get("views"))
        raw["views"] = views if views is not None else previous_raw.get("views")
    pv = wiki.pageviews(title, timeout=timeout)
    breakdown["pageviews"] = pageview_score(pv, previous_raw.get("pageviews"))
    raw["pageviews"] = pv if pv is not None else previous_raw.get("pageviews")
    breakdown["mentions"] = mention_score(sum(1 for t in mention_pool if title.lower() in t.lower()))
    return breakdown, raw, release_date, title


def discover_candidates(settings: Settings, timeout: int) -> list[dict]:
    """Fresh subjects worth a look: upcoming and trending films, shows and people from TMDB."""
    seen: dict[tuple[str, int], dict] = {}
    for hit in (tmdb.upcoming("movie", timeout=timeout) + tmdb.upcoming("tv", timeout=timeout)
                + tmdb.trending("movie", timeout=timeout) + tmdb.trending("tv", timeout=timeout)
                + tmdb.trending_people(timeout=timeout)):
        if not hit.get("id"):
            continue
        key = (hit["kind"], hit["id"])
        if key not in seen:
            seen[key] = hit
    return list(seen.values())


def _mention_pool(site: Site, settings: Settings) -> list[str]:
    """Today's news candidate titles and summaries, for counting how many mention a subject."""
    try:
        cands = sources.collect(site, timeout=settings.request_timeout)
    except Exception as exc:  # noqa: BLE001 - a feed hiccup must not cost the whole digest
        log.warning("[%s] buzz meter: could not read news candidates for mentions: %s", site.key, exc)
        return []
    return [f"{c.title} {c.summary}" for c in cands]


def refresh_subject(state: State, row, today: str, settings: Settings, pool: list[str]) -> Reading:
    """Today's reading for one already-tracked subject."""
    kind, tmdb_id = row["kind"], int(row["id"].rsplit(":", 1)[1])
    raw = json.loads(row["raw"] or "{}")
    breakdown, raw, release_date, title = gather_reading(kind, tmdb_id, row["title"], row["release_date"],
                                                         settings, raw, pool, settings.request_timeout)
    if (title, release_date) != (row["title"], row["release_date"]):
        state.buzz_update_release(row["id"], title, release_date)
    score = composite(breakdown)
    prev = state.buzz_last_reading(row["id"], before=today)
    state.buzz_record_reading(row["id"], today, score, json.dumps(breakdown))
    state.buzz_set_raw(row["id"], json.dumps(raw))
    return Reading(row["id"], kind, tmdb_id, title, release_date, score, breakdown,
                   movement(prev["score"] if prev else None, score), raw)


def _should_retire(reading: Reading, today: str, settings: Settings, state: State) -> bool:
    if reading.release_date:
        try:
            released = date.fromisoformat(reading.release_date)
        except ValueError:
            return False
        return (date.fromisoformat(today) - released).days > settings.buzz_meter_retire_days
    recent = state.buzz_recent_scores(reading.subject_id, RETIRE_STREAK)
    return len(recent) >= RETIRE_STREAK and all(s < RETIRE_FLOOR for s in recent)


def intake(site: Site, settings: Settings, state: State, active_ids: set[str], today: str, pool: list[str]) -> list[Reading]:
    """New subjects that clear the entry floor today, enough to fill the meter up to its cap."""
    room = settings.buzz_meter_max_tracked - len(active_ids)
    if room <= 0:
        return []
    added: list[Reading] = []
    for hit in discover_candidates(settings, settings.request_timeout):
        if room <= 0:
            break
        sid = subject_id(hit["kind"], hit["id"])
        if sid in active_ids:
            continue
        existing = state.buzz_subject(sid)
        if existing and existing["status"] == "retired":
            continue     # a subject that has run its course does not immediately return
        breakdown, raw, release_date, title = gather_reading(hit["kind"], hit["id"], hit["title"], hit.get("release_date"),
                                                             settings, {}, pool, settings.request_timeout)
        score = composite(breakdown)
        if score < ENTRY_FLOOR:
            continue
        state.buzz_upsert_subject(sid, site.key, hit["kind"], title, release_date)
        state.buzz_record_reading(sid, today, score, json.dumps(breakdown))
        state.buzz_set_raw(sid, json.dumps(raw))
        added.append(Reading(sid, hit["kind"], hit["id"], title, release_date, score, breakdown, "new", raw))
        active_ids.add(sid)
        room -= 1
    return added


def table_html(entries: list[Reading], today: str) -> str:
    """The ranked table the code writes, so the score and the order cannot drift from the model's prose."""
    from html import escape

    def _row(i: int, r: Reading) -> str:
        release = escape(_days_label(r.release_date, today)) or "—"
        return (f'<tr><td>{i}</td><td><strong>{escape(r.title)}</strong> <span class="screenstat-buzz-kind">({LABELS[r.kind]})</span></td>'
               f"<td>{r.score:.0f}</td><td>{r.movement}</td><td>{release}</td></tr>")

    rows = "".join(_row(i, r) for i, r in enumerate(entries, 1))
    return (
        '<div class="screenstat-buzz-meter"><figure class="wp-block-table"><table>'
        "<thead><tr><th>#</th><th>Title</th><th>Buzz score</th><th>vs yesterday</th><th>Release</th></tr></thead>"
        f"<tbody>{rows}</tbody></table>"
        f'<figcaption class="wp-element-caption">Buzz Meter, {today}: score out of 100 from TMDB popularity, trailer '
        "view growth, Wikipedia readership and today's news mentions.</figcaption></figure></div>"
    )


WRITE_PROMPT = """You are the data editor of {name} ({domain}). Beat: {niche} Audience: {audience} Voice: {tone}

Write today's BUZZ METER: a ranked look at the {n} films, shows and celebs generating the most hype right
now, from pre-release anticipation to how a release is holding up. You are given each subject's score,
movement against yesterday and release timing as FACTS.
- Use ONLY the figures in FACTS. Do not add, guess or round a score, a rank or a release date.
- The ranked table is inserted above your text by the page; do not reproduce it. Refer to it ("in the
  table above").
- Open with two or three sentences on today's biggest mover. Then one short paragraph per subject, in
  rank order, saying what its movement means for it.
- Never invent a reason a score moved that FACTS does not support; say "gaining ground" or "holding
  steady" rather than naming a cause (a trailer, a scandal, a review) you cannot see in the numbers.
- 350-550 words. Never mention that you are an AI.
- `category` must be "{category}". `image_kicker` must be "{kicker}". `image_headline` names today's
  top subject and its score, e.g. "Buzz Meter: [Title] leads at 82".
- Captions must be platform-native and must not include any URL.
- `mentions`: any celeb subjects among today's entries, with their Instagram username only when confident.
"""


def write(rewriter: Rewriter, site: Site, entries: list[Reading], today: str) -> CuratedPost:
    schema = schema_for(site, carousel=True)
    schema["properties"]["category"] = {"type": "string", "enum": [CATEGORY]}
    system = WRITE_PROMPT.format(name=site.name, domain=site.domain, niche=site.niche, audience=site.audience,
                                 tone=site.tone, n=len(entries), category=CATEGORY, kicker=KICKER)
    system += JSON_CONTRACT.format(schema=json.dumps(schema))
    facts = [{"rank": i, "title": r.title, "kind": LABELS[r.kind], "score": r.score, "movement": r.movement,
             "release": _days_label(r.release_date, today), "signals": {k: v for k, v in r.breakdown.items() if v is not None}}
            for i, r in enumerate(entries, 1)]
    user = (f"DATE: {today}\nSITE_HASHTAGS (use some in instagram/twitter captions): {' '.join('#' + h for h in site.hashtags)}\n\n"
            f"FACTS (the only scores, ranks and figures you may use):\n{json.dumps(facts, ensure_ascii=False, indent=1)}")
    post = rewriter.ask(system, user, schema, CuratedPost.model_validate, max_tokens=16000)
    post.category = CATEGORY
    post.image_kicker = KICKER
    post.tags = ([t.strip() for t in post.tags if t and t.strip()] + ["Buzz Meter"])[:8]
    post.hook = post.hook or f"Buzz Meter: {entries[0].title} leads"
    _VERB = {"up": "Rising", "down": "Cooling", "steady": "Holding steady", "new": "New on the meter"}
    slides = [
        carousels.CarouselSlide(
            heading=f"#{i} {r.title} ({r.score:.0f})",
            body=_VERB[r.movement] + (f" - {_days_label(r.release_date, today)}." if _days_label(r.release_date, today) else "."),
        )
        for i, r in enumerate(entries, 1)
    ]
    if len(post.carousel_slides) != len(entries):
        post.carousel_slides = slides
    post.body_html = table_html(entries, today) + post.body_html
    return post


def stills(entries: list[Reading], timeout: int) -> tuple[dict[int, str], str | None]:
    """TMDB stills for the slides (1-based index -> URL) and a backdrop for the cover."""
    photos: dict[int, str] = {}
    cover: str | None = None
    for i, r in enumerate(entries, 1):
        if r.kind == "person":
            shot = tmdb.person_still(r.title, timeout)
            url = shot["url"] if shot else None
        else:
            hit = tmdb.find(r.title, (r.release_date or "")[:4] or None, timeout)
            url = hit.get("backdrop") if hit else None
            if cover is None and url:
                cover = url
        if url:
            photos[i] = url
    return photos, cover


def due(settings: Settings, state: State, site: Site) -> bool:
    if not settings.buzz_meter_hours:
        return False
    log_ = carousels.parse_log(state.note(site.key, NOTE))
    return carousels.due(time.time(), log_, settings.buzz_meter_hours, settings.timezone)


def publish_daily(site: Site, settings: Settings, state: State, rewriter: Rewriter, wp, publishers, work_dir,
                  report) -> bool:
    """Refresh every tracked subject, retire spent ones, bring in new ones, publish today's digest."""
    from . import pipeline   # local: pipeline imports this module

    today = _today(settings.timezone)
    slot_log = carousels.parse_log(state.note(site.key, NOTE))
    pool = _mention_pool(site, settings)
    readings: list[Reading] = []
    for row in state.buzz_active(site.key):
        r = refresh_subject(state, row, today, settings, pool)
        if _should_retire(r, today, settings, state):
            state.buzz_retire(r.subject_id)
            log.info("[%s] buzz meter: retiring %s (%s)", site.key, r.title, _days_label(r.release_date, today) or "no release date")
            continue
        readings.append(r)
    readings += intake(site, settings, state, {r.subject_id for r in readings}, today, pool)
    if not readings:
        log.warning("[%s] no buzz meter this slot: nothing tracked, and nothing new cleared the entry floor", site.key)
        return False
    readings.sort(key=lambda r: r.score, reverse=True)
    entries = readings[: settings.buzz_meter_max_tracked]
    url = f"https://{site.domain}/buzz-meter/{today}"
    if not state.claim(url, site.key, f"Buzz Meter: {today}"):
        log.info("[%s] buzz meter for %s already published", site.key, today)
        return False
    try:
        post = write(rewriter, site, entries, today)
    except Exception as exc:  # noqa: BLE001
        state.release(url, site.key)
        raise RuntimeError(f"buzz meter could not be written: {exc}") from exc
    photos, cover = stills(entries, settings.request_timeout)
    ok = pipeline.publish_post(site, settings, state, url, post, wp, publishers, work_dir, report,
                               image_url=cover, credit="TMDB" if cover else None, use_source_image=cover is not None,
                               want_carousel=True, slide_photos=photos)
    if ok:
        state.set_note(site.key, NOTE, carousels.dump_log(slot_log + [time.time()]))
    return ok
