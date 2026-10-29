import asyncio
import json

import pytest

from app import routines, settings, tools
from app.orchestrator import Orchestrator
from app.protocol import TextDelta


@pytest.fixture(autouse=True)
def config(tmp_path, monkeypatch):
    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    (tmp_path / "config.toml").write_text("", encoding="utf-8")
    return tmp_path / "config.toml"


@pytest.mark.parametrize("text", ["Modo Chamba", "modo chamba.", "activa el modo chamba", "Pon modo chamba por favor",
                                  "Capri, modo chamba", "oye, activa modo chamba", "entra en modo chamba", "start chamba mode"])
def test_modo_chamba_said_any_way_is_the_routine(text):
    assert routines.match(text, settings.load().routines) == "chamba"


@pytest.mark.parametrize("text", ["no quiero modo chamba hoy", "¿qué es el modo chamba?", "abre spotify", "chamba",
                                  "me gusta el modo chamba de mi amigo"])
def test_talking_about_it_is_not_asking_for_it(text):
    assert routines.match(text, settings.load().routines) is None


def test_the_routine_and_its_phrases_come_from_config(config):
    config.write_text('[rutinas.estudio]\nfrases = ["modo estudio", "a estudiar"]\napps = ["notepad"]\nmusica = "lo-fi"\n', encoding="utf-8")
    s = settings.load()
    assert routines.match("a estudiar", s.routines) == "estudio"
    assert s.routines["estudio"].apps == ("notepad",) and s.routines["estudio"].music == "lo-fi"
    assert routines.match("modo chamba", s.routines) == "chamba"  # hers stays unless he redefines it


def run_turn(text, monkeypatch, charla=False, own=False, fail=(), apps_log=None):
    opened, played = apps_log if apps_log is not None else [], []

    def open_app(a, s):
        if a.nombre in fail:
            raise tools.ToolError(f"no encontré «{a.nombre}»")
        opened.append(a.nombre)
        return f"Abrí {a.nombre}."

    def play(a, s):
        played.append((a.consulta, a.tipo))
        return "Sonando"

    monkeypatch.setattr(tools, "open_app", open_app)
    monkeypatch.setattr(tools, "play_spotify", play)
    asked = []

    async def generate(messages):
        asked.append(messages)
        yield json.dumps({"emocion": "neutral", "gesto": "ninguno", "accion": None, "texto": "ok"})

    sent = []

    async def send(msg):
        sent.append(msg)

    asyncio.run(Orchestrator(generate).turn(text, send, charla=charla, own=own))
    said = "".join(m.text for m in sent if isinstance(m, TextDelta))
    return opened, played, asked, said


def test_modo_chamba_opens_vscode_and_warp_and_starts_music_without_the_model(monkeypatch):
    opened, played, asked, said = run_turn("Modo Chamba", monkeypatch)
    assert sorted(opened) == ["vscode", "warp"]
    assert len(played) == 1
    assert not asked  # no model, no tool call it could invent
    assert "VSCode" in said and "Warp" in said and "música" in said


def test_one_app_that_wont_open_doesnt_stop_the_rest(monkeypatch):
    opened, played, _, said = run_turn("modo chamba", monkeypatch, fail=("warp",))
    assert opened == ["vscode"] and played
    assert "Warp" in said and "no pude" in said


def test_a_routine_heard_without_her_name_or_that_she_said_herself_never_runs(monkeypatch):
    for kw in ({"charla": True}, {"own": True}):
        opened, played, asked, _ = run_turn("modo chamba", monkeypatch, **kw)
        assert not opened and not played, kw  # the room, or herself: not him
        assert asked, kw  # it's just chat


def test_the_system_never_opens_from_a_routine(monkeypatch, config):
    config.write_text('[rutinas.chamba]\nfrases = ["modo chamba"]\napps = ["regedit", "vscode"]\n', encoding="utf-8")
    opened, _, _, said = run_turn("modo chamba", monkeypatch)
    assert opened == ["vscode"] and "regedit" in said.lower()
