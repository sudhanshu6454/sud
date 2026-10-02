"""Which shape the Instagram card takes for a given article.

One template drawn the same way every time gives a grid recognition, but a grid of thirty
headline cards is a wall of headlines. This module mixes a small family of formats without
letting the brand drift: every format is drawn by images.py in the same palette, typeface,
footer, kicker and section rail, and inside the same safe bands. Only the middle of the card
changes.

What a card can say depends on what the article actually contains. The rewriter fills
`CuratedPost.card` with material it found in the source - a verbatim quote, a striking
number, three takeaways, the question the piece answers - and leaves out what is not there.
`choose()` then picks a format the material supports, steering away from the formats this
site used most recently, so consecutive posts differ and nothing is ever invented to fill a
template.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

HEADLINE, QUOTE, STAT, LIST, QUESTION = "headline", "quote", "stat", "list", "question"
INVERSE, POSTER, VERSUS, TERM, CHECKLIST = "inverse", "poster", "versus", "term", "checklist"
FORMATS = (HEADLINE, QUOTE, STAT, LIST, QUESTION, INVERSE, POSTER, VERSUS, TERM, CHECKLIST)
HISTORY = 2            # how many recent formats the log line shows; the chooser itself is least-recently-used
# what each format is called on the card, in the kicker chip, when the article's own kicker is
# not more specific. Headline cards keep the article's section label.
KICKERS = {QUOTE: "In their words", STAT: "By the numbers", LIST: "Takeaways", QUESTION: "The question",
           VERSUS: "Side by side", TERM: "The term", CHECKLIST: "Do and don't"}


class CardIdeas(BaseModel):
    """Material for the share image, all optional, all taken from the source and never invented."""
    quote: str | None = Field(default=None, max_length=160)
    quote_by: str | None = Field(default=None, max_length=80)
    stat: str | None = Field(default=None, max_length=24)
    stat_label: str | None = Field(default=None, max_length=70)
    stat_context: str | None = Field(default=None, max_length=140)
    takeaways: list[str] = Field(default_factory=list)
    question: str | None = Field(default=None, max_length=110)
    left_value: str | None = Field(default=None, max_length=24)
    left_label: str | None = Field(default=None, max_length=60)
    right_value: str | None = Field(default=None, max_length=24)
    right_label: str | None = Field(default=None, max_length=60)
    term: str | None = Field(default=None, max_length=40)
    definition: str | None = Field(default=None, max_length=220)
    dos: list[str] = Field(default_factory=list)
    donts: list[str] = Field(default_factory=list)


CARD_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "description": "Material for the share image. Fill ONLY what the source genuinely contains; omit the rest. Never invent.",
    "properties": {
        "quote": {"type": "string", "description": "A verbatim quotation from the source, max 140 characters, no surrounding quote marks. Omit if the source has no quotable line."},
        "quote_by": {"type": "string", "description": "Who said it: name and role, or the publication. Required when quote is present."},
        "stat": {"type": "string", "description": "The single most striking figure exactly as the source gives it, max 14 characters, e.g. '72%', '₹350 cr', '2.4M': the same figure the title gives, and the latest one when the source updates a running total. Omit if there is no meaningful number."},
        "stat_label": {"type": "string", "description": "What the figure measures, max 60 characters, sentence case. Required when stat is present."},
        "stat_context": {"type": "string", "description": "One line of context for the figure, max 120 characters. Optional."},
        "takeaways": {"type": "array", "items": {"type": "string"}, "description": "Exactly three takeaways, each max 70 characters, no trailing full stop, or an empty array."},
        "question": {"type": "string", "description": "The genuine question this article answers, phrased for a reader, max 90 characters, ending with '?'. Omit if it would be contrived."},
        "left_value": {"type": "string", "description": "For a genuine two-way comparison in the source (before/after, this year/last year, brand A/brand B): the first figure or short phrase, max 14 characters. Omit unless the source compares two things directly."},
        "left_label": {"type": "string", "description": "What the first value is, max 40 characters. Required with left_value."},
        "right_value": {"type": "string", "description": "The second figure or short phrase, max 14 characters. Required with left_value."},
        "right_label": {"type": "string", "description": "What the second value is, max 40 characters. Required with right_value."},
        "term": {"type": "string", "description": "A concept the article turns on and explains, as a name of 1-4 words (e.g. 'Anchoring bias', 'Retail media'). Omit if the piece explains no concept."},
        "definition": {"type": "string", "description": "That concept in one plain sentence of max 180 characters, in your own words. Required with term."},
        "dos": {"type": "array", "items": {"type": "string"}, "description": "Two or three things the article says to do, each max 60 characters, imperative, or an empty array. Only when the piece genuinely gives practical advice."},
        "donts": {"type": "array", "items": {"type": "string"}, "description": "Two or three things the article says not to do, each max 60 characters, or an empty array. Required with dos."},
    },
}


@dataclass
class CardBrief:
    """Everything the renderer needs for one card, independent of how it was chosen."""
    kind: str
    headline: str
    kicker: str
    standfirst: str | None = None
    quote: str | None = None
    quote_by: str | None = None
    stat: str | None = None
    stat_label: str | None = None
    stat_context: str | None = None
    items: list[str] = field(default_factory=list)
    question: str | None = None
    left_value: str | None = None
    left_label: str | None = None
    right_value: str | None = None
    right_label: str | None = None
    term: str | None = None
    definition: str | None = None
    dos: list[str] = field(default_factory=list)
    donts: list[str] = field(default_factory=list)


def _clean(text: str | None, limit: int) -> str | None:
    text = " ".join((text or "").split()).strip().strip('"“”\'‘’')
    return text[:limit].strip() or None


def _items(raw: list[str], limit: int) -> list[str]:
    return [t for t in (_clean(t, limit) for t in raw) if t]


def supported(ideas: CardIdeas | None, photo: bool = False) -> list[str]:
    """The formats this article's material can honestly fill.

    Headline and inverse always can: they need nothing but the headline, which is what keeps the
    grid mixing even when a story offers no quote, figure or list. Poster needs a usable photo.
    """
    out = [HEADLINE, INVERSE]
    if photo:
        out.append(POSTER)
    if ideas is None:
        return out
    if _clean(ideas.quote, 160) and _clean(ideas.quote_by, 80):
        out.append(QUOTE)
    if _clean(ideas.stat, 24) and _clean(ideas.stat_label, 70):
        out.append(STAT)
    if len(_items(ideas.takeaways, 90)) >= 3:
        out.append(LIST)
    q = _clean(ideas.question, 110)
    if q and q.endswith("?") and len(q) >= 12:
        out.append(QUESTION)
    if all(_clean(v, 60) for v in (ideas.left_value, ideas.left_label, ideas.right_value, ideas.right_label)):
        out.append(VERSUS)
    if _clean(ideas.term, 40) and _clean(ideas.definition, 220):
        out.append(TERM)
    if len(_items(ideas.dos, 70)) >= 2 and len(_items(ideas.donts, 70)) >= 2:
        out.append(CHECKLIST)
    return out


# among never-used formats, the more striking first; the two that need no material come last so a
# site opens with something the story itself supplied
PREFERENCE = (QUOTE, STAT, VERSUS, TERM, LIST, CHECKLIST, QUESTION, POSTER, INVERSE, HEADLINE)


def choose(kind_history: list[str], ideas: CardIdeas | None, photo: bool = False) -> str:
    """Pick the format this article's material supports that the site has used least recently.

    Least-recently-used is what makes the grid mix: with full material the five formats come round
    in turn, and a format the feeds rarely support (a quotable line, say) is taken the moment it is
    available because it is the one used longest ago. Among formats never used yet, the more
    striking card wins, so a new site opens with a quote or a number rather than a headline. A site
    whose material only ever fills headline cards keeps posting headline cards: variety never costs
    a post, and nothing is invented to fill a template.
    """
    can = supported(ideas, photo)

    def last_seen(kind: str) -> int:
        return max((i for i, h in enumerate(kind_history) if h == kind), default=-1)

    return min(can, key=lambda k: (last_seen(k), PREFERENCE.index(k)))


def brief(kind: str, ideas: CardIdeas | None, headline: str, kicker: str, standfirst: str | None) -> CardBrief:
    """Assemble the renderer's input for `kind` from the article's material."""
    ideas = ideas or CardIdeas()
    label = kicker or KICKERS.get(kind, "")
    if kind == QUOTE:
        return CardBrief(kind, headline, label, standfirst,
                         quote=_clean(ideas.quote, 160), quote_by=_clean(ideas.quote_by, 80))
    if kind == STAT:
        return CardBrief(kind, headline, label, standfirst,
                         stat=_clean(ideas.stat, 24), stat_label=_clean(ideas.stat_label, 70),
                         stat_context=_clean(ideas.stat_context, 140))
    if kind == LIST:
        return CardBrief(kind, headline, label, standfirst, items=_items(ideas.takeaways, 90)[:3])
    if kind == QUESTION:
        return CardBrief(kind, headline, label, standfirst, question=_clean(ideas.question, 110))
    if kind == VERSUS:
        return CardBrief(kind, headline, label, standfirst,
                         left_value=_clean(ideas.left_value, 24), left_label=_clean(ideas.left_label, 60),
                         right_value=_clean(ideas.right_value, 24), right_label=_clean(ideas.right_label, 60))
    if kind == TERM:
        return CardBrief(kind, headline, label, standfirst,
                         term=_clean(ideas.term, 40), definition=_clean(ideas.definition, 220))
    if kind == CHECKLIST:
        return CardBrief(kind, headline, label, standfirst, dos=_items(ideas.dos, 70)[:3], donts=_items(ideas.donts, 70)[:3])
    # headline, inverse and poster all set the headline itself, under the article's own section label
    return CardBrief(kind if kind in (INVERSE, POSTER) else HEADLINE, headline, kicker, standfirst)


# A figure is a number that makes a claim: it carries a currency or a magnitude. Bare numbers (day 1,
# 4 PM, 2026, the 3 in Drishyam 3) are not figures and are never checked.
_FIGURE = re.compile(
    r"(?P<cur>₹|\brs\.?|\binr|us\$|\$|€|£)?\s*"
    r"(?P<num>\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"(?:\s*(?P<unit>%|per\s?cent\b|crores?\b|cr\b|lakhs?\b|lacs?\b|millions?\b|mn\b|billions?\b|bn\b|thousand\b|k\b|m\b))?",
    re.IGNORECASE)
_SCALE = {"crore": 1e7, "crores": 1e7, "cr": 1e7, "lakh": 1e5, "lakhs": 1e5, "lac": 1e5, "lacs": 1e5,
          "million": 1e6, "millions": 1e6, "mn": 1e6, "m": 1e6, "billion": 1e9, "billions": 1e9, "bn": 1e9,
          "thousand": 1e3, "k": 1e3}


def figures(text: str | None) -> list[tuple[str, float]]:
    """The figures in `text`, normalised so '₹36.70 crore', 'Rs. 36.7 cr' and '₹367 million' are one figure."""
    out = []
    for m in _FIGURE.finditer(text or ""):
        unit = (m.group("unit") or "").lower().replace(" ", "")
        if not m.group("cur") and not unit:
            continue
        value = float(m.group("num").replace(",", ""))
        if unit in ("%", "percent"):
            out.append(("pct", value))
        else:
            out.append(("amt", value * _SCALE.get(unit, 1.0)))
    return out


def reference_figures(title: str, body_html: str = "") -> list[tuple[str, float]]:
    """What a card's figures must agree with: the title's, or when the title has none, the article's."""
    return figures(title) or figures(re.sub(r"<[^>]+>", " ", body_html or ""))


def _known(fig: tuple[str, float], reference: list[tuple[str, float]]) -> bool:
    kind, value = fig
    return any(k == kind and abs(v - value) <= 0.005 * max(abs(v), abs(value), 1e-9) for k, v in reference)


def stray(text: str | None, reference: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """The figures in `text` the reference does not contain."""
    return [f for f in figures(text) if not _known(f, reference)]


def drop_stray_figures(post, reference: list[tuple[str, float]]) -> list[str]:
    """Take off the card any figure the headline does not carry, so a data card never contradicts its own title.

    The post still goes out: a stray stat or comparison leaves the material (the chooser picks another
    format), a stray hook is dropped, a stray card headline gives way to the title. Returns what was dropped."""
    dropped = []
    ideas = post.card
    if ideas is not None:
        if ideas.stat and stray(ideas.stat, reference):
            dropped.append(f"stat {ideas.stat!r}")
            ideas.stat = ideas.stat_label = ideas.stat_context = None
        sides = [v for v in (ideas.left_value, ideas.right_value) if v]
        # a comparison sets the headline's figure against another, so one side matching is enough
        if sides and any(figures(v) for v in sides) and all(stray(v, reference) or not figures(v) for v in sides):
            dropped.append(f"comparison {ideas.left_value!r} vs {ideas.right_value!r}")
            ideas.left_value = ideas.left_label = ideas.right_value = ideas.right_label = None
    if post.hook and stray(post.hook, reference):
        dropped.append(f"hook {post.hook!r}")
        post.hook = None
    if post.image_headline and stray(post.image_headline, reference):
        dropped.append(f"card headline {post.image_headline!r}")
        post.image_headline = post.title
    return dropped


def remember(kind_history: list[str], kind: str, keep: int = 6) -> list[str]:
    return (kind_history + [kind])[-keep:]


def parse_history(raw: str | None) -> list[str]:
    return [k for k in (raw or "").split(",") if k in FORMATS]


def dump_history(history: list[str]) -> str:
    return ",".join(history)
