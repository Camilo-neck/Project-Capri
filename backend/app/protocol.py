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
    cortada: bool = False  # she was interrupted: the text ends where she was cut off


class Remembered(BaseModel):
    """Capri saved something to her long-term memory (shown as a mark in the transmission)."""

    type: Literal["remembered"] = "remembered"
    texto: str


class Mode(BaseModel):
    """Do-not-disturb and Claude-mode state, so the avatar (and its tray menu) can show them."""

    type: Literal["mode"] = "mode"
    no_molestar: bool
    claude: bool = True
    hablar: bool = True  # with the voice on, she answers out loud


class ConfirmRequest(BaseModel):
    type: Literal["confirm_request"] = "confirm_request"
    id: str
    texto: str
    riesgo: Literal["normal", "alto"] = "normal"  # "alto": the avatar shows it in red and takes no key, only a click


class Button(BaseModel):
    id: str
    texto: str


class Buttons(BaseModel):
    """Buttons under what she just said that don't hold anything up (cancel a reminder, done, snooze...)."""

    type: Literal["buttons"] = "buttons"
    id: str
    botones: list[Button]


class PcEvent(BaseModel):
    """Something she felt in the PC (pcsense.py): the avatar reacts. Read locally; never sent to the model."""

    type: Literal["pc"] = "pc"
    tipo: Literal["caliente", "cargador", "bateria", "red", "usb", "dispositivo", "juego"]
    detalle: str = ""  # cargador on|off · bateria 20|10 · red caida|vuelve · usb her verdict · dispositivo kind:name · juego inicio|fin:name


class Voice(BaseModel):
    """The microphone: off, loading the model, idle (waiting for "hey Capri"), hearing someone, listening (the next sentence is for her) or reading what was said."""

    type: Literal["voice"] = "voice"
    estado: Literal["off", "loading", "idle", "hearing", "listening", "thinking"]


class Level(BaseModel):
    """How loud: the microphone while he talks (camera mode's meter) or her voice while she speaks (her mouth)."""

    type: Literal["level"] = "level"
    fuente: Literal["mic", "tts"]
    valor: float  # 0-1


class VoiceOption(BaseModel):
    """One of her voices (voices.CATALOG) as it stands on this PC."""

    id: str
    nombre: str
    motor: str
    nota: str
    gpu: bool
    descargada: bool
    descargable: bool
    disponible: bool
    motivo: str
    mb: int


class VoiceInfo(BaseModel):
    """Her voice and its touches, for the settings panel."""

    type: Literal["voice_info"] = "voice_info"
    velocidad: float
    robot: float
    glitch: float
    voz: str = ""
    voces: list[VoiceOption] = []


class VoiceProgress(BaseModel):
    """A voice downloading (bytes)."""

    type: Literal["voice_progress"] = "voice_progress"
    voz: str
    completado: int = 0
    total: int = 0
    error: str = ""


class Heard(BaseModel):
    """What was said to her. The avatar handles `texto` as if it had been typed (slash commands included)."""

    type: Literal["heard"] = "heard"
    texto: str
    original: str = ""  # the transcript, before a spoken command became its slash command
    idioma: str = ""
    charla: bool = False  # came by voice without her name (the conversation window): may be the room, not him


class ModelInfo(BaseModel):
    """Her brain, for the settings panel: what is chosen, what each provider offers, which keys are saved."""

    type: Literal["model_info"] = "model_info"
    proveedor: str
    nombre: str
    opciones: dict[str, list[str]]
    claves: dict[str, bool]
    error: str = ""


class ModelProgress(BaseModel):
    """A local model downloading (Ollama pull)."""

    type: Literal["model_progress"] = "model_progress"
    nombre: str
    estado: str
    completado: int = 0
    total: int = 0


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
    charla: bool = False  # heard without her name (Heard.charla): never enough to capture the screen without a click


class Look(BaseModel):
    """Look at the screen (hotkey or /mira): capture `rect` and answer `text` about it."""

    type: Literal["look"] = "look"
    text: str = ""
    rect: tuple[int, int, int, int]  # monitor to capture, physical px: left, top, right, bottom


class ConfirmResponse(BaseModel):
    type: Literal["confirm_response"] = "confirm_response"
    id: str
    ok: bool


class Pressed(BaseModel):
    """One of her Buttons was clicked."""

    type: Literal["pressed"] = "pressed"
    id: str
    boton: str


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


class RoutineInfo(BaseModel):
    nombre: str
    frases: list[str]
    apps: list[str]
    musica: str


class Routines(BaseModel):
    """Her routines ([rutinas] in config.toml and the built-in ones), for the panel's command list."""

    type: Literal["routines"] = "routines"
    rutinas: list[RoutineInfo]


ServerMessage = (State | UtteranceStart | TextDelta | UtteranceEnd | Remembered | Mode | ConfirmRequest | Buttons | PcEvent | Action | ClaudeEvent
                 | Voice | Level | Heard | ModelInfo | ModelProgress | VoiceInfo | VoiceProgress | Routines)
class Say(BaseModel):
    """A line of the avatar's own (a greeting, a reaction to the PC): out loud too, if she's talking."""

    type: Literal["say"] = "say"
    texto: str = Field(max_length=500)


class Interrupt(BaseModel):
    """He cuts her off (a click on her transmission): she stops talking, and the turn stops where it is."""

    type: Literal["interrupt"] = "interrupt"


class VoiceGet(BaseModel):
    type: Literal["voice_get"] = "voice_get"


class VoiceSet(BaseModel):
    """The panel's sliders; `probar` plays a line with them (even with the voice off)."""

    type: Literal["voice_set"] = "voice_set"
    velocidad: float
    robot: float
    glitch: float
    voz: str = ""  # another of her voices ("" keeps hers)
    probar: bool = False


class VoiceDownload(BaseModel):
    type: Literal["voice_download"] = "voice_download"
    voz: str


class RoutinesGet(BaseModel):
    type: Literal["routines_get"] = "routines_get"


class ModelGet(BaseModel):
    type: Literal["model_get"] = "model_get"


class ModelSet(BaseModel):
    type: Literal["model_set"] = "model_set"
    proveedor: str
    nombre: str


class ModelKey(BaseModel):
    """An API key for Claude or GPT ("" removes it). Kept in Windows' Credential Manager, never in config.toml."""

    type: Literal["model_key"] = "model_key"
    proveedor: str
    clave: str


class ModelPull(BaseModel):
    type: Literal["model_pull"] = "model_pull"
    nombre: str


ClientMessage = Annotated[TextInput | Look | ConfirmResponse | Pressed | Presence | Hotkey | ModelGet | ModelSet | ModelKey | ModelPull
                          | Say | VoiceGet | VoiceSet | Interrupt | RoutinesGet | VoiceDownload,
                          Field(discriminator="type")]
client_message = TypeAdapter(ClientMessage)
