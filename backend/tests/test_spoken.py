import pytest

from app.spoken import alias, strip_wake, to_command


@pytest.mark.parametrize("said, left", [
    ("Hey Capri", ""),
    ("Hey, Capri. Abre Spotify", "Abre Spotify"),
    ("oye Capri qué hora es", "qué hora es"),
    ("Hey Kapri, what time is it?", "what time is it?"),
    ("Capri, look at my screen", "look at my screen"),
    ("ok capri", ""),
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
