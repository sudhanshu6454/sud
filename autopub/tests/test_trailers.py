"""Filmybuff's trailers: the week's trailer story, the studio's own upload found and fetched, posted as the
article's video and the reel in the poster frame, credited. A fan's upload stays an embed."""
import shutil
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from autopub import adclip, extract, images, pipeline, sources, trailers, youtube
from autopub import sources as src
from autopub.rewrite import Captions, CuratedPost
from autopub.state import State
from tests.test_nostalgia import VideoRecorder
from tests.test_pipeline import FakeWP, Recorder

UPLOAD = {"id": "t1", "title": "WAR 3 | Official Trailer | Hrithik Roshan | NTR", "channel": "Yash Raj Films", "seconds": 150, "views": 9000000}
FAN = {"id": "t2", "title": "War 3 trailer reaction", "channel": "Filmy Reactions", "seconds": 300, "views": 20000}


def _post():
    return CuratedPost(title="War 3 trailer: the action is bigger, the plot is thinner", category="Trailers", slug="war-3-trailer",
                       excerpt="e" * 120, body_html="<h2>What it is</h2><p>x</p>", tags=["war 3"], image_headline="War 3",
                       image_kicker="Trailer", hook="War 3 looks like the one",
                       captions=Captions(twitter="tw", facebook="fb", instagram="ig", linkedin="li", pinterest_title="pt", pinterest="pi", telegram="tg", threads="th"))


class FakeRewriter:
    def __init__(self, picks, post=None):
        self.picks, self.post, self.systems = list(picks), post or _post(), []

    def ask(self, system, user, schema, validate=None, max_tokens=16000):
        self.systems.append(system)
        if "choose the ONE that is about a specific trailer" in system:
            return self.picks.pop(0)
        return self.post


# ---- finding the upload -------------------------------------------------------------------------------------

def test_the_studios_upload_wins_over_a_fan_reaction():
    got = youtube.choose_trailer([FAN, UPLOAD], "War 3", "Yash Raj Films")
    assert got is UPLOAD
    assert youtube.is_official_trailer(UPLOAD, "War 3", "Yash Raj Films")
    assert not youtube.is_official_trailer(FAN, "War 3", "Yash Raj Films")
    assert youtube.is_official_trailer({"channel": "Hombale Films"}, "Kantara", "Hombale"), "a studio's short name in the channel"
    assert youtube.is_official_trailer({"channel": "Marvel Entertainment"}, "Thunderbolts", "Marvel Studios"), "most of the studio's words"


def test_a_studio_channel_is_recognised_without_the_model_naming_it():
    """The model often does not know the studio; the channel's own name has to carry it."""
    dharma = {"title": "Udta Teer Official Trailer | Ayushmann Khurrana", "channel": "Dharma Productions and Sikhya Entertainment"}
    assert youtube.is_official_trailer(dharma, "Udta Teer", "")
    assert youtube.is_official_trailer({"title": "x official trailer", "channel": "Some Small Films"}, "x", ""), "reads like a studio"
    for fan in ("Judwaaz TV", "Cinema Stars Tv", "Feature Friday Clips", "OUR STUPID REACTIONS", "YOGI BOLTA HAI", "Filmy Reactions"):
        assert not youtube.is_official_trailer({"title": "Udta Teer Official Trailer", "channel": fan}, "Udta Teer", ""), fan
    assert not youtube.is_official_trailer({"title": "Udta Teer trailer breakdown", "channel": "Some Small Films"}, "Udta Teer", ""), "no 'official' in the title"


def test_the_entertainment_press_and_aggregators_are_not_the_studio():
    """Entertainment Tonight re-uploads trailers with 'official' in the title; the rights are not theirs."""
    for outlet in ("Entertainment Tonight", "Rotten Tomatoes Trailers", "Movieclips Trailers", "KinoCheck", "Bollywood Hungama",
                   "Pinkvilla", "Variety", "Filmfare", "The Tonight Show Starring Jimmy Fallon"):
        assert not youtube.is_official_trailer({"title": "I'm Chris Hansen Official Trailer", "channel": outlet}, "I'm Chris Hansen", ""), outlet
    for studio in ("Peacock", "HBO Max", "Apple TV", "Neon", "Focus Features", "Hombale Films"):
        assert youtube.is_official_trailer({"title": "Official Trailer", "channel": studio}, "Some Film", ""), studio


def test_a_video_without_a_trailer_word_or_the_film_is_not_the_trailer():
    review = {"id": "r", "title": "War 3 review: worth it?", "channel": "Yash Raj Films", "seconds": 100, "views": 1}
    other = {"id": "o", "title": "Dhurandhar official trailer", "channel": "Yash Raj Films", "seconds": 100, "views": 1}
    assert youtube.choose_trailer([review, other], "War 3", "Yash Raj Films") is None


def test_find_trailer_searches_the_film_with_the_year_and_says_whether_it_is_official(monkeypatch):
    queries = []
    monkeypatch.setattr(youtube, "search", lambda q, timeout=20: (queries.append(q), [FAN, UPLOAD])[1])
    got = youtube.find_trailer("War 3", "Yash Raj Films", 2026)
    assert queries[0] == "War 3 official trailer 2026"
    assert got["official"] and got["url"].endswith("t1") and got["thumbnail"].endswith("/t1/maxresdefault.jpg")


# ---- the feature ---------------------------------------------------------------------------------------------

def test_only_stories_that_name_a_trailer_are_candidates(monkeypatch, settings):
    site = settings.site("FILMYBUFF")
    now = datetime.now(timezone.utc)
    week = [src.Candidate("'War 3' trailer: the action is bigger, the plot is thinner", "https://bh.com/war3", "", now, "Bollywood Hungama"),
            src.Candidate("Kriti Sanon on her outfit", "https://ht.com/kriti", "", now, "HT"),
            src.Candidate("'Jailer 2' first look: Rajinikanth is back", "https://toi.com/jailer", "", now, "TOI")]
    monkeypatch.setattr(src, "collect", lambda s, timeout=30: week)
    state = State(settings.data_dir / "s.db")
    state.claim("https://toi.com/jailer", site.key, "used")
    got = trailers.candidates(site, settings, state)
    assert [c.url for c in got] == ["https://bh.com/war3"]


def test_the_poster_frame_keeps_the_window_clear_and_carries_the_credit(settings, tmp_path):
    site = settings.site("FILMYBUFF")
    a = images.ad_frame("Trailer", "War 3 looks like the one", "War 3 (2026): the trailer. Video: Yash Raj Films on YouTube.", site, tmp_path / "a.png")
    b = images.ad_frame("Trailer", "A different and much longer line for the frame that wraps", "Other credit", site, tmp_path / "b.png")
    with Image.open(a) as ia, Image.open(b) as ib:
        assert ia.size == images.STORY_SIZE and ia.format == "PNG"
        box = (0, images.AD_WINDOW_TOP, images.STORY_SIZE[0], images.AD_WINDOW_TOP + images.AD_WINDOW_H)
        assert ia.crop(box).tobytes() == ib.crop(box).tobytes(), "the window is the film's"
        assert ia.tobytes() != ib.tobytes()


def _run(monkeypatch, settings, tmp_path, upload, fetch, compose=None):
    site = settings.site("FILMYBUFF")
    settings.trailer_hours = [0]
    settings.watchlist_hours = settings.scorecard_hours = settings.carousel_hours = settings.reel_hours = []
    settings.repost_ads = True
    now = datetime.now(timezone.utc)
    week = [src.Candidate("'War 3' trailer: the action is bigger, the plot is thinner", "https://bh.com/war3", "", now, "Bollywood Hungama")]
    monkeypatch.setattr(src, "collect", lambda s, timeout=30: week if s.max_age_hours == 96 else [])
    monkeypatch.setattr(extract, "extract", lambda url, timeout=20: extract.Article(url=url, title="'War 3' trailer", text="words " * 200, sitename="Bollywood Hungama"))
    monkeypatch.setattr(youtube, "find_trailer", lambda film, studio="", year=None, timeout=20: dict(upload))
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    monkeypatch.setattr(pipeline, "narrator_for", lambda settings: None)
    monkeypatch.setattr(pipeline.images, "_download_photo", lambda url, timeout: None)
    real = pipeline.video.render_reel
    monkeypatch.setattr(pipeline.video, "render_reel", lambda frames, out, durations, accent, **kw: real(frames, out, [0.3] * len(frames), accent, fps=6, dissolve=0.1))
    monkeypatch.setattr(adclip, "fetch", fetch)
    if compose is not None:
        monkeypatch.setattr(adclip, "compose", compose)
    state = State(tmp_path / "s.db")
    wp = FakeWP()
    Recorder.seen.clear(); VideoRecorder.seen.clear()
    rw = FakeRewriter([trailers.Pick(index=1, film="War 3", studio="Yash Raj Films", year=2026, kind="trailer", hook="h")])
    report = pipeline.run_site(site, settings, state, rewriter=rw, wp=wp, publishers=[Recorder({}), VideoRecorder({})], work_dir=tmp_path / "img")
    return report, wp, state, rw


def test_the_studios_trailer_is_fetched_and_becomes_the_video_and_the_reel_with_credits(monkeypatch, settings, tmp_path):
    src_clip = tmp_path / "src.mp4"
    src_clip.write_bytes(b"\x00" * 2000)
    fetched = {}

    def fetch(url, out_dir, *, player_clients, cookies):
        out_dir.mkdir(parents=True, exist_ok=True)
        fetched["url"] = url
        return Path(shutil.copy(src_clip, out_dir / "t1.mp4"))

    def compose(clip, frame, intro, outro, out, *, max_seconds):
        assert frame.suffix == ".png" and clip.exists()
        shutil.copy(src_clip, out)
        return out

    upload = {**UPLOAD, "official": True, "url": "https://www.youtube.com/watch?v=t1", "thumbnail": "https://i.ytimg.com/vi/t1/maxresdefault.jpg"}
    report, wp, state, rw = _run(monkeypatch, settings, tmp_path, upload, fetch, compose)
    assert report.published and fetched["url"] == upload["url"]
    content = wp.posts[0]["content"]
    assert content.startswith('<!-- wp:video') and "wp:embed" not in content and "Shown for review" in content
    assert "Watch the original" in content and "Yash Raj Films on YouTube" in content
    assert ("categories", "Trailers") in wp.terms
    reel = VideoRecorder.seen[0]
    assert reel.video_url and "War 3 (2026): the trailer. Video: Yash Raj Films on YouTube. Shown for review." in reel.captions["instagram"]
    assert trailers.parse_used(state.note("FILMYBUFF", trailers.USED_NOTE)) == ["War 3"]
    assert state.is_used(upload["url"], "FILMYBUFF") and state.is_used("https://bh.com/war3", "FILMYBUFF")
    # the slot is spent: a second cycle asks nothing
    report2 = pipeline.run_site(settings.site("FILMYBUFF"), settings, state, rewriter=rw, wp=wp, publishers=[Recorder({})], work_dir=tmp_path / "img")
    assert report2.published == []


def test_a_fans_upload_is_never_fetched_and_stays_an_embed(monkeypatch, settings, tmp_path):
    def fetch(url, out_dir, **kw):
        raise AssertionError("a fan upload must not be fetched")

    upload = {**FAN, "official": False, "url": "https://www.youtube.com/watch?v=t2", "thumbnail": "https://i.ytimg.com/vi/t2/maxresdefault.jpg"}
    report, wp, state, rw = _run(monkeypatch, settings, tmp_path, upload, fetch)
    assert report.published and wp.posts[0]["content"].startswith("<!-- wp:embed")
    assert VideoRecorder.seen[0].video_url, "the narrated reel goes out instead"
    assert "Shown for review" not in VideoRecorder.seen[0].captions["instagram"]


def test_config_switches_trailers_on_for_filmybuff_only(settings):
    assert settings.trailer_hours == [11, 19]
    assert [s.key for s in settings.sites if s.trailers] == ["FILMYBUFF"]
