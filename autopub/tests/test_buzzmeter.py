"""Buzz Meter: scores computed from data, subjects tracked across days, one digest a day on ScreenStat."""
from datetime import date, timedelta

from autopub import buzzmeter, carousels, pipeline, sources, tmdb, wiki, youtube
from autopub.buzzmeter import Reading
from autopub.rewrite import Captions, CuratedPost
from autopub.state import State
from tests.test_images import _fake_photo_fetch
from tests.test_pipeline import FakeWP, Recorder


def test_popularity_and_view_and_pageview_scores_are_clamped_and_deterministic():
    assert buzzmeter.popularity_score(0) == 0 and buzzmeter.popularity_score(250) == 50 and buzzmeter.popularity_score(1000) == 100
    assert buzzmeter.view_score(None, None) is None, "no trailer, no signal"
    assert buzzmeter.view_score(2_000_000, None) == 20, "a first reading is scaled on its raw size"
    assert buzzmeter.view_score(120_000, 100_000) == 50 + 0.2 * 200, "20% overnight growth"
    assert buzzmeter.view_score(80_000, 100_000) == 50 + (-0.2) * 200, "a drop lowers the score, never below 0"
    assert buzzmeter.pageview_score(None, None) is None
    assert buzzmeter.pageview_score(100_000, None) == 50
    assert buzzmeter.mention_score(0) == 0 and buzzmeter.mention_score(5) == 50 and buzzmeter.mention_score(20) == 100


def test_composite_reweights_over_whatever_signals_are_present():
    full = buzzmeter.composite({"popularity": 80, "views": 60, "mentions": 40, "pageviews": 20})
    assert full == round(80 * 0.35 + 60 * 0.30 + 40 * 0.20 + 20 * 0.15, 1)
    # no trailer found for this subject: the three remaining signals are reweighted, not zeroed out
    partial = buzzmeter.composite({"popularity": 80, "views": None, "mentions": 40, "pageviews": 20})
    w = 0.35 + 0.20 + 0.15
    assert partial == round((80 * 0.35 + 40 * 0.20 + 20 * 0.15) / w, 1)
    assert buzzmeter.composite({"popularity": None, "views": None, "mentions": None, "pageviews": None}) == 0.0


def test_movement_needs_a_real_move_not_noise():
    assert buzzmeter.movement(None, 40) == "new"
    assert buzzmeter.movement(40, 41) == "steady" and buzzmeter.movement(40, 41.5) == "steady"
    assert buzzmeter.movement(40, 50) == "up" and buzzmeter.movement(50, 40) == "down"
    assert buzzmeter.movement(40, 42) == "up", "the 2-point threshold itself counts as a move"


def test_the_days_label_reads_naturally_on_both_sides_of_release():
    today = "2026-01-10"
    assert buzzmeter._days_label(None, today) == ""
    assert buzzmeter._days_label("2026-01-15", today) == "in 5 days"
    assert buzzmeter._days_label("2026-01-11", today) == "in 1 day"
    assert buzzmeter._days_label("2026-01-10", today) == "out today"
    assert buzzmeter._days_label("2026-01-01", today) == "9 days since release"
    assert buzzmeter._days_label("2026-01-09", today) == "1 day since release"


def _fake_tmdb_youtube_wiki(monkeypatch, popularity=250.0, views=200_000, pageviews=4000, release_date="2026-02-01"):
    monkeypatch.setattr(tmdb, "detail", lambda kind, tmdb_id, timeout=15: {
        "id": tmdb_id, "kind": kind, "title": "Test Title", "popularity": popularity, "release_date": release_date})
    monkeypatch.setattr(youtube, "find_trailer", lambda film, studio="", year=None, timeout=20: {"views": views} if views else None)
    monkeypatch.setattr(wiki, "pageviews", lambda title, timeout=15: pageviews)


def test_gather_reading_composes_the_breakdown_and_refreshes_title_and_release(monkeypatch):
    _fake_tmdb_youtube_wiki(monkeypatch)
    breakdown, raw, release_date, title = buzzmeter.gather_reading(
        "movie", 42, "Old Title", None, _settings_stub(), {}, ["A story about Test Title today"], timeout=15)
    assert title == "Test Title" and release_date == "2026-02-01", "TMDB's own title and date win over the stored ones"
    assert breakdown["popularity"] == buzzmeter.popularity_score(250.0)
    assert breakdown["views"] == buzzmeter.view_score(200_000, None)
    assert breakdown["pageviews"] == buzzmeter.pageview_score(4000, None)
    assert breakdown["mentions"] == buzzmeter.mention_score(1)
    assert raw == {"views": 200_000, "pageviews": 4000}


def _settings_stub():
    class S:
        request_timeout = 15
    return S()


def test_table_html_renders_the_rank_score_and_release_timing():
    entries = [
        Reading("tmdb:movie:1", "movie", 1, "Film One", "2026-02-01", 82.0, {}, "up", {}),
        Reading("tmdb:person:2", "person", 2, "Star Two", None, 55.0, {}, "steady", {}),
    ]
    html = buzzmeter.table_html(entries, "2026-01-25")
    assert html.count("<tr>") == 1 + 2, "a header row and one per entry"
    assert "Film One" in html and "(film)" in html and "82" in html and "in 7 days" in html
    assert "Star Two" in html and "(celeb)" in html and "55" in html
    assert "Buzz Meter, 2026-01-25" in html


class FakeRewriter:
    def __init__(self):
        self.systems, self.users = [], []

    def ask(self, system, user, schema, validate=None, max_tokens=16000):
        self.systems.append(system); self.users.append(user)
        return CuratedPost(title="Buzz Meter: Film One leads", category="Buzz Meter", slug="buzz-meter-2026-01-25",
                           excerpt="e" * 120, body_html="<h2>Today's mover</h2><p>x</p>", tags=["buzz"],
                           image_headline="Buzz Meter: Film One leads at 82", image_kicker="Buzz Meter",
                           captions=Captions(twitter="tw", facebook="fb", instagram="ig", linkedin="li",
                                            pinterest_title="pt", pinterest="pi", telegram="tg", threads="th"))

    def rewrite(self, *a, **k):
        raise AssertionError("buzz meter never uses the news rewriter")


def test_the_slot_tracks_a_new_subject_and_publishes_the_digest(monkeypatch, settings, tmp_path):
    site = settings.site("SCREENSTAT")
    settings.buzz_meter_hours = [0]
    settings.reel_hours = settings.carousel_hours = settings.scorecard_hours = []
    settings.steal_hour, settings.debate_hours = None, []
    settings.ad_hours = []
    settings.min_relevance = 0
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [])
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    monkeypatch.setattr(tmdb, "upcoming", lambda kind, days=60, timeout=15, limit=12:
                        [{"id": 42, "kind": "movie", "title": "Old Title", "release_date": "2026-02-01",
                          "language": "hi", "popularity": 250.0, "backdrop": "https://img/backdrop.jpg"}] if kind == "movie" else [])
    monkeypatch.setattr(tmdb, "trending", lambda kind, window="week", timeout=15, limit=12: [])
    monkeypatch.setattr(tmdb, "trending_people", lambda window="week", timeout=15, limit=8: [])
    monkeypatch.setattr(tmdb, "find", lambda title, year=None, timeout=15: {"backdrop": "https://img/backdrop.jpg"})
    monkeypatch.setattr(tmdb, "person_still", lambda name, timeout=15, exact=False: None)
    _fake_tmdb_youtube_wiki(monkeypatch)
    _fake_photo_fetch(monkeypatch)
    state = State(tmp_path / "s.db")
    wp = FakeWP()
    Recorder.seen.clear()
    rw = FakeRewriter()
    report = pipeline.run_site(site, settings, state, rewriter=rw, wp=wp, publishers=[Recorder({})], work_dir=tmp_path / "img")
    assert report.published, "the digest went out"
    body = wp.posts[0]["content"]
    assert '<div class="screenstat-buzz-meter">' in body and "Test Title" in body
    assert ("categories", "Buzz Meter") in wp.terms
    assert state.buzz_subject("tmdb:movie:42")["status"] == "tracking"
    assert state.buzz_last_reading("tmdb:movie:42")["score"] == buzzmeter.composite(
        {"popularity": buzzmeter.popularity_score(250.0), "views": buzzmeter.view_score(200_000, None),
         "pageviews": buzzmeter.pageview_score(4000, None), "mentions": buzzmeter.mention_score(0)})
    assert len(carousels.parse_log(state.note(site.key, buzzmeter.NOTE))) == 1
    assert Recorder.seen[0].story_urls == [], "the digest is a carousel; it does not also force a story"
    # same slot again: nothing, and the model is not asked
    rw2 = FakeRewriter()
    pipeline.run_site(site, settings, state, rewriter=rw2, wp=wp, publishers=[Recorder({})], work_dir=tmp_path / "img")
    assert rw2.systems == []


def test_a_candidate_below_the_entry_floor_never_joins_the_meter(monkeypatch, settings, tmp_path):
    site = settings.site("SCREENSTAT")
    monkeypatch.setattr(tmdb, "upcoming", lambda kind, days=60, timeout=15, limit=12:
                        [{"id": 7, "kind": "movie", "title": "Quiet Title", "release_date": "2026-03-01",
                          "language": "hi", "popularity": 1.0, "backdrop": None}] if kind == "movie" else [])
    monkeypatch.setattr(tmdb, "trending", lambda kind, window="week", timeout=15, limit=12: [])
    monkeypatch.setattr(tmdb, "trending_people", lambda window="week", timeout=15, limit=8: [])
    monkeypatch.setattr(tmdb, "detail", lambda kind, tmdb_id, timeout=15: {"id": tmdb_id, "kind": kind, "title": "Quiet Title",
                                                                          "popularity": 1.0, "release_date": "2026-03-01"})
    monkeypatch.setattr(youtube, "find_trailer", lambda *a, **k: None)
    monkeypatch.setattr(wiki, "pageviews", lambda *a, **k: None)
    state = State(tmp_path / "s.db")
    added = buzzmeter.intake(site, settings, state, set(), "2026-01-25", [])
    assert added == [] and state.buzz_subject("tmdb:movie:7") is None


def test_a_subject_retires_after_the_post_release_window(tmp_path):
    state = State(tmp_path / "s.db")
    today = date.today()
    released = (today - timedelta(days=20)).isoformat()
    reading = Reading("tmdb:movie:9", "movie", 9, "Old Release", released, 60.0, {}, "steady", {})

    class S:
        buzz_meter_retire_days = 14

    assert buzzmeter._should_retire(reading, today.isoformat(), S(), state)
    fresh = Reading("tmdb:movie:10", "movie", 10, "Fresh Release", (today - timedelta(days=3)).isoformat(), 60.0, {}, "steady", {})
    assert not buzzmeter._should_retire(fresh, today.isoformat(), S(), state)


def test_a_dateless_subject_retires_after_a_sustained_low_score(tmp_path):
    state = State(tmp_path / "s.db")
    state.buzz_upsert_subject("tmdb:person:5", "SCREENSTAT", "person", "Fading Star", None)
    for i, score in enumerate([5.0, 4.0, 3.0]):
        state.buzz_record_reading("tmdb:person:5", f"2026-01-{20 + i}", score, "{}")
    reading = Reading("tmdb:person:5", "person", 5, "Fading Star", None, 3.0, {}, "down", {})

    class S:
        buzz_meter_retire_days = 14

    assert buzzmeter._should_retire(reading, "2026-01-23", S(), state)
