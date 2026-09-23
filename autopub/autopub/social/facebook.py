"""Facebook Page: photo post with the link in the message, or a link post when no image.

A carousel article goes out as a multi-photo post: every slide uploaded unpublished, then one
feed post that attaches them all, so the Page shows the same swipe-through as Instagram."""
from __future__ import annotations

import json
import logging

import requests

from .base import Publisher, PublishResult, SocialPost

log = logging.getLogger(__name__)

GRAPH = "https://graph.facebook.com/v21.0"
MAX_ATTACHED = 10


class FacebookPublisher(Publisher):
    platform = "facebook"
    env_prefix = "FACEBOOK"
    required_env = ("PAGE_ID", "PAGE_TOKEN")
    needs_public_url = True
    supports_carousel = True
    text_limit = 5000

    def _multi_photo(self, page: str, token: str, urls: list[str], message: str) -> PublishResult:
        ids = []
        for url in urls[:MAX_ATTACHED]:
            photo = requests.post(f"{GRAPH}/{page}/photos", timeout=self.timeout,
                                  data={"url": url, "published": "false", "access_token": token}).json()
            if "id" not in photo:
                raise RuntimeError(f"slide upload refused: {photo.get('error', photo)}")
            ids.append(photo["id"])
        data = {"message": message, "access_token": token}
        for i, fbid in enumerate(ids):
            data[f"attached_media[{i}]"] = json.dumps({"media_fbid": fbid})
        resp = requests.post(f"{GRAPH}/{page}/feed", data=data, timeout=self.timeout)
        payload = resp.json()
        if resp.status_code >= 400 or "error" in payload:
            raise RuntimeError(payload.get("error", payload))
        remote_id = payload.get("id")
        return PublishResult(self.platform, True, remote_id=remote_id, url=f"https://www.facebook.com/{remote_id}",
                             format="carousel")

    def _publish(self, post: SocialPost) -> PublishResult:
        page, token = self.creds["PAGE_ID"], self.creds["PAGE_TOKEN"]
        message = self._text_with_link(post)
        if len(post.carousel_urls) >= 2:
            try:
                return self._multi_photo(page, token, post.carousel_urls, message)
            except Exception as exc:  # noqa: BLE001 - the single photo post is the fallback, never nothing
                log.warning("[facebook] multi-photo post failed (%s); posting the single card instead", exc)
        image_url = post.image_url(*self.image_shapes)
        image_path = post.image_path(*self.image_shapes)
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
