"""The daily throwback: a classic ad picked, found on YouTube, embedded, written up and published
down the same road as the news, once a day, never twice."""
from datetime import datetime, timezone

from autopub import carousels, followups, nostalgia, pipeline, sources, video, youtube
from autopub.nostalgia import Pick
from autopub.rewrite import Captions, CuratedPost
from autopub.social.base import Publisher, PublishResult
from autopub.state import State
from tests.test_pipeline import FakeWP, Recorder

FILM = {"id": "aaa", "title": "Cadbury Dairy Milk Cricket Ad 1994", "channel": "Cadbury Dairy Milk India", "seconds": 43,
        "views": 9831, "url": "https://www.youtube.com/watch?v=aaa", "thumbnail": "https://i.ytimg.com/vi/aaa/maxresdefault.jpg"}


def _post(**kw):
    base = dict(title="Throwback: Cadbury's Kuch Khaas Hai", category="Throwback", slug="cadbury-kuch-khaas-hai", excerpt="e" * 120,
                body_html="<h2>The ad</h2><p>x</p>", tags=["cadbury"], image_headline="Cadbury: Kuch Khaas Hai (1994)", image_kicker="Throwback",
                captions=Captions(twitter="tw", facebook="fb", instagram="ig", linkedin="li", pinterest_title="pt", pinterest="pi", telegram="tg", threads="th"))
    base.update(kw)
    return CuratedPost(**base)


class FakeRewriter:
    """Answers `ask` from a queue of picks and one feature; records what it was asked."""
    def __init__(self, picks, post=None):
        self.picks, self.post, self.systems = list(picks), post or _post(), []

    def ask(self, system, user, schema, validate=None, max_tokens=16000):
        self.systems.append(system)
        if "Name ONE iconic advertising campaign" in system:
            return self.picks.pop(0)
        return self.post

    def rewrite(self, site, article, carousel=False):
        raise AssertionError("the throwback never goes through the news rewriter")


def test_used_list_and_keys_round_trip():
    p = Pick(brand="Cadbury", campaign="Kuch Khaas Hai", year=1994, hook="h")
    assert nostalgia.key_of(p) == "Cadbury | Kuch Khaas Hai | 1994"
    assert nostalgia.key_of(Pick(brand="Amul", campaign="Utterly Butterly", hook="h")) == "Amul | Utterly Butterly"
    used = nostalgia.parse_used(nostalgia.dump_used(["Cadbury | Kuch Khaas Hai | 1994", "Fevicol | Bus | 2000"]))
    assert used == ["Cadbury | Kuch Khaas Hai | 1994", "Fevicol | Bus | 2000"]
    assert nostalgia._same("cadbury | kuch khaas hai | 1994", "Cadbury | Kuch Khaas Hai Cricket | ") , "same brand and campaign, whatever the year"
    assert not nostalgia._same("Cadbury | Kuch Khaas Hai", "Cadbury | Shubh Aarambh")


def test_the_feature_embeds_the_official_film_and_files_under_throwback(site):
    rw = FakeRewriter([], _post(category="Marketing Psychology", image_kicker="Whatever", tags=["a"]))
    post = nostalgia.write(rw, site, Pick(brand="Cadbury", campaign="Kuch Khaas Hai", year=1994, hook="h"), FILM)
    assert post.category == "Throwback" and post.image_kicker == "Throwback" and "Throwback" in post.tags
    assert post.body_html.startswith("<!-- wp:embed") and "https://www.youtube.com/watch?v=aaa" in post.body_html
    assert 'class="wp-block-embed__wrapper"' in post.body_html, "WordPress renders the player from its own embed block"
    assert post.body_html.rstrip().endswith("on YouTube</a></em></p>")
    assert "Cadbury Dairy Milk India on YouTube" in post.body_html
    system = rw.systems[0]
    assert '"enum": ["Throwback"]' in system and "never mention that you are an ai" in system.lower()


def test_the_pick_sees_every_sites_list_so_two_sites_never_choose_the_same_classic(tmp_path, site):
    state = State(tmp_path / "s.db")
    state.set_note("MENTALIST", nostalgia.USED_NOTE, "Airtel | Har Ek Friend Zaroori Hota Hai | 2011")
    state.set_note("CRAZY", nostalgia.USED_NOTE, "Ariel India | Share The Load | 2015\nairtel | Har Ek Friend Zaroori Hota Hai |")
    assert nostalgia.fleet_used(state) == ["Airtel | Har Ek Friend Zaroori Hota Hai | 2011", "Ariel India | Share The Load | 2015"]
    assert state.notes("nothing") == {}


def test_a_hashtag_campaign_name_is_searched_without_the_hash(monkeypatch):
    from autopub import youtube
    asked = []
    monkeypatch.setattr(youtube, "search", lambda q, timeout=20: asked.append(q) or [])
    youtube.find_ad("Ariel India", "#ShareTheLoad", 2015)
    assert asked[0] == "Ariel India ShareTheLoad 2015 ad"


def test_the_pick_prompt_lists_what_was_already_covered_and_alternates_regions(site):
    rw = FakeRewriter([Pick(brand="Nike", campaign="Just Do It", year=1988, hook="h")])
    nostalgia.pick(rw, site, ["Cadbury | Kuch Khaas Hai | 1994"], day_index=1)
    assert "- Cadbury | Kuch Khaas Hai | 1994" in rw.systems[0] and "an INTERNATIONAL campaign" in rw.systems[0]
    rw2 = FakeRewriter([Pick(brand="Amul", campaign="Utterly Butterly", hook="h")])
    nostalgia.pick(rw2, site, [], day_index=0)
    assert "an INDIAN campaign" in rw2.systems[0] and "(none yet)" in rw2.systems[0]


class VideoRecorder(Publisher):
    platform = "vrec"; env_prefix = "REC"; required_env = (); needs_public_url = True; wants_video = True
    seen: list = []

    def _publish(self, post):
        VideoRecorder.seen.append(post)
        return PublishResult(self.platform, True, remote_id="v", format="reel" if post.video_url else None)


def _quick_render(monkeypatch):
    real = video.render_reel
    monkeypatch.setattr(video, "render_reel", lambda frames, out, durations, accent, **kw: real(frames, out, [0.3] * len(frames), accent, fps=6, dissolve=0.1))
    monkeypatch.setattr(pipeline, "narrator_for", lambda settings: None)


def test_the_daily_throwback_is_published_with_the_film_a_reel_and_a_spent_slot(monkeypatch, settings, site, tmp_path):
    settings.ad_hours = [0]
    settings.reel_hours = []
    settings.carousel_hours = []
    site.nostalgia = True
    _quick_render(monkeypatch)
    monkeypatch.setattr(youtube, "find_ad", lambda brand, campaign, year=None, timeout=20: dict(FILM))
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [])       # a quiet news hour: the throwback still runs
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    monkeypatch.setattr(pipeline.images, "_download_photo", lambda url, timeout: None)   # the thumbnail is not fetched in tests
    state = State(tmp_path / "s.db")
    wp = FakeWP()
    Recorder.seen.clear(); VideoRecorder.seen.clear()
    rw = FakeRewriter([Pick(brand="Cadbury", campaign="Kuch Khaas Hai", year=1994, hook="h")])
    monkeypatch.setattr(nostalgia, "kind_for_slot", lambda settings, now=None: "nostalgic")
    report = pipeline.run_site(site, settings, state, rewriter=rw, wp=wp, publishers=[Recorder({}), VideoRecorder({})], work_dir=tmp_path / "img")
    assert report.published == ["https://marketingmentalist.in/cadbury-kuch-khaas-hai/"]
    created = wp.posts[0]
    assert created["content"].startswith("<!-- wp:embed") and ("categories", "Throwback") in wp.terms
    assert state.is_used("https://www.youtube.com/watch?v=aaa", site.key), "the film's URL is the claim, so no site repeats it"
    social = Recorder.seen[0]
    assert social.alt_text.startswith("Throwback:")
    assert VideoRecorder.seen[0].video_url, "the throwback always gets its reel, slot or no slot"
    assert nostalgia.parse_used(state.note(site.key, nostalgia.USED_NOTE)) == ["Cadbury | Kuch Khaas Hai | 1994"]
    assert len(carousels.parse_log(state.note(site.key, nostalgia.NOTE))) == 1
    # the same day, another cycle: nothing more
    rw2 = FakeRewriter([Pick(brand="Nike", campaign="Just Do It", hook="h")])
    report2 = pipeline.run_site(site, settings, state, rewriter=rw2, wp=wp, publishers=[Recorder({})], work_dir=tmp_path / "img")
    assert report2.published == [] and rw2.systems == [], "the slot is spent; the model is not even asked"


def test_a_pick_without_a_film_or_already_covered_is_asked_again_then_given_up(monkeypatch, settings, site, tmp_path):
    settings.ad_hours = [0]
    site.nostalgia = True
    state = State(tmp_path / "s.db")
    state.set_note(site.key, nostalgia.USED_NOTE, "Cadbury | Kuch Khaas Hai | 1994")
    monkeypatch.setattr(youtube, "find_ad", lambda brand, campaign, year=None, timeout=20: None)
    rw = FakeRewriter([Pick(brand="Cadbury", campaign="Kuch Khaas Hai", year=1994, hook="h"),
                       Pick(brand="Ghost", campaign="Never Aired", hook="h"),
                       Pick(brand="Ghost", campaign="Never Aired 2", hook="h")])
    from autopub.pipeline import RunReport
    ok = nostalgia.publish_daily(site, settings, state, rw, FakeWP(), [], tmp_path, RunReport(site=site.key), kind="nostalgic")
    assert not ok and len(rw.systems) == nostalgia.ATTEMPTS
    assert "- Cadbury | Kuch Khaas Hai | 1994" in rw.systems[1], "the repeat is told not to repeat"
    assert "Ghost | Never Aired (no film found)" in rw.systems[2], "a campaign with no upload is not asked for again"
    assert state.note(site.key, nostalgia.NOTE) is None, "the slot stays open for the next cycle"


def test_sites_without_the_flag_and_hours_switched_off_never_run_it(monkeypatch, settings, site, tmp_path):
    state = State(tmp_path / "s.db")
    site.nostalgia = False
    settings.ad_hours = [0]
    assert nostalgia.due(settings, state, site), "due() is about time; the flag is checked by run_site"
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [])
    rw = FakeRewriter([Pick(brand="X", campaign="Y", hook="h")])
    pipeline.run_site(site, settings, state, rewriter=rw, wp=FakeWP(), publishers=[], work_dir=tmp_path)
    assert rw.systems == []
    site.nostalgia = True
    settings.ad_hours = []
    assert not nostalgia.due(settings, state, site)
    pipeline.run_site(site, settings, state, rewriter=rw, wp=FakeWP(), publishers=[], work_dir=tmp_path)
    assert rw.systems == []


def test_config_marks_the_three_marketing_sites(settings):
    assert [s.key for s in settings.sites if s.nostalgia] == ["MENTALIST", "CRAZY", "JUNKIES"]
    assert settings.ad_hours == [9, 12, 15, 18, 21] and settings.reel_voice == "af_heart"


def test_the_days_slots_alternate_current_and_nostalgic_current_first(settings):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    settings.ad_hours = [9, 12, 15, 18, 21]
    at = lambda h: datetime(2026, 9, 25, h, 10, tzinfo=ZoneInfo("Asia/Kolkata")).timestamp()
    assert [nostalgia.kind_for_slot(settings, at(h)) for h in (9, 12, 15, 18, 21)] == ["current", "nostalgic", "current", "nostalgic", "current"]
    assert nostalgia.kind_for_slot(settings, at(23)) == "current", "still the 21:00 slot"
    assert nostalgia.category_for(settings.site("CRAZY"), "current") == "Viral Campaigns"
    assert nostalgia.category_for(settings.site("MENTALIST"), "current") == "Viral Ads"
    assert nostalgia.category_for(settings.site("MENTALIST"), "nostalgic") == "Throwback"


def test_each_site_writes_in_its_own_format(site, settings):
    rw = FakeRewriter([], _post(category="Viral Ads", image_kicker="x"))
    post = nostalgia.write(rw, settings.site("MENTALIST"), Pick(brand="Zomato", campaign="Kuch Bhi", hook="h"), FILM, kind="current",
                           source=None)
    assert "The psychology of the ad" in rw.systems[0] and "behavioural science" in rw.systems[0] and "VIRAL NOW" in rw.systems[0]
    assert post.category == "Viral Ads" and post.image_kicker == "Viral now" and "Viral ads" in post.tags and post.mood == "upbeat"
    rw2 = FakeRewriter([], _post(category="Viral Campaigns", image_kicker="x"))
    nostalgia.write(rw2, settings.site("CRAZY"), Pick(brand="Z", campaign="K", hook="h"), FILM, kind="current")
    assert "Campaign breakdown" in rw2.systems[0] and "steal this" in rw2.systems[0]
    rw3 = FakeRewriter([], _post())
    nostalgia.write(rw3, settings.site("JUNKIES"), Pick(brand="Z", campaign="K", year=2001, hook="h"), FILM, kind="nostalgic")
    assert "Ad watch" in rw3.systems[0] and "THROWBACK" in rw3.systems[0] and '"enum": ["Throwback"]' in rw3.systems[0]


def test_a_current_ad_comes_from_this_weeks_stories_and_claims_its_source(monkeypatch, settings, site, tmp_path):
    from datetime import datetime, timezone
    from autopub import extract as ex, sources as src, youtube
    settings.ad_hours = [0]
    settings.reel_hours = settings.carousel_hours = []
    settings.steal_hour = settings.debate_hour = None
    settings.scorecard_hours = []
    site.nostalgia = True
    _quick_render(monkeypatch)
    now = datetime.now(timezone.utc)
    week = [src.Candidate("Zomato's new ad film has 40M views in three days", "https://adpress.com/zomato", "", now, "Ad Press"),
            src.Candidate("Agency of the year shortlist announced", "https://adpress.com/awards", "", now, "Ad Press")]
    monkeypatch.setattr(src, "collect", lambda s, timeout=30: week if s.google_news_queries == nostalgia.VIRAL_QUERIES else [])
    monkeypatch.setattr(ex, "extract", lambda url, timeout=30: ex.Article(url=url, title="Zomato ad", text="w " * 300, sitename="Ad Press"))
    monkeypatch.setattr(youtube, "find_ad", lambda *a, **k: dict(FILM))
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    monkeypatch.setattr(pipeline.images, "_download_photo", lambda url, timeout: None)
    state = State(tmp_path / "s.db")
    wp = FakeWP()

    class CurrentRewriter(FakeRewriter):
        def ask(self, system, user, schema, validate=None, max_tokens=16000):
            self.systems.append(system)
            if "Choose the ONE that is about a specific new ad" in system:
                assert "1. Zomato's new ad film" in user and "2. Agency of the year" in user
                return Pick(index=1, brand="Zomato", campaign="Kuch Bhi", hook="40M views")
            assert "SOURCE_TEXT:" in user, "the current feature is grounded in the article"
            return _post(title="Zomato's Kuch Bhi", slug="zomato-kuch-bhi", category="Viral Ads", image_kicker="x")

    rw = CurrentRewriter([])
    report = pipeline.run_site(site, settings, state, rewriter=rw, wp=wp, publishers=[Recorder({})], work_dir=tmp_path / "img")
    assert report.published == ["https://marketingmentalist.in/zomato-kuch-bhi/"]
    assert state.is_used("https://adpress.com/zomato", site.key), "the source story is claimed so the news does not repeat it"
    assert state.is_used(FILM["url"], site.key)
    assert ("categories", "Viral Ads") in wp.terms
    assert 'Source: <a href="https://adpress.com/zomato"' in wp.posts[0]["content"]
    assert nostalgia.parse_used(state.note(site.key, nostalgia.USED_NOTE)) == ["Zomato | Kuch Bhi | " + str(datetime.now().year)]
    assert followups.load(state, site.key) == [], "no hot take after a current ad"
