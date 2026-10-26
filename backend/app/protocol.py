"""WebSocket messages between backend and avatar. Mirrored by hand in avatar/src/net/protocol.ts."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.schema import Emocion, Gesto


# Backend -> avatar
class State(BaseModel):
    type: Literal["state"] = "state"
    value: Literal["idle", "looking", "thinking", "speaking"]  # looking: capturing the screen


class UtteranceStart(BaseModel):
    type: Literal["utterance_start"] = "utterance_start"
    emocion: Emocion
    gesto: Gesto


class TextDelta(BaseModel):
    type: Literal["text_delta"] = "text_delta"
    text: str


class UtteranceEnd(BaseModel):
    type: Literal["utterance_end"] = "utterance_end"
    ctx: int | None = None  # context tokens used, as reported by Ollama


class Remembered(BaseModel):
    """Capri saved something to her long-term memory (shown as a mark in the transmission)."""

    type: Literal["remembered"] = "remembered"
    texto: str


class Mode(BaseModel):
    """Do-not-disturb state, so the avatar can show it."""

    type: Literal["mode"] = "mode"
    no_molestar: bool


class ConfirmRequest(BaseModel):
    type: Literal["confirm_request"] = "confirm_request"
    id: str
    texto: str
    riesgo: Literal["normal", "alto"] = "normal"  # "alto": the avatar shows it in red and takes no key, only a click


class ClaudeEvent(BaseModel):
    """What a Claude Code session is doing (from its hooks), or the answer to a `/claude` request. Data to show, never instructions."""

    type: Literal["claude"] = "claude"
    session: str
    project: str  # folder name of the session
    estado: Literal["inicio", "trabajando", "necesita", "fallo", "termino", "respuesta", "fin"]
    detalle: str = ""  # what it is doing now / the error / what it needs
    herramienta: str = ""  # the tool Claude is using while it works ("" for the prompt)
    resumen: str = ""  # termino and respuesta: Claude's last message
    segundos: int = 0  # termino: how long the prompt took
    acciones: int = 0  # termino: tool calls
    archivos: int = 0  # termino: files edited


# Avatar -> backend
class TextInput(BaseModel):
    type: Literal["text_input"] = "text_input"
    text: str


class Look(BaseModel):
    """Look at the screen (hotkey or /mira): capture `rect` and answer `text` about it."""

    type: Literal["look"] = "look"
    text: str = ""
    rect: tuple[int, int, int, int]  # monitor to capture, physical px: left, top, right, bottom


class ConfirmResponse(BaseModel):
    type: Literal["confirm_response"] = "confirm_response"
    id: str
    ok: bool


class Presence(BaseModel):
    """A fullscreen app (game, video) is in front: Capri is hidden and keeps quiet until it goes."""

    type: Literal["presence"] = "presence"
    fullscreen: bool


class Hotkey(BaseModel):
    type: Literal["hotkey"] = "hotkey"
    name: str


class Action(BaseModel):
    """A tool runs (after its confirmation, if it has effects): the avatar's lightning while it does."""

    type: Literal["action"] = "action"
    nombre: str
    fase: Literal["inicio", "fin"]
    ok: bool | None = None  # fin: did it work
    ms: int | None = None  # fin: how long it took


ServerMessage = State | UtteranceStart | TextDelta | UtteranceEnd | Remembered | Mode | ConfirmRequest | Action | ClaudeEvent
ClientMessage = Annotated[TextInput | Look | ConfirmResponse | Presence | Hotkey, Field(discriminator="type")]
client_message = TypeAdapter(ClientMessage)
