import numpy as np

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

    def __call__(self, audio, rate, block):
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
