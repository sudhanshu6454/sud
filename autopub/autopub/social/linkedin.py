"""LinkedIn organization page via the versioned Posts API (image post, or article/link post)."""
from __future__ import annotations

import re

import requests

from .base import Publisher, PublishResult, SocialPost, fit_text

API = "https://api.linkedin.com/rest"
VERSION = "202409"
_RESERVED = re.compile(r"([\\|{}@\[\]()<>#*_~])")


def escape_little_text(text: str) -> str:
    """LinkedIn's 'little text' format requires escaping reserved characters."""
    return _RESERVED.sub(r"\\\1", text)


class LinkedInPublisher(Publisher):
    platform = "linkedin"
    env_prefix = "LINKEDIN"
    required_env = ("ORG_URN", "ACCESS_TOKEN")   # ORG_URN like urn:li:organization:12345
    text_limit = 2900

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.creds['ACCESS_TOKEN']}",
            "LinkedIn-Version": VERSION,
            "X-Restli-Protocol-Version": "2.0.0",
            "Content-Type": "application/json",
        }

    def _upload_image(self, path) -> str:
        init = requests.post(f"{API}/images?action=initializeUpload", headers=self._headers(),
                             json={"initializeUploadRequest": {"owner": self.creds["ORG_URN"]}}, timeout=self.timeout)
        init.raise_for_status()
        value = init.json()["value"]
        with open(path, "rb") as fh:
            up = requests.put(value["uploadUrl"], data=fh.read(),
                              headers={"Authorization": f"Bearer {self.creds['ACCESS_TOKEN']}", "Content-Type": "application/octet-stream"},
                              timeout=self.timeout)
        up.raise_for_status()
        return value["image"]

    def _publish(self, post: SocialPost) -> PublishResult:
        org = self.creds["ORG_URN"]
        commentary = escape_little_text(fit_text(post.caption_for(self.platform), self.text_limit, f"\n\n{post.link}"))
        body = {
            "author": org,
            "commentary": commentary,
            "visibility": "PUBLIC",
            "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": []},
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        }
        image = post.image_path(prefer_square=False)
        if image:
            image_urn = self._upload_image(image)
            body["content"] = {"media": {"title": post.title[:200], "id": image_urn}}
        else:
            body["content"] = {"article": {"source": post.link, "title": post.title[:200]}}
        resp = requests.post(f"{API}/posts", headers=self._headers(), json=body, timeout=self.timeout)
        if resp.status_code >= 400:
            raise RuntimeError(f"{resp.status_code}: {resp.text[:500]}")
        post_urn = resp.headers.get("x-restli-id") or resp.headers.get("X-RestLi-Id")
        url = f"https://www.linkedin.com/feed/update/{post_urn}" if post_urn else None
        return PublishResult(self.platform, True, remote_id=post_urn, url=url)
