from pathlib import Path

from PIL import Image

from autopub import images


def _colours(path: Path) -> set[tuple[int, int, int]]:
    im = Image.open(path).convert("RGB").resize((60, 32))
    return set(im.convert('RGB').getcolors(maxcolors=1 << 20) and [c for _, c in im.getcolors(maxcolors=1 << 20)])


def test_renders_both_share_sizes(site, tmp_path):
    out = images.render_set("A headline that has to wrap across a couple of lines", "Branding", site, tmp_path, "story")
    assert Image.open(out["landscape"]).size == (1200, 630)
    assert Image.open(out["square"]).size == (1080, 1080)


def test_logo_plate_is_drawn_for_sites_with_a_logo(settings, tmp_path):
    junkies = settings.site("JUNKIES")
    with_logo = images.render_card("Headline", "Campaigns", junkies, tmp_path / "logo.jpg")
    # the plate uses the logo's own cream ground, which the ink/bronze palette never produces on its own
    assert any(r > 230 and g > 225 and b > 215 for r, g, b in _colours(with_logo))

    junkies.brand.logo = None
    without = images.render_card("Headline", "Campaigns", junkies, tmp_path / "nologo.jpg")
    assert not any(r > 230 and g > 225 and b > 215 for r, g, b in _colours(without))


def test_missing_backdrop_falls_back_to_the_gradient(site, tmp_path, monkeypatch):
    monkeypatch.setattr(images, "_backdrop", lambda url, size, timeout=20: None)
    out = images.render_card("Headline", "Kicker", site, tmp_path / "x.jpg", backdrop_url="https://example.com/x.jpg")
    assert out.exists() and Image.open(out).size == (1200, 630)
