"""Which articles go out as a carousel, and what a carousel is made of.

A single card carries a headline; a carousel carries the article. Twice a day each site's
Instagram post becomes one: the 4:5 card as the cover, then four to eight content slides written
by the rewriter (`carousel_slides`: context, what happened, the figures, why it matters, what to
do, the outlook), then a closing slide with the site and the way there. The same slides go to the
Facebook Page as a multi-photo post.

Which two: `settings.carousel_hours` names hours of the day in `settings.timezone`; the first
article a site publishes at or after each of those hours is the carousel for that slot. A slot is
remembered per site in `site_notes` once a carousel actually went out, so a failed carousel (or an
article whose source was too thin for one) leaves the slot open for the next article rather than
losing the day's carousel to bad luck.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

MIN_SLIDES = 4          # content slides a carousel needs to be worth a swipe; fewer and the single card is better
MAX_SLIDES = 8          # cover + 8 + closing = Instagram's ceiling of 10 children
NOTE = "carousels"      # site_notes key holding the timestamps of the last carousels posted
KEEP = 12               # how many timestamps the note keeps


class CarouselSlide(BaseModel):
    """One content slide: a heading and a short body, both plain text, both from the source."""
    heading: str = Field(max_length=70)
    body: str = Field(max_length=320)


CAROUSEL_SCHEMA = {
    "type": "array",
    "description": (
        "The article told in depth as an Instagram carousel, 5 to 8 slides. The cover and the closing slide are "
        "made automatically; give only the content slides, in reading order: the background a reader needs, what "
        "happened in detail, the key figures, who it affects and why it matters for our audience, an example or an "
        "expert view from the source, what to do about it, and the outlook. Every fact, name and number must come "
        "from the source. Plain text only: no hashtags, no URLs, no emoji, no markdown, no slide numbers."
    ),
    "items": {
        "type": "object",
        "additionalProperties": False,
        "required": ["heading", "body"],
        "properties": {
            "heading": {"type": "string", "description": "Max 60 characters, a complete thought, sentence case"},
            "body": {"type": "string", "description": "2 to 3 sentences, 180 to 280 characters, specific and factual"},
        },
    },
}

CAROUSEL_PROMPT = (
    "- `carousel_slides` tells the article in depth for a swipe-through carousel, 5 to 8 content slides in reading "
    "order: background, what happened, the figures, who it affects and why it matters, an example or expert view, "
    "what to do, the outlook. Each slide is a heading and 2-3 plain sentences that stand on their own. This is the "
    "whole article a viewer who never leaves Instagram gets, so carry the substance and the specifics.\n"
)


def slot(now: float, hours: list[int], tz: str) -> tuple[str, int] | None:
    """The carousel slot `now` falls in: (local date, hour) of the most recent listed hour.

    Before the day's first listed hour the slot is yesterday's last one, so the day boundary never
    manufactures an extra carousel."""
    hours = sorted({int(h) % 24 for h in hours})
    if not hours:
        return None
    local = datetime.fromtimestamp(now, ZoneInfo(tz))
    passed = [h for h in hours if h <= local.hour]
    if passed:
        return local.strftime("%Y-%m-%d"), passed[-1]
    return (local - timedelta(days=1)).strftime("%Y-%m-%d"), hours[-1]


def due(now: float, log: list[float], hours: list[int], tz: str) -> bool:
    """True when the current slot has not had its carousel yet."""
    current = slot(now, hours, tz)
    return current is not None and all(slot(t, hours, tz) != current for t in log)


def parse_log(raw: str | None) -> list[float]:
    out = []
    for part in (raw or "").split(","):
        try:
            out.append(float(part))
        except ValueError:
            continue
    return out


def dump_log(log: list[float]) -> str:
    return ",".join(f"{t:.0f}" for t in log[-KEEP:])


def _clean(text: str, limit: int) -> str:
    return " ".join((text or "").split()).strip().strip('"“”')[:limit].strip()


def usable(slides: list[CarouselSlide]) -> list[tuple[str, str]]:
    """The slides worth drawing: heading and body both present, no repeats, at most MAX_SLIDES."""
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for s in slides:
        heading, body = _clean(s.heading, 70), _clean(s.body, 320)
        if len(heading) < 3 or len(body) < 40 or heading.lower() in seen:
            continue
        seen.add(heading.lower())
        out.append((heading, body))
    return out[:MAX_SLIDES]


def has_material(slides: list[CarouselSlide]) -> bool:
    return len(usable(slides)) >= MIN_SLIDES


SAMPLE_SLIDES = [
    CarouselSlide(heading="Retail media is now the fastest-growing ad channel",
                  body="Spend on retailer-owned ad inventory grew 21% last year, ahead of search and social. Brands are paying for reach that sits one tap from the checkout."),
    CarouselSlide(heading="What changed in the last twelve months",
                  body="Three of India's five largest retailers opened self-serve ad platforms. Blinkit, Zepto and Flipkart now sell sponsored placements the way Amazon has since 2018."),
    CarouselSlide(heading="The numbers behind the shift",
                  body="Retail media took Rs 5,200 crore in 2025, up from Rs 3,100 crore. Closed-loop attribution, not price, is what buyers say moved the budget."),
    CarouselSlide(heading="Why it matters for brand teams",
                  body="Shelf and screen have merged. A brand that is not visible inside the retailer's app loses the sale to whoever paid for the slot above it."),
    CarouselSlide(heading="What the buyers are doing about it",
                  body="Hindustan Unilever has moved a tenth of its digital budget to retailer platforms and now measures campaigns on incremental units sold, not impressions."),
    CarouselSlide(heading="What to do this quarter",
                  body="Audit where your category is bought online, test one retailer platform with a clear sales baseline, and negotiate first-party data access before committing the budget."),
]
