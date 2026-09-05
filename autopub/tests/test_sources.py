import base64
from datetime import datetime, timedelta, timezone

from autopub import sources
from autopub.sources import Candidate, normalize_url, decode_google_news_url, google_news_rss


def test_normalize_strips_tracking():
    u = normalize_url("HTTPS://Example.com/Post/?utm_source=x&utm_medium=y&id=3&fbclid=zz#frag")
    assert u == "https://example.com/Post?id=3"


def test_google_news_rss_url():
    assert google_news_rss("digital marketing").startswith("https://news.google.com/rss/search?q=digital+marketing&hl=en-IN&gl=IN&ceid=IN:en")


def test_decode_google_news_legacy_token():
    payload = b"\x08\x13\x22\x40https://www.example.com/news/story-1\xd2\x01\x00"
    token = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    assert decode_google_news_url(f"https://news.google.com/rss/articles/{token}?oc=5") == "https://www.example.com/news/story-1"
    assert decode_google_news_url("https://news.google.com/rss/articles/!!!") is None


def test_collect_filters(monkeypatch, site):
    now = datetime.now(timezone.utc)
    feed = [
        Candidate("Great brand strategy piece", "https://a.com/1", "", now, "A"),
        Candidate("Sponsored: casino bonus", "https://a.com/2", "", now, "A"),
        Candidate("Old news", "https://a.com/3", "", now - timedelta(hours=500), "A"),
        Candidate("Dup", "https://a.com/1", "", now, "A"),
    ]
    monkeypatch.setattr(sources, "fetch_feed", lambda url, timeout=30: feed)
    site.feeds = ["https://feed"]
    site.google_news_queries = []
    got = sources.collect(site)
    assert [c.url for c in got] == ["https://a.com/1"]
