"""Turn a source story into an original, attributed article + social captions.

Speaks the Anthropic Messages API, which also reaches other providers through ANTHROPIC_BASE_URL
(DeepSeek exposes one at https://api.deepseek.com/anthropic). Those compatibility layers implement
the core of the API but not its extras: DeepSeek ignores `cache_control` and, crucially, ignores
`output_config.format`, answering a schema-constrained request with ordinary prose. So the schema
travels twice - as `output_config.format` for providers that enforce it, and in the prompt for
providers that do not - and the response is parsed defensively either way.
"""
from __future__ import annotations

import json
import logging
import os
import re
from copy import deepcopy
from typing import Any

import anthropic
from pydantic import BaseModel, Field, ValidationError

from .cards import CARD_SCHEMA, CardIdeas
from .carousels import CAROUSEL_PROMPT, CAROUSEL_SCHEMA, CarouselSlide
from .config import Site
from .extract import Article

log = logging.getLogger(__name__)

FALLBACK_BETA = "server-side-fallback-2026-07-01"

PLATFORM_LIMITS = {
    "twitter": 240,     # plus the link (23 chars) stays under 280
    "facebook": 500,
    "instagram": 1800,
    "linkedin": 1200,
    "pinterest": 450,
    "telegram": 800,
    "threads": 440,
}


class Captions(BaseModel):
    twitter: str
    facebook: str
    instagram: str
    linkedin: str
    pinterest_title: str
    pinterest: str
    telegram: str
    threads: str


class Mention(BaseModel):
    """Someone or something central to the story, with the Instagram handle the model believes they use.

    A handle here is a candidate, never a fact: it is verified against the live account before it
    is used, and dropped when the account does not exist or its name does not match."""
    name: str = Field(max_length=80)
    kind: str = "brand"                    # brand | publication | person
    instagram: str | None = Field(default=None, max_length=40)


class StoryFrame(BaseModel):
    """One frame of the social story: a heading and a short body, both plain text."""
    heading: str = Field(max_length=70)
    body: str = Field(max_length=360)


class CuratedPost(BaseModel):
    title: str = Field(max_length=120)
    category: str = ""
    slug: str
    excerpt: str
    body_html: str
    tags: list[str] = Field(default_factory=list)
    image_headline: str
    image_kicker: str
    captions: Captions
    card: CardIdeas | None = None      # material for the Instagram card formats; optional, never invented
    mentions: list[Mention] = Field(default_factory=list)   # who the story is about; handles verified before use
    story_frames: list[StoryFrame] = Field(default_factory=list)   # the article's substance, as 1-3 story frames
    carousel_slides: list[CarouselSlide] = Field(default_factory=list)   # the article in depth, only when a carousel is due


OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "category", "slug", "excerpt", "body_html", "tags", "image_headline", "image_kicker", "captions"],
    "properties": {
        "title": {"type": "string", "description": "SEO headline, max 65 characters, no clickbait, no quotes around it"},
        "category": {"type": "string", "description": "The one section this story belongs in"},
        "slug": {"type": "string", "description": "lowercase-hyphenated url slug, max 8 words"},
        "excerpt": {"type": "string", "description": "Meta description / excerpt, 120-155 characters"},
        "body_html": {"type": "string", "description": "Article body as clean HTML (p, h2, h3, ul, ol, li, strong, em, blockquote, a). No h1, no img, no script."},
        # structured outputs only accept minItems 0/1 and no maxItems; the count is enforced after parsing
        "tags": {"type": "array", "items": {"type": "string"}, "description": "4 to 8 short topical tags"},
        "image_headline": {"type": "string", "description": "Short headline for the share image, max 70 characters"},
        "image_kicker": {"type": "string", "description": "2-3 word label for the share image, e.g. 'Brand Strategy'"},
        "card": CARD_SCHEMA,
        "story_frames": {
            "type": "array",
            "description": "The article told in 2 or 3 story frames for Instagram and Facebook Stories, where readers see only images. Frame 1: what happened, with the key facts and figures. Frame 2: why it matters for our audience. Frame 3 (optional): what to do about it, or the outlook. Plain text only: no hashtags, no URLs, no emoji, no markdown.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["heading", "body"],
                "properties": {
                    "heading": {"type": "string", "description": "Max 60 characters, a complete thought, sentence case"},
                    "body": {"type": "string", "description": "2 to 3 sentences, 200 to 320 characters, specific and factual"},
                },
            },
        },
        "mentions": {
            "type": "array",
            "description": "Up to 5 accounts genuinely central to this story, for tagging: the publication that reported it, the brands, companies or agencies it is about, and a person only when quoted or the subject. Never bystanders or competitors merely named in passing.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "kind"],
                "properties": {
                    "name": {"type": "string", "description": "The entity's name as the source gives it"},
                    "kind": {"type": "string", "enum": ["brand", "publication", "person"]},
                    "instagram": {"type": "string", "description": "Their Instagram username without @, only if you are confident it is the real account; omit otherwise. It is verified before use."},
                },
            },
        },
        "captions": {
            "type": "object",
            "additionalProperties": False,
            "required": ["twitter", "facebook", "instagram", "linkedin", "pinterest_title", "pinterest", "telegram", "threads"],
            "properties": {
                "twitter": {"type": "string", "description": f"<= {PLATFORM_LIMITS['twitter']} chars, 1-2 hashtags, no link (added automatically)"},
                "facebook": {"type": "string", "description": f"<= {PLATFORM_LIMITS['facebook']} chars, conversational, ends with a question or CTA, no link"},
                "instagram": {"type": "string", "description": f"<= {PLATFORM_LIMITS['instagram']} chars, hook line first, line breaks, 8-15 hashtags at the end. No URL and no 'link in bio': the call to action is appended automatically"},
                "linkedin": {"type": "string", "description": f"<= {PLATFORM_LIMITS['linkedin']} chars, professional insight-led post with short paragraphs, no hashtags, no link"},
                "pinterest_title": {"type": "string", "description": "<= 90 chars pin title"},
                "pinterest": {"type": "string", "description": f"<= {PLATFORM_LIMITS['pinterest']} chars keyword-rich pin description, no link"},
                "telegram": {"type": "string", "description": f"<= {PLATFORM_LIMITS['telegram']} chars, plain text summary with 2-3 key points, no link"},
                "threads": {"type": "string", "description": f"<= {PLATFORM_LIMITS['threads']} chars, casual, no link"},
            },
        },
    },
}

SYSTEM_PROMPT = """You are the editor-in-chief of {name} ({domain}). Tagline: "{tagline}".

Beat: {niche}
Audience: {audience}
Voice: {tone}
Sections: {sections} - file the story under the single best-fitting one.

You receive one news story from another publisher. Write an ORIGINAL curated article about it for our readers:
- Report the news in your own words. Never copy sentences or distinctive phrasing from the source. Do not reproduce more than a very short quoted phrase, and attribute any quote.
- Add value: context, why it matters for our audience, what to do about it, a relevant framework or example.
- Length 450-750 words. Use <h2> subheadings, short paragraphs, and one bullet list where it helps.
- Facts, names, numbers and dates must come from the source; do not invent details. If the source is thin, keep the piece shorter rather than padding.
- End the body with a paragraph: <p><em>Source: <a href="SOURCE_URL" rel="nofollow noopener" target="_blank">SOURCE_NAME</a></em></p> using the real source URL and publisher name.
- Never mention that you are an AI or that this is a rewrite.
- Captions must be platform-native, mention the key takeaway, and must not include any URL (the link is appended automatically where the platform supports it).
- `story_frames` tells the article in 2 or 3 frames for Stories, where readers see only images: what happened with the facts and figures, why it matters, and what to do or what comes next. Each frame is a heading and 2-3 plain sentences. This is the whole article a story viewer gets, so carry the substance, not a teaser.
- `mentions` lists who the story is about, for tagging: the reporting publication, the brands or companies it concerns, a person only when quoted or the subject. Give an Instagram username only when confident it is the real account; it is checked against the live account before use, so a guess costs nothing but an omission loses a tag.
- `card` holds material for the Instagram image, and only what the source genuinely contains: a verbatim quotation with who said it, the single most striking figure exactly as written with what it measures, exactly three takeaways, the real question the piece answers, a direct two-way comparison the source itself makes (left/right value and label), a concept the piece explains (term and a one-sentence definition in your words), and do/don't advice when the piece actually gives it. Leave out any part the source does not support. A card with nothing to say is better than one that invents a number, a quote or a comparison.
"""


JSON_CONTRACT = """
Reply with ONE JSON object and nothing else: no markdown code fences, no commentary before or after
it. It must validate against this JSON Schema:

{schema}
"""

_FENCE = re.compile(r"\A\s*```(?:json)?\s*|\s*```\s*\Z", re.IGNORECASE)


def effective_model(configured: str | None = None) -> str:
    """The model actually used. ANTHROPIC_MODEL wins over sites.yaml so that moving provider is one
    coherent edit to .env - base URL, key and the model name that belongs with them travel together."""
    return os.environ.get("ANTHROPIC_MODEL") or configured or "claude-opus-5"


def text_block(response) -> str:
    """The assistant's text. Reasoning models put a `thinking` block first; it is not the answer."""
    return next((b.text for b in response.content if getattr(b, "type", None) == "text"), "")


def json_object(text: str) -> str:
    """The JSON out of a reply that may have arrived fenced, or with prose either side of it."""
    stripped = _FENCE.sub("", text.strip())
    start, end = stripped.find("{"), stripped.rfind("}")
    return stripped[start : end + 1] if start != -1 and end > start else stripped


def schema_for(site: Site, carousel: bool = False) -> dict[str, Any]:
    """The output schema with this site's own sections as the allowed categories.

    `carousel` adds the slides for a swipe-through post; twice a day, not on every article, so the
    ordinary rewrite stays focused on the article itself."""
    schema = deepcopy(OUTPUT_SCHEMA)
    sections = site.categories or [site.category]
    schema["properties"]["category"] = {
        "type": "string",
        "enum": sections,
        "description": "The one section this story belongs in",
    }
    if carousel:
        schema["properties"]["carousel_slides"] = deepcopy(CAROUSEL_SCHEMA)
        schema["required"] = [*schema["required"], "carousel_slides"]
    return schema


class RewriteSkipped(Exception):
    """The model declined or the response was unusable; skip this story."""


class Rewriter:
    def __init__(self, model: str | None = None, effort: str = "medium", use_fallbacks: bool | None = None,
                 client: anthropic.Anthropic | None = None):
        self.model = model or os.environ.get("ANTHROPIC_MODEL", "claude-opus-5")
        self.effort = os.environ.get("ANTHROPIC_EFFORT", effort)
        if use_fallbacks is None:
            # Server-side fallbacks are an Anthropic feature. A compatibility endpoint reached
            # through ANTHROPIC_BASE_URL ignores the beta header; do not spend a request on it.
            base = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
            first_party = "api.anthropic.com" in base
            use_fallbacks = first_party and os.environ.get("ANTHROPIC_FALLBACKS", "default").lower() != "off"
        self.use_fallbacks = use_fallbacks
        self.client = client or anthropic.Anthropic(max_retries=3, timeout=300.0)

    def _create(self, **kwargs):
        if self.use_fallbacks:
            try:
                return self.client.beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", **kwargs)
            except anthropic.BadRequestError as exc:
                log.warning("server-side fallbacks rejected (%s); retrying without", exc.message)
                self.use_fallbacks = False
        return self.client.messages.create(**kwargs)

    def rewrite(self, site: Site, article: Article, carousel: bool = False) -> CuratedPost:
        schema = schema_for(site, carousel)
        # Appended after .format() so the schema's own braces are never read as format placeholders.
        system = SYSTEM_PROMPT.format(
            name=site.name, domain=site.domain, tagline=site.tagline,
            niche=site.niche, audience=site.audience, tone=site.tone,
            sections=", ".join(site.categories or [site.category]),
        ) + (CAROUSEL_PROMPT if carousel else "") + JSON_CONTRACT.format(schema=json.dumps(schema))
        user = (
            f"SOURCE_URL: {article.url}\n"
            f"SOURCE_NAME: {article.sitename or article.url.split('/')[2]}\n"
            f"SOURCE_TITLE: {article.title}\n"
            f"SOURCE_DATE: {article.date or 'unknown'}\n"
            f"SITE_HASHTAGS (use some in instagram/twitter captions): {' '.join('#' + h for h in site.hashtags)}\n\n"
            f"SOURCE_TEXT:\n{article.text}"
        )
        messages: list[dict[str, Any]] = [{"role": "user", "content": user}]
        for attempt in (1, 2):   # one corrective round: a provider that ignores the schema often obeys the prompt
            try:
                response = self._create(
                    model=self.model,
                    max_tokens=16000,
                    system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                    messages=messages,
                    output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
                )
            except anthropic.RateLimitError as exc:
                raise RuntimeError(f"rate limited by the model API: {exc.message}") from exc
            except anthropic.APIStatusError as exc:
                raise RuntimeError(f"model API error {exc.status_code}: {exc.message}") from exc
            except anthropic.APIConnectionError as exc:
                raise RuntimeError(f"model API connection error: {exc}") from exc

            if response.stop_reason == "refusal":
                details = getattr(response, "stop_details", None)
                raise RewriteSkipped(f"model declined ({getattr(details, 'category', None)})")
            if response.stop_reason == "max_tokens":
                raise RuntimeError("model output truncated at max_tokens")

            text = text_block(response)
            try:
                post = CuratedPost.model_validate(json.loads(json_object(text)))
                break
            except (json.JSONDecodeError, ValidationError) as exc:
                if attempt == 2:
                    raise RuntimeError(f"unusable model output: {exc}") from exc
                log.warning("model did not return the schema (%s); asking once more", type(exc).__name__)
                messages = messages + [
                    {"role": "assistant", "content": text or "(no text returned)"},
                    {"role": "user", "content": "That did not parse as the required JSON object. Reply with ONLY the JSON object, no fences and no commentary."},
                ]
        post.tags = [t.strip() for t in post.tags if t and t.strip()][:8]
        sections = {c.lower(): c for c in (site.categories or [site.category])}
        post.category = sections.get(post.category.strip().lower(), site.category)
        usage = response.usage
        log.info("rewrite ok: %s (in=%s cached=%s out=%s)", post.title, usage.input_tokens,
                 getattr(usage, "cache_read_input_tokens", 0), usage.output_tokens)
        return post
