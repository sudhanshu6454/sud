"""Threads (Meta) via the Threads API: image post with the link in the text."""
from __future__ import annotations

import time

import requests

from .base import Publisher, PublishResult, SocialPost

API = "https://graph.threads.net/v1.0"


class ThreadsPublisher(Publisher):
    platform = "threads"
    env_prefix = "THREADS"
    required_env = ("USER_ID", "ACCESS_TOKEN")
    prefers_square = True
    text_limit = 500

    def _publish(self, post: SocialPost) -> PublishResult:
        uid, token = self.creds["USER_ID"], self.creds["ACCESS_TOKEN"]
        text = self._text_with_link(post)
        image_url = post.image_url(prefer_square=True)
        payload = {"text": text, "access_token": token}
        if image_url:
            payload.update({"media_type": "IMAGE", "image_url": image_url})
        else:
            payload["media_type"] = "TEXT"
        create = requests.post(f"{API}/{uid}/threads", data=payload, timeout=self.timeout).json()
        if "id" not in create:
            raise RuntimeError(create.get("error", create))
        creation_id = create["id"]
        for _ in range(20):
            status = requests.get(f"{API}/{creation_id}", params={"fields": "status,error_message", "access_token": token}, timeout=self.timeout).json()
            if status.get("status") == "FINISHED":
                break
            if status.get("status") in ("ERROR", "EXPIRED"):
                raise RuntimeError(status)
            time.sleep(3)
        pub = requests.post(f"{API}/{uid}/threads_publish", data={"creation_id": creation_id, "access_token": token}, timeout=self.timeout).json()
        if "id" not in pub:
            raise RuntimeError(pub.get("error", pub))
        info = requests.get(f"{API}/{pub['id']}", params={"fields": "permalink", "access_token": token}, timeout=self.timeout).json()
        return PublishResult(self.platform, True, remote_id=pub["id"], url=info.get("permalink"))
