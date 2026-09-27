"""Posts already on a poster-style site get the 3:4 poster as their featured image."""
from PIL import Image

from autopub import extract, poster, refresh, tmdb
from autopub.state import State
from tests.test_pipeline import FakeWP


class UpdatingWP(FakeWP):
    def __init__(self):
        super().__init__()
        self.updates = []

    content = {}

    def get_post(self, post_id, embed_terms=False):
        return {"id": post_id, "content": {"rendered": self.content.get(post_id, "")}, "title": {"rendered": f"Post &#8216;{post_id}&#8217;"},
                "excerpt": {"rendered": "<p>The standfirst, in one breath. [&hellip;]</p>"}, "categories": [1, 7]}

    def get_category(self, term_id):
        return {"id": term_id, "name": {1: "Uncategorized", 7: "Watchlists"}[term_id]}

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


def test_a_watchlist_gets_the_backdrop_of_its_first_film_and_a_scorecard_its_portrait(monkeypatch, settings, tmp_path):
    site = settings.site("FILMYBUFF")
    asked = []
    monkeypatch.setattr(tmdb, "film_still", lambda title, year=None, timeout=15, exact=False: (asked.append((title, year)), {"url": "https://tmdb/lunchbox.jpg", "title": title, "year": year, "kind": "movie", "id": 1, "credit": "c"} if title == "The Lunchbox" else None)[1])
    table = "<table><tr><td>1</td><td><strong>Ramen Western</strong> (2019)</td><td>Japanese</td></tr><tr><td>2</td><td><strong>The Lunchbox</strong> (2013)</td><td>Hindi</td></tr></table>"
    assert refresh.still_in_post(table) == "https://tmdb/lunchbox.jpg"
    assert asked == [("Ramen Western", "2019"), ("The Lunchbox", "2013")]
    assert refresh.still_in_post('<figure><img src="https://site/portrait.jpg" alt="x"></figure>') == "https://site/portrait.jpg", "no film named: the article's own image"
    assert refresh.still_in_post('<figure><img src="https://site/portrait.jpg" alt="x"></figure>' + table) == "https://tmdb/lunchbox.jpg", "a film named beats the image"
    assert refresh.still_in_post("<p>no pictures</p>") is None
    # the refresh reads the post for our own claim urls, and only for those
    state = _state(tmp_path, site)
    monkeypatch.setattr(extract, "extract", lambda url, timeout=30: extract.Article(url=url, title="t", text="", sitename="BH", image="https://bh.com/still.jpg"))
    monkeypatch.setattr(poster, "_backdrop", lambda url, size, **kw: (Image.new("RGB", size, (90, 40, 30)), []))
    wp = UpdatingWP(); wp.content = {13: table}
    done = dict(refresh.refresh(site, settings, state, wp, tmp_path / "img"))
    assert done[13] == "https://tmdb/lunchbox.jpg" and done[11] == "https://bh.com/still.jpg"


def test_every_published_post_gets_its_poster_and_failed_ones_are_left_alone(monkeypatch, settings, tmp_path):
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
        assert im.size == poster.MASTER, "the website's image is the 3:4 poster"


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
