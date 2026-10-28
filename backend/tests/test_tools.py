import asyncio
import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app import calendar_ics, power, settings, tools
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
    return [m["content"][m["content"].index("[resultado de"):] for m in calls[-1] if m["role"] == "user" and "[resultado de" in m["content"]]


def test_effect_runs_only_after_a_yes_with_the_right_id(opened):
    generate, calls = scripted(say("Te abro la calculadora.", OPEN), say("Listo."))
    with connect(Orchestrator(generate)) as ws:
        ws.send_json({"type": "text_input", "text": "abre la calculadora"})
        msgs = until(ws, "confirm_request")
        ask = msgs[-1]
        assert ask["texto"] == "Abrir Calculadora" and opened == []  # nothing before the click
        assert "action" not in {m["type"] for m in msgs}  # no lightning before it runs
        ws.send_json({"type": "confirm_response", "id": "made-up", "ok": True})  # wrong id: ignored
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})
        acts = [m for m in until_idle(ws) if m["type"] == "action"]
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})  # repeated: ignored
    assert [(a["nombre"], a["fase"], a["ok"]) for a in acts] == [("abrir_app", "inicio", None), ("abrir_app", "fin", True)]
    assert acts[1]["ms"] >= 0
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


def test_safe_tools_run_without_asking(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / "docs" / "sub").mkdir(parents=True)
    (home / "docs" / "sub" / "Factura marzo.pdf").write_text("x")
    monkeypatch.setattr(power, "HOME", home.resolve())
    search = {"nombre": "buscar_archivos", "args": {"texto": "factura"}}
    generate, calls = scripted(say("Busco.", search), say("Encontré una."))
    with connect(Orchestrator(generate)) as ws:
        ws.send_json({"type": "text_input", "text": "¿dónde está la factura?"})
        msgs = until_idle(ws)
    assert "confirm_request" not in {m["type"] for m in msgs}
    assert "Factura marzo.pdf" in results(calls)[0]


def test_common_app_names_open(opened):
    # "edge" and "Discord" failed: os.startfile only knows App Paths names
    tools.open_app(tools.AppArgs(nombre="Edge"), settings.Settings())
    assert opened == ["msedge"]


def test_an_app_known_only_by_its_start_menu_shortcut_opens(monkeypatch, tmp_path):
    (tmp_path / "Discord Inc").mkdir()
    (tmp_path / "Discord Inc" / "Discord.lnk").write_text("")
    log: list[str] = []

    def startfile(target):
        if not target.endswith(".lnk"):
            raise FileNotFoundError(2, "El sistema no puede encontrar el archivo especificado")
        log.append(target)

    monkeypatch.setattr(tools.os, "startfile", startfile, raising=False)
    monkeypatch.setattr(tools, "START_MENUS", [tmp_path])
    assert tools.open_app(tools.AppArgs(nombre="discord"), settings.Settings()) == "Abrí discord."
    assert log == [str(tmp_path / "Discord Inc" / "Discord.lnk")]
    with pytest.raises(tools.ToolError, match="no encontré"):
        tools.open_app(tools.AppArgs(nombre="nada parecido"), settings.Settings())


def test_a_start_menu_fallback_never_picks_an_uninstaller_or_installer(monkeypatch, tmp_path):
    # "abre bittorrent" opened "Desinstalar qBittorrent" under a plain "Abrir bittorrent" click
    for name in ["Desinstalar qBittorrent", "qBittorrent", "Install Additional Tools for Node.js", "Node.js command prompt"]:
        (tmp_path / f"{name}.lnk").write_text("")
    monkeypatch.setattr(tools, "START_MENUS", [tmp_path])
    assert tools.shortcut("bittorrent") == tmp_path / "qBittorrent.lnk"
    assert tools.shortcut("node") == tmp_path / "Node.js command prompt.lnk"
    (tmp_path / "qBittorrent.lnk").unlink()
    assert tools.shortcut("bittorrent") is None


def test_bad_args_are_reported_and_any_app_asks_for_a_click(opened):
    generate, calls = scripted(
        say("Abro.", {"nombre": "abrir_app", "args": {}}),
        say("Abro.", {"nombre": "abrir_app", "args": {"nombre": "regedit"}}),
        say("Listo."),
    )
    with connect(Orchestrator(generate)) as ws:
        ws.send_json({"type": "text_input", "text": "abre cosas"})
        ask = until(ws, "confirm_request")[-1]  # only the valid one asks; an app that isn't listed still can
        assert ask["texto"] == "Abrir regedit" and ask["riesgo"] == "normal"
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})
        until_idle(ws)
    first, second = results(calls)
    assert "Argumentos no válidos" in first and "Abrí regedit" in second
    assert opened == ["regedit"]


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
    orch = Orchestrator(generate, clock=lambda: datetime(2026, 10, 27, 16, 21))
    sent = []

    async def send(msg):
        sent.append(msg)

    async def run():
        task = asyncio.create_task(orch.reminders(send, every_s=0.01))
        await asyncio.sleep(0.2)
        task.cancel()

    asyncio.run(run())
    assert len(calls) == 1  # once, though it checked many times
    assert "Dentista" in orch.history[0]["content"] and "aviso automático" in orch.history[0]["content"]
    assert sent[-1].value == "idle"


def test_calendar_tool_labels_every_day_and_says_when_one_is_empty(monkeypatch):
    class Fixed(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 25, 9, 0)

    monkeypatch.setattr(tools, "datetime", Fixed)
    monkeypatch.setattr(calendar_ics, "fetch", lambda url: ICS)
    s = settings.load()
    s.calendar_url = "https://calendar.google.com/calendar/ical/x/private-y/basic.ics"
    assert tools.calendar(tools.CalendarArgs(), s) == (
        "Hoy (25/10): sin eventos\n"
        "Mañana (26/10): 09:00-09:15: Standup (Meet)"
    )
    week = tools.calendar(tools.CalendarArgs(dias=4), s).splitlines()
    assert week[2] == "Martes (27/10): 16:30-17:00: Dentista" and week[3].startswith("Miércoles (28/10): 09:00")
