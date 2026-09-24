"""The reel's narration: what the voice says, how the frames follow it, and how it fails quietly."""
import wave
from pathlib import Path

from autopub import speech, video


def test_the_voice_reads_figures_and_drops_what_is_not_speech():
    assert speech.say("Spend rose to ₹5,200 cr in Q3 #retail https://x.y") == "Spend rose to rupees 5,200 crore in quarter 3."
    assert speech.say("Rs 1,299 vs Rs 1,899 - the anchor") == "rupees 1,299 vs rupees 1,899, the anchor."
    assert speech.say("The CMO said AI drove ROI") == "The C M O said A I drove R O I."
    assert speech.say("Already ends?") == "Already ends?"
    assert speech.say("   ") == ""


def test_the_soundtrack_holds_each_frame_for_its_narration_and_never_less_than_the_floor(tmp_path):
    n = speech.Narrator(synth=lambda text: speech.tone(len(text.rstrip(".")) / 20))   # one second per twenty characters
    scripts = ["x" * 40, None, "x" * 100, "y" * 10]
    wav, holds = n.soundtrack(scripts, tmp_path / "v.wav", floor=[1.0, 2.0, 1.0, 4.0])
    assert holds[0] == round(speech.LEAD_IN + 2.0 + speech.PAD_AFTER, 6)
    assert holds[1] == 2.0, "a frame with nothing to say holds for its floor"
    assert holds[2] == round(speech.LEAD_IN + 5.0 + speech.PAD_AFTER, 6)
    assert holds[3] == 4.0, "a short line still gives the frame its floor"
    with wave.open(str(wav)) as w:
        assert w.getnchannels() == 1 and w.getframerate() == speech.RATE
        assert abs(w.getnframes() / speech.RATE - sum(holds)) < 0.01, "the audio is exactly as long as the video will be"
        w.setpos(int(0.1 * speech.RATE))
        assert w.readframes(10) == b"\x00" * 20, "the lead-in is quiet"


def test_a_narrated_reel_carries_the_voice_track_at_the_video_length(site, tmp_path):
    from autopub import images
    a = images.story_closing_frame("A headline", site, tmp_path / "a.jpg")
    b = images.story_text_frame("What happened", "Facts. " * 10, 1, 1, site, tmp_path / "b.jpg", kicker="News")
    n = speech.Narrator(synth=lambda text: speech.tone(0.4))
    wav, holds = n.soundtrack(["Headline", "What happened. Facts.", None], tmp_path / "v.wav", floor=[0.6, 0.6, 0.8])
    out = video.render_reel([a, b, a], tmp_path / "r.mp4", holds, images.hex_to_rgb(site.brand.accent), fps=10, dissolve=0.2, audio=wav)
    info = video.probe(out)
    assert info["audio"] and abs(info["duration"] - sum(holds)) < 0.4


def test_a_missing_voice_means_no_narrator_not_an_error(tmp_path, monkeypatch):
    import sys, types
    fake = types.ModuleType("piper")
    class _PV:
        @staticmethod
        def load(path):
            raise OSError("no model")
    fake.PiperVoice = _PV
    dl = types.ModuleType("piper.download_voices")
    dl.download_voice = lambda voice, d: (_ for _ in ()).throw(RuntimeError("offline"))
    monkeypatch.setitem(sys.modules, "piper", fake)
    monkeypatch.setitem(sys.modules, "piper.download_voices", dl)
    assert speech.Narrator.load("en_US-nobody-high", tmp_path / "voices") is None
    assert speech.Narrator.load("", tmp_path / "voices") is None, "an empty voice name is narration switched off"
    (tmp_path / "voices" / "en_US-x-high.onnx").parent.mkdir(exist_ok=True)
    (tmp_path / "voices" / "en_US-x-high.onnx").write_bytes(b"x")
    (tmp_path / "voices" / "en_US-x-high.onnx.json").write_text("{}")
    assert speech.Narrator.load("en_US-x-high", tmp_path / "voices") is None, "a model that will not load is also just silence"
