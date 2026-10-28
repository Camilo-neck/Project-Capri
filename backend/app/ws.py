import asyncio
import logging
import secrets
from collections.abc import Coroutine

from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.orchestrator import Orchestrator, recover
from app import settings
from app.llm import providers
from app.protocol import (ConfirmResponse, Hotkey, Look, ModelGet, ModelInfo, ModelKey, ModelProgress, ModelPull, ModelSet,
                          Presence, Pressed, ServerMessage, TextInput, Voice as VoiceState, client_message)
from app.voice import Voice

log = logging.getLogger(__name__)

# Tauri on Windows serves the app from http://tauri.localhost; Vite dev server on 1420.
ALLOWED_ORIGINS = {"http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://localhost:1420"}


async def model_info(error: str = "") -> ModelInfo:
    s = settings.load()
    return ModelInfo(proveedor=s.model_provider, nombre=s.model_name, opciones=await providers.options(),
                     claves={p: bool(providers.key(p)) for p in providers.ENV}, error=error)


def create_app(token: str, orchestrator: Orchestrator, reminders: bool = True, voice: Voice | None = None) -> FastAPI:
    """`reminders`: run the background loops (calendar reminders, speaking up unasked); off in tests."""
    app = FastAPI()
    clients: set = set()  # the `send` of each connected avatar, for what arrives from outside the socket

    async def broadcast(msg: ServerMessage) -> None:
        await asyncio.gather(*(send(msg) for send in list(clients)), return_exceptions=True)

    @app.on_event("startup")
    async def start_voice() -> None:
        if voice:
            voice.attach(asyncio.get_running_loop(), broadcast)
            if voice.autostart:
                voice.start()

    @app.post("/claude/event")
    async def claude_event(request: Request) -> Response:
        """A Claude Code hook (scripts/claude_hook.py). Browsers can't forge the token header or drop their Origin."""
        given = request.headers.get("x-capri-token", "")
        if request.headers.get("origin") or not secrets.compare_digest(given.encode(), token.encode()):
            return Response(status_code=403)
        if int(request.headers.get("content-length") or 0) > 100_000:
            return Response(status_code=413)
        try:
            payload = await request.json()
        except ValueError:
            return Response(status_code=400)
        event = orchestrator.claude.ingest(payload) if isinstance(payload, dict) else None
        if event:
            await broadcast(event)
        return Response(status_code=204)

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
                    try:
                        await coro
                    except Exception:  # a broken turn must not leave her "thinking" forever
                        log.exception("turn failed")
                        await recover(send)

            task = asyncio.create_task(locked())
            tasks.add(task)
            task.add_done_callback(tasks.discard)

        # the tray's settings panel opens its own socket: no turns, reminders or broadcasts for it
        panel = ws.query_params.get("panel") == "1"
        if not panel:
            clients.add(send)
            if orchestrator.dnd or not orchestrator.claude.enabled:  # the avatar starts assuming dnd is off and Claude mode on
                await send(orchestrator.mode())
            if voice and voice.state != "off":
                await send(VoiceState(estado=voice.state))
            spawn(orchestrator.catch_up())  # summaries of sessions that ended with the app closed
            if reminders:
                tasks.add(asyncio.create_task(orchestrator.reminders(send)))
                tasks.add(asyncio.create_task(orchestrator.chatter(send)))
                tasks.add(asyncio.create_task(orchestrator.alarm_loop(send)))

        async def pull(name: str) -> None:
            try:
                async for status, done, total in providers.pull(name):
                    await send(ModelProgress(nombre=name, estado=status, completado=done, total=total))
                await send(await model_info())
            except Exception as e:  # no such model, no disk space, Ollama down
                await send(await model_info(f"No se pudo descargar {name}: {e}"))

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
                    case Pressed(id=id, boton=boton):
                        spawn(orchestrator.press(id, boton, send))
                    case ConfirmResponse(id=id, ok=ok):
                        orchestrator.confirm(id, ok)
                    case Presence(fullscreen=full):
                        orchestrator.set_away(full)
                    case Hotkey(name="no_molestar"):
                        await orchestrator.toggle_dnd(send)
                    case Hotkey(name="claude"):
                        await orchestrator.toggle_claude(send)
                    case Hotkey(name="voz") if voice:
                        voice.toggle()
                    case Hotkey(name="escuchar") if voice:
                        voice.listen_now()
                    case Hotkey(name=name):
                        log.info("hotkey %s", name)
                    case ModelGet():
                        await send(await model_info())
                    case ModelSet(proveedor=p, nombre=n):
                        try:
                            await providers.choose(p, n)
                            await send(await model_info())
                        except ValueError as e:
                            await send(await model_info(str(e)))
                    case ModelKey(proveedor=p, clave=k):
                        try:
                            providers.set_key(p, k)
                            await send(await model_info())
                        except ValueError:
                            await send(await model_info(f"Proveedor desconocido: {p}"))
                    case ModelPull(nombre=n):
                        task = asyncio.create_task(pull(n.strip()))
                        tasks.add(task)
                        task.add_done_callback(tasks.discard)
        except WebSocketDisconnect:
            pass
        finally:
            clients.discard(send)
            if not panel:
                orchestrator.cancel_pending()
            for task in tasks:
                task.cancel()

    return app
