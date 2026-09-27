"""A house rule for every image the system makes, for the website and every social channel: type never
sits on a face. Each renderer that sets type over a photograph keeps the faces out of the type's band,
moves the type, or stands the type-only card in; and a film's frame is chosen for the room it leaves."""
from pathlib import Path

from PIL import Image, ImageDraw

from autopub import images, poster


def _photo(size, face):
    im = Image.new("RGB", size, (110, 90, 70))
    if face:
        ImageDraw.Draw(im).ellipse(face, fill=(214, 172, 140))
    return im


def _white(path: Path, box: tuple[float, float, float, float]) -> int:
    with Image.open(path) as im:
        w, h = im.size
        band = im.crop((int(w * box[0]), int(h * box[1]), int(w * box[2]), int(h * box[3]))).convert("RGB")
        return sum(1 for px in band.resize((max(1, band.width // 4), max(1, band.height // 4))).getdata() if min(px) > 232)


def test_a_card_sites_cover_keeps_faces_above_the_headline_or_uses_the_type_card(monkeypatch, settings, tmp_path):
    site = settings.site("SCREENSTAT")
    covers = []
    real = images._render_photo_cover
    monkeypatch.setattr(images, "_render_photo_cover", lambda *a, **k: (covers.append(a[-1]), real(*a, **k))[1])
    # a face low in a tall photo: the crop lifts it above the headline's band
    monkeypatch.setattr(images, "_download_photo", lambda url, timeout: _photo((1200, 2400), (400, 1700, 800, 2100)))
    monkeypatch.setattr(images, "_detect_faces", lambda img: [(400, 1700, 800, 2100)])
    images._LAST_PHOTO = None
    images.render_card("A headline over a photograph", "News", site, tmp_path / "a.jpg", "landscape", backdrop_url="https://x/a.jpg")
    assert covers and covers[-1][3] <= 630 * 0.60, "the face sits above the headline's band"
    # a face filling the bottom of a wide photo, nowhere to move it: the type-only card stands in
    covers.clear()
    monkeypatch.setattr(images, "_download_photo", lambda url, timeout: _photo((1200, 630), (100, 200, 1100, 620)))
    monkeypatch.setattr(images, "_detect_faces", lambda img: [(100, 200, 1100, 620)])
    images._LAST_PHOTO = None
    out = images.render_card("A headline over a photograph", "News", site, tmp_path / "b.jpg", "landscape", backdrop_url="https://x/b.jpg")
    assert not covers and out.exists()


def test_the_poster_card_of_a_card_site_is_skipped_when_a_face_sits_under_its_type(monkeypatch, settings, tmp_path):
    from autopub.cards import CardBrief
    site = settings.site("SCREENSTAT")
    S = lambda v: int(v * images.CARD_SCALE)
    monkeypatch.setattr(images, "_download_photo", lambda url, timeout: _photo((1600, 1600), (300, 900, 1300, 1550)))
    monkeypatch.setattr(images, "_detect_faces", lambda img: [(300, 900, 1300, 1550)])
    images._LAST_PHOTO = None
    brief = CardBrief(kind="poster", headline="A headline", kicker="News", standfirst=None)
    primary, accent, text = images.hex_to_rgb(site.brand.primary), images.hex_to_rgb(site.brand.accent), images.hex_to_rgb(site.brand.text)
    assert images._render_poster(brief, site, tmp_path / "p.jpg", primary, accent, text, "https://x/p.jpg", S) is None
    monkeypatch.setattr(images, "_download_photo", lambda url, timeout: _photo((1600, 1600), (600, 100, 1000, 500)))
    monkeypatch.setattr(images, "_detect_faces", lambda img: [(600, 100, 1000, 500)])
    images._LAST_PHOTO = None
    assert images._render_poster(brief, site, tmp_path / "q.jpg", primary, accent, text, "https://x/q.jpg", S) is not None


def test_a_poster_slide_moves_its_text_below_a_face_in_the_upper_frame(monkeypatch, settings, tmp_path):
    site = settings.site("FILMYBUFF")
    monkeypatch.setattr(images, "_download_photo", lambda url, timeout: _photo((1200, 1600), (200, 100, 1000, 800)))
    monkeypatch.setattr(images, "_detect_faces", lambda img: [(200, 100, 1000, 800)])
    images._LAST_PHOTO = None
    low = poster.slide("The Lunchbox", "A tiffin goes to the wrong desk and two lonely people start writing to each other. " * 2, 2, 6, site, tmp_path / "s.jpg", photo_url="https://x/s.jpg")
    monkeypatch.setattr(images, "_detect_faces", lambda img: [])
    images._LAST_PHOTO = None
    high = poster.slide("The Lunchbox", "A tiffin goes to the wrong desk and two lonely people start writing to each other. " * 2, 2, 6, site, tmp_path / "t.jpg", photo_url="https://x/t.jpg")
    assert _white(high, (0, 0.12, 1, 0.45)) > 100, "no face: the slide's text sits high"
    assert _white(low, (0, 0.12, 1, 0.45)) < 20, "a face there: the text has moved"
    assert _white(low, (0, 0.5, 1, 0.9)) > 100


def test_the_frame_with_the_most_room_for_type_is_chosen(monkeypatch):
    frames = {"https://t/a.jpg": _photo((1920, 1080), (300, 100, 1600, 1000)),    # a close-up, faces everywhere
              "https://t/b.jpg": _photo((1920, 1080), (1300, 500, 1600, 900)),    # a figure low and to the right
              "https://t/c.jpg": _photo((1920, 1080), None)}                       # an empty street
    faces = {"https://t/a.jpg": [(300, 100, 1600, 1000)], "https://t/b.jpg": [(1300, 500, 1600, 900)], "https://t/c.jpg": []}
    monkeypatch.setattr(images, "_source_photo", lambda url, timeout: (frames[url], faces[url]))
    assert poster.room_for_type("https://t/c.jpg") == 1.0
    assert poster.room_for_type("https://t/b.jpg") > poster.room_for_type("https://t/a.jpg")
    assert poster.pick_frame(["https://t/a.jpg", "https://t/b.jpg", "https://t/c.jpg"]) == "https://t/c.jpg"
    assert poster.pick_frame(["https://t/b.jpg", "https://t/a.jpg"]) == "https://t/b.jpg"
    assert poster.pick_frame([]) is None
