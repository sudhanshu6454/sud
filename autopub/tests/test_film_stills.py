"""Filmybuff's poster is always built on an original frame from the film the story is about: the writer names
the film, TMDB gives its best textless backdrop, and the source's press photo is only the fallback.

A site with `tags_cast: true` (Filmybuff, and ScreenStat though it is not poster-style) also gets the film's
billed cast tagged on Instagram, their handles taken from TMDB's own cross-referenced ids, never guessed."""
from datetime import datetime, timezone

from autopub import extract, images, pipeline, refresh, rewrite, sources, tmdb, trailers, youtube
from autopub.rewrite import Captions, CuratedPost, Film, Mention
from autopub.social import mentions as mentions_mod
from autopub.state import State
from tests.test_images import _fake_photo_fetch
from tests.test_pipeline import FakeWP, Recorder
from tests.test_refresh import UpdatingWP, _state
from tests.test_trailers import UPLOAD, FakeRewriter, _post


def test_only_poster_or_cast_tagging_sites_ask_the_writer_for_the_film(settings):
    assert "film" in rewrite.schema_for(settings.site("FILMYBUFF"))["properties"], "poster site"
    assert "film" in rewrite.schema_for(settings.site("SCREENSTAT"))["properties"], "tags_cast site, though not poster style"
    assert "film" not in rewrite.schema_for(settings.site("MENTALIST"))["properties"], "neither poster nor tags_cast"
    assert "film" not in rewrite.schema_for(settings.site("FILMYBUFF"))["required"], "a story about a person names no film"


def test_the_best_textless_backdrop_is_the_still(monkeypatch):
    monkeypatch.setenv("TMDB_API_KEY", "k")
    answers = {
        "/search/movie": {"results": [{"id": 7, "title": "War 3", "release_date": "2026-01-01", "backdrop_path": "/primary.jpg"}]},
        "/movie/7/images": {"backdrops": [
            {"file_path": "/titled.jpg", "iso_639_1": "en", "vote_average": 9.0, "vote_count": 40, "width": 3840},
            {"file_path": "/small.jpg", "iso_639_1": None, "vote_average": 9.9, "vote_count": 5, "width": 800},
            {"file_path": "/clean.jpg", "iso_639_1": None, "vote_average": 5.5, "vote_count": 12, "width": 1920},
            {"file_path": "/clean2.jpg", "iso_639_1": None, "vote_average": 5.3, "vote_count": 3, "width": 1920}]},
    }
    monkeypatch.setattr(tmdb, "_get", lambda path, params, timeout=15: answers.get(path))
    hit = tmdb.film_still("War 3", 2026)
    assert hit["url"] == "https://image.tmdb.org/t/p/original/clean.jpg", "textless first, then the vote; too narrow never"
    assert hit["credit"] == "Still: War 3 (2026), via TMDB" and hit["kind"] == "movie"
    answers["/movie/7/images"] = {"backdrops": []}
    assert tmdb.film_still("War 3", 2026)["url"].endswith("/original/primary.jpg"), "no frames: the film's own backdrop"
    assert tmdb.film_still("War", None, exact=True) is None, "a tag must be the film's exact title"
    assert tmdb.film_still("war 3", None, exact=True)["title"] == "War 3"


def test_credits_person_instagram_and_cast_mentions(monkeypatch):
    monkeypatch.setenv("TMDB_API_KEY", "k")
    answers = {
        "/tv/55/credits": {"cast": [
            {"id": 103, "name": "Third Billed", "character": "C", "order": 2},
            {"id": 101, "name": "Lead Actor", "character": "A", "order": 0},
            {"id": 102, "name": "Second Lead", "character": "B", "order": 1},
        ]},
        "/person/101/external_ids": {"instagram_id": "leadactor"},
        "/person/102/external_ids": {"instagram_id": None},
        "/person/103/external_ids": {},
    }
    monkeypatch.setattr(tmdb, "_get", lambda path, params, timeout=15: answers.get(path))
    cast = tmdb.credits("tv", 55)
    assert [c["name"] for c in cast] == ["Lead Actor", "Second Lead", "Third Billed"], "billing order, not list order"
    assert tmdb.credits("tv", 55, limit=2) == cast[:2]
    assert tmdb.person_instagram(101) == "leadactor" and tmdb.person_instagram(102) is None
    assert tmdb.cast_mentions("tv", 55) == [
        {"name": "Lead Actor", "instagram": "leadactor"},
        {"name": "Second Lead", "instagram": None},
        {"name": "Third Billed", "instagram": None},
    ]


def test_a_filmybuff_story_that_names_a_film_is_postered_on_a_frame_from_it(monkeypatch, settings, tmp_path):
    site = settings.site("FILMYBUFF")
    settings.trailer_hours = settings.watchlist_hours = settings.scorecard_hours = settings.carousel_hours = settings.reel_hours = []
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [sources.Candidate("War 3 opens big", "https://bh.com/war3-opens", "", now, "BH")])
    monkeypatch.setattr(extract, "extract", lambda url, timeout=20: extract.Article(url=url, title="War 3 opens big", text="words " * 200, sitename="BH", image="https://bh.com/press.jpg"))
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    fetched = []
    monkeypatch.setattr(images, "_download_photo", lambda url, timeout: (fetched.append(url), None)[1])
    looked = []
    monkeypatch.setattr(tmdb, "film_still", lambda title, year=None, timeout=15, exact=False: (looked.append((title, year)), {"url": "https://image.tmdb.org/t/p/original/frame.jpg", "title": "War 3", "year": 2026, "kind": "movie", "id": 7, "credit": "Still: War 3 (2026), via TMDB"})[1])

    class Writer:
        def rewrite(self, site, article, carousel=False, keywords=None):
            p = _post(); p.film = Film(title="War 3", year=2026); p.category = "Bollywood"
            return p

    state = State(tmp_path / "s.db"); wp = FakeWP(); Recorder.seen.clear()
    report = pipeline.run_site(site, settings, state, rewriter=Writer(), wp=wp, publishers=[Recorder({})], work_dir=tmp_path / "img")
    assert report.published and looked == [("War 3", 2026)]
    assert "https://image.tmdb.org/t/p/original/frame.jpg" in fetched and "https://bh.com/press.jpg" not in fetched


def test_a_screenstat_story_that_names_a_show_tags_its_billed_cast(monkeypatch, settings, tmp_path):
    """ScreenStat is not poster-style, but tags_cast is on: the show is still named and its cast tagged."""
    from autopub.social import REGISTRY, instagram as ig
    from tests.test_social import _graph

    site = settings.site("SCREENSTAT")
    settings.trailer_hours = settings.watchlist_hours = settings.scorecard_hours = settings.carousel_hours = settings.reel_hours = []
    settings.buzz_meter_hours = []
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [sources.Candidate("VisionQuest renewed", "https://ss.com/vq", "", now, "SS")])
    monkeypatch.setattr(extract, "extract", lambda url, timeout=20: extract.Article(url=url, title="VisionQuest renewed", text="words " * 200, sitename="SS", image="https://ss.com/press.jpg"))
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    _fake_photo_fetch(monkeypatch)
    looked = []
    monkeypatch.setattr(tmdb, "find", lambda title, year=None, timeout=15:
                        (looked.append((title, year)), {"id": 55, "kind": "tv", "title": "VisionQuest", "year": 2026,
                                                        "poster": None, "backdrop": None, "overview": ""})[1] if title == "VisionQuest" else None)
    monkeypatch.setattr(tmdb, "cast_mentions", lambda kind, tmdb_id, timeout=15, limit=10: [
        {"name": "Lead Actor", "instagram": "leadactor"},
        {"name": "TOI Reporter", "instagram": "already_here"},   # same name the writer already proposed: not duplicated
        {"name": "No Handle Actor", "instagram": None},          # TMDB has no id for them: never a tag candidate
    ] if (kind, tmdb_id) == ("tv", 55) else [])

    calls = []

    def fake_verify(candidates, uid, token, state, limit=mentions_mod.MAX_TAGS):
        calls.append(limit)
        return [c.instagram for c in candidates if getattr(c, "instagram", None)][:limit]

    monkeypatch.setattr(mentions_mod, "verify", fake_verify)

    class Writer:
        def rewrite(self, site, article, carousel=False, keywords=None):
            p = _post(); p.film = Film(title="VisionQuest", year=2026); p.category = "Streaming"
            p.mentions = [Mention(name="TOI Reporter", kind="person", instagram="already_here")]
            return p

    state = State(tmp_path / "s.db"); wp = FakeWP(); Recorder.seen.clear()
    call, Resp = _graph({
        "/content_publishing_limit": (200, {"data": [{"config": {"quota_total": 100}, "quota_usage": 0}]}),
        "/media_publish": (200, {"id": "m1"}), "/m1": (200, {"permalink": "https://instagram.com/p/x/"}),
        "c1": (200, {"status_code": "FINISHED"}), "/media": lambda method, url, kwargs: (200, {"id": "c1"}),
    })
    monkeypatch.setattr(ig.requests, "request", call)
    monkeypatch.setattr(ig.requests, "get", lambda *a, **k: Resp(200, {}))
    pub = REGISTRY["instagram"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    report = pipeline.run_site(site, settings, state, rewriter=Writer(), wp=wp, publishers=[pub], work_dir=tmp_path / "img")
    assert report.published and looked == [("VisionQuest", 2026)]
    assert calls == [mentions_mod.FILM_TAG_LIMIT], "a film/show story gets the raised cap, not the ordinary one"


def test_a_story_about_a_person_keeps_the_sources_photo(monkeypatch, settings, tmp_path):
    site = settings.site("FILMYBUFF")
    settings.trailer_hours = settings.watchlist_hours = settings.scorecard_hours = settings.carousel_hours = settings.reel_hours = []
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [sources.Candidate("Alia on type", "https://bh.com/alia", "", now, "BH")])
    monkeypatch.setattr(extract, "extract", lambda url, timeout=20: extract.Article(url=url, title="Alia on type", text="words " * 200, sitename="BH", image="https://bh.com/alia.jpg"))
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    fetched = []
    monkeypatch.setattr(images, "_download_photo", lambda url, timeout: (fetched.append(url), None)[1])
    monkeypatch.setattr(tmdb, "film_still", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no film, no lookup")))

    class Writer:
        def rewrite(self, site, article, carousel=False, keywords=None):
            p = _post(); p.category = "Bollywood"; return p

    state = State(tmp_path / "s.db"); wp = FakeWP(); Recorder.seen.clear()
    report = pipeline.run_site(site, settings, state, rewriter=Writer(), wp=wp, publishers=[Recorder({})], work_dir=tmp_path / "img")
    assert report.published and "https://bh.com/alia.jpg" in fetched


def test_a_trailer_feature_names_its_film_for_the_poster(monkeypatch, settings, tmp_path):
    from tests.test_trailers import _run
    looked = []
    monkeypatch.setattr(tmdb, "film_still", lambda title, year=None, timeout=15, exact=False: (looked.append((title, year)), None)[1])
    upload = {**UPLOAD, "official": False, "url": "https://www.youtube.com/watch?v=t1", "thumbnail": "https://i.ytimg.com/vi/t1/maxresdefault.jpg"}
    report, wp, state, rw = _run(monkeypatch, settings, tmp_path, upload, lambda url, out_dir, **kw: None)
    assert report.published and looked == [("War 3", 2026)]


def test_the_refresh_takes_the_frame_from_a_tag_that_names_the_film(monkeypatch, settings, tmp_path):
    site = settings.site("FILMYBUFF")
    monkeypatch.setattr(tmdb, "film_still", lambda title, year=None, timeout=15, exact=False: {"url": f"https://image.tmdb.org/t/p/original/{title.replace(' ', '-')}.jpg", "title": title, "year": year, "kind": "movie", "id": 1, "credit": "c"} if title in ("War 3", "The Lunchbox") else None)
    assert refresh.film_frame("", ["bollywood", "War 3"]) == "https://image.tmdb.org/t/p/original/War-3.jpg"
    assert refresh.film_frame("<td><strong>The Lunchbox</strong> (2013)</td>", ["ott"]) == "https://image.tmdb.org/t/p/original/The-Lunchbox.jpg"
    assert refresh.film_frame("<p>nothing</p>", ["ott"]) is None
    # the frame beats the article's own photo and the trailer's thumbnail
    monkeypatch.setattr(extract, "extract", lambda url, timeout=30: extract.Article(url=url, title="t", text="", sitename="BH", image="https://bh.com/press.jpg"))
    assert refresh.source_still("https://bh.com/war3", site, tags=["War 3"]).endswith("/War-3.jpg")
    assert refresh.source_still("https://www.youtube.com/watch?v=abc123xyz", site, tags=["War 3"]).endswith("/War-3.jpg")
    assert refresh.source_still("https://bh.com/war3", site, tags=["news"]) == "https://bh.com/press.jpg"
    # the refresh reads the tags embedded with the post
    state = _state(tmp_path, site)

    class TaggedWP(UpdatingWP):
        def get_post(self, post_id, embed_terms=False):
            post = super().get_post(post_id)
            post["_embedded"] = {"wp:term": [[{"taxonomy": "category", "name": "Bollywood"}], [{"taxonomy": "post_tag", "name": "War 3"}]]}
            return post

    wp = TaggedWP()
    done = dict(refresh.refresh(site, settings, state, wp, tmp_path / "img", dry_run=True))
    assert done[11].endswith("/War-3.jpg")
