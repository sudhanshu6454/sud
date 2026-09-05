import json
from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from autopub.extract import Article
from autopub.rewrite import OUTPUT_SCHEMA, Rewriter, RewriteSkipped, schema_for

GOOD = {
    "title": "Brands Rethink Loyalty", "category": "Branding", "slug": "brands-rethink-loyalty", "excerpt": "x" * 130,
    "body_html": "<p>Body</p><p><em>Source: <a href='https://src.com/a'>Src</a></em></p>",
    "tags": ["loyalty", "brand", "psychology", "retail"], "image_headline": "Brands rethink loyalty",
    "image_kicker": "Brand Strategy",
    "captions": {"twitter": "t", "facebook": "f", "instagram": "i", "linkedin": "l", "pinterest_title": "pt",
                 "pinterest": "p", "telegram": "tg", "threads": "th"},
}


def _resp(text, stop="end_turn"):
    return SimpleNamespace(
        stop_reason=stop, stop_details=SimpleNamespace(category="cyber") if stop == "refusal" else None,
        content=[SimpleNamespace(type="text", text=text)],
        usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0),
    )


class FakeBetaMessages:
    def __init__(self, outer, reject):
        self.outer, self.reject = outer, reject

    def create(self, **kw):
        self.outer.calls.append(("beta", kw))
        if self.reject:
            resp = httpx2.Response(400, request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages"))
            raise anthropic.BadRequestError("fallbacks unsupported", response=resp, body={"error": {"message": "fallbacks unsupported"}})
        return self.outer.result


class FakeClient:
    def __init__(self, result, reject_beta=False):
        self.result, self.calls = result, []
        self.beta = SimpleNamespace(messages=FakeBetaMessages(self, reject_beta))
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kw):
        self.calls.append(("plain", kw))
        return self.result


ARTICLE = Article(url="https://src.com/a", title="Src title", text="word " * 400, sitename="Src")


def test_rewrite_uses_fallbacks_and_schema(site):
    client = FakeClient(_resp(json.dumps(GOOD)))
    post = Rewriter(model="claude-opus-5", client=client).rewrite(site, ARTICLE)
    assert post.title == "Brands Rethink Loyalty"
    kind, kw = client.calls[0]
    assert kind == "beta" and kw["fallbacks"] == "default" and kw["betas"] == ["server-side-fallback-2026-07-01"]
    assert kw["model"] == "claude-opus-5"
    assert kw["output_config"]["format"]["schema"]["properties"]["category"]["enum"] == site.categories
    assert kw["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "Marketing Mentalist" in kw["system"][0]["text"]
    assert "SOURCE_URL: https://src.com/a" in kw["messages"][0]["content"]


def test_rewrite_falls_back_to_plain_when_beta_rejected(site):
    client = FakeClient(_resp(json.dumps(GOOD)), reject_beta=True)
    rw = Rewriter(client=client)
    rw.rewrite(site, ARTICLE)
    assert [c[0] for c in client.calls] == ["beta", "plain"]
    rw.rewrite(site, ARTICLE)
    assert client.calls[-1][0] == "plain" and rw.use_fallbacks is False


def test_refusal_is_skipped(site):
    with pytest.raises(RewriteSkipped):
        Rewriter(client=FakeClient(_resp("", stop="refusal"))).rewrite(site, ARTICLE)


def test_bad_json_is_error(site):
    with pytest.raises(RuntimeError):
        Rewriter(client=FakeClient(_resp("not json"))).rewrite(site, ARTICLE)


def test_schema_has_no_unsupported_array_constraints():
    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "array":
                assert node.get("minItems", 0) in (0, 1) and "maxItems" not in node
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
    walk(OUTPUT_SCHEMA)


def test_tags_are_clamped(site):
    data = dict(GOOD, tags=[f"t{i}" for i in range(12)] + ["  "])
    post = Rewriter(client=FakeClient(_resp(json.dumps(data)))).rewrite(site, ARTICLE)
    assert len(post.tags) == 8


def test_schema_carries_the_sites_own_sections(site):
    schema = schema_for(site)
    assert schema["properties"]["category"]["enum"] == site.categories
    assert "category" in schema["required"]
    assert OUTPUT_SCHEMA["properties"]["category"].get("enum") is None   # the template is not mutated


def test_category_is_snapped_to_a_real_section(site):
    data = dict(GOOD, category="  bRaNdInG ")
    assert Rewriter(client=FakeClient(_resp(json.dumps(data)))).rewrite(site, ARTICLE).category == "Branding"


def test_unknown_category_falls_back_to_the_default(site):
    data = dict(GOOD, category="Sports")
    assert Rewriter(client=FakeClient(_resp(json.dumps(data)))).rewrite(site, ARTICLE).category == site.category
