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
FEED_RESERVE = 6        # publishes kept back for the feed posts of the next few hours


def _frames(post: SocialPost) -> list[str]:
    """The story's frames in order. Strict about the shape: the shape walker would hand back the 4:5
    feed card, and a story is not that card."""
    if post.story_urls:
        return list(post.story_urls)
    single = post.image_urls.get("story")
    return [single] if single else []


class InstagramStoryPublisher(Publisher):
    """One STORIES container per frame, published in order so the tray reads cover, content,
    closing. Same credentials as the feed publisher."""
    platform = "instagram_story"
    env_prefix = "INSTAGRAM"
    required_env = ("USER_ID", "ACCESS_TOKEN")
    supports_link = False
    requires_image = True
    needs_public_url = True
    image_shapes = ("story",)

    def _post_frame(self, uid: str, token: str, image_url: str, deadline: float) -> str:
        created = requests.post(f"{GRAPH}/{uid}/media", timeout=self.timeout,
                                data={"media_type": "STORIES", "image_url": image_url, "access_token": token}).json()
        if "id" not in created:
            code, subcode, message = _error(created)
            raise RuntimeError(f"story container refused {code}/{subcode}: {message}")
        creation_id = created["id"]
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
                return pub["id"]
            code, subcode, message = _error(pub)
            if subcode == 2207027 and time.monotonic() + POLL_SECONDS < deadline:   # not ready yet: publish again
                time.sleep(POLL_SECONDS)
                continue
            raise RuntimeError(f"story publish failed {code}/{subcode}: {message} (container {creation_id})")

    def remaining_quota(self, uid: str, token: str) -> int | None:
        """Publishes left in the account's rolling 24h window, or None when it does not report one."""
        try:
            data = requests.get(f"{GRAPH}/{uid}/content_publishing_limit", timeout=POLL_TIMEOUT,
                                params={"fields": "config,quota_usage", "access_token": token}).json()
            row = (data.get("data") or [{}])[0]
            cap = int((row.get("config") or {}).get("quota_total", 0)) or None
            return None if cap is None else max(0, cap - int(row.get("quota_usage", 0)))
        except Exception as exc:  # noqa: BLE001 - a missing quota reading must not stop a story
            log.debug("[instagram_story] quota check failed: %s", exc)
            return None

    def _publish(self, post: SocialPost) -> PublishResult:
        uid, token = self.creds["USER_ID"], self.creds["ACCESS_TOKEN"]
        frames = _frames(post)
        if not frames:
            raise RuntimeError("no 9:16 story asset was uploaded for this article")
        # every frame is a publish. If Meta counts stories against the account's daily allowance, a
        # five-frame story at one article an hour could starve the feed post, which matters more:
        # keep a reserve for it and shorten the story instead.
        left = self.remaining_quota(uid, token)
        if left is not None and left < len(frames) + FEED_RESERVE:
            keep = max(0, left - FEED_RESERVE)
            if keep == 0:
                return PublishResult(self.platform, False, error="Instagram's 24h publishing allowance is nearly used; story skipped to keep the feed post")
            log.info("[instagram_story] allowance left %d; posting %d of %d frames", left, keep, len(frames))
            frames = frames[:keep]
        deadline = time.monotonic() + STORY_BUDGET * len(frames)
        ids, problems = [], []
        for i, url in enumerate(frames, 1):
            try:
                ids.append(self._post_frame(uid, token, url, deadline))
            except RuntimeError as exc:
                problems.append(f"frame {i}: {exc}")
                if i == 1:
                    raise      # no cover, no story
                log.warning("[instagram_story] %s; the story stops at frame %d of %d", exc, i - 1, len(frames))
                break
        # stories have no permalink the API will give back; the account's story tray is the place to look
        return PublishResult(self.platform, True, remote_id=",".join(ids), url=None,
                             error="; ".join(problems) or None)


class FacebookStoryPublisher(Publisher):
    """Each frame: upload the photo unpublished, then post it as a Page story. Same Page token."""
    platform = "facebook_story"
    env_prefix = "FACEBOOK"
    required_env = ("PAGE_ID", "PAGE_TOKEN")
    supports_link = False
    requires_image = True
    needs_public_url = True
    image_shapes = ("story",)

    def _post_frame(self, page: str, token: str, image_url: str) -> str:
        photo = requests.post(f"{GRAPH}/{page}/photos", timeout=self.timeout,
                              data={"url": image_url, "published": "false", "access_token": token}).json()
        if "id" not in photo:
            raise RuntimeError(f"story photo upload refused: {photo.get('error', photo)}")
        story = requests.post(f"{GRAPH}/{page}/photo_stories", timeout=self.timeout,
                              data={"photo_id": photo["id"], "access_token": token}).json()
        if "error" in story or not (story.get("success") or story.get("post_id")):
            raise RuntimeError(f"page story refused: {story.get('error', story)}")
        return story.get("post_id") or photo["id"]

    def _publish(self, post: SocialPost) -> PublishResult:
        page, token = self.creds["PAGE_ID"], self.creds["PAGE_TOKEN"]
        frames = _frames(post)
        if not frames:
            raise RuntimeError("no 9:16 story asset was uploaded for this article")
        ids, problems = [], []
        for i, url in enumerate(frames, 1):
            try:
                ids.append(self._post_frame(page, token, url))
            except RuntimeError as exc:
                problems.append(f"frame {i}: {exc}")
                if i == 1:
                    raise
                log.warning("[facebook_story] %s; the story stops at frame %d of %d", exc, i - 1, len(frames))
                break
        first = ids[0]
        return PublishResult(self.platform, True, remote_id=",".join(ids),
                             url=f"https://www.facebook.com/{first}" if "_" in first else None,
                             error="; ".join(problems) or None)
