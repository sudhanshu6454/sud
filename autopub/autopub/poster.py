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

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

from . import images
from .cards import CardBrief
from .config import Site
from .images import (CARD_SCALE, IG_RATIOS, SIZES, Box, _backdrop, _download_photo, _font, _load_logo, _save, _spell_out,
                     _wrap, hex_to_rgb, tidy)

log = logging.getLogger(__name__)

MASTER = (int(SIZES["portrait"][0] * CARD_SCALE), int(SIZES["portrait"][1] * CARD_SCALE))   # 1440x1920, 3:4
TITLE_LADDER = [(24, 148), (40, 124), (60, 104), (80, 90), (10 ** 6, 78)]   # (max chars, size) at master scale
# the look of the reference grid: a print, not a screen grab. Blacks lifted (a fade), highlights rolled
# off towards cream, a touch less colour, a gentle vignette, a little grain; the still stays bright and
# the type gets a soft local shadow behind it instead of a darkened frame.
GRADE_LIFT = 20                     # where black ends up (0-255): the fade
GRADE_GAIN = 0.86                   # how much of the range the still keeps above the lift
GRADE_WARMTH = (10, 4, -12)         # the cream cast, per channel
GRADE_COLOUR = 0.86                 # saturation kept
VIGNETTE = 0.30                     # how much darker the edges go than the centre
GRAIN = 0.07                        # the grain's strength on a still
CREAM = (243, 233, 190)             # the title's colour: the reference's pale yellow, not paper white
SCRIM = 0.55                        # the soft shadow behind the title, at its darkest


# ---- ground --------------------------------------------------------------------------------------------

def _grade(photo: Image.Image) -> Image.Image:
    """The reference grid's print look: lifted blacks, cream highlights, a little less colour, a gentle
    vignette, fine grain; a soft band at the very top and bottom for the handle and the mark only."""
    import numpy as np
    w, h = photo.size
    img = photo.convert("RGB")
    lut = [min(255, int(GRADE_LIFT + v * GRADE_GAIN)) for v in range(256)]
    r, g, b = img.split()
    img = Image.merge("RGB", (r.point([min(255, v + GRADE_WARMTH[0]) for v in lut]),
                              g.point([min(255, v + GRADE_WARMTH[1]) for v in lut]),
                              b.point([max(0, v + GRADE_WARMTH[2]) for v in lut])))
    img = ImageEnhance.Color(img).enhance(GRADE_COLOUR)
    # vignette: a soft radial mask multiplied in
    mask = Image.new("L", (w // 8, h // 8), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse([-mask.width * 0.2, -mask.height * 0.15, mask.width * 1.2, mask.height * 1.15], fill=255)
    mask = mask.resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(w // 8))
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    img = Image.composite(img, Image.blend(img, dark, VIGNETTE), mask)
    # grain: seeded, so two renders of one still match
    grain = np.random.default_rng(11).integers(0, 255, size=(h // 2, w // 2), dtype=np.uint8)
    noise = Image.fromarray(grain, "L").resize((w, h), Image.BILINEAR)
    img = Image.blend(img, Image.merge("RGB", (noise, noise, noise)), GRAIN * 0.5)
    # the bands the handle and the mark sit in, no deeper than they need
    band = Image.new("L", (1, h))
    for y in range(h):
        t = y / h
        v = 0
        if t < 0.16:
            v = int(120 * (1 - t / 0.16) ** 1.5)
        elif t > 0.80:
            v = int(170 * ((t - 0.80) / 0.20) ** 1.4)
        band.putpixel((0, y), min(255, v))
    img.paste(dark, (0, 0), band.resize((w, h)))
    return img


def _scrim(img: Image.Image, box: tuple[int, int, int, int], strength: float = SCRIM) -> None:
    """A soft dark shadow behind a block of type, wide and blurred enough to read as light, not a box."""
    w, h = img.size
    x0, y0, x1, y1 = box
    px, py = int((x1 - x0) * 0.35) + int(w * 0.06), int((y1 - y0) * 0.6) + int(h * 0.04)
    mask = Image.new("L", (w // 4, h // 4), 0)
    ImageDraw.Draw(mask).ellipse([(x0 - px) // 4, (y0 - py) // 4, (x1 + px) // 4, (y1 + py) // 4], fill=int(255 * strength))
    mask = mask.resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(int(w * 0.09)))
    img.paste(Image.new("RGB", (w, h), (0, 0, 0)), (0, 0), mask)


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


TITLE_ZONE = 0.44                   # the top fraction the handle, the title and the subline occupy: faces are kept out of it
SUBJECT_X = 0.72                    # where the subject goes, as a fraction of the width, when the title needs the other side


def _ground(photo_url: str | None, size: tuple[int, int], ink, accent) -> tuple[Image.Image, bool, Box | None]:
    """The graded still cover-fitted around its people (kept below the title zone when the still is tall
    enough), or the ink ground. Also whether a still is there, and where its faces sit in it."""
    if photo_url:
        got = _backdrop(photo_url, size, clear_bottom=0.0, clear_top=TITLE_ZONE)
        if got is not None and got[1] is not None and _overlap(got[1], 0, int(size[1] * TITLE_ZONE)) > 0.15:
            # the faces sit under the title and the still had no height to spare: set the subject to one
            # side instead, as the reference does, and the title goes in the room that leaves
            for fx in (SUBJECT_X, 1 - SUBJECT_X):
                aside = _backdrop(photo_url, size, clear_bottom=0.0, clear_top=TITLE_ZONE, focus_x=fx)
                if aside is not None and aside[1] is not None and abs((aside[1][0] + aside[1][2]) / 2 - size[0] * fx) < size[0] * 0.08:
                    got = aside
                    break
        if got is not None:
            return _grade(got[0]), True, got[1]
    return _ink_ground(size, ink, accent), False, None


def _overlap(faces: Box | None, top: int, bottom: int) -> float:
    """How much of the faces' height falls between `top` and `bottom`."""
    if not faces or len(faces) < 4 or faces[3] <= faces[1]:
        return 0.0
    return max(0, min(faces[3], bottom) - max(faces[1], top)) / (faces[3] - faces[1])


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
    _tracked(draw, y, text, font, fill, w, track, "centre", 0)


def _tracked(draw, y: int, text: str, font, fill, w: int, track: float, align: str, x_edge: int) -> None:
    """Tracked small caps centred on the frame, or set left from / right against `x_edge`."""
    text = text.upper()
    gap = font.size * track
    total = sum(draw.textlength(ch, font=font) for ch in text) + gap * (len(text) - 1)
    x = (w - total) / 2 if align == "centre" else (x_edge if align == "left" else x_edge - total)
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + gap


def _aligned(draw, y: int, lines: list[str], font, line_h: int, fill, w: int, align: str, x_edge: int) -> int:
    """The title lines centred, or ranged left from / right against `x_edge`, with the soft shadow."""
    for line in lines:
        tw = draw.textlength(line, font=font)
        x = (w - tw) / 2 if align == "centre" else (x_edge if align == "left" else x_edge - tw)
        draw.text((x + 2, y + 3), line, font=font, fill=(0, 0, 0, 130))
        draw.text((x, y), line, font=font, fill=fill)
        y += line_h
    return y


def _covered(faces: Box | None, box: tuple[int, int, int, int]) -> float:
    """How much of the faces' area a block of type would cover."""
    if not faces or len(faces) < 4:
        return 0.0
    fl, ft, fr, fb = faces
    area = max(1, (fr - fl) * (fb - ft))
    ix = max(0, min(fr, box[2]) - max(fl, box[0]))
    iy = max(0, min(fb, box[3]) - max(ft, box[1]))
    return ix * iy / area


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


def card(headline: str, kicker: str, site: Site, out_path: Path, variant: str = "portrait",
         backdrop_url: str | None = None, standfirst: str | None = None, credit: str | None = None,
         card: CardBrief | None = None, swipe: bool = False) -> Path:
    """One poster at the size `variant` names (square, portrait); the portrait is the 3:4 master. The
    website carries the poster itself: the `landscape` shape (the featured image) is the portrait master,
    and the theme sets its own type beside the poster, never over it."""
    if variant == "landscape":
        variant = "portrait"
    size = MASTER if variant == "portrait" else SIZES[variant]
    w, h = size
    scale = w / MASTER[0] if variant == "portrait" else (w / 1080)
    ink, accent, paper = hex_to_rgb(site.brand.primary), hex_to_rgb(site.brand.accent), hex_to_rgb(site.brand.text)
    img, has_still, faces = _ground(backdrop_url, size, ink, accent)
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

    # the title goes where the frame is clear: centred high (the reference's default), else ranged beside
    # the subject on the emptier side, else centred low above the mark; never over a face
    sfont = _font(int((32 if variant == "portrait" else 18) * (1.0 if variant == "portrait" else scale)), bold=True, family=family, weight=700)
    mark_h = int(h * (0.052 if variant == "portrait" else 0.075))
    mark_bottom = h - bleed - int(h * 0.055)
    tscale = 1.0 if variant == "portrait" else scale * 0.78
    high_y = handle_y + int(h * (0.08 if variant == "portrait" else 0.10))
    options, low = [], None
    gutter = int(w * 0.04)
    side_l = min(int(w * 0.56), (faces[0] - margin - gutter) if faces else int(w * 0.56))      # the room to the left of the subject
    side_r = min(int(w * 0.56), (w - faces[2] - margin - gutter) if faces else int(w * 0.56))  # and to its right
    for align, col in (("centre", column), ("left", side_l), ("right", side_r)):
        if align != "centre" and col < int(w * 0.34):
            continue
        tfont, tlines, tline_h = _title_lines(draw, title, family, col, tscale)
        if align != "centre" and len(tlines) > 5:
            continue
        sub = _wrap(draw, subline, sfont, int(col * (0.8 if align == "centre" else 1.0)))[:2] if subline else []
        sub_h = (int(h * 0.012) + len(sub) * int(sfont.size * 1.5)) if sub else 0
        block_h = len(tlines) * tline_h + sub_h
        block_w = max([draw.textlength(l, font=tfont) for l in tlines] + [draw.textlength(l, font=sfont) for l in sub])
        if align == "centre":
            xs = [((w - block_w) / 2, high_y)]
        elif align == "left":
            xs = [(margin, high_y + int(h * 0.06))]
        else:
            xs = [(w - margin - block_w, high_y + int(h * 0.06))]
        for x0, y0 in xs:
            box = (int(x0), int(y0), int(x0 + block_w), int(y0 + block_h))
            options.append((_covered(faces, box) if has_still else 0.0, len(options), align, y0, tfont, tlines, tline_h, sub, box))
        if align == "centre":     # the same block, low above the mark: the last resort, after the sides
            y0 = mark_bottom - mark_h - int(h * 0.05) - block_h
            box = (int((w - block_w) / 2), int(y0), int((w + block_w) / 2), int(y0 + block_h))
            low = (_covered(faces, box) if has_still else 0.0, 99, "centre", y0, tfont, tlines, tline_h, sub, box)
    options.append(low)
    if not has_still:
        tfont, tlines, tline_h = options[0][4], options[0][5], options[0][6]
        block_h = len(tlines) * tline_h + (options[0][8][3] - options[0][8][1] - len(tlines) * tline_h)
        y0 = max(handle_y + int(h * 0.08), (h - block_h) // 2 - int(h * 0.06))
        chosen = (0.0, 0, "centre", y0, tfont, tlines, tline_h, options[0][7], options[0][8])
    else:
        clear = [o for o in options if o[0] < 0.02]
        chosen = clear[0] if clear else min(options, key=lambda o: (o[0], o[1]))
    _cov, _i, align, y, tfont, tlines, tline_h, sub, box = chosen
    x_edge = margin if align == "left" else (w - margin if align == "right" else 0)
    if has_still:
        _scrim(img, box)
        draw = ImageDraw.Draw(img, "RGBA")
    y = _aligned(draw, int(y), tlines, tfont, tline_h, CREAM, w, align, x_edge)
    if sub:
        sy = y + int(h * 0.012)
        for i, line in enumerate(sub):
            if strike and i == 0 and align == "centre":
                _strike(draw, sy, line, strike, sfont, CREAM, accent, w, 0.12)
            else:
                _tracked(draw, sy, line, sfont, tuple(int(c * 0.92) for c in CREAM), w, 0.12, align, x_edge)
            sy += int(sfont.size * 1.5)

    # the mark at the bottom, and the swipe cue beside it on a carousel cover
    _mark(img, site, mark_bottom, mark_h, paper)
    if swipe:
        cfont = _font(int(20 * scale) if variant == "portrait" else int(16 * scale), bold=True, family=family, weight=700)
        _swipe(draw, w - margin, mark_bottom - int(mark_h * 0.2), cfont, tuple(int(c * 0.8) for c in paper))
    if variant == "portrait":
        cfont = _font(18, bold=False, family=family)
        left_note = credit[:60] if (credit and has_still) else (site.tagline or "")[:40]
        if left_note:
            draw.text((margin, mark_bottom - cfont.size - int(mark_h * 0.2)), left_note, font=cfont, fill=(*paper, 120))
    return _save(img, out_path, quality=90)


# ---- slides --------------------------------------------------------------------------------------------

def slide(heading: str, body: str, index: int, total: int, site: Site, out_path: Path, kicker: str | None = None,
          photo_url: str | None = None) -> Path:
    """A content slide: the number in the accent, the heading uppercase and centred, the body under it.
    On the still when the slide has one (a film's poster or backdrop), on the ink ground otherwise."""
    w, h = MASTER
    ink, accent, paper = hex_to_rgb(site.brand.primary), hex_to_rgb(site.brand.accent), hex_to_rgb(site.brand.text)
    img, has_still, _faces = _ground(photo_url, MASTER, ink, accent)
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
