import time
import numpy as np

from app.voice import CHUNK, Gate, Segmenter, junk, level

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


def test_mic_level_is_zero_in_silence_and_tops_out_at_one():
    assert level(np.zeros(CHUNK, dtype="float32")) == 0.0
    assert level(np.ones(CHUNK, dtype="float32")) == 1.0
    assert 0 < level(np.full(CHUNK, 0.02, dtype="float32")) < 1


def test_only_what_was_for_her_or_sounds_like_her_name_is_logged():
    from app.voice import loggable

    assert loggable("abre spotify", True, ["capri"])
    assert loggable("y luego le dije que capri estaba", False, ["capri"])  # her name anywhere: a missed call
    assert loggable("y luego le dije que kapri estaba", False, ["capri"])
    assert not loggable("pásame la sal", False, ["capri"])  # overheard: never written


def test_the_voice_log_keeps_the_last_lines(tmp_path):
    from app.voice import VoiceLog

    log = VoiceLog(tmp_path / "voz.log", keep=3)
    for i in range(5):
        log.write(f"line {i}")
    assert (tmp_path / "voz.log").read_text(encoding="utf-8").splitlines() == ["line 2", "line 3", "line 4"]


def test_the_gate_answers_to_her_other_names():
    g = Gate(names=("capri", "nova"))
    assert g.decide("nova", 0) is None
    assert g.armed(1)


def test_a_sentence_cut_at_a_pause_is_joined_back():
    from app.voice import Joiner

    j = Joiner(wait_s=1.2)
    assert j.add("pon algo de", 0) is None
    assert j.add("bad bunny", 0.8) == "pon algo de bad bunny"
    assert j.add("abre la", 2) is None
    assert j.due(2.5) is None
    assert j.due(3.3) == "abre la"  # nothing came: it goes as it was
    assert j.due(4) is None
    assert j.add("hola", 5) == "hola"  # a finished sentence goes at once


def test_a_lone_short_word_is_not_noise():
    assert not junk("Capri", -0.5, 0.7)
    assert junk("Capri", -0.5, 0.85)
    assert junk("abre spotify por favor ya", -0.5, 0.7)  # longer: the usual bar


def test_after_her_answer_the_conversation_goes_on_without_her_name():
    g = Gate()
    g.converse(0)
    assert g.decide("y súbele el volumen", 3) == "y súbele el volumen"
    assert g.chat  # chat: a spoken slash command still needs her name
    g.converse(10)
    assert g.decide("hola", 19) is None  # 8 s of nothing: it closed
    g.converse(20)
    assert g.decide("Capri, mira la pantalla", 23) == "mira la pantalla"
    assert not g.chat  # with her name, commands work


def test_the_conversation_window_only_follows_a_spoken_exchange(monkeypatch):
    from app import voice as v

    vo = v.Voice()
    monkeypatch.setattr(v.Voice, "on", property(lambda self: True))
    vo.converse()
    assert not vo.gate.armed(time.monotonic())  # nothing said by voice: typing doesn't open the mic to the room
    vo.heard_at = time.monotonic()
    vo.converse()
    assert vo.gate.armed(time.monotonic())


def test_talking_over_her_echo_stop_or_interrupt():
    from app.voice import barge

    said = ["¡Listo! Ya te abrí Spotify.", "¿Quieres otra?"]
    assert barge(None, said) == "echo"  # noise
    assert barge("ya te abrí spotify", said) == "echo"  # her own voice through the speakers
    assert barge("para", said) == "stop"
    assert barge("mejor pon youtube", said) == "interrupt"


def test_the_segmenter_counts_the_voice_in_what_it_hears():
    seg = Segmenter(silence_ms=320, min_ms=100)
    run(seg, [0.9] * 10)
    assert 300 <= seg.voiced_ms < 340  # 10 chunks of 32 ms


class Talking:
    """A fake Speaker in the middle of a sentence."""

    def __init__(self):
        self.playing, self.stopped, self.gain = True, 0, []

    def recent(self):
        return ["¡Listo! Ya te abrí Spotify."]

    def duck(self, on):
        self.gain.append(on)

    def stop(self):
        self.stopped += 1
        self.playing = False


def test_over_her_echo_lets_her_go_on():
    from app import voice as v

    vo, cut = v.Voice(), []
    vo.speaker, vo.on_interrupt = Talking(), lambda: cut.append(1)
    assert vo._over_her(("ya te abrí spotify", "es"), 1.0, 0.2) is None
    assert vo.speaker.stopped == 0 and vo.speaker.gain == [False] and cut == []


def test_over_her_a_stop_word_only_stops_her():
    from app import voice as v

    vo, cut = v.Voice(), []
    vo.speaker, vo.on_interrupt = Talking(), lambda: cut.append(1)
    vo.heard_at = time.monotonic()  # he's talking to her
    assert vo._over_her(("para", "es"), 0.5, 0.2) is None
    assert vo.speaker.stopped == 1 and cut == [1]


def test_over_her_something_new_cuts_her_and_goes_through_without_her_name():
    from app import voice as v

    vo, cut = v.Voice(), []
    vo.speaker, vo.on_interrupt = Talking(), lambda: cut.append(1)
    vo.heard_at = time.monotonic()  # he's talking to her
    assert vo._over_her(("mejor pon youtube", "es"), 1.0, 0.2) == ("mejor pon youtube", "es")
    assert vo.speaker.stopped == 1 and cut == [1]
    assert vo.gate.armed(time.monotonic())  # the window is open: the gate lets it through



def test_over_her_overheard_talk_without_her_name_is_not_him(tmp_path):
    # music or a video playing while she talks must not cut her off and become his message
    from app import voice as v

    vo, cut = v.Voice(log_path=tmp_path / "voz.log"), []
    vo.speaker, vo.on_interrupt = Talking(), lambda: cut.append(1)
    assert vo._over_her(("y entonces le dije a mi jefe que no pienso volver", "es"), 2.0, 0.2) is None
    assert vo.speaker.stopped == 0 and cut == [] and vo.speaker.gain == [False]
    assert not (tmp_path / "voz.log").exists()  # overheard: never written
    assert vo._over_her(("Capri, mejor pon youtube", "es"), 1.0, 0.2) is not None  # her name: it's him
    assert vo.speaker.stopped == 1 and cut == [1]


def test_overheard_chat_cant_keep_the_conversation_going(monkeypatch):
    from app import voice as v

    vo = v.Voice()
    monkeypatch.setattr(v.Voice, "on", property(lambda self: True))
    vo._pass("Capri, qué hora es", "es", 1.0, 0.1)
    for _ in range(v.MAX_FOLLOWUPS):
        vo.converse()
        assert vo.gate.armed(time.monotonic())
        vo._pass("y algo más", "es", 1.0, 0.1)  # passes as chat, without her name
    vo.gate.until = 0
    vo.converse()
    assert not vo.gate.armed(time.monotonic())  # enough: her name again
    vo._pass("Capri, sigue", "es", 1.0, 0.1)
    vo.converse()
    assert vo.gate.armed(time.monotonic())


def test_hotkey_only_mode_opens_no_conversation_window(monkeypatch):
    from app import voice as v

    vo = v.Voice(wake=False)
    monkeypatch.setattr(v.Voice, "on", property(lambda self: True))
    vo.heard_at = time.monotonic()
    vo.converse()
    assert not vo.gate.armed(time.monotonic())


def test_turning_the_voice_off_frees_whisper(monkeypatch):
    from app import voice as v

    vo = v.Voice()
    vo._whisper = object()  # loaded: ~1 GB of the GPU

    def broken():
        raise RuntimeError("no microphone")

    monkeypatch.setattr(vo, "_load", broken)
    vo._run()
    assert vo._whisper is None and vo.state == "off"
