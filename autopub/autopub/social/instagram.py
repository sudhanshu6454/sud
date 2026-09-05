"""Instagram (Business/Creator account via Graph API). Image is mandatory; links are not clickable."""
from __future__ import annotations

import time

import requests

from .base import Publisher, PublishResult, SocialPost, fit_text

GRAPH = "https://graph.facebook.com/v21.0"


class InstagramPublisher(Publisher):
    platform = "instagram"
    env_prefix = "INSTAGRAM"
    required_env = ("USER_ID", "ACCESS_TOKEN")
    supports_link = False
    requires_image = True
    prefers_square = True
    text_limit = 2200

    def _publish(self, post: SocialPost) -> PublishResult:
        uid, token = self.creds["USER_ID"], self.creds["ACCESS_TOKEN"]
        image_url = post.image_url(prefer_square=True)
        if not image_url:
            raise RuntimeError("Instagram needs a publicly reachable image URL (upload to WordPress first)")
        # link is plain text on IG; keep it so people can copy it, and it also lands in the caption search
        caption = fit_text(post.caption_for(self.platform), self.text_limit, f"\n\nRead: {post.link}")
        create = requests.post(f"{GRAPH}/{uid}/media", data={"image_url": image_url, "caption": caption, "access_token": token}, timeout=self.timeout).json()
        if "id" not in create:
            raise RuntimeError(create.get("error", create))
        creation_id = create["id"]
        for _ in range(20):
            status = requests.get(f"{GRAPH}/{creation_id}", params={"fields": "status_code", "access_token": token}, timeout=self.timeout).json()
            code = status.get("status_code")
            if code == "FINISHED":
                break
            if code in ("ERROR", "EXPIRED"):
                raise RuntimeError(f"container {code}: {status}")
            time.sleep(3)
        pub = requests.post(f"{GRAPH}/{uid}/media_publish", data={"creation_id": creation_id, "access_token": token}, timeout=self.timeout).json()
        if "id" not in pub:
            raise RuntimeError(pub.get("error", pub))
        media_id = pub["id"]
        info = requests.get(f"{GRAPH}/{media_id}", params={"fields": "permalink", "access_token": token}, timeout=self.timeout).json()
        return PublishResult(self.platform, True, remote_id=media_id, url=info.get("permalink"))
