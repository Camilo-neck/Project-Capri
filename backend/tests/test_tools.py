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
        ws.send_json({"type": "text_input", "text": "tengo que hacer unas cuentas"})  # her idea: a click
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
        ws.send_json({"type": "text_input", "text": "tengo que hacer unas cuentas"})  # her idea: a click
        ask = until(ws, "confirm_request")[-1]
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": False})
        until_idle(ws)
    assert opened == []
    assert "no lo autorizó" in results(calls)[0]


def test_unanswered_confirmation_times_out_as_no(opened):
    generate, calls = scripted(say("¿La abro?", OPEN), say("Otra vez será."))
    with connect(Orchestrator(generate, confirm_s=0.1)) as ws:
        ws.send_json({"type": "text_input", "text": "tengo que hacer unas cuentas"})  # her idea: a click
        ask = until(ws, "confirm_request")[-1]
        until_idle(ws)
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})  # too late
    assert opened == []


def test_disconnecting_with_a_pending_confirmation_runs_nothing(opened):
    orch = Orchestrator(scripted(say("¿La abro?", OPEN), say("..."))[0])
    with connect(orch) as ws:
        ws.send_json({"type": "text_input", "text": "tengo que hacer unas cuentas"})  # her idea: a click
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


SEARCH = {"nombre": "buscar_web", "args": {"consulta": "clima en Bogotá"}}


def browser_search(monkeypatch, opened: list, ok: bool | None, text: str = "¿qué me pongo para salir?"):
    """A web search through his browser: what opened, what was captured, and the turn's messages.
    `ok` is his click; None when no button is expected (he asked for that search himself)."""
    from app import vision

    monkeypatch.setattr(vision, "foreground", lambda: (0, 0, 800, 600))
    shots: list[tuple] = []

    async def read(image: bytes, query: str) -> str:
        return f"Clima en Bogotá: 18 °C, nublado (leído de {image!r} para «{query}»)"

    generate, calls = scripted(say("Busco.", SEARCH), say("18 grados y nublado."))
    orch = Orchestrator(generate, capture=lambda rect: shots.append(rect) or b"jpg", read=read, load_s=0)
    with connect(orch) as ws:
        ws.send_json({"type": "text_input", "text": text})
        if ok is None:
            return None, [], shots, until_idle(ws), calls
        ask = until(ws, "confirm_request")[-1]
        before = list(shots) + list(opened)
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": ok})
        msgs = until_idle(ws)
    return ask, before, shots, msgs, calls


def test_a_search_he_asked_for_needs_no_click(opened, monkeypatch):
    _, _, shots, msgs, calls = browser_search(monkeypatch, opened, None, text="busca el clima en Bogotá")
    assert "confirm_request" not in {m["type"] for m in msgs}
    assert shots == [(0, 0, 800, 600)] and {"type": "state", "value": "looking"} in msgs and "18 °C" in results(calls)[0]


def named_turn(text: str, accion: dict, charla: bool = False) -> list[dict]:
    """One turn where she runs `accion` for `text`: the messages, stopping at a button or at the end.
    `charla`: it came by voice without her name (the conversation window)."""
    generate, _ = scripted(say("Va.", accion), say("Listo."))
    with connect(Orchestrator(generate, capture=lambda rect: b"jpg", read=lambda *a: "x", load_s=0)) as ws:
        ws.send_json({"type": "text_input", "text": text, "charla": charla})
        msgs = []
        while not msgs or msgs[-1]["type"] != "confirm_request" and msgs[-1] != {"type": "state", "value": "idle"}:
            msgs.append(ws.receive_json())
        if msgs[-1]["type"] == "confirm_request":
            ws.send_json({"type": "confirm_response", "id": msgs[-1]["id"], "ok": False})
            until_idle(ws)
    return msgs


@pytest.mark.parametrize("text, accion", [
    ("abre Discord", {"nombre": "abrir_app", "args": {"nombre": "Discord"}}),
    ("abre kick.com/westcol", {"nombre": "abrir_web", "args": {"url": "https://kick.com/westcol"}}),
    ("ponme Netflix", {"nombre": "abrir_web", "args": {"url": "https://www.netflix.com"}}),
    ("cópiame eso", {"nombre": "copiar_al_portapapeles", "args": {"texto": "hola"}}),
])
def test_what_he_named_runs_without_a_button(opened, monkeypatch, text, accion):
    # a click to open a website took away the feeling that she's helping
    monkeypatch.setattr(tools.pyperclip, "copy", lambda text: None)
    msgs = named_turn(text, accion)
    assert "confirm_request" not in {m["type"] for m in msgs}


def test_her_own_turns_never_count_as_him_asking(opened):
    generate, _ = scripted(say("Te lo abro.", {"nombre": "abrir_app", "args": {"nombre": "Discord"}}), say("Vale."))
    sent = []

    async def send(msg):
        sent.append(msg.model_dump())

    orch = Orchestrator(generate, confirm_s=0.01)
    asyncio.run(orch.own_turn("[aviso automático, no lo escribió el usuario] Discord tiene mensajes: ábrele Discord.", send))
    assert any(m["type"] == "confirm_request" for m in sent) and opened == []


@pytest.mark.parametrize("text, accion", [
    ("estoy aburrido", {"nombre": "abrir_app", "args": {"nombre": "Discord"}}),  # her idea
    ("abre kick.com/westcol", {"nombre": "abrir_web", "args": {"url": "https://evil.example/x"}}),  # not what he said
    ("abre regedit", {"nombre": "abrir_app", "args": {"nombre": "regedit"}}),  # the registry: always
    ("ejecuta esto: Remove-Item notas.txt", {"nombre": "ejecutar_comando", "args": {"comando": "Remove-Item notas.txt"}}),
])
def test_her_ideas_and_anything_irreparable_still_ask(opened, text, accion):
    msgs = named_turn(text, accion)
    assert msgs[-1]["type"] == "confirm_request" and opened == []


def test_a_web_search_opens_in_his_browser_and_is_read_after_a_click(opened, monkeypatch):
    # DuckDuckGo blocked every search from her; his own browser isn't a bot
    ask, before, shots, msgs, calls = browser_search(monkeypatch, opened, ok=True)
    assert "navegador" in ask["texto"] and "clima en Bogotá" in ask["texto"]
    assert before == []  # nothing opened or captured before the click
    assert opened == ["https://www.google.com/search?q=clima%20en%20Bogot%C3%A1"]
    assert shots == [(0, 0, 800, 600)]  # only the browser window in front
    assert {"type": "state", "value": "looking"} in msgs  # the capture indicator
    assert "18 °C" in results(calls)[0]


def test_a_web_search_said_no_opens_and_captures_nothing(opened, monkeypatch):
    _, _, shots, _, calls = browser_search(monkeypatch, opened, ok=False)
    assert opened == [] and shots == [] and "no lo autorizó" in results(calls)[0]


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
        say("Abro.", {"nombre": "abrir_app", "args": {"nombre": "mspaint"}}),
        say("Listo."),
    )
    with connect(Orchestrator(generate)) as ws:
        ws.send_json({"type": "text_input", "text": "abre cosas"})
        ask = until(ws, "confirm_request")[-1]  # only the valid one asks; an app that isn't listed still can
        assert ask["texto"] == "Abrir mspaint" and ask["riesgo"] == "normal"
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})
        until_idle(ws)
    first, second = results(calls)
    assert "Argumentos no válidos" in first and "Abrí mspaint" in second
    assert opened == ["mspaint"]


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


def test_files_she_finds_come_with_open_and_folder_buttons(monkeypatch, tmp_path):
    monkeypatch.setattr(power, "HOME", tmp_path.resolve())
    f = tmp_path.resolve() / "CV 2026.pdf"
    f.write_text("x")
    monkeypatch.setattr(tools, "indexed", lambda terms, exts: [str(f)])
    opened, ran = [], []
    monkeypatch.setattr(tools.os, "startfile", opened.append, raising=False)
    monkeypatch.setattr(tools.subprocess, "Popen", lambda args, **kw: ran.append(args))
    generate, _ = scripted(say("Busco.", {"nombre": "buscar_archivos", "args": {"texto": "cv"}}), say("Aquí está."))
    with connect(Orchestrator(generate)) as ws:
        ws.send_json({"type": "text_input", "text": "busca mi cv"})
        buttons = until(ws, "buttons")[-1]
        assert [b["texto"] for b in buttons["botones"]] == ["Abrir «CV 2026.pdf»", "Carpeta de «CV 2026.pdf»"]
        ws.send_json({"type": "pressed", "id": buttons["id"], "boton": buttons["botones"][1]["id"]})
        until_idle(ws)
    assert ran == [["explorer.exe", f"/select,{f}"]] and opened == []



@pytest.mark.parametrize("text, accion", [
    ("toma una captura", {"nombre": "captura", "args": {}}),
    ("busca el clima en Bogotá", SEARCH),
])
def test_voice_chat_without_her_name_never_captures_without_a_click(opened, monkeypatch, text, accion):
    # what the mic hears in the conversation window may be the room, not him: screens stay behind a click
    from app import vision

    monkeypatch.setattr(vision, "foreground", lambda: (0, 0, 800, 600))
    msgs = named_turn(text, accion, charla=True)
    assert msgs[-1]["type"] == "confirm_request"


def test_voice_chat_without_her_name_still_opens_what_he_names(opened):
    msgs = named_turn("abre Discord", {"nombre": "abrir_app", "args": {"nombre": "Discord"}}, charla=True)
    assert "confirm_request" not in {m["type"] for m in msgs}
