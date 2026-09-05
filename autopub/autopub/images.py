"""Generate branded share images (landscape for OG/Twitter/FB/LinkedIn, square for IG/Threads/Pinterest)."""
from __future__ import annotations

import io
import logging
import textwrap
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .config import Site

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


def _backdrop(url: str, size: tuple[int, int], timeout: int = 20) -> Image.Image | None:
    try:
        resp = requests.get(url, timeout=timeout, headers={"User-Agent": "autopub/0.1"})
        resp.raise_for_status()
        img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        log.debug("backdrop fetch failed %s: %s", url, exc)
        return None
    # cover-fit then blur + darken so text stays legible
    w, h = size
    scale = max(w / img.width, h / img.height)
    img = img.resize((int(img.width * scale) + 1, int(img.height * scale) + 1))
    left, top = (img.width - w) // 2, (img.height - h) // 2
    img = img.crop((left, top, left + w, top + h)).filter(ImageFilter.GaussianBlur(6))
    overlay = Image.new("RGB", size, (0, 0, 0))
    return Image.blend(img, overlay, 0.55)


def render_card(headline: str, kicker: str, site: Site, out_path: Path, variant: str = "landscape",
                backdrop_url: str | None = None) -> Path:
    size = SIZES[variant]
    w, h = size
    primary = hex_to_rgb(site.brand.primary)
    accent = hex_to_rgb(site.brand.accent)
    text_color = hex_to_rgb(site.brand.text)

    img = None
    if backdrop_url:
        img = _backdrop(backdrop_url, size)
    if img is None:
        img = _gradient(size, primary, _darken(primary, 0.45))

    draw = ImageDraw.Draw(img, "RGBA")
    # decorative accent shapes
    draw.polygon([(w * 0.72, 0), (w, 0), (w, h * 0.55)], fill=(*accent, 38))
    draw.ellipse([w * 0.78, h * 0.62, w * 1.15, h * 1.2], fill=(*accent, 28))
    draw.rectangle([0, h - 14, w, h], fill=accent)

    margin = int(w * 0.075)
    y = int(h * 0.14) if variant == "landscape" else int(h * 0.16)

    # kicker pill
    kicker = (kicker or site.category).strip().upper()[:28]
    kfont = _font(int(w * 0.022), bold=True)
    kw = draw.textlength(kicker, font=kfont)
    pad = int(w * 0.012)
    draw.rounded_rectangle([margin, y, margin + kw + pad * 2, y + kfont.size + pad * 2], radius=8, fill=accent)
    draw.text((margin + pad, y + pad), kicker, font=kfont, fill=_darken(primary, 0.7))
    y += kfont.size + pad * 2 + int(h * 0.05)

    # headline
    footer_h = int(h * 0.16)
    hfont, lines, line_h = _fit_headline(draw, headline.strip(), w - margin * 2, h - y - footer_h,
                                          start=int(w * (0.062 if variant == "landscape" else 0.066)))
    for line in lines:
        draw.text((margin + 2, y + 3), line, font=hfont, fill=(0, 0, 0, 110))
        draw.text((margin, y), line, font=hfont, fill=text_color)
        y += line_h

    # footer: site name + domain
    nfont = _font(int(w * 0.028), bold=True)
    dfont = _font(int(w * 0.02), bold=False)
    fy = h - footer_h + int(h * 0.02)
    draw.text((margin, fy), site.name, font=nfont, fill=text_color)
    draw.text((margin, fy + nfont.size + 6), site.domain, font=dfont, fill=(*text_color, 200))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out_path, "JPEG", quality=88, optimize=True)
    return out_path


def render_set(headline: str, kicker: str, site: Site, out_dir: Path, stem: str,
               backdrop_url: str | None = None) -> dict[str, Path]:
    return {
        variant: render_card(headline, kicker, site, out_dir / f"{stem}-{variant}.jpg", variant, backdrop_url)
        for variant in SIZES
    }
