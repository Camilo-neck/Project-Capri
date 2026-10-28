import pytest

from app.spoken import alias, strip_wake, to_command


@pytest.mark.parametrize("said, left", [
    ("Hey Capri", ""),
    ("Hey, Capri. Abre Spotify", "Abre Spotify"),
    ("oye Capri qué hora es", "qué hora es"),
    ("Hey Kapri, what time is it?", "what time is it?"),
    ("Capri, look at my screen", "look at my screen"),
    ("ok capri", ""),
    ("Eh, hey Capri, abre Spotify", "abre Spotify"),
    ("Okey Capri, qué hora es", "qué hora es"),
    ("Bueno Capri pon música", "pon música"),
])
def test_wake_phrase(said, left):
    assert strip_wake(said) == (True, left)


@pytest.mark.parametrize("said", ["me gusta capri como mascota", "hey, what time is it", "abre spotify", "the capricorn sign", ""])
def test_no_wake(said):
    assert strip_wake(said)[0] is False


@pytest.mark.parametrize("said, cmd", [
    ("Escóndete.", "/escondete"), ("hide", "/escondete"), ("Vuelve", "/vuelve"), ("Come back!", "/vuelve"),
    ("No me molestes", "/nomolestes"), ("Do not disturb.", "/nomolestes"),
    ("Olvida todo", "/olvida todo"), ("forget everything", "/olvida todo"),
    ("olvida que me gusta el café", "/olvida me gusta el café"),
    ("Mira la pantalla", "/mira"), ("what do you see", "/mira"),
    ("look at my screen and tell me the error", "/mira look at my screen and tell me the error"),
    ("Ciérrate", "/cierra"), ("close Capri", "/cierra"),
    ("modo claude off", "/claude off"), ("ask Claude what it is doing", "/claude what it is doing"),
])
def test_spoken_commands(said, cmd):
    assert to_command(said) == cmd


def test_chat_is_untouched():
    assert to_command("¿Qué hora es?") == "¿Qué hora es?"
    assert to_command("hide the cookies in the jar please") == "hide the cookies in the jar please"


def test_english_slash_aliases():
    assert alias("/forget my cat") == "/olvida my cat"
    assert alias("/dnd") == "/nomolestes"
    assert alias("/mira") == "/mira"
    assert alias("hello") == "hello"


@pytest.mark.parametrize("said", [
    "Mira lo que tengo en la pantalla", "mira lo que estoy jugando", "¿Qué ves en mi pantalla?",
    "revisa mi pantalla, sale un error", "check my screen please", "look at this",
])
def test_looking_said_any_way(said):
    assert to_command(said) == f"/mira {said}"


def test_screen_without_looking_is_chat():
    assert to_command("compré una pantalla nueva") == "compré una pantalla nueva"


@pytest.mark.parametrize("said, cmd", [
    ("Escóndete por favor.", "/escondete"), ("Escóndete un rato", "/escondete"), ("please hide", "/escondete"),
    ("No molestes, por favor", "/nomolestes"), ("olvida todo por favor.", "/olvida todo"),
    ("Capri, escóndete", "/escondete"),
])
def test_commands_said_politely(said, cmd):
    assert to_command(said) == cmd


@pytest.mark.parametrize("said", [
    "check out this song by Drake", "what's the best screen size for gaming", "revisa el monitor de recursos",
    "ve a la pantalla de inicio", "mira esto que me pasó hoy en el trabajo",
])
def test_talk_about_screens_is_not_a_look(said):
    # each of these took a screenshot (and with a cloud brain, sent it out)
    assert to_command(said) == said


def test_this_on_its_own_is_still_a_look():
    assert to_command("mira esto") == "/mira"
    assert to_command("mira esto en mi pantalla") == "/mira mira esto en mi pantalla"


@pytest.mark.parametrize("said, left", [
    ("Capri", ""),
    ("Capri.", ""),
    ("psst Capri, ven", "ven"),
    ("abre Spotify, Capri", "abre Spotify"),
    ("te quiero mucho Capri", "te quiero mucho"),
    ("abre spotify kapri", "abre spotify"),
    ("What time is it, Capri?", "What time is it"),
])
def test_her_name_alone_first_or_last(said, left):
    assert strip_wake(said) == (True, left)


@pytest.mark.parametrize("said", ["la chica de capri baila sola", "le hablé a Capri ayer de ti"])
def test_her_name_mid_sentence_is_talk_about_her(said):
    assert strip_wake(said)[0] is False


def test_other_names_she_answers_to():
    assert strip_wake("oye cap, pon música", names=("capri", "cap")) == (True, "pon música")
    assert strip_wake("pon música, nova", names=("capri", "nova")) == (True, "pon música")
    assert strip_wake("oye cap, pon música")[0] is False  # only when it's in [voz] nombres


@pytest.mark.parametrize("said", ["pon...", "pon…", "abre la", "busca el clima en", "play the", "pon algo de,"])
def test_a_sentence_left_hanging(said):
    from app.spoken import dangling

    assert dangling(said)


@pytest.mark.parametrize("said", ["abre spotify", "¿qué hora es?", "Capri", ""])
def test_a_finished_sentence(said):
    from app.spoken import dangling

    assert not dangling(said)


@pytest.mark.parametrize("said", ["para", "Capri, para", "espera", "cállate", "stop", "ya, basta", "wait", "Para ya.", "shh"])
def test_words_that_just_stop_her(said):
    from app.spoken import stop_word

    assert stop_word(said)


@pytest.mark.parametrize("said", ["para mañana pon una alarma", "ya te dije que no", "espera que busco el clima", ""])
def test_sentences_that_start_like_a_stop_but_say_more(said):
    from app.spoken import stop_word

    assert not stop_word(said)
