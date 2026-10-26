import asyncio

import pytest
from fastapi.testclient import TestClient

from app import claude_link
from app.claude_link import ClaudeLink
from app.orchestrator import Orchestrator
from app.ws import create_app
from test_tools import TOKEN, ORIGIN, connect, scripted, until, until_idle

HDR = {"x-capri-token": TOKEN}


def hook(name: str, **kw) -> dict:
    return {"session_id": "s1", "cwd": "C:\\Users\\a\\proyectos\\capri", "hook_event_name": name, **kw}


def test_a_work_session_becomes_a_story():
    link = ClaudeLink()
    assert link.ingest(hook("SessionStart")).estado == "inicio"
    e = link.ingest(hook("UserPromptSubmit", prompt="arregla   el\nbug del login " + "x" * 200))
    assert (e.estado, e.project) == ("trabajando", "capri") and len(e.detalle) <= 75 and "\n" not in e.detalle
    assert link.ingest(hook("PreToolUse", tool_name="Read", tool_input={"file_path": "C:\\a\\b\\login.py"})).detalle == "Leyendo login.py"
    assert link.ingest(hook("PreToolUse", tool_name="Edit", tool_input={"file_path": "C:/a/b/login.py"})).detalle == "Editando login.py"
    link.ingest(hook("PreToolUse", tool_name="Write", tool_input={"file_path": "C:/a/b/nuevo.py"}))
    link.ingest(hook("PreToolUse", tool_name="Edit", tool_input={"file_path": "C:/a/b/login.py"}))  # same file again
    done = link.ingest(hook("Stop", last_assistant_message="Listo, arreglé el login."))
    assert (done.estado, done.acciones, done.archivos) == ("termino", 4, 2) and done.resumen == "Listo, arreglé el login."
    assert link.ingest(hook("SessionEnd")).estado == "fin" and link.latest() is None


def test_failures_and_requests_for_attention():
    link = ClaudeLink()
    fail = link.ingest(hook("PostToolUseFailure", tool_name="Bash", error="Exit code 1\nnpm ERR! missing script: test\n"))
    assert (fail.estado, fail.detalle) == ("fallo", "npm ERR! missing script: test")
    assert link.ingest(hook("PostToolUseFailure", tool_name="Edit", error="string not found")) is None  # routine
    assert link.ingest(hook("PostToolUseFailure", tool_name="Bash", error="x", is_interrupt=True)) is None
    needs = link.ingest(hook("Notification", notification_type="permission_prompt", message="Claude needs your permission to use Bash"))
    assert needs.estado == "necesita" and "permission" in needs.detalle
    assert link.ingest(hook("Notification", notification_type="idle_prompt", message="waiting")) is None  # noise after "termino"


def test_subagents_and_a_muted_link_are_ignored():
    link = ClaudeLink()
    assert link.ingest(hook("PreToolUse", tool_name="Read", agent_id="a1")) is None
    link.toggle(False)
    assert link.ingest(hook("UserPromptSubmit", prompt="hola")) is None


def test_hook_endpoint_needs_the_token_and_no_origin_and_reaches_the_avatar():
    orch = Orchestrator(scripted("x")[0])
    client = TestClient(create_app(TOKEN, orch, reminders=False))
    body = hook("UserPromptSubmit", prompt="hola")
    assert client.post("/claude/event", json=body).status_code == 403
    assert client.post("/claude/event", json=body, headers={"x-capri-token": "wrong"}).status_code == 403
    assert client.post("/claude/event", json=body, headers={**HDR, "origin": "https://evil.example"}).status_code == 403
    assert client.post("/claude/event", content=b"no es json", headers=HDR).status_code == 400
    assert client.post("/claude/event", json=[1], headers=HDR).status_code == 204
    with client.websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        assert client.post("/claude/event", json=body, headers=HDR).status_code == 204
        msg = until(ws, "claude")[-1]
        assert (msg["estado"], msg["project"], msg["detalle"]) == ("trabajando", "capri", "«hola»")


def test_claude_command_without_a_session_explains_and_asks_nothing():
    with connect(Orchestrator(scripted("x")[0])) as ws:
        ws.send_json({"type": "text_input", "text": "/claude qué estás haciendo"})
        assert "No veo ninguna sesión" in "".join(m.get("text", "") for m in until_idle(ws))


def test_claude_command_asks_a_click_with_the_exact_question_then_shows_the_answer(monkeypatch):
    asked = []

    async def fake(session, question):
        asked.append((session.id, question))
        return "Va por el paso 3."

    monkeypatch.setattr(claude_link, "ask", fake)
    orch = Orchestrator(scripted("x")[0])
    orch.claude.ingest(hook("UserPromptSubmit", prompt="hola"))
    with connect(orch) as ws:
        ws.send_json({"type": "text_input", "text": "/claude ¿en qué paso vas?"})
        ask = until(ws, "confirm_request")[-1]
        assert "solo lectura" in ask["texto"] and "¿en qué paso vas?" in ask["texto"] and asked == []
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})
        answer = until(ws, "claude")
        while answer[-1]["estado"] != "respuesta":
            answer += until(ws, "claude")
    assert asked == [("s1", "¿en qué paso vas?")] and answer[-1]["resumen"] == "Va por el paso 3."


def test_claude_command_with_a_no_asks_nothing(monkeypatch):
    async def boom(session, question):
        raise AssertionError("must not run")

    monkeypatch.setattr(claude_link, "ask", boom)
    orch = Orchestrator(scripted("x")[0])
    orch.claude.ingest(hook("UserPromptSubmit", prompt="hola"))
    with connect(orch) as ws:
        ws.send_json({"type": "text_input", "text": "/claude hola"})
        ws.send_json({"type": "confirm_response", "id": until(ws, "confirm_request")[-1]["id"], "ok": False})
        assert "no le pregunto" in "".join(m.get("text", "") for m in until_idle(ws))


def test_the_question_runs_read_only_forked_and_without_echoing_hooks(monkeypatch):
    seen = {}

    class Proc:
        returncode = 0

        async def communicate(self, data):
            seen["stdin"] = data
            return "respuesta ñ".encode(), b""

    async def fake_exec(*args, **kw):
        seen.update(args=args, env=kw["env"], cwd=kw["cwd"])
        return Proc()

    monkeypatch.setattr(claude_link.shutil, "which", lambda name: "claude.exe")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    link = ClaudeLink()
    link.ingest(hook("UserPromptSubmit", prompt="hola"))
    assert asyncio.run(claude_link.ask(link.latest(), "pregunta ñ")) == "respuesta ñ"
    args = seen["args"]
    assert args[args.index("--tools") + 1] == "Read,Glob,Grep" and "--fork-session" in args and "dontAsk" in args
    assert args[args.index("--resume") + 1] == "s1" and seen["stdin"] == "pregunta ñ".encode()
    assert seen["env"][claude_link.RUN_ENV] == "1" and seen["cwd"] == "C:\\Users\\a\\proyectos\\capri"


def test_claude_off_silences_the_events():
    orch = Orchestrator(scripted("x")[0])
    with connect(orch) as ws:
        ws.send_json({"type": "text_input", "text": "/claude off"})
        until_idle(ws)
        assert orch.claude.ingest(hook("UserPromptSubmit", prompt="hola")) is None
