from typing import Any, Literal

from pydantic import BaseModel

from app.tools import ToolName

Emocion = Literal[
    "neutral", "feliz", "emocionada", "traviesa", "curiosa",
    "pensativa", "sorprendida", "molesta", "triste", "seria",
]
Gesto = Literal["ninguno", "asentir", "ladear_cabeza", "guino", "saltar", "senalar", "cruzar_brazos"]


class Accion(BaseModel):
    nombre: ToolName  # a closed list, so Ollama's grammar can't invent tools
    args: dict[str, Any] = {}  # tools without arguments ("leer_portapapeles") often come without it


class Reply(BaseModel):
    # Field order matters: the avatar changes face before `texto` starts streaming.
    emocion: Emocion
    gesto: Gesto
    accion: Accion | None
    texto: str


FALLBACK_TEXT = "Uy, se me cruzaron los cables. ¿Me lo repites?"
