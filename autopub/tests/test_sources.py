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


REDDIT_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry>
<title>Real Movie News Headline</title>
<link href="https://www.reddit.com/r/movies/comments/abc123/real_movie_news_headline/"/>
<id>https://www.reddit.com/r/movies/comments/abc123/</id>
<updated>2026-09-30T12:00:00+00:00</updated>
<summary type="html"><![CDATA[<span><a href="https://www.realsite.com/article-1?utm_source=reddit">[link]</a></span> <span><a href="https://www.reddit.com/r/movies/comments/abc123/real_movie_news_headline/">[comments]</a></span>]]></summary>
</entry>
<entry>
<title>Self text discussion</title>
<link href="https://www.reddit.com/r/movies/comments/def456/self_text_discussion/"/>
<id>https://www.reddit.com/r/movies/comments/def456/</id>
<updated>2026-09-30T11:00:00+00:00</updated>
<summary type="html"><![CDATA[<div class="md"><p>Just a discussion, no link here.</p></div>]]></summary>
</entry>
<entry>
<title>Reddit-hosted image</title>
<link href="https://www.reddit.com/r/movies/comments/ghi789/reddit_hosted_image/"/>
<id>https://www.reddit.com/r/movies/comments/ghi789/</id>
<updated>2026-09-30T10:00:00+00:00</updated>
<summary type="html"><![CDATA[<span><a href="https://i.redd.it/abc.jpg">[link]</a></span> <span><a href="https://www.reddit.com/r/movies/comments/ghi789/">[comments]</a></span>]]></summary>
</entry>
</feed>"""


def test_fetch_reddit_keeps_only_link_posts_to_a_real_article(monkeypatch):
    class Resp:
        content = REDDIT_FEED.encode()
        def raise_for_status(self): pass

    monkeypatch.setattr(sources.requests, "get", lambda url, headers=None, timeout=30: Resp())
    got = sources.fetch_reddit("movies")
    assert [c.title for c in got] == ["Real Movie News Headline"], "the self-text post and the reddit-hosted image are left out"
    assert got[0].url == "https://www.realsite.com/article-1", "tracking params stripped, the real article kept, not the reddit thread"
    assert got[0].source == "r/movies"


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


def test_collect_also_pulls_from_reddit_subreddits(monkeypatch, site):
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(sources, "fetch_feed", lambda url, timeout=30: [])
    monkeypatch.setattr(sources, "fetch_reddit", lambda subreddit, timeout=30: {
        "movies": [Candidate("A real article via r/movies", "https://b.com/1", "", now, "r/movies")],
        "boxoffice": [Candidate("Sponsored: casino bonus", "https://b.com/2", "", now, "r/boxoffice"),
                     Candidate("A real article via r/movies", "https://b.com/1", "", now, "r/boxoffice")],
    }.get(subreddit, []))
    site.feeds = []
    site.google_news_queries = []
    site.reddit_subreddits = ["movies", "boxoffice"]
    got = sources.collect(site)
    assert [c.url for c in got] == ["https://b.com/1"], "the same filters and dedup apply, across both subreddits"
