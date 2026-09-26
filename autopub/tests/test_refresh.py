"""Posts already on a poster-style site get the clean featured image: the same still, no title baked in."""
from PIL import Image

from autopub import extract, poster, refresh
from autopub.state import State
from tests.test_pipeline import FakeWP


class UpdatingWP(FakeWP):
    def __init__(self):
        super().__init__()
        self.updates = []

    def update_post(self, post_id, **fields):
        self.updates.append((post_id, fields))
        return {"id": post_id}


def _state(tmp_path, site):
    state = State(tmp_path / "s.db")
    for url, pid, title in (("https://bh.com/war3", 11, "War 3 trailer"),
                            ("https://www.youtube.com/watch?v=abc123xyz", 12, "The trailer"),
                            (f"https://{site.domain}/watchlist/food-is-the-lead", 13, "Food is the lead")):
        state.claim(url, site.key, title)
        state.mark_published(url, site.key, pid, f"https://{site.domain}/{pid}/", title)
    state.claim("https://bh.com/failed", site.key, "x")
    state.mark_failed("https://bh.com/failed", site.key, "boom")
    return state


def test_the_still_comes_from_the_article_the_upload_or_nowhere(monkeypatch, settings):
    site = settings.site("FILMYBUFF")
    monkeypatch.setattr(extract, "extract", lambda url, timeout=30: extract.Article(url=url, title="t", text="", sitename="BH", image="https://bh.com/still.jpg"))
    assert refresh.source_still("https://bh.com/war3", site) == "https://bh.com/still.jpg"
    assert refresh.source_still("https://www.youtube.com/watch?v=abc123xyz", site) == "https://i.ytimg.com/vi/abc123xyz/maxresdefault.jpg"
    assert refresh.source_still(f"https://{site.domain}/watchlist/food", site) is None, "our own claim url has no source photo"

    def gone(url, timeout=30):
        raise RuntimeError("410")
    monkeypatch.setattr(extract, "extract", gone)
    assert refresh.source_still("https://bh.com/gone", site) is None


def test_every_published_post_gets_a_clean_still_and_failed_ones_are_left_alone(monkeypatch, settings, tmp_path):
    site = settings.site("FILMYBUFF")
    state = _state(tmp_path, site)
    monkeypatch.setattr(extract, "extract", lambda url, timeout=30: extract.Article(url=url, title="t", text="", sitename="BH", image="https://bh.com/still.jpg"))
    monkeypatch.setattr(poster, "_backdrop", lambda url, size, **kw: (Image.new("RGB", size, (90, 40, 30)), []))
    wp = UpdatingWP()
    done = refresh.refresh(site, settings, state, wp, tmp_path / "img")
    assert [pid for pid, _ in done] == [13, 12, 11], "newest first, the failed claim is not a post"
    assert dict(done)[13] == "ground" and dict(done)[11] == "https://bh.com/still.jpg"
    assert [pid for pid, _ in wp.updates] == [13, 12, 11]
    assert all(f == {"featured_media": i + 1} for i, (_, f) in enumerate(wp.updates))
    with Image.open(wp.media[0]) as im:
        assert im.size == poster.FEATURED


def test_dry_run_touches_nothing_and_limit_takes_the_newest(monkeypatch, settings, tmp_path):
    site = settings.site("FILMYBUFF")
    state = _state(tmp_path, site)
    monkeypatch.setattr(extract, "extract", lambda url, timeout=30: extract.Article(url=url, title="t", text="", sitename="BH", image=None))
    wp = UpdatingWP()
    done = refresh.refresh(site, settings, state, None, tmp_path / "img", limit=2, dry_run=True)
    assert [pid for pid, _ in done] == [13, 12] and not wp.updates and not wp.media


def test_one_bad_post_does_not_stop_the_rest(monkeypatch, settings, tmp_path):
    site = settings.site("FILMYBUFF")
    state = _state(tmp_path, site)
    monkeypatch.setattr(extract, "extract", lambda url, timeout=30: extract.Article(url=url, title="t", text="", sitename="BH", image=None))

    class FlakyWP(UpdatingWP):
        def update_post(self, post_id, **fields):
            if post_id == 12:
                raise RuntimeError("403")
            return super().update_post(post_id, **fields)

    wp = FlakyWP()
    done = refresh.refresh(site, settings, state, wp, tmp_path / "img")
    assert [pid for pid, _ in done] == [13, 11]
