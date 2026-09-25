"""The music bed: composed per mood, deterministic per story, ducked under the voice, or your own
track when the folder has one. And the voice backends: Kokoro by name, Piper by name."""
import wave

import numpy as np

from autopub import music, speech


def test_each_mood_composes_a_bed_of_the_asked_length_that_repeats_for_the_same_story():
    for mood in music.MOODS:
        x = music.compose(mood, 8, seed="A story")
        assert len(x) == 8 * music.RATE and 0.5 < np.abs(x).max() <= 0.9
        assert np.array_equal(x, music.compose(mood, 8, seed="A story")), "same story, same bed"
        assert not np.array_equal(x, music.compose(mood, 8, seed="Another story")), "another story, another bed"
    assert music.mood_of("SERIOUS ") == "serious" and music.mood_of(None) == music.DEFAULT_MOOD and music.mood_of("angry") == music.DEFAULT_MOOD


def test_the_bed_sits_low_and_dips_further_while_the_voice_speaks():
    rate = music.RATE
    bed = np.ones(6 * rate) * 0.9                              # a flat bed makes the gain visible
    voice = np.zeros(6 * rate)
    voice[2 * rate:4 * rate] = np.frombuffer(speech.tone(2.0, rate), dtype="<i2") / 32768.0
    ducked = music.duck(bed, voice, rate)
    quiet, under = ducked[int(0.5 * rate):int(1.2 * rate)].mean(), ducked[int(2.6 * rate):int(3.4 * rate)].mean()
    assert abs(20 * np.log10(quiet / 0.9) - music.BED_DB) < 0.5, "at rest the bed is at its level"
    assert abs(20 * np.log10(under / 0.9) - (music.BED_DB + music.DUCK_DB)) < 1.0, "under speech it dips by DUCK_DB"
    assert np.allclose(music.duck(bed, None, rate), bed * 10 ** (music.BED_DB / 20)), "no voice, no dip"


def test_the_soundtrack_is_voice_plus_bed_at_the_voice_rate_and_never_clips(tmp_path):
    n = speech.Narrator(synth=lambda text: speech.tone(1.0))
    voice, holds = n.soundtrack(["Hello there", None, "And goodbye"], tmp_path / "v.wav", floor=[1.0, 1.5, 1.0])
    mix = music.soundtrack("calm", sum(holds), tmp_path / "mix.wav", voice_wav=voice, seed="s")
    with wave.open(str(mix)) as w:
        assert w.getframerate() == speech.RATE and w.getnchannels() == 1
        assert abs(w.getnframes() / speech.RATE - sum(holds)) < 0.01
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    assert np.abs(x).max() <= 32767 * 0.985
    only_bed = music.soundtrack("calm", 3.0, tmp_path / "bed.wav", voice_wav=None, seed="s")
    with wave.open(str(only_bed)) as w:
        assert w.getframerate() == music.RATE and abs(w.getnframes() / music.RATE - 3.0) < 0.01


def test_your_own_track_is_preferred_and_looped_to_length(tmp_path, monkeypatch):
    folder = tmp_path / "music" / "upbeat"
    folder.mkdir(parents=True)
    music.write_wav(folder / "mine.wav", np.frombuffer(speech.tone(1.0, music.RATE, 220.0), dtype="<i2") / 32768.0, music.RATE)
    assert music.own_track(tmp_path / "music", "upbeat", "seed") == folder / "mine.wav"
    assert music.own_track(tmp_path / "music", "calm", "seed") is None, "no folder for that mood: composed instead"
    x = music.decode(folder / "mine.wav", 3.5, music.RATE)
    assert len(x) == int(3.5 * music.RATE) and np.abs(x).max() > 0.3, "a one-second track looped to three and a half"
    calls = []
    monkeypatch.setattr(music, "compose", lambda *a, **k: calls.append(1) or np.zeros(int(a[1] * music.RATE)))
    music.soundtrack("upbeat", 2.0, tmp_path / "m.wav", seed="x", music_dir=tmp_path / "music")
    assert calls == [], "with a track of yours, nothing is composed"
    music.soundtrack("serious", 2.0, tmp_path / "m2.wav", seed="x", music_dir=tmp_path / "music")
    assert calls == [1], "no track for the mood: composed"


def test_voice_names_pick_their_backend():
    assert speech.is_kokoro("af_heart") and speech.is_kokoro("bm_george") and speech.is_kokoro("hf_alpha")
    assert not speech.is_kokoro("en_US-ryan-high") and not speech.is_kokoro("") and not speech.is_kokoro("heart")
    assert speech.kokoro_lang("af_heart") == "en-us" and speech.kokoro_lang("bf_emma") == "en-gb" and speech.kokoro_lang("hf_alpha") == "en-us"


def test_kokoro_synthesises_in_a_child_and_a_missing_package_means_silence(tmp_path, monkeypatch):
    import sys, types
    monkeypatch.setitem(sys.modules, "kokoro_onnx", None)          # import fails
    assert speech.Narrator.load("af_heart", tmp_path / "voices") is None
    monkeypatch.setitem(sys.modules, "kokoro_onnx", types.ModuleType("kokoro_onnx"))
    monkeypatch.setattr(speech, "_download", lambda url, target: target.write_bytes(b"x" * 2_000_000))
    n = speech.Narrator.load("af_heart", tmp_path / "voices")
    assert n is not None and n.rate == speech.KOKORO_RATE
    assert sorted(p.name for p in (tmp_path / "voices").iterdir()) == ["kokoro-v1.0.onnx", "voices-v1.0.bin"], "both model files fetched once"
    seen = []
    monkeypatch.setattr(speech, "_kokoro_child", lambda voice, vd, texts: seen.append(texts) or [speech.tone(0.5, speech.KOKORO_RATE)] * len(texts))
    wav, holds = n.soundtrack(["One", None, "Three"], tmp_path / "v.wav", floor=[0.2, 1.0, 0.2])
    assert seen == [["One.", "Three."]], "only the frames with words go to the child, in order"
    assert holds[1] == 1.0 and abs(holds[0] - (speech.LEAD_IN + 0.5 + speech.PAD_AFTER)) < 0.01


def _wav_bytes(seconds: float) -> bytes:
    import io
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
        w.writeframes(speech.tone(seconds, 24000))
    return buf.getvalue()


def test_cloud_voices_need_their_keys_and_speak_through_the_rest_api(monkeypatch, tmp_path):
    monkeypatch.delenv("AZURE_SPEECH_KEY", raising=False); monkeypatch.delenv("AZURE_SPEECH_REGION", raising=False)
    monkeypatch.delenv("GOOGLE_TTS_API_KEY", raising=False)
    assert speech.Narrator.load("azure:en-IN-AartiNeural", tmp_path) is None
    assert speech.Narrator.load("google:en-IN-Neural2-A", tmp_path) is None
    monkeypatch.setenv("AZURE_SPEECH_KEY", "k"); monkeypatch.setenv("AZURE_SPEECH_REGION", "centralindia")
    monkeypatch.setenv("GOOGLE_TTS_API_KEY", "g")
    calls = []

    class R:
        status_code = 200
        def __init__(self, content=b"", payload=None):
            self.content, self._payload, self.text = content, payload, ""
        def json(self):
            return self._payload

    def post(url, **kw):
        calls.append((url, kw))
        if "microsoft" in url:
            return R(content=_wav_bytes(0.5))
        import base64
        return R(payload={"audioContent": base64.b64encode(_wav_bytes(0.7)).decode()})

    import requests
    monkeypatch.setattr(requests, "post", post)
    az = speech.Narrator.load("azure:en-IN-AartiNeural", tmp_path)
    assert az is not None and az.rate == 24000 and abs(az.duration(az.speak("Namaste")) - 0.5) < 0.01
    url, kw = calls[-1]
    assert url == "https://centralindia.tts.speech.microsoft.com/cognitiveservices/v1"
    assert kw["headers"]["Ocp-Apim-Subscription-Key"] == "k" and b'name="en-IN-AartiNeural"' in kw["data"] and b"Namaste." in kw["data"]
    goog = speech.Narrator.load("google:en-IN-Neural2-A", tmp_path)
    assert goog is not None and abs(goog.duration(goog.speak("Namaste")) - 0.7) < 0.01
    url, kw = calls[-1]
    assert kw["params"] == {"key": "g"} and kw["json"]["voice"] == {"languageCode": "en-IN", "name": "en-IN-Neural2-A"}
