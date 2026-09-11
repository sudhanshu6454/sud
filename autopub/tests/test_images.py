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

    monkeypatch.setattr(images, "_backdrop", lambda url, size, timeout=20, **kw: None)
    out = images.render_card("Headline", "Kicker", site, tmp_path / "x.jpg", backdrop_url="https://example.com/x.jpg")
    assert out.exists() and Image.open(out).size == (1200, 630)


def test_covers_are_compressed(settings, tmp_path, monkeypatch):
    _fake_photo_fetch(monkeypatch)
    out = images.render_set("Headline", "Kicker", settings.site("JUNKIES"), tmp_path, "size", backdrop_url="https://example.com/p.jpg")
    assert out["landscape"].stat().st_size < 250_000 and out["square"].stat().st_size < 300_000


def test_degenerate_kicker_falls_back_to_the_section(site, tmp_path, monkeypatch):
    seen = {}
    monkeypatch.setattr(images, "_draw_kicker", lambda draw, kicker, *a, **kw: (seen.setdefault("kicker", kicker), 0)[1])
    images.render_card("Headline", "X", site, tmp_path / "k.jpg")
    assert seen["kicker"] == site.category


# ---- face-aware crops ------------------------------------------------------------------------

def test_cover_fit_keeps_the_focus_box_inside_the_crop_with_headroom():
    # a tall photo whose "face" sits in the top quarter: a centre crop would cut it off
    tall = Image.new("RGB", (800, 2000), (30, 30, 30))
    face = (300, 200, 500, 400)
    crop, f = images._cover_fit(tall, (1200, 630), focus=face)
    assert crop.size == (1200, 630) and f is not None
    fl, ft, fr, fb = f
    assert 0 <= fl and fr <= 1200 and 0 <= ft and fb <= 630, "face must be fully inside the crop"
    assert ft >= 630 * 0.05, "some headroom above the face"


def test_cover_fit_keeps_faces_out_of_the_text_zone_on_the_square():
    tall = Image.new("RGB", (1000, 1600), (30, 30, 30))   # portrait source: the window can slide vertically
    face = (400, 900, 600, 1100)         # face low in the frame
    crop, f = images._cover_fit(tall, (1080, 1080), focus=face, clear_bottom=0.40)
    assert f is not None and f[3] <= 1080 * 0.60 + 1, "face bottom must stay above the headline gradient"


def test_cover_fit_without_focus_is_the_old_centre_crop():
    wide = Image.new("RGB", (3000, 1000), (30, 30, 30))
    crop, f = images._cover_fit(wide, (1200, 630))
    assert crop.size == (1200, 630) and f is None


def test_overlays_move_away_from_faces():
    w, h = 1200, 630
    assert images._overlay_sides(None, w, h) == ("left", "left")
    assert images._overlay_sides((40, 40, 400, 400), w, h) == ("right", "left")        # face top-left -> kicker right
    assert images._overlay_sides((60, 380, 420, 620), w, h) == ("left", "right")       # face bottom-left -> plate right
    assert images._overlay_sides((800, 40, 1150, 600), w, h) == ("left", "left")       # face on the right -> both left


def test_salient_box_finds_the_detailed_region():
    img = Image.new("RGB", (1200, 800), (40, 40, 40))
    px = img.load()
    for y in range(80, 380):                 # a noisy block top-right, flat elsewhere
        for x in range(700, 1150):
            px[x, y] = ((x * 7 + y * 13) % 256, (x * 3) % 256, (y * 5) % 256)
    box = images._salient_box(img)
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    assert cx > 600 and cy < 400


def test_detects_a_real_face_when_opencv_is_present():
    if images.cv2 is None:
        pytest.skip("OpenCV not installed")
    sample = Path(__file__).parent / "fixtures" / "face.jpg"
    if not sample.exists():
        pytest.skip("no face fixture")
    faces = images._detect_faces(Image.open(sample).convert("RGB"))
    assert faces, "expected at least one face in the fixture"


# ---- the Instagram news card -------------------------------------------------------------------


def test_portrait_card_is_a_true_3_4_rendered_above_1080(site, tmp_path):
    card = images.render_card("A headline for the feed", "Section", site, tmp_path / "p.jpg", "portrait")
    with Image.open(card) as im:
        assert im.size == (1440, 1920)                  # 1080-wide uploads go soft on a 3x phone
        assert round(im.width / im.height, 3) == 0.750


def test_instagram_asset_is_the_tallest_shape_the_api_accepts(site, tmp_path):
    card = images.render_card("A headline for the feed", "Section", site, tmp_path / "p.jpg", "portrait")
    feed = images.instagram_asset(card, out_path=tmp_path / "ig.jpg")
    with Image.open(feed) as im:
        assert round(im.width / im.height, 3) == 0.800  # 4:5 exactly: Meta refuses anything taller
        assert im.width == 1440
    # and the 3:4 master is posted unchanged once Meta accepts it
    assert images.instagram_asset(card, ratio="3:4") == card


def test_the_bleed_bands_a_4_5_crop_removes_carry_no_content(settings, tmp_path):
    """The card is drawn 3:4 but posted 4:5, so the trimmed bands must be background only."""
    for key in ("MENTALIST", "CRAZY", "JUNKIES", "SCREENSTAT"):
        site = settings.site(key)
        card = images.render_card("Scarcity marketing has stopped working on younger buyers", "Section",
                                  site, tmp_path / f"{key}.jpg", "portrait")
        with Image.open(card) as im:
            band = int(images.PORTRAIT_BLEED * images.CARD_SCALE)
            for strip in (im.crop((0, 0, im.width, band)), im.crop((0, im.height - band, im.width, im.height))):
                # a band holding type or a logo has far more distinct tones than a flat/graded ground
                assert len(strip.convert("RGB").getcolors(maxcolors=1 << 20)) < 400, f"{key} draws into the bleed"


def test_headline_sizes_come_from_a_ladder_not_from_continuous_shrinking(site, tmp_path):
    """The claim under test is discreteness: a headline's font size is always one of the ladder's
    fixed steps, never something arbitrary a continuous autosize loop would produce."""
    from PIL import ImageDraw
    draw = ImageDraw.Draw(Image.new("RGB", (1440, 1920)))
    column = 952 * images.CARD_SCALE
    allowed = {int(step[1] * images.CARD_SCALE) for step in images.HEADLINE_LADDER}
    headlines = [
        "Meta ad costs jump",
        "Zepto hands its creative duties to Lowe Lintas after a three-way pitch review",
        "Ghamasaan opens Friday as the model reads a strong opening weekend at the box office",
    ]
    sizes = set()
    for headline in headlines:
        font, lines, _ = images._headline_block(draw, headline, site.brand.font, column, images.HEADLINE_LADDER)
        assert font.size in allowed, f"{headline!r} rendered at {font.size}px, not a ladder step"
        sizes.add(font.size)
    assert len(sizes) >= 2, "every headline landed on the same step; the ladder is not being exercised"

    # and a real render of both ends of that range still produces a file
    assert images.render_card(headlines[0], "Section", site, tmp_path / "s.jpg", "portrait").exists()
    assert images.render_card(headlines[1], "Section", site, tmp_path / "l.jpg", "portrait").exists()


def test_lines_do_not_break_after_a_dangling_word(site):
    from PIL import ImageDraw
    draw = ImageDraw.Draw(Image.new("RGB", (1440, 1920)))
    column = 952 * images.CARD_SCALE
    font = images._font(int(92 * images.CARD_SCALE), bold=True, family=site.brand.font)
    lines = images._balanced_lines(draw, "Zepto hands the creative duties to Lowe Lintas".split(), font, column, 3)
    assert lines and not any(line.split()[-1].lower() in images.DANGLERS for line in lines[:-1])


def test_headline_punctuation_is_normalised():
    assert images.tidy("Meta costs jump -- again... | Crazy4Marketing") == "Meta costs jump — again…"
    assert images.tidy("  spaced   out  ") == "spaced out"


def test_kicker_chip_text_is_readable_on_every_brand_accent(settings):
    for site in settings.sites:
        accent = images.hex_to_rgb(site.brand.accent)
        assert images.contrast_ratio(accent, images._ink_on(accent)) >= 4.5, site.key


def test_every_site_ships_the_typeface_its_website_uses(settings):
    from autopub import typography
    for site in settings.sites:
        assert site.brand.font, f"{site.key} has no brand.font"
        loaded = typography.load(site.brand.font, 64, typography.BOLD)
        assert Path(loaded.path).parent == typography.FONT_DIR, f"{site.key} fell back to DejaVu: font file missing"


def test_logos_are_trimmed_so_every_mark_reads_at_the_same_size(settings):
    for site in settings.sites:
        logo, _plate = images._load_logo(site.brand.logo)
        edge = logo.convert("RGBA").getbbox()
        assert edge == (0, 0, logo.width, logo.height), f"{site.key} logo still carries a dead margin"


def test_an_impossible_headline_is_trimmed_not_drawn_over_the_footer(site, tmp_path):
    """Whatever the model hands us, the card must not run type through its own masthead."""
    monster = "A headline of quite absurd length " * 9
    card = images.render_card(monster, "Section", site, tmp_path / "m.jpg", "portrait")
    with Image.open(card) as im:
        # the footer band is the bottom ~10%: it must still be the masthead, not headline text
        foot = im.crop((0, int(im.height * 0.90), im.width, im.height)).convert("L")
        ink = sum(1 for px in foot.convert("L").tobytes() if px > 170)
    assert ink < foot.width * foot.height * 0.08, "headline is running into the footer"


def test_a_word_wider_than_the_column_is_broken_rather_than_run_off_the_card(site, tmp_path):
    from PIL import ImageDraw
    draw = ImageDraw.Draw(Image.new("RGB", (1440, 1920)))
    column = 952 * images.CARD_SCALE
    font = images._font(int(104 * images.CARD_SCALE), bold=True, family=site.brand.font)
    lines = images._wrap(draw, "Donaudampfschifffahrtsgesellschaftskapitaenswitwe", font, column)
    assert len(lines) > 1
    assert all(draw.textlength(line, font=font) <= column for line in lines)


def test_an_empty_headline_falls_back_rather_than_rendering_a_blank_card(site, tmp_path):
    card = images.render_card("", "Section", site, tmp_path / "e.jpg", "portrait",
                              standfirst="The summary carries the card when there is no headline.")
    with Image.open(card) as im:
        body = im.crop((0, int(im.height * 0.2), im.width, int(im.height * 0.85))).convert("L")
        assert any(px > 170 for px in body.tobytes()), "nothing was drawn"


def test_a_photo_too_small_for_the_aperture_is_not_blown_up(site, tmp_path, monkeypatch):
    _fake_photo_fetch(monkeypatch, size=(420, 260))       # a wire thumbnail, not a cover
    card = images.render_card("A headline", "Section", site, tmp_path / "small.jpg", "portrait",
                              backdrop_url="https://x/tiny.jpg")
    assert not _has_green(card), "a thumbnail was upscaled into the photo aperture"


def test_each_site_gets_its_own_section_rail(settings):
    rails = {site.key: site.brand.rail for site in settings.sites}
    assert len(set(rails.values())) > 1, "every site draws the same rule; the grid is unrecognisable"
    assert set(rails.values()) <= {"solid", "double", "inset", "bars"}


def test_the_posted_asset_meets_every_documented_instagram_constraint(settings, tmp_path):
    """Meta validates the file and refuses it outright, so the renderer must not be able to emit
    one that breaks the spec: JPEG, under 8MB, ratio 0.80-1.91, width 320-1440, no alpha."""
    for site in settings.sites:
        card = images.render_card("Retail media takes a fifth of digital budgets this quarter",
                                  "Media", site, tmp_path / f"{site.key}.jpg", "portrait",
                                  standfirst="And the shift is still accelerating.")
        feed = images.instagram_asset(card, out_path=tmp_path / f"{site.key}-ig.jpg")
        with Image.open(feed) as im:
            ratio = im.width / im.height
            assert im.format == "JPEG", site.key
            assert im.mode == "RGB", f"{site.key} carries an alpha channel or a non-sRGB mode"
            assert 0.80 <= round(ratio, 4) <= 1.91, f"{site.key} ratio {ratio}"
            assert 320 <= im.width <= 1440, f"{site.key} width {im.width}"
        assert feed.stat().st_size < 8 * 1024 * 1024, site.key


def test_a_face_in_the_band_the_4_5_crop_removes_sends_the_card_the_other_way(site, tmp_path, monkeypatch):
    """The master can look fine while the asset Instagram actually gets is a decapitation."""
    _fake_photo_fetch(monkeypatch, size=(1600, 900))
    monkeypatch.setattr(images, "_detect_faces", lambda img: [(700, 0, 900, 120)])   # head at the top edge
    card = images.render_card("A headline", "Section", site, tmp_path / "top.jpg", "portrait",
                              backdrop_url="https://x/p.jpg")
    with Image.open(card) as im:
        band = im.crop((0, 0, im.width, int(images.PORTRAIT_BLEED * images.CARD_SCALE)))
        assert not any(g > 150 and r < 80 and b < 80 for r, g, b in band.convert("RGB").getdata())


def test_an_unknown_instagram_ratio_does_not_silently_square_crop_the_card(site, tmp_path):
    card = images.render_card("A headline", "Section", site, tmp_path / "r.jpg", "portrait")
    for ratio in ("4:5", "nonsense", ""):
        out = images.instagram_asset(card, ratio=ratio, out_path=tmp_path / f"{ratio or 'blank'}.jpg")
        with Image.open(out) as im:
            assert round(im.width / im.height, 3) == 0.8, f"{ratio!r} produced {im.size}"
    assert images.instagram_asset(card, ratio="3:4") == card


def test_a_headline_of_any_length_renders_promptly(site, tmp_path):
    """The balanced wrap is cubic; without a cap a long field stalls the whole run."""
    import time as _time
    started = _time.monotonic()
    images.render_card("A headline of quite absurd length " * 30, "Section", site,
                       tmp_path / "slow.jpg", "portrait")
    assert _time.monotonic() - started < 5.0
