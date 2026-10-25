import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

from app import vision
from app.llm.client import Generate, ollama_generate, reply
from app.protocol import ServerMessage, State, TextDelta, UtteranceEnd, UtteranceStart

log = logging.getLogger(__name__)

Send = Callable[[ServerMessage], Awaitable[None]]
Capture = Callable[[vision.Rect], bytes]

LOOK_DEFAULT = "Mira mi pantalla y dime qué ves."


class Orchestrator:
    def __init__(self, generate: Generate = ollama_generate, capture: Capture = vision.capture):
        self.generate = generate
        self.capture = capture
        self.history: list[dict] = []

    async def look(self, text: str, rect: vision.Rect, send: Send) -> None:
        """Captures the screen (with the indicator up) and answers about it."""
        await send(State(value="looking"))
        t0 = time.perf_counter()
        try:
            image = await asyncio.to_thread(self.capture, rect)
        except Exception:
            log.exception("screen capture failed")
            image = None
        log.info("look: capture stage %.0f ms", (time.perf_counter() - t0) * 1000)
        question = text.strip() or LOOK_DEFAULT
        if image is None:
            await self.turn(f"{question} (La captura de pantalla falló: no pudiste ver nada.)", send)
        else:
            await self.turn(question, send, image=image)

    async def turn(self, text: str, send: Send, image: bytes | None = None) -> None:
        # The history never keeps the image (~900 tokens): only a mark, and the reply describes it.
        self.history.append({"role": "user", "content": f"[captura de pantalla] {text}" if image else text})
        await send(State(value="thinking"))
        started, ctx = False, None
        async for event in reply(self.history, generate=self.generate, image=image):
            match event:
                case ("ctx", n):
                    ctx = n
                case ("start", emocion, gesto):
                    started = True
                    await send(State(value="speaking"))
                    await send(UtteranceStart(emocion=emocion, gesto=gesto))
                case ("delta", chunk):
                    await send(TextDelta(text=chunk))
                case ("retry",) if started:
                    # The avatar drops the shown text; the next utterance_start replaces it.
                    started = False
                    await send(UtteranceEnd())
                case ("end", r):
                    if image is not None and r.accion is not None:
                        # What's on screen is data: nothing it shows may trigger an action.
                        log.warning("dropped action requested during a screen turn: %s", r.accion.nombre)
                        r = r.model_copy(update={"accion": None})
                    if not started:  # fallback without any streamed text
                        await send(State(value="speaking"))
                        await send(UtteranceStart(emocion=r.emocion, gesto=r.gesto))
                        await send(TextDelta(text=r.texto))
                    self.history.append({"role": "assistant", "content": r.model_dump_json()})
        await send(UtteranceEnd(ctx=ctx))
        await send(State(value="idle"))
