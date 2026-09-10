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
import re
import time

import requests

from ..sources import USER_AGENT
from .base import Publisher, PublishResult, SocialPost, fit_text

log = logging.getLogger(__name__)

GRAPH = "https://graph.facebook.com/v21.0"

MAX_HASHTAGS = 30          # documented caption limits: 2200 chars, 30 hashtags, 20 @ mentions
MAX_MENTIONS = 20
POLL_SECONDS = 10
POLL_TIMEOUT = 15          # a status poll that hangs must not eat the whole budget
PUBLISH_BUDGET = 240       # wall clock for one article, so a stuck container cannot stall the run

HASHTAG = re.compile(r"(?<!\w)#\w+")
MENTION = re.compile(r"(?<!\w)@\w+")

# error subcodes that mean "this exact file will never be accepted" - a different card might be
WRONG_FILE = {2207009, 2207005, 2207004, 2207006, 2207020, 2207052}
RETRYABLE = {2207032, 2207001, 2207003}       # transient: rebuild the container and try once more
# Graph's own "try again" codes. `code` here is an application error, never an HTTP status, so
# testing it against 500 (as this once did) matched nothing at all.
TRANSIENT_CODES = {1, 2, 4, 17, 32, 341, 613}
QUOTA = {2207042}


class _RejectedFile(Exception):
    """Meta refused this image for what it is. Offer it a different card."""


class _Transient(Exception):
    """Meta had a bad moment. A fresh container may work."""


def _error(payload: dict) -> tuple[int, int, str]:
    err = payload.get("error") or {}
    return int(err.get("code") or 0), int(err.get("error_subcode") or 0), str(err.get("message") or payload)[:400]


def trim_tags(caption: str, hashtags: int = MAX_HASHTAGS, mentions: int = MAX_MENTIONS) -> str:
    """Drop hashtags and mentions past the platform limits; Meta rejects the whole caption instead
    of trimming it. Matching runs over the string rather than over space-separated tokens, because
    the captions the model writes put their hashtags on their own lines at the end."""
    def cut(text: str, pattern: re.Pattern, limit: int) -> str:
        found = list(pattern.finditer(text))
        for match in reversed(found[limit:]):
            text = text[:match.start()] + text[match.end():]
        return text

    caption = cut(caption, HASHTAG, hashtags)
    caption = cut(caption, MENTION, mentions)
    return re.sub(r"[ \t]{2,}", " ", caption).strip()


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
        text = trim_tags(post.caption_for(self.platform))
        return fit_text(text, self.text_limit, f"\n\nRead: {post.link}")

    def _call(self, method: str, url: str, **kwargs) -> dict:
        """One Graph call, classified by what actually went wrong.

        Meta answers an application error in `error.code`, which is not an HTTP status, and answers
        an outage with an HTML page that json() cannot parse. Both used to surface as an unclassified
        exception that lost the post.
        """
        kwargs.setdefault("timeout", self.timeout)
        try:
            resp = requests.request(method, url, **kwargs)
        except requests.RequestException as exc:
            raise _Transient(f"network error talking to Meta: {exc}") from exc
        try:
            payload = resp.json()
        except ValueError:
            body = (resp.text or "")[:200].replace("\n", " ")
            if resp.status_code >= 500 or resp.status_code == 429:
                raise _Transient(f"HTTP {resp.status_code} with a non-JSON body: {body}") from None
            raise RuntimeError(f"HTTP {resp.status_code} with a non-JSON body: {body}") from None
        if resp.status_code >= 500 or resp.status_code == 429:
            raise _Transient(f"HTTP {resp.status_code}: {str(payload)[:200]}")
        return payload if isinstance(payload, dict) else {"data": payload}

    def _reachable(self, url: str) -> None:
        """Look at the image URL the way Meta's fetcher will, and say so when it looks wrong.

        Advisory on purpose. Our view of the URL is not Meta's: inside compose autopub reaches
        WordPress through the container network while this URL is on the public host, so a failure
        here often means our own egress, not a file Meta will refuse. Only a server that answers
        and says the file is gone is treated as a real refusal - everything else is logged and the
        container call goes ahead, because Meta's own fetcher is the authority.
        """
        try:
            resp = requests.get(url, timeout=min(self.timeout, 20), stream=True,
                                headers={"User-Agent": USER_AGENT})
            status, content_type = resp.status_code, resp.headers.get("Content-Type", "")
            resp.close()
        except requests.RequestException as exc:
            log.warning("[instagram] could not fetch %s from here (%s); letting Meta try anyway", url, exc)
            return
        if status in (404, 410):
            raise _RejectedFile(f"image URL returned {status}: the file is not there")
        if status != 200 or not content_type.startswith("image/"):
            log.warning("[instagram] %s answered %s %s from here; letting Meta try anyway",
                        url, status, content_type or "with no content type")

    def remaining_quota(self, uid: str, token: str) -> int | None:
        """Posts left in the rolling 24h window, or None when the account does not report it."""
        try:
            data = self._call("GET", f"{GRAPH}/{uid}/content_publishing_limit",
                              params={"fields": "config,quota_usage", "access_token": token})
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
        payload = self._call("POST", f"{GRAPH}/{uid}/media", data=data)
        if "id" in payload:
            return payload["id"]
        code, subcode, message = _error(payload)
        if subcode in QUOTA:
            raise RuntimeError(f"daily publishing quota reached ({subcode}): {message}")
        if subcode in WRONG_FILE or code == 36003:
            raise _RejectedFile(f"{code}/{subcode}: {message}")
        if subcode in RETRYABLE or code in TRANSIENT_CODES:
            raise _Transient(f"{code}/{subcode}: {message}")
        raise RuntimeError(f"{code}/{subcode}: {message}")

    def _await_container(self, creation_id: str, token: str, deadline: float) -> None:
        """Wait for Meta to accept the container, inside a wall-clock budget.

        Budgeting on a poll count rather than on elapsed time is how a "5 minute" wait becomes half
        an hour: each poll can itself block for the request timeout. autopub publishes one article
        at a time, so that stall is the whole fleet.
        """
        while time.monotonic() < deadline:
            status = self._call("GET", f"{GRAPH}/{creation_id}", timeout=POLL_TIMEOUT,
                                params={"fields": "status_code,status", "access_token": token})
            code = status.get("status_code")
            if code == "FINISHED":
                return
            if code in ("ERROR", "EXPIRED"):
                detail = str(status.get("status") or status)[:300]
                # the container carries the same validation verdict the create call would have
                raise (_RejectedFile if "aspect ratio" in detail.lower() else _Transient)(f"container {code}: {detail}")
            time.sleep(min(POLL_SECONDS, max(1, deadline - time.monotonic())))
        raise _Transient("container did not finish inside the publishing budget")

    def _post_one(self, uid: str, token: str, image_url: str, caption: str, alt_text: str | None,
                  deadline: float) -> PublishResult:
        self._reachable(image_url)
        creation_id = self._container(uid, token, image_url, caption, alt_text)
        self._await_container(creation_id, token, deadline)
        pub = self._call("POST", f"{GRAPH}/{uid}/media_publish",
                         data={"creation_id": creation_id, "access_token": token})
        if "id" not in pub:
            code, subcode, message = _error(pub)
            raise (_Transient if subcode in RETRYABLE else RuntimeError)(f"publish failed {code}/{subcode}: {message}")
        media_id = pub["id"]
        try:                      # the post is already live; a failed permalink lookup must not lose it
            info = self._call("GET", f"{GRAPH}/{media_id}", params={"fields": "permalink", "access_token": token})
        except Exception as exc:  # noqa: BLE001
            log.info("[instagram] published %s but could not read its permalink: %s", media_id, exc)
            info = {}
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

        # one budget for the whole article: autopub publishes serially, so a stuck container here
        # is time the other three sites do not get
        deadline = time.monotonic() + PUBLISH_BUDGET
        problems: list[str] = []
        retried = False
        for shape in shapes:
            url = post.image_urls[shape]
            if time.monotonic() >= deadline:
                problems.append(f"{shape}: ran out of time before it could be tried")
                break
            try:
                return self._post_one(uid, token, url, caption, alt_text, deadline)
            except _RejectedFile as exc:
                # e.g. a 3:4 card against the documented 4:5 floor: a different shape is the fix
                log.warning("[instagram] %s card refused (%s); trying the next shape", shape, exc)
                problems.append(f"{shape}: {exc}")
            except _Transient as exc:
                problems.append(f"{shape}: {exc}")
                if retried or time.monotonic() >= deadline:
                    continue
                retried = True   # one retry per article, not one per shape
                log.warning("[instagram] transient failure on the %s card (%s); retrying once", shape, exc)
                time.sleep(5)
                try:
                    return self._post_one(uid, token, url, caption, alt_text, deadline)
                except (_RejectedFile, _Transient) as exc2:
                    problems.append(f"{shape} (retry): {exc2}")
        raise RuntimeError("could not publish any card -> " + " | ".join(problems))
