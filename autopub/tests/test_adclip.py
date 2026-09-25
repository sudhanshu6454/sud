"""The ad film inside the site's frame: fetched only from the brand's own upload, composed between
the story cover and the closing frame with its own sound, and placed in the article's video slot.
Off by default; when it is off or the fetch fails, the embed and the narrated reel go out as before."""
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from autopub import adclip, images, nostalgia, pipeline, sources, video, youtube
from autopub.nostalgia import Pick
from autopub.state import State
from tests.test_nostalgia import FILM, FakeRewriter, VideoRecorder, _quick_render
from tests.test_pipeline import FakeWP, Recorder


def _synthetic(path: Path, seconds: float = 2.0, sound: bool = True, size: str = "640x360") -> Path:
    """A small test-pattern film, with or without a tone, made by ffmpeg itself."""
    cmd = [video.ffmpeg_exe(), "-y", "-loglevel", "error",
           "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=10:duration={seconds}"]
    if sound:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-c:a", "aac"]
    cmd += ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path)]
    subprocess.run(cmd, check=True)
    return path


@pytest.fixture
def stills(site, tmp_path):
    card = images.render_card("Why everyone is sharing this ad", "Viral now", site, tmp_path / "p.jpg", variant="portrait")
    intro = images.story_asset(card, site, tmp_path / "story.jpg")
    outro = images.story_closing_frame("Why everyone is sharing this ad", site, tmp_path / "end.jpg")
    frame = images.ad_frame("Viral now", "Why everyone is sharing this ad", "Ad: Brand. Video: Brand on YouTube. Shown for review.",
                            site, tmp_path / "frame.png")
    return intro, frame, outro


# ---- fetching ----------------------------------------------------------------------------------------------

def test_ytdlp_is_asked_for_the_android_client_first_an_mp4_under_1080p_and_no_playlist(tmp_path):
    opts = adclip.options(tmp_path, cookies=None)
    assert opts["extractor_args"]["youtube"]["player_client"] == ["android", "web"]
    assert opts["format"].startswith("bv*[height<=1080][ext=mp4]") and opts["merge_output_format"] == "mp4"
    assert opts["noplaylist"] and "cookiefile" not in opts
    assert adclip.options(tmp_path, cookies="/data/cookies.txt")["cookiefile"] == "/data/cookies.txt"
    assert opts["match_filter"]({"duration": 90}) is None
    assert "longer than an ad film" in opts["match_filter"]({"duration": 3600})


def test_fetch_returns_the_downloaded_film_after_checking_it_is_a_video(tmp_path):
    src = _synthetic(tmp_path / "src.mp4")
    seen = {}

    def fake(url, opts):
        seen["url"], seen["opts"] = url, opts
        out = Path(opts["outtmpl"].replace("%(id)s.%(ext)s", "abc.mp4"))
        shutil.copy(src, out)
        return out

    got = adclip.fetch("https://www.youtube.com/watch?v=abc", tmp_path / "ads", downloader=fake)
    assert got == tmp_path / "ads" / "abc.mp4" and got.exists()
    assert seen["url"].endswith("abc") and seen["opts"]["extractor_args"]["youtube"]["player_client"][0] == "android"


def test_youtubes_sign_in_wall_is_reported_with_the_cookies_remedy(tmp_path):
    def wall(url, opts):
        raise ValueError("ERROR: [youtube] abc: Sign in to confirm you're not a bot.")

    with pytest.raises(RuntimeError) as err:
        adclip.fetch("https://www.youtube.com/watch?v=abc", tmp_path / "ads", downloader=wall)
    assert "Sign in" in str(err.value) and "ad_clip_cookies" in str(err.value)


def test_a_file_that_is_not_a_video_is_refused(tmp_path):
    def junk(url, opts):
        out = tmp_path / "ads" / "abc.mp4"
        out.write_bytes(b"not a film")
        return out

    with pytest.raises(RuntimeError, match="not a readable video"):
        adclip.fetch("https://www.youtube.com/watch?v=abc", tmp_path / "ads", downloader=junk)


# ---- the frame ---------------------------------------------------------------------------------------------

def test_the_frame_is_a_story_sized_png_whose_window_no_type_touches(site, tmp_path):
    a = images.ad_frame("Viral now", "A short hook", "Ad: A. Video: A on YouTube.", site, tmp_path / "a.png")
    b = images.ad_frame("Throwback", "A much longer hook that wraps onto several lines of the frame and keeps going",
                        "Ad: Some Brand, a campaign with a long name. Video: Some Brand India on YouTube. Shown for review.",
                        site, tmp_path / "b.png")
    with Image.open(a) as ia, Image.open(b) as ib:
        assert ia.size == ib.size == images.STORY_SIZE and ia.format == "PNG"
        box = (0, images.AD_WINDOW_TOP, images.STORY_SIZE[0], images.AD_WINDOW_TOP + images.AD_WINDOW_H)
        assert ia.crop(box).tobytes() == ib.crop(box).tobytes(), "the window is the film's; kicker, hook and credit stay outside it"
        assert ia.tobytes() != ib.tobytes()


# ---- composing ---------------------------------------------------------------------------------------------

def test_the_reel_is_cover_then_the_film_cut_at_the_cap_with_its_sound_then_the_closing_frame(stills, tmp_path):
    intro, frame, outro = stills
    clip = _synthetic(tmp_path / "ad.mp4", seconds=2.0)
    out = adclip.compose(clip, frame, intro, outro, tmp_path / "reel.mp4", max_seconds=1.2, fps=10, intro_hold=1.0, outro_hold=1.0)
    info = video.probe(out)
    assert (info["width"], info["height"], info["codec"]) == (1080, 1920, "h264")
    assert info["audio"], "the film's own sound rides in the middle, silence under the stills"
    assert abs(info["duration"] - (1.0 + 1.2 + 1.0)) < 0.35
    assert out.stat().st_size > 10_000


def test_a_silent_film_still_gets_an_audio_track_for_instagram(stills, tmp_path):
    intro, frame, outro = stills
    clip = _synthetic(tmp_path / "quiet.mp4", seconds=1.0, sound=False, size="360x640")   # a vertical cut fits the window too
    out = adclip.compose(clip, frame, intro, outro, tmp_path / "reel.mp4", fps=10, intro_hold=0.5, outro_hold=0.5)
    info = video.probe(out)
    assert info["audio"] and abs(info["duration"] - 2.0) < 0.35


def test_a_film_that_cannot_be_read_is_refused_before_ffmpeg(stills, tmp_path):
    intro, frame, outro = stills
    junk = tmp_path / "junk.mp4"
    junk.write_bytes(b"nope")
    with pytest.raises(RuntimeError, match="cannot read"):
        adclip.compose(junk, frame, intro, outro, tmp_path / "reel.mp4")


# ---- the article's video slot ------------------------------------------------------------------------------

def test_the_slot_is_filled_with_the_video_block_or_left_as_the_embed():
    body = adclip.slot("<!-- wp:embed -->youtube<!-- /wp:embed -->\n") + "<h2>The ad</h2>"
    block = adclip.video_block(42, "https://site/ad.mp4", "Ad: Brand. Shown for review.", poster="https://site/p.jpg")
    filled = adclip.place_video(body, block)
    assert filled.startswith('<!-- wp:video {"id":42} -->') and 'src="https://site/ad.mp4"' in filled and 'poster="https://site/p.jpg"' in filled
    assert "wp:embed" not in filled and adclip.SLOT_OPEN not in filled and filled.endswith("<h2>The ad</h2>")
    kept = adclip.place_video(body, None)
    assert "wp:embed" in kept and adclip.SLOT_OPEN not in kept and adclip.SLOT_CLOSE not in kept


# ---- end to end --------------------------------------------------------------------------------------------

def _feature(monkeypatch, settings, site, tmp_path, film, fetch, compose=None):
    settings.ad_hours = [0]
    settings.reel_hours = []
    settings.carousel_hours = []
    settings.repost_ads = True
    site.nostalgia = True
    _quick_render(monkeypatch)
    monkeypatch.setattr(youtube, "find_ad", lambda brand, campaign, year=None, timeout=20: dict(film))
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [])
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    monkeypatch.setattr(pipeline.images, "_download_photo", lambda url, timeout: None)
    monkeypatch.setattr(nostalgia, "kind_for_slot", lambda settings, now=None: "nostalgic")
    monkeypatch.setattr(adclip, "fetch", fetch)
    if compose is not None:
        monkeypatch.setattr(adclip, "compose", compose)
    state = State(tmp_path / "s.db")
    wp = FakeWP()
    Recorder.seen.clear(); VideoRecorder.seen.clear()
    rw = FakeRewriter([Pick(brand="Cadbury", campaign="Kuch Khaas Hai", year=1994, hook="h")])
    report = pipeline.run_site(site, settings, state, rewriter=rw, wp=wp, publishers=[Recorder({}), VideoRecorder({})],
                               work_dir=tmp_path / "img")
    return report, wp, state


def test_the_official_film_is_fetched_reposted_in_the_article_and_becomes_the_reel(monkeypatch, settings, site, tmp_path):
    src = _synthetic(tmp_path / "src.mp4")
    fetched = {}

    def fetch(url, out_dir, *, player_clients, cookies):
        fetched["url"], fetched["clients"] = url, list(player_clients)
        out_dir.mkdir(parents=True, exist_ok=True)
        fetched["path"] = shutil.copy(src, out_dir / "aaa.mp4")
        return out_dir / "aaa.mp4"

    def compose(clip, frame, intro, outro, out, *, max_seconds):
        assert clip.exists() and frame.suffix == ".png" and max_seconds == settings.ad_clip_max_seconds
        shutil.copy(src, out)
        return out

    report, wp, state = _feature(monkeypatch, settings, site, tmp_path, {**FILM, "official": True}, fetch, compose)
    assert report.published == ["https://marketingmentalist.in/cadbury-kuch-khaas-hai/"]
    assert fetched["url"] == FILM["url"] and fetched["clients"] == ["android", "web"]
    content = wp.posts[0]["content"]
    assert content.startswith('<!-- wp:video {"id":') and "wp:embed" not in content and adclip.SLOT_OPEN not in content
    assert "Shown for review" in content and "Watch the original" in content, "the article credits the film and links the upload"
    assert any(p.name == "aaa.mp4" for p in wp.media), "the film itself is the article's video"
    reel = VideoRecorder.seen[0]
    assert reel.video_url and reel.video_path.name.endswith("-reel.mp4")
    assert "Ad: Cadbury, Kuch Khaas Hai. Video: Cadbury Dairy Milk India on YouTube. Shown for review." in reel.captions["instagram"]
    assert not Path(fetched["path"]).exists(), "the film is not kept once it is up"


def test_someone_elses_upload_is_never_fetched_and_stays_an_embed(monkeypatch, settings, site, tmp_path):
    def fetch(url, out_dir, **kw):
        raise AssertionError("a fan upload must not be fetched")

    report, wp, state = _feature(monkeypatch, settings, site, tmp_path, {**FILM, "channel": "AdArchiveIndia", "official": False}, fetch)
    assert report.published and wp.posts[0]["content"].startswith("<!-- wp:embed")
    assert adclip.SLOT_OPEN not in wp.posts[0]["content"]
    assert VideoRecorder.seen[0].video_url, "the narrated reel goes out as before"
    assert "Shown for review" not in VideoRecorder.seen[0].captions["instagram"]


def test_a_refused_download_falls_back_to_the_embed_and_the_narrated_reel(monkeypatch, settings, site, tmp_path):
    def fetch(url, out_dir, **kw):
        raise RuntimeError("download failed: Sign in to confirm you're not a bot")

    report, wp, state = _feature(monkeypatch, settings, site, tmp_path, {**FILM, "official": True}, fetch)
    assert report.published and wp.posts[0]["content"].startswith("<!-- wp:embed")
    assert VideoRecorder.seen[0].video_url


def test_with_the_switch_off_nothing_is_fetched(monkeypatch, settings, site, tmp_path):
    def fetch(url, out_dir, **kw):
        raise AssertionError("repost_ads is off")

    report, wp, state = _feature(monkeypatch, settings, site, tmp_path, {**FILM, "official": True}, fetch)
    settings.repost_ads = False
    assert nostalgia.fetch_film(site, settings, {**FILM, "official": True}, Pick(brand="Cadbury", campaign="x", hook="h"), tmp_path) is None


def test_find_ad_says_whether_the_upload_is_the_brands_own():
    assert youtube.is_official({"channel": "Cadbury Dairy Milk India"}, "Cadbury")
    assert not youtube.is_official({"channel": "AdArchiveIndia"}, "Cadbury")
    assert youtube.is_official({"channel": "HDFCMutualFund"}, "HDFC Mutual Fund")


def test_config_switches_the_repost_on_for_the_fleet(settings):
    from autopub import config
    live = config.load(Path(__file__).parent.parent / "config" / "sites.yaml")
    assert live.repost_ads is True and live.ad_clip_max_seconds == 120
    assert live.ad_clip_player_clients == ["android", "web"] and live.ad_clip_cookies == ""
