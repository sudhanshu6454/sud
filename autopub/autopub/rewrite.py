"""Turn a source story into an original, attributed article + social captions with Claude."""
from __future__ import annotations

import html
import json
import logging
import os
from typing import Any

import anthropic
from pydantic import BaseModel, Field, ValidationError

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


class FaqItem(BaseModel):
    question: str
    answer: str


class CuratedPost(BaseModel):
    title: str = Field(max_length=120)
    slug: str
    excerpt: str
    body_html: str
    tags: list[str] = Field(default_factory=list)
    key_takeaways: list[str] = Field(default_factory=list)
    faq: list[FaqItem] = Field(default_factory=list)
    image_headline: str
    image_kicker: str
    captions: Captions

    def content_html(self) -> str:
        """The post body WordPress receives.

        Key takeaways go first as a plain <ul> and the FAQ last as <details> elements inside
        <section class="faq">. Any theme renders them as normal HTML; the marketing-junkies theme
        turns a leading <ul> into its Key takeaways box and the section into its FAQ + FAQPage schema.
        """
        parts = []
        if self.key_takeaways:
            items = "".join(f"<li>{html.escape(t)}</li>" for t in self.key_takeaways)
            parts.append(f"<ul>{items}</ul>")
        parts.append(self.body_html)
        if self.faq:
            qa = "".join(
                f"<details><summary>{html.escape(f.question)}</summary><p>{html.escape(f.answer)}</p></details>"
                for f in self.faq
            )
            parts.append(f'<section class="faq" id="faq"><h2>Frequently asked</h2>{qa}</section>')
        return "\n".join(parts)


OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "slug", "excerpt", "body_html", "tags", "key_takeaways", "faq", "image_headline", "image_kicker", "captions"],
    "properties": {
        "title": {"type": "string", "description": "SEO headline, max 65 characters, no clickbait, no quotes around it"},
        "slug": {"type": "string", "description": "lowercase-hyphenated url slug, max 8 words"},
        "excerpt": {"type": "string", "description": "Meta description / excerpt, 120-155 characters"},
        "body_html": {"type": "string", "description": "Article body as clean HTML (p, h2, h3, ul, ol, li, strong, em, blockquote, a). No h1, no img, no script. Do not start with a list and do not include the key takeaways or FAQ here."},
        # structured outputs only accept minItems 0/1 and no maxItems; the count is enforced after parsing
        "tags": {"type": "array", "items": {"type": "string"}, "description": "4 to 8 short topical tags"},
        "key_takeaways": {"type": "array", "items": {"type": "string"},
                          "description": "Exactly 3 plain-text takeaways, one sentence each, max 200 characters, facts from the source only"},
        "faq": {
            "type": "array",
            "description": "2 or 3 questions a reader would search for, answered in 1-2 plain-text sentences from the source facts only",
            "items": {
                "type": "object", "additionalProperties": False, "required": ["question", "answer"],
                "properties": {"question": {"type": "string"}, "answer": {"type": "string"}},
            },
        },
        "image_headline": {"type": "string", "description": "Short headline for the share image, max 70 characters"},
        "image_kicker": {"type": "string", "description": "2-3 word label for the share image, e.g. 'Brand Strategy'"},
        "captions": {
            "type": "object",
            "additionalProperties": False,
            "required": ["twitter", "facebook", "instagram", "linkedin", "pinterest_title", "pinterest", "telegram", "threads"],
            "properties": {
                "twitter": {"type": "string", "description": f"<= {PLATFORM_LIMITS['twitter']} chars, 1-2 hashtags, no link (added automatically)"},
                "facebook": {"type": "string", "description": f"<= {PLATFORM_LIMITS['facebook']} chars, conversational, ends with a question or CTA, no link"},
                "instagram": {"type": "string", "description": f"<= {PLATFORM_LIMITS['instagram']} chars, hook line first, line breaks, 8-15 hashtags at the end, say 'link in bio' since links are not clickable"},
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

You receive one news story from another publisher. Write an ORIGINAL curated article about it for our readers:
- Report the news in your own words. Never copy sentences or distinctive phrasing from the source. Do not reproduce more than a very short quoted phrase, and attribute any quote.
- Add value: context, why it matters for our audience, what to do about it, a relevant framework or example.
- Length 450-750 words. Use <h2> subheadings, short paragraphs, and one bullet list where it helps.
- Facts, names, numbers and dates must come from the source; do not invent details. If the source is thin, keep the piece shorter rather than padding.
- End the body with a paragraph: <p><em>Source: <a href="SOURCE_URL" rel="nofollow noopener" target="_blank">SOURCE_NAME</a></em></p> using the real source URL and publisher name.
- Key takeaways and FAQ go in their own fields, never in body_html. If the source cannot support a real FAQ answer, return fewer questions rather than guessing.
- Never mention that you are an AI or that this is a rewrite.
- Captions must be platform-native, mention the key takeaway, and must not include any URL (the link is appended automatically where the platform supports it).
"""


class RewriteSkipped(Exception):
    """The model declined or the response was unusable; skip this story."""


class Rewriter:
    def __init__(self, model: str | None = None, effort: str = "medium", use_fallbacks: bool | None = None,
                 client: anthropic.Anthropic | None = None):
        self.model = model or os.environ.get("ANTHROPIC_MODEL", "claude-opus-5")
        self.effort = os.environ.get("ANTHROPIC_EFFORT", effort)
        if use_fallbacks is None:
            use_fallbacks = os.environ.get("ANTHROPIC_FALLBACKS", "default").lower() != "off"
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

    def rewrite(self, site: Site, article: Article) -> CuratedPost:
        system = SYSTEM_PROMPT.format(
            name=site.name, domain=site.domain, tagline=site.tagline,
            niche=site.niche, audience=site.audience, tone=site.tone,
        )
        user = (
            f"SOURCE_URL: {article.url}\n"
            f"SOURCE_NAME: {article.sitename or article.url.split('/')[2]}\n"
            f"SOURCE_TITLE: {article.title}\n"
            f"SOURCE_DATE: {article.date or 'unknown'}\n"
            f"SITE_HASHTAGS (use some in instagram/twitter captions): {' '.join('#' + h for h in site.hashtags)}\n\n"
            f"SOURCE_TEXT:\n{article.text}"
        )
        try:
            response = self._create(
                model=self.model,
                max_tokens=16000,
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user}],
                output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
            )
        except anthropic.RateLimitError as exc:
            raise RuntimeError(f"rate limited by Anthropic: {exc.message}") from exc
        except anthropic.APIStatusError as exc:
            raise RuntimeError(f"Anthropic API error {exc.status_code}: {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise RuntimeError(f"Anthropic connection error: {exc}") from exc

        if response.stop_reason == "refusal":
            details = getattr(response, "stop_details", None)
            raise RewriteSkipped(f"model declined ({getattr(details, 'category', None)})")
        if response.stop_reason == "max_tokens":
            raise RuntimeError("model output truncated at max_tokens")

        text = next((b.text for b in response.content if b.type == "text"), "")
        try:
            post = CuratedPost.model_validate(json.loads(text))
        except (json.JSONDecodeError, ValidationError) as exc:
            raise RuntimeError(f"unusable model output: {exc}") from exc
        post.tags = [t.strip() for t in post.tags if t and t.strip()][:8]
        post.key_takeaways = [t.strip() for t in post.key_takeaways if t and t.strip()][:3]
        post.faq = [f for f in post.faq if f.question.strip() and f.answer.strip()][:3]
        usage = response.usage
        log.info("rewrite ok: %s (in=%s cached=%s out=%s)", post.title, usage.input_tokens,
                 getattr(usage, "cache_read_input_tokens", 0), usage.output_tokens)
        return post
