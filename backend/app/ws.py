import asyncio
import logging
import secrets
import time
from collections.abc import Coroutine

from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.orchestrator import Orchestrator, recover
from app import launch, pcsense, settings
from app.llm import providers
from app.protocol import (ConfirmResponse, Hotkey, Look, ModelGet, ModelInfo, ModelKey, ModelProgress, ModelPull, ModelSet,
                          Heard, Interrupt, PcEvent, Presence, Pressed, RoutineInfo, Routines, RoutinesGet, Say, ServerMessage, State, TextInput, VoiceGet, VoiceInfo,
                          VoiceSet, Voice as VoiceState, client_message)
from app.speech import Speaker
from app.voice import Voice

log = logging.getLogger(__name__)

# Tauri on Windows serves the app from http://tauri.localhost; Vite dev server on 1420.
ALLOWED_ORIGINS = {"http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://localhost:1420"}


async def model_info(error: str = "") -> ModelInfo:
    s = settings.load()
    return ModelInfo(proveedor=s.model_provider, nombre=s.model_name, opciones=await providers.options(),
                     claves={p: bool(providers.key(p)) for p in providers.ENV}, error=error)


def create_app(token: str, orchestrator: Orchestrator, reminders: bool = True, voice: Voice | None = None,
               speaker: Speaker | None = None) -> FastAPI:
    """`reminders`: run the background loops (calendar reminders, speaking up unasked); off in tests."""
    app = FastAPI()
    clients: set = set()  # the `send` of each connected avatar, for what arrives from outside the socket

    async def broadcast(msg: ServerMessage) -> None:
        await asyncio.gather(*(send(msg) for send in list(clients)), return_exceptions=True)

    heard_at = [-1e9]  # when something said to her last went through (her latency, in voz.log)
    if speaker:
        orchestrator.hablar = speaker.enabled

    async def from_voice(msg: ServerMessage) -> None:
        if speaker and isinstance(msg, Heard):
            speaker.lang = msg.idioma or speaker.lang
            heard_at[0] = time.perf_counter()
        await broadcast(msg)

    def first_audio(_: float) -> None:
        after = time.perf_counter() - heard_at[0]
        if voice and after < 30:
            voice.note(f"{time.strftime('%H:%M:%S')}  su voz {after:.2f}s después de tu frase")

    def talks() -> bool:
        return bool(voice and speaker and voice.on and speaker.enabled)

    @app.on_event("startup")
    async def start_voice() -> None:
        if voice:
            loop = asyncio.get_running_loop()
            voice.attach(loop, from_voice)
            if speaker:
                speaker.emit = lambda m: asyncio.run_coroutine_threadsafe(broadcast(m), loop)
                speaker.on_first_audio = first_audio
                voice.speaker = speaker  # so he can talk over her

                async def voice_failed() -> None:  # no model or no sound card: the panel shows her voice off
                    orchestrator.hablar = False
                    await broadcast(orchestrator.mode())

                speaker.on_disabled = lambda: asyncio.run_coroutine_threadsafe(voice_failed(), loop)
                voice.on_interrupt = lambda: loop.call_soon_threadsafe(orchestrator.interrupt)
            if voice.autostart:
                voice.start()
                if speaker and speaker.enabled:
                    asyncio.create_task(asyncio.to_thread(speaker.warm))

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

        # the tray's settings panel opens its own socket: no turns, reminders, broadcasts or voice for it
        panel = ws.query_params.get("panel") == "1"

        async def send(msg: ServerMessage) -> None:
            if not panel and talks():
                speaker.see(msg)  # her voice follows the reply as it streams
            if voice and not panel and isinstance(msg, State) and msg.value == "idle":
                # her turn is over: a spoken exchange goes on without her name (once she's done talking)
                speaker.after(voice.converse) if talks() else voice.converse()
            await ws.send_text(msg.model_dump_json())

        # Turns run as tasks, one at a time, so this loop keeps reading: a turn waiting on a
        # confirmation needs the confirm_response that arrives while it waits.
        tasks: set[asyncio.Task] = set()

        def spawn(coro: Coroutine) -> None:
            async def locked() -> None:
                async with orchestrator.lock:
                    orchestrator.current = asyncio.current_task()  # what an interruption cancels
                    try:
                        await coro
                    except Exception:  # a broken turn must not leave her "thinking" forever
                        log.exception("turn failed")
                        await recover(send)

            task = asyncio.create_task(locked())
            tasks.add(task)
            task.add_done_callback(tasks.discard)

        if not panel:
            clients.add(send)
            # the avatar starts assuming dnd off, Claude mode and talking on
            if orchestrator.dnd or not orchestrator.claude.enabled or not orchestrator.hablar:
                await send(orchestrator.mode())
            if voice and voice.state != "off":
                await send(VoiceState(estado=voice.state))
            spawn(orchestrator.catch_up())  # summaries of sessions that ended with the app closed
            tasks.add(asyncio.create_task(asyncio.to_thread(launch.launchables)))  # her apps and games, ahead of "abre X"
            if reminders:
                tasks.add(asyncio.create_task(orchestrator.reminders(send)))
                tasks.add(asyncio.create_task(orchestrator.chatter(send)))
                tasks.add(asyncio.create_task(orchestrator.alarm_loop(send)))
                tasks.add(asyncio.create_task(pcsense.watch(lambda tipo, detalle: send(PcEvent(tipo=tipo, detalle=detalle)),
                                                            lambda: settings.load().pc_react)))

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
                    case TextInput(text=text, charla=charla):
                        if speaker and not panel:
                            speaker.stop()  # a new message of his: she stops talking and listens
                        if not panel:
                            orchestrator.interrupt()  # and a reply still streaming stops (a confirmation waiting stays)
                        spawn(orchestrator.turn(text, send, charla=charla))
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
                        if speaker and not voice.on:
                            speaker.release()  # her voice model leaves the GPU too
                        elif speaker and speaker.enabled:
                            tasks.add(asyncio.create_task(asyncio.to_thread(speaker.warm)))  # her voice ready for the first reply
                    case Hotkey(name="hablar") if speaker:
                        speaker.enabled = orchestrator.hablar = not speaker.enabled
                        if not speaker.enabled:
                            speaker.release()
                        elif voice and voice.on:
                            tasks.add(asyncio.create_task(asyncio.to_thread(speaker.warm)))
                        settings.set_value("voz", "hablar", speaker.enabled)
                        await broadcast(orchestrator.mode())
                    case Say(texto=texto) if talks() and not panel:
                        speaker.say(texto)
                    case VoiceGet() if speaker:
                        await send(VoiceInfo(velocidad=speaker.speed, robot=speaker.robot, glitch=speaker.glitch))
                    case VoiceSet() as v if speaker:
                        speaker.speed = min(1.5, max(0.7, v.velocidad))
                        speaker.robot, speaker.glitch = (min(1.0, max(0.0, x)) for x in (v.robot, v.glitch))
                        for key, value in (("velocidad", speaker.speed), ("robot", speaker.robot), ("glitch", speaker.glitch)):
                            settings.set_value("voz", key, value)
                        await send(VoiceInfo(velocidad=speaker.speed, robot=speaker.robot, glitch=speaker.glitch))
                        if v.probar:
                            speaker.stop()
                            speaker.say("¡Hola! Así sueno ahora, ¿te gusta?", force=True)
                    case Hotkey(name="escuchar") if voice:
                        if speaker and speaker.playing:  # over her: she stops and listens
                            speaker.stop()
                            orchestrator.interrupt()
                        voice.listen_now()
                    case Interrupt():
                        if speaker:
                            speaker.stop()
                        orchestrator.interrupt()
                    case Hotkey(name=name):
                        log.info("hotkey %s", name)
                    case RoutinesGet():
                        await send(Routines(rutinas=[RoutineInfo(nombre=n, frases=list(r.phrases), apps=list(r.apps), musica=r.music)
                                                     for n, r in settings.load().routines.items()]))
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
                if speaker:
                    speaker.stop()
            for task in tasks:
                task.cancel()

    return app
