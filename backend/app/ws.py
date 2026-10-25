import asyncio
import logging
import secrets
from collections.abc import Coroutine

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.orchestrator import Orchestrator
from app.protocol import ConfirmResponse, Hotkey, Look, Mode, Presence, ServerMessage, TextInput, client_message

log = logging.getLogger(__name__)

# Tauri on Windows serves the app from http://tauri.localhost; Vite dev server on 1420.
ALLOWED_ORIGINS = {"http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://localhost:1420"}


def create_app(token: str, orchestrator: Orchestrator, reminders: bool = True) -> FastAPI:
    """`reminders`: run the background loops (calendar reminders, speaking up unasked); off in tests."""
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

        # Turns run as tasks, one at a time, so this loop keeps reading: a turn waiting on a
        # confirmation needs the confirm_response that arrives while it waits.
        tasks: set[asyncio.Task] = set()

        def spawn(coro: Coroutine) -> None:
            async def locked() -> None:
                async with orchestrator.lock:
                    await coro

            task = asyncio.create_task(locked())
            tasks.add(task)
            task.add_done_callback(tasks.discard)

        if orchestrator.dnd:  # the avatar starts assuming it's off
            await send(Mode(no_molestar=True))
        spawn(orchestrator.catch_up())  # summaries of sessions that ended with the app closed
        if reminders:
            tasks.add(asyncio.create_task(orchestrator.reminders(send)))
            tasks.add(asyncio.create_task(orchestrator.chatter(send)))
        try:
            while True:
                raw = await ws.receive_text()
                try:
                    msg = client_message.validate_json(raw)
                except ValidationError as e:
                    log.warning("invalid client message: %s", e)
                    continue
                match msg:
                    case TextInput(text=text):
                        spawn(orchestrator.turn(text, send))
                    case Look(text=text, rect=rect):
                        spawn(orchestrator.look(text, rect, send))
                    case ConfirmResponse(id=id, ok=ok):
                        orchestrator.confirm(id, ok)
                    case Presence(fullscreen=full):
                        orchestrator.set_away(full)
                    case Hotkey(name="no_molestar"):
                        await orchestrator.toggle_dnd(send)
                    case Hotkey(name=name):
                        log.info("hotkey %s", name)
        except WebSocketDisconnect:
            pass
        finally:
            orchestrator.cancel_pending()
            for task in tasks:
                task.cancel()

    return app
