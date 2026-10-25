import logging
import secrets

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.orchestrator import Orchestrator
from app.protocol import ConfirmResponse, Hotkey, ServerMessage, TextInput, client_message

log = logging.getLogger(__name__)

# Tauri on Windows serves the app from http://tauri.localhost; Vite dev server on 1420.
ALLOWED_ORIGINS = {"http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://localhost:1420"}


def create_app(token: str, orchestrator: Orchestrator) -> FastAPI:
    app = FastAPI()

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket) -> None:
        # Any web page can open a WebSocket to localhost, so check Origin and token before accepting.
        origin = ws.headers.get("origin")
        given = ws.query_params.get("token", "")
        if origin not in ALLOWED_ORIGINS or not secrets.compare_digest(given.encode(), token.encode()):
            log.warning("rejected ws connection: origin=%r", origin)
            await ws.close(code=1008)
            return
        await ws.accept()

        async def send(msg: ServerMessage) -> None:
            await ws.send_text(msg.model_dump_json())

        try:
            while True:
                raw = await ws.receive_text()
                try:
                    msg = client_message.validate_json(raw)
                except ValidationError as e:
                    log.warning("invalid client message: %s", e)
                    continue
                match msg:
                    # ponytail: turns run inline, so input received mid-turn waits; add a task queue if barge-in matters.
                    case TextInput(text=text):
                        await orchestrator.turn(text, send)
                    case ConfirmResponse():
                        log.info("confirm_response %s (no pending actions until phase 5)", msg.id)
                    case Hotkey(name=name):
                        log.info("hotkey %s", name)
        except WebSocketDisconnect:
            pass

    return app
