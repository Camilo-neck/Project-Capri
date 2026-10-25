import json
import re
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
            assert msgs[-2:] == [{"type": "utterance_end"}, {"type": "state", "value": "idle"}]
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
