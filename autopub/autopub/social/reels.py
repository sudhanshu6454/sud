"""Video: the article's reel on Instagram and the same file as a video post on the Facebook Page.

Both take a publicly reachable MP4 (the WordPress media URL, like the images). Instagram's Reels
endpoint is the same container-then-publish dance as the feed, only the container takes longer to
finish because the video is transcoded first; the budget here allows for that. Each runs as its own
publisher so a failed reel never costs the feed post, and each outcome is its own row.
"""
from __future__ import annotations

import logging
import time

import requests

from .base import PublishResult, SocialPost
from .facebook import GRAPH as FB_GRAPH
from .facebook import FacebookPublisher
from .instagram import GRAPH, POLL_SECONDS, InstagramPublisher, _error

log = logging.getLogger(__name__)

REEL_BUDGET = 600       # seconds: Meta transcodes the video before the container reads FINISHED


class InstagramReelPublisher(InstagramPublisher):
    """A REELS container from the video URL, the feed caption, the card as the cover."""
    platform = "instagram_reel"
    requires_image = False
    supports_carousel = False
    wants_video = True
    replaces = "instagram"          # the reel is the article's feed post; the card is not posted beside it

    def _publish(self, post: SocialPost) -> PublishResult:
        uid, token = self.creds["USER_ID"], self.creds["ACCESS_TOKEN"]
        if not post.video_url:
            raise RuntimeError("no reel was rendered and uploaded for this article")
        if self.remaining_quota(uid, token) == 0:
            return PublishResult(self.platform, False, error="Instagram's 24h publishing quota is used up; reel skipped")
        data = {"media_type": "REELS", "video_url": post.video_url, "caption": self.caption(post, carousel=False),
                "share_to_feed": "true" if post.video_share_to_feed else "false", "access_token": token}
        if post.video_cover_url:
            data["cover_url"] = post.video_cover_url
        payload = self._call("POST", f"{GRAPH}/{uid}/media", data=data)
        if "id" not in payload:
            code, subcode, message = _error(payload)
            raise RuntimeError(f"reel container refused {code}/{subcode}: {message}")
        deadline = time.monotonic() + REEL_BUDGET
        self._await_container(payload["id"], token, deadline)
        return self._publish_container(uid, token, payload["id"], deadline, format="reel")


class FacebookVideoPublisher(FacebookPublisher):
    """The same MP4 as a Page video post, description carrying the caption and the link."""
    platform = "facebook_video"
    requires_image = False
    supports_carousel = False
    wants_video = True
    replaces = "facebook"

    def _publish(self, post: SocialPost) -> PublishResult:
        page, token = self.creds["PAGE_ID"], self.creds["PAGE_TOKEN"]
        if not post.video_url:
            raise RuntimeError("no video was rendered and uploaded for this article")
        resp = requests.post(f"{FB_GRAPH}/{page}/videos", timeout=self.timeout,
                             data={"file_url": post.video_url, "description": self._text_with_link(post),
                                   "title": post.title[:100], "access_token": token})
        data = resp.json()
        if resp.status_code >= 400 or "error" in data or "id" not in data:
            raise RuntimeError(data.get("error", data))
        return PublishResult(self.platform, True, remote_id=data["id"], url=f"https://www.facebook.com/{page}/videos/{data['id']}",
                             format="video")
