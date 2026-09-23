"""Stories: the same card, 9:16, on Instagram and the Facebook Page.

Both run as their own publishers so a story that fails never costs the feed post, and so each
outcome is recorded on its own row. Stories take no caption and, through the API, no link
sticker; the card's footer names the site, which is all the message a story can carry.
"""
from __future__ import annotations

import logging
import time

import requests

from .base import Publisher, PublishResult, SocialPost
from .instagram import GRAPH, POLL_SECONDS, POLL_TIMEOUT, _error

log = logging.getLogger(__name__)

STORY_BUDGET = 150      # seconds: a story is a bonus, so it gets a shorter wall clock than the feed post


class InstagramStoryPublisher(Publisher):
    """POST /media with media_type=STORIES, wait for the container, publish. Same credentials as
    the feed publisher; stories do not count against the feed publishing quota."""
    platform = "instagram_story"
    env_prefix = "INSTAGRAM"
    required_env = ("USER_ID", "ACCESS_TOKEN")
    supports_link = False
    requires_image = True
    needs_public_url = True
    image_shapes = ("story",)

    def _publish(self, post: SocialPost) -> PublishResult:
        uid, token = self.creds["USER_ID"], self.creds["ACCESS_TOKEN"]
        # strict: the shape walker would hand back the 4:5 feed card, and a story is not that card
        image_url = post.image_urls.get("story")
        if not image_url:
            raise RuntimeError("no 9:16 story asset was uploaded for this article")
        created = requests.post(f"{GRAPH}/{uid}/media", timeout=self.timeout,
                                data={"media_type": "STORIES", "image_url": image_url, "access_token": token}).json()
        if "id" not in created:
            code, subcode, message = _error(created)
            raise RuntimeError(f"story container refused {code}/{subcode}: {message}")
        creation_id = created["id"]
        deadline = time.monotonic() + STORY_BUDGET
        while time.monotonic() < deadline:
            status = requests.get(f"{GRAPH}/{creation_id}", timeout=POLL_TIMEOUT,
                                  params={"fields": "status_code,status", "access_token": token}).json()
            code = status.get("status_code")
            if code == "FINISHED":
                break
            if code in ("ERROR", "EXPIRED"):
                raise RuntimeError(f"story container {code}: {str(status.get('status') or status)[:200]}")
            time.sleep(POLL_SECONDS)
        else:
            raise RuntimeError("story container did not finish inside its budget")
        while True:
            pub = requests.post(f"{GRAPH}/{uid}/media_publish", timeout=self.timeout,
                                data={"creation_id": creation_id, "access_token": token}).json()
            if "id" in pub:
                break
            code, subcode, message = _error(pub)
            if subcode == 2207027 and time.monotonic() + POLL_SECONDS < deadline:   # not ready yet: publish again
                time.sleep(POLL_SECONDS)
                continue
            raise RuntimeError(f"story publish failed {code}/{subcode}: {message} (container {creation_id})")
        # stories have no permalink the API will give back; the account's story tray is the place to look
        return PublishResult(self.platform, True, remote_id=pub["id"], url=None)


class FacebookStoryPublisher(Publisher):
    """Upload the photo unpublished, then post it as a Page story. Same Page token as the feed."""
    platform = "facebook_story"
    env_prefix = "FACEBOOK"
    required_env = ("PAGE_ID", "PAGE_TOKEN")
    supports_link = False
    requires_image = True
    needs_public_url = True
    image_shapes = ("story",)

    def _publish(self, post: SocialPost) -> PublishResult:
        page, token = self.creds["PAGE_ID"], self.creds["PAGE_TOKEN"]
        # strict: the shape walker would hand back the 4:5 feed card, and a story is not that card
        image_url = post.image_urls.get("story")
        if not image_url:
            raise RuntimeError("no 9:16 story asset was uploaded for this article")
        photo = requests.post(f"{GRAPH}/{page}/photos", timeout=self.timeout,
                              data={"url": image_url, "published": "false", "access_token": token}).json()
        if "id" not in photo:
            raise RuntimeError(f"story photo upload refused: {photo.get('error', photo)}")
        story = requests.post(f"{GRAPH}/{page}/photo_stories", timeout=self.timeout,
                              data={"photo_id": photo["id"], "access_token": token}).json()
        if "error" in story or not (story.get("success") or story.get("post_id")):
            raise RuntimeError(f"page story refused: {story.get('error', story)}")
        post_id = story.get("post_id")
        return PublishResult(self.platform, True, remote_id=post_id or photo["id"],
                             url=f"https://www.facebook.com/{post_id}" if post_id else None)
