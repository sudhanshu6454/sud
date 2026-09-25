"""Reels: the story frames as a short video, twice a day, on Instagram and the Facebook Page."""
from datetime import datetime, timezone

from PIL import Image

from autopub import carousels, extract, images, pipeline, sources, video
from autopub.rewrite import Captions, CuratedPost, StoryFrame
from autopub.social import REGISTRY, build_publishers
from autopub.social import reels as rl
from autopub.social.base import Publisher, PublishResult
from autopub.state import State
from tests.test_pipeline import FakeWP
from tests.test_social import _graph, _post


# ---- timing -------------------------------------------------------------------------------------

def test_a_frame_holds_for_its_reading_time_inside_the_bounds():
    assert video.hold_for("") == video.MIN_HOLD
    assert video.hold_for("x" * 90) == 6.0
    assert video.hold_for("x" * 400) == video.MAX_HOLD
    frames = ["cover", "a", "b", "end"]
    d = video.plan(frames, [None, "x" * 60, "x" * 300, None])
    assert d == [video.COVER_HOLD, video.MIN_HOLD, video.MAX_HOLD, video.CLOSING_HOLD]


# ---- rendering ----------------------------------------------------------------------------------

def test_the_reel_is_a_1080x1920_h264_mp4_with_an_audio_track_and_the_planned_length(site, tmp_path):
    a = images.story_closing_frame("A headline", site, tmp_path / "a.jpg")
    b = images.story_text_frame("What happened", "Facts. " * 20, 1, 1, site, tmp_path / "b.jpg", kicker="News")
    out = video.render_reel([a, b, a], tmp_path / "r.mp4", [0.5, 0.7, 0.5], images.hex_to_rgb(site.brand.accent), fps=10, dissolve=0.2)
    info = video.probe(out)
    assert (info["width"], info["height"], info["codec"]) == (1080, 1920, "h264")
    assert info["audio"], "Instagram wants an audio stream even for a silent reel"
    assert abs(info["duration"] - 1.7) < 0.35
    assert out.stat().st_size > 10_000


def test_the_reel_refuses_nonsense_before_touching_ffmpeg(site, tmp_path):
    a = images.story_closing_frame("A headline", site, tmp_path / "a.jpg")
    for frames, durations in (([a], [1.0]), ([a, a], [1.0])):
        try:
            video.render_reel(frames, tmp_path / "x.mp4", durations, (255, 0, 0))
        except ValueError:
            continue
        raise AssertionError("bad input accepted")


def test_the_progress_bar_sits_in_the_top_band_in_the_accent(site, tmp_path):
    from PIL import Image as _I
    frame = _I.new("RGB", (1080, 1920), (0, 0, 0))
    video._progress(frame, 1, 4, 0.5, (255, 51, 102), (255, 255, 255))
    seg = (1080 - video.BAR_SIDE * 2 - video.BAR_GAP * 3) / 4
    y = video.BAR_Y + 2
    assert frame.getpixel((int(video.BAR_SIDE + seg / 2), y)) == (255, 51, 102), "first segment done"
    assert frame.getpixel((int(video.BAR_SIDE + seg + video.BAR_GAP + seg * 0.25), y)) == (255, 51, 102), "current segment half full"
    r, g, b = frame.getpixel((int(video.BAR_SIDE + seg + video.BAR_GAP + seg * 0.9), y))
    assert r == g == b and 40 < r < 120, "the rest is the faint track"


# ---- publishers ---------------------------------------------------------------------------------

def test_reel_publishers_come_from_the_feed_credentials(site):
    env = {"INSTAGRAM_TEST_USER_ID": "17", "INSTAGRAM_TEST_ACCESS_TOKEN": "t",
           "FACEBOOK_TEST_PAGE_ID": "42", "FACEBOOK_TEST_PAGE_TOKEN": "p"}
    site.socials = ["instagram_reel", "facebook_video"]
    site.key = "TEST"
    assert [p.platform for p in build_publishers(site, env)] == ["instagram_reel", "facebook_video"]


def test_instagram_posts_a_reels_container_with_the_cover_and_publishes_it(monkeypatch):
    media_calls = []

    def media(method, url, kwargs):
        media_calls.append(dict(kwargs.get("data", {})))
        return 200, {"id": "reel-c1"}

    call, Resp = _graph({
        "/content_publishing_limit": (200, {"data": [{"config": {"quota_total": 100}, "quota_usage": 3}]}),
        "/media_publish": (200, {"id": "reel-77"}),
        "/reel-77": (200, {"permalink": "https://instagram.com/reel/abc/"}),
        "/reel-c1": (200, {"status_code": "FINISHED"}),
        "/media": media,
    })
    monkeypatch.setattr(rl.time, "sleep", lambda s: None)
    import autopub.social.instagram as ig
    monkeypatch.setattr(ig.requests, "request", call)
    pub = REGISTRY["instagram_reel"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(captions={"instagram": "Hook"}, video_url="https://cdn/reel.mp4",
                            video_cover_url="https://cdn/story.jpg", carousel_urls=["a", "b"]))
    assert res.ok and res.format == "reel" and res.remote_id == "reel-77" and res.url == "https://instagram.com/reel/abc/"
    (c,) = media_calls
    assert c["media_type"] == "REELS" and c["video_url"] == "https://cdn/reel.mp4" and c["cover_url"] == "https://cdn/story.jpg"
    assert c["share_to_feed"] == "true"
    assert ig.CTA in c["caption"] and ig.SWIPE not in c["caption"], "a reel caption never carries the carousel's swipe line"


def test_a_reel_without_a_video_fails_on_its_own_row():
    pub = REGISTRY["instagram_reel"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(image_urls={"portrait": "https://cdn/p.jpg"}))
    assert not res.ok and "reel" in res.error


def test_facebook_posts_the_file_url_as_a_page_video_with_the_link(monkeypatch):
    calls = []

    def post(url, data=None, timeout=None):
        calls.append((url.rsplit("/", 1)[-1], dict(data)))
        class R:
            status_code = 200
            def json(self_inner):
                return {"id": "555"}
        return R()

    monkeypatch.setattr(rl.requests, "post", post)
    pub = REGISTRY["facebook_video"]({"PAGE_ID": "42", "PAGE_TOKEN": "p"})
    res = pub.publish(_post(video_url="https://cdn/reel.mp4"))
    assert res.ok and res.format == "video" and res.url == "https://www.facebook.com/42/videos/555"
    name, data = calls[0]
    assert name == "videos" and data["file_url"] == "https://cdn/reel.mp4" and "https://marketingjunkies.in/x/" in data["description"]


# ---- the pipeline -------------------------------------------------------------------------------

class StoryRewriter:
    def rewrite(self, site, article, carousel=False):
        return CuratedPost(
            title=f"Curated: {article.title}", category="Campaigns", slug=article.title.lower(), excerpt="e" * 120,
            body_html="<p>x</p>", tags=["a"], image_headline="Curated story", image_kicker="News",
            captions=Captions(twitter="tw", facebook="fb", instagram="ig", linkedin="li", pinterest_title="pt",
                              pinterest="pi", telegram="tg", threads="th"),
            story_frames=[StoryFrame(heading="What happened", body="Facts. " * 10), StoryFrame(heading="Why it matters", body="Stakes. " * 10)],
        )


class VideoRecorder(Publisher):
    platform = "video_rec"; env_prefix = "REC"; required_env = ()
    needs_public_url = True; wants_video = True
    seen: list = []

    def _publish(self, post):
        VideoRecorder.seen.append(post)
        return PublishResult(self.platform, bool(post.video_url), remote_id="v1", format="reel" if post.video_url else None,
                             error=None if post.video_url else "no video")


def _run(monkeypatch, settings, site, tmp_path, state, publishers, n=1):
    now = datetime.now(timezone.utc)
    cands = [sources.Candidate(f"Story{i}", f"https://pub.com/{i}", "", now, "Pub") for i in range(n)]
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: cands)
    monkeypatch.setattr(extract, "extract", lambda url, timeout=30: Article(url=url, title=url.rsplit("/", 1)[1], text="w " * 600, sitename="Pub", image=None))
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    # keep the test quick: a stubby render that still writes a real file through the same call
    real = video.render_reel
    monkeypatch.setattr(video, "render_reel", lambda frames, out, durations, accent, **kw: real(frames, out, [0.3] * len(frames), accent, fps=6, dissolve=0.1))
    wp = FakeWP()
    report = pipeline.run_site(site, settings, state, rewriter=StoryRewriter(), wp=wp, publishers=publishers,
                               work_dir=tmp_path / "img", limit=n)
    return report, wp


from autopub.extract import Article  # noqa: E402


def test_the_due_article_gets_a_reel_uploaded_and_the_slot_is_spent(monkeypatch, settings, site, tmp_path):
    settings.reel_hours = [0]
    settings.carousel_hours = []
    state = State(tmp_path / "s.db")
    VideoRecorder.seen.clear()
    report, wp = _run(monkeypatch, settings, site, tmp_path, state, [VideoRecorder({})], n=2)
    assert len(report.published) == 2 and report.social_ok == 1 and report.social_failed == 0
    (first,) = VideoRecorder.seen
    assert first.video_url and first.video_url.endswith("-reel.mp4") and first.video_path.exists()
    assert first.video_cover_url is None, "no story publisher, so the 9:16 cover was not hosted; the reel still goes"
    assert video.probe(first.video_path)["codec"] == "h264"
    # the second article in the slot is not a reel: the video publisher stands aside, no failure row
    assert len(carousels.parse_log(state.note(site.key, pipeline.REEL_NOTE))) == 1


def test_no_video_publisher_means_no_reel_is_rendered(monkeypatch, settings, site, tmp_path):
    from tests.test_pipeline import Recorder
    settings.reel_hours = [0]
    Recorder.seen.clear()
    calls = []
    monkeypatch.setattr(video, "render_reel", lambda *a, **k: calls.append(1))
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [sources.Candidate("S", "https://pub.com/s", "", now, "Pub")])
    monkeypatch.setattr(extract, "extract", lambda url, timeout=30: Article(url=url, title="s", text="w " * 600, sitename="Pub", image=None))
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    pipeline.run_site(site, settings, State(tmp_path / "s.db"), rewriter=StoryRewriter(), wp=FakeWP(), publishers=[Recorder({})],
                      work_dir=tmp_path / "img", limit=1)
    assert calls == [] and Recorder.seen[0].video_url is None


def test_settings_carry_the_reel_slots(settings):
    assert settings.reel_hours == [12, 21] and settings.reel_share_to_feed is True
    from autopub import config
    assert config.Settings(sites=settings.sites).reel_hours == [12, 21]


def test_the_reel_stands_in_for_the_card_and_a_failed_reel_hands_it_back():
    from autopub.social import dispatch
    from autopub.social.base import SocialPost

    class Card(Publisher):
        platform = "instagram"; env_prefix = "X"; required_env = ()
        seen = 0
        def _publish(self, post):
            Card.seen += 1
            return PublishResult(self.platform, True, remote_id="card")

    class Reel(Publisher):
        platform = "instagram_reel"; env_prefix = "X"; required_env = (); wants_video = True; replaces = "instagram"
        ok = True
        def _publish(self, post):
            return PublishResult(self.platform, Reel.ok, remote_id="reel", format="reel", error=None if Reel.ok else "meta said no")

    class Story(Publisher):
        platform = "instagram_story"; env_prefix = "X"; required_env = (); image_shapes = ("story",)
        def _publish(self, post):
            return PublishResult(self.platform, True, remote_id="story")

    with_video = SocialPost(title="T", link="https://x/", captions={}, image_urls={"portrait": "p", "story": "s"}, video_url="v", story_urls=["s"])
    Card.seen = 0; Reel.ok = True
    results = dispatch([Card({}), Story({}), Reel({})], with_video)
    assert [r.platform for r in results] == ["instagram_reel", "instagram_story"], "the reel goes first and the card stays home; the story still goes"
    assert Card.seen == 0
    Reel.ok = False
    results = dispatch([Card({}), Story({}), Reel({})], with_video)
    assert [(r.platform, r.ok) for r in results] == [("instagram_reel", False), ("instagram", True), ("instagram_story", True)]
    assert Card.seen == 1, "a failed reel hands the slot back to the card"
    without = SocialPost(title="T", link="https://x/", captions={}, image_urls={"portrait": "p"})
    Card.seen = 0
    results = dispatch([Card({}), Story({}), Reel({})], without)
    assert [r.platform for r in results] == ["instagram"] and Card.seen == 1, "no reel: the card as always, the story idle"
