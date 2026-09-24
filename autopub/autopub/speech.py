"""The reel's voice: an original narration of the story frames, synthesised locally.

Instagram counts audio the account made itself as "original audio", and a reel with a voice is
watched where a silent one is scrolled past. Piper (rhasspy/piper, MIT) runs a neural voice on
the CPU with no service and no key: about a second of compute per five seconds of speech. The
voice model (~120 MB) is fetched once into the data volume on first use, not baked into the image.

Everything here degrades to "no narration": a missing model, a failed download or a synthesis
error hands back None and the reel goes out silent as before, so the post never depends on it.
"""
from __future__ import annotations

import logging
import re
import struct
import wave
from pathlib import Path

log = logging.getLogger(__name__)

DEFAULT_VOICE = "en_US-ryan-high"
RATE = 22050                 # Piper's output; ffmpeg resamples to 48k for the reel
PAD_AFTER = 0.7              # seconds of quiet after a frame's narration before the dissolve
LEAD_IN = 0.35               # seconds before the first word of a frame

# what the voice should say instead of what the card shows
_SAY = [(re.compile(r"₹\s?"), "rupees "), (re.compile(r"\bRs\.?\s?(?=\d)"), "rupees "),
        (re.compile(r"(?<!\w)#\w+"), ""), (re.compile(r"https?://\S+|www\.\S+", re.I), ""),
        (re.compile(r"\bcr\b"), "crore"), (re.compile(r"\bQ([1-4])\b"), r"quarter \1"),
        (re.compile(r"\bYoY\b"), "year on year"), (re.compile(r"\bCTR\b"), "click-through rate"),
        (re.compile(r"\bROI\b"), "R O I"), (re.compile(r"\bCEO\b"), "C E O"), (re.compile(r"\bCMO\b"), "C M O"),
        (re.compile(r"\bD2C\b"), "direct to consumer"), (re.compile(r"\bAI\b"), "A I"),
        (re.compile(r"\s[–—-]\s"), ", "), (re.compile(r"[–—]"), ", "), (re.compile(r"\s{2,}"), " ")]


def say(text: str) -> str:
    """The text as the voice should read it: figures spelt for the ear, tags and links dropped."""
    for pattern, repl in _SAY:
        text = pattern.sub(repl, text)
    text = text.strip()
    if text and text[-1] not in ".!?":
        text += "."
    return text


class Narrator:
    """One loaded voice. `synth` may be replaced (tests) by any callable text -> mono int16 PCM bytes at RATE."""

    def __init__(self, voice: str = DEFAULT_VOICE, voice_dir: Path | None = None, synth=None):
        self.voice = voice
        self.voice_dir = voice_dir or Path("voices")
        self._synth = synth

    @classmethod
    def load(cls, voice: str, voice_dir: Path) -> "Narrator | None":
        """A ready narrator, downloading the voice on first use; None when it cannot be had."""
        if not voice:
            return None
        try:
            from piper import PiperVoice
        except ImportError as exc:
            log.warning("no narration: piper-tts is not installed (%s)", exc)
            return None
        voice_dir.mkdir(parents=True, exist_ok=True)
        model = voice_dir / f"{voice}.onnx"
        if not model.exists() or not model.with_suffix(".onnx.json").exists():
            try:
                from piper.download_voices import download_voice
                log.info("downloading the %s voice into %s (once)", voice, voice_dir)
                download_voice(voice, voice_dir)
            except Exception as exc:  # noqa: BLE001 - a voice we cannot fetch is a silent reel, not a failure
                log.warning("no narration: could not download the %s voice: %s", voice, exc)
                return None
        try:
            pv = PiperVoice.load(str(model))
        except Exception as exc:  # noqa: BLE001
            log.warning("no narration: the %s voice did not load: %s", voice, exc)
            return None

        def synth(text: str) -> bytes:
            return b"".join(chunk.audio_int16_bytes for chunk in pv.synthesize(text))

        n = cls(voice, voice_dir, synth)
        n.rate = getattr(pv.config, "sample_rate", RATE)
        return n

    rate = RATE

    def speak(self, text: str) -> bytes:
        text = say(text)
        if not text:
            return b""
        assert self._synth is not None, "no synthesiser loaded"
        return self._synth(text)

    def duration(self, pcm: bytes) -> float:
        return len(pcm) / 2 / self.rate

    def soundtrack(self, scripts: list[str | None], out_path: Path,
                   floor: list[float] | None = None) -> tuple[Path, list[float]]:
        """Narrate each frame's script and lay them on one timeline.

        Returns the WAV and the seconds each frame must hold: lead-in, the narration, a pause,
        never less than the frame's own floor (so a frame with nothing to say still holds)."""
        floor = floor or [0.0] * len(scripts)
        clips = [self.speak(s) if s else b"" for s in scripts]
        durations = [max(f, LEAD_IN + self.duration(c) + PAD_AFTER if c else f) for f, c in zip(floor, clips)]
        frame_bytes = 2
        timeline = bytearray()
        for hold, clip in zip(durations, clips):
            total = int(round(hold * self.rate)) * frame_bytes
            lead = int(round(LEAD_IN * self.rate)) * frame_bytes
            segment = bytearray(b"\x00" * lead) + clip
            segment = segment[:total] if len(segment) > total else segment + b"\x00" * (total - len(segment))
            timeline += segment
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(out_path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(frame_bytes)
            w.setframerate(self.rate)
            w.writeframes(bytes(timeline))
        return out_path, durations


def tone(seconds: float, rate: int = RATE, hz: float = 440.0) -> bytes:
    """A test-only stand-in for a voice: a sine of the given length as int16 PCM."""
    import math
    n = int(seconds * rate)
    return b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * hz * i / rate))) for i in range(n))
