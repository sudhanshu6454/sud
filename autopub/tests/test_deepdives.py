from autopub import deepdives, pipeline, sources, tmdb, wiki
from autopub.state import State
from autopub.wiki import FilmPage


class FakeRewriter:
    def ask(self, system, user, schema, validate=None, max_tokens=16000):
        if "film" in schema["required"]:
            return validate({"film": "Test Film", "year": 2015, "kind": "trivia", "angle": "a" * 20, "why": "w" * 20})
        return validate({"title": "Trivia: Test Film", "category": deepdives.CATEGORY, "slug": "trivia-test-film",
                         "excerpt": "e" * 120, "body_html": "<p>x</p>", "tags": ["a"], "image_headline": "h",
                         "image_kicker": "Did you know", "film": {"title": "Test Film", "year": 2015},
                         "carousel_slides": [{"heading": f"Fact {i}", "body": "b" * 60} for i in range(6)],
                         "captions": {"twitter": "tw", "facebook": "fb", "instagram": "ig", "linkedin": "li",
                                     "pinterest_title": "pt", "pinterest": "pi", "telegram": "tg", "threads": "th"}})


def test_deep_dive_is_published_as_a_carousel_without_forcing_a_story(monkeypatch, settings, site, tmp_path):
    monkeypatch.setattr(tmdb, "anniversaries", lambda timeout=15: [])
    monkeypatch.setattr(tmdb, "popular_india", lambda timeout=15: [])
    monkeypatch.setattr(tmdb, "trending", lambda kind, window="week", timeout=15, limit=12: [])
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [])
    monkeypatch.setattr(wiki, "film_page", lambda title, year=None: FilmPage(url="https://en.wikipedia.org/wiki/Test_Film",
                                                                             title="Test Film", lead="x" * 2000, sections={}))
    monkeypatch.setattr(tmdb, "film_still", lambda film, year=None, timeout=15: None)
    calls = []
    monkeypatch.setattr(pipeline, "publish_post", lambda *a, **k: calls.append(k) or True)
    state = State(tmp_path / "s.db")
    ok = deepdives.publish_daily(site, settings, state, FakeRewriter(), wp=None, publishers=[], work_dir=tmp_path,
                                 report=None)
    assert ok
    assert len(calls) == 1
    assert calls[0]["want_carousel"] is True
    assert not calls[0].get("force_story"), "a deep dive is a carousel; it must not also force a story"
