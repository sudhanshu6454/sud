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


def _graph(routes):
    """Stand in for requests.request against the Graph API. `routes` maps a URL fragment to a
    (status, payload) pair or a callable taking (method, url, kwargs)."""
    class Resp:
        def __init__(self, status, payload, text=None):
            self.status_code, self._payload, self.text = status, payload, text or ""
            self.headers = {"Content-Type": "image/jpeg"}

        def json(self):
            if self._payload is None:
                raise ValueError("no json")
            return self._payload

        def close(self):
            pass

    def call(method, url, **kwargs):
        for fragment, answer in routes.items():
            if fragment in url:
                status, payload = answer(method, url, kwargs) if callable(answer) else answer
                return Resp(status, payload)
        return Resp(200, {})
    return call, Resp


def test_instagram_caption_stays_inside_the_platform_limits():
    from autopub.social.instagram import HASHTAG, MAX_HASHTAGS, MAX_MENTIONS, MENTION, trim_tags
    pub = REGISTRY["instagram"]({})
    # the shape the rewriter is actually prompted to produce: a hook, then hashtags on their own line
    body = "A hook line that sits at the top of the caption.\n\n"
    tags = "\n".join(" ".join(f"#tag{i * 5 + j}" for j in range(5)) for i in range(9))
    trimmed = trim_tags(body + tags + "\n" + " ".join(f"@user{i}" for i in range(28)))
    assert len(HASHTAG.findall(trimmed)) == MAX_HASHTAGS   # 45 offered, on nine separate lines
    assert len(MENTION.findall(trimmed)) == MAX_MENTIONS
    assert trimmed.startswith("A hook line")
    caption = pub.caption(_post(captions={"instagram": body + tags}))
    assert len(caption) <= pub.text_limit and caption.endswith("https://marketingjunkies.in/x/")


def test_instagram_walks_down_to_the_next_shape_when_a_card_is_refused(monkeypatch):
    """A 3:4 card is below Instagram's documented 4:5 floor: the square must still go out."""
    from autopub.social import instagram as ig
    tried = []

    def media(method, url, kwargs):
        image = kwargs.get("data", {}).get("image_url", "")
        tried.append(image)
        if "portrait" in image:
            return 200, {"error": {"code": 36003, "error_subcode": 2207009,
                                   "message": "The submitted image with aspect ratio 0.75 cannot be published."}}
        return 200, {"id": "container-1"}

    call, Resp = _graph({
        "/content_publishing_limit": (200, {"data": [{"config": {"quota_total": 100}, "quota_usage": 3}]}),
        "/media_publish": (200, {"id": "media-9"}),
        "/media-9": (200, {"permalink": "https://instagram.com/p/abc/"}),
        "container-1": (200, {"status_code": "FINISHED"}),
        "/media": media,
    })
    monkeypatch.setattr(ig.requests, "request", call)
    monkeypatch.setattr(ig.requests, "get", lambda *a, **k: Resp(200, {}))
    pub = REGISTRY["instagram"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(image_urls={"portrait": "https://cdn/portrait.jpg", "square": "https://cdn/square.jpg"}))
    assert res.ok and res.remote_id == "media-9"
    assert tried == ["https://cdn/portrait.jpg", "https://cdn/square.jpg"]


def test_instagram_stops_when_the_daily_quota_is_gone(monkeypatch):
    from autopub.social import instagram as ig
    call, _ = _graph({"/content_publishing_limit": (200, {"data": [{"config": {"quota_total": 100},
                                                                   "quota_usage": 100}]})})
    monkeypatch.setattr(ig.requests, "request", call)
    pub = REGISTRY["instagram"]({"USER_ID": "1", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(image_urls={"square": "https://cdn/s.jpg"}))
    assert not res.ok and "quota" in res.error


def test_a_network_blip_is_not_treated_as_a_file_meta_will_never_accept(monkeypatch):
    """Our own egress failing says nothing about what Meta's fetcher can reach."""
    from autopub.social import instagram as ig
    seen = []

    def refuse(*a, **k):
        raise ig.requests.ConnectionError("hairpin NAT is unreliable")

    call, _ = _graph({
        "/content_publishing_limit": (200, {"data": [{"config": {"quota_total": 100}, "quota_usage": 0}]}),
        "/media_publish": (200, {"id": "m1"}),
        "/media": lambda m, u, k: (seen.append(k.get("data", {}).get("image_url")), (200, {"id": "c1"}))[1],
        "c1": (200, {"status_code": "FINISHED"}),
    })
    monkeypatch.setattr(ig.requests, "request", call)
    monkeypatch.setattr(ig.requests, "get", refuse)          # the preflight cannot reach the URL
    pub = REGISTRY["instagram"]({"USER_ID": "1", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(image_urls={"portrait": "https://cdn/p.jpg", "square": "https://cdn/s.jpg"}))
    assert res.ok, "a local fetch failure lost the post"
    assert seen == ["https://cdn/p.jpg"], "Meta was never asked about the card we could not fetch"


def test_a_non_json_error_page_from_meta_is_transient_not_fatal(monkeypatch):
    from autopub.social import instagram as ig
    call, Resp = _graph({"/media": (502, None)})
    monkeypatch.setattr(ig.requests, "request", call)
    monkeypatch.setattr(ig.requests, "get", lambda *a, **k: Resp(200, {}))
    monkeypatch.setattr(ig.time, "sleep", lambda s: None)
    pub = REGISTRY["instagram"]({"USER_ID": "1", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(image_urls={"square": "https://cdn/s.jpg"}))
    assert not res.ok and "502" in res.error   # reported, not raised as an unclassified crash


def test_instagram_captions_cannot_break_the_documented_limits():
    """2200 chars, 30 hashtags, 20 mentions - Meta rejects the caption rather than trimming it."""
    from autopub.social.instagram import HASHTAG, MAX_HASHTAGS, MAX_MENTIONS, MENTION
    pub = REGISTRY["instagram"]({})
    # short enough that fit_text cannot do the trimming for us: the limits must be enforced directly
    caption = pub.caption(_post(captions={"instagram": ("hook. " * 30) + "\n"
                                          + "\n".join(f"#t{i}" for i in range(45)) + "\n"
                                          + " ".join(f"@u{i}" for i in range(30))}))
    assert len(caption) < pub.text_limit, "truncation did the work instead of the limits"
    assert len(HASHTAG.findall(caption)) <= MAX_HASHTAGS
    assert len(MENTION.findall(caption)) <= MAX_MENTIONS


def test_a_missing_image_is_caught_before_meta_is_asked_to_fetch_it(monkeypatch):
    """A server that answers and says the file is gone is the one case worth pre-empting."""
    from autopub.social import instagram as ig
    asked = []

    call, _ = _graph({
        "/content_publishing_limit": (200, {"data": [{"config": {"quota_total": 100}, "quota_usage": 0}]}),
        "/media": lambda m, u, k: (asked.append(u), (200, {"id": "c1"}))[1],
    })

    class Gone:
        status_code = 404
        headers = {"Content-Type": "text/html"}
        def close(self):
            pass

    monkeypatch.setattr(ig.requests, "request", call)
    monkeypatch.setattr(ig.requests, "get", lambda *a, **k: Gone())
    pub = REGISTRY["instagram"]({"USER_ID": "1", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(image_urls={"square": "https://cdn/gone.jpg"}))
    assert not res.ok and "404" in res.error
    assert not asked, "we asked Meta to fetch an image we already knew was gone"
