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


class ConfirmRequest(BaseModel):
    type: Literal["confirm_request"] = "confirm_request"
    id: str
    texto: str


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


class Hotkey(BaseModel):
    type: Literal["hotkey"] = "hotkey"
    name: str


ServerMessage = State | UtteranceStart | TextDelta | UtteranceEnd | Remembered | ConfirmRequest
ClientMessage = Annotated[TextInput | Look | ConfirmResponse | Hotkey, Field(discriminator="type")]
client_message = TypeAdapter(ClientMessage)
