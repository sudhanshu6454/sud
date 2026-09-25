"""Actor scorecards: Wikipedia figures read right, the record computed in code, the model kept to
the analysis, five slots a day on ScreenStat."""
from datetime import date

from autopub import carousels, pipeline, scorecards, sources, wiki
from autopub.rewrite import Captions, CuratedPost
from autopub.scorecards import Pick
from autopub.state import State
from tests.test_pipeline import FakeWP, Recorder

PAGE = """
<h2><span class="mw-headline">Films</span></h2>
<table class="wikitable"><tr><th>†</th><td>Denotes films that have not yet been released</td></tr></table>
<table class="wikitable sortable">
<tr><th>Year</th><th>Title</th><th>Role</th><th>Notes</th><th>Ref.</th></tr>
<tr><td rowspan="2">2012</td><td><i><a href="/wiki/Film_A">Film A</a></i></td><td>Lead</td><td></td><td><sup>[1]</sup></td></tr>
<tr><td><i><a href="/wiki/Film_B_(film)">Film B</a></i></td><td>Lead</td><td>Cameo</td><td></td></tr>
<tr><td>2014</td><td><i><a href="/wiki/Film_C">Film C</a></i></td><td>Lead</td><td></td><td></td></tr>
<tr><td>2026</td><td><i>TBA</i></td><td></td><td></td><td></td></tr>
</table>
<h2><span class="mw-headline">Television</span></h2>
<table class="wikitable">
<tr><th>Year</th><th>Title</th><th>Role</th><th>Notes</th></tr>
<tr><td>2019</td><td><a href="/wiki/Some_Show">Some Show</a></td><td>Host</td><td></td></tr>
</table>
<h2><span class="mw-headline">Short films</span></h2>
<table class="wikitable">
<tr><th>Year</th><th>Title</th><th>Role</th></tr>
<tr><td>2020</td><td><a href="/wiki/Short_One">Short One</a></td><td>Lead</td></tr>
</table>
"""


def test_the_filmography_reader_unrolls_rowspans_and_keeps_only_the_film_tables():
    films = wiki.parse_filmography(PAGE)
    assert [(f.year, f.title, f.page) for f in films] == [(2012, "Film A", "Film A"), (2012, "Film B", "Film B (film)"), (2014, "Film C", "Film C")]
    assert films[1].notes == "Cameo"
    assert not any(f.title in ("Some Show", "Short One", "TBA") for f in films), "television, shorts and unreleased rows stay out"


def test_money_strings_become_crore_rupees():
    assert wiki.crore("₹1,050–1,160 crore") == 1050.0
    assert wiki.crore("est. ₹300 crore") == 300.0
    assert wiki.crore("$45 million") == 3735.0 / 10
    assert wiki.crore("US$12.5 million") == 103.75
    assert wiki.crore("₹3.5 billion") == 350.0
    assert wiki.crore("₹35 lakh") == 0.35
    assert wiki.crore("Not available") is None


def test_the_verdict_rule_is_fixed_and_printed():
    assert scorecards.verdict(3.1) == "Blockbuster" and scorecards.verdict(2.0) == "Hit"
    assert scorecards.verdict(1.3) == "Average" and scorecards.verdict(0.9) == "Flop" and scorecards.verdict(None) is None


PHOTO = {"url": "https://upload.wikimedia.org/x/Star.jpg", "name": "Star.jpg", "width": 1200, "height": 1600,
         "artist": "Bollywood Hungama", "license": "CC BY 3.0", "license_url": "https://creativecommons.org/licenses/by/3.0",
         "page": "https://commons.wikimedia.org/wiki/File:Star.jpg"}


def test_the_lead_image_is_taken_only_under_a_licence_that_allows_reuse(monkeypatch):
    answers = {}

    def fake_get(params, timeout=20, api=None):
        if params.get("prop") == "pageimages":
            return {"query": {"pages": {"1": {"pageimage": "Star.jpg", "original": {"source": "https://upload.wikimedia.org/x/Star.jpg", "width": 1200, "height": 1600}}}}}
        return {"query": {"pages": {"2": {"imageinfo": [{"extmetadata": {k: {"value": v} for k, v in answers.items()}}]}}}}

    monkeypatch.setattr(wiki, "get", fake_get)
    answers.update(Artist="<a href='x'>Bollywood Hungama</a>\n", LicenseShortName="CC BY 3.0", LicenseUrl="https://creativecommons.org/licenses/by/3.0")
    img = wiki.lead_image("Star (actor)")
    assert img["artist"] == "Bollywood Hungama" and img["license"] == "CC BY 3.0" and img["width"] == 1200
    assert img["page"] == "https://commons.wikimedia.org/wiki/File:Star.jpg"
    for bad in ("Non-free fair use", "CC BY-NC-SA 4.0", "CC BY-ND 4.0", ""):
        answers["LicenseShortName"] = bad
        assert wiki.lead_image("Star (actor)") is None, bad
    answers["LicenseShortName"] = "GODL-India"
    assert wiki.lead_image("Star (actor)")["license"] == "GODL-India"
    monkeypatch.setattr(wiki, "get", lambda *a, **k: {"query": {"pages": {"1": {}}}})
    assert wiki.lead_image("Nobody") is None


def _fake_wiki(monkeypatch, n_recent=8, with_money=8):
    this = date.today().year
    films = [wiki.Film(year=1999 + i, title=f"Old {i}", page=f"Old {i}") for i in range(6)]
    films += [wiki.Film(year=this - n_recent + i, title=f"Recent {i}", page=f"Recent {i}") for i in range(n_recent)]
    monkeypatch.setattr(wiki, "filmography", lambda actor: ("Star filmography", films))
    money = {f"Recent {i}": (100.0, [120.0, 90.0, 300.0, 210.0, 180.0, 400.0, 110.0, 260.0][i % 8]) for i in range(with_money)}
    monkeypatch.setattr(wiki, "film_money", lambda page: money.get(page, (None, None)))
    monkeypatch.setattr(wiki, "person", lambda title: wiki.Person(title=title, born="1976-06-22", awards=9) if title == "Star (actor)" else wiki.Person(title=title))
    monkeypatch.setattr(wiki, "lead_image", lambda title: dict(PHOTO))


def test_the_record_is_computed_from_the_figures_not_guessed(monkeypatch):
    _fake_wiki(monkeypatch)
    f = scorecards.gather("Star (actor)")
    assert f is not None and f.actor == "Star" and f.films_total == 14 and f.debut_year == 1999
    # 120/100 flop, 90 flop, 300 blockbuster, 210 hit, 180 hit, 400 blockbuster, 110 flop, 260 blockbuster
    assert f.with_data == 8 and f.hits == 5 and f.blockbusters == 3 and f.average == 0 and f.flops == 3
    assert f.hit_rate == 62 and f.avg_multiple == round(sum([1.2, 0.9, 3.0, 2.1, 1.8, 4.0, 1.1, 2.6]) / 8, 2)
    assert f.biggest_hit["title"] == "Recent 5" and f.best_multiple["multiple"] == 4.0 and f.worst_multiple["multiple"] == 0.9
    assert f.recent_five_avg == round((2.1 + 1.8 + 4.0 + 1.1 + 2.6) / 5, 2) and f.previous_five_avg == round((1.2 + 0.9 + 3.0) / 3, 2)
    assert f.born == "1976-06-22" and f.awards == 9
    html = scorecards.table_html(f)
    assert "<h2>By the numbers</h2>" in html and "hit rate of 62%" in html and "Recent 5" in html and "2.5x budget" in html
    assert html.count("<tr>") == 1 + 8, "a header row and one row per recent film"
    card = scorecards.card_from(f)
    assert card.stat == "62%" and card.left_value == "5" and card.right_value == "3" and len(card.takeaways) == 3


def test_too_few_films_with_figures_means_no_scorecard(monkeypatch):
    _fake_wiki(monkeypatch, n_recent=8, with_money=4)
    assert scorecards.gather("Star") is None


class FakeRewriter:
    def __init__(self, picks):
        self.picks, self.systems, self.users = list(picks), [], []

    def ask(self, system, user, schema, validate=None, max_tokens=16000):
        self.systems.append(system); self.users.append(user)
        if "Name ONE Indian film actor" in system:
            return self.picks.pop(0)
        return CuratedPost(title="Star: 4 hits in 8 films", category="Scorecards", slug="star-scorecard", excerpt="e" * 120,
                           body_html="<h2>What the numbers say</h2><p>x</p>", tags=["star"], image_headline="Star: 4 hits in 8 films",
                           image_kicker="Scorecard", captions=Captions(twitter="tw", facebook="fb", instagram="ig", linkedin="li",
                                                                           pinterest_title="pt", pinterest="pi", telegram="tg", threads="th"))

    def rewrite(self, *a, **k):
        raise AssertionError("scorecards never use the news rewriter")


def test_the_slot_publishes_a_scorecard_with_the_table_and_a_figure_card(monkeypatch, settings, tmp_path):
    site = settings.site("SCREENSTAT")
    settings.scorecard_hours = [0]
    settings.reel_hours = settings.carousel_hours = []
    settings.steal_hour = settings.debate_hour = settings.nostalgia_hour = None
    settings.min_relevance = 0
    _fake_wiki(monkeypatch)
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [])
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    state = State(tmp_path / "s.db")
    wp = FakeWP()
    Recorder.seen.clear()
    rw = FakeRewriter([Pick(actor="Star (actor)", industry="Tamil", why_now="a release this week")])
    from PIL import Image
    def fake_fetch(photo, out_dir):
        path = tmp_path / "star.jpg"
        Image.new("RGB", (1200, 1600), (30, 90, 200)).save(path)
        return path
    monkeypatch.setattr(scorecards, "fetch_photo", fake_fetch)
    report = pipeline.run_site(site, settings, state, rewriter=rw, wp=wp, publishers=[Recorder({})], work_dir=tmp_path / "img")
    assert report.published == ["https://marketingmentalist.in/star-scorecard/"]
    body = wp.posts[0]["content"]
    assert body.startswith('<figure class="wp-block-image size-large screenstat-portrait">'), "the photo leads the page"
    assert 'Photo: <a href="https://commons.wikimedia.org/wiki/File:Star.jpg"' in body and "CC BY 3.0" in body
    assert '<div class="screenstat-scorecard">' in body and "Star filmography on Wikipedia" in body
    assert wp.media[0].name == "star.jpg", "the photo is uploaded first, with its credit, and the cards are drawn from it"
    assert ("categories", "Scorecards") in wp.terms
    assert "Hindi film industry" in rw.systems[0], "the first slot asks for a Hindi actor; industries rotate by slot"
    assert "FACTS (the only figures you may use)" in rw.users[1] and '"hit_rate": 62' in rw.users[1]
    assert state.is_used("https://en.wikipedia.org/wiki/Star_filmography", site.key)
    assert scorecards.parse_used(state.note(site.key, scorecards.USED_NOTE)) == ["Star"]
    assert len(carousels.parse_log(state.note(site.key, scorecards.NOTE))) == 1
    # same slot again: nothing, and the model is not asked
    rw2 = FakeRewriter([Pick(actor="Other", why_now="x")])
    pipeline.run_site(site, settings, state, rewriter=rw2, wp=wp, publishers=[Recorder({})], work_dir=tmp_path / "img")
    assert rw2.systems == []


def test_an_actor_without_figures_is_skipped_and_the_next_pick_asked(monkeypatch, settings, tmp_path):
    site = settings.site("SCREENSTAT")
    settings.scorecard_hours = [0]
    _fake_wiki(monkeypatch, with_money=2)
    state = State(tmp_path / "s.db")
    rw = FakeRewriter([Pick(actor="Thin", why_now="x"), Pick(actor="Thin2", why_now="x"), Pick(actor="Thin3", why_now="x")])
    ok = scorecards.publish_daily(site, settings, state, rw, FakeWP(), [], tmp_path, pipeline.RunReport(site=site.key))
    assert not ok and len(rw.systems) == scorecards.ATTEMPTS
    assert "Thin (not enough figures on Wikipedia)" in rw.systems[1]
    assert state.note(site.key, scorecards.NOTE) is None, "the slot stays open"


def test_only_screenstat_runs_scorecards(settings):
    assert [s.key for s in settings.sites if s.scorecards] == ["SCREENSTAT"]
    assert settings.scorecard_hours == [8, 11, 14, 17, 20]


def test_the_scorecard_card_shows_the_face_and_the_record(monkeypatch, settings, tmp_path):
    from PIL import Image
    from autopub import images
    from tests.test_images import _fake_photo_fetch, _has_green
    site = settings.site("SCREENSTAT")
    _fake_wiki(monkeypatch)
    f = scorecards.gather("Star (actor)")
    brief = scorecards.card_brief(f, "Bollywood Hungama, CC BY 3.0 via Wikimedia Commons")
    assert brief.kind == "scorecard" and brief.headline == "Star" and brief.stat == "62%" and brief.left_value == "5" and brief.right_value == "3"
    _fake_photo_fetch(monkeypatch, size=(1200, 1600))
    path = images.render_card("Star", "Scorecard", site, tmp_path / "sc.jpg", "portrait", backdrop_url="https://cdn/star.jpg", card=brief)
    with Image.open(path) as im:
        assert im.size == (1440, 1920)
        top = im.convert("RGB").crop((0, 200, 1440, 900))
        assert any(g > 150 and r < 80 and b < 80 for r, g, b in top.resize((20, 10)).getdata()), "the photo fills the top of the card"
    without = images.render_card("Star", "Scorecard", site, tmp_path / "sc2.jpg", "portrait", card=brief)
    assert not _has_green(without), "no photo: the type ground, not a blank"
