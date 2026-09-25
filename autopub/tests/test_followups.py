"""Hooks on every card and caption, and the follow-ups that trail an article: the steal card, the
debate story and the throwback's hot take, queued when the article publishes and posted later."""
import json
import time
from datetime import datetime, timezone

from PIL import Image

from autopub import carousels, extract, followups, images, nostalgia, pipeline, sources
from autopub.cards import CardBrief
from autopub.rewrite import Captions, CuratedPost, Debate, Steal, OUTPUT_SCHEMA
from autopub.social.base import Publisher, PublishResult
from autopub.state import State
from tests.test_pipeline import FakeWP


# ---- hooks --------------------------------------------------------------------------------------

def test_the_caption_opens_with_its_hook_unless_it_already_does():
    assert pipeline._hooked("Discounts are training your customers.", "Body #tag") == "Discounts are training your customers.\n\nBody #tag"
    assert pipeline._hooked("Discounts are training your customers.", "discounts are training your customers. More.") == "discounts are training your customers. More."
    assert pipeline._hooked(None, "Body") == "Body" and pipeline._hooked("Short", "Body") == "Body"


def test_the_schema_asks_for_hooks_steal_and_debate_and_the_model_parses_them():
    props = OUTPUT_SCHEMA["properties"]
    assert {"hook", "caption_hook", "steal", "debate"} <= set(props)
    assert "steal" not in OUTPUT_SCHEMA["required"] and "hook" not in OUTPUT_SCHEMA["required"], "optional: never forced"
    base = dict(title="T", slug="t", excerpt="E", body_html="<p>x</p>", image_headline="H", image_kicker="K",
                captions=dict(twitter="", facebook="", instagram="", linkedin="", pinterest_title="", pinterest="", telegram="", threads=""))
    post = CuratedPost(**base, hook="Discounts train customers", caption_hook="Your sale is teaching people to wait.",
                       steal={"idea": "Anchor on the premium tier first", "how": "Show the dearest plan first. " * 3},
                       debate={"question": "Should brands take sides?", "options": ["Brave", "Reckless"]})
    assert post.steal.idea.startswith("Anchor") and post.debate.options == ["Brave", "Reckless"] and post.hot_take is None
    assert CuratedPost(**base).steal is None and CuratedPost(**base).debate is None


class HookRewriter:
    def __init__(self, **extra):
        self.extra = extra

    def rewrite(self, site, article, carousel=False):
        return CuratedPost(
            title=f"Curated: {article.title}", category="Campaigns", slug=article.title.lower(), excerpt="e" * 120,
            body_html="<p>x</p>", tags=["a"], image_headline="Kantar: price is no longer the first filter", image_kicker="Pricing",
            captions=Captions(twitter="tw", facebook="fb body", instagram="ig body #tag", linkedin="li", pinterest_title="pt",
                              pinterest="pi", telegram="tg", threads="th"), **self.extra)


class FeedRec(Publisher):
    platform = "instagram"; env_prefix = "X"; required_env = (); needs_public_url = True; image_shapes = ("portrait",)
    seen: list = []

    def _publish(self, post):
        FeedRec.seen.append(post)
        return PublishResult(self.platform, True, remote_id="ig1")


class StoryRec(Publisher):
    platform = "instagram_story"; env_prefix = "X"; required_env = (); needs_public_url = True; image_shapes = ("story",)
    seen: list = []

    def _publish(self, post):
        StoryRec.seen.append(post)
        return PublishResult(self.platform, True, remote_id="st1")


def _run(monkeypatch, settings, site, tmp_path, state, rewriter, publishers, n=1):
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [sources.Candidate(f"Story{i}", f"https://pub.com/{i}", "", now, "Pub") for i in range(n)])
    monkeypatch.setattr(extract, "extract", lambda url, timeout=30: extract.Article(url=url, title=url.rsplit("/", 1)[1], text="w " * 600, sitename="Pub", image=None))
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    settings.nostalgia_hour = None
    settings.min_relevance = 0
    wp = FakeWP()
    report = pipeline.run_site(site, settings, state, rewriter=rewriter, wp=wp, publishers=publishers, work_dir=tmp_path / "img", limit=n)
    return report, wp


def test_the_hook_is_set_large_on_the_card_and_opens_the_caption(monkeypatch, settings, site, tmp_path):
    settings.carousel_hours = settings.reel_hours = []
    settings.steal_hour = settings.debate_hour = None
    drawn = {}
    real = images.render_set

    def spy(headline, kicker, site_, out_dir, stem, **kw):
        drawn["headline"], drawn["standfirst"], drawn["card"] = headline, kw.get("standfirst"), kw.get("card")
        return real(headline, kicker, site_, out_dir, stem, **kw)

    monkeypatch.setattr(images, "render_set", spy)
    FeedRec.seen.clear()
    _run(monkeypatch, settings, site, tmp_path, State(tmp_path / "s.db"),
         HookRewriter(hook="Discounts are training your customers", caption_hook="Your sale is teaching people to wait."), [FeedRec({})])
    assert drawn["headline"] == "Discounts are training your customers", "the hook is the big type"
    assert drawn["standfirst"] == "Kantar: price is no longer the first filter", "the headline runs beneath it"
    assert drawn["card"].headline == "Discounts are training your customers"
    post = FeedRec.seen[0]
    assert post.captions["instagram"].startswith("Your sale is teaching people to wait.\n\n") and post.captions["facebook"].startswith("Your sale")
    assert post.captions["twitter"] == "tw", "only the platforms that truncate get the hook line"


def test_without_a_hook_the_card_reads_as_before(monkeypatch, settings, site, tmp_path):
    settings.carousel_hours = settings.reel_hours = []
    settings.steal_hour = settings.debate_hour = None
    drawn = {}
    real = images.render_set
    monkeypatch.setattr(images, "render_set", lambda h, k, s_, o, st, **kw: drawn.update(headline=h, standfirst=kw.get("standfirst")) or real(h, k, s_, o, st, **kw))
    FeedRec.seen.clear()
    _run(monkeypatch, settings, site, tmp_path, State(tmp_path / "s.db"), HookRewriter(), [FeedRec({})])
    assert drawn["headline"] == "Kantar: price is no longer the first filter" and drawn["standfirst"] == "e" * 120
    assert FeedRec.seen[0].captions["instagram"] == "ig body #tag"


# ---- the queue -----------------------------------------------------------------------------------

def test_follow_ups_queue_in_the_note_and_come_off_it_when_due(tmp_path):
    state = State(tmp_path / "s.db")
    followups.schedule(state, "CRAZY", "steal", 1000.0, {"idea": "i", "how": "h", "link": "https://x/", "title": "T"})
    followups.schedule(state, "CRAZY", "debate", 2000.0, {"question": "Q?", "options": ["A", "B"], "link": "https://x/"})
    items = followups.load(state, "CRAZY")
    assert [i["kind"] for i in items] == ["steal", "debate"]
    due, later = followups.split_due(items, 1500.0)
    assert [i["kind"] for i in due] == ["steal"] and [i["kind"] for i in later] == ["debate"]
    assert followups.load(state, "JUNKIES") == []
    state.set_note("CRAZY", followups.NOTE, "not json")
    assert followups.load(state, "CRAZY") == []


def test_due_follow_ups_post_to_the_right_platforms_and_are_recorded_by_kind(settings, site, tmp_path):
    state = State(tmp_path / "s.db")
    wp = FakeWP()
    FeedRec.seen.clear(); StoryRec.seen.clear()
    followups.schedule(state, site.key, "steal", time.time() - 10, {"idea": "Anchor on the premium tier first", "how": "Show the dearest plan first. " * 3, "link": "https://site/a/", "title": "Article A"})
    followups.schedule(state, site.key, "debate", time.time() - 10, {"question": "Should brands take sides?", "options": ["Brave", "Reckless"], "link": "https://site/b/", "title": "Article B"})
    followups.schedule(state, site.key, "hot_take", time.time() + 3600, {"take": "Not yet", "link": "https://site/c/", "title": "C"})
    report = pipeline.RunReport(site=site.key)
    posted = followups.run(site, settings, state, wp, [FeedRec({}), StoryRec({})], tmp_path / "img", report)
    assert posted == 2 and report.social_ok == 2
    steal = FeedRec.seen[0]
    assert steal.captions["instagram"].startswith("Steal this: Anchor on the premium tier first") and "Save this post" in steal.captions["instagram"]
    assert steal.image_urls["portrait"].endswith("-steal-ig.jpg") and steal.link == "https://site/a/"
    debate = StoryRec.seen[0]
    assert debate.story_urls and debate.story_urls[0].endswith("-debate.jpg") and debate.image_urls["story"] == debate.story_urls[0]
    rows = state.conn.execute("SELECT platform FROM social_posts ORDER BY id").fetchall()
    assert [r["platform"] for r in rows] == ["instagram:steal", "instagram_story:debate"]
    assert [i["kind"] for i in followups.load(state, site.key)] == ["hot_take"], "only the one not yet due stays queued"
    with Image.open(wp.media[0]) as im:
        assert im.size == images.CAROUSEL_SIZE, "the steal card is a 4:5 feed asset"
    with Image.open(wp.media[1]) as im:
        assert im.size == images.STORY_SIZE, "the debate is a 9:16 story frame"


def test_a_follow_up_that_fails_is_dropped_not_retried_forever(settings, site, tmp_path):
    class Boom(FakeWP):
        def upload_media(self, *a, **k):
            raise RuntimeError("wp down")
    state = State(tmp_path / "s.db")
    followups.schedule(state, site.key, "steal", time.time() - 1, {"idea": "Idea idea idea", "how": "How " * 20, "link": "https://x/", "title": "T"})
    report = pipeline.RunReport(site=site.key)
    assert followups.run(site, settings, state, Boom(), [FeedRec({})], tmp_path, report) == 0
    assert followups.load(state, site.key) == [] and report.social_failed == 1


# ---- the slots ------------------------------------------------------------------------------------

def test_the_first_article_with_a_tactic_after_the_hour_queues_the_steal_card_and_spends_the_slot(monkeypatch, settings, site, tmp_path):
    settings.carousel_hours = settings.reel_hours = []
    settings.steal_hour, settings.debate_hour = 0, 0
    state = State(tmp_path / "s.db")
    rw = HookRewriter(steal=Steal(idea="Anchor on the premium tier first", how="Show the dearest plan first, always. " * 2),
                      debate=Debate(question="Should brands take sides?", options=["Brave", "Reckless"]))
    _run(monkeypatch, settings, site, tmp_path, state, rw, [FeedRec({}), StoryRec({})], n=2)
    queued = followups.load(state, site.key)
    assert [i["kind"] for i in queued] == ["steal", "debate"], "one of each, from the first article only"
    assert queued[0]["link"] == "https://marketingmentalist.in/0/" and queued[0]["idea"] == "Anchor on the premium tier first"
    assert queued[0]["due"] > time.time() + settings.followup_delay_minutes * 60 - 120
    assert queued[1]["due"] < queued[0]["due"], "the debate story goes out sooner than the card"
    assert len(carousels.parse_log(state.note(site.key, followups.STEAL_NOTE))) == 1
    assert len(carousels.parse_log(state.note(site.key, followups.DEBATE_NOTE))) == 1


def test_an_article_without_the_material_leaves_the_slot_open(monkeypatch, settings, site, tmp_path):
    settings.carousel_hours = settings.reel_hours = []
    settings.steal_hour, settings.debate_hour = 0, 0
    state = State(tmp_path / "s.db")
    _run(monkeypatch, settings, site, tmp_path, state, HookRewriter(debate=Debate(question="No question mark", options=["A", "B"])), [FeedRec({}), StoryRec({})])
    assert followups.load(state, site.key) == []
    assert state.note(site.key, followups.STEAL_NOTE) is None and state.note(site.key, followups.DEBATE_NOTE) is None


def test_no_matching_publisher_means_nothing_is_queued(monkeypatch, settings, site, tmp_path):
    settings.carousel_hours = settings.reel_hours = []
    settings.steal_hour, settings.debate_hour = 0, 0
    state = State(tmp_path / "s.db")
    rw = HookRewriter(steal=Steal(idea="Anchor on the premium tier first", how="Show the dearest plan first, always. " * 2))
    _run(monkeypatch, settings, site, tmp_path, state, rw, [StoryRec({})])   # a story publisher cannot carry a feed card
    assert followups.load(state, site.key) == []


def test_the_throwback_queues_its_hot_take(monkeypatch, settings, site, tmp_path):
    from tests.test_nostalgia import FILM, FakeRewriter, Pick, _post, _quick_render
    from autopub import youtube
    settings.nostalgia_hour = 0
    settings.reel_hours = settings.carousel_hours = []
    settings.steal_hour = settings.debate_hour = None
    site.nostalgia = True
    _quick_render(monkeypatch)
    monkeypatch.setattr(youtube, "find_ad", lambda *a, **k: dict(FILM))
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [])
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    monkeypatch.setattr(pipeline.images, "_download_photo", lambda url, timeout: None)
    state = State(tmp_path / "s.db")
    FeedRec.seen.clear()
    rw = FakeRewriter([Pick(brand="Cadbury", campaign="Kuch Khaas Hai", year=1994, hook="h")],
                      _post(hot_take="This ad would not survive a brand-safety review today, and marketing is poorer for it."))
    pipeline.run_site(site, settings, state, rewriter=rw, wp=FakeWP(), publishers=[FeedRec({})], work_dir=tmp_path / "img")
    queued = followups.load(state, site.key)
    assert len(queued) == 1 and queued[0]["kind"] == "hot_take" and queued[0]["by"] == f"{site.name} on Cadbury"
    assert queued[0]["link"] == "https://marketingmentalist.in/cadbury-kuch-khaas-hai/"
    assert '"hot_take"' in rw.systems[-1], "the feature prompt asks for the take"


# ---- the pictures ---------------------------------------------------------------------------------

def test_the_steal_card_and_the_debate_frame_render_in_brand(site, tmp_path):
    card = images.render_card("Anchor on the premium tier first", "Steal this", site, tmp_path / "s.jpg", "portrait",
                              card=CardBrief("steal", "Anchor on the premium tier first", "Steal this", standfirst="Show the dearest plan first. " * 3))
    frame = images.story_debate_frame("Should brands take a side?", ["Brave", "Reckless"], site, tmp_path / "d.jpg")
    accent = images.hex_to_rgb(site.brand.accent)
    with Image.open(card) as im:
        assert im.size == (1440, 1920)
        colours = {c for _, c in im.convert("RGB").resize((90, 120)).getcolors(maxcolors=1 << 20)}
        assert any(sum(abs(a - b) for a, b in zip(c, accent)) < 90 for c in colours)
    with Image.open(frame) as im:
        assert im.size == images.STORY_SIZE
        primary = images.hex_to_rgb(site.brand.primary)
        for y in (30, im.height - 30):
            c = im.convert("RGB").getpixel((im.width // 2, y))
            assert sum(abs(a - b) for a, b in zip(c, primary)) < 90, "safe bands stay clear"


def test_the_inverse_card_carries_a_standfirst_under_the_hook(site, tmp_path):
    from autopub import cards
    with_sf = images.render_card("Discounts are training your customers", "Pricing", site, tmp_path / "a.jpg", "portrait",
                                 card=CardBrief(cards.INVERSE, "Discounts are training your customers", "Pricing", standfirst="Kantar: price is not the first filter"))
    without = images.render_card("Discounts are training your customers", "Pricing", site, tmp_path / "b.jpg", "portrait",
                                 card=CardBrief(cards.INVERSE, "Discounts are training your customers", "Pricing"))
    with Image.open(with_sf) as a, Image.open(without) as b:
        assert a.tobytes() != b.tobytes(), "the standfirst is drawn"


def test_stories_go_out_for_every_second_news_article_and_always_for_a_forced_one(monkeypatch, settings, site, tmp_path):
    settings.carousel_hours = settings.reel_hours = []
    settings.steal_hour = settings.debate_hour = None
    settings.story_every = 2
    state = State(tmp_path / "s.db")
    StoryRec.seen.clear(); FeedRec.seen.clear()
    report, wp = _run(monkeypatch, settings, site, tmp_path, state, HookRewriter(), [FeedRec({}), StoryRec({})], n=3)
    assert len(report.published) == 3
    assert len(StoryRec.seen) == 2, "articles one and three get a story; two does not"
    assert all(p.story_urls for p in StoryRec.seen)
    assert len(FeedRec.seen) == 3, "every article still gets its feed post"
    assert state.note(site.key, "story_counter") == "3"
    assert report.social_failed == 0, "a story publisher with no story is idle, not failed"


def test_a_reel_publisher_stands_aside_when_there_is_no_reel():
    from autopub.social import REGISTRY, idle
    from autopub.social.base import SocialPost
    reel = REGISTRY["instagram_reel"]({"USER_ID": "1", "ACCESS_TOKEN": "t"})
    story = REGISTRY["instagram_story"]({"USER_ID": "1", "ACCESS_TOKEN": "t"})
    feed = REGISTRY["instagram"]({"USER_ID": "1", "ACCESS_TOKEN": "t"})
    bare = SocialPost(title="T", link="https://x/", captions={}, image_urls={"portrait": "https://cdn/p.jpg"})
    assert idle(reel, bare) == "no reel this time" and idle(story, bare) == "no story this time" and idle(feed, bare) is None
    full = SocialPost(title="T", link="https://x/", captions={}, image_urls={"portrait": "p", "story": "s"}, video_url="v")
    assert idle(reel, full) is None and idle(story, full) is None
