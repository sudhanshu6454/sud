"""Stories: the same card, 9:16, posted after the feed post on Instagram and the Facebook Page."""
from PIL import Image

from autopub import cards, images
from autopub.social import REGISTRY, build_publishers
from autopub.social import stories as st
from tests.test_social import _graph, _post


def test_story_asset_is_9_16_on_the_brand_ground_with_the_card_inside_the_safe_zones(site, tmp_path):
    card = images.render_card("A headline for the story", "Branding", site, tmp_path / "card.jpg", "portrait",
                              card=cards.brief(cards.INVERSE, None, "A headline for the story", "Branding", None))
    story = images.story_asset(card, site, tmp_path / "story.jpg")
    with Image.open(story) as im:
        assert im.size == images.STORY_SIZE and im.size[0] / im.size[1] == 1440 / 2560
        px = im.convert("RGB")
        primary = images.hex_to_rgb(site.brand.primary)
        # the bands Instagram draws its controls over hold only the brand ground, never the card
        for y in (40, images.STORY_SAFE - 20, im.height - images.STORY_SAFE + 20, im.height - 40):
            c = px.getpixel((im.width // 2, y))
            assert sum(abs(a - b) for a, b in zip(c, primary)) < 90, f"card content in the safe band at y={y}"


def test_story_publishers_come_from_the_same_credentials_as_the_feed(site, monkeypatch):
    env = {"INSTAGRAM_TEST_USER_ID": "17", "INSTAGRAM_TEST_ACCESS_TOKEN": "t",
           "FACEBOOK_TEST_PAGE_ID": "42", "FACEBOOK_TEST_PAGE_TOKEN": "p"}
    site.socials = ["facebook", "instagram", "instagram_story", "facebook_story"]
    site.key = "TEST"
    pubs = build_publishers(site, env)
    assert [p.platform for p in pubs] == ["facebook", "instagram", "instagram_story", "facebook_story"], \
        "stories run after the feed posts, from the feed credentials"
    assert all(p.needs_public_url and p.image_shapes == ("story",) for p in pubs[2:])


def test_instagram_story_uses_the_stories_media_type_and_publishes_the_container(monkeypatch):
    calls = []

    def post(url, data=None, timeout=None):
        calls.append((url.rsplit("/", 1)[-1], dict(data or {})))
        class R:
            def json(self_inner):
                if url.endswith("/media"):
                    return {"id": "story-container"}
                return {"id": "story-9"}
        return R()

    def get(url, params=None, timeout=None):
        class R:
            def json(self_inner):
                return {"status_code": "FINISHED"}
        return R()

    monkeypatch.setattr(st.requests, "post", post)
    monkeypatch.setattr(st.requests, "get", get)
    monkeypatch.setattr(st.time, "sleep", lambda s: None)
    pub = REGISTRY["instagram_story"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(image_urls={"story": "https://cdn/story.jpg", "portrait": "https://cdn/p.jpg"}))
    assert res.ok and res.remote_id == "story-9" and res.url is None
    assert calls[0][0] == "media" and calls[0][1]["media_type"] == "STORIES" and calls[0][1]["image_url"] == "https://cdn/story.jpg"
    assert calls[1][0] == "media_publish" and calls[1][1]["creation_id"] == "story-container"


def test_instagram_story_publishes_again_when_the_media_is_not_ready_yet(monkeypatch):
    publishes = []

    def post(url, data=None, timeout=None):
        class R:
            def json(self_inner):
                if url.endswith("/media"):
                    return {"id": "c1"}
                publishes.append(1)
                if len(publishes) < 3:
                    return {"error": {"code": 9007, "error_subcode": 2207027, "message": "Media ID is not available"}}
                return {"id": "s1"}
        return R()

    monkeypatch.setattr(st.requests, "post", post)
    monkeypatch.setattr(st.requests, "get", lambda *a, **k: type("R", (), {"json": lambda s: {"status_code": "FINISHED"}})())
    monkeypatch.setattr(st.time, "sleep", lambda s: None)
    pub = REGISTRY["instagram_story"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(image_urls={"story": "https://cdn/story.jpg"}))
    assert res.ok and len(publishes) == 3


def test_facebook_story_uploads_unpublished_then_posts_the_story(monkeypatch):
    calls = []

    def post(url, data=None, timeout=None):
        calls.append((url.rsplit("/", 1)[-1], dict(data or {})))
        class R:
            def json(self_inner):
                if url.endswith("/photos"):
                    return {"id": "photo-1"}
                return {"success": True, "post_id": "42_777"}
        return R()

    monkeypatch.setattr(st.requests, "post", post)
    pub = REGISTRY["facebook_story"]({"PAGE_ID": "42", "PAGE_TOKEN": "p"})
    res = pub.publish(_post(image_urls={"story": "https://cdn/story.jpg"}))
    assert res.ok and res.remote_id == "42_777" and res.url == "https://www.facebook.com/42_777"
    assert calls[0] == ("photos", {"url": "https://cdn/story.jpg", "published": "false", "access_token": "p"})
    assert calls[1] == ("photo_stories", {"photo_id": "photo-1", "access_token": "p"})


def test_a_story_without_its_asset_fails_on_its_own_row_and_touches_nothing(monkeypatch):
    monkeypatch.setattr(st.requests, "post", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no call expected")))
    pub = REGISTRY["facebook_story"]({"PAGE_ID": "42", "PAGE_TOKEN": "p"})
    res = pub.publish(_post(image_urls={"portrait": "https://cdn/p.jpg"}))   # feed asset only, no story
    assert not res.ok and "story asset" in res.error


def _story_post(urls):
    return _post(image_urls={"story": urls[0], "portrait": "https://cdn/p.jpg"}, story_urls=list(urls))


def test_instagram_posts_every_frame_in_order_cover_first(monkeypatch):
    created = []

    def post(url, data=None, timeout=None):
        class R:
            def json(self_inner):
                if url.endswith("/media"):
                    created.append(data["image_url"]); return {"id": f"c{len(created)}"}
                return {"id": "s" + data["creation_id"][1:]}
        return R()

    monkeypatch.setattr(st.requests, "post", post)
    monkeypatch.setattr(st.requests, "get", lambda *a, **k: type("R", (), {"json": lambda s: {"status_code": "FINISHED", "data": [{"config": {"quota_total": 100}, "quota_usage": 10}]}})())
    monkeypatch.setattr(st.time, "sleep", lambda s: None)
    pub = REGISTRY["instagram_story"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    urls = ["https://cdn/cover.jpg", "https://cdn/f1.jpg", "https://cdn/f2.jpg", "https://cdn/end.jpg"]
    res = pub.publish(_story_post(urls))
    assert res.ok and created == urls, "frames go up in the order given, cover first"
    assert res.remote_id == "s1,s2,s3,s4" and res.error is None


def test_a_frame_failing_after_the_cover_ends_the_story_early_but_keeps_it(monkeypatch):
    n = {"media": 0}

    def post(url, data=None, timeout=None):
        class R:
            def json(self_inner):
                if url.endswith("/media"):
                    n["media"] += 1
                    if n["media"] == 3:
                        return {"error": {"code": 100, "error_subcode": 2207005, "message": "bad image"}}
                    return {"id": f"c{n['media']}"}
                return {"id": "s" + data["creation_id"][1:]}
        return R()

    monkeypatch.setattr(st.requests, "post", post)
    monkeypatch.setattr(st.requests, "get", lambda *a, **k: type("R", (), {"json": lambda s: {"status_code": "FINISHED", "data": [{"config": {"quota_total": 100}, "quota_usage": 10}]}})())
    monkeypatch.setattr(st.time, "sleep", lambda s: None)
    pub = REGISTRY["instagram_story"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    res = pub.publish(_story_post(["https://cdn/c.jpg", "https://cdn/1.jpg", "https://cdn/2.jpg", "https://cdn/e.jpg"]))
    assert res.ok and res.remote_id == "s1,s2" and "frame 3" in res.error


def test_the_story_is_shortened_when_the_daily_allowance_runs_low(monkeypatch):
    created = []

    def post(url, data=None, timeout=None):
        class R:
            def json(self_inner):
                if url.endswith("/media"):
                    created.append(1); return {"id": f"c{len(created)}"}
                return {"id": "s"}
        return R()

    monkeypatch.setattr(st.requests, "post", post)
    monkeypatch.setattr(st.requests, "get", lambda *a, **k: type("R", (), {"json": lambda s: {"status_code": "FINISHED", "data": [{"config": {"quota_total": 100}, "quota_usage": 92}]}})())
    monkeypatch.setattr(st.time, "sleep", lambda s: None)
    pub = REGISTRY["instagram_story"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    res = pub.publish(_story_post(["https://cdn/c.jpg", "https://cdn/1.jpg", "https://cdn/2.jpg", "https://cdn/3.jpg", "https://cdn/e.jpg"]))
    assert res.ok and len(created) == 8 - st.FEED_RESERVE, "8 left minus the reserve for feed posts"


def test_facebook_posts_the_frames_as_a_sequence_of_page_stories(monkeypatch):
    calls = []

    def post(url, data=None, timeout=None):
        calls.append(url.rsplit("/", 1)[-1])
        class R:
            def json(self_inner):
                if url.endswith("/photos"):
                    return {"id": f"photo-{len(calls)}"}
                return {"success": True, "post_id": f"42_{len(calls)}"}
        return R()

    monkeypatch.setattr(st.requests, "post", post)
    pub = REGISTRY["facebook_story"]({"PAGE_ID": "42", "PAGE_TOKEN": "p"})
    res = pub.publish(_story_post(["https://cdn/c.jpg", "https://cdn/1.jpg", "https://cdn/e.jpg"]))
    assert res.ok and calls == ["photos", "photo_stories"] * 3
    assert res.remote_id.count(",") == 2 and res.url == "https://www.facebook.com/42_2"


def test_story_text_and_closing_frames_are_9_16_and_keep_the_safe_bands_clear(site, tmp_path):
    from autopub.rewrite import StoryFrame
    f = images.story_text_frame("Why this matters for marketers", "Location signals feed attribution. " * 6, 1, 2, site, tmp_path / "f.jpg", kicker="Privacy")
    e = images.story_closing_frame("Google fined over location data", site, tmp_path / "e.jpg")
    primary = images.hex_to_rgb(site.brand.primary)
    for path in (f, e):
        with Image.open(path) as im:
            assert im.size == images.STORY_SIZE
            px = im.convert("RGB")
            for y in (30, im.height - 30):
                c = px.getpixel((im.width // 2, y))
                assert sum(abs(a - b) for a, b in zip(c, primary)) < 90, f"content in the safe band at y={y}"
    assert StoryFrame(heading="h", body="b").body == "b"


def test_curated_post_accepts_story_frames_and_defaults_to_none():
    from autopub.rewrite import CuratedPost
    base = dict(title="T", slug="t", excerpt="E", body_html="<p>x</p>", image_headline="H", image_kicker="K",
                captions=dict(twitter="", facebook="", instagram="", linkedin="", pinterest_title="", pinterest="",
                              telegram="", threads=""))
    assert CuratedPost(**base).story_frames == []
    post = CuratedPost(**base, story_frames=[{"heading": "What happened", "body": "Facts."}, {"heading": "Why it matters", "body": "Stakes."}])
    assert [f.heading for f in post.story_frames] == ["What happened", "Why it matters"]


def test_a_frame_meta_loses_gets_one_more_try_before_the_story_stops(monkeypatch):
    """Meta sometimes answers media_publish with 'The requested resource does not exist' for a container
    it made a moment ago; the same frame goes through on the second try."""
    publishes = []

    def post(url, data=None, timeout=None):
        class R:
            def json(self_inner):
                if url.endswith("/media"):
                    return {"id": f"c{len(publishes)}"}
                publishes.append(data["creation_id"])
                if len(publishes) == 2:      # the second frame's first try
                    return {"error": {"code": 24, "error_subcode": 2207006, "message": "The requested resource does not exist"}}
                return {"id": f"s{len(publishes)}"}
        return R()

    def get(url, params=None, timeout=None):
        class R:
            def json(self_inner):
                return {"status_code": "FINISHED"}
        return R()

    slept = []
    monkeypatch.setattr(st.requests, "post", post)
    monkeypatch.setattr(st.requests, "get", get)
    monkeypatch.setattr(st.time, "sleep", lambda s: slept.append(s))
    pub = REGISTRY["instagram_story"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(image_urls={"story": "https://cdn/story.jpg", "portrait": "https://cdn/p.jpg"},
                            story_urls=["https://cdn/story.jpg", "https://cdn/f2.jpg", "https://cdn/f3.jpg"]))
    assert res.ok and res.error is None, res.error
    assert len(res.remote_id.split(",")) == 3, "all three frames went up"
    assert len(publishes) == 4 and st.RETRY_PAUSE in slept, "one frame took two publishes, after a pause"
