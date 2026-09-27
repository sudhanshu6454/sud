"""OpenSEO beside the fleet: the MCP client, the keywords the writer gets, and the pipeline asking before it writes."""
import json
from datetime import datetime, timezone

import pytest

from autopub import extract, pipeline, seo, sources
from autopub.rewrite import Article
from autopub.state import State
from tests.test_pipeline import FakeRewriter, FakeWP, Recorder


class FakeOpenSeo:
    """The MCP server as autopub sees it: initialize, then tools/call, answered as JSON or as an SSE stream."""

    def __init__(self, sse=False):
        self.sse = sse
        self.calls = []
        self.projects = []
        self.trackers = {}

    def tool(self, name, args):
        self.calls.append((name, args))
        if name == "whoami":
            return {"userEmail": "admin@localhost", "mode": "self-hosted", "creditsRemaining": None}
        if name == "list_projects":
            return {"projects": list(self.projects)}
        if name == "create_project":
            p = {"id": f"proj_{len(self.projects) + 1}", "name": args["name"], "domain": args["domain"], "locationCode": args["locationCode"]}
            self.projects.append(p)
            return {"id": p["id"], "project": p}
        if name == "research_keywords":
            rows = [{"keyword": "war 3 box office collection", "searchVolume": 40500, "keywordDifficulty": 22, "intent": "informational"},
                    {"keyword": "war 3 release date", "searchVolume": 90500, "keywordDifficulty": 75, "intent": "informational"},
                    {"keyword": "War 3 Box Office Collection", "searchVolume": 12000, "keywordDifficulty": 20, "intent": "informational"},
                    {"keyword": "war 3 trailer", "searchVolume": 60500, "keywordDifficulty": 31, "intent": "informational"},
                    {"keyword": "war 3 cast", "searchVolume": 0, "keywordDifficulty": 10, "intent": "informational"}]
            return {"results": [{"seed": s["seed"], "ok": True, "rowCount": len(rows), "source": "labs", "rows": rows} for s in args["seeds"]]}
        if name == "get_rank_tracker":
            t = self.trackers.get(args["projectId"])
            return {"id": t, "keywords": 3} if t else {}
        if name == "create_rank_tracker":
            self.trackers[args["projectId"]] = "11111111-1111-4111-8111-111111111111"
            return {"id": self.trackers[args["projectId"]]}
        if name in ("add_rank_tracking_keywords", "run_rank_tracker"):
            return {"ok": True}
        raise AssertionError(f"unexpected tool {name}")

    def post(self, url, json=None, headers=None, timeout=None):
        assert url == "http://openseo:3001/mcp" and headers["Accept"].startswith("application/json")
        if json.get("method") == "initialize":
            return _Resp({"jsonrpc": "2.0", "id": json["id"], "result": {"protocolVersion": "2025-03-26"}}, sid="sess-1", sse=self.sse)
        if json.get("method") == "notifications/initialized":
            assert headers["mcp-session-id"] == "sess-1"
            return _Resp(None, status=202)
        if json.get("method") == "tools/list":
            return _Resp({"jsonrpc": "2.0", "id": json["id"], "result": {"tools": [{"name": "whoami"}, {"name": "research_keywords"}]}}, sse=self.sse)
        assert json["method"] == "tools/call" and headers["mcp-session-id"] == "sess-1"
        structured = self.tool(json["params"]["name"], json["params"]["arguments"])
        return _Resp({"jsonrpc": "2.0", "id": json["id"], "result": {"content": [{"type": "text", "text": "ok"}], "structuredContent": structured}}, sse=self.sse)


class _Resp:
    def __init__(self, body, sid=None, status=200, sse=False):
        self.status_code = status
        self.headers = {"content-type": "text/event-stream" if sse else "application/json"}
        if sid:
            self.headers["mcp-session-id"] = sid
        if body is None:
            self.text = ""
        elif sse:
            self.text = f"event: message\ndata: {json.dumps({'jsonrpc': '2.0', 'method': 'notifications/progress'})}\n\ndata: {json.dumps(body)}\n\n"
        else:
            self.text = json.dumps(body)


@pytest.fixture
def openseo(monkeypatch):
    monkeypatch.setenv("OPENSEO_URL", "http://openseo:3001/mcp")
    fake = FakeOpenSeo()
    monkeypatch.setattr(seo.requests, "post", fake.post)
    seo._PROJECTS.clear()
    return fake


def test_the_client_initialises_once_and_reads_json_or_sse_answers(monkeypatch, openseo):
    client = seo.Client()
    assert client.call("whoami")["mode"] == "self-hosted" and client.session_id == "sess-1"
    assert client.tools() == ["whoami", "research_keywords"]
    openseo.sse = True
    assert client.call("whoami")["userEmail"] == "admin@localhost", "an SSE stream is read to its answer"


def test_a_project_per_site_created_once_for_india(openseo):
    client = seo.Client()
    pid = seo.project_for(client, "Filmybuff", "filmybuff.com")
    assert pid == "proj_1" and openseo.calls[-1][0] == "create_project" and openseo.calls[-1][1]["locationCode"] == seo.INDIA
    assert seo.project_for(client, "Filmybuff", "filmybuff.com") == "proj_1" and openseo.calls[-1][0] == "create_project", "cached for the run"
    seo._PROJECTS.clear()
    assert seo.project_for(client, "Filmybuff", "filmybuff.com") == "proj_1" and openseo.calls[-1][0] == "list_projects", "found again, not made twice"


def test_the_seed_and_the_targets():
    assert seo.seed_from("'War 3' box office: Hrithik and NTR open to Rs 52 crore (day one) | Bollywood Hungama") == "war 3 box office hrithik and ntr open to"
    rows = [{"keyword": "war 3 release date", "volume": 90500, "difficulty": 75, "intent": "i", "overlap": 0.5},
            {"keyword": "war 3 box office collection", "volume": 40500, "difficulty": 22, "intent": "i", "overlap": 0.8},
            {"keyword": "War 3 Box Office Collection", "volume": 12000, "difficulty": 20, "intent": "i", "overlap": 0.8},
            {"keyword": "war 3 cast", "volume": 0, "difficulty": 10, "intent": "i", "overlap": 0.4}]
    got = seo.targets(rows)
    assert [r["keyword"] for r in got] == ["war 3 box office collection"], "too hard, a duplicate phrasing and no searches are out"
    text = seo.brief(got)
    assert text.startswith("TARGET KEYWORDS") and "war 3 box office collection (40500 searches/month, difficulty 22, i)" in text
    assert seo.brief([]) == ""


def test_the_pipeline_asks_once_per_story_and_the_writer_gets_the_keywords(monkeypatch, settings, tmp_path, openseo):
    site = settings.site("FILMYBUFF")
    site.news_hours = None
    settings.trailer_hours = settings.scene_hours = settings.deepdive_hours = settings.watchlist_hours = settings.scorecard_hours = settings.carousel_hours = settings.reel_hours = []
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(sources, "collect", lambda s, timeout=30: [sources.Candidate("War 3 box office: day one", "https://bh.com/war3-bo", "", now, "BH")])
    monkeypatch.setattr(extract, "extract", lambda url, timeout=20: Article(url=url, title="War 3 box office: day one", text="words " * 200, sitename="BH"))
    monkeypatch.setattr(pipeline.time, "sleep", lambda s: None)
    monkeypatch.setattr(pipeline.images, "_download_photo", lambda url, timeout: None)
    briefs = []

    class Writer(FakeRewriter):
        def rewrite(self, site, article, carousel=False, keywords=None):
            briefs.append(keywords)
            return super().rewrite(site, article, carousel)

    state = State(tmp_path / "s.db"); wp = FakeWP(); Recorder.seen.clear()
    report = pipeline.run_site(site, settings, state, rewriter=Writer(), wp=wp, publishers=[Recorder({})], work_dir=tmp_path / "img")
    assert report.published
    research = [c for c in openseo.calls if c[0] == "research_keywords"]
    assert len(research) == 1 and research[0][1]["seeds"] == [{"seed": "war 3 box office day one"}] and research[0][1]["projectId"] == "proj_1"
    assert [k["keyword"] for k in briefs[0]] == ["war 3 box office collection", "war 3 trailer"]


def test_without_openseo_or_when_it_fails_the_article_is_written_as_before(monkeypatch):
    monkeypatch.delenv("OPENSEO_URL", raising=False)
    assert not seo.enabled() and seo.keywords_for_story("Filmybuff", "filmybuff.com", "War 3") == []
    monkeypatch.setenv("OPENSEO_URL", "http://openseo:3001/mcp")
    monkeypatch.setattr(seo.requests, "post", lambda *a, **k: (_ for _ in ()).throw(ConnectionError("down")))
    assert seo.keywords_for_story("Filmybuff", "filmybuff.com", "War 3") == []


def test_the_writer_puts_the_keywords_in_its_brief(settings):
    from autopub.rewrite import Rewriter
    site = settings.site("FILMYBUFF")
    seen = {}

    class R(Rewriter):
        def __init__(self):
            pass

        def ask(self, system, user, schema, validate=None, max_tokens=16000):
            seen["user"] = user
            self.last_usage = type("Usage", (), {"input_tokens": 0, "output_tokens": 0})()
            from tests.test_trailers import _post
            return _post()

    R().rewrite(site, Article(url="https://bh.com/x", title="t", text="body", sitename="BH"), keywords=[{"keyword": "war 3 box office collection", "volume": 40500, "difficulty": 22, "intent": "informational"}])
    assert "TARGET KEYWORDS" in seen["user"] and seen["user"].index("TARGET KEYWORDS") < seen["user"].index("SOURCE_TEXT:")


def test_rank_tracking_creates_the_tracker_once_and_adds_the_keywords(openseo):
    client = seo.Client()
    got = seo.track(client, "proj_9", "filmybuff.com", ["war 3 box office collection"], run=True)
    names = [c[0] for c in openseo.calls]
    assert names == ["get_rank_tracker", "create_rank_tracker", "add_rank_tracking_keywords", "run_rank_tracker", "get_rank_tracker"]
    assert got["id"] == "11111111-1111-4111-8111-111111111111"
    openseo.calls.clear()
    seo.track(client, "proj_9", "filmybuff.com", [], run=False)
    assert [c[0] for c in openseo.calls] == ["get_rank_tracker", "get_rank_tracker"], "no second tracker, no run"
