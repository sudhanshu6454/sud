"""Facebook Page: photo post with the link in the message, or a link post when no image."""
from __future__ import annotations

import requests

from .base import Publisher, PublishResult, SocialPost

GRAPH = "https://graph.facebook.com/v21.0"


class FacebookPublisher(Publisher):
    platform = "facebook"
    env_prefix = "FACEBOOK"
    required_env = ("PAGE_ID", "PAGE_TOKEN")
    text_limit = 5000

    def _publish(self, post: SocialPost) -> PublishResult:
        page, token = self.creds["PAGE_ID"], self.creds["PAGE_TOKEN"]
        message = self._text_with_link(post)
        image_url = post.image_url(prefer_square=False)
        image_path = post.image_path(prefer_square=False)
        if image_url:
            resp = requests.post(f"{GRAPH}/{page}/photos", data={"url": image_url, "message": message, "access_token": token}, timeout=self.timeout)
        elif image_path:
            with open(image_path, "rb") as fh:
                resp = requests.post(f"{GRAPH}/{page}/photos", data={"message": message, "access_token": token},
                                     files={"source": fh}, timeout=self.timeout)
        else:
            resp = requests.post(f"{GRAPH}/{page}/feed", data={"message": post.caption_for(self.platform), "link": post.link, "access_token": token}, timeout=self.timeout)
        data = resp.json()
        if resp.status_code >= 400 or "error" in data:
            raise RuntimeError(data.get("error", data))
        remote_id = data.get("post_id") or data.get("id")
        return PublishResult(self.platform, True, remote_id=remote_id, url=f"https://www.facebook.com/{remote_id}")
