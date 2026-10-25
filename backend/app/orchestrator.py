from collections.abc import Awaitable, Callable

from app.llm.client import Generate, ollama_generate, reply
from app.protocol import ServerMessage, State, TextDelta, UtteranceEnd, UtteranceStart

Send = Callable[[ServerMessage], Awaitable[None]]


class Orchestrator:
    def __init__(self, generate: Generate = ollama_generate):
        self.generate = generate
        self.history: list[dict] = []

    async def turn(self, text: str, send: Send) -> None:
        self.history.append({"role": "user", "content": text})
        await send(State(value="thinking"))
        started = False
        async for event in reply(self.history, generate=self.generate):
            match event:
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
                    if not started:  # fallback without any streamed text
                        await send(State(value="speaking"))
                        await send(UtteranceStart(emocion=r.emocion, gesto=r.gesto))
                        await send(TextDelta(text=r.texto))
                    self.history.append({"role": "assistant", "content": r.model_dump_json()})
        await send(UtteranceEnd())
        await send(State(value="idle"))
