from datetime import datetime, timezone

from autopub import extract, pipeline, sources
from autopub.extract import Article
from autopub.rewrite import Captions, CuratedPost
from autopub.social.base import Publisher, PublishResult
from autopub.state import State


class FakeRewriter:
    def rewrite(self, site, article):
        return CuratedPost(
            title=f"Curated: {article.title}", slug="curated-story", excerpt="e" * 120,
            body_html="<p>x</p>", tags=["a", "b", "c", "d"], image_headline="Curated story", image_kicker="News",
            captions=Captions(twitter="tw", facebook="fb", instagram="ig", linkedin="li", pinterest_title="pt",
                              pinterest="pi", telegram="tg", threads="th"),
        )


class FakeWP:
    def __init__(self):
        self.posts = []
        self.media = []

    def upload_media(self, path, title, alt_text="", caption=""):
        self.media.append(path)
        return {"id": len(self.media), "source_url": f"https://site/{path.name}"}

    def ensure_term(self, taxonomy, name):
        return 1

    def create_post(self, **kw):
        self.posts.append(kw)
        return {"id": 10 + len(self.posts), "link": f"https://marketingmentalist.in/{kw['slug']}/"}


class Recorder(Publisher):
    platform = "rec"; env_prefix = "REC"; required_env = ()
    seen = []

    def _publish(self, post):
        Recorder.seen.append(post)
        return PublishResult(self.platform, True, remote_id="r1", url="https://rec/1")


class ImageOnly(Publisher):
    platform = "imgonly"; env_prefix = "IMG"; required_env = (); requires_image = True; prefers_square = True; supports_link = False

    def _publish(self, post):
        assert post.image_url(prefer_square=True).endswith("-square.jpg")
        return PublishResult(self.platform, True, remote_id="i1")


def test_full_run_publishes_and_syndicates(monkeypatch, settings, site, tmp_path):
    now = datetime.now(timezone.utc)
    cands = [
        sources.Candidate("Story one", "https://pub.com/one", "", now, "Pub"),
        sources.Candidate("Too short", "https://pub.com/short", "", now, "Pub"),
        sources.Candidate("Story three", "https://pub.com/three", "", now, "Pub"),
    ]
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: cands)

    def fake_extract(url, timeout=30):
        words = 20 if "short" in url else 600
        return Article(url=url, title=url.rsplit("/", 1)[1], text="w " * words, sitename="Pub", image=None)

    monkeypatch.setattr(extract, "extract", fake_extract)
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)

    state = State(tmp_path / "s.db")
    state.claim("https://pub.com/three", "CRAZY")       # already used by another site -> skipped by dedupe
    wp = FakeWP()
    Recorder.seen.clear()
    report = pipeline.run_site(site, settings, state, rewriter=FakeRewriter(), wp=wp, publishers=[Recorder({}), ImageOnly({})],
                               work_dir=tmp_path / "img", limit=5)

    assert report.published == ["https://marketingmentalist.in/curated-story/"]
    assert report.skipped == 1 and report.failed == 0
    assert report.social_ok == 2 and report.social_failed == 0
    assert len(wp.media) == 2 and wp.posts[0]["featured_media"] == 1
    social = Recorder.seen[0]
    assert social.link == "https://marketingmentalist.in/curated-story/"
    assert social.image_landscape.exists() and social.image_square.exists()
    assert state.count("MENTALIST") == 1
    assert [r["platform"] for r in state.social_results("https://pub.com/one", "MENTALIST")] == ["rec", "imgonly"]
    # second run: nothing new
    report2 = pipeline.run_site(site, settings, state, rewriter=FakeRewriter(), wp=wp, publishers=[], work_dir=tmp_path / "img")
    assert report2.published == []


def test_gap_between_posts(monkeypatch, settings, site, tmp_path):
    settings.min_gap_minutes_between_posts = 30
    state = State(tmp_path / "s.db")
    state.claim("https://pub.com/prev", site.key)
    state.mark_published("https://pub.com/prev", site.key, 1, "https://x/", "t")
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: (_ for _ in ()).throw(AssertionError("should not fetch")))
    report = pipeline.run_site(site, settings, state, rewriter=FakeRewriter(), wp=FakeWP(), publishers=[])
    assert report.candidates == 0 and report.published == []
