"""WebSocket messages between backend and avatar. Mirrored by hand in avatar/src/net/protocol.ts."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

from app.schema import Emocion, Gesto


# Backend -> avatar
class State(BaseModel):
    type: Literal["state"] = "state"
    value: Literal["idle", "thinking", "speaking"]


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


class ConfirmRequest(BaseModel):
    type: Literal["confirm_request"] = "confirm_request"
    id: str
    texto: str


# Avatar -> backend
class TextInput(BaseModel):
    type: Literal["text_input"] = "text_input"
    text: str


class ConfirmResponse(BaseModel):
    type: Literal["confirm_response"] = "confirm_response"
    id: str
    ok: bool


class Hotkey(BaseModel):
    type: Literal["hotkey"] = "hotkey"
    name: str


ServerMessage = State | UtteranceStart | TextDelta | UtteranceEnd | ConfirmRequest
ClientMessage = Annotated[TextInput | ConfirmResponse | Hotkey, Field(discriminator="type")]
client_message = TypeAdapter(ClientMessage)
