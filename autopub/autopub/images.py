"""Generate cover / share images.

Two shapes per story:
  landscape 1200x630 - the WordPress featured image and the OG/Twitter/FB/LinkedIn card
  square    1080x1080 - Instagram / Threads / Pinterest

When the source article has a photo it is used as the actual cover: sharp, cover-fitted, with the
site's real logo on a plate in the corner. The landscape cover carries no headline (the title sits
next to it on the page and in link previews); the square adds the headline over a soft bottom
gradient because Instagram shows no title. Without a photo we fall back to a branded gradient card.
Photos are cropped around the people in them: faces are detected (OpenCV Haar cascades) and the crop
window is placed so every face stays inside it with headroom; without faces, the crop follows the
most detailed region of the picture. The kicker and logo plate go on whichever side covers the
least face. Every output is a progressive, optimised JPEG.
"""
from __future__ import annotations

import io
import logging
import re
import time
from pathlib import Path

import requests
from PIL import Image, ImageChops, ImageDraw, ImageFilter

try:  # face-aware cropping; the gradient/saliency path below works without it
    import cv2  # type: ignore
    import numpy as np
    try:
        cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)   # its DNN backend chatter is not ours to log
    except AttributeError:  # pragma: no cover
        pass
except ImportError:  # pragma: no cover
    cv2 = None  # type: ignore
    np = None  # type: ignore

from .cards import HEADLINE, INVERSE, POSTER, CardBrief
from .config import Site
from .sources import USER_AGENT
from .typography import BOLD, REGULAR
from .typography import load as load_font

log = logging.getLogger(__name__)

SIZES = {"landscape": (1200, 630), "square": (1080, 1080), "portrait": (1080, 1440)}
IG_FEED_HEIGHT = 1350   # 4:5 at 1080 wide: the tallest single image Instagram's API will accept
# what `instagram_ratio` may say, and the width/height it means. None = post the 3:4 master whole.
IG_RATIOS = {"3:4": None, "4:5": 0.8, "1:1": 1.0}
PORTRAIT_BLEED = (SIZES["portrait"][1] - IG_FEED_HEIGHT) // 2   # the 45px band a 4:5 crop takes off each end
JPEG_QUALITY = 82          # visually lossless for photos at these sizes, ~35% smaller than q88
MAX_BACKDROP_BYTES = 15 * 1024 * 1024


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _font(size: int, bold: bool = True, family: str | None = None, weight: int | None = None):
    """The site's own typeface where it ships one (see typography.py), DejaVu otherwise."""
    return load_font(family, size, weight or (BOLD if bold else REGULAR))


def _has_glyph(font, char: str) -> bool:
    """Whether `font` draws `char` as itself rather than as the .notdef box.

    Two of the four brand faces have no rupee sign, and Pillow draws a missing glyph as a hollow
    box without complaint. Comparing the rendered mask with the mask of a codepoint no font
    covers tells the two apart without needing the font's tables.
    """
    try:
        drawn, notdef = font.getmask(char), font.getmask("\ue000")   # U+E000: private use, mapped by none of these faces
        return (drawn.size, bytes(drawn)) != (notdef.size, bytes(notdef))
    except Exception:  # noqa: BLE001 - a face that cannot even render the probe gets the fallback
        return False


def _figure_font(text: str, size: int, family: str | None, weight: int):
    """The brand face for a figure, unless it lacks a glyph the figure needs (usually the rupee sign),
    in which case the fleet's fallback face draws the whole figure so it does not switch mid-word."""
    font = _font(size, bold=True, family=family, weight=weight)
    if family and not all(_has_glyph(font, ch) for ch in set(text) if not ch.isspace()):
        return _font(size, bold=True, family=None, weight=weight)
    return font


def _spell_out(text: str, family: str | None) -> str:
    """Running text keeps the brand face; a rupee sign it cannot draw becomes 'Rs'."""
    if "\u20b9" in text and family and not _has_glyph(_font(40, bold=True, family=family), "\u20b9"):
        return text.replace("\u20b9", "Rs ").replace("Rs  ", "Rs ")
    return text


def _gradient(size: tuple[int, int], start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    w, h = size
    base = Image.new("RGB", (1, h))
    px = base.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        px[0, y] = tuple(int(start[i] + (end[i] - start[i]) * t) for i in range(3))
    return base.resize((w, h))


def _darken(rgb: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    return tuple(max(0, int(c * factor)) for c in rgb)  # type: ignore[return-value]


def _luma(rgb: tuple[int, int, int]) -> float:
    r, g, b = rgb[:3]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _relative_luminance(rgb: tuple[int, int, int]) -> float:
    def channel(c: float) -> float:
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(c) for c in rgb[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = _relative_luminance(a), _relative_luminance(b)
    lo, hi = sorted((la, lb))
    return (hi + 0.05) / (lo + 0.05)


def _ink_on(background: tuple[int, int, int], dark: tuple[int, int, int] = (12, 12, 12),
            light: tuple[int, int, int] = (255, 255, 255)) -> tuple[int, int, int]:
    """Whichever of near-black and white is actually readable on this colour.

    The fleet's accents run from a hot pink that needs black type to a bronze that needs white;
    picking one and hard-coding it leaves half the sites with a kicker nobody can read.
    """
    return dark if contrast_ratio(background, dark) >= contrast_ratio(background, light) else light


def _split_long_word(draw: ImageDraw.ImageDraw, word: str, font, max_width: float) -> list[str]:
    """Break a word too wide for the column. German compounds and URLs do this; without it the
    glyphs simply run off the card."""
    parts, current = [], ""
    for char in word:
        if draw.textlength(current + char, font=font) > max_width and current:
            parts.append(current)
            current = char
        else:
            current += char
    if current:
        parts.append(current)
    return parts


def _fit_words(draw: ImageDraw.ImageDraw, words: list[str], font, max_width: float) -> list[str]:
    out = []
    for word in words:
        out.extend(_split_long_word(draw, word, font, max_width) if draw.textlength(word, font=font) > max_width
                   else [word])
    return out


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    words = _fit_words(draw, text.split(), font, max_width)
    lines: list[str] = []
    cur = ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def _fit_headline(draw, text: str, max_width: int, max_height: int, start: int, minimum: int = 34,
                  family: str | None = None):
    size = start
    while size >= minimum:
        font = _font(size, bold=True, family=family)
        lines = _wrap(draw, text, font, max_width)
        line_h = int(size * 1.18)
        if len(lines) * line_h <= max_height and all(draw.textlength(l, font=font) <= max_width for l in lines):
            return font, lines, line_h
        size -= 4
    font = _font(minimum, bold=True, family=family)
    lines = _wrap(draw, text, font, max_width)
    return font, lines[:6], int(minimum * 1.18)


Box = tuple[int, int, int, int]   # left, top, right, bottom


YUNET_MODEL = Path(__file__).parent / "models" / "face_detection_yunet_2023mar.onnx"   # Apache-2.0, opencv_zoo


def _detect_faces(img: Image.Image) -> list[Box]:
    """Face boxes in image coordinates. YuNet (OpenCV DNN) when its model ships, Haar cascades when
    the OpenCV build carries them, [] otherwise - callers then fall back to the salient region."""
    if cv2 is None:
        return []
    scale = min(1.0, 960 / max(img.width, img.height))
    small = img if scale == 1.0 else img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.BILINEAR)
    bgr = cv2.cvtColor(np.asarray(small.convert("RGB")), cv2.COLOR_RGB2BGR)
    sw, sh = small.size
    min_side = max(16, int(min(sw, sh) * 0.05))   # a face under 5% of the frame is a bystander, not the subject
    found: list[Box] = []
    if YUNET_MODEL.exists() and hasattr(cv2, "FaceDetectorYN"):
        try:
            det = cv2.FaceDetectorYN.create(str(YUNET_MODEL), "", (sw, sh), score_threshold=0.7, nms_threshold=0.3, top_k=50)
            _, faces = det.detect(bgr)
            for f in (faces if faces is not None else []):
                x, y, fw, fh = (float(v) for v in f[:4])
                if min(fw, fh) >= min_side:
                    found.append((int(x / scale), int(y / scale), int((x + fw) / scale), int((y + fh) / scale)))
        except cv2.error as exc:  # pragma: no cover - model/runtime mismatch: degrade, never fail the cover
            log.debug("yunet failed: %s", exc)
    if not found:
        gray = cv2.equalizeHist(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY))
        for name in ("haarcascade_frontalface_default.xml", "haarcascade_profileface.xml"):
            path = Path(getattr(cv2.data, "haarcascades", "")) / name
            if not path.exists():
                continue
            clf = cv2.CascadeClassifier(str(path))
            for (x, y, fw, fh) in clf.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=6, minSize=(min_side, min_side)):
                found.append((int(x / scale), int(y / scale), int((x + fw) / scale), int((y + fh) / scale)))
    # merge boxes that overlap heavily (two detectors firing on one head)
    merged: list[Box] = []
    for b in sorted(found, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True):
        for i, m in enumerate(merged):
            ix = max(0, min(b[2], m[2]) - max(b[0], m[0])); iy = max(0, min(b[3], m[3]) - max(b[1], m[1]))
            if ix * iy > 0.4 * (b[2] - b[0]) * (b[3] - b[1]):
                merged[i] = (min(b[0], m[0]), min(b[1], m[1]), max(b[2], m[2]), max(b[3], m[3]))
                break
        else:
            merged.append(b)
    return merged


def _union(boxes: list[Box]) -> Box:
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def _salient_box(img: Image.Image) -> Box:
    """No faces: the busiest part of the picture (edge energy), leaning to the upper half where subjects sit."""
    g = img.convert("L")
    g.thumbnail((240, 240))
    edges = g.filter(ImageFilter.FIND_EDGES)
    w, h = edges.size
    px = edges.load()
    best, best_score = (0, 0, w, h), -1.0
    win_w, win_h = max(1, w // 2), max(1, h // 2)
    step = max(1, min(w, h) // 12)
    for top in range(0, h - win_h + 1, step):
        for left in range(0, w - win_w + 1, step):
            score = 0.0
            for y in range(top, top + win_h, 2):
                for x in range(left, left + win_w, 2):
                    score += px[x, y]
            score *= 1.0 + 0.25 * (1 - (top + win_h / 2) / h)   # mild upward bias
            if score > best_score:
                best, best_score = (left, top, left + win_w, top + win_h), score
    sx, sy = img.width / w, img.height / h
    return (int(best[0] * sx), int(best[1] * sy), int(best[2] * sx), int(best[3] * sy))


def _cover_fit(img: Image.Image, size: tuple[int, int], focus: Box | None = None,
               clear_bottom: float = 0.0) -> tuple[Image.Image, Box | None]:
    """Scale to cover `size`, then choose the crop window around `focus` (faces, else the salient region).

    The window is placed so the whole focus box fits with breathing room above it, and, when
    `clear_bottom` is set, so the box stays out of the bottom fraction that text will cover.
    Returns the crop and the focus box translated into crop coordinates (None if no focus).
    """
    w, h = size
    scale = max(w / img.width, h / img.height)
    rw, rh = int(img.width * scale) + 1, int(img.height * scale) + 1
    img = img.resize((rw, rh), Image.LANCZOS)
    if focus is None:
        left, top = (rw - w) // 2, (rh - h) // 2
        return img.crop((left, top, left + w, top + h)), None
    fl, ft, fr, fb = (int(v * scale) for v in focus)
    fcx, fcy = (fl + fr) / 2, (ft + fb) / 2
    # start centred on the focus, then pull the window so the box is inside it with margins
    left = fcx - w / 2
    top = fcy - h * (0.42 if clear_bottom else 0.5)           # sit faces a little above centre
    pad_x, pad_top = w * 0.06, h * 0.10
    left = min(left, fl - pad_x); left = max(left, fr + pad_x - w)
    top = min(top, ft - pad_top)
    bottom_limit = h * (1 - clear_bottom) if clear_bottom else h
    top = max(top, fb - bottom_limit)                          # keep the box above the text zone
    left = max(0, min(left, rw - w)); top = max(0, min(top, rh - h))
    left, top = int(left), int(top)
    crop = img.crop((left, top, left + w, top + h))
    return crop, (fl - left, ft - top, fr - left, fb - top)


# render_set draws three cards from one article photo. Fetching and running face detection once
# per card meant three downloads and three YuNet passes over the same pixels; one slot is enough
# because the three calls happen back to back for the same URL.
_LAST_PHOTO: tuple[str, Image.Image, list[Box]] | None = None


def _source_photo(url: str, timeout: int) -> tuple[Image.Image, list[Box]] | None:
    """The decoded article photo and the faces in it, downloaded and detected at most once."""
    global _LAST_PHOTO
    if _LAST_PHOTO and _LAST_PHOTO[0] == url:
        return _LAST_PHOTO[1], _LAST_PHOTO[2]
    got = _download_photo(url, timeout)
    if got is None:
        return None
    faces = _detect_faces(got)
    _LAST_PHOTO = (url, got, faces)
    return got, faces


def _download_photo(url: str, timeout: int) -> Image.Image | None:
    try:
        resp = requests.get(url, timeout=timeout, headers={"User-Agent": USER_AGENT, "Accept": "image/*,*/*"}, stream=True)
        resp.raise_for_status()
        buf = io.BytesIO()
        for chunk in resp.iter_content(64 * 1024):
            buf.write(chunk)
            if buf.tell() > MAX_BACKDROP_BYTES:
                raise ValueError("image too large")
        img = Image.open(buf)
        img.load()
        img = img.convert("RGB")
    except Exception as exc:  # noqa: BLE001
        log.debug("backdrop fetch failed %s: %s", url, exc)
        return None
    if img.width < 400 or img.height < 250:   # icons / tracking pixels are not covers
        log.debug("backdrop too small %sx%s: %s", img.width, img.height, url)
        return None
    return img


def _backdrop(url: str, size: tuple[int, int], timeout: int = 20,
              clear_bottom: float = 0.0) -> tuple[Image.Image, Box | None] | None:
    """The article's own photo, cover-fitted around its people. None when it cannot be used."""
    got = _source_photo(url, timeout)
    if got is None:
        return None
    img, faces = got
    focus = _union(faces) if faces else _salient_box(img)
    crop, focus_in_crop = _cover_fit(img, size, focus, clear_bottom)
    return crop, (focus_in_crop if faces else None)


def _overlay_sides(faces: Box | None, w: int, h: int) -> tuple[str, str]:
    """(kicker side, plate side): each goes to the side of its band that holds less face."""
    if faces is None:
        return "left", "left"
    fl, ft, fr, fb = faces

    def overlap(x0, y0, x1, y1):
        return max(0, min(fr, x1) - max(fl, x0)) * max(0, min(fb, y1) - max(ft, y0))

    # the bands the overlays actually occupy: kicker in the top ~quarter, plate in the bottom ~30%
    kicker = "right" if overlap(0, 0, w * 0.5, h * 0.25) > overlap(w * 0.5, 0, w, h * 0.25) else "left"
    plate = "right" if overlap(0, h * 0.70, w * 0.55, h) > overlap(w * 0.45, h * 0.70, w, h) else "left"
    return kicker, plate


def _shade_bottom(img: Image.Image, start_frac: float, strength: float) -> None:
    """Darken the bottom of the image with a smooth vertical gradient (for text legibility)."""
    w, h = img.size
    y0 = int(h * start_frac)
    if y0 >= h:
        return
    band = Image.new("L", (1, h - y0))
    px = band.load()
    for i in range(h - y0):
        t = i / max(h - y0 - 1, 1)
        px[0, i] = int(255 * strength * (t * t * (3 - 2 * t)))  # smoothstep
    mask = band.resize((w, h - y0))
    black = Image.new("RGB", (w, h - y0), (0, 0, 0))
    img.paste(black, (0, y0), mask)


def _trim_logo(logo: Image.Image, background: tuple[int, int, int] | None) -> Image.Image:
    """Crop the dead margin a logo PNG was exported with.

    The four marks in this fleet carry between 0 and 50px of empty border each, so pasting them
    at a fixed height makes some look half the size of others. Cropping to the artwork first
    means "60px tall" means the same thing on every card.
    """
    if background is None:
        bbox = logo.getbbox()          # transparent export: alpha already describes the artwork
    else:
        flat = Image.new("RGB", logo.size, background)
        bbox = ImageChops.difference(logo.convert("RGB"), flat).convert("L").point(lambda v: 255 if v > 12 else 0).getbbox()
    return logo.crop(bbox) if bbox else logo


def _load_logo(logo_path: str) -> tuple[Image.Image, tuple[int, int, int] | None]:
    """Return the logo as RGBA and the plate colour it was designed to sit on (None = transparent)."""
    logo = Image.open(logo_path).convert("RGBA")
    corner = logo.getpixel((1, 1))
    plate = None if corner[3] < 128 else corner[:3]   # transparent logo: it sits on whatever plate we choose
    return _trim_logo(logo, plate), plate


def _paste_logo_plate(img: Image.Image, logo_path: str, domain: str, primary: tuple[int, int, int],
                      side: str = "left", family: str | None = None) -> None:
    """Bottom plate carrying the real brand PNG, so the mark reads over any photo; left unless a face is there."""
    logo, plate_color = _load_logo(logo_path)
    if plate_color is None:
        plate_color = primary
    w, h = img.size
    margin = int(w * 0.05)
    logo_h = int(h * (0.10 if h >= w else 0.085))
    max_logo_w = int(w * 0.42)
    logo_w = int(logo.width * (logo_h / logo.height))
    if logo_w > max_logo_w:
        logo_w = max_logo_w
        logo_h = int(logo.height * (logo_w / logo.width))
    logo = logo.resize((logo_w, logo_h), Image.LANCZOS)
    pad = int(logo_h * 0.28)
    font = _font(max(14, int(logo_h * 0.40)), bold=False, family=family)
    draw = ImageDraw.Draw(img)
    domain_w = int(draw.textlength(domain, font=font))
    plate_w = logo_w + pad * 3 + domain_w
    plate_h = logo_h + pad * 2
    x0, y0 = (margin if side == "left" else w - margin - plate_w), h - margin - plate_h
    draw.rectangle([x0, y0, x0 + plate_w, y0 + plate_h], fill=plate_color)
    img.paste(logo, (x0 + pad, y0 + pad), logo)
    # domain text must contrast with the plate whatever its colour (cream plates -> ink text, ink plates -> cream text)
    if _luma(plate_color) > 128:
        text_color = tuple(int(c * 0.55) for c in plate_color)
    else:
        text_color = tuple(int(c + (235 - c) * 0.9) for c in plate_color)
    draw.text((x0 + pad * 2 + logo_w, y0 + (plate_h - font.size) // 2 - 2), domain, font=font, fill=text_color)


def _draw_footer(img: Image.Image, site: Site, primary, text_color, footer_h: int, margin: int, side: str = "left") -> None:
    family = site.brand.font
    if site.brand.logo:
        _paste_logo_plate(img, site.brand.logo, site.domain, primary, side, family)
        return
    w, h = img.size
    draw = ImageDraw.Draw(img, "RGBA")
    nfont = _font(int(w * 0.028), bold=True, family=family)
    dfont = _font(int(w * 0.02), bold=False, family=family)
    fy = h - footer_h + int(h * 0.02)
    draw.text((margin, fy), site.name, font=nfont, fill=text_color)
    draw.text((margin, fy + nfont.size + 6), site.domain, font=dfont, fill=(*text_color, 200))


def _draw_kicker(draw: ImageDraw.ImageDraw, kicker: str, x: int, y: int, w: int, accent, primary, side: str = "left",
                 family: str | None = None) -> int:
    kicker = kicker.strip().upper()[:28]
    kfont = _font(int(w * 0.022), bold=True, family=family)
    kw = draw.textlength(kicker, font=kfont)
    pad = int(w * 0.012)
    if side == "right":
        x = w - x - int(kw) - pad * 2   # mirror: `x` is the margin
    draw.rounded_rectangle([x, y, x + kw + pad * 2, y + kfont.size + pad * 2], radius=8, fill=accent)
    draw.text((x + pad, y + pad), kicker, font=kfont, fill=_ink_on(accent))
    return kfont.size + pad * 2


def _save(img: Image.Image, out_path: Path, quality: int = JPEG_QUALITY) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out_path, "JPEG", quality=quality, optimize=True, progressive=True)
    return out_path


# ---- the Instagram news card ------------------------------------------------------------------
#
# One template, drawn the same way every time, because grid recognition comes from geometry that
# never moves rather than from a masthead nobody can read at thumbnail size. Coordinates below are
# in a 1080x1440 design space and multiplied by CARD_SCALE on the way to the canvas, so the file
# ships at 1440x1920: Instagram upscales a 1080-wide image on a 3x phone and the type goes soft.

CARD_SCALE = 4 / 3
CARD_W, CARD_H = 1080, 1440
PHOTO_H = 780            # full-bleed photo, then a solid brand panel under it
SIDE = 64                # content column: 952px, which also clears the Explore 2:3 side crop
# footer baseline anchor; everything above grows upward from here. Set so that the 4:5 asset the
# API actually posts still carries a bottom margin close to the 64px at its sides.
FOOT_BOTTOM = 1332
CREDIT_SIZE = 28         # the floor for legible type in the feed: below this it is gone
KICKER_SIZE = 28         # same floor - a kicker set as a fraction of the width fell under it
RAIL_H = 12              # the section rule; at 6px it renders sub-pixel in a profile thumbnail
PHOTO_MIN = (800, 500)   # below this the photo is a thumbnail and blowing it up shows

# headline ladder: discrete steps keyed to length. Continuously autosizing every headline gives a
# different size on every card, which across a grid reads as broken rather than responsive.
# (max chars, size, line height, max lines). The panel under a photo has 346px of vertical budget,
# so four lines at 86 is the floor: a fifth line would run through the footer rule. A headline too
# long for the ladder spends the photograph instead of the type size - see the routing below.
HEADLINE_LADDER = [(36, 104, 110, 2), (62, 92, 99, 3), (88, 80, 86, 4)]
# a card with no photo is a different template with twice the room, so it gets its own ladder
# rather than a headline of ordinary size marooned in the middle of an empty panel
HEADLINE_LADDER_TEXT = [(36, 132, 140, 3), (62, 116, 124, 4), (88, 100, 108, 5), (140, 88, 96, 6),
                        (10 ** 6, 80, 88, 8)]

# a line may not end on one of these: it leaves the reader hanging mid-phrase
BALANCE_LIMIT = 40      # words: beyond this the balanced wrap costs more than it is worth
HEADLINE_LIMIT = 300    # characters: a headline longer than this is a bug upstream, not a card

DANGLERS = {"a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "by", "for", "from",
            "with", "as", "is", "are", "was", "were", "its", "it", "that", "this", "into", "over",
            "after", "before", "than", "per", "via",
            "rs", "\u20b9", "$", "\u00a3", "\u20ac", "usd", "inr"}   # never orphan a currency mark from its figure

SMART = ((" - ", " \u2013 "), ("--", "\u2014"), ("...", "\u2026"), ("  ", " "))
QUOTED = re.compile(r'"([^"]*)"')


def tidy(text: str) -> str:
    """Normalise CMS punctuation: straight quotes, hyphens for dashes and three dots all look
    machine-made on a card, and a ' | Publication' suffix is web furniture, not a headline."""
    text = " ".join((text or "").split())[:HEADLINE_LIMIT]
    text = re.split(r"\s+[|\u2013\u2014]\s+(?:[A-Z][\w&.'-]*\s?){1,4}$", text)[0] if text.count("|") else text
    for old, new in SMART:
        text = text.replace(old, new)
    # pairwise, or every opening quote on every card is drawn backwards
    text = QUOTED.sub("\u201c\\1\u201d", text).replace('"', "\u201d")
    return text.strip().strip("|").strip()


def _balanced_lines(draw, words: list[str], font, max_width: float, max_lines: int) -> list[str] | None:
    """Wrap into at most `max_lines`, evening out the line lengths and avoiding dangling words.

    Greedy wrapping packs line one full and leaves a stub at the end; a short dynamic program over
    the break points costs nothing at headline length and gives the balanced rag a subeditor would.
    """
    n = len(words)
    if n > BALANCE_LIMIT:      # the DP is cubic; past this a greedy wrap is the only sane answer
        lines = _wrap(draw, " ".join(words), font, max_width)
        return lines if len(lines) <= max_lines else None
    widths: dict[tuple[int, int], float] = {}

    def width_of(i: int, j: int) -> float:
        if (i, j) not in widths:
            widths[i, j] = draw.textlength(" ".join(words[i:j]), font=font)
        return widths[i, j]

    best: dict[tuple[int, int], tuple[float, list[int]]] = {}

    def solve(start: int, lines_left: int) -> tuple[float, list[int]]:
        if start == n:
            return (0.0, [])
        if lines_left == 0:
            return (float("inf"), [])
        key = (start, lines_left)
        if key in best:
            return best[key]
        answer = (float("inf"), [])
        for end in range(start + 1, n + 1):
            width = width_of(start, end)
            if width > max_width:
                break
            slack = (max_width - width) / max_width
            penalty = slack * slack
            if end < n and words[end - 1].lower().strip("\u201c\u201d,;:") in DANGLERS:
                penalty += 0.55                      # never break after "the", "of", "and"...
            if end == n and slack > 0.75 and lines_left > 1:
                penalty += 0.35                      # and never finish on a stub of a line
            rest_cost, rest = solve(end, lines_left - 1)
            if rest_cost + penalty < answer[0]:
                answer = (rest_cost + penalty, [end] + rest)
        best[key] = answer
        return answer

    cost, breaks = solve(0, max_lines)
    if cost == float("inf"):
        return None
    lines, prev = [], 0
    for cut in breaks:
        lines.append(" ".join(words[prev:cut]))
        prev = cut
    return lines


def _shorten(text: str, lines: int, draw, font, max_width: float) -> str:
    """Cut a standfirst to what will fit, at a sentence end if there is one and a word if not."""
    for sentence_end in (". ", "; "):
        head = text.split(sentence_end)[0]
        if head != text and len(_wrap(draw, head + ".", font, max_width)) <= lines:
            return head + "."
    words = text.split()
    while words:
        trial = " ".join(words).rstrip(",;:- ") + "\u2026"
        if len(_wrap(draw, trial, font, max_width)) <= lines:
            return trial
        words.pop()
    return text


def _headline_block(draw, headline: str, family: str | None, max_width: float, ladder=None, weight: int = 700):
    """Pick the ladder step this headline belongs on and wrap it there."""
    ladder = ladder or HEADLINE_LADDER
    for limit, size, line_h, max_lines in ladder:
        if len(headline) > limit:
            continue
        font = _font(int(size * CARD_SCALE), bold=True, family=family, weight=weight)
        lines = _balanced_lines(draw, _fit_words(draw, headline.split(), font, max_width), font, max_width, max_lines)
        if lines:
            return font, lines, int(line_h * CARD_SCALE)
    # nothing fits: keep the smallest step and let it run long rather than lose the card
    size, line_h, max_lines = ladder[-1][1:]
    font = _font(int(size * CARD_SCALE), bold=True, family=family, weight=weight)
    if headline:
        log.info("headline is longer than the card can set at full size; it will be trimmed: %r", headline[:80])
    words = _fit_words(draw, headline.split(), font, max_width)
    lines = _balanced_lines(draw, words, font, max_width, max_lines) or _wrap(draw, headline, font, max_width)
    return font, lines, int(line_h * CARD_SCALE)


def _tracked(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font, fill, track: float) -> float:
    """Draw text with letter-spacing, which Pillow has no notion of.

    Kickers are short, upper case and set wide on all four of these sites; without tracking they
    read as a generic chip. Advances are measured from the run so kerning pairs survive.
    """
    x, y = xy
    for i, char in enumerate(text):
        draw.text((x, y), char, font=font, fill=fill)
        advance = draw.textlength(text[:i + 1], font=font) - draw.textlength(text[:i], font=font)
        # the word space has to grow with the tracking or "AGENCY NEWS" reads as one word
        x += advance + track * (2.6 if char == " " else 1)
    return x - xy[0] - track


def _tracked_len(draw: ImageDraw.ImageDraw, text: str, font, track: float) -> float:
    return draw.textlength(text, font=font) + track * (max(0, len(text) - 1) + 1.6 * text.count(" "))


def _rail(img: Image.Image, site: Site, accent, y: int, scale) -> None:
    """The section rule under the photo: the one mark that still reads at thumbnail size.

    Each site expresses it in its own grammar, so a row of three cards in the profile grid is
    identifiable before any type is legible. Driven by brand.rail in sites.yaml.
    """
    draw = ImageDraw.Draw(img, "RGBA")
    w, h = img.width, scale(RAIL_H)
    style = (site.brand.rail or "solid").lower()
    if style == "double":                       # the ticker rule the Crazy4 site runs under its bars
        draw.rectangle([0, y, w, y + h], fill=accent)
        draw.rectangle([0, y + h + scale(8), w, y + h + scale(12)], fill=accent)
    elif style == "inset":                      # a typographic rule inside the column, not a band
        draw.rectangle([scale(SIDE), y, w - scale(SIDE), y + h], fill=accent)
    elif style == "bars":                       # ScreenStat is a numbers brand: the rule is a chart
        cols, gap = 6, scale(32)
        col_w = (w - scale(SIDE) * 2 - gap * (cols - 1)) / cols
        for i in range(cols):
            x = scale(SIDE) + i * (col_w + gap)
            draw.rectangle([x, y, x + col_w, y + h], fill=(*accent, 255 if i < 4 else 70))
    else:
        draw.rectangle([0, y, w, y + h], fill=accent)


def _card_logo(img: Image.Image, site: Site, primary, x: int, baseline: int, height: int,
               on_band: bool = False) -> int:
    """The masthead in the footer. Returns its width.

    `on_band` says the footer is already painted in the logo's own ground, so the mark needs no
    plate of its own - that is what turns the Junkies lockup from a sticker into a masthead.
    """
    if not site.brand.logo:
        font = _font(int(height * 1.05), bold=True, family=site.brand.font)
        draw = ImageDraw.Draw(img)
        draw.text((x, baseline - height), site.name, font=font, fill=hex_to_rgb(site.brand.text))
        return int(draw.textlength(site.name, font=font))
    logo, plate = _load_logo(site.brand.logo)
    if logo.width / logo.height < 2.2:
        height = int(height * 1.35)   # a near-square mark needs more height than a wide wordmark to read as its equal
    w = int(logo.width * (height / logo.height))
    logo = logo.resize((max(1, w), height), Image.LANCZOS)
    if plate and not on_band and contrast_ratio(plate, primary) > 1.6:
        # a mark drawn for a different ground keeps that ground rather than being knocked out,
        # which would leave dark artwork invisible on a dark panel
        pad = int(height * 0.34)
        ImageDraw.Draw(img).rectangle([x - pad, baseline - height - pad, x + w + pad, baseline + pad], fill=plate)
    img.paste(logo, (x, baseline - height), logo)
    return w


def _card_kicker(img: Image.Image, kicker: str, site: Site, accent, x: int, y: int, scale) -> None:
    """Section label: a tracked, upper-case chip in the brand accent, square-cornered."""
    draw = ImageDraw.Draw(img)
    text = (kicker or "").strip().upper()[:24]
    font = _font(scale(KICKER_SIZE), bold=True, family=site.brand.font)
    track = scale(KICKER_SIZE) * 0.08
    pad_x, pad_y = scale(16), scale(10)
    width = _tracked_len(draw, text, font, track)
    draw.rectangle([x, y, x + width + pad_x * 2, y + font.size + pad_y * 2], fill=accent)
    _tracked(draw, (x + pad_x, y + pad_y), text, font, _ink_on(accent), track)


def _card_footer(img: Image.Image, site: Site, primary, text_color, scale) -> int:
    """Masthead, domain and date, anchored to the bottom so every card in the grid shares it.

    A mark drawn for its own ground (the cream Junkies lockup) turns the whole footer into that
    ground rather than sitting on the panel as a stray sticker.
    """
    w = img.width
    baseline, logo_h = scale(FOOT_BOTTOM), scale(56)
    plate = None
    if site.brand.logo:
        try:
            _logo, plate = _load_logo(site.brand.logo)
        except OSError:
            plate = None
    band_top = baseline - logo_h - scale(36)
    draw = ImageDraw.Draw(img, "RGBA")
    if plate and contrast_ratio(plate, primary) > 1.6:
        draw.rectangle([0, band_top, w, img.height], fill=plate)
        ink = _ink_on(plate)
        meta_colour = tuple(int(c * 0.75 + p * 0.25) for c, p in zip(ink, plate))
    else:
        draw.rectangle([scale(SIDE), band_top, w - scale(SIDE), band_top + max(2, scale(2))],
                       fill=(*text_color, 60))
        meta_colour = tuple(int(c * 0.72) for c in text_color)
    _card_logo(img, site, primary, scale(SIDE), baseline, logo_h, on_band=plate is not None)
    font = _font(scale(CREDIT_SIZE), bold=False, family=site.brand.font)
    meta = f"{site.domain}   {time.strftime('%d %b %Y')}"
    draw.text((w - scale(SIDE) - draw.textlength(meta, font=font), baseline - font.size), meta,
              font=font, fill=meta_colour)
    return band_top


def _render_portrait(headline: str, kicker: str, standfirst: str | None, site: Site, out_path: Path,
                     primary, accent, text_color, backdrop_url: str | None, credit: str | None = None,
                     date_text: str | None = None, card: CardBrief | None = None) -> Path:
    """The 3:4 card Instagram posts: photo above, brand panel below, footer anchored to the bottom.

    Nothing that matters is drawn in the top or bottom `PORTRAIT_BLEED` band, so the 4:5 asset the
    API actually accepts (see instagram_asset) is a straight centre crop with nothing lost.

    Two routes, not two dozen templates. With a usable photo and a headline the ladder can hold, the
    photo runs full bleed across the top and the type sits in the panel under it. Otherwise the type
    takes the whole card and the photo, if there is one, stays as a veiled ground. A headline too
    long for the panel spends the photograph; it never spends the type size, because a headline two
    steps smaller than its neighbours is the loudest sign a machine made the card.
    """
    def S(v: float) -> int:
        return int(round(v * CARD_SCALE))

    if card is not None and card.kind == POSTER:
        done = _render_poster(card, site, out_path, primary, accent, text_color, backdrop_url, S)
        if done is not None:
            return done
        card = None     # no usable photo after all: the headline card is the honest fallback
    if card is not None and card.kind == INVERSE:
        return _render_inverse(card, site, out_path, primary, accent, text_color, S)
    if card is not None and card.kind != HEADLINE:
        return _render_format(card, site, out_path, primary, accent, text_color, backdrop_url, S)

    w, h = S(CARD_W), S(CARD_H)
    family = site.brand.font
    headline, standfirst = _spell_out(tidy(headline), family), _spell_out(tidy(standfirst or ""), family) or None
    if not headline:                       # nothing to set: the standfirst becomes the headline
        headline, standfirst = standfirst or site.name, None
    img = Image.new("RGB", (w, h), primary)

    photo = None
    if backdrop_url:
        source = _source_photo(backdrop_url, 20)
        if source and source[0].width >= PHOTO_MIN[0] and source[0].height >= PHOTO_MIN[1]:
            got = _backdrop(backdrop_url, (w, S(PHOTO_H)))
            if got:
                photo, faces = got
                # the posted asset is a 4:5 crop of this card, so a face inside the band that crop
                # removes is beheaded on Instagram even though the master looks right here. No crop
                # of a photo whose subject touches its top edge can add headroom, so the card takes
                # the other route rather than publishing a decapitation.
                if faces and faces[1] < S(PORTRAIT_BLEED) + S(8):
                    log.info("a face sits in the band the 4:5 crop removes; using the type card instead")
                    photo = None
        elif source:
            log.info("photo %sx%s is smaller than the card aperture; using the type card instead",
                     source[0].width, source[0].height)
    column = w - S(SIDE) * 2
    kick_h = S(KICKER_SIZE) + S(20) * 2
    bottom_limit = S(FOOT_BOTTOM) - S(56) - S(36) - S(40)
    measure = ImageDraw.Draw(img)

    def lay_out(ladder, top_limit, roomy):
        """Choose a ladder step and wrap the type. Returns the block and whether it fits."""
        for attempt in range(len(ladder)):
            font, lines, line_h = _headline_block(measure, headline, family, column, ladder[attempt:],
                                                  weight=site.brand.heading_weight)
            slines: list[str] = []
            if standfirst:
                # the budget only stretches to a standfirst behind a short headline
                room = {1: 2, 2: 2}.get(len(lines), 2 if roomy and len(lines) <= 4 else 0)
                if room:
                    sfont = _font(S(36), bold=False, family=family)
                    slines = _wrap(measure, standfirst, sfont, column)
                    if len(slines) > room:
                        slines = _wrap(measure, _shorten(standfirst, room, measure, sfont, column),
                                       sfont, column)[:room]
            block_h = len(lines) * line_h + (S(20) + len(slines) * S(50) if slines else 0)
            fits = top_limit + kick_h + block_h <= bottom_limit
            if fits:
                break
        return font, lines, line_h, slines, block_h, fits

    on_photo = False
    if photo is not None:
        top_photo = S(PHOTO_H) + S(RAIL_H) + S(56)
        block = lay_out(HEADLINE_LADDER, top_photo, roomy=False)
        on_photo = block[5]
        if not on_photo:
            # the panel under a photo has a third of the room the type card has: rather than cut the
            # headline to fit beside the picture, spend the picture and set the headline in full
            log.info("headline does not fit beside a photo; using the type card so it can be read whole")

    if on_photo:
        img.paste(photo.filter(ImageFilter.UnsharpMask(radius=1.2, percent=45, threshold=3)), (0, 0))
        photo_bottom = S(PHOTO_H)
        _shade_bottom(img.crop((0, photo_bottom - S(24), w, photo_bottom)), 0.0, 0.18)
        if credit:
            # a soft gradient across the foot of the photo, not a slab: a hard-edged chip cuts a
            # rectangle out of the picture and is the clearest tell of a generated card
            band_h = S(180)
            band = img.crop((0, photo_bottom - band_h, w, photo_bottom))
            _shade_bottom(band, 0.0, 0.62)
            img.paste(band, (0, photo_bottom - band_h))
            cfont = _font(S(CREDIT_SIZE), bold=False, family=family)
            label = f"Photo: {credit}"[:48]
            draw = ImageDraw.Draw(img)
            tw = draw.textlength(label, font=cfont)
            draw.text((w - S(SIDE) - tw, photo_bottom - S(30) - cfont.size), label,
                      font=cfont, fill=(238, 238, 238))
        _rail(img, site, accent, photo_bottom, S)
        top_limit = photo_bottom + S(RAIL_H) + S(56)
    else:
        if photo is not None:
            # too long for the panel: keep the picture as a ground and give the type the whole card
            veil = _cover_fit(photo.resize((w, S(PHOTO_H)), Image.LANCZOS), (w, h))[0]
            img.paste(veil)
            img.paste(Image.new("RGB", (w, h), primary), (0, 0),
                      Image.new("L", (w, h), 210))
        else:
            img.paste(_gradient((w, h), primary, _darken(primary, 0.55)), (0, 0))
            ImageDraw.Draw(img, "RGBA").polygon([(w * 0.58, h), (w, h * 0.55), (w, h)], fill=(*accent, 30))
        _rail(img, site, accent, S(290), S)
        top_limit = S(290) + S(RAIL_H) + S(56)
        block = lay_out(HEADLINE_LADDER_TEXT, top_limit, roomy=True)

    _card_footer(img, site, primary, text_color, S)
    draw = ImageDraw.Draw(img, "RGBA")
    hfont, lines, line_h, slines, block_h, _fits = block
    sfont = _font(S(36), bold=False, family=family)

    # last resort: a headline that still does not fit is cut here rather than drawn over the footer
    room = max(1, (bottom_limit - top_limit - kick_h - (S(20) + len(slines) * S(50) if slines else 0)) // line_h)
    if len(lines) > room:
        log.warning("headline needed %d lines and the card has room for %d; trimming", len(lines), room)
        lines = lines[:room]
        lines[-1] = lines[-1].rstrip(",;:- ") + "\u2026"
        block_h = len(lines) * line_h + (S(20) + len(slines) * S(50) if slines else 0)

    if on_photo:
        y = max(bottom_limit - block_h, top_limit + kick_h)
    else:
        y = top_limit + kick_h + max(0, (bottom_limit - top_limit - kick_h - block_h)) // 2
    # the block may not run into the footer, whatever the headline does
    y = min(y, max(top_limit + kick_h, bottom_limit - block_h))

    _card_kicker(img, kicker, site, accent, S(SIDE), y - kick_h + S(6), S)
    for line in lines:
        draw.text((S(SIDE), y), line, font=hfont, fill=text_color)
        y += line_h
    if slines:
        y += S(20)
        muted = tuple(int(c * 0.72) for c in text_color)
        for line in slines:
            draw.text((S(SIDE), y), line, font=sfont, fill=muted)
            y += S(50)
    return _save(img, out_path, quality=92)


# ---- the other Instagram formats ---------------------------------------------------------------
#
# A grid of thirty headline cards is a wall of headlines. These formats change what the middle of
# the card says - a quotation, a figure, three takeaways, the question the piece answers - and
# nothing else: same ground, same rail at the same height, same kicker chip, same footer, same
# safe bands for the 4:5 crop. The brand is the geometry; the format is the content.

TYPE_TOP = 290                 # the rail sits here on every type-led card
MUTE = 0.72                    # secondary type is the brand text colour at this strength
QUOTE_LADDER = [(60, 108, 116, 3), (100, 92, 100, 4), (140, 80, 88, 5), (10 ** 6, 68, 76, 7)]
QUESTION_LADDER = [(40, 116, 124, 3), (72, 100, 108, 4), (110, 84, 92, 5), (10 ** 6, 72, 80, 6)]
LIST_TITLE_LADDER = [(44, 64, 72, 2), (10 ** 6, 54, 62, 2)]
STAT_STEPS = [(4, 300), (7, 240), (10, 176), (14, 132), (10 ** 6, 100)]   # (max chars, size) for the figure


def _portrait_photo(backdrop_url: str | None, w: int, S) -> Image.Image | None:
    """The article photo fitted to the card's photo aperture, or None when it is unusable."""
    if not backdrop_url:
        return None
    source = _source_photo(backdrop_url, 20)
    if not source or source[0].width < PHOTO_MIN[0] or source[0].height < PHOTO_MIN[1]:
        return None
    got = _backdrop(backdrop_url, (w, S(PHOTO_H)))
    return got[0] if got else None


def _type_ground(img: Image.Image, photo: Image.Image | None, primary, accent, S) -> None:
    """The ground every type-led card sits on: the veiled photo when there is one, else the brand
    gradient with the accent wedge. Identical to the headline type card, so the family reads as one."""
    w, h = img.size
    if photo is not None:
        veil = _cover_fit(photo.resize((w, S(PHOTO_H)), Image.LANCZOS), (w, h))[0]
        img.paste(veil)
        img.paste(Image.new("RGB", (w, h), primary), (0, 0), Image.new("L", (w, h), 210))
    else:
        img.paste(_gradient((w, h), primary, _darken(primary, 0.55)), (0, 0))
        ImageDraw.Draw(img, "RGBA").polygon([(w * 0.58, h), (w, h * 0.55), (w, h)], fill=(*accent, 30))


def _muted(text_color) -> tuple[int, int, int]:
    return tuple(int(c * MUTE) for c in text_color)


def _block(draw, text: str, family, column, ladder, weight):
    font, lines, line_h = _headline_block(draw, text, family, column, ladder, weight=weight)
    return font, lines, line_h, len(lines) * line_h


def _render_format(card: CardBrief, site: Site, out_path: Path, primary, accent, text_color,
                   backdrop_url: str | None, S) -> Path:
    w, h = S(CARD_W), S(CARD_H)
    family, weight = site.brand.font, site.brand.heading_weight
    # running text stays in the brand face; a rupee sign it lacks is spelt out (figures are handled
    # separately and keep the sign in a face that has it)
    for attr in ("headline", "quote", "quote_by", "stat_label", "stat_context", "question", "left_label",
                 "right_label", "term", "definition"):
        val = getattr(card, attr)
        if val:
            setattr(card, attr, _spell_out(val, family))
    card.items = [_spell_out(t, family) for t in card.items]
    card.dos = [_spell_out(t, family) for t in card.dos]
    card.donts = [_spell_out(t, family) for t in card.donts]
    img = Image.new("RGB", (w, h), primary)
    _type_ground(img, _portrait_photo(backdrop_url, w, S), primary, accent, S)
    _rail(img, site, accent, S(TYPE_TOP), S)
    _card_footer(img, site, primary, text_color, S)
    draw = ImageDraw.Draw(img, "RGBA")
    column = w - S(SIDE) * 2
    kick_h = S(KICKER_SIZE) + S(20) * 2
    top = S(TYPE_TOP) + S(RAIL_H) + S(56)
    bottom = S(FOOT_BOTTOM) - S(56) - S(36) - S(40)
    _card_kicker(img, card.kicker, site, accent, S(SIDE), top, S)
    top += kick_h + S(40)
    room = bottom - top
    muted = _muted(text_color)
    x = S(SIDE)

    if card.kind == "quote":
        quote_text = tidy(card.quote or card.headline)
        mark_font = _font(S(260), bold=True, family=family, weight=weight)
        qfont, lines, line_h, block_h = _block(draw, quote_text, family, column, QUOTE_LADDER, weight)
        by_font = _font(S(34), bold=False, family=family)
        by_lines = _wrap(draw, card.quote_by or site.name, by_font, column - S(96))
        total = S(120) + block_h + S(44) + len(by_lines) * S(44)
        y = top + max(0, (room - total) // 2)
        # the opening mark, in the accent, hung above the first line like a drop cap
        draw.text((x - S(8), y - S(60)), "“", font=mark_font, fill=(*accent, 235))
        y += S(120)
        for line in lines:
            draw.text((x, y), line, font=qfont, fill=text_color)
            y += line_h
        y += S(44)
        draw.rectangle([x, y + S(14), x + S(64), y + S(14) + S(6)], fill=accent)
        for line in by_lines:
            draw.text((x + S(96), y), line, font=by_font, fill=muted)
            y += S(44)

    elif card.kind == "stat":
        figure = (card.stat or "").strip()
        size = next(sz for limit, sz in STAT_STEPS if len(figure) <= limit)
        ffont = _figure_font(figure, S(size), family, max(weight, 700))
        while draw.textlength(figure, font=ffont) > column and size > 72:
            size -= 8
            ffont = _figure_font(figure, S(size), family, max(weight, 700))
        lfont, llines, lline_h, lblock = _block(draw, tidy(card.stat_label or card.headline), family, column,
                                                [(48, 60, 68, 2), (10 ** 6, 48, 56, 3)], weight)
        cfont = _font(S(36), bold=False, family=family)
        clines = _wrap(draw, tidy(card.stat_context or ""), cfont, column)[:3] if card.stat_context else []
        fig_h = S(size * 1.02)
        total = fig_h + S(28) + lblock + (S(28) + len(clines) * S(48) if clines else 0)
        y = top + max(0, (room - total) // 2)
        draw.text((x - S(size * 0.04), y - S(size * 0.16)), figure, font=ffont, fill=accent)
        y += fig_h + S(28)
        for line in llines:
            draw.text((x, y), line, font=lfont, fill=text_color)
            y += lline_h
        if clines:
            y += S(28)
            for line in clines:
                draw.text((x, y), line, font=cfont, fill=muted)
                y += S(48)

    elif card.kind == "list":
        tfont, tlines, tline_h, tblock = _block(draw, tidy(card.headline), family, column, LIST_TITLE_LADDER, weight)
        ifont = _font(S(42), bold=False, family=family, weight=500)
        nfont = _font(S(40), bold=True, family=family, weight=max(weight, 700))
        gutter = S(92)
        rows = [_wrap(draw, tidy(t), ifont, column - gutter)[:2] for t in card.items[:3]]
        row_h = [len(r) * S(54) + S(34) for r in rows]
        total = tblock + S(48) + sum(row_h) - S(34)
        y = top + max(0, (room - total) // 2)
        for line in tlines:
            draw.text((x, y), line, font=tfont, fill=text_color)
            y += tline_h
        y += S(48)
        for i, (lines, rh) in enumerate(zip(rows, row_h), 1):
            draw.text((x, y + S(4)), f"{i:02d}", font=nfont, fill=accent)
            draw.rectangle([x, y + S(58), x + S(48), y + S(58) + S(4)], fill=(*accent, 160))
            yy = y
            for line in lines:
                draw.text((x + gutter, yy), line, font=ifont, fill=text_color)
                yy += S(54)
            y += rh

    elif card.kind == "versus":
        tfont, tlines, tline_h, tblock = _block(draw, tidy(card.headline), family, column, LIST_TITLE_LADDER, weight)
        gap = S(48)
        col_w = (column - gap) // 2
        vfont_size = 132
        values = [card.left_value or "", card.right_value or ""]
        vfont = _figure_font("".join(values), S(vfont_size), family, max(weight, 700))
        while any(draw.textlength(v, font=vfont) > col_w for v in values) and vfont_size > 56:
            vfont_size -= 8
            vfont = _figure_font("".join(values), S(vfont_size), family, max(weight, 700))
        lfont = _font(S(34), bold=False, family=family)
        labels = [_wrap(draw, tidy(card.left_label or ""), lfont, col_w)[:3], _wrap(draw, tidy(card.right_label or ""), lfont, col_w)[:3]]
        val_h = S(vfont_size * 1.05)
        lab_h = max(len(l) for l in labels) * S(44)
        total = tblock + S(72) + val_h + S(20) + lab_h
        y = top + max(0, (room - total) // 2)
        for line in tlines:
            draw.text((x, y), line, font=tfont, fill=text_color)
            y += tline_h
        y += S(72)
        pair_top = y
        for i in range(2):
            cx = x + i * (col_w + gap)
            draw.text((cx - S(4), y - S(vfont_size * 0.14)), values[i], font=vfont, fill=accent if i == 0 else text_color)
            ly = y + val_h + S(20)
            for line in labels[i]:
                draw.text((cx, ly), line, font=lfont, fill=muted)
                ly += S(44)
        # the divider, with a small "vs" chip on it
        dx = x + col_w + gap // 2
        draw.rectangle([dx - S(2), pair_top, dx + S(2), pair_top + val_h + S(20) + lab_h], fill=(*accent, 150))
        vfont2 = _font(S(26), bold=True, family=family)
        draw.rectangle([dx - S(34), pair_top + val_h // 2 - S(22), dx + S(34), pair_top + val_h // 2 + S(22)], fill=primary)
        vw = draw.textlength("vs", font=vfont2)
        draw.text((dx - vw / 2, pair_top + val_h // 2 - S(16)), "vs", font=vfont2, fill=accent)

    elif card.kind == "term":
        term = tidy(card.term or card.headline)
        tfont, tlines, tline_h, tblock = _block(draw, term, family, column, [(18, 124, 132, 2), (30, 104, 112, 2), (10 ** 6, 88, 96, 3)], weight)
        dfont = _font(S(42), bold=False, family=family)
        dlines = _wrap(draw, tidy(card.definition or ""), dfont, column)[:5]
        total = tblock + S(36) + S(6) + S(36) + len(dlines) * S(56)
        y = top + max(0, (room - total) // 2)
        for line in tlines:
            draw.text((x, y), line, font=tfont, fill=accent)
            y += tline_h
        y += S(36)
        draw.rectangle([x, y, x + S(96), y + S(6)], fill=accent)
        y += S(6) + S(36)
        for line in dlines:
            draw.text((x, y), line, font=dfont, fill=text_color)
            y += S(56)

    elif card.kind == "checklist":
        hfont = _font(S(28), bold=True, family=family)
        ifont = _font(S(38), bold=False, family=family, weight=500)
        mark, gutter = S(34), S(72)
        groups = [("DO", card.dos[:3], _tick, accent), ("DON'T", card.donts[:3], _cross, muted)]
        rows = []
        for title, items, fn, colour in groups:
            wrapped = [_wrap(draw, tidy(t), ifont, column - gutter)[:2] for t in items]
            rows.append((title, wrapped, fn, colour))
        def group_h(wrapped):
            return S(28) + S(24) + sum(len(l) * S(50) + S(22) for l in wrapped)
        total = sum(group_h(r[1]) for r in rows) + S(56)
        y = top + max(0, (room - total) // 2)
        track = S(28) * 0.12
        for gi, (title, wrapped, fn, colour) in enumerate(rows):
            _tracked(draw, (x, y), title, hfont, colour, track)
            draw.rectangle([x + _tracked_len(draw, title, hfont, track) + S(18), y + S(14), x + column, y + S(14) + S(2)], fill=(*colour, 90))
            y += S(28) + S(24)
            for lines in wrapped:
                fn(draw, x, y + S(6), mark, colour, S(5))
                yy = y
                for line in lines:
                    draw.text((x + gutter, yy), line, font=ifont, fill=text_color)
                    yy += S(50)
                y += len(lines) * S(50) + S(22)
            if gi == 0:
                y += S(56)

    else:   # question
        qtext = tidy(card.question or card.headline)
        qfont, lines, line_h, block_h = _block(draw, qtext, family, column, QUESTION_LADDER, weight)
        cue_font = _font(S(34), bold=True, family=family, weight=max(weight, 600))
        cue = "Read the answer"
        total = block_h + S(56) + S(44)
        y = top + max(0, (room - total) // 2)
        for line in lines:
            draw.text((x, y), line, font=qfont, fill=text_color)
            y += line_h
        y += S(56)
        draw.text((x, y), cue, font=cue_font, fill=accent)
        # the arrow is drawn, not typed: two of the four brand faces have no U+2192 and show a box
        ax, ay = x + draw.textlength(cue, font=cue_font) + S(18), y + S(20)
        draw.line([(ax, ay), (ax + S(40), ay)], fill=accent, width=S(4))
        draw.line([(ax + S(26), ay - S(12)), (ax + S(40), ay), (ax + S(26), ay + S(12))], fill=accent, width=S(4))

    return _save(img, out_path, quality=92)


def _tick(draw, x: int, y: int, size: int, colour, width: int) -> None:
    draw.line([(x, y + size * 0.55), (x + size * 0.38, y + size * 0.9), (x + size, y + size * 0.15)], fill=colour, width=width)


def _cross(draw, x: int, y: int, size: int, colour, width: int) -> None:
    pad = size * 0.14
    draw.line([(x + pad, y + pad), (x + size - pad, y + size - pad)], fill=colour, width=width)
    draw.line([(x + size - pad, y + pad), (x + pad, y + size - pad)], fill=colour, width=width)


def _render_inverse(card: CardBrief, site: Site, out_path: Path, primary, accent, text_color, S) -> Path:
    """The brand turned inside out: accent ground, ink type, and the footer kept on its own dark
    band so every masthead stays legible. Needs nothing but a headline, so it is the format that
    guarantees a grid never runs to six dark cards in a row."""
    w, h = S(CARD_W), S(CARD_H)
    family, weight = site.brand.font, site.brand.heading_weight
    ink = _ink_on(accent)
    img = Image.new("RGB", (w, h), accent)
    draw = ImageDraw.Draw(img, "RGBA")
    # a quiet diagonal in the primary keeps the accent ground from reading as a flat swatch
    draw.polygon([(w * 0.58, h), (w, h * 0.55), (w, h)], fill=(*primary, 26))
    # the rail in primary: same height, same place, so the grid geometry does not move
    draw.rectangle([0, S(TYPE_TOP), w, S(TYPE_TOP) + S(RAIL_H)], fill=primary)
    # footer on the brand's own ground, where the masthead was designed to sit
    band_top = S(FOOT_BOTTOM) - S(56) - S(36)
    draw.rectangle([0, band_top, w, h], fill=primary)
    _card_footer(img, site, primary, text_color, S)
    column = w - S(SIDE) * 2
    top = S(TYPE_TOP) + S(RAIL_H) + S(56)
    bottom = band_top - S(40)
    # kicker chip inverted too: primary chip, accent text
    kfont = _font(S(KICKER_SIZE), bold=True, family=family)
    text = (card.kicker or site.category).strip().upper()[:24]
    track = S(KICKER_SIZE) * 0.08
    kw = _tracked_len(draw, text, kfont, track)
    draw.rectangle([S(SIDE), top, S(SIDE) + kw + S(32), top + kfont.size + S(20)], fill=primary)
    _tracked(draw, (S(SIDE) + S(16), top + S(10)), text, kfont, accent, track)
    kick_h = kfont.size + S(20) + S(40)
    hfont, lines, line_h = _headline_block(draw, tidy(card.headline), family, column, HEADLINE_LADDER_TEXT, weight=weight)
    block_h = len(lines) * line_h
    y = top + kick_h + max(0, (bottom - top - kick_h - block_h) // 2)
    for line in lines:
        draw.text((S(SIDE), y), line, font=hfont, fill=ink)
        y += line_h
    return _save(img, out_path, quality=92)


def _render_poster(card: CardBrief, site: Site, out_path: Path, primary, accent, text_color,
                   backdrop_url: str | None, S) -> Path | None:
    """The photograph as the whole card, headline set over a deep gradient at its foot.

    Returns None when the article has no photo the card can use; the caller then takes the
    headline route rather than posting an empty frame. Faces are kept out of the crop's lost band
    the same way the headline card does it.
    """
    w, h = S(CARD_W), S(CARD_H)
    if not backdrop_url:
        return None
    source = _source_photo(backdrop_url, 20)
    if not source or source[0].width < PHOTO_MIN[0] or source[0].height < PHOTO_MIN[1]:
        return None
    got = _backdrop(backdrop_url, (w, h))
    if not got:
        return None
    photo, faces = got
    if faces and faces[1] < S(PORTRAIT_BLEED) + S(8):
        log.info("a face sits in the band the 4:5 crop removes; poster card skipped")
        return None
    img = photo.filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=3)).convert("RGB")
    _shade_bottom(img, 0.30, 0.94)                 # the ground the type needs, fading in from a third down
    family, weight = site.brand.font, site.brand.heading_weight
    draw = ImageDraw.Draw(img, "RGBA")
    band_top = S(FOOT_BOTTOM) - S(56) - S(36)
    draw.rectangle([0, band_top, w, h], fill=(*primary, 235))
    _card_footer(img, site, primary, text_color, S)
    column = w - S(SIDE) * 2
    kick_h = S(KICKER_SIZE) + S(20) * 2
    bottom = band_top - S(48)
    hfont, lines, line_h = _headline_block(draw, tidy(card.headline), family, column, HEADLINE_LADDER, weight=weight)
    block_h = len(lines) * line_h
    y = bottom - block_h
    _card_kicker(img, card.kicker or site.category, site, accent, S(SIDE), y - kick_h - S(24), S)
    draw = ImageDraw.Draw(img, "RGBA")
    # an inset accent rule above the kicker: the family's section rule, where the photo allows it
    draw.rectangle([S(SIDE), y - kick_h - S(24) - S(28), S(SIDE) + S(120), y - kick_h - S(24) - S(28) + S(RAIL_H)], fill=accent)
    for line in lines:
        draw.text((S(SIDE) + 2, y + 3), line, font=hfont, fill=(0, 0, 0, 120))
        draw.text((S(SIDE), y), line, font=hfont, fill=(255, 255, 255))
        y += line_h
    return _save(img, out_path, quality=90)


def render_card(headline: str, kicker: str, site: Site, out_path: Path, variant: str = "landscape",
                backdrop_url: str | None = None, standfirst: str | None = None, credit: str | None = None,
                date_text: str | None = None, card: CardBrief | None = None) -> Path:
    size = SIZES[variant]
    w, h = size
    primary = hex_to_rgb(site.brand.primary)
    accent = hex_to_rgb(site.brand.accent)
    text_color = hex_to_rgb(site.brand.text)
    margin = int(w * 0.075)
    # a one- or two-character kicker ("X", "-") is a model hiccup, not a section label
    kicker = (kicker or "").strip()
    if len(kicker) < 3:
        kicker = site.category

    if variant == "portrait":
        return _render_portrait(headline, kicker, standfirst, site, out_path, primary, accent, text_color,
                                backdrop_url, credit, date_text, card=card)

    got = _backdrop(backdrop_url, size, clear_bottom=(0.40 if variant == "square" else 0.0)) if backdrop_url else None
    if got is not None:
        photo, faces = got
        return _render_photo_cover(photo, headline, kicker, site, out_path, variant, primary, accent, margin, faces)

    # ---- fallback: branded gradient card with the headline ----
    img = _gradient(size, primary, _darken(primary, 0.45))
    draw = ImageDraw.Draw(img, "RGBA")
    draw.polygon([(w * 0.72, 0), (w, 0), (w, h * 0.55)], fill=(*accent, 38))
    draw.ellipse([w * 0.78, h * 0.62, w * 1.15, h * 1.2], fill=(*accent, 28))
    draw.rectangle([0, h - 14, w, h], fill=accent)

    family = site.brand.font
    y = int(h * 0.14) if variant == "landscape" else int(h * 0.16)
    y += _draw_kicker(draw, kicker, margin, y, w, accent, primary, family=family) + int(h * 0.05)

    footer_h = int(h * 0.20)
    hfont, lines, line_h = _fit_headline(draw, headline.strip(), w - margin * 2, h - y - footer_h,
                                          start=int(w * (0.062 if variant == "landscape" else 0.066)), family=family)
    for line in lines:
        draw.text((margin + 2, y + 3), line, font=hfont, fill=(0, 0, 0, 110))
        draw.text((margin, y), line, font=hfont, fill=text_color)
        y += line_h
    _draw_footer(img, site, primary, text_color, footer_h, margin)
    return _save(img, out_path)


def _render_photo_cover(photo: Image.Image, headline: str, kicker: str, site: Site, out_path: Path, variant: str,
                        primary, accent, margin: int, faces: Box | None = None) -> Path:
    """The actual article photo as the cover, with the brand on it - on the side away from any face."""
    img = photo
    w, h = img.size
    family = site.brand.font
    kicker_side, plate_side = _overlay_sides(faces, w, h)
    if variant == "square":
        # Instagram shows no title, so the headline goes on the card over a soft gradient
        _shade_bottom(img, 0.38, 0.88)
        draw = ImageDraw.Draw(img, "RGBA")
        plate_h = int(h * 0.10) + int(h * 0.10 * 0.56)
        bottom = h - int(w * 0.05) - plate_h - int(h * 0.035)
        hfont, lines, line_h = _fit_headline(draw, headline.strip(), w - margin * 2, int(h * 0.36), start=int(w * 0.058), minimum=36, family=family)
        y = bottom - len(lines) * line_h
        ky = y - int(h * 0.03) - int(w * 0.022) - int(w * 0.012) * 2
        _draw_kicker(draw, kicker, margin, ky, w, accent, primary, family=family)
        for line in lines:
            draw.text((margin + 2, y + 3), line, font=hfont, fill=(0, 0, 0, 140))
            draw.text((margin, y), line, font=hfont, fill=(255, 255, 255))
            y += line_h
    else:
        # featured / OG image: the photo itself, lightly grounded at the bottom so the plate sits naturally
        _shade_bottom(img, 0.55, 0.45)
        draw = ImageDraw.Draw(img, "RGBA")
        _draw_kicker(draw, kicker, margin, int(h * 0.08), w, accent, primary, kicker_side, family=family)
    _draw_footer(img, site, primary, (255, 255, 255), int(h * 0.16), margin, plate_side if variant != "square" else "left")
    return _save(img, out_path)


def render_set(headline: str, kicker: str, site: Site, out_dir: Path, stem: str,
               backdrop_url: str | None = None, standfirst: str | None = None, credit: str | None = None,
               date_text: str | None = None, variants: tuple[str, ...] | None = None,
               card: CardBrief | None = None) -> dict[str, Path]:
    """Render the cards asked for; every shape by default. Each is drawn from one download.

    `card` shapes the portrait (Instagram) card only: the landscape cover and the square keep the
    headline treatment, because the featured image and link previews sit next to the title anyway.
    """
    global _LAST_PHOTO
    try:
        return {
            variant: render_card(headline, kicker, site, out_dir / f"{stem}-{variant}.jpg", variant, backdrop_url,
                                 standfirst, credit, date_text, card=card if variant == "portrait" else None)
            for variant in (variants or tuple(SIZES))
        }
    finally:
        _LAST_PHOTO = None   # the cache exists to serve one article's cards, not to hold a photo forever


def instagram_asset(card: Path, ratio: str = "4:5", out_path: Path | None = None) -> Path:
    """The portrait card trimmed to the shape Instagram will actually publish.

    Meta validates the aspect ratio of a feed image and refuses anything below 4:5 outright
    (36003 / 2207009), so the 3:4 card cannot be posted as it is drawn. The layout keeps its
    top and bottom `PORTRAIT_BLEED` bands free of content precisely so this crop costs nothing.
    Pass ratio="3:4" to post the full card once Meta accepts it - `instagram-probe` says when.
    """
    if ratio not in IG_RATIOS:
        log.warning("unknown instagram_ratio %r; posting the 4:5 asset instead of guessing", ratio)
        ratio = "4:5"
    if IG_RATIOS[ratio] is None:
        return card
    with Image.open(card) as im:
        w, h = im.size
        target = int(round(w / IG_RATIOS[ratio]))
        if h <= target:
            return card
        top = (h - target) // 2
        crop = im.convert("RGB").crop((0, top, w, top + target))
    return _save(crop, out_path or card.with_name(card.stem.replace("-portrait", "-instagram") + ".jpg"))


STORY_SIZE = (1440, 2560)          # 9:16 at the same 4/3 scale as the cards, so type stays sharp
STORY_SAFE = 340                   # Instagram lays its own UI over roughly this much at top and bottom


def story_asset(card: Path, site: Site, out_path: Path) -> Path:
    """The same card as a 9:16 story: framed on the brand ground, inside the safe zones.

    Stories carry no caption and, through the API, no link sticker, so the card - which already
    names the site in its footer - is the whole message. It is scaled to sit clear of the bands
    Instagram and Facebook draw their own controls over, so nothing that matters is covered.
    """
    primary = hex_to_rgb(site.brand.primary)
    accent = hex_to_rgb(site.brand.accent)
    w, h = STORY_SIZE
    img = _gradient((w, h), primary, _darken(primary, 0.6))
    ImageDraw.Draw(img, "RGBA").polygon([(w * 0.55, h), (w, h * 0.62), (w, h)], fill=(*accent, 22))
    with Image.open(card) as im:
        cw, ch = im.size
        avail_h = h - STORY_SAFE * 2
        scale = min(avail_h / ch, (w - 2 * 48) / cw)
        fitted = im.convert("RGB").resize((int(cw * scale), int(ch * scale)), Image.LANCZOS)
    x, y = (w - fitted.width) // 2, (h - fitted.height) // 2
    # a hairline in the accent around the card lifts it off a ground of nearly the same colour
    ImageDraw.Draw(img).rectangle([x - 3, y - 3, x + fitted.width + 2, y + fitted.height + 2], outline=accent, width=3)
    img.paste(fitted, (x, y))
    return _save(img, out_path, quality=90)


def _story_canvas(site: Site):
    """The 9:16 ground every story frame shares, with the brand rail near the top of the safe area."""
    primary, accent, text = hex_to_rgb(site.brand.primary), hex_to_rgb(site.brand.accent), hex_to_rgb(site.brand.text)
    w, h = STORY_SIZE
    img = _gradient((w, h), primary, _darken(primary, 0.6))
    ImageDraw.Draw(img, "RGBA").polygon([(w * 0.55, h), (w, h * 0.62), (w, h)], fill=(*accent, 22))
    _rail(img, site, accent, STORY_SAFE + 20, lambda v: int(round(v * CARD_SCALE)))
    return img, primary, accent, text


def _story_footer(img: Image.Image, site: Site, text) -> None:
    """Domain and 'link in bio' just above the bottom safe band, small and quiet."""
    w, h = img.size
    S = lambda v: int(round(v * CARD_SCALE))
    font = _font(S(26), bold=False, family=site.brand.font)
    label = f"{site.domain}   Read the full story: link in bio"
    draw = ImageDraw.Draw(img)
    draw.text((S(72), h - STORY_SAFE - S(48)), label, font=font, fill=tuple(int(c * 0.62) for c in text))
    _card_logo(img, site, hex_to_rgb(site.brand.primary), w - S(72) - S(160), h - STORY_SAFE - S(8), S(40))


def story_text_frame(heading: str, body: str, index: int, total: int, site: Site, out_path: Path,
                     kicker: str | None = None) -> Path:
    """A content frame of the story: kicker with position, a bold heading, and the body in
    comfortable reading type. This is where a viewer who never taps through gets the article."""
    img, primary, accent, text = _story_canvas(site)
    w, h = img.size
    S = lambda v: int(round(v * CARD_SCALE))
    family, weight = site.brand.font, site.brand.heading_weight
    draw = ImageDraw.Draw(img, "RGBA")
    x, column = S(72), w - S(72) * 2
    top = STORY_SAFE + 20 + S(RAIL_H) + S(64)
    label = (kicker or "The story").upper()[:22] + f"  ·  {index}/{total}"
    _card_kicker(img, label, site, accent, x, top, S)
    y = top + S(KICKER_SIZE) + S(20) * 2 + S(56)
    hfont, hlines, line_h = _headline_block(draw, _spell_out(tidy(heading), family), family, column,
                                            [(40, 76, 84, 3), (70, 64, 72, 4), (10 ** 6, 54, 62, 5)], weight=weight)
    for line in hlines:
        draw.text((x, y), line, font=hfont, fill=text)
        y += line_h
    y += S(40)
    draw.rectangle([x, y, x + S(96), y + S(6)], fill=accent)
    y += S(6) + S(44)
    bfont = _font(S(42), bold=False, family=family, weight=450)
    room_lines = max(3, (h - STORY_SAFE - S(140) - y) // S(62))
    blines = _wrap(draw, _spell_out(tidy(body), family), bfont, column)
    if len(blines) > room_lines:
        blines = blines[:room_lines]
        blines[-1] = blines[-1].rstrip(",;:- ") + "\u2026"
    for line in blines:
        draw.text((x, y), line, font=bfont, fill=text)
        y += S(62)
    _story_footer(img, site, text)
    return _save(img, out_path, quality=90)


def story_closing_frame(headline: str, site: Site, out_path: Path) -> Path:
    """The last frame: the article's title as a reminder, then the site, large, and the way there."""
    img, primary, accent, text = _story_canvas(site)
    w, h = img.size
    S = lambda v: int(round(v * CARD_SCALE))
    family, weight = site.brand.font, site.brand.heading_weight
    draw = ImageDraw.Draw(img, "RGBA")
    x, column = S(72), w - S(72) * 2
    top = STORY_SAFE + 20 + S(RAIL_H) + S(64)
    _card_kicker(img, "Read the full story", site, accent, x, top, S)
    y = top + S(KICKER_SIZE) + S(20) * 2 + S(72)
    tfont, tlines, tline_h = _headline_block(draw, _spell_out(tidy(headline), family), family, column,
                                             [(60, 56, 64, 3), (10 ** 6, 46, 54, 4)], weight=weight)
    for line in tlines:
        draw.text((x, y), line, font=tfont, fill=tuple(int(c * 0.8) for c in text))
        y += tline_h
    y += S(72)
    # the domain is the message: set big, in the accent, with the site's own mark above it
    logo_h = S(64)
    _card_logo(img, site, primary, x, y + logo_h, logo_h)
    y += logo_h + S(48)
    dfont = _figure_font(site.domain, S(72), family, max(weight, 700))
    while draw.textlength(site.domain, font=dfont) > column:
        dfont = _figure_font(site.domain, dfont.size - S(4), family, max(weight, 700))
    draw.text((x, y), site.domain, font=dfont, fill=accent)
    y += dfont.size + S(36)
    cfont = _font(S(40), bold=True, family=family, weight=max(weight, 600))
    cue = "Link in bio"
    draw.text((x, y), cue, font=cfont, fill=text)
    ax, ay = x + draw.textlength(cue, font=cfont) + S(20), y + S(24)
    draw.line([(ax, ay), (ax + S(44), ay)], fill=accent, width=S(4))
    draw.line([(ax + S(30), ay - S(13)), (ax + S(44), ay), (ax + S(30), ay + S(13))], fill=accent, width=S(4))
    _story_footer(img, site, text)
    return _save(img, out_path, quality=90)


# ---- carousel slides ---------------------------------------------------------------------------
# Drawn on the same 3:4 master canvas as the cards and trimmed to the same 4:5 as the cover, so the
# rail, the kicker chip and the footer sit in exactly the same place on every slide of a swipe.
CAROUSEL_SIZE = (int(CARD_W * CARD_SCALE), int(CARD_W * CARD_SCALE / IG_RATIOS["4:5"]))   # 1440x1800
SLIDE_HEADING_LADDER = [(40, 72, 80, 3), (70, 60, 68, 4), (10 ** 6, 50, 58, 5)]
SLIDE_BODY_SIZE, SLIDE_BODY_LEAD = 40, 58


def _slide_canvas(site: Site):
    """The master canvas a slide is drawn on: type ground, rail and footer, like the type-led cards."""
    S = lambda v: int(round(v * CARD_SCALE))
    primary, accent, text = hex_to_rgb(site.brand.primary), hex_to_rgb(site.brand.accent), hex_to_rgb(site.brand.text)
    img = Image.new("RGB", (S(CARD_W), S(CARD_H)), primary)
    _type_ground(img, None, primary, accent, S)
    _rail(img, site, accent, S(TYPE_TOP), S)
    _card_footer(img, site, primary, text, S)
    return img, primary, accent, text, S


def _slide_frame(S) -> tuple[int, int, int]:
    """x, top and bottom of a slide's content area on the master canvas."""
    top = S(TYPE_TOP) + S(RAIL_H) + S(56)
    bottom = S(FOOT_BOTTOM) - S(56) - S(36) - S(40)
    return S(SIDE), top, bottom


def _to_feed_ratio(img: Image.Image, out_path: Path) -> Path:
    """Trim the master to 4:5 the way instagram_asset trims the cover."""
    w, h = img.size
    target = int(round(w / IG_RATIOS["4:5"]))
    top = (h - target) // 2
    return _save(img.crop((0, top, w, top + target)), out_path, quality=90)


def _swipe_cue(draw, x: int, y: int, S, colour) -> None:
    """A small drawn arrow: the brand faces lack the glyph."""
    draw.line([(x, y), (x + S(40), y)], fill=colour, width=S(3))
    draw.line([(x + S(28), y - S(11)), (x + S(40), y), (x + S(28), y + S(11))], fill=colour, width=S(3))


def _short_kicker(kicker: str | None, limit: int = 15) -> str:
    """The section label cut at a word, never mid-word: 'MARKETING' rather than 'MARKETING PSYCH'."""
    words = (kicker or "").strip().upper().split()
    out = ""
    for word in words:
        if len(f"{out} {word}".strip()) > limit:
            break
        out = f"{out} {word}".strip()
    return out or "THE STORY"


def carousel_text_slide(heading: str, body: str, index: int, total: int, site: Site, out_path: Path,
                        kicker: str | None = None) -> Path:
    """One content slide: kicker with its place in the sequence, a bold heading, an accent rule and
    the body in reading type. Together the slides are the article for a viewer who never taps out."""
    img, primary, accent, text, S = _slide_canvas(site)
    family, weight = site.brand.font, site.brand.heading_weight
    draw = ImageDraw.Draw(img, "RGBA")
    x, top, bottom = _slide_frame(S)
    column = img.width - x * 2
    _card_kicker(img, f"{_short_kicker(kicker)}  \u00b7  {index}/{total}", site, accent, x, top, S)
    top += S(KICKER_SIZE) + S(20) * 2 + S(40)
    hfont, hlines, line_h = _headline_block(draw, _spell_out(tidy(heading), family), family, column,
                                            SLIDE_HEADING_LADDER, weight=weight)
    bfont = _font(S(SLIDE_BODY_SIZE), bold=False, family=family, weight=450)
    rule_h = S(32) + S(6) + S(36)
    room_lines = max(3, (bottom - S(56) - top - len(hlines) * line_h - rule_h) // S(SLIDE_BODY_LEAD))
    blines = _wrap(draw, _spell_out(tidy(body), family), bfont, column)
    if len(blines) > room_lines:
        blines = blines[:room_lines]
        blines[-1] = blines[-1].rstrip(",;:- ") + "\u2026"
    # the block sits a little above centre of the room, as the type-led cards do, so a short slide
    # does not read as a heading marooned over empty ground
    block = len(hlines) * line_h + rule_h + len(blines) * S(SLIDE_BODY_LEAD)
    y = top + max(0, (bottom - S(56) - top - block) // 3)
    for line in hlines:
        draw.text((x, y), line, font=hfont, fill=text)
        y += line_h
    y += S(32)
    draw.rectangle([x, y, x + S(96), y + S(6)], fill=accent)
    y += S(6) + S(36)
    for line in blines:
        draw.text((x, y), line, font=bfont, fill=text)
        y += S(SLIDE_BODY_LEAD)
    # a quiet cue to keep swiping, bottom right of the content area
    _swipe_cue(draw, img.width - x - S(40), bottom - S(12), S, (*accent, 200))
    return _to_feed_ratio(img, out_path)


def carousel_closing_slide(headline: str, site: Site, out_path: Path) -> Path:
    """The last slide: the title as a reminder, the site large in the accent, and the way there."""
    img, primary, accent, text, S = _slide_canvas(site)
    family, weight = site.brand.font, site.brand.heading_weight
    draw = ImageDraw.Draw(img, "RGBA")
    x, top, bottom = _slide_frame(S)
    column = img.width - x * 2
    _card_kicker(img, "Read the full story", site, accent, x, top, S)
    y = top + S(KICKER_SIZE) + S(20) * 2 + S(56)
    tfont, tlines, tline_h = _headline_block(draw, _spell_out(tidy(headline), family), family, column,
                                             [(60, 52, 60, 3), (10 ** 6, 44, 52, 4)], weight=weight)
    for line in tlines:
        draw.text((x, y), line, font=tfont, fill=tuple(int(c * 0.8) for c in text))
        y += tline_h
    y += S(56)
    logo_h = S(56)
    _card_logo(img, site, primary, x, y + logo_h, logo_h)
    y += logo_h + S(40)
    dfont = _figure_font(site.domain, S(64), family, max(weight, 700))
    while draw.textlength(site.domain, font=dfont) > column:
        dfont = _figure_font(site.domain, dfont.size - S(4), family, max(weight, 700))
    draw.text((x, y), site.domain, font=dfont, fill=accent)
    y += dfont.size + S(32)
    cfont = _font(S(36), bold=True, family=family, weight=max(weight, 600))
    cue = "Link in bio"
    draw.text((x, y), cue, font=cfont, fill=text)
    _swipe_cue(draw, x + int(draw.textlength(cue, font=cfont)) + S(20), y + S(22), S, accent)
    y += S(36) + S(28)
    sfont = _font(S(30), bold=False, family=family)
    draw.text((x, y), "Save this post for later and share it with your team", font=sfont, fill=_muted(text))
    return _to_feed_ratio(img, out_path)


def resize_to(card: Path, size: tuple[int, int], out_path: Path) -> Path:
    """Force a card to an exact size, for probing what a platform accepts."""
    with Image.open(card) as im:
        out = im.convert("RGB").resize(size, Image.LANCZOS)
    return _save(out, out_path)
