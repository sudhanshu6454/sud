"""Filmybuff's curated day: scenes from the rights holder's channel, trivia and breakdowns from Wikipedia with
frames from TMDB, ranked lists, and the news post held to its own hours."""
import datetime as dt
import shutil
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from autopub import adclip, deepdives, images, pipeline, scenes, sources, tmdb, watchlists, wiki, youtube
from autopub import sources as src
from autopub.rewrite import Captions, CuratedPost
from autopub.state import State
from tests.test_nostalgia import VideoRecorder
from tests.test_pipeline import FakeWP, Recorder
from tests.test_poster import CarouselRecorder
from tests.test_trailers import FAN, _post

CLIP = {"id": "s1", "title": "Gangs of Wasseypur | Ramadhir Singh Cinema Dialogue Scene | Viacom18 Studios", "channel": "Viacom18 Studios", "seconds": 95, "views": 5000000}
FANCLIP = {"id": "s2", "title": "Gangs of Wasseypur best scene", "channel": "Bollywood Clips TV", "seconds": 95, "views": 9000000}


# ---- the scene ----------------------------------------------------------------------------------------

def test_a_scene_comes_only_from_the_rights_holders_channel():
    assert youtube.choose_scene([FANCLIP, CLIP], "Gangs of Wasseypur", "Viacom18 Studios") is CLIP
    assert youtube.choose_scene([FANCLIP], "Gangs of Wasseypur", "") is None, "a fan's upload never qualifies"
    long = {**CLIP, "seconds": 20 * 60}
    assert youtube.choose_scene([long], "Gangs of Wasseypur", "Viacom18 Studios") is None, "a full film is not a scene"
    review = {**CLIP, "title": "Gangs of Wasseypur review"}
    assert youtube.choose_scene([review], "Gangs of Wasseypur", "Viacom18 Studios") is None


class SceneWriter:
    def __init__(self, picks):
        self.picks = list(picks)

    def ask(self, system, user, schema, validate=None, max_tokens=16000):
        if "Choose ONE scene" in system:
            return self.picks.pop(0)
        return _post()


def _run_scene(monkeypatch, settings, tmp_path, clip, picks):
    site = settings.site("FILMYBUFF")
    settings.scene_hours = [0]
    settings.trailer_hours = settings.deepdive_hours = settings.watchlist_hours = settings.scorecard_hours = settings.carousel_hours = settings.reel_hours = []
    settings.repost_ads = True
    site.news_hours = []
    monkeypatch.setattr(tmdb, "trending", lambda kind="movie", window="week", timeout=15, limit=12: [{"title": "War 3", "year": 2026, "language": "hi"}])
    monkeypatch.setattr(src, "collect", lambda s, timeout=30: [])
    monkeypatch.setattr(youtube, "find_scene", lambda film, query, studio="", year=None, timeout=20: dict(clip) if clip else None)
    monkeypatch.setattr(tmdb, "film_still", lambda *a, **k: None)
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    monkeypatch.setattr(pipeline, "narrator_for", lambda settings: None)
    monkeypatch.setattr(pipeline.images, "_download_photo", lambda url, timeout: None)
    real = pipeline.video.render_reel
    monkeypatch.setattr(pipeline.video, "render_reel", lambda frames, out, durations, accent, **kw: real(frames, out, [0.3] * len(frames), accent, fps=6, dissolve=0.1))
    src_clip = tmp_path / "src.mp4"; src_clip.write_bytes(b"\x00" * 2000)
    monkeypatch.setattr(adclip, "fetch", lambda url, out_dir, **kw: (out_dir.mkdir(parents=True, exist_ok=True), Path(shutil.copy(src_clip, out_dir / "s1.mp4")))[1])
    monkeypatch.setattr(adclip, "compose", lambda clip_, frame, intro, outro, out, **kw: (shutil.copy(src_clip, out), out)[1])
    state = State(tmp_path / "s.db"); wp = FakeWP(); Recorder.seen.clear(); VideoRecorder.seen.clear()
    report = pipeline.run_site(site, settings, state, rewriter=SceneWriter(picks), wp=wp, publishers=[Recorder({}), VideoRecorder({})], work_dir=tmp_path / "img")
    return report, wp, state


def test_the_scene_is_fetched_from_the_rights_holder_and_posted_credited(monkeypatch, settings, tmp_path):
    clip = {**CLIP, "official": True, "url": "https://www.youtube.com/watch?v=s1", "thumbnail": "https://i.ytimg.com/vi/s1/maxresdefault.jpg"}
    pick = scenes.Pick(film="Gangs of Wasseypur", year=2012, studio="Viacom18 Studios", scene="Ramadhir Singh on why he is still alive", kind="scene",
                       query="Gangs of Wasseypur Ramadhir Singh cinema dialogue scene", hook="The line every fan quotes")
    report, wp, state = _run_scene(monkeypatch, settings, tmp_path, clip, [pick])
    assert report.published
    content = wp.posts[0]["content"]
    assert content.startswith("<!-- wp:video") and "Viacom18 Studios on YouTube" in content and "Shown for review" in content
    assert ("categories", "Scenes") in wp.terms
    reel = VideoRecorder.seen[0]
    assert reel.video_url and "Gangs of Wasseypur (2012): the scene. Video: Viacom18 Studios on YouTube. Shown for review." in reel.captions["instagram"]
    assert scenes.parse_used(state.note("FILMYBUFF", scenes.USED_NOTE)) == ["Gangs of Wasseypur: Ramadhir Singh on why he is still alive"]
    assert state.is_used(clip["url"], "FILMYBUFF")


def test_a_scene_with_no_rights_holder_upload_is_skipped_for_the_next_pick(monkeypatch, settings, tmp_path):
    pick = scenes.Pick(film="Some Film", year=2010, studio="", scene="x", kind="scene", query="some film scene", hook="h")
    report, wp, state = _run_scene(monkeypatch, settings, tmp_path, None, [pick, pick, pick])
    assert report.published == [] and wp.posts == []


# ---- the deep dive ------------------------------------------------------------------------------------

PAGE_HTML = ('<p>Lagaan is a 2001 Indian Hindi-language epic musical sports film written and directed by Ashutosh Gowariker.</p>'
             '<h2><span class="mw-headline">Production</span></h2><p>' + 'The village of Champaner was built from scratch near Bhuj. ' * 12 + '</p>'
             '<h3><span class="mw-headline">Casting</span></h3><p>' + 'Aamir Khan agreed to produce the film after turning it down. ' * 10 + '</p>'
             '<h2><span class="mw-headline">Music</span></h2><p>' + 'A. R. Rahman composed the soundtrack in a few months. ' * 10 + '</p>'
             '<h2><span class="mw-headline">Cast</span></h2><table><tr><td>Aamir Khan</td></tr></table>'
             '<h2><span class="mw-headline">Reception</span></h2><p>' + 'The film was nominated for the Academy Award for Best Foreign Language Film. ' * 8 + '</p>'
             '<h2><span class="mw-headline">References</span></h2><div class="reflist">[1] a citation</div>')


def test_the_films_page_is_read_by_the_sections_trivia_comes_from(monkeypatch):
    monkeypatch.setattr(wiki, "search", lambda q: ["Lagaan", "Lagaan (soundtrack)"])
    monkeypatch.setattr(wiki, "page_html", lambda title: ("Lagaan", PAGE_HTML) if title == "Lagaan" else None)
    page = wiki.film_page("Lagaan", 2001)
    assert page.title == "Lagaan" and page.url == "https://en.wikipedia.org/wiki/Lagaan"
    assert page.lead.startswith("Lagaan is a 2001")
    assert list(page.sections) == ["Production", "Casting", "Music", "Reception"], "cast tables and references are not prose"
    assert "Champaner" in page.sections["Production"] and "PRODUCTION:" in page.text
    monkeypatch.setattr(wiki, "search", lambda q: ["Something Else"])
    assert wiki.film_page("Lagaan", 2001) is None


def test_the_deep_dive_puts_a_different_frame_on_every_slide(monkeypatch):
    monkeypatch.setattr(tmdb, "film_still", lambda title, year=None, timeout=15, exact=False: {"url": "https://t/f1.jpg", "frames": ["https://t/f1.jpg", "https://t/f2.jpg", "https://t/f3.jpg"], "title": title, "year": year, "kind": "movie", "id": 1, "credit": "Still: Lagaan (2001), via TMDB"})
    monkeypatch.setattr(deepdives.poster, "pick_frame", lambda urls, timeout=20, limit=4: urls[1])
    photos, cover, credit = deepdives.frames_for(deepdives.Pick(film="Lagaan", year=2001, kind="trivia", angle="a", why="w"), 5)
    assert cover == "https://t/f2.jpg" and credit.startswith("Still: Lagaan")
    assert photos == {1: "https://t/f1.jpg", 2: "https://t/f3.jpg", 3: "https://t/f1.jpg", 4: "https://t/f3.jpg", 5: "https://t/f1.jpg"}, "the cover's frame is kept for the cover"


class DiveWriter:
    def __init__(self, pick):
        self.pick = pick
        self.briefs = []

    def ask(self, system, user, schema, validate=None, max_tokens=16000):
        if "Choose ONE film" in system:
            return self.pick
        self.briefs.append(user)
        p = _post()
        p.category = "Trivia"
        p.carousel_slides = [pipeline.carousels.CarouselSlide(heading=f"Fact {i}", body="The village of Champaner was built from scratch near Bhuj, and the crew lived there for the shoot.") for i in range(1, 8)]
        return p


def test_the_deep_dive_is_written_from_the_page_and_posted_as_a_carousel(monkeypatch, settings, tmp_path):
    site = settings.site("FILMYBUFF")
    settings.deepdive_hours = [0]
    settings.trailer_hours = settings.scene_hours = settings.watchlist_hours = settings.scorecard_hours = settings.carousel_hours = settings.reel_hours = []
    site.news_hours = []
    monkeypatch.setattr(tmdb, "anniversaries", lambda today=None, days=7, timeout=15, per_year=3: [{"title": "Lagaan", "year": 2001, "language": "hi", "turns": 25}])
    monkeypatch.setattr(tmdb, "trending", lambda kind="movie", window="week", timeout=15, limit=12: [])
    monkeypatch.setattr(src, "collect", lambda s, timeout=30: [])
    monkeypatch.setattr(wiki, "search", lambda q: ["Lagaan"])
    monkeypatch.setattr(wiki, "page_html", lambda title: ("Lagaan", PAGE_HTML))
    monkeypatch.setattr(tmdb, "film_still", lambda title, year=None, timeout=15, exact=False: {"url": "https://t/f1.jpg", "frames": ["https://t/f1.jpg", "https://t/f2.jpg"], "title": "Lagaan", "year": 2001, "kind": "movie", "id": 1, "credit": "Still: Lagaan (2001), via TMDB"})
    monkeypatch.setattr(deepdives.poster, "pick_frame", lambda urls, timeout=20, limit=4: urls[0])
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    monkeypatch.setattr(pipeline.images, "_download_photo", lambda url, timeout: None)
    writer = DiveWriter(deepdives.Pick(film="Lagaan", year=2001, kind="trivia", angle="8 things you did not know about Lagaan", why="It turns 25 this week"))
    state = State(tmp_path / "s.db"); wp = FakeWP(); Recorder.seen.clear()
    report = pipeline.run_site(site, settings, state, rewriter=writer, wp=wp, publishers=[CarouselRecorder({})], work_dir=tmp_path / "img")
    assert report.published
    assert "SOURCE_TEXT:" in writer.briefs[0] and "Champaner" in writer.briefs[0], "the writer gets the page, not its memory"
    content = wp.posts[0]["content"]
    assert "Wikipedia: Lagaan" in content and "CC BY-SA" in content and "TMDB" in content
    assert ("categories", "Trivia") in wp.terms
    assert deepdives.parse_used(state.note("FILMYBUFF", deepdives.USED_NOTE)) == ["Lagaan (2001): Did you know"]
    assert state.is_used("https://filmybuff.com/trivia/lagaan-2001", "FILMYBUFF")
    assert len(Recorder.seen[0].carousel_urls) == 9, "cover + 7 facts + closing: the trivia goes out as a carousel"


# ---- TMDB discovery -----------------------------------------------------------------------------------

def test_tmdb_trending_and_anniversaries(monkeypatch):
    monkeypatch.setenv("TMDB_API_KEY", "k")
    calls = []
    def fake_get(path, params, timeout=15):
        calls.append((path, params))
        if path.startswith("/trending/movie"):
            return {"results": [{"id": 1, "title": "War 3", "release_date": "2026-01-01", "original_language": "hi", "popularity": 9, "backdrop_path": "/w.jpg"},
                                {"id": 2, "title": "Une Femme", "release_date": "2026-01-01", "original_language": "fr", "popularity": 8}]}
        if path == "/discover/movie":
            return {"results": [{"id": 3, "title": "Lagaan", "release_date": "2001-06-15", "original_language": "hi", "backdrop_path": "/l.jpg"}]}
        return {}
    monkeypatch.setattr(tmdb, "_get", fake_get)
    got = tmdb.trending("movie")
    assert [g["title"] for g in got] == ["War 3"], "only the languages the site covers"
    assert got[0]["backdrop"].endswith("/original/w.jpg")
    anniv = tmdb.anniversaries(today=dt.date(2026, 6, 15))
    assert {a["turns"] for a in anniv} == set(tmdb.ANNIVERSARIES) and anniv[1]["title"] == "Lagaan"
    disc = [p for path, p in calls if path == "/discover/movie"]
    assert disc[1]["primary_release_date.gte"] == "2016-06-15" and disc[1]["primary_release_date.lte"] == "2016-06-22"


# ---- the day ------------------------------------------------------------------------------------------

def test_the_news_post_runs_only_at_the_sites_news_hours(monkeypatch, settings, tmp_path):
    site = settings.site("FILMYBUFF")
    settings.trailer_hours = settings.scene_hours = settings.deepdive_hours = settings.watchlist_hours = settings.scorecard_hours = []
    site.news_hours = [9, 14, 20]
    asked = []
    monkeypatch.setattr(src, "collect", lambda s, timeout=30: (asked.append(1), [])[1])
    monkeypatch.setattr(pipeline, "_local_hour", lambda tz: 11)
    pipeline.run_site(site, settings, State(tmp_path / "a.db"), rewriter=object(), wp=FakeWP(), publishers=[], work_dir=tmp_path / "img")
    assert asked == [], "11:00 is not a news hour: the feeds are not even read"
    monkeypatch.setattr(pipeline, "_local_hour", lambda tz: 14)
    pipeline.run_site(site, settings, State(tmp_path / "b.db"), rewriter=object(), wp=FakeWP(), publishers=[], work_dir=tmp_path / "img")
    assert asked == [1]


def test_config_gives_filmybuff_the_curated_day():
    from autopub import config
    settings = config.load(Path(__file__).resolve().parents[1] / "config" / "sites.yaml")
    site = settings.site("FILMYBUFF")
    assert site.scenes and site.deepdives and site.news_hours == [9, 14, 20]
    assert settings.scene_hours == [13, 21] and settings.deepdive_hours == [8, 12, 17]
    assert [s.key for s in settings.sites if s.scenes or s.deepdives or s.news_hours is not None] == ["FILMYBUFF"]
    assert "Trivia" in site.categories and "Scenes" in site.categories
    assert any("ranked" in t for t in watchlists.THEMES)
