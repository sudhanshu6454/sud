"""Carousels: two a day per site, the article told in slides, posted as one swipe on Instagram and
as a multi-photo post on the Facebook Page, and never at the cost of the single card."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from PIL import Image

from autopub import cards, carousels, extract, images, pipeline, sources
from autopub.carousels import CarouselSlide
from autopub.extract import Article
from autopub.rewrite import Captions, CuratedPost, schema_for
from autopub.social import REGISTRY
from autopub.social import facebook as fb
from autopub.social import instagram as ig
from autopub.social.base import Publisher, PublishResult
from autopub.state import State
from tests.test_pipeline import FakeWP
from tests.test_social import _graph, _post

IST = ZoneInfo("Asia/Kolkata")


def _at(hour: int, day: int = 15, minute: int = 0) -> float:
    return datetime(2026, 9, day, hour, minute, tzinfo=IST).timestamp()


SLIDES = [CarouselSlide(heading=f"Slide {i}", body="A specific, factual body of two sentences about the story. " * 2)
          for i in range(1, 7)]


# ---- when -------------------------------------------------------------------------------------

def test_the_slot_is_the_most_recent_listed_hour_and_rolls_back_over_midnight():
    hours = [9, 18]
    assert carousels.slot(_at(9), hours, "Asia/Kolkata") == ("2026-09-15", 9)
    assert carousels.slot(_at(13, minute=40), hours, "Asia/Kolkata") == ("2026-09-15", 9)
    assert carousels.slot(_at(18), hours, "Asia/Kolkata") == ("2026-09-15", 18)
    assert carousels.slot(_at(23, minute=59), hours, "Asia/Kolkata") == ("2026-09-15", 18)
    assert carousels.slot(_at(2, day=16), hours, "Asia/Kolkata") == ("2026-09-15", 18), "before 09:00 is still last night's slot"
    assert carousels.slot(_at(2), [], "Asia/Kolkata") is None, "no hours, no carousels"


def test_the_first_article_in_a_slot_is_due_and_the_second_is_not():
    hours = [9, 18]
    assert carousels.due(_at(9, minute=5), [], hours, "Asia/Kolkata")
    log = [_at(9, minute=5)]
    assert not carousels.due(_at(10), log, hours, "Asia/Kolkata"), "the 09:00 slot already has its carousel"
    assert not carousels.due(_at(17, minute=59), log, hours, "Asia/Kolkata")
    assert carousels.due(_at(18, minute=3), log, hours, "Asia/Kolkata"), "the evening slot is a fresh one"
    log.append(_at(18, minute=3))
    assert not carousels.due(_at(3, day=16), log, hours, "Asia/Kolkata"), "3am belongs to the evening slot already spent"
    assert carousels.due(_at(9, day=16), log, hours, "Asia/Kolkata"), "next morning, due again"


def test_the_log_round_trips_through_the_note_and_drops_junk():
    raw = carousels.dump_log([_at(9), _at(18)])
    assert carousels.parse_log(raw) == [float(int(_at(9))), float(int(_at(18)))]
    assert carousels.parse_log("bogus,,12.5") == [12.5]
    assert carousels.parse_log(None) == []
    assert len(carousels.parse_log(carousels.dump_log([float(i) for i in range(40)]))) == carousels.KEEP


# ---- what --------------------------------------------------------------------------------------

def test_only_real_slides_count_and_the_ceiling_is_instagrams():
    assert carousels.usable([]) == []
    thin = [CarouselSlide(heading="H", body="too short"), CarouselSlide(heading="Real heading", body="x" * 60)]
    assert carousels.usable(thin) == [("Real heading", "x" * 60)]
    dupes = [CarouselSlide(heading="Same", body="y" * 60), CarouselSlide(heading="same", body="z" * 60)]
    assert len(carousels.usable(dupes)) == 1, "a repeated heading is one slide"
    many = [CarouselSlide(heading=f"Heading {i}", body="b" * 60) for i in range(12)]
    assert len(carousels.usable(many)) == carousels.MAX_SLIDES
    assert not carousels.has_material(SLIDES[:3]) and carousels.has_material(SLIDES[:4])
    assert carousels.has_material(carousels.SAMPLE_SLIDES)


def test_the_rewriter_asks_for_slides_only_when_a_carousel_is_due(site):
    plain = schema_for(site)
    assert "carousel_slides" not in plain["properties"] and "carousel_slides" not in plain["required"]
    full = schema_for(site, carousel=True)
    assert "carousel_slides" in full["properties"] and "carousel_slides" in full["required"]
    base = dict(title="T", slug="t", excerpt="E", body_html="<p>x</p>", image_headline="H", image_kicker="K",
                captions=dict(twitter="", facebook="", instagram="", linkedin="", pinterest_title="", pinterest="",
                              telegram="", threads=""))
    assert CuratedPost(**base).carousel_slides == []
    post = CuratedPost(**base, carousel_slides=[{"heading": "Background", "body": "b" * 60}])
    assert post.carousel_slides[0].heading == "Background"


def test_the_system_prompt_carries_the_carousel_brief_only_on_carousel_rewrites(site):
    import json
    from tests.test_rewrite import ARTICLE, GOOD, FakeClient, _resp
    from autopub.rewrite import Rewriter
    client = FakeClient(_resp(json.dumps({**GOOD, "carousel_slides": [s.model_dump() for s in SLIDES]})))
    post = Rewriter(model="m", client=client, use_fallbacks=False).rewrite(site, ARTICLE, carousel=True)
    assert len(post.carousel_slides) == 6
    system = client.calls[0][1]["system"][0]["text"]
    assert "carousel_slides" in system and "swipe-through" in system
    client2 = FakeClient(_resp(json.dumps(GOOD)))
    Rewriter(model="m", client=client2, use_fallbacks=False).rewrite(site, ARTICLE)
    assert "swipe-through" not in client2.calls[0][1]["system"][0]["text"]


# ---- the slides ----------------------------------------------------------------------------------

def test_slides_are_4_5_and_line_up_with_the_cover_card(site, tmp_path):
    brief = cards.brief(cards.HEADLINE, None, "A headline for the carousel", "Branding", None)
    cover = images.instagram_asset(images.render_card("A headline for the carousel", "Branding", site,
                                                      tmp_path / "c.jpg", "portrait", card=brief), "4:5", tmp_path / "cover.jpg")
    slide = images.carousel_text_slide("Why it matters for brand teams", "Shelf and screen have merged. " * 5, 2, 6, site,
                                       tmp_path / "s2.jpg", kicker="Marketing Psychology")
    end = images.carousel_closing_slide("A headline for the carousel", site, tmp_path / "end.jpg")
    accent = images.hex_to_rgb(site.brand.accent)
    with Image.open(cover) as c, Image.open(slide) as s, Image.open(end) as e:
        assert c.size == s.size == e.size == images.CAROUSEL_SIZE == (1440, 1800)
        # the section rail is at the same height on cover and slides: what makes a swipe read as one post
        rail_y = int(round(images.TYPE_TOP * images.CARD_SCALE)) - int(images.PORTRAIT_BLEED * images.CARD_SCALE) + 4
        for im, name in ((c, "cover"), (s, "slide"), (e, "closing")):
            px = im.convert("RGB").getpixel((im.width // 2, rail_y))
            assert sum(abs(a - b) for a, b in zip(px, accent)) < 90, f"{name} has no rail at y={rail_y}"


def test_the_kicker_is_cut_at_a_word_never_inside_one():
    assert images._short_kicker("Marketing Psychology") == "MARKETING"
    assert images._short_kicker("Digital Marketing") == "DIGITAL"
    assert images._short_kicker("Branding") == "BRANDING"
    assert images._short_kicker("Supercalifragilistic") == "THE STORY"
    assert images._short_kicker(None) == "THE STORY"


def test_a_long_body_is_trimmed_with_an_ellipsis_rather_than_running_into_the_footer(site, tmp_path):
    long_body = "This sentence is long enough to need wrapping across the whole column of the slide. " * 8
    path = images.carousel_text_slide("Heading", long_body, 1, 4, site, tmp_path / "long.jpg", kicker="News")
    with Image.open(path) as im:
        primary = images.hex_to_rgb(site.brand.primary)
        # the band just above the footer stays ground: nothing spilled into it
        band = im.convert("RGB").crop((100, 1500, 700, 1560))
        near = sum(1 for px in band.getdata() if sum(abs(a - b) for a, b in zip(px, primary)) < 60)
        assert near > band.width * band.height * 0.9


# ---- Instagram ---------------------------------------------------------------------------------

def _ig_routes(created: list, media_calls: list):
    def media(method, url, kwargs):
        data = kwargs.get("data", {})
        media_calls.append(dict(data))
        created.append(f"c{len(created) + 1}")
        return 200, {"id": created[-1]}
    return {
        "/content_publishing_limit": (200, {"data": [{"config": {"quota_total": 100}, "quota_usage": 3}]}),
        "/media_publish": (200, {"id": "media-77"}),
        "/media-77": (200, {"permalink": "https://instagram.com/p/car/"}),
        "/media": media,
    }


def test_instagram_builds_children_then_one_carousel_parent_that_carries_the_caption(monkeypatch):
    created, media_calls = [], []
    routes = _ig_routes(created, media_calls)
    routes.update({f"/c{i}": (200, {"status_code": "FINISHED"}) for i in range(1, 12)})
    call, Resp = _graph(routes)
    monkeypatch.setattr(ig.requests, "request", call)
    monkeypatch.setattr(ig.requests, "get", lambda *a, **k: Resp(200, {}))
    monkeypatch.setattr(ig.time, "sleep", lambda s: None)
    pub = REGISTRY["instagram"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    urls = ["https://cdn/cover.jpg", "https://cdn/s1.jpg", "https://cdn/s2.jpg", "https://cdn/end.jpg"]
    res = pub.publish(_post(captions={"instagram": "Hook line #tag"}, image_urls={"portrait": urls[0]},
                            carousel_urls=urls, mentions=["kantar"]))
    assert res.ok and res.format == "carousel" and res.remote_id == "media-77" and res.url == "https://instagram.com/p/car/"
    children, parents = media_calls[:4], media_calls[4:]
    assert [c["image_url"] for c in children] == urls, "one child per slide, in order"
    assert all(c["is_carousel_item"] == "true" and "caption" not in c for c in children)
    assert "user_tags" in children[0] and all("user_tags" not in c for c in children[1:]), "photo tags on the cover only"
    assert len(parents) == 1 and parents[0]["media_type"] == "CAROUSEL" and parents[0]["children"] == "c1,c2,c3,c4"
    assert "Hook line #tag" in parents[0]["caption"] and ig.SWIPE in parents[0]["caption"] and ig.CTA in parents[0]["caption"]
    assert "@kantar" in parents[0]["caption"]


def test_a_refused_carousel_falls_back_to_the_single_card_without_the_swipe_line(monkeypatch):
    media_calls = []

    def media(method, url, kwargs):
        data = kwargs.get("data", {})
        media_calls.append(dict(data))
        if data.get("media_type") == "CAROUSEL":
            return 200, {"error": {"code": 100, "error_subcode": 2207052, "message": "children mismatch"}}
        return 200, {"id": f"c{len(media_calls)}"}

    routes = {
        "/content_publishing_limit": (200, {"data": [{"config": {"quota_total": 100}, "quota_usage": 3}]}),
        "/media_publish": (200, {"id": "single-1"}),
        "/single-1": (200, {"permalink": "https://instagram.com/p/single/"}),
        "/media": media,
    }
    routes.update({f"/c{i}": (200, {"status_code": "FINISHED"}) for i in range(1, 12)})
    call, Resp = _graph(routes)
    monkeypatch.setattr(ig.requests, "request", call)
    monkeypatch.setattr(ig.requests, "get", lambda *a, **k: Resp(200, {}))
    monkeypatch.setattr(ig.time, "sleep", lambda s: None)
    pub = REGISTRY["instagram"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(captions={"instagram": "Hook"}, image_urls={"portrait": "https://cdn/cover.jpg"},
                            carousel_urls=["https://cdn/cover.jpg", "https://cdn/s1.jpg", "https://cdn/end.jpg"]))
    assert res.ok and res.format is None and res.remote_id == "single-1"
    single = media_calls[-1]
    assert single["image_url"] == "https://cdn/cover.jpg" and "is_carousel_item" not in single
    assert ig.CTA in single["caption"] and ig.SWIPE not in single["caption"]


def test_the_swipe_line_only_appears_on_a_carousel_caption():
    pub = REGISTRY["instagram"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    assert ig.SWIPE not in pub.caption(_post(captions={"instagram": "x"}))
    assert ig.SWIPE in pub.caption(_post(captions={"instagram": "x"}, carousel_urls=["a", "b"]))
    assert ig.SWIPE not in pub.caption(_post(captions={"instagram": "x"}, carousel_urls=["a"])), "one image is not a carousel"


# ---- Facebook ----------------------------------------------------------------------------------

def test_facebook_uploads_slides_unpublished_then_attaches_them_to_one_post(monkeypatch):
    calls = []

    def post(url, data=None, timeout=None, files=None):
        calls.append((url.rsplit("/", 1)[-1], dict(data or {})))
        class R:
            status_code = 200
            def json(self_inner):
                if url.endswith("/photos"):
                    return {"id": f"photo-{len(calls)}"}
                return {"id": "42_900"}
        return R()

    monkeypatch.setattr(fb.requests, "post", post)
    pub = REGISTRY["facebook"]({"PAGE_ID": "42", "PAGE_TOKEN": "p"})
    res = pub.publish(_post(carousel_urls=["https://cdn/cover.jpg", "https://cdn/s1.jpg", "https://cdn/end.jpg"],
                            image_urls={"landscape": "https://cdn/l.jpg"}))
    assert res.ok and res.format == "carousel" and res.remote_id == "42_900"
    photos, feed = calls[:3], calls[3]
    assert all(name == "photos" and d["published"] == "false" for name, d in photos)
    assert feed[0] == "feed" and "https://marketingjunkies.in/x/" in feed[1]["message"]
    assert [feed[1][f"attached_media[{i}]"] for i in range(3)] == ['{"media_fbid": "photo-1"}', '{"media_fbid": "photo-2"}', '{"media_fbid": "photo-3"}']


def test_facebook_falls_back_to_the_single_photo_when_a_slide_is_refused(monkeypatch):
    calls = []

    def post(url, data=None, timeout=None, files=None):
        calls.append((url.rsplit("/", 1)[-1], dict(data or {})))
        class R:
            status_code = 200
            def json(self_inner):
                if data.get("published") == "false":
                    return {"error": {"message": "bad slide"}}
                return {"id": "42_1", "post_id": "42_1"}
        return R()

    monkeypatch.setattr(fb.requests, "post", post)
    pub = REGISTRY["facebook"]({"PAGE_ID": "42", "PAGE_TOKEN": "p"})
    res = pub.publish(_post(carousel_urls=["https://cdn/cover.jpg", "https://cdn/s1.jpg"], image_urls={"landscape": "https://cdn/l.jpg"}))
    assert res.ok and res.format is None and res.remote_id == "42_1"
    assert calls[-1][0] == "photos" and calls[-1][1]["url"] == "https://cdn/l.jpg" and "published" not in calls[-1][1]


# ---- the pipeline ------------------------------------------------------------------------------

class SlideRewriter:
    """Answers with slides only when asked for them, as the real one does."""
    asked: list[bool] = []

    def rewrite(self, site, article, carousel=False):
        SlideRewriter.asked.append(carousel)
        return CuratedPost(
            title=f"Curated: {article.title}", category="Campaigns", slug=article.title.lower(), excerpt="e" * 120,
            body_html="<p>x</p>", tags=["a"], image_headline="Curated story", image_kicker="News",
            captions=Captions(twitter="tw", facebook="fb", instagram="ig", linkedin="li", pinterest_title="pt",
                              pinterest="pi", telegram="tg", threads="th"),
            carousel_slides=SLIDES if carousel else [],
        )


class CarouselRecorder(Publisher):
    platform = "carousel_rec"; env_prefix = "REC"; required_env = ()
    needs_public_url = True; supports_carousel = True; image_shapes = ("portrait",)
    seen: list = []

    def _publish(self, post):
        CarouselRecorder.seen.append(post)
        return PublishResult(self.platform, True, remote_id="r1", format="carousel" if len(post.carousel_urls) >= 2 else None)


def _run(monkeypatch, settings, site, tmp_path, state, publishers, n=1):
    now = datetime.now(timezone.utc)
    cands = [sources.Candidate(f"Story{i}", f"https://pub.com/{i}", "", now, "Pub") for i in range(n)]
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: cands)
    monkeypatch.setattr(extract, "extract", lambda url, timeout=30: Article(url=url, title=url.rsplit("/", 1)[1], text="w " * 600, sitename="Pub", image=None))
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    wp = FakeWP()
    report = pipeline.run_site(site, settings, state, rewriter=SlideRewriter(), wp=wp, publishers=publishers,
                               work_dir=tmp_path / "img", limit=n)
    return report, wp


def test_the_due_article_goes_out_as_a_carousel_and_spends_the_slot(monkeypatch, settings, site, tmp_path):
    settings.carousel_hours = [0]          # a slot that is always open today, whatever the clock says
    state = State(tmp_path / "s.db")
    SlideRewriter.asked.clear(); CarouselRecorder.seen.clear()
    report, wp = _run(monkeypatch, settings, site, tmp_path, state, [CarouselRecorder({})], n=2)
    assert len(report.published) == 2 and SlideRewriter.asked == [True, False], "slides asked for once the slot is open, not again once spent"
    first, second = CarouselRecorder.seen
    # cover first, then six content slides, then the closing slide: 8 hosted URLs, all 4:5
    assert len(first.carousel_urls) == 8 and first.carousel_urls[0] == first.image_urls["portrait"]
    assert first.carousel_urls[1].endswith("-slide-1.jpg") and first.carousel_urls[-1].endswith("-slide-end.jpg")
    for path in [p for p in wp.media if "slide" in p.name]:
        with Image.open(path) as im:
            assert im.size == images.CAROUSEL_SIZE
    assert second.carousel_urls == [], "the second article of the slot is an ordinary card"
    assert len(carousels.parse_log(state.note(site.key, carousels.NOTE))) == 1


def test_a_carousel_that_fails_to_post_leaves_the_slot_open(monkeypatch, settings, site, tmp_path):
    class Refuses(CarouselRecorder):
        platform = "refuses"
        def _publish(self, post):
            return PublishResult(self.platform, True, remote_id="single")     # posted, but as a single card

    settings.carousel_hours = [0]
    state = State(tmp_path / "s.db")
    SlideRewriter.asked.clear()
    _run(monkeypatch, settings, site, tmp_path, state, [Refuses({})], n=2)
    assert SlideRewriter.asked == [True, True], "no carousel went up, so the next article is asked for slides again"
    assert state.note(site.key, carousels.NOTE) is None


def test_no_carousel_capable_publisher_means_no_slides_are_ever_requested(monkeypatch, settings, site, tmp_path):
    from tests.test_pipeline import Recorder
    settings.carousel_hours = [0]
    SlideRewriter.asked.clear(); Recorder.seen.clear()
    _run(monkeypatch, settings, site, tmp_path, State(tmp_path / "s.db"), [Recorder({})])
    assert SlideRewriter.asked == [False]
    assert Recorder.seen[0].carousel_urls == []


def test_carousels_off_when_no_hours_are_configured(monkeypatch, settings, site, tmp_path):
    settings.carousel_hours = []
    SlideRewriter.asked.clear(); CarouselRecorder.seen.clear()
    _run(monkeypatch, settings, site, tmp_path, State(tmp_path / "s.db"), [CarouselRecorder({})])
    assert SlideRewriter.asked == [False] and CarouselRecorder.seen[0].carousel_urls == []


def test_settings_normalise_the_hours(settings):
    from autopub import config
    assert settings.carousel_hours == [9, 18] and settings.timezone == "Asia/Kolkata"
    assert config.Settings(sites=settings.sites).carousel_hours == [9, 18]
