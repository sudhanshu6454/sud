from pathlib import Path

from autopub import pipeline, tmdb, watchlists
from autopub.rewrite import Captions, CuratedPost
from autopub.state import State


class FakeRewriter:
    def ask(self, system, user, schema, validate=None, max_tokens=16000):
        if "entries" in schema["required"]:
            return validate({"theme": "Films to watch in your 20s", "subline": "s", "intro": "i" * 20,
                             "entries": [{"title": f"Film {i}", "year": 2020, "language": "Hindi", "where": "",
                                         "why": "w" * 20} for i in range(6)]})
        return validate({"title": "Watchlist: Films to watch in your 20s", "category": watchlists.CATEGORY,
                         "slug": "watchlist", "excerpt": "e" * 120, "body_html": "<p>x</p>", "tags": ["a"],
                         "image_headline": "h", "image_kicker": watchlists.KICKER, "carousel_slides": [],
                         "captions": {"twitter": "tw", "facebook": "fb", "instagram": "ig", "linkedin": "li",
                                     "pinterest_title": "pt", "pinterest": "pi", "telegram": "tg", "threads": "th"}})


def test_watchlist_is_published_as_a_carousel_without_forcing_a_story(monkeypatch, settings, site, tmp_path):
    monkeypatch.setattr(tmdb, "find", lambda title, year=None, timeout=15: None)
    calls = []
    monkeypatch.setattr(pipeline, "publish_post", lambda *a, **k: calls.append(k) or True)
    state = State(tmp_path / "s.db")
    ok = watchlists.publish_daily(site, settings, state, FakeRewriter(), wp=None, publishers=[], work_dir=tmp_path,
                                  report=None)
    assert ok
    assert len(calls) == 1
    assert calls[0]["want_carousel"] is True
    assert not calls[0].get("force_story"), "a watchlist is a carousel; it must not also force a story"
