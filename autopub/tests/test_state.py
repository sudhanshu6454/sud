from autopub.state import State


def test_claim_dedupes_globally(tmp_path):
    st = State(tmp_path / "s.db", dedupe_across_sites=True)
    assert st.claim("https://a.com/x", "MENTALIST", "t")
    assert not st.claim("https://a.com/x", "MENTALIST")
    assert not st.claim("https://a.com/x", "CRAZY")          # other site blocked too
    assert st.is_used("https://a.com/x", "JUNKIES")


def test_claim_per_site(tmp_path):
    st = State(tmp_path / "s.db", dedupe_across_sites=False)
    assert st.claim("https://a.com/x", "MENTALIST")
    assert st.claim("https://a.com/x", "CRAZY")


def test_lifecycle_and_social(tmp_path):
    st = State(tmp_path / "s.db")
    url = "https://a.com/story"
    st.claim(url, "CRAZY")
    st.mark_published(url, "CRAZY", 42, "https://crazy4marketing.com/story/", "Title")
    assert st.count("CRAZY") == 1
    assert st.last_published_at("CRAZY") is not None
    st.record_social(url, "CRAZY", "twitter", True, "1", "https://x.com/1")
    st.record_social(url, "CRAZY", "instagram", False, error="boom")
    rows = st.social_results(url, "CRAZY")
    assert [(r["platform"], r["ok"]) for r in rows] == [("twitter", 1), ("instagram", 0)]
    st.release(url, "CRAZY")
    assert not st.is_used(url, "CRAZY")
    assert st.recent(5) == []
