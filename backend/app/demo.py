"""Scripted replies that cover every emotion and gesture, to drive the avatar without the LLM."""

import asyncio
import itertools
from collections.abc import AsyncIterator
from typing import get_args

from app.schema import Emocion, Gesto, Reply

LINES = {
    "neutral": "Aquí estoy, como siempre, viviendo en tu disco duro.",
    "feliz": "¡Eso me ha hecho el día!",
    "emocionada": "¡No puede ser, cuéntamelo todo ya!",
    "traviesa": "Igual te he cambiado el fondo de pantalla. O igual no.",
    "curiosa": "¿Y eso qué es? Enséñamelo.",
    "pensativa": "Mmm, déjame darle una vuelta...",
    "sorprendida": "¿Qué? ¿En serio?",
    "molesta": "Otra vez con las cuarenta pestañas abiertas, ¿eh?",
    "triste": "Vaya... lo siento mucho.",
    "seria": "Vale, esto es importante. Vamos paso a paso.",
}
GESTOS = get_args(Gesto)
DEMO = [
    Reply(emocion=e, gesto=GESTOS[i % len(GESTOS)], accion=None, texto=LINES[e])
    for i, e in enumerate(get_args(Emocion))
]


def demo_generate_factory(chunk_delay: float = 0.03):
    replies = itertools.cycle(DEMO)

    async def generate(messages: list[dict]) -> AsyncIterator[str]:
        raw = next(replies).model_dump_json()
        for i in range(0, len(raw), 4):  # ~token-sized chunks
            await asyncio.sleep(chunk_delay)
            yield raw[i:i + 4]

    return generate
