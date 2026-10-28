import numpy as np

from app.voice import CHUNK, Gate, Segmenter, junk

CH = np.zeros(CHUNK, dtype="float32")


def run(seg, probs):
    return [a for p in probs if (a := seg.feed(CH, p)) is not None]


def test_segmenter_cuts_an_utterance_after_the_silence():
    seg = Segmenter(silence_ms=320, min_ms=100)  # 10 chunks of silence
    out = run(seg, [0.0] * 5 + [0.9] * 20 + [0.0] * 9)
    assert out == []  # not enough silence yet
    out = run(seg, [0.0])
    assert len(out) == 1 and len(out[0]) == (5 + 20 + 10) * CHUNK  # pre-roll + speech + the silence that ended it


def test_segmenter_drops_clicks_and_cuts_long_speech():
    seg = Segmenter(silence_ms=320, min_ms=250)
    assert run(seg, [0.9] * 2 + [0.0] * 12) == []  # 64 ms of "voice" is a click
    seg = Segmenter(silence_ms=320, max_s=1)
    assert len(run(seg, [0.9] * 40)) == 1  # 1 s max, then it cuts


def test_gate_needs_the_wake_phrase():
    g = Gate(wake=True)
    assert g.decide("what time is it", 0) is None
    assert g.decide("Hey Capri, what time is it", 1) == "what time is it"
    assert g.decide("Oye Capri", 2) is None  # just the name: the next sentence is hers
    assert g.armed(3)
    assert g.decide("abre spotify", 3) == "abre spotify"
    assert g.decide("abre spotify", 4) is None  # the window closed


def test_gate_window_expires_and_hotkey_opens_it():
    g = Gate(wake=True, window_s=8)
    g.arm(0)
    assert g.decide("hola", 9) is None
    g.arm(10)
    assert g.decide("hola qué tal", 11) == "hola qué tal"
    assert Gate(wake=False).decide("hey Capri hola", 0) is None  # hotkey only


def test_junk_filter():
    assert junk("Subtítulos por la comunidad de Amara.org", -0.2, 0.1)
    assert junk("ok", -2.0, 0.1)
    assert not junk("abre spotify", -0.3, 0.05)


def test_after_her_name_a_follow_up_needs_no_name():
    # "Hey Capri, pon" [a pause] "algo de Bad Bunny": the second half, or his answer to her question, is hers too
    g = Gate(wake=True, window_s=8)
    assert g.decide("Hey Capri, pon algo", 0) == "pon algo"
    assert g.decide("de Bad Bunny", 2) == "de Bad Bunny"
    assert g.decide("y luego otra cosa", 3) is None  # a follow-up doesn't keep the window open


def test_a_sentence_ends_after_most_of_a_second_of_silence():
    from app import settings

    assert Segmenter().silence == int(900 / (CHUNK * 1000 / 16_000)) and settings.Settings().voice_silence_ms == 900


def test_what_is_said_while_she_transcribes_is_not_thrown_away(monkeypatch):
    import sys
    import types

    from app import voice
    from app.protocol import Heard

    speech, quiet = np.ones(CHUNK, dtype="float32"), np.zeros(CHUNK, dtype="float32")
    blocks = ([speech] * 12 + [quiet] * 30) * 2  # two sentences; the second arrives while the first is read

    class Stream:
        def __init__(self, callback, **kw):
            self.callback = callback

        def __enter__(self):
            for b in blocks:
                self.callback(b[:, None], len(b), None, None)
            return self

        def __exit__(self, *a):
            pass

    monkeypatch.setitem(sys.modules, "sounddevice", types.SimpleNamespace(InputStream=Stream))
    monkeypatch.setattr(voice, "SileroVad", lambda: lambda chunk: float(chunk[0]))
    v = voice.Voice()
    said = iter(["Hey Capri, uno", "mira esto"])  # the second only got through the follow-up window

    def transcribe(audio):
        text = next(said, None)
        return (text, "es") if text else None

    sent = []
    monkeypatch.setattr(v, "_load", lambda: None)
    monkeypatch.setattr(v, "transcribe", transcribe)
    monkeypatch.setattr(v, "_emit", sent.append)
    import threading

    threading.Timer(1, v.stop).start()  # the loop ends once the queue has been idle a moment
    v._run()
    assert [m.texto for m in sent if isinstance(m, Heard)] == ["uno", "mira esto"]  # as chat: no screenshot


def test_after_a_sentence_the_window_takes_chat_not_commands():
    # overheard "ya, mira esto" right after "hey Capri, pon música" took a screenshot
    g = Gate(wake=True)
    g.decide("Hey Capri, pon música", 0)
    assert g.decide("ya, mira esto", 2) == "ya, mira esto" and g.chat
    g.decide("Hey Capri", 3)  # just her name, or the hotkey: what comes next may be a command
    assert g.decide("mira esto", 4) == "mira esto" and not g.chat
    g.arm(5)
    assert g.decide("escóndete", 6) == "escóndete" and not g.chat


def test_with_the_hotkey_only_her_name_does_not_open_the_window():
    g = Gate(wake=False)
    g.arm(0)
    assert g.decide("Capri, pon música", 1) == "pon música"
    assert not g.armed(2)
