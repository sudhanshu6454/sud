"""A music bed for the reel, matched to the story's mood, ducked under the voice.

Two sources, in order of preference. Tracks you own the rights to: drop MP3 or WAV files into
`<data_dir>/music/<mood>/` (upbeat, calm, serious, nostalgic) and one is chosen per reel, looped
or trimmed to length. Failing that, a bed is composed here: a chord progression in the mood's
key and tempo, a soft pad, a bass root, a plucked figure and, for the upbeat mood, a light pulse,
all synthesised from sines and noise with numpy. It is original, so there is nothing to license,
and it is quiet by design: a bed sits a long way under a voice, and dips further while it speaks.

The composed bed is deterministic for a given seed (the article's title), so a reel re-rendered
sounds the same, and different articles do not share a loop.
"""
from __future__ import annotations

import hashlib
import logging
import math
import random
import subprocess
import wave
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

RATE = 24000
MOODS = ("upbeat", "calm", "serious", "nostalgic")
DEFAULT_MOOD = "calm"
BED_DB, DUCK_DB = -19.0, -9.0        # bed level under silence, and how much further it dips under speech
FADE_IN, FADE_OUT = 1.2, 2.0

# semitone offsets of chord degrees (root, third, fifth, seventh) over the key, per mood, and the pace
_MAJ = ((0, 4, 7, 11), (7, 11, 14, 17), (9, 12, 16, 19), (5, 9, 12, 16))        # I  V  vi  IV, maj7 colours
_CALM = ((0, 4, 7, 11), (5, 9, 12, 16), (2, 5, 9, 12), (7, 11, 14, 17))        # Imaj7 IVmaj7 ii7 V7
_MIN = ((0, 3, 7, 10), (8, 12, 15, 19), (3, 7, 10, 14), (10, 14, 17, 21))      # i VI III VII
_NOST = ((9, 12, 16, 19), (5, 9, 12, 16), (0, 4, 7, 11), (7, 11, 14, 17))      # vi IV I V, slow
PROFILE = {
    "upbeat": dict(bpm=112, chords=_MAJ, keys=(57, 59, 60, 62), pluck=True, pulse=True, bright=0.9),
    "calm": dict(bpm=76, chords=_CALM, keys=(55, 57, 58), pluck=True, pulse=False, bright=0.55),
    "serious": dict(bpm=84, chords=_MIN, keys=(52, 54, 55), pluck=False, pulse=True, bright=0.45),
    "nostalgic": dict(bpm=68, chords=_NOST, keys=(53, 55, 57), pluck=True, pulse=False, bright=0.6),
}


def mood_of(name: str | None) -> str:
    name = (name or "").strip().lower()
    return name if name in MOODS else DEFAULT_MOOD


def _hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def _lowpass(x: np.ndarray, cutoff: float, rate: int = RATE, taps: int = 96) -> np.ndarray:
    """A windowed-sinc lowpass: one convolution, no Python loop, enough to take the edge off."""
    n = np.arange(taps) - (taps - 1) / 2
    fc = cutoff / rate
    h = np.sinc(2 * fc * n) * np.hamming(taps)
    h /= h.sum()
    return np.convolve(x, h, mode="same")


def _pad(freqs: list[float], seconds: float, bright: float, rate: int = RATE) -> np.ndarray:
    """A soft chord: detuned sines with a couple of harmonics, slow attack, filtered."""
    n = int(seconds * rate)
    t = np.arange(n) / rate
    out = np.zeros(n)
    for f in freqs:
        for det, amp in ((0.0, 1.0), (0.4, 0.55), (-0.3, 0.55)):
            fh = f * 2 ** (det / 1200)
            out += amp * (np.sin(2 * np.pi * fh * t) + 0.35 * np.sin(2 * np.pi * 2 * fh * t) + 0.12 * np.sin(2 * np.pi * 3 * fh * t))
    env = np.minimum(1.0, t / 0.9) * np.minimum(1.0, (seconds - t) / 0.6)
    out = _lowpass(out * env, 900 + 1400 * bright, rate)
    return out / (len(freqs) * 2.2)


def _pluck(freq: float, seconds: float, rate: int = RATE) -> np.ndarray:
    n = int(seconds * rate)
    t = np.arange(n) / rate
    return (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t)) * np.exp(-t * 5.5)


def _kick(rate: int = RATE) -> np.ndarray:
    t = np.arange(int(0.22 * rate)) / rate
    return np.sin(2 * np.pi * (55 + 90 * np.exp(-t * 28)) * t) * np.exp(-t * 16)


def _hat(rate: int = RATE, rng: random.Random | None = None) -> np.ndarray:
    """A soft, band-limited tick: a bed's hat is felt, not heard as hiss."""
    n = int(0.06 * rate)
    noise = np.random.default_rng(rng.getrandbits(32) if rng else None).uniform(-1, 1, n)
    return _lowpass(noise * np.exp(-np.arange(n) / rate * 90), 6500, rate, taps=48) * 0.18


def _add(out: np.ndarray, start: int, x: np.ndarray) -> None:
    """Mix `x` into `out` at `start`, clipped to what fits."""
    if start >= len(out) or start < 0:
        return
    m = min(len(x), len(out) - start)
    out[start:start + m] += x[:m]


def compose(mood: str, seconds: float, seed: str = "", rate: int = RATE) -> np.ndarray:
    """The bed as float samples in [-1, 1], mono at `rate`, `seconds` long."""
    prof = PROFILE[mood_of(mood)]
    rng = random.Random(int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16))
    key = rng.choice(prof["keys"])
    beat = 60.0 / prof["bpm"]
    bar = beat * 4
    n = int(seconds * rate) + rate
    out = np.zeros(n)
    chords = list(prof["chords"])
    if rng.random() < 0.5:
        chords = chords[1:] + chords[:1]
    pos = 0.0
    i = 0
    while pos < seconds:
        degrees = chords[i % len(chords)]
        freqs = [_hz(key + d) for d in degrees]
        length = bar * (2 if prof["bpm"] < 80 else 1)
        seg = _pad(freqs, length + 0.3, prof["bright"], rate)
        start = int(pos * rate)
        _add(out, start, seg)
        # bass root, an octave and a half down
        bass_t = np.arange(int(length * rate)) / rate
        bass = np.sin(2 * np.pi * _hz(key + degrees[0] - 24) * bass_t) * np.minimum(1, bass_t / 0.05) * np.exp(-bass_t * 0.6) * 0.5
        _add(out, start, bass)
        if prof["pluck"]:
            # an arpeggio over the chord, one note per half beat, a few notes rested at random
            notes = [_hz(key + d + 12) for d in degrees]
            k = 0
            for step in np.arange(0, length, beat / 2):
                if rng.random() < 0.28:
                    k += 1
                    continue
                s = start + int(step * rate)
                _add(out, s, _pluck(notes[k % len(notes)], beat * 1.5, rate) * 0.22)
                k += 1
        if prof["pulse"]:
            for b in np.arange(0, length, beat):
                s = start + int(b * rate)
                _add(out, s, _kick(rate) * (0.55 if prof["bpm"] > 100 else 0.35))
                _add(out, s + int(beat / 2 * rate), _hat(rate, rng) * 0.5)
        pos += length
        i += 1
    out = out[:int(seconds * rate)]
    peak = np.max(np.abs(out)) or 1.0
    return out / peak * 0.9


def _fade(x: np.ndarray, rate: int = RATE) -> np.ndarray:
    n = len(x)
    fi, fo = min(n, int(FADE_IN * rate)), min(n, int(FADE_OUT * rate))
    x = x.copy()
    x[:fi] *= np.linspace(0, 1, fi)
    x[n - fo:] *= np.linspace(1, 0, fo)
    return x


def own_track(music_dir: Path, mood: str, seed: str) -> Path | None:
    """A licensed track of yours for this mood, if the folder has one."""
    folder = music_dir / mood_of(mood)
    if not folder.is_dir():
        return None
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() in (".mp3", ".wav", ".m4a", ".ogg", ".flac"))
    if not files:
        return None
    rng = random.Random(int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16))
    return rng.choice(files)


def decode(path: Path, seconds: float, rate: int = RATE) -> np.ndarray:
    """A track as mono float samples, looped or trimmed to `seconds`."""
    from .video import ffmpeg_exe
    raw = subprocess.run([ffmpeg_exe(), "-loglevel", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", str(rate), "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype="<i2").astype(float) / 32768.0
    need = int(seconds * rate)
    if len(x) == 0:
        raise RuntimeError(f"{path.name} decoded to nothing")
    while len(x) < need:
        x = np.concatenate([x, x])
    return x[:need]


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path)) as w:
        rate = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32768.0
        if w.getnchannels() == 2:
            x = x.reshape(-1, 2).mean(axis=1)
    return x, rate


def write_wav(path: Path, x: np.ndarray, rate: int) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
    return path


def duck(bed: np.ndarray, voice: np.ndarray | None, rate: int) -> np.ndarray:
    """The bed at its level, dipping further wherever the voice is speaking."""
    gain = np.full(len(bed), 10 ** (BED_DB / 20))
    if voice is not None and len(voice):
        n = min(len(bed), len(voice))
        win = int(0.05 * rate)
        env = np.abs(voice[:n])
        env = np.convolve(env, np.ones(win) / win, mode="same")
        speaking = (env > 0.02).astype(float)
        # a slow gate: opens in 80 ms, closes in 400 ms, so the dip does not pump
        smooth = np.convolve(speaking, np.ones(int(0.4 * rate)) / int(0.4 * rate), mode="same")
        smooth = np.clip(smooth * 2.5, 0, 1)
        gain[:n] *= 10 ** (DUCK_DB * smooth / 20)
    return bed * gain


def soundtrack(mood: str, seconds: float, out_path: Path, voice_wav: Path | None = None, seed: str = "",
               music_dir: Path | None = None) -> Path:
    """The reel's audio: your track for the mood or a composed bed, under the narration if any."""
    rate = RATE
    voice = None
    if voice_wav is not None and voice_wav.exists():
        voice, vrate = read_wav(voice_wav)
        rate = vrate
    track = own_track(music_dir, mood, seed) if music_dir else None
    if track is not None:
        try:
            bed = decode(track, seconds, rate)
            log.info("music: %s (%s)", track.name, mood_of(mood))
        except Exception as exc:  # noqa: BLE001 - a bad file is not a silent reel
            log.warning("music: could not use %s (%s); composing instead", track.name, exc)
            track = None
    if track is None:
        bed = compose(mood, seconds, seed, rate)
        log.info("music: composed %s bed, %.0fs", mood_of(mood), seconds)
    bed = duck(_fade(bed, rate), voice, rate)
    n = int(seconds * rate)
    mix = np.zeros(n)
    mix[:min(n, len(bed))] += bed[:n]
    if voice is not None:
        mix[:min(n, len(voice))] += voice[:n]
    peak = np.max(np.abs(mix))
    if peak > 0.98:
        mix = mix / peak * 0.98
    return write_wav(out_path, mix, rate)
