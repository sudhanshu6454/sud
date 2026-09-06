"""Generate cover / share images.

Two shapes per story:
  landscape 1200x630 - the WordPress featured image and the OG/Twitter/FB/LinkedIn card
  square    1080x1080 - Instagram / Threads / Pinterest

When the source article has a photo it is used as the actual cover: sharp, cover-fitted, with the
site's real logo on a plate in the corner. The landscape cover carries no headline (the title sits
next to it on the page and in link previews); the square adds the headline over a soft bottom
gradient because Instagram shows no title. Without a photo we fall back to a branded gradient card.
Every output is a progressive, optimised JPEG.
"""
from __future__ import annotations

import io
import logging
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

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


def _cover_fit(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    w, h = size
    scale = max(w / img.width, h / img.height)
    img = img.resize((int(img.width * scale) + 1, int(img.height * scale) + 1), Image.LANCZOS)
    left, top = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((left, top, left + w, top + h))


def _backdrop(url: str, size: tuple[int, int], timeout: int = 20) -> Image.Image | None:
    """The article's own photo, sharp and cover-fitted. None when it cannot be used."""
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
    return _cover_fit(img, size)


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


def _paste_logo_plate(img: Image.Image, logo_path: str, domain: str, primary: tuple[int, int, int]) -> None:
    """Bottom-left plate carrying the real brand PNG, so the mark reads over any photo."""
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
    x0, y0 = margin, h - margin - plate_h
    draw.rectangle([x0, y0, x0 + plate_w, y0 + plate_h], fill=plate_color)
    img.paste(logo, (x0 + pad, y0 + pad), logo)
    # domain text must contrast with the plate whatever its colour (cream plates -> ink text, ink plates -> cream text)
    if _luma(plate_color) > 128:
        text_color = tuple(int(c * 0.55) for c in plate_color)
    else:
        text_color = tuple(int(c + (235 - c) * 0.9) for c in plate_color)
    draw.text((x0 + pad * 2 + logo_w, y0 + (plate_h - font.size) // 2 - 2), domain, font=font, fill=text_color)


def _draw_footer(img: Image.Image, site: Site, primary, text_color, footer_h: int, margin: int) -> None:
    if site.brand.logo:
        _paste_logo_plate(img, site.brand.logo, site.domain, primary)
        return
    w, h = img.size
    draw = ImageDraw.Draw(img, "RGBA")
    nfont = _font(int(w * 0.028), bold=True)
    dfont = _font(int(w * 0.02), bold=False)
    fy = h - footer_h + int(h * 0.02)
    draw.text((margin, fy), site.name, font=nfont, fill=text_color)
    draw.text((margin, fy + nfont.size + 6), site.domain, font=dfont, fill=(*text_color, 200))


def _draw_kicker(draw: ImageDraw.ImageDraw, kicker: str, x: int, y: int, w: int, accent, primary) -> int:
    kicker = kicker.strip().upper()[:28]
    kfont = _font(int(w * 0.022), bold=True)
    kw = draw.textlength(kicker, font=kfont)
    pad = int(w * 0.012)
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
    kicker = kicker or site.category

    photo = _backdrop(backdrop_url, size) if backdrop_url else None
    if photo is not None:
        return _render_photo_cover(photo, headline, kicker, site, out_path, variant, primary, accent, margin)

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
                        primary, accent, margin: int) -> Path:
    """The actual article photo as the cover, with the brand on it."""
    img = photo
    w, h = img.size
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
        _draw_kicker(draw, kicker, margin, int(h * 0.08), w, accent, primary)
    _draw_footer(img, site, primary, (255, 255, 255), int(h * 0.16), margin)
    return _save(img, out_path)


def render_set(headline: str, kicker: str, site: Site, out_dir: Path, stem: str,
               backdrop_url: str | None = None) -> dict[str, Path]:
    return {
        variant: render_card(headline, kicker, site, out_dir / f"{stem}-{variant}.jpg", variant, backdrop_url)
        for variant in SIZES
    }
