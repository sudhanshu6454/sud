"""The poster: a film still with a centred uppercase title, the handle above, the mark below.

The share-image family for a site whose brand says `style: poster` (Filmybuff). Where the news
cards put a photo above a panel of type, the poster is the photo: the still runs full bleed, is
graded dark and warm so type can sit on it, and carries the handle small at the top, the title
centred and set heavy in the paper colour, one tracked subline under it, and the site's lockup at
the bottom. A carousel cover adds "swipe for more". A card without a usable still keeps the same
type on the brand's ink ground with the red square as its only ornament, so the grid still reads
as one account.

Slides follow the same grammar: a number in the accent, the heading uppercase and centred, the
body in reading type, on a still when the slide has one (a watchlist entry with a film poster) or
the ink ground when it does not. The closing slide is the lockup, large.

Every shape keeps the top and bottom bleed bands clear, as the cards do, so the 4:5 asset
Instagram accepts is a straight centre trim of the 3:4 master.
"""
from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from . import images
from .cards import CardBrief
from .config import Site
from .images import (CARD_SCALE, IG_RATIOS, SIZES, _backdrop, _download_photo, _font, _load_logo, _save, _spell_out,
                     _wrap, hex_to_rgb, tidy)

log = logging.getLogger(__name__)

MASTER = (int(SIZES["portrait"][0] * CARD_SCALE), int(SIZES["portrait"][1] * CARD_SCALE))   # 1440x1920, 3:4
TITLE_LADDER = [(24, 148), (40, 124), (60, 104), (80, 90), (10 ** 6, 78)]   # (max chars, size) at master scale
GRADE_WARMTH = (14, 6, -10)         # the still is pushed a little towards amber, like a print
GRADE_DARKEN = 0.72                 # and darkened, so paper type reads on it everywhere
VIGNETTE = 0.55                     # how much darker the edges go than the centre


# ---- ground --------------------------------------------------------------------------------------------

def _grade(photo: Image.Image) -> Image.Image:
    """The reference grid's look: darker, warmer, a soft vignette, a shade more at top and bottom."""
    w, h = photo.size
    img = photo.convert("RGB")
    r, g, b = img.split()
    img = Image.merge("RGB", (r.point(lambda v: min(255, int(v * GRADE_DARKEN) + GRADE_WARMTH[0])),
                              g.point(lambda v: min(255, int(v * GRADE_DARKEN) + GRADE_WARMTH[1])),
                              b.point(lambda v: max(0, int(v * GRADE_DARKEN) + GRADE_WARMTH[2]))))
    # vignette: a soft radial mask multiplied in
    mask = Image.new("L", (w // 8, h // 8), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse([-mask.width * 0.15, -mask.height * 0.1, mask.width * 1.15, mask.height * 1.1], fill=255)
    mask = mask.resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(w // 10))
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    img = Image.composite(img, Image.blend(img, dark, VIGNETTE), mask)
    # the top and bottom bands: where the handle, the title and the mark sit
    band = Image.new("L", (1, h))
    for y in range(h):
        t = y / h
        v = 0
        if t < 0.42:
            v = int(150 * (1 - t / 0.42) ** 1.6)
        elif t > 0.70:
            v = int(190 * ((t - 0.70) / 0.30) ** 1.3)
        band.putpixel((0, y), min(255, v))
    img.paste(dark, (0, 0), band.resize((w, h)))
    return img


def _ink_ground(size: tuple[int, int], ink, accent) -> Image.Image:
    """No still: the brand's ink, a faint grain, the red square high on the left as the kit places it."""
    w, h = size
    img = Image.new("RGB", (w, h), ink)
    import numpy as np   # a fixed seed: the same ground every time, so two frames of one reel match to the pixel
    grain = np.random.default_rng(7).integers(96, 160, size=(h // 4, w // 4), dtype=np.uint8)
    noise = Image.fromarray(grain, "L").resize((w, h), Image.BILINEAR)
    img.paste(Image.new("RGB", (w, h), tuple(min(255, c + 10) for c in ink)), (0, 0), noise.point(lambda v: int(v * 0.35)))
    d = ImageDraw.Draw(img)
    s = int(w * 0.03)
    d.rectangle([int(w * 0.075), int(h * 0.075) + int(h * 0.05), int(w * 0.075) + s, int(h * 0.075) + int(h * 0.05) + s], fill=accent)
    return img


def _ground(photo_url: str | None, size: tuple[int, int], ink, accent) -> tuple[Image.Image, bool]:
    """The graded still cover-fitted around its people, or the ink ground. Second value: whether a still is there."""
    if photo_url:
        got = _backdrop(photo_url, size, clear_bottom=0.0)
        if got is not None:
            return _grade(got[0]), True
    return _ink_ground(size, ink, accent), False


# ---- type ----------------------------------------------------------------------------------------------

def _title_lines(draw, title: str, family, column: int, scale: float, weight: int = 900):
    """The title uppercase, centred, as large as the column allows: size by length, then wrap."""
    text = _spell_out(tidy(title), family).upper()
    size = next(s for limit, s in TITLE_LADDER if len(text) <= limit)
    while True:
        font = _font(int(size * scale), bold=True, family=family, weight=weight)
        lines = _wrap(draw, text, font, column)
        if len(lines) <= 4 or size <= 60:
            return font, lines, int(font.size * 0.98)
        size -= 8


def _centred(draw, y: int, lines: list[str], font, line_h: int, fill, w: int, shadow: bool = True) -> int:
    for line in lines:
        tw = draw.textlength(line, font=font)
        x = (w - tw) / 2
        if shadow:
            draw.text((x + 2, y + 3), line, font=font, fill=(0, 0, 0, 130))
        draw.text((x, y), line, font=font, fill=fill)
        y += line_h
    return y


def _tracked_centre(draw, y: int, text: str, font, fill, w: int, track: float = 0.16) -> None:
    """Small uppercase type with letter-spacing, centred: the handle and the sublines."""
    text = text.upper()
    gap = font.size * track
    total = sum(draw.textlength(ch, font=font) for ch in text) + gap * (len(text) - 1)
    x = (w - total) / 2
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + gap


def _strike(draw, y: int, text: str, prefix: str, font, fill, accent, w: int, track: float) -> None:
    """The subline with its first `prefix` letters struck through in the accent: UN-popular opinion."""
    text = text.upper()
    gap = font.size * track
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + gap * (len(text) - 1)
    x = (w - total) / 2
    x0 = x
    for i, ch in enumerate(text):
        draw.text((x, y), ch, font=font, fill=fill)
        if i == len(prefix) - 1:
            x1 = x + widths[i]
            mid = y + font.size * 0.55
            draw.line([(x0 - gap / 2, mid + font.size * 0.14), (x1 + gap / 2, mid - font.size * 0.16)], fill=accent, width=max(4, int(font.size * 0.22)))
        x += widths[i] + gap


def _swipe(draw, right: int, y_bottom: int, font, fill) -> None:
    """'SWIPE' with a drawn arrow (the brand face has no arrow glyph), right edge at `right`, bottom at `y_bottom`."""
    label = "SWIPE"
    tw = draw.textlength(label, font=font)
    arrow = int(font.size * 1.6)
    x = right - arrow - tw - int(font.size * 0.5)
    y = y_bottom - font.size
    draw.text((x, y), label, font=font, fill=fill)
    ax, ay = x + tw + int(font.size * 0.5), y + int(font.size * 0.55)
    width = max(2, int(font.size * 0.12))
    draw.line([(ax, ay), (ax + arrow, ay)], fill=fill, width=width)
    draw.line([(ax + arrow - int(font.size * 0.45), ay - int(font.size * 0.4)), (ax + arrow, ay),
               (ax + arrow - int(font.size * 0.45), ay + int(font.size * 0.4))], fill=fill, width=width)


def _mark(img: Image.Image, site: Site, y_bottom: int, height: int, paper) -> None:
    """The lockup, centred, its bottom at y_bottom; the site name in type when there is no mark."""
    w = img.width
    if site.brand.logo:
        logo, _plate = _load_logo(site.brand.logo)
        lw = int(logo.width * (height / logo.height))
        logo = logo.resize((max(1, lw), height), Image.LANCZOS)
        img.paste(logo, ((w - lw) // 2, y_bottom - height), logo)
    else:
        draw = ImageDraw.Draw(img)
        font = _font(height, bold=True, family=site.brand.font, weight=900)
        draw.text(((w - draw.textlength(site.name, font=font)) / 2, y_bottom - height), site.name, font=font, fill=paper)


# ---- the card ------------------------------------------------------------------------------------------

def _texts(card: CardBrief | None, headline: str, kicker: str, standfirst: str | None) -> tuple[str, str | None, str | None]:
    """What goes on the poster for each card kind: (title, subline, strike prefix)."""
    if card is None:
        # a short standfirst is the reference's descriptive subline ("coming of age cinema"); a long one is the
        # headline running under a hook, which the poster has no room for, so the section stands in
        sub = standfirst.strip() if standfirst and len(standfirst.strip()) <= 70 else kicker
        return headline, sub, ("UN" if (kicker or "").lower().startswith("unpopular") else None)
    k = (card.kicker or kicker or "").strip()
    strike = "UN" if k.lower().startswith("unpopular") else None
    if card.kind == "quote" and card.quote:
        return f"“{card.quote}”", (k if strike else card.quote_by or k), strike
    if card.kind == "stat" and card.stat:
        return card.stat, card.stat_label or k, None
    if card.kind == "question" and card.question:
        return card.question, k, None
    if card.kind == "scorecard":
        return card.headline, card.standfirst.split("|")[0].strip() if card.standfirst else k, None
    return card.headline or headline, k, strike


FEATURED = (1600, 1200)     # the website's featured image: 4:3, so the theme's 16:9 hero and 2:3 posters both crop well


def featured(site: Site, out_path: Path, backdrop_url: str | None = None) -> Path:
    """The website's image: the still itself, lightly graded, with no type on it. The theme sets the
    title over it and crops it into posters, so a title baked in would double up and be sliced."""
    ink, accent = hex_to_rgb(site.brand.primary), hex_to_rgb(site.brand.accent)
    got = _backdrop(backdrop_url, FEATURED, clear_bottom=0.0) if backdrop_url else None
    if got is None:
        img = _ink_ground(FEATURED, ink, accent)
        _mark(img, site, int(FEATURED[1] * 0.62), int(FEATURED[1] * 0.2), hex_to_rgb(site.brand.text))
        return _save(img, out_path, quality=90)
    img = got[0].convert("RGB")
    r, g, b = img.split()
    img = Image.merge("RGB", (r.point(lambda v: min(255, int(v * 0.94) + 8)), g.point(lambda v: min(255, int(v * 0.94) + 3)),
                              b.point(lambda v: max(0, int(v * 0.94) - 6))))
    return _save(img, out_path, quality=90)


def card(headline: str, kicker: str, site: Site, out_path: Path, variant: str = "portrait",
         backdrop_url: str | None = None, standfirst: str | None = None, credit: str | None = None,
         card: CardBrief | None = None, swipe: bool = False) -> Path:
    """One poster at the size `variant` names (square, portrait); the portrait is the 3:4 master. The
    landscape shape is the website's featured image and carries no type (see `featured`)."""
    if variant == "landscape":
        return featured(site, out_path, backdrop_url)
    size = MASTER if variant == "portrait" else SIZES[variant]
    w, h = size
    scale = w / MASTER[0] if variant == "portrait" else (w / 1080)
    ink, accent, paper = hex_to_rgb(site.brand.primary), hex_to_rgb(site.brand.accent), hex_to_rgb(site.brand.text)
    img, has_still = _ground(backdrop_url, size, ink, accent)
    draw = ImageDraw.Draw(img, "RGBA")
    family = site.brand.font
    title, subline, strike = _texts(card, headline, kicker, standfirst)
    bleed = int(round(images.PORTRAIT_BLEED * CARD_SCALE)) if variant == "portrait" else 0
    margin = int(w * 0.08)
    column = w - margin * 2

    # the handle, small and tracked, at the top
    hfont = _font(int(24 * scale) if variant == "portrait" else int(20 * scale), bold=True, family=family, weight=700)
    handle_y = bleed + int(h * 0.055)
    _tracked_centre(draw, handle_y, site.name.replace(" ", ""), hfont, tuple(int(c * 0.85) for c in paper), w, track=0.22)

    # the title, centred, in the upper third of the frame (the reference sets it high, over the still's dark band)
    tfont, tlines, tline_h = _title_lines(draw, title, family, column, scale if variant != "portrait" else 1.0)
    if variant != "portrait":
        tfont, tlines, tline_h = _title_lines(draw, title, family, column, scale * 0.78)
    block = len(tlines) * tline_h
    if has_still:
        y = handle_y + int(h * (0.08 if variant == "portrait" else 0.10))
    else:
        y = max(handle_y + int(h * 0.08), (h - block) // 2 - int(h * 0.06))
    y = _centred(draw, y, tlines, tfont, tline_h, paper, w)
    if subline:
        sfont = _font(int((32 if variant == "portrait" else 18) * (1.0 if variant == "portrait" else scale)), bold=True, family=family, weight=700)
        sy = y + int(h * 0.012)
        sub = _wrap(draw, subline, sfont, int(column * 0.8))[:2]
        for i, line in enumerate(sub):
            if strike and i == 0:
                _strike(draw, sy, line, strike, sfont, paper, accent, w, 0.12)
            else:
                _tracked_centre(draw, sy, line, sfont, tuple(int(c * 0.88) for c in paper), w, track=0.12)
            sy += int(sfont.size * 1.5)

    # the mark at the bottom, and the swipe cue beside it on a carousel cover
    mark_h = int(h * (0.052 if variant == "portrait" else 0.075))
    mark_bottom = h - bleed - int(h * 0.055)
    _mark(img, site, mark_bottom, mark_h, paper)
    if swipe:
        cfont = _font(int(20 * scale) if variant == "portrait" else int(16 * scale), bold=True, family=family, weight=700)
        _swipe(draw, w - margin, mark_bottom - int(mark_h * 0.2), cfont, tuple(int(c * 0.8) for c in paper))
    if credit and has_still and variant == "portrait":
        cfont = _font(18, bold=False, family=family)
        draw.text((margin, mark_bottom - cfont.size - int(mark_h * 0.2)), credit[:60], font=cfont, fill=(*paper, 120))
    return _save(img, out_path, quality=90)


# ---- slides --------------------------------------------------------------------------------------------

def slide(heading: str, body: str, index: int, total: int, site: Site, out_path: Path, kicker: str | None = None,
          photo_url: str | None = None) -> Path:
    """A content slide: the number in the accent, the heading uppercase and centred, the body under it.
    On the still when the slide has one (a film's poster or backdrop), on the ink ground otherwise."""
    w, h = MASTER
    ink, accent, paper = hex_to_rgb(site.brand.primary), hex_to_rgb(site.brand.accent), hex_to_rgb(site.brand.text)
    img, has_still = _ground(photo_url, MASTER, ink, accent)
    draw = ImageDraw.Draw(img, "RGBA")
    family = site.brand.font
    bleed = int(round(images.PORTRAIT_BLEED * CARD_SCALE))
    margin = int(w * 0.08)
    column = w - margin * 2
    hfont = _font(24, bold=True, family=family, weight=700)
    _tracked_centre(draw, bleed + int(h * 0.055), f"{site.name.replace(' ', '')}   {index}/{total}", hfont,
                    tuple(int(c * 0.85) for c in paper), w, track=0.22)
    nfont = _font(150, bold=True, family=family, weight=900)
    num = f"{index:02d}"
    y = bleed + int(h * 0.15)
    draw.text(((w - draw.textlength(num, font=nfont)) / 2, y), num, font=nfont, fill=accent)
    y += int(nfont.size * 1.0)
    tfont, tlines, tline_h = _title_lines(draw, heading, family, column, 0.72)
    y = _centred(draw, y, tlines, tfont, tline_h, paper, w)
    y += int(h * 0.02)
    bfont = _font(38, bold=False, family=family, weight=450)
    room = (h - bleed - int(h * 0.16) - y) // 54
    blines = _wrap(draw, _spell_out(tidy(body), family), bfont, int(column * 0.86))
    if len(blines) > room:
        blines = blines[:max(1, room)]
        blines[-1] = blines[-1].rstrip(",;:- ") + "…"
    for line in blines:
        draw.text(((w - draw.textlength(line, font=bfont)) / 2, y), line, font=bfont, fill=tuple(int(c * 0.9) for c in paper))
        y += 54
    _mark(img, site, h - bleed - int(h * 0.055), int(h * 0.045), paper)
    if index < total:
        cfont = _font(20, bold=True, family=family, weight=700)
        _swipe(draw, w - margin, h - bleed - int(h * 0.055) - 8, cfont, tuple(int(c * 0.8) for c in paper))
    return images._to_feed_ratio(img, out_path)


def closing(headline: str, site: Site, out_path: Path) -> Path:
    """The last slide: the lockup large, the title as a reminder, the way to the site."""
    w, h = MASTER
    ink, accent, paper = hex_to_rgb(site.brand.primary), hex_to_rgb(site.brand.accent), hex_to_rgb(site.brand.text)
    img = _ink_ground(MASTER, ink, accent)
    draw = ImageDraw.Draw(img, "RGBA")
    family = site.brand.font
    bleed = int(round(images.PORTRAIT_BLEED * CARD_SCALE))
    margin = int(w * 0.08)
    _mark(img, site, int(h * 0.50), int(h * 0.16), paper)
    y = int(h * 0.55)
    sfont = _font(26, bold=True, family=family, weight=700)
    _tracked_centre(draw, y, "Read the full story", sfont, tuple(int(c * 0.85) for c in paper), w, track=0.14)
    y += int(sfont.size * 2.2)
    tfont, tlines, tline_h = _title_lines(draw, headline, family, w - margin * 2, 0.5)
    y = _centred(draw, y, tlines, tfont, tline_h, tuple(int(c * 0.8) for c in paper), w, shadow=False)
    y += int(h * 0.03)
    dfont = _font(52, bold=True, family=family, weight=800)
    draw.text(((w - draw.textlength(site.domain, font=dfont)) / 2, y), site.domain, font=dfont, fill=accent)
    y += dfont.size + 20
    _tracked_centre(draw, y, "Link in bio", sfont, paper, w, track=0.14)
    return images._to_feed_ratio(img, out_path)


def frame(kicker: str, title: str, credit: str, site: Site, out_path: Path) -> Path:
    """The reel frame the film plays inside (adclip.compose): the story-sized ink ground with the handle at
    the top, the title uppercase and centred above the window, the credit under it, the lockup at the bottom.
    The window itself (images.AD_WINDOW_TOP / AD_WINDOW_H) stays clear."""
    w, h = images.STORY_SIZE
    ink, accent, paper = hex_to_rgb(site.brand.primary), hex_to_rgb(site.brand.accent), hex_to_rgb(site.brand.text)
    img = _ink_ground((w, h), ink, accent)
    draw = ImageDraw.Draw(img, "RGBA")
    family = site.brand.font
    margin = int(w * 0.08)
    column = w - margin * 2
    top = images.STORY_SAFE + 20
    hfont = _font(26, bold=True, family=family, weight=700)
    _tracked_centre(draw, top + 20, f"{site.name.replace(' ', '')}   ·   {kicker}", hfont, tuple(int(c * 0.85) for c in paper), w, track=0.2)
    tfont, tlines, tline_h = _title_lines(draw, title, family, column, 0.9)
    tlines = tlines[:3]
    block = len(tlines) * tline_h
    y = max(top + 90, images.AD_WINDOW_TOP - 60 - block)
    _centred(draw, y, tlines, tfont, tline_h, paper, w, shadow=False)
    cfont = _font(26, bold=False, family=family)
    cy = images.AD_WINDOW_TOP + images.AD_WINDOW_H + 40
    for line in _wrap(draw, credit, cfont, column)[:2]:
        draw.text(((w - draw.textlength(line, font=cfont)) / 2, cy), line, font=cfont, fill=tuple(int(c * 0.7) for c in paper))
        cy += 38
    _mark(img, site, h - images.STORY_SAFE - 40, 96, paper)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, format="PNG", optimize=True)
    return out_path


def still_for(url: str | None, timeout: int = 20) -> bool:
    """Whether a still URL can actually be used (downloads and is big enough)."""
    return bool(url) and _download_photo(url, timeout) is not None
