import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from autopub import pipeline, rank
from autopub.config import Settings
from autopub.sources import Candidate

NOW = datetime.now(timezone.utc)


def _cands(*titles):
    return [Candidate(title=t, url=f"https://src.com/{i}", summary="", published=NOW - timedelta(hours=i), source="Src")
            for i, t in enumerate(titles, 1)]


def _resp(payload):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=payload)])


class FakeClient:
    def __init__(self, payload=None, raises=None, stop_reason="end_turn"):
        self.payload, self.raises, self.calls, self.stop_reason = payload, raises, [], stop_reason
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kw):
        self.calls.append(kw)
        if self.raises:
            raise self.raises
        r = _resp(self.payload)
        r.stop_reason = self.stop_reason
        return r


class FlakyClient(FakeClient):
    """Fails the first call, succeeds the second - the shape of a truncated or rate-limited reply."""

    def _create(self, **kw):
        self.calls.append(kw)
        if len(self.calls) == 1:
            raise RuntimeError("truncated")
        r = _resp(self.payload)
        r.stop_reason = "end_turn"
        return r


SCORES = json.dumps({"scores": [{"i": 1, "s": 2, "why": "celebrity gossip"},
                                {"i": 2, "s": 9, "why": "subscriber numbers"},
                                {"i": 3, "s": 6, "why": "deal terms"}]})


def test_ranks_by_fit_not_recency(site):
    cands = _cands("Actor announces divorce", "Netflix adds 8m subscribers", "Studio signs output deal")
    out = rank.rank(site, cands, client=FakeClient(SCORES))
    assert [s.candidate.title for s in out] == ["Netflix adds 8m subscribers", "Studio signs output deal", "Actor announces divorce"]
    assert [s.score for s in out] == [9, 6, 2]
    assert out[0].reason == "subscriber numbers"


def test_the_beat_and_every_headline_reach_the_model(site):
    client = FakeClient(SCORES)
    rank.rank(site, _cands("a", "b", "c"), client=client)
    system = client.calls[0]["system"][0]["text"]
    assert site.niche[:40] in system and site.audience[:30] in system
    listing = client.calls[0]["messages"][0]["content"]
    assert listing.startswith("1. a") and "3. c" in listing


def test_fenced_json_is_accepted(site):
    out = rank.rank(site, _cands("a", "b", "c"), client=FakeClient("```json\n" + SCORES + "\n```"))
    assert [s.score for s in out] == [9, 6, 2]


def test_an_unscored_headline_keeps_its_place_rather_than_vanishing(site):
    partial = json.dumps({"scores": [{"i": 2, "s": 9, "why": "on beat"}]})
    out = rank.rank(site, _cands("a", "b", "c"), client=FakeClient(partial))
    assert len(out) == 3
    assert out[0].candidate.title == "b"
    assert {s.reason for s in out if s.candidate.title != "b"} == {"not scored"}


def test_api_failure_returns_none_so_the_caller_can_fall_back(site):
    client = FakeClient(raises=RuntimeError("502"))
    assert rank.rank(site, _cands("a"), client=client) is None
    assert len(client.calls) == 2, "should retry once before giving up and publishing by recency"


def test_a_transient_failure_is_retried_rather_than_dropping_the_filter(site):
    """Falling back means publishing off-beat again, so one flaky call must not cost the filter."""
    client = FlakyClient(SCORES)
    out = rank.rank(site, _cands("a", "b", "c"), client=client)
    assert out is not None and [s.score for s in out] == [9, 6, 2]
    assert len(client.calls) == 2


def test_a_reply_truncated_at_max_tokens_is_treated_as_a_failure(site):
    """A reasoning model can spend the whole budget thinking; the partial reply is not a ranking."""
    client = FakeClient(SCORES, stop_reason="max_tokens")
    assert rank.rank(site, _cands("a", "b", "c"), client=client) is None


def test_unusable_output_returns_none(site):
    assert rank.rank(site, _cands("a"), client=FakeClient("I'd be happy to help!")) is None


def test_empty_candidate_list_is_not_an_api_call(site):
    client = FakeClient(SCORES)
    assert rank.rank(site, [], client=client) == []
    assert client.calls == []


def test_the_pool_is_capped(site):
    client = FakeClient(SCORES)
    rank.rank(site, _cands(*[f"h{i}" for i in range(60)]), pool=10, client=client)
    assert client.calls[0]["messages"][0]["content"].count("\n") == 9   # 10 lines


# ---- the pipeline's use of it -------------------------------------------------------------

def _settings(site, **kw):
    return Settings(sites=[site], **kw)


def test_off_beat_candidates_are_dropped(site, monkeypatch):
    cands = _cands("Actor announces divorce", "Netflix adds 8m subscribers", "Studio signs output deal")
    monkeypatch.setattr(rank, "rank", lambda *a, **k: [
        rank.Scored(cands[1], 9, "on beat"), rank.Scored(cands[2], 6, "on beat"), rank.Scored(cands[0], 2, "gossip")])
    kept = pipeline._by_relevance(site, _settings(site, min_relevance=5), cands)
    assert [c.title for c in kept] == ["Netflix adds 8m subscribers", "Studio signs output deal"]


def test_nothing_on_beat_publishes_nothing(site, monkeypatch):
    cands = _cands("Actor announces divorce")
    monkeypatch.setattr(rank, "rank", lambda *a, **k: [rank.Scored(cands[0], 2, "gossip")])
    assert pipeline._by_relevance(site, _settings(site, min_relevance=5), cands) == []


def test_a_ranking_that_could_not_run_keeps_recency_order(site, monkeypatch):
    """An API hiccup must not silence the fleet - that is the difference between None and []."""
    cands = _cands("a", "b", "c")
    monkeypatch.setattr(rank, "rank", lambda *a, **k: None)
    assert pipeline._by_relevance(site, _settings(site, min_relevance=5), cands) == cands


def test_min_relevance_zero_disables_ranking_entirely(site, monkeypatch):
    cands = _cands("a", "b")
    monkeypatch.setattr(rank, "rank", lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not be called")))
    assert pipeline._by_relevance(site, _settings(site, min_relevance=0), cands) == cands
