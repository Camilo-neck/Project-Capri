import numpy as np
import pytest

from app.speech import Sentences, clean, echo, fx, lang_of


def test_sentences_come_out_as_they_finish():
    s = Sentences()
    assert s.feed("¡Hola, C! Ya ") == ["¡Hola, C!"]
    assert s.feed("te abrí Spotify. ¿Algo") == ["Ya te abrí Spotify."]
    assert s.flush() == ["¿Algo"]
    assert s.flush() == []


def test_sentences_dont_break_on_abbreviations_or_numbers():
    s = Sentences()
    assert s.feed("Habla el Dr. Pérez de 3.5 cosas, etc. y más. ") == ["Habla el Dr. Pérez de 3.5 cosas, etc. y más."]
    assert s.feed("Mmm… vale\nlisto") == ["Mmm…", "vale"]
    assert s.flush() == ["listo"]


def test_clean_leaves_only_what_can_be_said():
    assert clean("**Listo** 😄 mira https://x.com/a") == "Listo mira el enlace"
    assert clean("~~ya~~ `/mira`") == "ya /mira"
    assert clean("😄") == ""


def test_her_language_by_the_words():
    assert lang_of("I opened it for you") == "en"
    assert lang_of("Ya te lo abrí") == "es"
    assert lang_of("") == "es"


def test_her_own_voice_through_the_speakers_is_echo():
    said = ["¡Listo! Ya te abrí Spotify.", "¿Quieres otra?"]
    assert echo("ya te abrí spotify", said)
    assert echo("Listo, ya te abrí Spotify", said)
    assert not echo("para", said)
    assert not echo("mejor pon youtube", said)
    assert not echo("abre youtube", [])


def test_the_robot_and_glitch_effects():
    rate = 24000
    voice = np.sin(np.linspace(0, 2000, rate)).astype("float32") * 0.5
    assert np.array_equal(fx(voice, rate, robot=0, glitch=0), voice)  # off: untouched
    robot = fx(voice, rate, robot=1, glitch=0)
    assert robot.shape == voice.shape and not np.allclose(robot, voice)
    assert np.abs(robot).max() <= 1
    glitched = fx(voice, rate, robot=0, glitch=1, seed=1)
    assert len(glitched) >= len(voice)  # stutters repeat bits, never drop words
    assert np.array_equal(fx(voice, rate, robot=0, glitch=1, seed=1), glitched)  # same seed, same glitches


# --- Speaker, with a fake voice and a fake sound card ---
import threading
import time

from app.protocol import Level, TextDelta, UtteranceEnd, UtteranceStart
from app.speech import Speaker

RATE = 1000  # fake: one block = 50 samples = 50 ms


class Card:
    """Plays blocks as fast as asked (or slowly, to stop it mid-sentence) and keeps what came out."""

    def __init__(self, delay=0.0):
        self.out, self.delay = [], delay

    def __call__(self, chunks, rate, block):
        for audio in chunks:
            for i in range(0, len(audio), rate // 20):
                b = block(audio[i:i + rate // 20])
                if b is None:
                    return
                self.out.append(b)
                time.sleep(self.delay)


def speaker(card=None, fail=False, seconds=0.2):
    said, levels = [], []

    def synth(text, lang, speed=1.0):
        if fail:
            raise RuntimeError("no voice model")
        said.append(text)
        return np.full(int(RATE * seconds), 0.5, dtype="float32"), RATE

    sp = Speaker(synth=synth, play=card or Card(), emit=levels.append)
    return sp, said, levels


def done(sp, timeout=3):
    ev = threading.Event()
    sp.after(ev.set)
    assert ev.wait(timeout), "she never finished"


def reply(sp, *deltas, cut=False):
    sp.see(UtteranceStart(emocion="neutral", gesto="ninguno"))
    for d in deltas:
        sp.see(TextDelta(text=d))
    sp.see(UtteranceEnd(cortada=cut) if cut else UtteranceEnd())


def test_she_says_the_reply_sentence_by_sentence():
    sp, said, levels = speaker()
    reply(sp, "Hola. Ya ", "está.")
    done(sp)
    assert said == ["Hola.", "Ya está."]
    assert levels and all(isinstance(m, Level) and m.fuente == "tts" for m in levels)
    assert [s for s in sp.recent()] == ["Hola.", "Ya está."]


def test_her_next_reply_in_the_same_turn_waits_for_her_to_finish():
    sp, said, _ = speaker(Card(delay=0.01))
    reply(sp, "¡Dale! Ya te lo abro.")
    reply(sp, "Listo.")  # after the action: she doesn't cut her own sentence
    done(sp)
    assert said == ["¡Dale!", "Ya te lo abro.", "Listo."]


def test_stopping_drops_what_was_left_to_say():
    card = Card(delay=0.05)
    sp, said, _ = speaker(card, seconds=1)
    reply(sp, "Primera frase. Segunda frase. Tercera frase.")
    time.sleep(0.15)
    sp.stop()  # a new message of his
    reply(sp, "Otra cosa.")
    done(sp)
    assert said[-1] == "Otra cosa."
    assert sp.recent()[-1] == "Otra cosa."
    assert "Tercera frase." not in sp.recent()  # it may have been synthesized ahead, but it never played


def test_stop_cuts_her_at_once():
    card = Card(delay=0.05)
    sp, _, _ = speaker(card, seconds=2)
    reply(sp, "Una frase larguísima.")
    time.sleep(0.2)
    assert sp.playing
    sp.stop()
    assert not sp.playing
    n = len(card.out)
    time.sleep(0.2)
    assert len(card.out) <= n + 1  # at most the block that was being written


def test_duck_turns_her_down():
    card = Card(delay=0.02)
    sp, _, _ = speaker(card, seconds=0.5)
    sp.duck(True)
    reply(sp, "Baja.")
    done(sp)
    assert all(np.allclose(b, 0.125) for b in card.out)  # 0.5 * 0.25


def test_after_runs_once_when_she_is_done_or_right_away():
    sp, _, _ = speaker()
    calls = []
    sp.after(lambda: calls.append(1))
    assert calls == [1]  # nothing to say: now
    reply(sp, "Hola.")
    sp.after(lambda: calls.append(2))
    done(sp)
    time.sleep(0.05)
    assert calls == [1, 2]


def test_off_she_says_nothing():
    sp, said, _ = speaker()
    sp.enabled = False
    reply(sp, "Hola.")
    time.sleep(0.1)
    assert said == [] and not sp.playing


def test_without_a_voice_she_goes_back_to_text():
    sp, said, _ = speaker(fail=True)
    reply(sp, "Hola.")
    done(sp)
    assert not sp.enabled and not sp.playing


def test_a_cut_reply_stops_her_voice_too():
    card = Card(delay=0.05)
    sp, _, _ = speaker(card, seconds=2)
    reply(sp, "Algo largo que decir. ", cut=True)
    time.sleep(0.1)
    assert not sp.playing



def test_nothing_sayable_is_skipped():
    assert clean("-") == "" and clean("---") == "" and clean("* * *") == ""
    assert fx(np.zeros(0, dtype="float32"), 24000, robot=0.5, glitch=0.5).size == 0


def test_one_sentence_she_cant_say_doesnt_mute_her():
    said = []

    def synth(text, lang, speed=1.0):
        if text == "Raro.":
            raise ValueError("no phonemes")
        said.append(text)
        return np.full(100, 0.5, dtype="float32"), RATE

    sp = Speaker(synth=synth, play=Card())
    reply(sp, "Hola. Raro. Adiós.")
    done(sp)
    assert sp.enabled and said == ["Hola.", "Adiós."]


def test_without_a_voice_at_all_she_says_so_once():
    off = []
    sp, _, _ = speaker(fail=True)
    sp.on_disabled = lambda: off.append(1)
    reply(sp, "Hola.")
    done(sp)
    time.sleep(0.05)
    assert not sp.enabled and off == [1]


def test_empty_audio_from_the_voice_is_skipped():
    def synth(text, lang, speed=1.0):
        return (np.zeros(0, dtype="float32") if text == "Nada." else np.full(100, 0.5, dtype="float32")), RATE

    sp = Speaker(synth=synth, play=Card())
    sp.robot = 0.5
    reply(sp, "Nada. Algo.")
    done(sp)
    assert sp.enabled and not sp.playing and sp.recent() == ["Algo."]


def test_a_streamed_sentence_plays_its_chunks_in_order():
    def synth(text, lang, speed=1.0):
        return (np.full(100, v, dtype="float32") for v in (0.1, 0.2, 0.3)), RATE

    card = Card()
    sp = Speaker(synth=synth, play=card)
    reply(sp, "Hola.")
    done(sp)
    out = np.concatenate(card.out)
    assert len(out) == 300 and list(out[::100]) == pytest.approx([0.1, 0.2, 0.3])
    assert sp.recent() == ["Hola."]


def test_stopping_cuts_a_sentence_still_being_made():
    closed = threading.Event()

    def synth(text, lang, speed=1.0):
        def chunks():
            try:
                for _ in range(100):  # 5 s of her, made slowly
                    time.sleep(0.02)
                    yield np.full(50, 0.5, dtype="float32")
            finally:
                closed.set()
        return (chunks() if text == "Larga." else iter([np.full(50, 0.5, dtype="float32")])), RATE

    card = Card(delay=0.01)
    sp = Speaker(synth=synth, play=card)
    reply(sp, "Larga.")
    time.sleep(0.6)  # it started playing (0.4 s buffered first)
    assert card.out
    sp.stop()
    assert closed.wait(1), "the voice model kept making the cut sentence"
    reply(sp, "Corta.")
    done(sp)
    assert sp.recent()[-1] == "Corta."


def test_releasing_her_voice_frees_the_model():
    closed = []

    def synth(text, lang, speed=1.0):
        return np.full(100, 0.5, dtype="float32"), RATE

    synth.close = lambda: closed.append(1)
    sp = Speaker(synth=synth, play=Card())
    sp.release()
    assert closed == [1] and not sp.playing


def test_when_the_cloned_voice_fails_she_goes_on_with_the_backup():
    from app.speech import fallback

    calls = []

    def qwen(text, lang, speed=1.0):
        calls.append(text)
        raise RuntimeError("no GPU")

    def kokoro(text, lang, speed=1.0):
        return np.full(10, 0.5, dtype="float32"), 24000

    synth = fallback(qwen, kokoro)
    assert synth("Hola.", "es", 1.0)[1] == 24000
    assert synth("Otra.", "es", 1.0)[1] == 24000
    assert calls == ["Hola."]  # tried once, then Kokoro for good


FAKE_WORKER = r'''
import json, struct, sys
out = sys.stdout.buffer
def frame(b):
    out.write(struct.pack("<i", len(b)) + b)
    out.flush()
frame(b"")  # ready
n = 0
for line in sys.stdin:
    req = json.loads(line)
    if "stop" in req:
        continue
    n += 1
    if req["text"] == "Rompe.":
        out.write(struct.pack("<i", -1)); out.flush()
        continue
    for _ in range(3):
        frame(struct.pack("<240f", *([float(n)] * 240)))
    frame(b"")
'''


def qwen_fake(tmp_path):
    import sys

    from app.speech import qwen

    worker = tmp_path / "worker.py"
    worker.write_text(FAKE_WORKER, encoding="utf-8")
    return qwen(str(tmp_path), "capri", cmd=[sys.executable, "-I", str(worker)])


def test_the_cloned_voice_streams_from_its_own_process(tmp_path):
    synth = qwen_fake(tmp_path)
    try:
        chunks, rate = synth("Hola.", "es", 1.0)
        chunks = list(chunks)
        assert rate == 24000 and len(chunks) == 3 and all(c.dtype == np.float32 and c[0] == 1 for c in chunks)
        first, _ = synth("Larga.", "es", 1.0)
        next(first)
        first.close()  # cut after one chunk: the rest is dropped, not mixed into the next sentence
        assert [c[0] for c in synth("Otra.", "es", 1.0)[0]] == [3, 3, 3]
        with pytest.raises(RuntimeError):
            list(synth("Rompe.", "es", 1.0)[0])
    finally:
        synth.close()
    assert synth.proc.poll() is not None  # gone: its VRAM is free


def test_warming_up_and_her_first_sentence_start_one_process(tmp_path, monkeypatch):
    import subprocess

    from app import speech

    spawned, real = [], subprocess.Popen

    def popen(*a, **kw):
        time.sleep(0.2)  # a slow start: the other caller arrives meanwhile
        spawned.append(1)
        return real(*a, **kw)

    monkeypatch.setattr(speech.subprocess, "Popen", popen)
    synth = qwen_fake(tmp_path)
    try:
        threads = [threading.Thread(target=synth, args=("Hola.", "es")) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(5)
        assert spawned == [1]
    finally:
        synth.close()


def test_her_robotic_touch_is_seamless_across_streamed_chunks():
    rate = 24000
    t = np.arange(rate) / rate
    voice = (0.5 * np.sin(2 * np.pi * 220 * t)).astype("float32")
    whole = fx(voice, rate, robot=0.6)
    parts, at = [], 0
    for size in (7919, 4000, 8000, rate - 19919):  # chunk edges anywhere, as the model streams them
        parts.append(fx(voice[at:at + size], rate, robot=0.6, start=at, before=voice[:at]))
        at += size
    assert np.allclose(np.concatenate(parts), whole, atol=1e-6)


def test_a_no_ends_its_sentence_like_any_word():
    assert Sentences().feed("Pues no. Mejor mañana. ") == ["Pues no.", "Mejor mañana."]


def test_list_lines_are_for_reading_not_saying():
    assert clean("/olvida <algo>|todo (/forget): Olvida lo que recuerda.") == ""
    assert clean("• Memoria") == ""
    assert clean("Mis comandos (en inglés también valen):") == "Mis comandos (en inglés también valen):"


def test_changing_her_voice_stops_her_frees_the_old_one_and_uses_the_new():
    closed, used = [], []

    def old(text, lang, speed=1.0):
        used.append("old")
        return np.full(10, 0.5, dtype="float32"), 24000

    def new(text, lang, speed=1.0):
        used.append("new")
        return np.full(10, 0.5, dtype="float32"), 24000

    old.close = lambda: closed.append("old")
    sp = Speaker(synth=old, play=Card(), voice="capri")
    sp.use(new, "dora")
    assert closed == ["old"] and sp.voice == "dora" and sp.synth is new


def test_the_holographic_touch_adds_echo_and_shimmer_and_a_tail_but_never_clips():
    from app.speech import holo

    rate = 24000
    t = np.arange(rate) / rate
    voice = (0.5 * np.sin(2 * np.pi * 220 * t)).astype("float32")
    out = holo(voice, rate)
    assert len(out) == len(voice) + int(0.6 * rate) and out.dtype == np.float32 and np.abs(out).max() <= 1.0  # room for the echo
    assert np.abs(out[len(voice):]).max() > 0.01  # the echo outlives the word
    assert np.array_equal(holo(voice, rate), out)  # same every time
    assert holo(np.zeros(0, dtype="float32"), rate).size == 0


def test_edge_speaks_through_the_service_decodes_it_and_tunes_pace(monkeypatch):
    import sys
    import types

    from app import speech

    asked = []

    class Communicate:
        def __init__(self, text, voice, rate="+0%", pitch="+0Hz"):
            asked.append((text, voice, rate, pitch))

        async def stream(self):
            yield {"type": "audio", "data": b"mp3-1"}
            yield {"type": "WordBoundary"}
            yield {"type": "audio", "data": b"mp3-2"}

    monkeypatch.setitem(sys.modules, "edge_tts", types.SimpleNamespace(Communicate=Communicate))
    monkeypatch.setattr(speech, "_decode_mp3", lambda data: np.full(2400, 0.4, dtype="float32") if data == b"mp3-1mp3-2" else None)
    synth = speech.edge({"es": "es-MX-DaliaNeural", "en": "en-US-AriaNeural"})
    audio, rate = synth("Hello there.", "en", 1.25)
    assert rate == 24000 and len(audio) == 2400 + int(0.6 * 24000) and np.abs(audio).max() <= 1.0
    assert asked == [("Hello there.", "en-US-AriaNeural", "+25%", "+0Hz")]
    synth("Hola.", "es", 0.8)
    assert asked[1][1:3] == ("es-MX-DaliaNeural", "-20%")
