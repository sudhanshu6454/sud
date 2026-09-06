from autopub import config


def test_sites_load(settings):
    assert [s.key for s in settings.sites] == ["MENTALIST", "CRAZY", "JUNKIES", "SCREENSTAT"]
    for s in settings.sites:
        assert s.feeds, f"{s.key} has no feeds"
        assert s.domain.endswith((".in", ".com"))
        assert s.brand.primary.startswith("#")
        assert set(s.socials) <= {"twitter", "facebook", "instagram", "linkedin", "pinterest", "telegram", "threads"}


def test_env_lookup_and_urls(site, monkeypatch):
    assert site.wp_base_url() == "https://marketingmentalist.in"
    monkeypatch.setenv("AUTOPUB_WP_INTERNAL", "true")
    assert site.wp_base_url() == "http://wp_mentalist"
    monkeypatch.setenv("WP_MENTALIST_URL", "http://10.0.0.5/")
    assert site.wp_base_url() == "http://10.0.0.5"
    monkeypatch.setenv("WP_MENTALIST_APP_PASSWORD", "abcd efgh")
    assert site.env("WP", "APP_PASSWORD") == "abcd efgh"


def test_duplicate_keys_rejected(tmp_path):
    p = tmp_path / "s.yaml"
    p.write_text("sites:\n  - {key: A, domain: a.in, name: A}\n  - {key: a, domain: b.in, name: B}\n")
    try:
        config.load(p)
    except ValueError as exc:
        assert "duplicate" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_sections_and_branding(settings):
    junkies = settings.site("JUNKIES")
    assert junkies.categories[0] == junkies.category          # default section leads the list
    assert "Campaigns" in junkies.categories
    assert junkies.use_source_image is True
    assert junkies.brand.logo and junkies.brand.logo.endswith(".png")
    from pathlib import Path
    assert Path(junkies.brand.logo).is_absolute() and Path(junkies.brand.logo).exists()
    mentalist = settings.site("MENTALIST")
    assert all(Path(s.brand.logo).exists() for s in settings.sites)   # every site ships a real cover logo
    assert mentalist.categories and mentalist.categories[0] == mentalist.category


def test_missing_logo_asset_falls_back_to_text(tmp_path):
    from autopub import config
    (tmp_path / "sites.yaml").write_text(
        "sites:\n  - key: X\n    domain: x.test\n    name: X\n    brand: {logo: brand/nope.png}\n", encoding="utf-8")
    assert config.load(tmp_path / "sites.yaml").site("X").brand.logo is None
