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
