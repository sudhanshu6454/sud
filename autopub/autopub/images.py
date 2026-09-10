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

from .config import Site
from .sources import USER_AGENT
from .typography import BOLD, REGULAR
from .typography import load as load_font

log = logging.getLogger(__name__)

SIZES = {"landscape": (1200, 630), "square": (1080, 1080), "portrait": (1080, 1440)}
IG_FEED_HEIGHT = 1350   # 4:5 at 1080 wide: the tallest single image Instagram's API will accept
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


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    words = text.split()
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
FOOT_BOTTOM = 1376       # footer baseline anchor; everything above grows upward from here
CREDIT_SIZE = 28         # the floor for legible type in the feed

# headline ladder: discrete steps keyed to length. Continuously autosizing every headline gives a
# different size on every card, which across a grid reads as broken rather than responsive.
HEADLINE_LADDER = [(36, 104, 110, 2), (62, 92, 99, 3), (88, 80, 88, 4), (10 ** 6, 72, 80, 5)]
# a card with no photo is a different template with twice the room, so it gets its own ladder
# rather than a headline of ordinary size marooned in the middle of an empty panel
HEADLINE_LADDER_TEXT = [(36, 132, 140, 3), (62, 116, 124, 4), (88, 100, 108, 5), (10 ** 6, 88, 96, 6)]

# a line may not end on one of these: it leaves the reader hanging mid-phrase
DANGLERS = {"a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "by", "for", "from",
            "with", "as", "is", "are", "was", "were", "its", "it", "that", "this", "into", "over",
            "after", "before", "than", "per", "via"}

SMART = ((" - ", " \u2013 "), ("--", "\u2014"), ("...", "\u2026"), ('"', "\u201d"), ("  ", " "))


def tidy(text: str) -> str:
    """Normalise CMS punctuation: straight quotes, hyphens for dashes and three dots all look
    machine-made on a card, and a ' | Publication' suffix is web furniture, not a headline."""
    text = " ".join((text or "").split())
    text = re.split(r"\s+[|\u2013\u2014]\s+(?:[A-Z][\w&.'-]*\s?){1,4}$", text)[0] if text.count("|") else text
    for old, new in SMART:
        text = text.replace(old, new)
    return text.strip().strip("|").strip()


def _balanced_lines(draw, words: list[str], font, max_width: float, max_lines: int) -> list[str] | None:
    """Wrap into at most `max_lines`, evening out the line lengths and avoiding dangling words.

    Greedy wrapping packs line one full and leaves a stub at the end; a short dynamic program over
    the break points costs nothing at headline length and gives the balanced rag a subeditor would.
    """
    n = len(words)
    widths = [[0.0] * (n + 1) for _ in range(n + 1)]
    for i in range(n):
        for j in range(i + 1, n + 1):
            widths[i][j] = draw.textlength(" ".join(words[i:j]), font=font)
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
            width = widths[start][end]
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
    words = headline.split()
    for limit, size, line_h, max_lines in ladder:
        if len(headline) > limit:
            continue
        font = _font(int(size * CARD_SCALE), bold=True, family=family, weight=weight)
        lines = _balanced_lines(draw, words, font, max_width, max_lines)
        if lines:
            return font, lines, int(line_h * CARD_SCALE)
    # nothing fits: keep the smallest step and let it run long rather than lose the card
    size, line_h, max_lines = ladder[-1][1:]
    font = _font(int(size * CARD_SCALE), bold=True, family=family, weight=weight)
    log.warning("headline %r does not fit the card ladder; it will be crowded", headline[:80])
    lines = _balanced_lines(draw, words, font, max_width, max_lines + 2) or _wrap(draw, headline, font, max_width)
    return font, lines[:max_lines + 2], int(line_h * CARD_SCALE)


def _card_logo(img: Image.Image, site: Site, primary, x: int, baseline: int, height: int) -> int:
    """The masthead in the footer, on its own plate when the PNG bakes one in. Returns its width."""
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
    if plate and contrast_ratio(plate, primary) > 1.6:
        # a mark drawn for a different ground (the cream Junkies lockup) keeps that ground, as a
        # deliberate chip: knocking the background out would leave dark artwork on a dark panel
        pad = int(height * 0.34)
        ImageDraw.Draw(img).rectangle([x - pad, baseline - height - pad, x + w + pad, baseline + pad], fill=plate)
    img.paste(logo, (x, baseline - height), logo)
    return w


def _render_portrait(headline: str, kicker: str, standfirst: str | None, site: Site, out_path: Path,
                     primary, accent, text_color, backdrop_url: str | None, credit: str | None = None,
                     date_text: str | None = None) -> Path:
    """The 3:4 card Instagram posts: photo above, brand panel below, footer anchored to the bottom.

    Nothing that matters is drawn in the top or bottom `PORTRAIT_BLEED` band, so the 4:5 asset the
    API actually accepts (see instagram_asset) is a straight centre crop with nothing lost.
    """
    def S(v: float) -> int:
        return int(round(v * CARD_SCALE))

    w, h = S(CARD_W), S(CARD_H)
    family = site.brand.font
    img = Image.new("RGB", (w, h), primary)
    headline, standfirst = tidy(headline), tidy(standfirst or "") or None

    photo_bottom = 0
    got = _backdrop(backdrop_url, (w, S(PHOTO_H))) if backdrop_url else None
    if got is not None:
        photo, _faces = got
        img.paste(photo, (0, 0))
        photo_bottom = S(PHOTO_H)
        if credit:
            cfont = _font(S(CREDIT_SIZE), bold=False, family=family)
            label = f"Photo: {credit}"[:48]
            tw = ImageDraw.Draw(img).textlength(label, font=cfont)
            pad = S(10)
            box = (w - S(SIDE) - int(tw) - pad, photo_bottom - S(48), w - S(SIDE) + pad, photo_bottom - S(48) + cfont.size + pad * 2)
            scrim = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 130))
            img.paste(Image.alpha_composite(img.crop(box).convert("RGBA"), scrim).convert("RGB"), box[:2])
            ImageDraw.Draw(img).text((box[0] + pad, box[1] + pad), label, font=cfont, fill=(240, 240, 240))
        ImageDraw.Draw(img).rectangle([0, photo_bottom, w, photo_bottom + S(6)], fill=accent)
    else:
        # no photo: the panel is the whole card, with the brand's own geometry carrying recognition
        img.paste(_gradient((w, h), primary, _darken(primary, 0.55)), (0, 0))
        d = ImageDraw.Draw(img, "RGBA")
        d.polygon([(w * 0.58, h), (w, h * 0.55), (w, h)], fill=(*accent, 30))
        d.rectangle([0, 0, w, S(8)], fill=accent)

    draw = ImageDraw.Draw(img, "RGBA")
    column = w - S(SIDE) * 2

    # footer first: it is the fixed point every card shares, and the text block grows up from it
    foot_baseline = S(FOOT_BOTTOM)
    logo_h = S(56)
    _card_logo(img, site, primary, S(SIDE), foot_baseline, logo_h)
    stamp_font = _font(S(CREDIT_SIZE), bold=False, family=family)
    stamp = date_text or time.strftime("%d %b %Y")
    stamp_w = draw.textlength(stamp, font=stamp_font)
    draw.text((w - S(SIDE) - stamp_w, foot_baseline - stamp_font.size), stamp, font=stamp_font, fill=(*text_color, 170))
    rule_y = foot_baseline - logo_h - S(36)
    draw.rectangle([S(SIDE), rule_y, w - S(SIDE), rule_y + max(2, S(2))], fill=(*text_color, 60))

    hfont, lines, line_h = _headline_block(draw, headline, family, column,
                                           HEADLINE_LADDER if photo_bottom else HEADLINE_LADDER_TEXT,
                                           weight=site.brand.heading_weight)
    sfont = _font(S(36), bold=False, family=family)
    slines: list[str] = []
    if standfirst:
        # the vertical budget only stretches to a standfirst behind a short headline
        room_for = {1: 2, 2: 2, 3: 1}.get(len(lines), 2 if not photo_bottom and len(lines) <= 4 else 0)
        if room_for:
            slines = _wrap(draw, standfirst, sfont, column)
            if len(slines) > room_for:
                slines = _wrap(draw, _shorten(standfirst, room_for, draw, sfont, column), sfont, column)[:room_for]

    block_h = len(lines) * line_h + (S(20) + len(slines) * S(50) if slines else 0)
    kick_h = S(38)
    top_limit = photo_bottom + S(56) if photo_bottom else S(PORTRAIT_BLEED + 90)
    if photo_bottom:
        # with a photo the text hangs off the footer, so every card in the grid shares a baseline
        y = max(rule_y - S(40) - block_h, top_limit + kick_h + S(24))
    else:
        # without one the card is all type: centring it beats a headline marooned at the bottom
        group = kick_h + S(26) + block_h
        y = top_limit + max(0, (rule_y - S(40) - top_limit - group)) // 2 + kick_h + S(26)

    _draw_kicker(draw, kicker, S(SIDE), y - kick_h - S(26), w, accent, primary, family=family)
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


def render_card(headline: str, kicker: str, site: Site, out_path: Path, variant: str = "landscape",
                backdrop_url: str | None = None, standfirst: str | None = None, credit: str | None = None,
                date_text: str | None = None) -> Path:
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
                                backdrop_url, credit, date_text)

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
               date_text: str | None = None, variants: tuple[str, ...] | None = None) -> dict[str, Path]:
    """Render the cards asked for; every shape by default. Each is drawn from one download."""
    return {
        variant: render_card(headline, kicker, site, out_dir / f"{stem}-{variant}.jpg", variant, backdrop_url,
                             standfirst, credit, date_text)
        for variant in (variants or tuple(SIZES))
    }


def instagram_asset(card: Path, ratio: str = "4:5", out_path: Path | None = None) -> Path:
    """The portrait card trimmed to the shape Instagram will actually publish.

    Meta validates the aspect ratio of a feed image and refuses anything below 4:5 outright
    (36003 / 2207009), so the 3:4 card cannot be posted as it is drawn. The layout keeps its
    top and bottom `PORTRAIT_BLEED` bands free of content precisely so this crop costs nothing.
    Pass ratio="3:4" to post the full card once Meta accepts it - `instagram-probe` says when.
    """
    if ratio == "3:4":
        return card
    with Image.open(card) as im:
        w, h = im.size
        target = int(round(w / 0.8)) if ratio == "4:5" else int(round(w / 1.0))
        if h <= target:
            return card
        top = (h - target) // 2
        crop = im.convert("RGB").crop((0, top, w, top + target))
    return _save(crop, out_path or card.with_name(card.stem.replace("-portrait", "-instagram") + ".jpg"))


def resize_to(card: Path, size: tuple[int, int], out_path: Path) -> Path:
    """Force a card to an exact size, for probing what a platform accepts."""
    with Image.open(card) as im:
        out = im.convert("RGB").resize(size, Image.LANCZOS)
    return _save(out, out_path)
