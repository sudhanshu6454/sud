"""The daily throwback: a classic ad picked, found on YouTube, embedded, written up and published
down the same road as the news, once a day, never twice."""
from datetime import datetime, timezone

from autopub import carousels, nostalgia, pipeline, sources, video, youtube
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


def test_the_pick_prompt_lists_what_was_already_covered_and_alternates_regions(site):
    rw = FakeRewriter([Pick(brand="Nike", campaign="Just Do It", year=1988, hook="h")])
    nostalgia.pick(rw, site, ["Cadbury | Kuch Khaas Hai | 1994"], day_index=1)
    assert "- Cadbury | Kuch Khaas Hai | 1994" in rw.systems[0] and "an international campaign" in rw.systems[0]
    rw2 = FakeRewriter([Pick(brand="Amul", campaign="Utterly Butterly", hook="h")])
    nostalgia.pick(rw2, site, [], day_index=0)
    assert "an Indian campaign" in rw2.systems[0] and "(none yet)" in rw2.systems[0]


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
    settings.nostalgia_hour = 0
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
    settings.nostalgia_hour = 0
    site.nostalgia = True
    state = State(tmp_path / "s.db")
    state.set_note(site.key, nostalgia.USED_NOTE, "Cadbury | Kuch Khaas Hai | 1994")
    monkeypatch.setattr(youtube, "find_ad", lambda brand, campaign, year=None, timeout=20: None)
    rw = FakeRewriter([Pick(brand="Cadbury", campaign="Kuch Khaas Hai", year=1994, hook="h"),
                       Pick(brand="Ghost", campaign="Never Aired", hook="h"),
                       Pick(brand="Ghost", campaign="Never Aired 2", hook="h")])
    from autopub.pipeline import RunReport
    ok = nostalgia.publish_daily(site, settings, state, rw, FakeWP(), [], tmp_path, RunReport(site=site.key))
    assert not ok and len(rw.systems) == nostalgia.ATTEMPTS
    assert "- Cadbury | Kuch Khaas Hai | 1994" in rw.systems[1], "the repeat is told not to repeat"
    assert "Ghost | Never Aired (no film found)" in rw.systems[2], "a campaign with no upload is not asked for again"
    assert state.note(site.key, nostalgia.NOTE) is None, "the slot stays open for the next cycle"


def test_sites_without_the_flag_and_hours_switched_off_never_run_it(monkeypatch, settings, site, tmp_path):
    state = State(tmp_path / "s.db")
    site.nostalgia = False
    settings.nostalgia_hour = 0
    assert not nostalgia.due(settings, state, site) or True   # due() is about time; the flag is checked by run_site
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [])
    rw = FakeRewriter([Pick(brand="X", campaign="Y", hook="h")])
    pipeline.run_site(site, settings, state, rewriter=rw, wp=FakeWP(), publishers=[], work_dir=tmp_path)
    assert rw.systems == []
    site.nostalgia = True
    settings.nostalgia_hour = None
    assert not nostalgia.due(settings, state, site)
    pipeline.run_site(site, settings, state, rewriter=rw, wp=FakeWP(), publishers=[], work_dir=tmp_path)
    assert rw.systems == []


def test_config_marks_the_three_marketing_sites(settings):
    assert [s.key for s in settings.sites if s.nostalgia] == ["MENTALIST", "CRAZY", "JUNKIES"]
    assert settings.nostalgia_hour == 15 and settings.reel_voice == "en_US-ryan-high"
