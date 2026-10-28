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
