"""Minimal WordPress REST API client using Application Passwords."""
from __future__ import annotations

import logging
import mimetypes
from pathlib import Path

import requests

log = logging.getLogger(__name__)


class WordPressError(Exception):
    pass


class WordPress:
    def __init__(self, base_url: str, user: str, app_password: str, public_host: str | None = None,
                 timeout: int = 60, session: requests.Session | None = None):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = session or requests.Session()
        self.session.auth = (user, app_password.replace(" ", ""))
        self.session.headers.update({"User-Agent": "autopub/0.1", "Accept": "application/json"})
        # When talking to the container directly we still present the public host so WordPress
        # builds correct URLs and treats the request as HTTPS (required for app passwords).
        if public_host and public_host not in self.base_url:
            self.session.headers.update({"Host": public_host, "X-Forwarded-Proto": "https"})

    def _url(self, path: str) -> str:
        return f"{self.base_url}/wp-json/wp/v2/{path.lstrip('/')}"

    def _request(self, method: str, path: str, **kwargs) -> dict | list:
        kwargs.setdefault("timeout", self.timeout)
        resp = self.session.request(method, self._url(path), **kwargs)
        if resp.status_code >= 400:
            try:
                detail = resp.json()
            except ValueError:
                detail = resp.text[:500]
            raise WordPressError(f"{method} {path} -> {resp.status_code}: {detail}")
        return resp.json()

    def ping(self) -> dict:
        me = self._request("GET", "users/me", params={"context": "edit"})
        return me  # type: ignore[return-value]

    def upload_media(self, path: Path, title: str, alt_text: str = "", caption: str = "") -> dict:
        mime = mimetypes.guess_type(str(path))[0] or "image/jpeg"
        with open(path, "rb") as fh:
            data = fh.read()
        media = self._request(
            "POST", "media", data=data,
            headers={"Content-Type": mime, "Content-Disposition": f'attachment; filename="{path.name}"'},
        )
        media_id = media["id"]  # type: ignore[index]
        self._request("POST", f"media/{media_id}", json={"title": title, "alt_text": alt_text or title, "caption": caption})
        log.info("uploaded media %s -> id=%s url=%s", path.name, media_id, media.get("source_url"))  # type: ignore[union-attr]
        return media  # type: ignore[return-value]

    def ensure_term(self, taxonomy: str, name: str) -> int | None:
        """taxonomy is 'categories' or 'tags'. Returns the term id, creating it if needed.

        Returns None (and logs) when the account may not create terms, so a post can still go
        out without that category/tag instead of failing entirely.
        """
        found = self._request("GET", taxonomy, params={"search": name, "per_page": 20})
        for term in found:  # type: ignore[union-attr]
            if term["name"].strip().lower() == name.strip().lower():
                return int(term["id"])
        try:
            created = self._request("POST", taxonomy, json={"name": name})
            return int(created["id"])  # type: ignore[index]
        except WordPressError as exc:
            if "term_exists" in str(exc):
                found = self._request("GET", taxonomy, params={"search": name, "per_page": 50})
                for term in found:  # type: ignore[union-attr]
                    if term["name"].strip().lower() == name.strip().lower():
                        return int(term["id"])
            if "403" in str(exc) or "rest_cannot_create" in str(exc) or "rest_forbidden" in str(exc):
                log.warning("not allowed to create %s %r (give the autopub user the editor role): %s", taxonomy, name, exc)
                return None
            raise

    def create_post(self, *, title: str, content: str, excerpt: str, slug: str, category_ids: list[int],
                    tag_ids: list[int], featured_media: int | None = None, status: str = "publish") -> dict:
        payload = {
            "title": title,
            "content": content,
            "excerpt": excerpt,
            "slug": slug,
            "status": status,
            "categories": category_ids,
            "tags": tag_ids,
            "comment_status": "open",
        }
        if featured_media:
            payload["featured_media"] = featured_media
        post = self._request("POST", "posts", json=payload)
        log.info("published post id=%s %s", post["id"], post.get("link"))  # type: ignore[index]
        return post  # type: ignore[return-value]
