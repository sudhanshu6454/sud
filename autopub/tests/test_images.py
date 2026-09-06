import io
from pathlib import Path

import pytest
from PIL import Image

from autopub import images


def _colours(path: Path) -> set[tuple[int, int, int]]:
    im = Image.open(path).convert("RGB").resize((60, 32))
    return {c for _, c in im.getcolors(maxcolors=1 << 20)}


def _fake_photo_fetch(monkeypatch, size=(1600, 1000), colour=(0, 200, 0)):
    """Stand in for requests.get with a flat green 'photo' - green never appears in any brand palette."""
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, "JPEG")
    data = buf.getvalue()

    class Resp:
        def raise_for_status(self):
            pass

        def iter_content(self, n):
            for i in range(0, len(data), n):
                yield data[i:i + n]

    monkeypatch.setattr(images.requests, "get", lambda *a, **k: Resp())


def _has_green(path):
    return any(g > 150 and r < 80 and b < 80 for r, g, b in _colours(path))


def test_renders_both_share_sizes_as_progressive_jpegs(site, tmp_path):
    out = images.render_set("A headline that has to wrap across a couple of lines", "Branding", site, tmp_path, "story")
    land, sq = Image.open(out["landscape"]), Image.open(out["square"])
    assert land.size == (1200, 630) and sq.size == (1080, 1080)
    assert land.format == "JPEG" and land.info.get("progressive")


@pytest.mark.parametrize("key", ["MENTALIST", "CRAZY", "JUNKIES", "SCREENSTAT"])
def test_every_site_ships_a_real_logo(settings, key):
    site = settings.site(key)
    assert site.brand.logo and Path(site.brand.logo).exists(), f"{key} has no cover logo"


def test_logo_plate_is_drawn_and_readable_on_light_and_dark_plates(settings, tmp_path):
    junkies = settings.site("JUNKIES")   # cream plate
    with_logo = images.render_card("Headline", "Campaigns", junkies, tmp_path / "logo.jpg")
    assert any(r > 230 and g > 225 and b > 215 for r, g, b in _colours(with_logo))

    junkies.brand.logo = None
    without = images.render_card("Headline", "Campaigns", junkies, tmp_path / "nologo.jpg")
    assert not any(r > 230 and g > 225 and b > 215 for r, g, b in _colours(without))

    # dark plates get light domain text, not the invisible "55% of black" the old code produced
    crazy = settings.site("CRAZY")
    img = Image.new("RGB", (1200, 630), (0, 200, 0))
    images._paste_logo_plate(img, crazy.brand.logo, crazy.domain, images.hex_to_rgb(crazy.brand.primary))
    plate = img.crop((60, 480, 560, 590)).convert("L")
    assert plate.getextrema()[1] > 200, "domain text on the dark plate must be light"


def test_photo_is_used_sharp_as_the_cover_with_the_logo(settings, tmp_path, monkeypatch):
    _fake_photo_fetch(monkeypatch)
    crazy = settings.site("CRAZY")
    out = images.render_set("A real story with a real photo", "Digital Marketing", crazy, tmp_path, "photo",
                            backdrop_url="https://example.com/photo.jpg")
    land = Image.open(out["landscape"]).convert("RGB")
    # the photo is the cover: the top half is still the (unblurred, undarkened) photo colour
    assert land.getpixel((600, 150)) == pytest.approx((0, 200, 0), abs=12)
    # and the plate with the brand sits bottom-left over it
    assert not _has_green(out["landscape"]) or any(r < 30 and g < 30 and b < 30 for r, g, b in _colours(out["landscape"]))
    sq = Image.open(out["square"]).convert("RGB")
    assert sq.size == (1080, 1080)
    # the square carries the headline: white text pixels in the lower half
    lower = sq.crop((0, 540, 1080, 860)).convert("L")
    assert lower.getextrema()[1] > 240


def test_tiny_or_broken_images_fall_back_to_the_gradient(site, tmp_path, monkeypatch):
    _fake_photo_fetch(monkeypatch, size=(120, 80))
    out = images.render_card("Headline", "Kicker", site, tmp_path / "tiny.jpg", backdrop_url="https://example.com/px.gif")
    assert not _has_green(out)

    monkeypatch.setattr(images, "_backdrop", lambda url, size, timeout=20: None)
    out = images.render_card("Headline", "Kicker", site, tmp_path / "x.jpg", backdrop_url="https://example.com/x.jpg")
    assert out.exists() and Image.open(out).size == (1200, 630)


def test_covers_are_compressed(settings, tmp_path, monkeypatch):
    _fake_photo_fetch(monkeypatch)
    out = images.render_set("Headline", "Kicker", settings.site("JUNKIES"), tmp_path, "size", backdrop_url="https://example.com/p.jpg")
    assert out["landscape"].stat().st_size < 250_000 and out["square"].stat().st_size < 300_000


def test_degenerate_kicker_falls_back_to_the_section(site, tmp_path, monkeypatch):
    seen = {}
    monkeypatch.setattr(images, "_draw_kicker", lambda draw, kicker, *a: (seen.setdefault("kicker", kicker), 0)[1])
    images.render_card("Headline", "X", site, tmp_path / "k.jpg")
    assert seen["kicker"] == site.category
