import json
import re
import time
from pathlib import Path
from typing import get_args

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import protocol
from app.demo import DEMO, demo_generate_factory
from app.orchestrator import Orchestrator
from app.schema import Emocion, Gesto
from app.ws import create_app

TOKEN = "test-token"
ORIGIN = {"origin": "http://tauri.localhost"}
TS = (Path(__file__).parents[2] / "avatar" / "src" / "net" / "protocol.ts").read_text(encoding="utf-8")


@pytest.fixture
def client():
    return TestClient(create_app(TOKEN, Orchestrator(demo_generate_factory(chunk_delay=0))))


def receive_turn(ws) -> list[dict]:
    msgs = []
    while not msgs or msgs[-1] != {"type": "state", "value": "idle"}:
        msgs.append(ws.receive_json())
    return msgs


def test_demo_turns_arrive_in_order(client):
    with client.websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        for expected in DEMO:
            ws.send_json({"type": "text_input", "text": "hola"})
            msgs = receive_turn(ws)
            assert msgs[:3] == [
                {"type": "state", "value": "thinking"},
                {"type": "state", "value": "speaking"},
                {"type": "utterance_start", "emocion": expected.emocion, "gesto": expected.gesto},
            ]
            assert {m["type"] for m in msgs[3:-2]} == {"text_delta"}
            assert "".join(m["text"] for m in msgs[3:-2]) == expected.texto
            assert msgs[-2:] == [{"type": "utterance_end", "ctx": None, "cortada": False}, {"type": "state", "value": "idle"}]
    assert {r.emocion for r in DEMO} == set(get_args(Emocion))
    assert {r.gesto for r in DEMO} == set(get_args(Gesto))


@pytest.mark.parametrize("query,headers", [
    ("", ORIGIN),
    ("?token=wrong", ORIGIN),
    (f"?token={TOKEN}", {"origin": "https://evil.example"}),
    (f"?token={TOKEN}", {}),
])
def test_rejects_bad_token_or_origin(client, query, headers):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws{query}", headers=headers) as ws:
            ws.receive_text()


def test_invalid_message_keeps_connection(client):
    with client.websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_text("not json")
        ws.send_json({"type": "text_input"})
        ws.send_json({"type": "nope"})
        ws.send_json({"type": "confirm_response", "id": "x", "ok": True})
        ws.send_json({"type": "text_input", "text": "hola"})
        assert receive_turn(ws)[0] == {"type": "state", "value": "thinking"}


def test_fallback_without_text_still_sends_utterance(client):
    async def broken(messages):
        yield "not json"

    app = create_app(TOKEN, Orchestrator(broken))
    with TestClient(app).websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "text_input", "text": "hola"})
        msgs = receive_turn(ws)
    types = [m["type"] for m in msgs]
    assert types == ["state", "state", "utterance_start", "text_delta", "utterance_end", "state"]
    assert msgs[2]["emocion"] == "neutral"


def test_utterance_end_reports_context_tokens():
    async def with_usage(messages):
        yield DEMO[0].model_dump_json()
        yield 1234

    app = create_app(TOKEN, Orchestrator(with_usage))
    with TestClient(app).websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "text_input", "text": "hola"})
        assert receive_turn(ws)[-2] == {"type": "utterance_end", "ctx": 1234, "cortada": False}


def test_a_turn_that_breaks_ends_and_she_can_go_on(tmp_path):
    from app.memory import Memory

    said = iter([None, DEMO[0].model_dump_json()])

    async def flaky(messages):
        text = next(said)
        if text is None:
            raise RuntimeError("boom")
        yield text

    app = create_app(TOKEN, Orchestrator(flaky, memory=Memory(tmp_path / "m.db")), reminders=False)
    with TestClient(app).websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "text_input", "text": "hola"})
        assert receive_turn(ws)[-1] == {"type": "state", "value": "idle"}  # not left "thinking"
        ws.send_json({"type": "text_input", "text": "¿sigues?"})
        assert any(m["type"] == "text_delta" for m in receive_turn(ws))


def ts_union(name: str) -> set[str]:
    body = re.search(rf"export type {name} =([^;]+);", TS).group(1)
    return set(re.findall(r'"(\w+)"', body))


def ts_interfaces() -> dict[str, dict[str, str]]:
    return {
        name: dict(re.findall(r"(\w+): ([^;]+);", body))
        for name, body in re.findall(r"export interface (\w+) \{([^}]*)\}", TS)
    }


def test_ts_protocol_matches_pydantic():
    assert ts_union("Emocion") == set(get_args(Emocion))
    assert ts_union("Gesto") == set(get_args(Gesto))
    models = get_args(protocol.ServerMessage) + get_args(get_args(protocol.ClientMessage)[0])
    interfaces = ts_interfaces()
    assert set(interfaces) == {m.__name__ for m in models}
    for model in models:
        fields = interfaces[model.__name__]
        assert set(fields) == set(model.model_fields), model.__name__
        assert fields["type"] == json.dumps(model.model_fields["type"].default)


def test_settings_panel_picks_her_brain(client, monkeypatch, tmp_path):
    from app.llm import providers

    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    unloaded = []

    async def options():
        return {"ollama": ["gemma3:12b", "qwen3-vl:8b-instruct"], "anthropic": ["claude-opus-5-5"], "openai": []}

    async def unload(**kw):
        unloaded.append(kw["model"])

    monkeypatch.setattr(providers, "options", options)
    monkeypatch.setattr(providers.ollama, "generate", unload)
    monkeypatch.setattr(providers, "key", lambda p: "")
    with client.websocket_connect(f"/ws?token={TOKEN}&panel=1", headers=ORIGIN) as ws:
        ws.send_json({"type": "model_get"})
        info = ws.receive_json()
        assert info["type"] == "model_info" and info["proveedor"] == "ollama" and info["claves"] == dict.fromkeys(providers.ENV, False) and info["nombres"]["gemini"] == "Gemini"
        ws.send_json({"type": "model_set", "proveedor": "ollama", "nombre": "gemma3:12b"})
        info = ws.receive_json()
        assert info["nombre"] == "gemma3:12b" and unloaded == ["qwen3-vl:8b-instruct"]  # the old one leaves the GPU
        ws.send_json({"type": "model_set", "proveedor": "nube", "nombre": "x"})
        assert ws.receive_json()["error"]


class FakeVoice:
    state, autostart, on = "off", False, True

    def __init__(self):
        self.conversed = 0

    def attach(self, loop, sink):
        pass

    def converse(self):
        self.conversed += 1

    def listen_now(self):
        self.listened = getattr(self, "listened", 0) + 1

    def toggle(self):
        self.on = not self.on


def test_the_end_of_a_turn_opens_the_conversation_window():
    voice = FakeVoice()
    client = TestClient(create_app(TOKEN, Orchestrator(demo_generate_factory(chunk_delay=0)), reminders=False, voice=voice))
    with client.websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "text_input", "text": "hola"})
        receive_turn(ws)
    assert voice.conversed == 1


class FakeSpeaker:
    def __init__(self):
        self.seen, self.said, self.stops, self.afters, self.releases, self.warms = [], [], 0, [], 0, 0
        self.enabled, self.playing, self.lang = True, False, "es"
        self.speed, self.robot, self.glitch = 1.0, 0.0, 0.0
        self.emit, self.on_first_audio = None, None
        self.voice, self.used = "capri", []

    def use(self, synth, voice):
        self.used.append(voice)
        self.voice = voice

    def see(self, msg):
        self.seen.append(msg.type)

    def say(self, text, force=False):
        self.said.append((text, force))

    def stop(self):
        self.stops += 1

    def after(self, cb):
        self.afters.append(cb)

    def warm(self):
        self.warms += 1

    def release(self):
        self.releases += 1


def talking_app(voice_on=True):
    voice, speaker = FakeVoice(), FakeSpeaker()
    voice.on = voice_on
    app = create_app(TOKEN, Orchestrator(demo_generate_factory(chunk_delay=0)), reminders=False, voice=voice, speaker=speaker)
    return TestClient(app), voice, speaker


def test_with_the_voice_on_her_turn_goes_to_her_voice_too():
    client, voice, speaker = talking_app()
    with client.websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "text_input", "text": "hola"})
        receive_turn(ws)
    assert {"utterance_start", "text_delta", "utterance_end"} <= set(speaker.seen)
    assert speaker.afters == [voice.converse]  # the conversation window opens once she's done talking
    assert voice.conversed == 0


def test_with_the_voice_off_she_only_writes():
    client, voice, speaker = talking_app(voice_on=False)
    with client.websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "text_input", "text": "hola"})
        receive_turn(ws)
    assert speaker.seen == []


def test_the_settings_panel_never_speaks():
    client, voice, speaker = talking_app()
    with client.websocket_connect(f"/ws?token={TOKEN}&panel=1", headers=ORIGIN) as ws:
        ws.send_json({"type": "text_input", "text": "hola"})
        receive_turn(ws)
    assert speaker.seen == []


def test_a_new_message_of_his_stops_her_and_leaving_too():
    client, voice, speaker = talking_app()
    with client.websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "text_input", "text": "hola"})
        receive_turn(ws)
        assert speaker.stops == 1
    assert speaker.stops == 2  # the avatar went away


def test_her_own_lines_out_loud():
    client, voice, speaker = talking_app()
    with client.websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "say", "texto": "¡Suerte!"})
        ws.send_json({"type": "hotkey", "name": "nada"})  # a round trip, so the say has been handled
        ws.send_json({"type": "model_get"})
        while ws.receive_json()["type"] != "model_info":
            pass
    assert speaker.said == [("¡Suerte!", False)]


def test_talking_out_loud_toggles_and_is_kept(monkeypatch, tmp_path):
    from app import settings

    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    client, voice, speaker = talking_app()
    with client.websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "hotkey", "name": "hablar"})
        while (m := ws.receive_json())["type"] != "mode":
            pass
        assert m["hablar"] is False
    assert not speaker.enabled and speaker.releases == 1  # her voice model leaves the GPU
    assert settings.load().speak is False


def test_turning_talking_back_on_gets_her_voice_ready(monkeypatch, tmp_path):
    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    client, voice, speaker = talking_app()
    speaker.enabled = False
    with client.websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        warms = speaker.warms
        ws.send_json({"type": "hotkey", "name": "hablar"})
        while (m := ws.receive_json())["type"] != "mode":
            pass
        assert m["hablar"] is True
        for _ in range(50):
            if speaker.warms > warms:
                break
            time.sleep(0.02)
    assert speaker.warms == warms + 1


def test_turning_the_voice_off_frees_her_voice_model():
    client, voice, speaker = talking_app()
    with client.websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "hotkey", "name": "voz"})
        ws.send_json({"type": "voice_get"})
        while ws.receive_json()["type"] != "voice_info":
            pass
    assert not voice.on and speaker.releases == 1


def test_the_panel_tunes_her_voice(monkeypatch, tmp_path):
    from app import settings

    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    client, voice, speaker = talking_app()
    with client.websocket_connect(f"/ws?token={TOKEN}&panel=1", headers=ORIGIN) as ws:
        ws.send_json({"type": "voice_get"})
        got = ws.receive_json()
        assert (got["type"], got["velocidad"], got["robot"], got["glitch"], got["voz"]) == ("voice_info", 1.0, 0.0, 0.0, "capri")
        ws.send_json({"type": "voice_set", "velocidad": 1.2, "robot": 0.4, "glitch": 2, "probar": True})
        got = ws.receive_json()
        assert (got["velocidad"], got["robot"], got["glitch"]) == (1.2, 0.4, 1.0)
    assert (speaker.speed, speaker.robot, speaker.glitch) == (1.2, 0.4, 1.0)
    assert speaker.said and speaker.said[0][1] is True  # "Probar" plays even with the voice off
    s = settings.load()
    assert (s.tts_speed, s.tts_robot, s.tts_glitch) == (1.2, 0.4, 1.0)


def test_the_panel_sets_up_a_voice_service_and_hears_what_went_wrong(monkeypatch, tmp_path):
    from app import cloudvoice

    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    monkeypatch.delenv("FISH_API_KEY", raising=False)
    saved = {}
    monkeypatch.setattr(cloudvoice.keyring, "get_password", lambda _, name: saved.get(name))
    monkeypatch.setattr(cloudvoice.keyring, "set_password", lambda _, name, value: saved.__setitem__(name, value))

    def refuse(service):
        raise cloudvoice.CloudVoiceError("Fish Audio rechazó la clave.")

    monkeypatch.setattr(cloudvoice, "probe", refuse)
    client, voice, speaker = talking_app()
    with client.websocket_connect(f"/ws?token={TOKEN}&panel=1", headers=ORIGIN) as ws:
        ws.send_json({"type": "voice_cloud_save", "servicio": "fish", "clave": "clave-secreta", "voz": "v", "modelo": ""})
        got = ws.receive_json()
        assert got["type"] == "voice_info" and "clave-secreta" not in str(got)
        assert next(c for c in got["nube"] if c["id"] == "fish")["clave"] is True
        assert ws.receive_json() == {"type": "voice_progress", "voz": "fish", "completado": 0, "total": 0, "error": "Fish Audio rechazó la clave."}
    assert saved == {"fish": "clave-secreta"}


def test_he_can_cut_her_off_with_a_click_or_the_listen_hotkey():
    client, voice, speaker = talking_app()
    with client.websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "interrupt"})
        ws.send_json({"type": "model_get"})
        while ws.receive_json()["type"] != "model_info":
            pass
        assert speaker.stops == 1  # the click: her voice stops (and the turn, if one is running)
        speaker.playing = True
        voice.listened = 0
        ws.send_json({"type": "hotkey", "name": "escuchar"})
        ws.send_json({"type": "model_get"})
        while ws.receive_json()["type"] != "model_info":
            pass
        assert speaker.stops == 2 and voice.listened == 1


def test_the_panel_lists_her_routines(client, monkeypatch, tmp_path):
    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    (tmp_path / "config.toml").write_text('[rutinas.estudio]\nfrases = ["modo estudio"]\napps = ["notion"]\n', encoding="utf-8")
    with client.websocket_connect(f"/ws?token={TOKEN}&panel=1", headers=ORIGIN) as ws:
        ws.send_json({"type": "routines_get"})
        got = ws.receive_json()
    assert got["type"] == "routines"
    by_name = {r["nombre"]: r for r in got["rutinas"]}
    assert by_name["chamba"]["frases"][0] == "modo chamba" and "vscode" in by_name["chamba"]["apps"]
    assert by_name["estudio"] == {"nombre": "estudio", "frases": ["modo estudio"], "apps": ["notion"], "musica": ""}


def test_the_panel_picks_and_downloads_her_voice(monkeypatch, tmp_path):
    from app import settings, voices

    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    tts = tmp_path / "Capri" / "modelos" / "tts"
    tts.mkdir(parents=True)
    for f in ("es_AR-daniela-high.onnx", "es_AR-daniela-high.onnx.json", "en_US-amy-medium.onnx", "en_US-amy-medium.onnx.json"):
        (tts / f).write_bytes(b"x")
    monkeypatch.setattr(voices, "gpu", lambda: None)
    monkeypatch.setattr(voices, "make", lambda v, folder: f"synth:{v}")

    def download(v, folder, progress):
        progress(50, 100)
        progress(100, 100)

    monkeypatch.setattr(voices, "download", download)
    client, voice, speaker = talking_app()
    with client.websocket_connect(f"/ws?token={TOKEN}&panel=1", headers=ORIGIN) as ws:
        ws.send_json({"type": "voice_get"})
        got = ws.receive_json()
        opts = {o["id"]: o for o in got["voces"]}
        assert not opts["capri"]["disponible"] and opts["dora"]["disponible"]  # no NVIDIA here
        ws.send_json({"type": "voice_set", "velocidad": 1.0, "robot": 0.0, "glitch": 0.0, "voz": "daniela", "probar": True})
        assert ws.receive_json()["voz"] == "daniela"
        assert speaker.used == ["daniela"] and speaker.said[-1][1] is True  # she says hi in it
        ws.send_json({"type": "voice_set", "velocidad": 1.0, "robot": 0.0, "glitch": 0.0, "voz": "capri"})
        assert ws.receive_json()["voz"] == "daniela"  # not this PC's: stays
        ws.send_json({"type": "voice_download", "voz": "claude_mx"})
        progress = [ws.receive_json() for _ in range(3)]
        assert [m["type"] for m in progress] == ["voice_progress", "voice_progress", "voice_info"]
        assert progress[1] == {"type": "voice_progress", "voz": "claude_mx", "completado": 100, "total": 100, "error": ""}
    assert settings.load().tts_voice == "daniela"


def test_the_wizard_gets_this_pc_saves_his_choices_and_finishes(client, monkeypatch, tmp_path):
    from app import firstrun, settings

    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    monkeypatch.setattr(firstrun, "detect", lambda: firstrun.Pc("RTX 4070", 12282, 32.0, 200.0, True, False, False))
    settings.load()
    with client.websocket_connect(f"/ws?token={TOKEN}&panel=1", headers=ORIGIN) as ws:
        ws.send_json({"type": "setup_get"})
        got = ws.receive_json()
        assert got["type"] == "setup_info" and got["gpu"] == "RTX 4070" and (got["proveedor"], got["modelo"]) == ("ollama", "gemma3:12b")
        ws.send_json({"type": "setup_save", "campo": "calendario", "valor": "webcal://p01-caldav.icloud.com/published/2/abc"})
        assert ws.receive_json() == {"type": "setup_saved", "campo": "calendario", "ok": True, "error": ""}
        ws.send_json({"type": "setup_save", "campo": "calendario", "valor": "no es nada"})
        bad = ws.receive_json()
        assert not bad["ok"] and bad["error"]
        ws.send_json({"type": "setup_save", "campo": "spotify", "valor": " 0123456789abcdef0123456789abcdef "})
        assert ws.receive_json()["ok"]
        ws.send_json({"type": "setup_save", "campo": "spotify", "valor": "no-un-id"})
        assert not ws.receive_json()["ok"]
        ws.send_json({"type": "setup_save", "campo": "steam_id", "valor": "76561198000000001"})
        assert ws.receive_json()["ok"]
        ws.send_json({"type": "setup_save", "campo": "steam_id", "valor": "cami"})
        assert not ws.receive_json()["ok"]
        assert not firstrun.done()
        ws.send_json({"type": "setup_done"})
        ws.send_json({"type": "setup_get"})  # answered after setup_done ran
        ws.receive_json()
    s = settings.load()
    assert s.calendar_url == "https://p01-caldav.icloud.com/published/2/abc" and s.spotify_client_id == "0123456789abcdef0123456789abcdef"
    assert firstrun.done()
