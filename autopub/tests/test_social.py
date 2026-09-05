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
    assert REGISTRY["pinterest"].requires_image and REGISTRY["pinterest"].prefers_square
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


def test_image_selection():
    p = _post(image_landscape=Path("l.jpg"), image_square=Path("s.jpg"), image_square_url="https://x/s.jpg")
    assert p.image_path(prefer_square=True) == Path("s.jpg")
    assert p.image_path(prefer_square=False) == Path("l.jpg")
    assert p.image_url(prefer_square=False) == "https://x/s.jpg"   # falls back to whatever exists
