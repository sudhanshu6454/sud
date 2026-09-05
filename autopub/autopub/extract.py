"""Fetch a story and pull out clean article text + metadata."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import requests
import trafilatura

from .sources import USER_AGENT

log = logging.getLogger(__name__)

MAX_SOURCE_CHARS = 20_000


class ExtractionError(Exception):
    pass


@dataclass
class Article:
    url: str
    title: str
    text: str
    description: str = ""
    image: str | None = None
    author: str | None = None
    date: str | None = None
    sitename: str | None = None

    @property
    def word_count(self) -> int:
        return len(self.text.split())


def fetch_html(url: str, timeout: int = 30) -> tuple[str, str]:
    resp = requests.get(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*"}, timeout=timeout, allow_redirects=True)
    resp.raise_for_status()
    ctype = resp.headers.get("content-type", "")
    if "html" not in ctype and "xml" not in ctype and not resp.text.lstrip().startswith("<"):
        raise ExtractionError(f"not an HTML page ({ctype})")
    return resp.url, resp.text


def extract(url: str, timeout: int = 30) -> Article:
    final_url, html = fetch_html(url, timeout=timeout)
    raw = trafilatura.extract(
        html,
        url=final_url,
        output_format="json",
        with_metadata=True,
        include_comments=False,
        include_tables=False,
        favor_precision=True,
    )
    if not raw:
        raise ExtractionError("trafilatura found no article body")
    data = json.loads(raw)
    text = (data.get("text") or data.get("raw_text") or "").strip()
    if not text:
        raise ExtractionError("empty article text")
    if len(text) > MAX_SOURCE_CHARS:
        log.info("source text %d chars, capping at %d for the model", len(text), MAX_SOURCE_CHARS)
        text = text[:MAX_SOURCE_CHARS]
    return Article(
        url=final_url,
        title=(data.get("title") or "").strip(),
        text=text,
        description=(data.get("description") or data.get("excerpt") or "").strip(),
        image=data.get("image") or None,
        author=data.get("author") or None,
        date=data.get("date") or None,
        sitename=data.get("sitename") or data.get("source-hostname") or None,
    )
