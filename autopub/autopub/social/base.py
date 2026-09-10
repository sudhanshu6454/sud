"""Common contract for social publishers."""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import ClassVar

log = logging.getLogger(__name__)


SHAPES = ("portrait", "square", "landscape")   # every card shape autopub renders, tallest first


def _first(available: dict, preferred: tuple[str, ...]):
    """The first preferred shape that exists, else any other shape rather than nothing."""
    for shape in (*preferred, *SHAPES):
        got = available.get(shape)
        if got:
            return got
    return None


@dataclass
class SocialPost:
    """Everything a publisher might need for one article."""
    title: str
    link: str
    captions: dict[str, str]                 # platform -> caption (no link inside)
    hashtags: list[str] = field(default_factory=list)
    images: dict[str, Path] = field(default_factory=dict)       # shape -> rendered card on disk
    image_urls: dict[str, str] = field(default_factory=dict)    # shape -> public URL, for API's that need one
    pinterest_title: str | None = None
    alt_text: str | None = None                                 # what the card says, for screen readers

    def caption_for(self, platform: str) -> str:
        return (self.captions.get(platform) or self.captions.get("facebook") or self.title).strip()

    def image_path(self, *shapes: str) -> Path | None:
        return _first(self.images, shapes)

    def image_url(self, *shapes: str) -> str | None:
        return _first(self.image_urls, shapes)


@dataclass
class PublishResult:
    platform: str
    ok: bool
    remote_id: str | None = None
    url: str | None = None
    error: str | None = None


def fit_text(caption: str, limit: int, suffix: str = "") -> str:
    """Trim caption so caption + suffix fits within limit, cutting on a word boundary."""
    budget = limit - len(suffix)
    if budget <= 0:
        return suffix.strip()[:limit]
    caption = caption.strip()
    if len(caption) <= budget:
        return caption + suffix
    cut = caption[: budget - 1]
    if " " in cut:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(" ,.;:-") + "…" + suffix


class Publisher(ABC):
    platform: ClassVar[str]
    env_prefix: ClassVar[str]
    required_env: ClassVar[tuple[str, ...]]
    supports_image: ClassVar[bool] = True
    supports_link: ClassVar[bool] = True      # clickable link in the post body
    requires_image: ClassVar[bool] = False
    image_shapes: ClassVar[tuple[str, ...]] = ("landscape", "square")   # which card this platform wants, best first
    needs_public_url: ClassVar[bool] = False   # true when the API fetches the image itself instead of taking an upload
    text_limit: ClassVar[int] = 2000

    def __init__(self, creds: dict[str, str], timeout: int = 60):
        self.creds = creds
        self.timeout = timeout

    @classmethod
    def from_env(cls, site_key: str, environ) -> "Publisher | None":
        creds = {}
        missing = []
        for var in cls.required_env:
            val = environ.get(f"{cls.env_prefix}_{site_key}_{var}")
            if val:
                creds[var] = val
            else:
                missing.append(f"{cls.env_prefix}_{site_key}_{var}")
        if missing:
            log.info("[%s] %s disabled, missing env: %s", site_key, cls.platform, ", ".join(missing))
            return None
        return cls(creds)

    def publish(self, post: SocialPost) -> PublishResult:
        try:
            if self.requires_image and not (post.image_url(*self.image_shapes) or post.image_path(*self.image_shapes)):
                return PublishResult(self.platform, False, error="platform requires an image and none is available")
            return self._publish(post)
        except Exception as exc:  # noqa: BLE001 - one platform failing must not stop the others
            log.exception("[%s] publish failed", self.platform)
            return PublishResult(self.platform, False, error=f"{type(exc).__name__}: {exc}"[:1000])

    @abstractmethod
    def _publish(self, post: SocialPost) -> PublishResult: ...

    def _text_with_link(self, post: SocialPost, link_len: int | None = None) -> str:
        caption = post.caption_for(self.platform)
        if self.supports_link:
            suffix = f"\n\n{post.link}"
            # platforms that count links as fixed length (X) are handled via link_len
            if link_len is not None:
                return fit_text(caption, self.text_limit - (link_len + 2)) + suffix
            return fit_text(caption, self.text_limit, suffix)
        return fit_text(caption, self.text_limit)
