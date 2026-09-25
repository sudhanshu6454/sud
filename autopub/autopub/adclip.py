"""The ad film itself, inside the site's frame: fetched with yt-dlp, composed with ffmpeg.

Switched on by `repost_ads` in settings. The ad features then carry the actual film rather than a
narrated review: the article page gets the film as a self-hosted video block, and Instagram and
the Facebook Page get a 9:16 reel that opens on the site's story cover, plays the film inside the
brand frame (kicker, hook, credit line, footer) with its own sound, and closes on the site's
closing frame. Only the brand's own upload is ever fetched (youtube.find_ad says whether the
upload is official); anything else stays an embed.

The rights in the film stay with the brand: it is shown for review, credited on the frame and
in the caption, and capped at `ad_clip_max_seconds`. Reposting a film you do not own is the
operator's call, which is why the switch is off by default and documented in sites.yaml.

YouTube answers a datacenter address with a sign-in wall for the default web client; the android
player client is served the film without one, so it is asked first. When YouTube wants cookies
anyway, `ad_clip_cookies` names a Netscape cookies.txt exported from a signed-in browser.
"""
from __future__ import annotations

import logging
import re
import subprocess
from pathlib import Path

from . import images
from .video import FPS, REEL_SIZE, ffmpeg_exe, probe

log = logging.getLogger(__name__)

INTRO_HOLD, OUTRO_HOLD = 2.5, 3.0      # seconds on the story cover before the film, on the closing frame after
FADE = 0.5                             # seconds the film fades out over when it is cut at the cap
PLAYER_CLIENTS = ("android", "web")    # yt-dlp player clients, first one that works wins
FORMAT = "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b[ext=mp4]/b"
SOURCE_CAP = 6 * 60                    # seconds: longer than this is not an ad film; refused before download

# the article's video slot: `nostalgia.write` wraps the YouTube embed in these, and the pipeline
# swaps the span for a self-hosted video block once the film is uploaded, or strips the markers
SLOT_OPEN, SLOT_CLOSE = "<!-- autopub:ad-video -->", "<!-- /autopub:ad-video -->"
_SLOT = re.compile(re.escape(SLOT_OPEN) + r"(.*?)" + re.escape(SLOT_CLOSE), re.S)


# ---- fetching ---------------------------------------------------------------------------------------------

def options(out_dir: Path, *, player_clients=PLAYER_CLIENTS, cookies: str | Path | None = None) -> dict:
    """The yt-dlp options: an MP4 at 1080p or under, merged with the bundled ffmpeg, no playlists,
    the android client before the web one, cookies when the operator exported some."""
    opts = {
        "format": FORMAT, "merge_output_format": "mp4",
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "noplaylist": True, "quiet": True, "no_warnings": True, "retries": 3, "socket_timeout": 30,
        "ffmpeg_location": ffmpeg_exe(),
        "extractor_args": {"youtube": {"player_client": list(player_clients)}},
        "match_filter": _short_enough,
    }
    if cookies:
        opts["cookiefile"] = str(cookies)
    return opts


def _short_enough(info, *, incomplete=False):
    """yt-dlp match filter: None to accept, a reason to skip. Refuses anything longer than an ad film."""
    seconds = info.get("duration")
    if seconds and seconds > SOURCE_CAP:
        return f"{seconds:.0f}s is longer than an ad film"
    return None


def _ytdlp(url: str, opts: dict) -> Path:
    try:
        import yt_dlp
    except ImportError as exc:      # pragma: no cover - the wheel is in requirements.txt
        raise RuntimeError("yt-dlp is not installed (pip install yt-dlp)") from exc
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    if not info:
        raise RuntimeError("yt-dlp returned nothing for the film")
    for d in info.get("requested_downloads") or []:
        if d.get("filepath") and Path(d["filepath"]).exists():
            return Path(d["filepath"])
    guess = Path(ydl.prepare_filename(info))
    for cand in (guess, guess.with_suffix(".mp4")):
        if cand.exists():
            return cand
    raise RuntimeError("yt-dlp finished but the file is not where it said")


def fetch(url: str, out_dir: Path, *, player_clients=PLAYER_CLIENTS, cookies: str | Path | None = None,
          downloader=None) -> Path:
    """Download the film to `out_dir` and return the MP4. Raises RuntimeError when YouTube refuses
    (sign-in wall, private, removed) so the caller can fall back to the embed and the narrated reel."""
    out_dir.mkdir(parents=True, exist_ok=True)
    opts = options(out_dir, player_clients=player_clients, cookies=cookies)
    try:
        path = (downloader or _ytdlp)(url, opts)
    except RuntimeError:
        raise
    except Exception as exc:  # noqa: BLE001 - yt-dlp raises its own family; one message is enough upstream
        text = str(exc)
        hint = " (YouTube wants a signed-in browser: export cookies.txt and set ad_clip_cookies)" if "Sign in" in text else ""
        raise RuntimeError(f"download failed: {text[:300]}{hint}") from exc
    info = probe(path)
    if not info.get("duration") or not info.get("width"):
        raise RuntimeError(f"the downloaded file is not a readable video: {path.name}")
    log.info("fetched %s: %dx%d, %.0fs, %d KB", path.name, info["width"], info["height"], info["duration"],
             path.stat().st_size // 1024)
    return path


# ---- composing --------------------------------------------------------------------------------------------

def compose(clip: Path, frame: Path, intro: Path, outro: Path, out_path: Path, *, max_seconds: float = 120,
            size: tuple[int, int] = REEL_SIZE, fps: int = FPS, intro_hold: float = INTRO_HOLD,
            outro_hold: float = OUTRO_HOLD) -> Path:
    """The reel: `intro` held, the film letterboxed inside `frame`'s window with its own sound
    (cut and faded at `max_seconds`), `outro` held. Silence under the two stills. Same small-footprint
    x264 settings as the narrated reels, with the same 720p fallback."""
    info = probe(clip)
    if not info.get("duration"):
        raise RuntimeError(f"cannot read the film's length: {clip.name}")
    seconds = min(float(info["duration"]), float(max_seconds))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        return _compose(clip, frame, intro, outro, out_path, seconds, bool(info.get("audio")), size, fps,
                        intro_hold, outro_hold, "superfast")
    except RuntimeError as exc:
        if size[0] <= 720:
            raise
        log.warning("ad reel encode at %dx%d failed (%s); trying 720x1280 at the lightest preset", *size, exc)
        return _compose(clip, frame, intro, outro, out_path, seconds, bool(info.get("audio")), (720, 1280), fps,
                        intro_hold, outro_hold, "ultrafast")


def _compose(clip, frame, intro, outro, out_path, seconds, has_audio, size, fps, intro_hold, outro_hold, preset) -> Path:
    w, h = size
    r = w / images.STORY_SIZE[0]
    win_y, win_h = int(round(images.AD_WINDOW_TOP * r)), int(round(images.AD_WINDOW_H * r))
    fade_at = max(0.0, seconds - FADE)
    afmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    still = f"scale={w}:{h},setsar=1,fps={fps},format=yuv420p"
    parts = [
        f"[0:v]{still}[intro]",
        f"[3:v]{still}[outro]",
        f"[1:v]trim=0:{seconds:.3f},setpts=PTS-STARTPTS,fps={fps},"
        f"scale={w}:{win_h}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,"
        f"fade=t=out:st={fade_at:.3f}:d={FADE}[ad]",
        f"[2:v]scale={w}:{h},setsar=1[fr]",
        f"[fr][ad]overlay=x=(main_w-overlay_w)/2:y={win_y}+({win_h}-overlay_h)/2:shortest=1,fps={fps},format=yuv420p[mid]",
        f"[4:a]asplit={2 if has_audio else 3}[s0][s1]" + ("" if has_audio else "[s2]"),
        f"[s0]atrim=0:{intro_hold},asetpts=PTS-STARTPTS,{afmt}[a0]",
        f"[s1]atrim=0:{outro_hold},asetpts=PTS-STARTPTS,{afmt}[a2]",
        (f"[1:a]atrim=0:{seconds:.3f},asetpts=PTS-STARTPTS,afade=t=out:st={fade_at:.3f}:d={FADE},{afmt}[a1]" if has_audio
         else f"[s2]atrim=0:{seconds:.3f},asetpts=PTS-STARTPTS,{afmt}[a1]"),
        "[intro][a0][mid][a1][outro][a2]concat=n=3:v=1:a=1[v][a]",
    ]
    cmd = [ffmpeg_exe(), "-y", "-loglevel", "error", "-threads", "2",
           "-loop", "1", "-framerate", str(fps), "-t", f"{intro_hold}", "-i", str(intro),
           "-i", str(clip),
           "-loop", "1", "-framerate", str(fps), "-i", str(frame),
           "-loop", "1", "-framerate", str(fps), "-t", f"{outro_hold}", "-i", str(outro),
           "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
           "-filter_complex", ";".join(parts), "-map", "[v]", "-map", "[a]",
           "-c:v", "libx264", "-preset", preset, "-crf", "23", "-pix_fmt", "yuv420p",
           "-x264-params", "ref=1:rc-lookahead=8:bframes=0:threads=2", "-r", str(fps), "-movflags", "+faststart",
           "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", str(out_path)]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        err = proc.stderr.decode(errors="replace").strip()[-400:]
        why = "killed (out of memory?)" if proc.returncode < 0 else err or f"exit {proc.returncode}"
        raise RuntimeError(f"ffmpeg failed: {why}")
    return out_path


# ---- the article's video block ----------------------------------------------------------------------------

def video_block(media_id: int, video_url: str, caption: str, poster: str | None = None) -> str:
    """The block editor's own video markup for a self-hosted MP4, captioned with the credit."""
    poster_attr = f' poster="{poster}"' if poster else ""
    return (f'<!-- wp:video {{"id":{int(media_id)}}} -->\n'
            f'<figure class="wp-block-video"><video controls playsinline preload="metadata"{poster_attr} src="{video_url}"></video>'
            f'<figcaption class="wp-element-caption">{caption}</figcaption></figure>\n'
            "<!-- /wp:video -->\n")


def slot(fallback_html: str) -> str:
    """Wrap the embed the article carries until the film is uploaded."""
    return f"{SLOT_OPEN}\n{fallback_html}{SLOT_CLOSE}\n"


def place_video(body_html: str, block: str | None) -> str:
    """Fill the article's video slot with `block`, or leave the fallback embed and drop the markers."""
    if block is None:
        return _SLOT.sub(lambda m: m.group(1).strip("\n") + "\n", body_html)
    return _SLOT.sub(lambda m: block, body_html, count=1)
