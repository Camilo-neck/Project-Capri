import asyncio
import json
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app import calendar_ics, settings
from app.memory import Memory
from app.orchestrator import Orchestrator
from app.ws import create_app

TOKEN = "test-token"
ORIGIN = {"origin": "http://tauri.localhost"}
NOON = datetime(2026, 10, 27, 12, 0)

ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:dentista
DTSTART:20261027T163000
DTEND:20261027T170000
SUMMARY:Dentista
END:VEVENT
END:VCALENDAR
"""


def say(texto: str) -> str:
    return json.dumps({"emocion": "neutral", "gesto": "ninguno", "accion": None, "texto": texto})


def scripted(text: str = "Hola."):
    calls: list[list[dict]] = []

    async def generate(messages):
        calls.append(messages)
        yield say(text)

    return generate, calls


def orchestrator(tmp_path, idle: float = 5, now: datetime = NOON):
    generate, calls = scripted()
    orch = Orchestrator(generate, memory=Memory(tmp_path / "m.db"), idle_s=lambda: idle, clock=lambda: now)
    return orch, calls


async def drain(msg):
    pass


def run_chatter(orch: Orchestrator, now: datetime, seconds: float = 0.15) -> None:
    async def go():
        orch.clock = lambda: now
        task = asyncio.create_task(orch.chatter(drain, every_s=0.01))
        await asyncio.sleep(seconds)
        task.cancel()

    asyncio.run(go())


def prompts(calls) -> list[str]:
    return [next(m["content"] for m in reversed(c) if m["role"] == "user") for c in calls]


def test_greets_once_a_day_when_you_are_there(tmp_path):
    orch, calls = orchestrator(tmp_path)
    run_chatter(orch, NOON)
    assert len(calls) == 1 and "primera vez que le ves hoy" in prompts(calls)[0]
    run_chatter(orch, NOON + timedelta(minutes=5))
    assert len(calls) == 1  # not again today
    again, calls2 = orchestrator(tmp_path)  # a restart the same day: still not
    run_chatter(again, NOON + timedelta(minutes=10))
    assert calls2 == []


def test_keeps_quiet_when_away_idle_in_quiet_hours_or_dnd(tmp_path):
    orch, calls = orchestrator(tmp_path, idle=600)  # nobody at the keyboard
    run_chatter(orch, NOON)
    orch.idle_s = lambda: 5
    run_chatter(orch, datetime(2026, 10, 27, 23, 30))  # quiet hours (23:00-08:00 by default)
    orch.dnd = True
    run_chatter(orch, NOON)
    orch.dnd, orch.away = False, True
    run_chatter(orch, NOON)
    assert calls == []
    orch.away = False
    run_chatter(orch, NOON)
    assert len(calls) == 1


def test_comments_after_long_silence_within_the_hourly_limit(tmp_path):
    orch, calls = orchestrator(tmp_path)
    orch.memory.put("saludo", NOON.date().isoformat())  # already greeted today
    orch.last_user_at = NOON - timedelta(hours=3)
    run_chatter(orch, NOON)
    assert len(calls) == 1 and "buen rato" in prompts(calls)[0]
    run_chatter(orch, NOON + timedelta(minutes=30))  # just spoke up: not again until another long silence
    assert len(calls) == 1
    morning = datetime(2026, 10, 28, 8, 30)  # next day: a greeting is due...
    orch.chatted.extend([morning - timedelta(minutes=40), morning - timedelta(minutes=20)])
    run_chatter(orch, morning)  # ...but two in the last hour is the limit (2 by default)
    assert len(calls) == 1
    run_chatter(orch, morning + timedelta(minutes=45))  # one of them is over an hour old now
    assert len(calls) == 2 and "primera vez que le ves hoy" in prompts(calls)[1]


def test_nomolestes_and_its_shortcut_toggle_and_show_the_mode(tmp_path):
    orch, calls = orchestrator(tmp_path)
    with TestClient(create_app(TOKEN, orch, reminders=False)).websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "text_input", "text": "/nomolestes"})
        msgs = []
        while msgs[-1:] != [{"type": "state", "value": "idle"}]:
            msgs.append(ws.receive_json())
        assert {"type": "mode", "no_molestar": True, "claude": True} in msgs and orch.dnd
        ws.send_json({"type": "hotkey", "name": "no_molestar"})
        assert ws.receive_json() == {"type": "mode", "no_molestar": False, "claude": True}
    assert calls == []  # never reached the model


def test_claude_mode_shortcut_toggles_and_shows_the_mode(tmp_path):
    orch, calls = orchestrator(tmp_path)
    with TestClient(create_app(TOKEN, orch, reminders=False)).websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "hotkey", "name": "claude"})
        assert ws.receive_json() == {"type": "mode", "no_molestar": False, "claude": False}
        assert ws.receive_json()["estado"] == "fin"  # her ticker clears
        assert not orch.claude.enabled
        ws.send_json({"type": "hotkey", "name": "claude"})
        assert ws.receive_json() == {"type": "mode", "no_molestar": False, "claude": True}
    assert calls == []


def test_reminders_hush_in_dnd_and_wait_out_a_fullscreen_app(tmp_path, monkeypatch):
    settings.load()
    settings.save_calendar_url("https://calendar.google.com/calendar/ical/x/private-y/basic.ics")
    monkeypatch.setattr(calendar_ics, "fetch", lambda url: ICS)

    def run(orch, now):
        async def go():
            orch.clock = lambda: now
            task = asyncio.create_task(orch.reminders(drain, every_s=0.01))
            await asyncio.sleep(0.1)
            task.cancel()

        asyncio.run(go())

    hushed, calls = orchestrator(tmp_path)
    hushed.dnd = True
    run(hushed, datetime(2026, 10, 27, 16, 22))
    assert calls == [] and hushed.reminded  # marked: it won't pop up later

    gamer, calls = orchestrator(tmp_path)
    gamer.set_away(True)
    run(gamer, datetime(2026, 10, 27, 16, 22))
    assert calls == []
    gamer.set_away(False)
    run(gamer, datetime(2026, 10, 27, 16, 45))  # back after it started: still said, as started
    assert len(calls) == 1 and "empezó a las 16:30" in prompts(calls)[0]


def test_proactivity_settings_default_and_parse(isolated_config):
    s = settings.load()  # the example file
    assert (s.proactive, s.proactive_per_hour, s.idle_hours) == (True, 2, 2)
    assert s.quiet_now(datetime(2026, 1, 1, 23, 30)) and not s.quiet_now(NOON)
    isolated_config.write_text('[proactividad]\nactiva = false\nsilencio = ""\n', encoding="utf-8")
    s = settings.load()
    assert not s.proactive and s.quiet is None and s.proactive_per_hour == 2
