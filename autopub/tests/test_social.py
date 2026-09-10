from pathlib import Path

from autopub.social import REGISTRY, SocialPost, build_publishers, dispatch
from autopub.social.base import Publisher, PublishResult, fit_text
from autopub.social.linkedin import escape_little_text
from autopub.social.twitter import TCO_LENGTH


def _post(**kw):
    base = dict(title="T", link="https://marketingjunkies.in/x/", captions={"twitter": "tweet " * 100, "facebook": "fb"})
    base.update(kw)
    return SocialPost(**base)


def test_fit_text_word_boundary():
    out = fit_text("hello brave new world", 12, " L")
    assert len(out) <= 12 and out.endswith(" L") and "…" in out
    assert fit_text("short", 100, "\nL") == "short\nL"


def test_twitter_budget():
    pub = REGISTRY["twitter"]({})
    text = pub._text_with_link(_post(), link_len=TCO_LENGTH)
    body, link = text.rsplit("\n\n", 1)
    assert link == "https://marketingjunkies.in/x/"
    assert len(body) + 2 + TCO_LENGTH <= 280


def test_linkedin_escape():
    assert escape_little_text("50% off (today) #deal @you") == "50% off \\(today\\) \\#deal \\@you"


def test_registry_capabilities():
    assert REGISTRY["instagram"].supports_link is False and REGISTRY["instagram"].requires_image
    assert REGISTRY["pinterest"].requires_image and REGISTRY["pinterest"].image_shapes[0] == "portrait"
    assert REGISTRY["twitter"].supports_link and REGISTRY["twitter"].supports_image
    assert set(REGISTRY) == {"twitter", "facebook", "instagram", "linkedin", "pinterest", "telegram", "threads"}


def test_build_publishers_only_with_full_creds(site):
    env = {
        "TWITTER_MENTALIST_API_KEY": "k", "TWITTER_MENTALIST_API_SECRET": "s",
        "TWITTER_MENTALIST_ACCESS_TOKEN": "t", "TWITTER_MENTALIST_ACCESS_SECRET": "ts",
        "TELEGRAM_MENTALIST_BOT_TOKEN": "b",              # CHAT_ID missing -> skipped
        "FACEBOOK_CRAZY_PAGE_ID": "1", "FACEBOOK_CRAZY_PAGE_TOKEN": "x",   # other site -> ignored
    }
    pubs = build_publishers(site, env)
    assert [p.platform for p in pubs] == ["twitter"]


def test_dispatch_isolates_failures():
    class Boom(Publisher):
        platform = "boom"; env_prefix = "BOOM"; required_env = ()
        def _publish(self, post):
            raise RuntimeError("api down")

    class Fine(Publisher):
        platform = "fine"; env_prefix = "FINE"; required_env = ()
        def _publish(self, post):
            return PublishResult(self.platform, True, remote_id="1")

    class NeedsImage(Publisher):
        platform = "img"; env_prefix = "IMG"; required_env = (); requires_image = True
        def _publish(self, post):
            return PublishResult(self.platform, True)

    results = dispatch([Boom({}), Fine({}), NeedsImage({})], _post())
    assert [r.ok for r in results] == [False, True, False]
    assert "api down" in results[0].error
    assert "requires an image" in results[2].error


def test_image_selection_prefers_the_named_shapes_then_anything():
    p = _post(images={"landscape": Path("l.jpg"), "square": Path("s.jpg"), "portrait": Path("p.jpg")},
              image_urls={"square": "https://x/s.jpg"})
    assert p.image_path("portrait", "square") == Path("p.jpg")
    assert p.image_path("landscape") == Path("l.jpg")
    assert p.image_path("nosuchshape") == Path("p.jpg")            # falls back rather than returning nothing
    assert p.image_url("landscape") == "https://x/s.jpg"           # only the square made it to WordPress
    assert _post().image_path("portrait") is None


def test_instagram_asks_for_the_tallest_card_first():
    assert REGISTRY["instagram"].image_shapes[0] == "portrait"
    assert REGISTRY["pinterest"].image_shapes[0] == "portrait"
    assert REGISTRY["twitter"].image_shapes[0] == "landscape"


def test_instagram_caption_stays_inside_the_platform_limits():
    from autopub.social.instagram import MAX_HASHTAGS, trim_hashtags
    pub = REGISTRY["instagram"]({})
    tags = " ".join(f"#tag{i}" for i in range(45))
    assert trim_hashtags(f"body text {tags}").count("#") == MAX_HASHTAGS
    caption = pub.caption(_post(captions={"instagram": "hook line " * 400 + tags}))
    assert len(caption) <= pub.text_limit and caption.endswith("https://marketingjunkies.in/x/")


def test_instagram_walks_down_to_the_next_shape_when_a_card_is_refused(monkeypatch):
    """A 3:4 card is below Instagram's documented 4:5 floor: the square must still go out."""
    from autopub.social import instagram as ig
    tried = []

    class Resp:
        status_code = 200
        headers = {"Content-Type": "image/jpeg"}

        def __init__(self, payload):
            self._payload = payload

        def json(self):
            return self._payload

        def close(self):
            pass

    def fake_post(url, data=None, **kw):
        if url.endswith("/media"):
            tried.append(data["image_url"])
            if "portrait" in data["image_url"]:
                return Resp({"error": {"code": 36003, "error_subcode": 2207009,
                                       "message": "The submitted image with aspect ratio 0.75 cannot be published."}})
            return Resp({"id": "container-1"})
        return Resp({"id": "media-9"})

    def fake_get(url, params=None, **kw):
        if url.endswith("/content_publishing_limit"):
            return Resp({"data": [{"config": {"quota_total": 100}, "quota_usage": 3}]})
        if "container-1" in url:
            return Resp({"status_code": "FINISHED"})
        if url.startswith("https://cdn/"):
            return Resp({})
        return Resp({"permalink": "https://instagram.com/p/abc/"})

    monkeypatch.setattr(ig.requests, "post", fake_post)
    monkeypatch.setattr(ig.requests, "get", fake_get)
    pub = REGISTRY["instagram"]({"USER_ID": "1", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(image_urls={"portrait": "https://cdn/portrait.jpg", "square": "https://cdn/square.jpg"}))
    assert res.ok and res.url == "https://instagram.com/p/abc/"
    assert tried == ["https://cdn/portrait.jpg", "https://cdn/square.jpg"]


def test_instagram_stops_when_the_daily_quota_is_gone(monkeypatch):
    from autopub.social import instagram as ig

    class Resp:
        status_code = 200
        headers = {"Content-Type": "image/jpeg"}
        def json(self):
            return {"data": [{"config": {"quota_total": 100}, "quota_usage": 100}]}
        def close(self):
            pass

    monkeypatch.setattr(ig.requests, "get", lambda *a, **k: Resp())
    pub = REGISTRY["instagram"]({"USER_ID": "1", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(image_urls={"square": "https://cdn/s.jpg"}))
    assert not res.ok and "quota" in res.error


def test_instagram_captions_cannot_break_the_documented_limits():
    """2200 chars, 30 hashtags, 20 mentions - Meta rejects the caption rather than trimming it."""
    from autopub.social.instagram import MAX_HASHTAGS, MAX_MENTIONS
    pub = REGISTRY["instagram"]({})
    caption = pub.caption(_post(captions={"instagram": ("word " * 900) + " ".join(f"#t{i}" for i in range(60))
                                          + " " + " ".join(f"@u{i}" for i in range(40))}))
    assert len(caption) <= pub.text_limit
    assert caption.count("#") <= MAX_HASHTAGS
    assert caption.count("@") <= MAX_MENTIONS


def test_instagram_refuses_an_unfetchable_image_before_calling_meta(monkeypatch):
    """Meta cURLs the URL itself; a 404 there is the commonest cause of a failed container."""
    from autopub.social import instagram as ig
    calls = []

    class Resp:
        status_code = 404
        headers = {"Content-Type": "text/html"}
        def json(self):
            return {"data": [{"config": {"quota_total": 100}, "quota_usage": 0}]}
        def close(self):
            pass

    monkeypatch.setattr(ig.requests, "get", lambda *a, **k: Resp())
    monkeypatch.setattr(ig.requests, "post", lambda *a, **k: calls.append(a) or Resp())
    pub = REGISTRY["instagram"]({"USER_ID": "1", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(image_urls={"square": "https://cdn/gone.jpg"}))
    assert not res.ok and "404" in res.error
    assert not calls, "we asked Meta to fetch an image we already knew it could not get"
