"""Filmybuff's Instagram: the poster family (a still, a centred uppercase title, the handle, the mark),
the poster slides, the curated watchlists, and the TMDB stills behind them."""
from pathlib import Path

import pytest
from PIL import Image

from autopub import carousels, images, pipeline, poster, sources, tmdb, watchlists
from autopub.cards import CardBrief
from autopub.rewrite import Captions, CuratedPost
from autopub.state import State
from tests.test_pipeline import FakeWP, Recorder

STILL = "https://example.com/still.jpg"


@pytest.fixture
def buff(settings):
    return settings.site("FILMYBUFF")


@pytest.fixture(autouse=True)
def _synthetic_still(monkeypatch):
    """No network: any still URL decodes to a warm test picture with a 'face' in it."""
    def fake_download(url, timeout):
        if not url or "none" in url:
            return None
        im = Image.new("RGB", (1600, 1000), (120, 80, 60))
        from PIL import ImageDraw
        d = ImageDraw.Draw(im)
        d.ellipse([600, 250, 1000, 750], fill=(210, 170, 140))
        return im
    monkeypatch.setattr(images, "_download_photo", fake_download)
    monkeypatch.setattr(images, "_detect_faces", lambda img: [(600, 250, 1000, 750)])
    images._LAST_PHOTO = None


def _band_is_quiet(path: Path, top: bool) -> bool:
    """The bleed band a 4:5 trim removes must carry no type: nothing brighter than the graded still."""
    with Image.open(path) as im:
        bleed = int(round(images.PORTRAIT_BLEED * images.CARD_SCALE))
        box = (0, 0, im.width, bleed) if top else (0, im.height - bleed, im.width, im.height)
        band = im.crop(box).convert("L")
        return max(band.getdata()) < 140


# ---- the card ----------------------------------------------------------------------------------------------

def test_filmybuff_is_the_poster_family_and_the_others_are_not(settings, buff):
    assert buff.brand.style == "poster"
    assert all(s.brand.style == "cards" for s in settings.sites if s.key != "FILMYBUFF")
    assert buff.watchlists and buff.formats and "Watchlists" in buff.categories


def test_the_portrait_poster_is_the_master_with_clear_bleed_bands(buff, tmp_path):
    out = images.render_card("Films to watch in your 20s", "Watchlist", buff, tmp_path / "p.jpg", "portrait",
                             backdrop_url=STILL, standfirst="coming of age cinema")
    with Image.open(out) as im:
        assert im.size == poster.MASTER
    assert _band_is_quiet(out, top=True) and _band_is_quiet(out, top=False)
    feed = images.instagram_asset(out, ratio="4:5", out_path=tmp_path / "ig.jpg")
    with Image.open(feed) as im:
        assert im.size == (1440, 1800)


def test_every_shape_renders_with_and_without_a_still(buff, tmp_path):
    got = images.render_set("Why the second weekend decides a film's fate", "Box Office", buff, tmp_path, "a", backdrop_url=STILL)
    assert set(got) == {"landscape", "square", "portrait"}
    for shape, size in (("landscape", (1200, 630)), ("square", (1080, 1080)), ("portrait", poster.MASTER)):
        with Image.open(got[shape]) as im:
            assert im.size == size
    bare = images.render_set("Why the second weekend decides a film's fate", "Box Office", buff, tmp_path, "b", backdrop_url=None)
    with Image.open(bare["portrait"]) as im:
        ink = images.hex_to_rgb(buff.brand.primary)
        assert max(abs(a - b) for a, b in zip(im.getpixel((20, im.height // 2)), ink)) < 30, "no still: the ink ground"


def test_the_poster_uses_the_still_not_a_panel(buff, tmp_path):
    """The still runs full bleed: the middle of the card is picture, not brand colour."""
    out = images.render_card("A title", "Bollywood", buff, tmp_path / "p.jpg", "portrait", backdrop_url=STILL)
    with Image.open(out) as im:
        r, g, b = im.getpixel((im.width // 2, int(im.height * 0.55)))
    assert r > g > b, "the warm graded still shows through the centre"


def test_card_kinds_map_to_a_title_and_a_subline(buff):
    quote = CardBrief("quote", "h", "Unpopular opinion", quote="SRK has not made a great film since Chak De", quote_by="Filmybuff")
    title, sub, strike = poster._texts(quote, "h", "Bollywood", None)
    assert title.startswith("“") and sub == "Unpopular opinion" and strike == "UN"
    stat = CardBrief("stat", "h", "Box Office", stat="₹350 cr", stat_label="opening weekend")
    assert poster._texts(stat, "h", "Box Office", None) == ("₹350 cr", "opening weekend", None)
    assert poster._texts(None, "Films to watch in your 20s", "Watchlist", "coming of age cinema") == ("Films to watch in your 20s", "coming of age cinema", None)
    long = "A standfirst far too long to be the small descriptive line the reference sets under a poster title, so the section stands in"
    assert poster._texts(None, "Title", "Watchlist", long)[1] == "Watchlist"


def test_slides_and_the_closing_follow_the_poster_grammar(buff, tmp_path):
    a = images.carousel_text_slide("Kapoor & Sons (2016)", "A family that says the wrong thing at the right time.", 1, 8, buff,
                                   tmp_path / "s1.jpg", kicker="Watchlist", photo_url=STILL)
    b = images.carousel_text_slide("Udaan (2010)", "Small, furious, exact.", 2, 8, buff, tmp_path / "s2.jpg", kicker="Watchlist")
    end = images.carousel_closing_slide("Films to watch in your 20s", buff, tmp_path / "end.jpg")
    for p in (a, b, end):
        with Image.open(p) as im:
            assert im.size == (1440, 1800), "slides are posted at 4:5 like the cover"
    with Image.open(b) as im:
        assert sum(1 for px in im.resize((60, 75)).getdata() if px[0] > 200 and px[1] < 90) >= 1, "the number is set in the accent"


# ---- TMDB ----------------------------------------------------------------------------------------------------

def test_tmdb_is_silent_without_a_key(monkeypatch):
    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    assert tmdb.find("Kapoor & Sons", 2016) is None


def test_tmdb_resolves_a_film_to_its_poster_and_backdrop(monkeypatch):
    monkeypatch.setenv("TMDB_API_KEY", "k")
    calls = []

    class Resp:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            return {"results": [{"id": 7, "title": "Kapoor & Sons", "release_date": "2016-03-18", "poster_path": "/p.jpg",
                                 "backdrop_path": "/b.jpg", "overview": "A family."}]}

    def fake_get(url, params=None, timeout=15):
        calls.append((url, params))
        return Resp()
    monkeypatch.setattr(tmdb.requests, "get", fake_get)
    hit = tmdb.find("Kapoor & Sons", 2016)
    assert hit["poster"] == "https://image.tmdb.org/t/p/w780/p.jpg" and hit["backdrop"].endswith("/w1280/b.jpg") and hit["year"] == 2016
    assert calls[0][0].endswith("/search/movie") and calls[0][1]["year"] == "2016" and calls[0][1]["api_key"] == "k"


# ---- watchlists ------------------------------------------------------------------------------------------------

def _wl(theme="Films to watch in your 20s", n=8):
    films = [("Kapoor & Sons", 2016, "Hindi", "Netflix"), ("Udaan", 2010, "Hindi", ""), ("Premam", 2015, "Malayalam", ""),
             ("Wake Up Sid", 2009, "Hindi", "Netflix"), ("Dil Chahta Hai", 2001, "Hindi", "Netflix"), ("Super Deluxe", 2019, "Tamil", ""),
             ("Frances Ha", 2012, "English", ""), ("Lady Bird", 2017, "English", "Netflix")][:n]
    return watchlists.Watchlist(theme=theme, subline="coming of age cinema", intro="The years when every film feels like it was made about you.",
                                entries=[watchlists.Entry(title=t, year=y, language=l, where=w, why=f"{t} is the one I keep coming back to.") for t, y, l, w in films])


def _post():
    return CuratedPost(title="Films to watch in your 20s", category="Watchlists", slug="films-to-watch-in-your-20s", excerpt="e" * 120,
                       body_html="<h2>Kapoor & Sons (2016)</h2><p>x</p>", tags=["films"], image_headline="Films to watch in your 20s",
                       image_kicker="Watchlist",
                       captions=Captions(twitter="tw", facebook="fb", instagram="ig", linkedin="li", pinterest_title="pt", pinterest="pi", telegram="tg", threads="th"))


class FakeRewriter:
    def __init__(self, wls, post=None):
        self.wls, self.post, self.systems = list(wls), post or _post(), []

    def ask(self, system, user, schema, validate=None, max_tokens=16000):
        self.systems.append(system)
        if "Make ONE curated watchlist" in system:
            return self.wls.pop(0)
        return self.post


class CarouselRecorder(Recorder):
    """An image publisher that fetches by URL and takes carousels, the way Instagram does."""
    platform = "crec"; needs_public_url = True; supports_carousel = True; image_shapes = ("portrait", "square")


def test_the_pick_prompt_carries_the_house_seeds_and_what_was_covered(buff, tmp_path):
    rw = FakeRewriter([_wl()])
    wl = watchlists.pick(rw, buff, ["Horror on OTT that is actually scary"])
    assert wl.theme == "Films to watch in your 20s"
    system = rw.systems[0]
    assert "Films to watch in your 30s" in system and "Horror on OTT that is actually scary" in system.split("ALREADY COVERED")[1]
    assert "Horror on OTT that is actually scary" not in system.split("ALREADY COVERED")[0], "a covered theme leaves the seeds"


def test_a_list_with_repeats_or_too_few_films_is_refused():
    wl = _wl(n=8)
    wl.entries[1] = wl.entries[0]
    assert len(watchlists._validate(wl).entries) == 7
    with pytest.raises(ValueError):
        watchlists._validate(_wl(n=5))


def test_the_article_carries_the_list_as_a_table_and_one_slide_per_film(buff):
    rw = FakeRewriter([], _post())
    post = watchlists.write(rw, buff, _wl(), used_tmdb=True)
    assert post.body_html.startswith('<figure class="wp-block-table">') and "Kapoor &amp; Sons" in post.body_html
    assert post.body_html.count("<tr>") == 9 and "Where to watch" in post.body_html
    assert len(post.carousel_slides) == 8 and post.carousel_slides[0].heading == "Kapoor & Sons (2016)"
    assert post.hook == "Films to watch in your 20s" and post.category == "Watchlists" and "Watchlist" in post.tags
    assert tmdb.CREDIT in post.body_html
    assert "HOUSE FORMATS" not in rw.systems[0] or "watchlist" in rw.systems[0].lower()


def test_a_watchlist_goes_out_as_an_article_and_a_poster_carousel(monkeypatch, settings, buff, tmp_path):
    settings.watchlist_hours = [0]
    settings.carousel_hours = []
    settings.reel_hours = []
    settings.scorecard_hours = []      # only the watchlist runs in this cycle
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [])
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    monkeypatch.setattr(pipeline, "narrator_for", lambda settings: None)
    monkeypatch.setattr(pipeline.video, "render_reel", lambda *a, **k: None)
    monkeypatch.setattr(tmdb, "find", lambda title, year=None, timeout=15: {"poster": f"https://img/{title}.jpg", "backdrop": "https://img/b.jpg"} if title == "Udaan" else None)
    state = State(tmp_path / "s.db")
    wp = FakeWP()
    Recorder.seen.clear()
    rw = FakeRewriter([_wl()])
    report = pipeline.run_site(buff, settings, state, rewriter=rw, wp=wp, publishers=[CarouselRecorder({})], work_dir=tmp_path / "img")
    assert report.published == ["https://marketingmentalist.in/films-to-watch-in-your-20s/"]
    created = wp.posts[0]
    assert ("categories", "Watchlists") in wp.terms and created["content"].startswith('<figure class="wp-block-table">')
    social = Recorder.seen[0]
    assert len(social.carousel_urls) == 10, "cover + 8 slides + closing"
    assert "Film images: TMDB" in social.captions["instagram"]
    assert watchlists.parse_used(state.note(buff.key, watchlists.USED_NOTE)) == ["Films to watch in your 20s"]
    assert state.is_used("https://filmybuff.com/watchlist/films-to-watch-in-your-20s", buff.key)
    # the same day: the slot is spent, the model is not asked again
    rw2 = FakeRewriter([_wl("Horror on OTT that is actually scary")])
    report2 = pipeline.run_site(buff, settings, state, rewriter=rw2, wp=wp, publishers=[CarouselRecorder({})], work_dir=tmp_path / "img")
    assert report2.published == [] and rw2.systems == []


def test_the_house_formats_reach_the_writer(buff, settings):
    from autopub import rewrite
    block = rewrite.house_formats(buff)
    assert block.startswith("\nHOUSE FORMATS") and "Unpopular opinion" in block and "watchlist" in block.lower()
    assert rewrite.house_formats(settings.site("SCREENSTAT")) == ""


def test_config_sets_the_watchlist_slots(settings):
    assert settings.watchlist_hours == [10, 16]
    assert [s.key for s in settings.sites if s.watchlists] == ["FILMYBUFF"]
