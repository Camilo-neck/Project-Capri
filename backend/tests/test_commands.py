import pytest

from app import commands
from app.spoken import plain


def test_every_alias_and_spoken_sentence_belongs_to_one_command():
    names = {c["nombre"] for c in commands.COMMANDS}
    seen: dict[str, str] = {}
    for c in commands.COMMANDS:
        for word in [c["nombre"], *c["alias"]]:
            assert word not in seen, f"{word} is {seen.get(word)} and {c['nombre']}"
            seen[word] = c["nombre"]
        assert c["grupo"] in commands.GROUPS
        assert c["donde"] in ("avatar", "backend")
    said: dict[str, str] = {}
    for c in commands.COMMANDS:
        for v in c["voz"]:
            assert v["hace"].split()[0] in names, v["hace"]
            for phrase in v["dice"]:
                key = plain(phrase)
                assert key not in said, f"«{phrase}» does {said.get(key)} and {v['hace']}"
                said[key] = v["hace"]


@pytest.mark.parametrize("typed, canon", [
    ("/forget my cat", "/olvida my cat"),
    ("/dnd", "/nomolestes"),
    ("/DND on", "/nomolestes on"),
    ("/Escóndete", "/escondete"),
    ("/OLVIDA todo", "/olvida todo"),
    ("/forget everything", "/olvida todo"),
    ("/olvida all", "/olvida todo"),
    ("/help voz", "/ayuda voz"),
    ("/reminders", "/recordatorios"),
    ("/mira qué es esto", "/mira qué es esto"),
    ("hello", "hello"),
    ("/algo raro", "/algo raro"),
])
def test_typed_commands_any_case_accent_or_language(typed, canon):
    assert commands.canonical(typed) == canon


def test_help_lists_every_command_by_group():
    text = commands.help_text()
    for c in commands.COMMANDS:
        assert c["nombre"] in text
    assert text.index("Capri") < text.index("/escondete") < text.index("Memoria") < text.index("/olvida")


def test_help_for_one_group():
    text = commands.help_text("memoria")
    assert "/olvida" in text and "/recordatorios" in text and "/escondete" not in text


def test_help_for_the_voice_shows_what_to_say():
    text = commands.help_text("voz")
    assert "escóndete" in text and "no molestes" in text and "mira la pantalla y dime qué error sale" in text
    assert "/escondete" not in text  # what to say, not what to type


def test_help_for_something_unknown_says_which_groups_there_are():
    text = commands.help_text("cocina")
    assert "capri" in text and "voz" in text and "/olvida" not in text


@pytest.mark.parametrize("topic", ["", "voz", "memoria", "cocina"])
def test_help_out_loud_is_only_its_first_line(topic):
    from app.speech import Sentences, clean

    s = Sentences()
    text = commands.help_text(topic)
    said = [clean(x) for x in s.feed(text + "\n") + s.flush()]
    assert " ".join(x for x in said if x) == clean(text.splitlines()[0])
