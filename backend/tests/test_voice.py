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
