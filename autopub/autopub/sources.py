"""Discover candidate stories from RSS/Atom feeds and Google News searches."""
from __future__ import annotations

import base64
import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, quote_plus, urlencode, urlsplit, urlunsplit

import feedparser
import requests

from .config import Site

log = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 autopub/0.1"

GOOGLE_NEWS_MAX_FAILURES = 3

TRACKING_PARAMS = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
                   "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source", "cmpid", "ncid", "oc"}


@dataclass
class Candidate:
    title: str
    url: str
    summary: str
    published: datetime | None
    source: str

    @property
    def age_hours(self) -> float | None:
        if not self.published:
            return None
        return (datetime.now(timezone.utc) - self.published).total_seconds() / 3600


def normalize_url(url: str) -> str:
    parts = urlsplit(url.strip())
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k.lower() not in TRACKING_PARAMS]
    path = parts.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    return urlunsplit((parts.scheme.lower() or "https", parts.netloc.lower(), path, urlencode(query), ""))


def google_news_rss(query: str, hl: str = "en-IN", gl: str = "IN") -> str:
    return f"https://news.google.com/rss/search?q={quote_plus(query)}&hl={hl}&gl={gl}&ceid={gl}:{hl.split('-')[0]}"


def _parse_time(entry) -> datetime | None:
    for attr in ("published_parsed", "updated_parsed"):
        val = getattr(entry, attr, None) or entry.get(attr)
        if val:
            try:
                return datetime.fromtimestamp(time.mktime(val), tz=timezone.utc)
            except (OverflowError, ValueError):
                continue
    return None


def _strip_html(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()


def decode_google_news_url(url: str) -> str | None:
    """Decode a legacy (base64) news.google.com article link into the publisher URL, or None."""
    m = re.search(r"/(?:articles|rss/articles)/([^/?]+)", url)
    if not m:
        return None
    token = m.group(1)
    try:
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
    except Exception:  # noqa: BLE001
        return None
    found = re.findall(rb"https?://[\x21-\x7e]+", raw)
    for cand in found:
        text = cand.decode("ascii", "ignore")
        text = re.split(r"[\x00-\x1f\xd2\xe2\x01\x08\x12\x1a\"']", text)[0]
        if "news.google.com" not in text and "." in text:
            return text
    return None


_GN_CACHE: dict[str, str | None] = {}


def resolve_google_news_url(url: str, timeout: int = 20) -> str | None:
    """Resolve any news.google.com article link to the publisher URL.

    Tries the legacy base64 decode first, then the two-step flow the current encoding needs:
    fetch the article stub for its signature/timestamp, then ask Google's internal
    `batchexecute` endpoint for the real URL. Returns None when Google changes things again.
    """
    if url in _GN_CACHE:
        return _GN_CACHE[url]
    result = decode_google_news_url(url)
    if not result:
        result = _resolve_google_news_batchexecute(url, timeout)
    _GN_CACHE[url] = result
    return result


def _resolve_google_news_batchexecute(url: str, timeout: int) -> str | None:
    m = re.search(r"/(?:articles|rss/articles|read)/([^/?]+)", url)
    if not m:
        return None
    art_id = m.group(1)
    headers = {"User-Agent": USER_AGENT}
    try:
        page = requests.get(f"https://news.google.com/articles/{art_id}", headers=headers, timeout=timeout)
        page.raise_for_status()
        sig = re.search(r'data-n-a-sg="([^"]+)"', page.text)
        ts = re.search(r'data-n-a-ts="([^"]+)"', page.text)
        if not (sig and ts):
            return None
        inner = json.dumps(["garturlreq", [["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None, None, None, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0], art_id, int(ts.group(1)), sig.group(1)])
        payload = {"f.req": json.dumps([[["Fbv4je", inner, None, "generic"]]])}
        resp = requests.post("https://news.google.com/_/DotsSplashUi/data/batchexecute", data=payload,
                             headers={**headers, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"}, timeout=timeout)
        resp.raise_for_status()
        body = resp.text.split("\n\n", 1)[-1] if resp.text.startswith(")]}'") else resp.text
        for line in body.splitlines():
            line = line.strip()
            if not line.startswith("[["):
                continue
            outer = json.loads(line)
            for item in outer:
                if isinstance(item, list) and len(item) > 2 and item[0] == "wrb.fr" and isinstance(item[2], str):
                    decoded = json.loads(item[2])
                    if isinstance(decoded, list) and len(decoded) > 1 and isinstance(decoded[1], str) and decoded[1].startswith("http"):
                        return decoded[1]
    except (requests.RequestException, ValueError, IndexError, TypeError) as exc:
        log.debug("google news resolve failed for %s: %s", url, exc)
    return None


def fetch_feed(url: str, timeout: int = 30) -> list[Candidate]:
    try:
        resp = requests.get(url, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"}, timeout=timeout)
        resp.raise_for_status()
    except requests.RequestException as exc:
        log.warning("feed %s failed: %s", url, exc)
        return []
    parsed = feedparser.parse(resp.content)
    source = (parsed.feed.get("title") or urlsplit(url).netloc).strip()
    out: list[Candidate] = []
    gn_failures = 0
    for entry in parsed.entries:
        link = entry.get("link") or ""
        title = _strip_html(entry.get("title") or "")
        if not link or not title:
            continue
        if "news.google.com" in link:
            # Google rate-limits aggressive resolving; stop after a few misses instead of hammering it
            if gn_failures >= GOOGLE_NEWS_MAX_FAILURES:
                continue
            decoded = resolve_google_news_url(link, timeout=timeout)
            if not decoded:
                gn_failures += 1
                if gn_failures == GOOGLE_NEWS_MAX_FAILURES:
                    log.warning("google news links are not resolving right now (%s); skipping the rest of this feed", url)
                continue
            link = decoded
            # Google News puts the publisher name after " - " in the title
            if " - " in title:
                title, _, pub = title.rpartition(" - ")
                source = pub.strip() or source
        summary = _strip_html(entry.get("summary") or entry.get("description") or "")
        out.append(Candidate(title=title, url=normalize_url(link), summary=summary[:600], published=_parse_time(entry), source=source))
    return out


def _matches(cand: Candidate, site: Site) -> bool:
    hay = f"{cand.title} {cand.summary}".lower()
    if any(k.lower() in hay for k in site.exclude_keywords):
        return False
    if site.include_keywords and not any(k.lower() in hay for k in site.include_keywords):
        return False
    return True


def collect(site: Site, timeout: int = 30) -> list[Candidate]:
    """All fresh, on-topic candidates for a site, newest first, deduplicated by URL."""
    urls = list(site.feeds) + [google_news_rss(q) for q in site.google_news_queries]
    cutoff = datetime.now(timezone.utc) - timedelta(hours=site.max_age_hours)
    seen: set[str] = set()
    out: list[Candidate] = []
    for feed_url in urls:
        for cand in fetch_feed(feed_url, timeout=timeout):
            if cand.url in seen:
                continue
            if cand.published and cand.published < cutoff:
                continue
            if not _matches(cand, site):
                continue
            seen.add(cand.url)
            out.append(cand)
    # newest first; undated entries go last
    out.sort(key=lambda c: c.published or datetime.fromtimestamp(0, tz=timezone.utc), reverse=True)
    log.info("[%s] %d candidates from %d feeds", site.key, len(out), len(urls))
    return out
