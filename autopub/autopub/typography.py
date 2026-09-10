"""Typefaces for the share cards.

Each site's card is set in the font its own website uses, so a post looks like that brand
rather than like a template: Instrument Sans for Marketing Mentalist, Space Grotesk for
Crazy4Marketing, Archivo for Marketing Junkies, Inter for ScreenStat. The files live in
`fonts/` next to this module (SIL Open Font License, see fonts/LICENSE-OFL.txt) and are
named in sites.yaml as `brand.font`.

Most of them are variable fonts, so one file covers every weight: `load()` sets the weight
axis rather than loading a second file. A site with no `brand.font`, or a font file that
will not load, falls back to DejaVu, which the container always has.
"""
from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

from PIL import ImageFont

log = logging.getLogger(__name__)

FONT_DIR = Path(__file__).parent / "fonts"

DEJAVU_BOLD = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]
DEJAVU_REGULAR = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]

BOLD = 700
REGULAR = 400


def _candidates(family: str, weight: int) -> list[Path]:
    """Where a family might live: one variable file, or per-weight static files."""
    style = "Bold" if weight >= 600 else "Regular"
    other = "Regular" if style == "Bold" else "Bold"
    return [FONT_DIR / f"{family}.ttf", FONT_DIR / f"{family}-{style}.ttf", FONT_DIR / f"{family}-{other}.ttf"]


def _set_axes(font: ImageFont.FreeTypeFont, weight: int, size: int) -> None:
    """Move a variable font to `weight`; a static font has no axes and keeps the one it has.

    Optical size moves with the point size too. Inter ships an `opsz` axis that defaults to 14:
    left alone, a 90px headline is drawn with the letterforms meant for body copy - looser, softer
    and visibly not what the website uses.
    """
    try:
        axes = font.get_variation_axes()
    except Exception:  # noqa: BLE001 - static font, or a Pillow built without variable support
        return
    if not axes:
        return
    values = []
    for axis in axes:
        raw = axis.get("name", "")
        name = raw.decode("utf-8", "replace").lower() if isinstance(raw, bytes) else str(raw).lower()
        lo, hi = axis.get("minimum", 0), axis.get("maximum", 0)
        want = {"weight": weight, "optical size": size}.get(name)
        values.append(max(lo, min(hi, want)) if want is not None else axis.get("default", lo))
    try:
        font.set_variation_by_axes(values)
    except Exception as exc:  # noqa: BLE001 - never fail a cover over a font axis
        log.debug("could not set font axes %s: %s", values, exc)


@lru_cache(maxsize=256)
def load(family: str | None, size: int, weight: int = BOLD) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """The brand font at `size`, or DejaVu when the site ships none.

    Cached: cards draw the same handful of sizes over and over, and building a FreeType face
    per line of text is the slowest part of rendering.
    """
    size = max(1, int(size))
    paths: list[Path] = list(_candidates(family, weight)) if family else []
    paths += [Path(p) for p in (DEJAVU_BOLD if weight >= 600 else DEJAVU_REGULAR)]
    for path in paths:
        if not path.exists():
            continue
        try:
            font = ImageFont.truetype(str(path), size)
        except OSError as exc:
            log.debug("font %s failed to load: %s", path, exc)
            continue
        if path.parent == FONT_DIR:
            _set_axes(font, weight, size)
        return font
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # pragma: no cover - very old Pillow
        return ImageFont.load_default()


def clear_cache() -> None:
    """Tests swap font files around; the cache must not outlive them."""
    load.cache_clear()
