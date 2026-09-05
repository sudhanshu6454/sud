"""Registry of social publishers and the fan-out dispatcher."""
from __future__ import annotations

import logging
import os

from ..config import Site
from .base import Publisher, PublishResult, SocialPost, fit_text
from .facebook import FacebookPublisher
from .instagram import InstagramPublisher
from .linkedin import LinkedInPublisher
from .pinterest import PinterestPublisher
from .telegram import TelegramPublisher
from .threads import ThreadsPublisher
from .twitter import TwitterPublisher

log = logging.getLogger(__name__)

REGISTRY: dict[str, type[Publisher]] = {
    cls.platform: cls
    for cls in (TwitterPublisher, FacebookPublisher, InstagramPublisher, LinkedInPublisher,
                PinterestPublisher, TelegramPublisher, ThreadsPublisher)
}


def build_publishers(site: Site, environ=None) -> list[Publisher]:
    environ = os.environ if environ is None else environ
    out: list[Publisher] = []
    for name in site.socials:
        cls = REGISTRY.get(name)
        if not cls:
            log.warning("[%s] unknown social platform %r in config", site.key, name)
            continue
        pub = cls.from_env(site.key, environ)
        if pub:
            out.append(pub)
    return out


def dispatch(publishers: list[Publisher], post: SocialPost) -> list[PublishResult]:
    results = []
    for pub in publishers:
        res = pub.publish(post)
        if res.ok:
            log.info("[%s] posted %s", pub.platform, res.url or res.remote_id)
        else:
            log.error("[%s] FAILED: %s", pub.platform, res.error)
        results.append(res)
    return results


__all__ = ["REGISTRY", "Publisher", "PublishResult", "SocialPost", "build_publishers", "dispatch", "fit_text"]
