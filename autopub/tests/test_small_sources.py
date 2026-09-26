"""A still too small to fill the 3:4 poster sharply is set at its own shape between bands of its own colour,
with no type on it; a person story with a small press photo takes the person's portrait from TMDB."""
from datetime import datetime, timezone

from PIL import Image, ImageDraw

from autopub import extract, images, pipeline, poster, refresh, sources, tmdb
from autopub.rewrite import Mention
from autopub.state import State
from tests.test_pipeline import FakeWP, Recorder
from tests.test_poster import _cream
from tests.test_trailers import _post


def _frame(size, face=None):
    im = Image.new("RGB", size, (60, 80, 100))
    if face:
        ImageDraw.Draw(im).ellipse(face, fill=(214, 172, 140))
    return im


def test_a_720p_frame_is_letterboxed_and_the_title_stays_off_it(settings, tmp_path, monkeypatch):
    site = settings.site("FILMYBUFF")
    monkeypatch.setattr(images, "_download_photo", lambda url, timeout: _frame((1280, 720), (820, 120, 1020, 380)))
    monkeypatch.setattr(images, "_detect_faces", lambda img: [(820, 120, 1020, 380)])
    images._LAST_PHOTO = None
    assert poster.upscale_needed("https://x/s.jpg") > poster.LETTERBOX_ABOVE
    img, has_still, box = poster._ground("https://x/s.jpg", poster.MASTER, (32, 30, 29), (236, 48, 19))
    assert has_still and box[0] == 0 and box[2] == poster.MASTER[0], "the still spans the width at its own shape"
    assert box[3] - box[1] == round(720 * poster.MASTER[0] / 1280)
    out = poster.card("Nani's The Paradise nears Rs 80 crore India gross by day 3", "Box Office", site, tmp_path / "l.jpg", "portrait", backdrop_url="https://x/s.jpg")
    w, h = poster.MASTER
    assert _cream(out, (0, box[1] / h, 1, box[3] / h)) < 10, "no type on the still"
    assert _cream(out, (0, 0.08, 1, box[1] / h)) > 100, "the title sits in the band above it"
    # a 1080p frame still fills the frame edge to edge
    monkeypatch.setattr(images, "_download_photo", lambda url, timeout: _frame((1920, 1080)))
    monkeypatch.setattr(images, "_detect_faces", lambda img: [])
    images._LAST_PHOTO = None
    assert poster.upscale_needed("https://x/t.jpg") < poster.LETTERBOX_ABOVE
    _img, has_still, box = poster._ground("https://x/t.jpg", poster.MASTER, (32, 30, 29), (236, 48, 19))
    assert has_still and box is None


def test_tmdb_gives_a_persons_best_portrait(monkeypatch):
    monkeypatch.setenv("TMDB_API_KEY", "k")
    answers = {"/search/person": {"results": [{"id": 5, "name": "Akshay Kumar", "profile_path": "/p.jpg"}]},
               "/person/5/images": {"profiles": [{"file_path": "/small.jpg", "width": 500, "vote_average": 9},
                                                 {"file_path": "/best.jpg", "width": 1200, "vote_average": 6.2, "vote_count": 10},
                                                 {"file_path": "/ok.jpg", "width": 1000, "vote_average": 5.0}]}}
    monkeypatch.setattr(tmdb, "_get", lambda path, params, timeout=15: answers.get(path))
    shot = tmdb.person_still("Akshay Kumar")
    assert shot["url"] == "https://image.tmdb.org/t/p/original/best.jpg" and shot["credit"] == "Photo: Akshay Kumar, via TMDB"
    assert tmdb.person_still("Akshay", exact=True) is None and tmdb.person_still("akshay kumar", exact=True)["name"] == "Akshay Kumar"
    answers["/person/5/images"] = {"profiles": []}
    assert tmdb.person_still("Akshay Kumar")["url"].endswith("/original/p.jpg")


def _run_person_story(monkeypatch, settings, tmp_path, press_size):
    site = settings.site("FILMYBUFF")
    settings.trailer_hours = settings.watchlist_hours = settings.scorecard_hours = settings.carousel_hours = settings.reel_hours = []
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [sources.Candidate("Akshay on comedy", "https://toi.com/akshay", "", now, "TOI")])
    monkeypatch.setattr(extract, "extract", lambda url, timeout=20: extract.Article(url=url, title="Akshay on comedy", text="words " * 200, sitename="TOI", image="https://toi.com/press.jpg"))
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    served = {"https://toi.com/press.jpg": _frame(press_size), "https://image.tmdb.org/t/p/original/best.jpg": _frame((1200, 1800))}
    fetched = []
    monkeypatch.setattr(images, "_download_photo", lambda url, timeout: (fetched.append(url), served.get(url))[1])
    monkeypatch.setattr(images, "_detect_faces", lambda img: [])
    images._LAST_PHOTO = None
    monkeypatch.setattr(tmdb, "person_still", lambda name, timeout=15, exact=False: {"url": "https://image.tmdb.org/t/p/original/best.jpg", "name": name, "id": 5, "credit": f"Photo: {name}, via TMDB"})

    class Writer:
        def rewrite(self, site, article, carousel=False):
            p = _post(); p.category = "Bollywood"; p.mentions = [Mention(name="Akshay Kumar", kind="person")]
            return p

    state = State(tmp_path / "s.db"); wp = FakeWP(); Recorder.seen.clear()
    report = pipeline.run_site(site, settings, state, rewriter=Writer(), wp=wp, publishers=[Recorder({})], work_dir=tmp_path / "img")
    return report, fetched


def test_a_small_press_photo_gives_way_to_the_persons_portrait(monkeypatch, settings, tmp_path):
    report, fetched = _run_person_story(monkeypatch, settings, tmp_path, (640, 360))
    assert report.published and "https://image.tmdb.org/t/p/original/best.jpg" in fetched


def test_a_large_press_photo_is_kept(monkeypatch, settings, tmp_path):
    report, fetched = _run_person_story(monkeypatch, settings, tmp_path, (2400, 1600))
    assert report.published and "https://image.tmdb.org/t/p/original/best.jpg" not in fetched


def test_the_refresh_swaps_a_small_press_photo_for_a_tagged_persons_portrait(monkeypatch, settings, tmp_path):
    site = settings.site("FILMYBUFF")
    monkeypatch.setattr(extract, "extract", lambda url, timeout=30: extract.Article(url=url, title="t", text="", sitename="TOI", image="https://toi.com/press.jpg"))
    monkeypatch.setattr(images, "_download_photo", lambda url, timeout: _frame((640, 360)))
    monkeypatch.setattr(images, "_detect_faces", lambda img: [])
    images._LAST_PHOTO = None
    monkeypatch.setattr(tmdb, "film_still", lambda *a, **k: None)
    monkeypatch.setattr(tmdb, "person_still", lambda name, timeout=15, exact=False: {"url": f"https://image.tmdb.org/t/p/original/{name.replace(' ', '-')}.jpg", "name": name, "id": 1, "credit": "c"} if name == "Akshay Kumar" else None)
    assert refresh.source_still("https://toi.com/akshay", site, tags=["comedy", "Akshay Kumar"]).endswith("/Akshay-Kumar.jpg")
    assert refresh.source_still("https://toi.com/akshay", site, tags=["comedy"]) == "https://toi.com/press.jpg"
