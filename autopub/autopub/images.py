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
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFilter, ImageFont

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

log = logging.getLogger(__name__)

FONT_CANDIDATES_BOLD = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]
FONT_CANDIDATES_REGULAR = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]

SIZES = {"landscape": (1200, 630), "square": (1080, 1080)}
JPEG_QUALITY = 82          # visually lossless for photos at these sizes, ~35% smaller than q88
MAX_BACKDROP_BYTES = 15 * 1024 * 1024


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES_BOLD if bold else FONT_CANDIDATES_REGULAR:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # very old Pillow
        return ImageFont.load_default()


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


def _fit_headline(draw, text: str, max_width: int, max_height: int, start: int, minimum: int = 34):
    size = start
    while size >= minimum:
        font = _font(size, bold=True)
        lines = _wrap(draw, text, font, max_width)
        line_h = int(size * 1.18)
        if len(lines) * line_h <= max_height and all(draw.textlength(l, font=font) <= max_width for l in lines):
            return font, lines, line_h
        size -= 4
    font = _font(minimum, bold=True)
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


def _backdrop(url: str, size: tuple[int, int], timeout: int = 20,
              clear_bottom: float = 0.0) -> tuple[Image.Image, Box | None] | None:
    """The article's own photo, cover-fitted around its people. None when it cannot be used."""
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
    faces = _detect_faces(img)
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


def _load_logo(logo_path: str) -> tuple[Image.Image, tuple[int, int, int] | None]:
    """Return the logo as RGBA and the plate colour it was designed to sit on (None = transparent)."""
    logo = Image.open(logo_path).convert("RGBA")
    corner = logo.getpixel((1, 1))
    if corner[3] < 128:  # transparent logo: it sits on whatever plate we choose
        return logo, None
    return logo, corner[:3]


def _paste_logo_plate(img: Image.Image, logo_path: str, domain: str, primary: tuple[int, int, int],
                      side: str = "left") -> None:
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
    font = _font(max(14, int(logo_h * 0.40)), bold=False)
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
    if site.brand.logo:
        _paste_logo_plate(img, site.brand.logo, site.domain, primary, side)
        return
    w, h = img.size
    draw = ImageDraw.Draw(img, "RGBA")
    nfont = _font(int(w * 0.028), bold=True)
    dfont = _font(int(w * 0.02), bold=False)
    fy = h - footer_h + int(h * 0.02)
    draw.text((margin, fy), site.name, font=nfont, fill=text_color)
    draw.text((margin, fy + nfont.size + 6), site.domain, font=dfont, fill=(*text_color, 200))


def _draw_kicker(draw: ImageDraw.ImageDraw, kicker: str, x: int, y: int, w: int, accent, primary, side: str = "left") -> int:
    kicker = kicker.strip().upper()[:28]
    kfont = _font(int(w * 0.022), bold=True)
    kw = draw.textlength(kicker, font=kfont)
    pad = int(w * 0.012)
    if side == "right":
        x = w - x - int(kw) - pad * 2   # mirror: `x` is the margin
    draw.rounded_rectangle([x, y, x + kw + pad * 2, y + kfont.size + pad * 2], radius=8, fill=accent)
    draw.text((x + pad, y + pad), kicker, font=kfont, fill=_darken(primary, 0.7))
    return kfont.size + pad * 2


def _save(img: Image.Image, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out_path, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    return out_path


def render_card(headline: str, kicker: str, site: Site, out_path: Path, variant: str = "landscape",
                backdrop_url: str | None = None) -> Path:
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

    y = int(h * 0.14) if variant == "landscape" else int(h * 0.16)
    y += _draw_kicker(draw, kicker, margin, y, w, accent, primary) + int(h * 0.05)

    footer_h = int(h * 0.20)
    hfont, lines, line_h = _fit_headline(draw, headline.strip(), w - margin * 2, h - y - footer_h,
                                          start=int(w * (0.062 if variant == "landscape" else 0.066)))
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
    kicker_side, plate_side = _overlay_sides(faces, w, h)
    if variant == "square":
        # Instagram shows no title, so the headline goes on the card over a soft gradient
        _shade_bottom(img, 0.38, 0.88)
        draw = ImageDraw.Draw(img, "RGBA")
        plate_h = int(h * 0.10) + int(h * 0.10 * 0.56)
        bottom = h - int(w * 0.05) - plate_h - int(h * 0.035)
        hfont, lines, line_h = _fit_headline(draw, headline.strip(), w - margin * 2, int(h * 0.36), start=int(w * 0.058), minimum=36)
        y = bottom - len(lines) * line_h
        ky = y - int(h * 0.03) - int(w * 0.022) - int(w * 0.012) * 2
        _draw_kicker(draw, kicker, margin, ky, w, accent, primary)
        for line in lines:
            draw.text((margin + 2, y + 3), line, font=hfont, fill=(0, 0, 0, 140))
            draw.text((margin, y), line, font=hfont, fill=(255, 255, 255))
            y += line_h
    else:
        # featured / OG image: the photo itself, lightly grounded at the bottom so the plate sits naturally
        _shade_bottom(img, 0.55, 0.45)
        draw = ImageDraw.Draw(img, "RGBA")
        _draw_kicker(draw, kicker, margin, int(h * 0.08), w, accent, primary, kicker_side)
    _draw_footer(img, site, primary, (255, 255, 255), int(h * 0.16), margin, plate_side if variant != "square" else "left")
    return _save(img, out_path)


def render_set(headline: str, kicker: str, site: Site, out_dir: Path, stem: str,
               backdrop_url: str | None = None) -> dict[str, Path]:
    return {
        variant: render_card(headline, kicker, site, out_dir / f"{stem}-{variant}.jpg", variant, backdrop_url)
        for variant in SIZES
    }
