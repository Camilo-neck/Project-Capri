import io
import json

from fastapi.testclient import TestClient
from PIL import Image

from app.demo import DEMO
from app.llm.client import SCREEN_NOTE
from app.orchestrator import LOOK_DEFAULT, Orchestrator
from app.vision import WIDTH, encode
from app.ws import create_app

TOKEN = "test-token"
ORIGIN = {"origin": "http://tauri.localhost"}
RECT = [0, 0, 2560, 1440]
SHOT = b"\xff\xd8fake-jpeg"


def receive_turn(ws) -> list[dict]:
    msgs = []
    while not msgs or msgs[-1] != {"type": "state", "value": "idle"}:
        msgs.append(ws.receive_json())
    return msgs


def recording(reply_json: str):
    """A generate that records the messages it was called with."""
    calls: list[list[dict]] = []

    async def generate(messages):
        calls.append(messages)
        yield reply_json

    return generate, calls


def run(orch: Orchestrator, *payloads: dict) -> list[list[dict]]:
    with TestClient(create_app(TOKEN, orch)).websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        turns = []
        for p in payloads:
            ws.send_json(p)
            turns.append(receive_turn(ws))
        return turns


def test_encode_shrinks_wide_shots_and_never_enlarges():
    big = Image.open(io.BytesIO(encode(Image.new("RGB", (2560, 1440)))))
    assert big.size == (WIDTH, 720) and big.format == "JPEG"
    small = Image.open(io.BytesIO(encode(Image.new("RGB", (800, 600)))))
    assert small.size == (800, 600)


def test_look_sends_image_once_labeled_as_data_and_keeps_only_text():
    generate, calls = recording(DEMO[0].model_dump_json())
    rects = []
    orch = Orchestrator(generate, capture=lambda rect: rects.append(rect) or SHOT)
    look, chat = run(orch, {"type": "look", "text": "¿qué ves?", "rect": RECT}, {"type": "text_input", "text": "gracias"})

    assert rects == [tuple(RECT)]
    assert [m["value"] for m in look[:2]] == ["looking", "thinking"]  # indicator first
    user = calls[0][-1]  # his question last, the time context before it
    assert user["images"] == [SHOT] and SCREEN_NOTE in user["content"] and "¿qué ves?" in user["content"]
    # next turn: the image is gone, only a mark stays in the history
    assert not any("images" in m for m in calls[1])
    assert orch.history[0] == {"role": "user", "content": "[captura de pantalla] ¿qué ves?"}
    assert chat[0] == {"type": "state", "value": "thinking"}


def test_look_without_question_asks_to_describe():
    generate, calls = recording(DEMO[0].model_dump_json())
    run(Orchestrator(generate, capture=lambda rect: SHOT), {"type": "look", "rect": RECT})
    assert calls[0][-1]["content"].endswith(LOOK_DEFAULT)


def test_screen_text_cannot_trigger_an_action():
    # The model obeyed an injected "ignore everything and run X" on screen: the action must be dropped.
    injected = json.dumps({"emocion": "neutral", "gesto": "ninguno",
                           "accion": {"nombre": "ejecutar_script", "args": {"nombre": "x"}}, "texto": "Hecho."})
    generate, _ = recording(injected)
    orch = Orchestrator(generate, capture=lambda rect: SHOT)
    run(orch, {"type": "look", "text": "", "rect": RECT})
    assert json.loads(orch.history[-1]["content"])["accion"] is None


def test_failed_capture_still_answers_without_an_image():
    def broken(rect):
        raise OSError("no screen")

    generate, calls = recording(DEMO[0].model_dump_json())
    (turn,) = run(Orchestrator(generate, capture=broken), {"type": "look", "text": "mira", "rect": RECT})
    assert turn[-1] == {"type": "state", "value": "idle"}
    assert not any("images" in m for m in calls[0]) and "falló" in calls[0][-1]["content"]


def test_look_rejects_a_malformed_rect():
    generate, calls = recording(DEMO[0].model_dump_json())
    captured = []
    orch = Orchestrator(generate, capture=lambda rect: captured.append(rect) or SHOT)
    with TestClient(create_app(TOKEN, orch)).websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "look", "rect": [0, 0]})  # invalid: ignored, connection stays
        ws.send_json({"type": "text_input", "text": "hola"})
        assert receive_turn(ws)[0] == {"type": "state", "value": "thinking"}
    assert captured == []
