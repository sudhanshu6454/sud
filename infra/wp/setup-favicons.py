#!/usr/bin/env python3
"""Build every site's favicon / site icon from its real brand mark.

Writes, per site key in sites.yaml:
  autopub/config/brand/favicon-<key>.png   512x512 - uploaded by init-sites.sh as the WordPress
                                            site icon (WordPress derives 32/180/192/270px from it)
  themes/<theme>/assets/img/favicon.png     32x32  - fallback <link rel="icon"> in the theme header,
                                            used until the site icon is set

Run from the repo root:  python3 infra/wp/setup-favicons.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SIZE = 512

# key -> (theme dir, source mark, background or None to use the mark as-is, mark width fraction, tint or None)
# tint recolours a single-colour transparent mark (the alpha channel is the shape).
ICONS = {
    "JUNKIES":   ("marketing-junkies",   "themes/marketing-junkies/assets/img/site-icon.png", None,      1.0,  None),
    "MENTALIST": ("marketing-mentalist", "themes/marketing-mentalist/assets/img/mark.png",    "#0a0908", 0.72, "#f7f5ef"),
    "CRAZY":     ("crazy4marketing",     "themes/crazy4marketing/assets/symbol_dark.png",     "#0a0a0a", 0.86, None),
}


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def build(mark_path: Path, background: str | None, mark_frac: float, tint: str | None) -> Image.Image:
    mark = Image.open(mark_path).convert("RGBA")
    if tint:  # recolour the dark (ink) pixels only, so an accent such as the bow-tie's red knot is kept
        dark = mark.convert("L").point(lambda v: 255 if v < 128 else 0)
        mark.paste(Image.new("RGB", mark.size, hex_to_rgb(tint)), (0, 0), dark)
    if background is None:
        return mark.resize((SIZE, SIZE), Image.LANCZOS).convert("RGB")
    bbox = mark.getbbox()
    if bbox:
        mark = mark.crop(bbox)
    scale = SIZE * mark_frac / max(mark.width, mark.height)
    mark = mark.resize((max(1, int(mark.width * scale)), max(1, int(mark.height * scale))), Image.LANCZOS)
    icon = Image.new("RGBA", (SIZE, SIZE), (*hex_to_rgb(background), 255))
    icon.paste(mark, ((SIZE - mark.width) // 2, (SIZE - mark.height) // 2), mark)
    return icon.convert("RGB")


def main() -> None:
    brand_dir = ROOT / "autopub" / "config" / "brand"
    brand_dir.mkdir(parents=True, exist_ok=True)
    for key, (theme, mark, background, frac, tint) in ICONS.items():
        icon = build(ROOT / mark, background, frac, tint)
        site_icon = brand_dir / f"favicon-{key.lower()}.png"
        icon.save(site_icon, "PNG", optimize=True)
        small = ROOT / "themes" / theme / "assets" / "img" / "favicon.png"
        small.parent.mkdir(parents=True, exist_ok=True)
        icon.resize((32, 32), Image.LANCZOS).save(small, "PNG", optimize=True)
        print(f"{key:9s} {site_icon.relative_to(ROOT)} ({site_icon.stat().st_size // 1024} KB)  ->  {small.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
