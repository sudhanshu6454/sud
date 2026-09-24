"""A Reel from the story frames: the article as a short vertical video.

The story frames already tell the article in 9:16 on the brand ground (cover, one to three text
frames, closing). Here they become a video: each frame holds for as long as its text takes to
read, drifts a little (a slow zoom, alternating direction, so the picture is never dead still),
and dissolves into the next; a segmented progress bar along the top says how much is left, as a
story does. The soundtrack is an original narration of the same text (speech.py) when a voice is available,
else silence: the API adds no music and a licensed track is not something to guess at.

Encoding is H.264 in an MP4 with a silent AAC track, which is what Instagram's Reels endpoint and
the Facebook Page video endpoint both accept without complaint. ffmpeg comes from the
imageio-ffmpeg wheel, so the container needs no system package.
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

log = logging.getLogger(__name__)

REEL_SIZE = (1080, 1920)     # 9:16, the size Instagram encodes reels at anyway
FPS = 24                     # Reels accept 23-60; 24 keeps the render a fifth quicker than 30
ZOOM = 0.06                  # how far a frame drifts over its hold: 6%, felt rather than seen
DISSOLVE = 0.6               # seconds of crossfade between frames
COVER_HOLD, CLOSING_HOLD = 3.0, 3.2
MIN_HOLD, MAX_HOLD = 4.0, 7.5
READ_CHARS_PER_SECOND = 15   # a comfortable reading pace for on-screen type
BAR_Y, BAR_H, BAR_GAP, BAR_SIDE = 112, 6, 10, 48   # the progress bar: inside the top safe band, above the frame content


def ffmpeg_exe() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def hold_for(text: str | None, floor: float = MIN_HOLD, ceiling: float = MAX_HOLD) -> float:
    """How long a text frame stays up: long enough to read, never long enough to bore."""
    return max(floor, min(ceiling, len(text or "") / READ_CHARS_PER_SECOND))


def plan(frames: list[Path], texts: list[str | None]) -> list[float]:
    """Seconds per frame: a fixed hold for the cover and closing, reading time for the rest."""
    out = []
    for i, text in enumerate(texts):
        if i == 0:
            out.append(COVER_HOLD)
        elif i == len(frames) - 1:
            out.append(CLOSING_HOLD)
        else:
            out.append(hold_for(text))
    return out


def _prepare(path: Path, size: tuple[int, int]) -> Image.Image:
    """The frame at (1 + ZOOM) times the output size, so every zoom level is a crop, never an upscale."""
    w, h = size
    big = (int(round(w * (1 + ZOOM))) + 2, int(round(h * (1 + ZOOM))) + 2)
    with Image.open(path) as im:
        return im.convert("RGB").resize(big, Image.LANCZOS)


def _view(big: Image.Image, size: tuple[int, int], zoom: float) -> Image.Image:
    """The output frame at a given zoom (1.0 = whole frame, 1+ZOOM = tightest), centred."""
    w, h = size
    cw, ch = int(round(big.width / zoom)), int(round(big.height / zoom))
    cw, ch = min(cw, big.width), min(ch, big.height)
    x, y = (big.width - cw) // 2, (big.height - ch) // 2
    return big.crop((x, y, x + cw, y + ch)).resize((w, h), Image.BILINEAR)


def _progress(frame: Image.Image, index: int, total: int, fraction: float, accent, ink) -> None:
    """Story-style segments: done ones solid, the current one filling, the rest faint."""
    draw = ImageDraw.Draw(frame, "RGBA")
    w = frame.width
    seg = (w - BAR_SIDE * 2 - BAR_GAP * (total - 1)) / total
    for i in range(total):
        x0 = BAR_SIDE + i * (seg + BAR_GAP)
        draw.rectangle([x0, BAR_Y, x0 + seg, BAR_Y + BAR_H], fill=(*ink, 70))
        fill = 1.0 if i < index else (fraction if i == index else 0.0)
        if fill > 0:
            draw.rectangle([x0, BAR_Y, x0 + seg * fill, BAR_Y + BAR_H], fill=(*accent, 255))


def render_reel(frames: list[Path], out_path: Path, durations: list[float], accent: tuple[int, int, int],
                ink: tuple[int, int, int] = (255, 255, 255), size: tuple[int, int] = REEL_SIZE, fps: int = FPS,
                dissolve: float = DISSOLVE, audio: Path | None = None) -> Path:
    """Write the reel. `frames` in order; `durations` seconds each; total runtime is their sum.
    `audio` is a WAV laid on the same timeline (the narration); without one the track is silence."""
    if len(frames) < 2:
        raise ValueError("a reel needs at least two frames")
    if len(durations) != len(frames):
        raise ValueError("one duration per frame")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    w, h = size
    sound = ["-i", str(audio)] if audio else ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
    cmd = [ffmpeg_exe(), "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
           *sound, "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
           "-r", str(fps), "-movflags", "+faststart", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
           str(out_path)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdin is not None
    total = len(frames)
    fade_n = int(round(dissolve * fps))
    prepared = [None] * total
    try:
        for i, path in enumerate(frames):
            prepared[i] = prepared[i] or _prepare(path, size)
            n = max(1, int(round(durations[i] * fps)))
            zoom_in = i % 2 == 0
            for k in range(n):
                t = k / max(1, n - 1)
                zoom = 1 + ZOOM * (t if zoom_in else 1 - t)
                frame = _view(prepared[i], size, zoom)
                # dissolve out of the previous frame over the first `fade_n` frames of this one
                if i > 0 and k < fade_n and prepared[i - 1] is not None:
                    prev_zoom = 1 + ZOOM * (1 if (i - 1) % 2 == 0 else 0)
                    frame = Image.blend(_view(prepared[i - 1], size, prev_zoom), frame, (k + 1) / (fade_n + 1))
                _progress(frame, i, total, t, accent, ink)
                proc.stdin.write(frame.tobytes())
            if i > 0:
                prepared[i - 1] = None   # free the previous source once the dissolve out of it is done
        proc.stdin.close()
        err = proc.stderr.read().decode(errors="replace") if proc.stderr else ""
        if proc.wait() != 0:
            raise RuntimeError(f"ffmpeg failed: {err.strip()[-400:]}")
    finally:
        if proc.poll() is None:
            proc.kill()
    return out_path


def probe(path: Path) -> dict:
    """Width, height, duration and codec of a video, read from ffmpeg's own report."""
    import re
    proc = subprocess.run([ffmpeg_exe(), "-i", str(path)], capture_output=True, text=True)
    text = proc.stderr
    m = re.search(r"Video: (\w+).*?, (\d{2,5})x(\d{2,5})", text)
    d = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", text)
    out = {}
    if m:
        out.update(codec=m.group(1), width=int(m.group(2)), height=int(m.group(3)))
    if d:
        out["duration"] = int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3))
    out["audio"] = "Audio:" in text
    return out
