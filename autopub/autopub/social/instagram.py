"""Instagram (Business/Creator account via the Content Publishing API).

The image is mandatory and links in the caption are not clickable, so the card has to carry the
story on its own - that is what images.render_card(variant="portrait") is for.

Publishing is a two-step dance: create a container from a publicly reachable image URL, then
publish the container. Most real-world failures happen at step one and are permanent for that
file (Meta validates the aspect ratio, format and size and refuses rather than adjusting), so
this publisher checks what it can locally, offers the platform the tallest card first and walks
down to the next shape when a file is refused for what it *is* rather than for a transient reason.

Aspect ratio, the one that bites: Meta documents the feed range as 4:5 to 1.91:1 and returns
36003 / 2207009 for anything outside it. A 3:4 card (0.75) is below that floor today, which is
why images.py trims a 4:5 asset out of the 3:4 master unless AUTOPUB_IG_RATIO says otherwise.
`python -m autopub instagram-probe` asks Meta directly whether that is still true.
"""
from __future__ import annotations

import logging
import time

import requests

from .base import Publisher, PublishResult, SocialPost, fit_text

log = logging.getLogger(__name__)

GRAPH = "https://graph.facebook.com/v21.0"

MAX_HASHTAGS = 30          # documented caption limits: 2200 chars, 30 hashtags, 20 @ mentions
MAX_MENTIONS = 20
POLL_SECONDS = 10
POLL_LIMIT = 30            # Meta suggests giving up on a stuck container after ~5 minutes

# error subcodes that mean "this exact file will never be accepted" - a different card might be
WRONG_FILE = {2207009, 2207005, 2207004, 2207006, 2207020, 2207052}
RETRYABLE = {2207032, 2207001, 2207003}       # transient: rebuild the container and try once more
QUOTA = {2207042}


class _RejectedFile(Exception):
    """Meta refused this image for what it is. Offer it a different card."""


class _Transient(Exception):
    """Meta had a bad moment. A fresh container may work."""


def _error(payload: dict) -> tuple[int, int, str]:
    err = payload.get("error") or {}
    return int(err.get("code") or 0), int(err.get("error_subcode") or 0), str(err.get("message") or payload)[:400]


def trim_hashtags(caption: str, limit: int = MAX_HASHTAGS) -> str:
    """Drop hashtags past the platform limit - the whole caption is rejected otherwise."""
    seen = 0
    out = []
    for token in caption.split(" "):
        if token.startswith("#") and len(token) > 1:
            seen += 1
            if seen > limit:
                continue
        out.append(token)
    return " ".join(out)


class InstagramPublisher(Publisher):
    platform = "instagram"
    env_prefix = "INSTAGRAM"
    required_env = ("USER_ID", "ACCESS_TOKEN")
    supports_link = False
    requires_image = True
    needs_public_url = True
    image_shapes = ("portrait", "square", "landscape")   # tallest first: portrait owns the most feed height
    text_limit = 2200

    # ---- helpers -----------------------------------------------------------------------------

    def caption(self, post: SocialPost) -> str:
        # the link is inert on Instagram but people still copy it, and it lands in caption search
        text = trim_hashtags(post.caption_for(self.platform))
        if text.count("@") > MAX_MENTIONS:
            text = text.replace("@", "", text.count("@") - MAX_MENTIONS)
        return fit_text(text, self.text_limit, f"\n\nRead: {post.link}")

    def _reachable(self, url: str) -> None:
        """Meta fetches the image itself with a plain client. Fail early when we can see it cannot."""
        try:
            resp = requests.get(url, timeout=self.timeout, stream=True)
            content_type = resp.headers.get("Content-Type", "")
            resp.close()
        except requests.RequestException as exc:
            raise _RejectedFile(f"image URL is not fetchable: {exc}") from exc
        if resp.status_code != 200:
            raise _RejectedFile(f"image URL returned {resp.status_code}; Meta's fetcher will see the same")
        if "image/jpeg" not in content_type and "image/" not in content_type:
            raise _RejectedFile(f"image URL serves {content_type or 'no content type'}, not an image")

    def remaining_quota(self, uid: str, token: str) -> int | None:
        """Posts left in the rolling 24h window, or None when the account does not report it."""
        try:
            data = requests.get(f"{GRAPH}/{uid}/content_publishing_limit",
                                params={"fields": "config,quota_usage", "access_token": token},
                                timeout=self.timeout).json()
            row = (data.get("data") or [{}])[0]
            cap = int((row.get("config") or {}).get("quota_total", 0)) or None
            used = int(row.get("quota_usage", 0))
            return None if cap is None else max(0, cap - used)
        except Exception as exc:  # noqa: BLE001 - a missing quota reading must not stop a post
            log.debug("[instagram] quota check failed: %s", exc)
            return None

    # ---- the two-step publish ----------------------------------------------------------------

    def _container(self, uid: str, token: str, image_url: str, caption: str, alt_text: str | None) -> str:
        data = {"image_url": image_url, "caption": caption, "access_token": token}
        if alt_text:
            data["alt_text"] = alt_text[:1000]
        payload = requests.post(f"{GRAPH}/{uid}/media", data=data, timeout=self.timeout).json()
        if "id" in payload:
            return payload["id"]
        code, subcode, message = _error(payload)
        if subcode in QUOTA:
            raise RuntimeError(f"daily publishing quota reached ({subcode}): {message}")
        if subcode in WRONG_FILE or code == 36003:
            raise _RejectedFile(f"{code}/{subcode}: {message}")
        if subcode in RETRYABLE or code >= 500:
            raise _Transient(f"{code}/{subcode}: {message}")
        raise RuntimeError(f"{code}/{subcode}: {message}")

    def _await_container(self, creation_id: str, token: str) -> None:
        for _ in range(POLL_LIMIT):
            status = requests.get(f"{GRAPH}/{creation_id}", params={"fields": "status_code,status", "access_token": token},
                                  timeout=self.timeout).json()
            code = status.get("status_code")
            if code == "FINISHED":
                return
            if code in ("ERROR", "EXPIRED"):
                detail = str(status.get("status") or status)[:300]
                # the container carries the same validation verdict the create call would have
                raise (_RejectedFile if "aspect ratio" in detail.lower() else _Transient)(f"container {code}: {detail}")
            time.sleep(POLL_SECONDS)
        raise _Transient("container never finished processing")

    def _post_one(self, uid: str, token: str, image_url: str, caption: str, alt_text: str | None) -> PublishResult:
        self._reachable(image_url)
        creation_id = self._container(uid, token, image_url, caption, alt_text)
        self._await_container(creation_id, token)
        pub = requests.post(f"{GRAPH}/{uid}/media_publish",
                            data={"creation_id": creation_id, "access_token": token}, timeout=self.timeout).json()
        if "id" not in pub:
            code, subcode, message = _error(pub)
            raise (_Transient if subcode in RETRYABLE else RuntimeError)(f"publish failed {code}/{subcode}: {message}")
        media_id = pub["id"]
        info = requests.get(f"{GRAPH}/{media_id}", params={"fields": "permalink", "access_token": token},
                            timeout=self.timeout).json()
        return PublishResult(self.platform, True, remote_id=media_id, url=info.get("permalink"))

    def probe_ratio(self, image_url: str) -> tuple[bool, str]:
        """Ask Meta whether it will take this image, without posting anything.

        Creating a container is the step that validates the file; the container is simply never
        published and expires on its own after 24 hours. This is how `instagram-probe` answers
        "does the API accept a 3:4 card yet?" for a real account instead of from documentation.
        """
        uid, token = self.creds["USER_ID"], self.creds["ACCESS_TOKEN"]
        try:
            self._reachable(image_url)
            creation_id = self._container(uid, token, image_url, "ratio probe (never published)", None)
        except (_RejectedFile, _Transient, RuntimeError) as exc:
            return False, str(exc)
        return True, f"accepted, container {creation_id} (left unpublished)"

    def _publish(self, post: SocialPost) -> PublishResult:
        uid, token = self.creds["USER_ID"], self.creds["ACCESS_TOKEN"]
        caption = self.caption(post)
        alt_text = post.alt_text or post.title

        left = self.remaining_quota(uid, token)
        if left == 0:
            return PublishResult(self.platform, False, error="Instagram's 24h publishing quota is used up; skipping")

        shapes = [s for s in self.image_shapes if post.image_urls.get(s)]
        if not shapes:
            raise RuntimeError("Instagram needs a publicly reachable image URL (upload to WordPress first)")
        problems: list[str] = []
        for shape in shapes:
            url = post.image_urls[shape]
            try:
                return self._post_one(uid, token, url, caption, alt_text)
            except _RejectedFile as exc:
                # e.g. a 3:4 card against the documented 4:5 floor: a different shape is the fix
                log.warning("[instagram] %s card refused (%s); trying the next shape", shape, exc)
                problems.append(f"{shape}: {exc}")
            except _Transient as exc:
                log.warning("[instagram] transient failure on the %s card (%s); one retry", shape, exc)
                time.sleep(5)
                try:
                    return self._post_one(uid, token, url, caption, alt_text)
                except (_RejectedFile, _Transient) as exc2:
                    problems.append(f"{shape}: {exc2}")
        raise RuntimeError("every card was refused -> " + " | ".join(problems))
