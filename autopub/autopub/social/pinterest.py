"""Pinterest: image pin linking back to the article."""
from __future__ import annotations

import requests

from .base import Publisher, PublishResult, SocialPost, fit_text

API = "https://api.pinterest.com/v5"


class PinterestPublisher(Publisher):
    platform = "pinterest"
    env_prefix = "PINTEREST"
    required_env = ("ACCESS_TOKEN", "BOARD_ID")
    requires_image = True
    prefers_square = True
    text_limit = 800

    def _publish(self, post: SocialPost) -> PublishResult:
        image_url = post.image_url(prefer_square=True)
        if not image_url:
            raise RuntimeError("Pinterest needs a publicly reachable image URL")
        body = {
            "board_id": self.creds["BOARD_ID"],
            "title": (post.pinterest_title or post.title)[:100],
            "description": fit_text(post.caption_for(self.platform), self.text_limit),
            "link": post.link,
            "alt_text": post.title[:500],
            "media_source": {"source_type": "image_url", "url": image_url},
        }
        resp = requests.post(f"{API}/pins", headers={"Authorization": f"Bearer {self.creds['ACCESS_TOKEN']}", "Content-Type": "application/json"},
                             json=body, timeout=self.timeout)
        data = resp.json()
        if resp.status_code >= 400:
            raise RuntimeError(data)
        pin_id = data.get("id")
        return PublishResult(self.platform, True, remote_id=pin_id, url=f"https://www.pinterest.com/pin/{pin_id}/" if pin_id else None)
