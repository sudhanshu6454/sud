"""Score candidate headlines against a site's beat, so selection is not just "whatever arrived last".

sources.collect() filters on age and a crude substring keyword match, then sorts newest first, and
the pipeline publishes from the top. For a broad wire that is close to random: ScreenStat's feeds
are mostly festival reviews and casting news by volume, so "newest surviving item" reliably picked
stories its audience is explicitly not there for. This asks the model to read the headlines against
the beat that is already written down in sites.yaml.

One short call per site per cycle, on titles only, before any article is fetched or written - so it
costs a fraction of a single rewrite and saves the ones it rejects.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import anthropic

from .config import Site
from .rewrite import effective_model, json_object, text_block
from .sources import Candidate

log = logging.getLogger(__name__)

SYSTEM = """You are the commissioning editor for {name} ({domain}).

Beat: {niche}
Audience: {audience}
Sections: {sections}

You get a numbered list of headlines available from the wires right now. Score each 0-10 for how
well it fits THIS publication's beat and audience. Not how interesting it is in general, not how
important, not how recent - how well it fits this beat.

  10  squarely the beat: the kind of story this audience opens the site for
  5   adjacent: publishable on a quiet day, but not what the site is for
  0   off-beat: somebody else's story

Be strict, and do not inflate scores to fill a quota. Most wire copy is off-beat for any one
publication, so it is correct and expected for most of this list to score low.

Reply with ONE JSON object and nothing else - no markdown fences, no commentary. Shape:
{{"scores": [{{"i": <item number>, "s": <0-10>, "why": "<at most 8 words>"}}]}}
Score every item exactly once."""

RANK_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["scores"],
    "properties": {
        "scores": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["i", "s", "why"],
                "properties": {
                    "i": {"type": "integer", "description": "the item number it was given"},
                    "s": {"type": "integer", "description": "0-10 fit with this beat"},
                    "why": {"type": "string", "description": "at most 8 words"},
                },
            },
        },
    },
}


@dataclass
class Scored:
    candidate: Candidate
    score: int
    reason: str


def rank(site: Site, candidates: list[Candidate], model: str | None = None, effort: str = "low",
         pool: int = 40, client: anthropic.Anthropic | None = None) -> list[Scored] | None:
    """Candidates ordered by fit, best first. None when the model could not be asked - the caller
    then keeps the recency order rather than publishing nothing because of an API hiccup."""
    shortlist = candidates[:pool]
    if not shortlist:
        return []
    listing = "\n".join(f"{i}. {c.title}  [{c.source}]" for i, c in enumerate(shortlist, 1))
    system = SYSTEM.format(
        name=site.name, domain=site.domain, niche=site.niche, audience=site.audience,
        sections=", ".join(site.categories or [site.category]),
    )
    client = client or anthropic.Anthropic(max_retries=2, timeout=120.0)
    try:
        response = client.messages.create(
            model=effective_model(model),
            max_tokens=8000,
            system=[{"type": "text", "text": system}],
            messages=[{"role": "user", "content": listing}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": RANK_SCHEMA}},
        )
        rows = json.loads(json_object(text_block(response)))["scores"]
    except Exception as exc:  # noqa: BLE001 - ranking is an improvement, never a gate on publishing
        log.warning("[%s] could not rank candidates (%s); falling back to newest first", site.key, exc)
        return None

    by_index = {}
    for row in rows:
        try:
            by_index[int(row["i"])] = (max(0, min(10, int(row["s"]))), str(row.get("why", ""))[:60])
        except (KeyError, TypeError, ValueError):
            continue
    if not by_index:
        log.warning("[%s] ranking returned nothing usable; falling back to newest first", site.key)
        return None

    # An item the model skipped keeps its place in the queue rather than being silently dropped.
    scored = [Scored(candidate=c, score=by_index.get(i, (5, "not scored"))[0],
                     reason=by_index.get(i, (5, "not scored"))[1])
              for i, c in enumerate(shortlist, 1)]
    scored.sort(key=lambda s: s.score, reverse=True)   # stable: ties keep newest-first order
    return scored
