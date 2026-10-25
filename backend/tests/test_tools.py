import asyncio
import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app import calendar_ics, settings, tools
from app.orchestrator import MAX_ACTIONS, Orchestrator
from app.ws import create_app

TOKEN = "test-token"
ORIGIN = {"origin": "http://tauri.localhost"}


def say(texto: str, accion: dict | None = None) -> str:
    return json.dumps({"emocion": "neutral", "gesto": "ninguno", "accion": accion, "texto": texto})


def scripted(*replies: str):
    """A generate that answers with `replies` in order (the last one repeats) and records each call."""
    calls: list[list[dict]] = []

    async def generate(messages):
        calls.append(messages)
        yield replies[min(len(calls), len(replies)) - 1]

    return generate, calls


@pytest.fixture
def opened(monkeypatch):
    """os.startfile stand-in: records instead of opening anything."""
    log: list[str] = []
    monkeypatch.setattr(tools.os, "startfile", log.append, raising=False)
    return log


OPEN = {"nombre": "abrir_app", "args": {"nombre": "Calculadora"}}


def connect(orch: Orchestrator):
    return TestClient(create_app(TOKEN, orch, reminders=False)).websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN)


def until(ws, kind: str) -> list[dict]:
    msgs = []
    while not msgs or msgs[-1]["type"] != kind:
        msgs.append(ws.receive_json())
    return msgs


def until_idle(ws) -> list[dict]:
    msgs = []
    while msgs[-1:] != [{"type": "state", "value": "idle"}]:
        msgs.append(ws.receive_json())
    return msgs


def results(calls) -> list[str]:
    """Tool results the model saw, in order."""
    return [m["content"] for m in calls[-1] if m["content"].startswith("[resultado de")]


def test_effect_runs_only_after_a_yes_with_the_right_id(opened):
    generate, calls = scripted(say("Te abro la calculadora.", OPEN), say("Listo."))
    with connect(Orchestrator(generate)) as ws:
        ws.send_json({"type": "text_input", "text": "abre la calculadora"})
        ask = until(ws, "confirm_request")[-1]
        assert ask["texto"] == "Abrir Calculadora" and opened == []  # nothing before the click
        ws.send_json({"type": "confirm_response", "id": "made-up", "ok": True})  # wrong id: ignored
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})
        until_idle(ws)
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})  # repeated: ignored
    assert opened == ["calc.exe"]
    assert "Abrí Calculadora" in results(calls)[0]
    audit = [json.loads(l) for l in (settings.path().parent / "audit.jsonl").read_text(encoding="utf-8").splitlines()]
    assert audit[0]["confirmado"] is True and audit[1]["resultado"] == "Abrí Calculadora."


def test_a_no_runs_nothing(opened):
    generate, calls = scripted(say("¿La abro?", OPEN), say("Vale, no."))
    with connect(Orchestrator(generate)) as ws:
        ws.send_json({"type": "text_input", "text": "abre la calculadora"})
        ask = until(ws, "confirm_request")[-1]
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": False})
        until_idle(ws)
    assert opened == []
    assert "no lo autorizó" in results(calls)[0]


def test_unanswered_confirmation_times_out_as_no(opened):
    generate, calls = scripted(say("¿La abro?", OPEN), say("Otra vez será."))
    with connect(Orchestrator(generate, confirm_s=0.1)) as ws:
        ws.send_json({"type": "text_input", "text": "abre la calculadora"})
        ask = until(ws, "confirm_request")[-1]
        until_idle(ws)
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})  # too late
    assert opened == []


def test_disconnecting_with_a_pending_confirmation_runs_nothing(opened):
    orch = Orchestrator(scripted(say("¿La abro?", OPEN), say("..."))[0])
    with connect(orch) as ws:
        ws.send_json({"type": "text_input", "text": "abre la calculadora"})
        until(ws, "confirm_request")
    assert opened == [] and orch.pending == {}


def test_safe_tools_run_without_asking(tmp_path, isolated_config):
    docs = tmp_path / "docs"
    (docs / "sub").mkdir(parents=True)
    (docs / "sub" / "Factura marzo.pdf").write_text("x")
    settings.load()
    isolated_config.write_text(isolated_config.read_text(encoding="utf-8").replace(
        'buscar = ["~/Documents"]', f"buscar = [{json.dumps(str(docs))}]"), encoding="utf-8")
    search = {"nombre": "buscar_archivos", "args": {"texto": "factura"}}
    generate, calls = scripted(say("Busco.", search), say("Encontré una."))
    with connect(Orchestrator(generate)) as ws:
        ws.send_json({"type": "text_input", "text": "¿dónde está la factura?"})
        msgs = until_idle(ws)
    assert "confirm_request" not in {m["type"] for m in msgs}
    assert "Factura marzo.pdf" in results(calls)[0]


def test_bad_args_and_unlisted_apps_are_reported_not_run(opened):
    generate, calls = scripted(
        say("Abro.", {"nombre": "abrir_app", "args": {}}),
        say("Abro.", {"nombre": "abrir_app", "args": {"nombre": "regedit"}}),
        say("No pude."),
    )
    with connect(Orchestrator(generate)) as ws:
        ws.send_json({"type": "text_input", "text": "abre cosas"})
        ask = until(ws, "confirm_request")[-1]  # only the valid-looking one asks
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})
        until_idle(ws)
    first, second = results(calls)
    assert "Argumentos no válidos" in first and "no está en la lista" in second
    assert opened == []


def test_actions_per_turn_are_capped():
    loop = say("Otra vez.", {"nombre": "leer_portapapeles", "args": {}})
    generate, calls = scripted(loop)
    orch = Orchestrator(generate)
    with connect(orch) as ws:
        ws.send_json({"type": "text_input", "text": "lee el portapapeles sin parar"})
        until_idle(ws)
    assert len(calls) == MAX_ACTIONS + 1


def test_calendar_url_is_validated_and_saved_keeping_the_rest(isolated_config):
    settings.load()
    with pytest.raises(ValueError):
        settings.save_calendar_url("https://evil.example/cal.ics")
    url = "https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc123/basic.ics"
    settings.save_calendar_url(url)
    s = settings.load()
    assert s.calendar_url == url and s.remind_minutes == 10 and "calculadora" in s.apps
    assert "# Dirección secreta" in isolated_config.read_text(encoding="utf-8")  # comments kept


def test_calendar_tool_guides_setup_when_unconfigured():
    assert "Dirección secreta en formato iCal" in tools.calendar(tools.CalendarArgs(), settings.load())


ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:standup
DTSTART:20261026T090000
DTEND:20261026T091500
RRULE:FREQ=WEEKLY;BYDAY=MO,WE
SUMMARY:Standup
LOCATION:Meet
END:VEVENT
BEGIN:VEVENT
UID:dentista
DTSTART:20261027T163000
DTEND:20261027T170000
SUMMARY:Dentista
END:VEVENT
BEGIN:VEVENT
UID:feriado
DTSTART;VALUE=DATE:20261102
DTEND;VALUE=DATE:20261103
SUMMARY:Festivo
END:VEVENT
END:VCALENDAR
"""


def test_calendar_expands_recurring_and_all_day_events():
    evs = calendar_ics.events(ICS, datetime(2026, 10, 26), datetime(2026, 11, 3))
    assert [e.line() for e in evs] == [
        "26/10 09:00-09:15: Standup (Meet)",
        "27/10 16:30-17:00: Dentista",
        "28/10 09:00-09:15: Standup (Meet)",
        "02/11 todo el día: Festivo",
        "02/11 09:00-09:15: Standup (Meet)",
    ]


def test_reminders_fire_once_inside_the_lead_time_and_never_for_all_day():
    evs = calendar_ics.events(ICS, datetime(2026, 10, 27), datetime(2026, 11, 3))
    seen: set = set()
    assert calendar_ics.due(evs, datetime(2026, 10, 27, 16, 15), 10, seen) == []  # 15 min before: not yet
    (dentist,) = calendar_ics.due(evs, datetime(2026, 10, 27, 16, 21), 10, seen)
    assert dentist.title == "Dentista"
    assert calendar_ics.due(evs, datetime(2026, 10, 27, 16, 25), 10, seen) == []  # only once
    assert calendar_ics.due(evs, datetime(2026, 11, 1, 23, 55), 10, seen) == []  # all-day: no reminder


def test_calendar_fetch_only_talks_to_google_and_caches(monkeypatch):
    got = []

    class Resp:
        content = ICS

        def raise_for_status(self):
            pass

    monkeypatch.setattr(calendar_ics.httpx, "get", lambda url, **kw: got.append(url) or Resp())
    url = "https://calendar.google.com/calendar/ical/x/private-y/basic.ics"
    assert calendar_ics.fetch(url, now=1000) == ICS
    calendar_ics.fetch(url, now=1000 + 60)  # cached
    calendar_ics.fetch(url, now=1000 + calendar_ics.CACHE_S + 1)  # stale: fetched again
    assert got == [url, url]
    with pytest.raises(ValueError):
        calendar_ics.fetch("https://example.com/basic.ics")


def test_reminder_loop_has_capri_bring_up_the_event(monkeypatch):
    settings.load()
    settings.save_calendar_url("https://calendar.google.com/calendar/ical/x/private-y/basic.ics")
    monkeypatch.setattr(calendar_ics, "fetch", lambda url: ICS)
    generate, calls = scripted(say("¡Ojo, en 9 minutos tienes dentista!"))
    orch = Orchestrator(generate)
    sent = []

    async def send(msg):
        sent.append(msg)

    async def run():
        task = asyncio.create_task(orch.reminders(send, every_s=0.01, now=lambda: datetime(2026, 10, 27, 16, 21)))
        await asyncio.sleep(0.2)
        task.cancel()

    asyncio.run(run())
    assert len(calls) == 1  # once, though it checked many times
    assert "Dentista" in orch.history[0]["content"] and "aviso automático" in orch.history[0]["content"]
    assert sent[-1].value == "idle"
