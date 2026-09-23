"""Tagging: the rewriter proposes who the story is about; only verified accounts are ever tagged."""
import json

from autopub.rewrite import CuratedPost, Mention
from autopub.social import REGISTRY
from autopub.social import mentions as m
from autopub.state import State
from tests.test_social import _graph, _post


def test_name_matching_is_lenient_on_form_and_strict_on_identity():
    assert m.names_match("The Drum", "The Drum", "thedrum")
    assert m.names_match("Ogilvy India", "Ogilvy", "ogilvy")
    assert m.names_match("Marketing Week", "Marketing Week UK", "marketingweek")
    assert m.names_match("Rory Sutherland", "Rory Sutherland", "rory.sutherland")
    assert not m.names_match("Zomato", "Zomato Fan Page", "zomatofans"), "fan accounts are not the brand"
    assert not m.names_match("Zomato", "Rahul Sharma", "rahul_sharma_23"), "an unrelated account never matches"
    assert not m.names_match("Meta", "Metallica", "metallica"), "a short name inside a longer word is not a match"
    assert not m.names_match("", "Anything", "anything")


def test_verify_keeps_only_accounts_that_exist_and_match_and_caches_the_verdict(tmp_path, monkeypatch):
    looked_up = []

    def fake_discover(anchor, token, handle, timeout=20):
        looked_up.append(handle)
        return {"thedrum": {"username": "thedrum", "name": "The Drum"},
                "zomato": {"username": "zomato", "name": "Zomato"},
                "impostor": {"username": "impostor", "name": "Totally Someone Else"}}.get(handle)

    monkeypatch.setattr(m, "discover", fake_discover)
    state = State(tmp_path / "s.db")
    cands = [Mention(name="Zomato", kind="brand", instagram="zomato"),
             Mention(name="The Drum", kind="publication", instagram="@TheDrum"),
             Mention(name="Swiggy", kind="brand", instagram="impostor"),
             Mention(name="Ghost Co", kind="brand", instagram="does_not_exist"),
             Mention(name="No handle", kind="brand", instagram=None)]
    got = m.verify(cands, "17", "t", state)
    assert got == ["thedrum", "zomato"], "publication first, then the brand; the mismatch and the missing account are dropped"
    assert sorted(looked_up) == ["does_not_exist", "impostor", "thedrum", "zomato"]

    looked_up.clear()
    again = m.verify(cands, "17", "t", state)
    assert again == ["thedrum", "zomato"] and looked_up == [], "second time round every verdict comes from the cache"
    assert json.loads(state.note(m.CACHE_SITE, "does_not_exist"))["ok"] is False


def test_verify_caps_the_tags_and_ranks_publication_brand_person(monkeypatch):
    monkeypatch.setattr(m, "discover", lambda a, t, h, timeout=20: {"username": h, "name": h.replace("_", " ").title()})
    cands = [Mention(name=f"Person {i}", kind="person", instagram=f"person_{i}") for i in range(3)]
    cands += [Mention(name="Brand One", kind="brand", instagram="brand_one"),
              Mention(name="Paper Daily", kind="publication", instagram="paper_daily")]
    got = m.verify(cands, "17", "t", None)
    assert got[:2] == ["paper_daily", "brand_one"] and len(got) == m.MAX_TAGS


def test_bad_handles_are_never_sent_to_the_api(monkeypatch):
    monkeypatch.setattr(m, "discover", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not look this up")))
    cands = [Mention(name="X", kind="brand", instagram="has spaces"), Mention(name="Y", kind="brand", instagram="way/too/odd")]
    assert m.verify(cands, "17", "t", None) == []


def test_instagram_caption_credits_the_verified_accounts_and_the_container_carries_photo_tags(monkeypatch):
    from autopub.social import instagram as ig
    seen = {}

    def media(method, url, kwargs):
        seen.update(kwargs.get("data", {}))
        return 200, {"id": "c1"}

    call, Resp = _graph({
        "/content_publishing_limit": (200, {"data": [{"config": {"quota_total": 100}, "quota_usage": 0}]}),
        "/media_publish": (200, {"id": "m1"}),
        "/m1": (200, {"permalink": "https://instagram.com/p/x/"}),
        "c1": (200, {"status_code": "FINISHED"}),
        "/media": media,
    })
    monkeypatch.setattr(ig.requests, "request", call)
    monkeypatch.setattr(ig.requests, "get", lambda *a, **k: Resp(200, {}))
    pub = REGISTRY["instagram"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    post = _post(captions={"instagram": "Hook line\n\n#tag1 #tag2"}, image_urls={"square": "https://cdn/s.jpg"},
                 mentions=["thedrum", "zomato"])
    res = pub.publish(post)
    assert res.ok
    assert "@thedrum @zomato" in seen["caption"] and seen["caption"].index("@thedrum") > seen["caption"].index("#tag2")
    tags = json.loads(seen["user_tags"])
    assert [t["username"] for t in tags] == ["thedrum", "zomato"]
    assert all(0 < t["x"] < 1 and 0 < t["y"] < 1 for t in tags) and tags[0]["x"] != tags[1]["x"]


def test_a_refused_tag_falls_back_to_the_same_post_without_photo_tags(monkeypatch):
    from autopub.social import instagram as ig
    attempts = []

    def media(method, url, kwargs):
        data = kwargs.get("data", {})
        attempts.append("user_tags" in data)
        if "user_tags" in data:
            return 400, {"error": {"code": 100, "error_subcode": 2207052, "message": "The user cannot be tagged"}}
        return 200, {"id": "c1"}

    call, Resp = _graph({
        "/content_publishing_limit": (200, {"data": [{"config": {"quota_total": 100}, "quota_usage": 0}]}),
        "/media_publish": (200, {"id": "m1"}),
        "c1": (200, {"status_code": "FINISHED"}),
        "/media": media,
    })
    monkeypatch.setattr(ig.requests, "request", call)
    monkeypatch.setattr(ig.requests, "get", lambda *a, **k: Resp(200, {}))
    pub = REGISTRY["instagram"]({"USER_ID": "17", "ACCESS_TOKEN": "t"})
    res = pub.publish(_post(image_urls={"square": "https://cdn/s.jpg"}, mentions=["private_person"]))
    assert res.ok and attempts == [True, False], "one try with tags, then the same container without them"


def test_curated_post_accepts_mentions_and_defaults_to_none():
    base = dict(title="T", slug="t", excerpt="E", body_html="<p>x</p>", image_headline="H", image_kicker="K",
                captions=dict(twitter="", facebook="", instagram="", linkedin="", pinterest_title="", pinterest="",
                              telegram="", threads=""))
    assert CuratedPost(**base).mentions == []
    post = CuratedPost(**base, mentions=[{"name": "The Drum", "kind": "publication", "instagram": "thedrum"},
                                         {"name": "Someone", "kind": "person"}])
    assert post.mentions[0].instagram == "thedrum" and post.mentions[1].instagram is None
