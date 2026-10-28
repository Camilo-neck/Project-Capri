from datetime import datetime

import pytest

from app.reminders import when

NOW = datetime(2026, 10, 28, 15, 10)  # a Wednesday, 3:10 pm


@pytest.mark.parametrize("said, at", [
    ("recuérdame en 20 minutos sacar la ropa", datetime(2026, 10, 28, 15, 30)),
    ("avísame en 20 min", datetime(2026, 10, 28, 15, 30)),
    ("en una hora llamar a mamá", datetime(2026, 10, 28, 16, 10)),
    ("en 2 horas y 15 minutos", datetime(2026, 10, 28, 17, 25)),
    ("en 1h30 apagar el horno", datetime(2026, 10, 28, 16, 40)),
    ("en media hora", datetime(2026, 10, 28, 15, 40)),
    ("en un cuarto de hora", datetime(2026, 10, 28, 15, 25)),
    ("dentro de 5 minutos", datetime(2026, 10, 28, 15, 15)),
    ("remind me in 10 minutes to stretch", datetime(2026, 10, 28, 15, 20)),
    ("in half an hour", datetime(2026, 10, 28, 15, 40)),
    ("in an hour", datetime(2026, 10, 28, 16, 10)),
    ("a las 18:30 llamar al taller", datetime(2026, 10, 28, 18, 30)),
    ("a las 6 de la tarde", datetime(2026, 10, 28, 18, 0)),
    ("a las 6", datetime(2026, 10, 28, 18, 0)),  # 6 am already passed: the next 6, this evening
    ("a las 9 de la noche", datetime(2026, 10, 28, 21, 0)),
    ("a las 10", datetime(2026, 10, 28, 22, 0)),
    ("a las 2 de la tarde", datetime(2026, 10, 29, 14, 0)),  # already passed today: tomorrow
    ("at 6pm", datetime(2026, 10, 28, 18, 0)),
    ("at 6:45 pm call mom", datetime(2026, 10, 28, 18, 45)),
    ("mañana a las 9 llamar al taller", datetime(2026, 10, 29, 9, 0)),
    ("mañana a las 9 de la mañana", datetime(2026, 10, 29, 9, 0)),
    ("pasado mañana a las 8", datetime(2026, 10, 30, 8, 0)),
    ("tomorrow at 9", datetime(2026, 10, 29, 9, 0)),
    ("al mediodía", datetime(2026, 10, 29, 12, 0)),
    ("a medianoche", datetime(2026, 10, 29, 0, 0)),
])
def test_when_is_read_off_his_words(said, at):
    assert when(said, NOW) == at


@pytest.mark.parametrize("said", ["recuérdame sacar la ropa", "avísame luego", "tengo 3 gatos", ""])
def test_no_time_said_is_none(said):
    assert when(said, NOW) is None


# ---- through her: asking, the button, and the alarm ----

import asyncio
import json

from fastapi.testclient import TestClient

from app.memory import Memory
from app.orchestrator import Orchestrator
from app.ws import create_app

TOKEN = "test-token"
ORIGIN = {"origin": "http://tauri.localhost"}


def say(texto: str, accion: dict | None = None) -> str:
    return json.dumps({"emocion": "neutral", "gesto": "ninguno", "accion": accion, "texto": texto})


def scripted(*replies: str):
    calls: list[list[dict]] = []

    async def generate(messages):
        calls.append(messages)
        yield replies[min(len(calls), len(replies)) - 1]

    return generate, calls


def until(ws, kind: str) -> list[dict]:
    msgs = []
    while not msgs or msgs[-1]["type"] != kind:
        msgs.append(ws.receive_json())
    return msgs


def orchestrator(tmp_path, *replies: str, now: datetime = NOW) -> Orchestrator:
    return Orchestrator(scripted(*replies)[0], memory=Memory(tmp_path / "m.db"), clock=lambda: now)


ROPA = {"nombre": "recordatorio", "args": {"texto": "sacar la ropa"}}


def test_asking_for_a_reminder_keeps_it_and_offers_to_cancel(tmp_path):
    orch = orchestrator(tmp_path, say("Va, te aviso.", ROPA), say("Listo, a las 3:30."))
    with TestClient(create_app(TOKEN, orch, reminders=False)).websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "text_input", "text": "recuérdame en 20 minutos sacar la ropa"})
        buttons = until(ws, "buttons")[-1]
        assert [b["texto"] for b in buttons["botones"]] == ["Cancelar"]
        assert [(t, c) for _, t, c in orch.alarms.pending()] == [("sacar la ropa", datetime(2026, 10, 28, 15, 30))]
        ws.send_json({"type": "pressed", "id": buttons["id"], "boton": buttons["botones"][0]["id"]})
        until(ws, "utterance_end")
    assert orch.alarms.pending() == []


def test_without_a_time_she_asks_when(tmp_path):
    generate, calls = scripted(say("Va.", ROPA), say("¿A qué hora?"))
    orch = Orchestrator(generate, memory=Memory(tmp_path / "m.db"), clock=lambda: NOW)
    asyncio.run(orch.turn("recuérdame sacar la ropa", lambda m: asyncio.sleep(0)))
    result = [m["content"] for m in calls[-1] if m["role"] == "user"][-1]
    assert "pregúntale" in result and orch.alarms.pending() == []


def test_her_own_turns_never_set_one(tmp_path):
    orch = orchestrator(tmp_path, say("Te lo apunto.", ROPA), say("Vale."))
    asyncio.run(orch.own_turn("[aviso automático, no lo escribió el usuario] en 20 minutos", lambda m: asyncio.sleep(0)))
    assert orch.alarms.pending() == []


def collect():
    sent: list[dict] = []

    async def send(msg):
        sent.append(msg.model_dump())

    return sent, send


def test_when_due_she_says_it_once_with_done_and_snooze(tmp_path):
    clock = [NOW]
    orch = Orchestrator(scripted(say("..."))[0], memory=Memory(tmp_path / "m.db"), clock=lambda: clock[0])
    orch.alarms.add("sacar la ropa", datetime(2026, 10, 28, 15, 30))
    sent, send = collect()
    asyncio.run(orch.ring(send))
    assert sent == []  # not yet
    clock[0] = datetime(2026, 10, 28, 15, 30, 2)
    asyncio.run(orch.ring(send))
    said = "".join(m["text"] for m in sent if m["type"] == "text_delta")
    buttons = [m for m in sent if m["type"] == "buttons"][-1]
    assert "sacar la ropa" in said and [b["texto"] for b in buttons["botones"]] == ["Hecho", "10 min más"]
    sent.clear()
    asyncio.run(orch.ring(send))
    assert sent == []  # said once
    asyncio.run(orch.press(buttons["id"], buttons["botones"][1]["id"], send))  # 10 min más
    assert [(t, c) for _, t, c in orch.alarms.pending()] == [("sacar la ropa", datetime(2026, 10, 28, 15, 40, 2))]


def test_do_not_disturb_and_fullscreen_hold_it_until_after(tmp_path):
    orch = orchestrator(tmp_path, say("..."), now=datetime(2026, 10, 28, 16, 0))
    orch.alarms.add("sacar la ropa", datetime(2026, 10, 28, 15, 30))
    sent, send = collect()
    orch.dnd = True
    asyncio.run(orch.ring(send))
    orch.dnd, orch.away = False, True
    asyncio.run(orch.ring(send))
    assert sent == []
    orch.away = False
    asyncio.run(orch.ring(send))
    assert "sacar la ropa" in "".join(m["text"] for m in sent if m["type"] == "text_delta")


def test_one_missed_while_she_was_closed_comes_up_as_missed(tmp_path):
    Orchestrator(scripted(say("..."))[0], memory=Memory(tmp_path / "m.db")).alarms.add("llamar al taller", datetime(2026, 10, 28, 9, 0))
    orch = orchestrator(tmp_path, say("..."))  # opened again at 3:10 pm
    sent, send = collect()
    asyncio.run(orch.ring(send))
    said = "".join(m["text"] for m in sent if m["type"] == "text_delta")
    assert "llamar al taller" in said and "9:00" in said


def test_recordatorios_lists_them_with_a_cancel_each(tmp_path):
    orch = orchestrator(tmp_path, say("..."))
    orch.alarms.add("sacar la ropa", datetime(2026, 10, 28, 15, 30))
    orch.alarms.add("llamar al taller", datetime(2026, 10, 29, 9, 0))
    sent, send = collect()
    asyncio.run(orch.turn("/recordatorios", send))
    said = "".join(m["text"] for m in sent if m["type"] == "text_delta")
    assert "sacar la ropa" in said and "mañana a las 9:00" in said
    assert [b["texto"] for b in [m for m in sent if m["type"] == "buttons"][-1]["botones"]] == \
        ["Cancelar «sacar la ropa»", "Cancelar «llamar al taller»"]
