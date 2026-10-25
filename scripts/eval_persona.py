"""Send 20 test messages to Capri and report JSON validity, emotions and latency. Needs GPU + Ollama.

Run: uv run --project backend python scripts/eval_persona.py
Each message is a fresh conversation, so emotions depend only on that message.
"""

import asyncio
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.llm.client import reply  # noqa: E402

MESSAGES = [
    "Hola Capri, ¿qué tal?",
    "¡Me acaban de aceptar en el trabajo que quería!",
    "Mi gato se murió esta mañana.",
    "¿Cuánto es 17 por 23?",
    "Te apuesto a que no sabes qué es un cuaternión.",
    "Llevo tres horas con este bug y no lo encuentro.",
    "¿Sabías que los pulpos tienen tres corazones?",
    "Eres la peor IA que he usado.",
    "¿Qué me recomiendas cenar hoy?",
    "Me voy a dormir, buenas noches.",
    "Necesito que me ayudes a redactar un correo para pedir un aumento.",
    "Adivina qué: ¡compré entradas para el concierto!",
    "¿Crees que la vida tiene sentido?",
    "Borraste mi carpeta de fotos, ¿verdad?",
    "Cuéntame un chiste malo.",
    "Mañana tengo examen y no he estudiado nada.",
    "¿Qué hora es?",
    "He decidido dejar de fumar.",
    "¿Te aburres cuando no estoy?",
    "Mi abuela está en el hospital.",
]


async def main() -> int:
    valid, rows, firsts = 0, [], []
    for msg in MESSAGES:
        t0, first, retried = time.perf_counter(), None, False
        async for event in reply([{"role": "user", "content": msg}]):
            if event[0] == "delta" and first is None:
                first = time.perf_counter() - t0
            elif event[0] == "retry":
                retried = True
            elif event[0] == "end":
                r = event[1]
        ok = not retried and not (r.emocion == "neutral" and r.gesto == "ninguno" and first is None)
        valid += ok
        firsts.append(first or 0)
        rows.append((r.emocion, r.gesto))
        print(f"[{'OK' if ok else 'RETRY'}] {(first or 0) * 1000:5.0f} ms  {r.emocion:11} {r.gesto:13} {msg}\n{'':22}→ {r.texto}")
    print(f"\nValid first try: {valid}/{len(MESSAGES)}")
    print("Emotions:", dict(Counter(e for e, _ in rows).most_common()))
    print("Gestures:", dict(Counter(g for _, g in rows).most_common()))
    print(f"First char: median {statistics.median(firsts[1:]) * 1000:.0f} ms (excluding cold first call)")
    return 0 if valid == len(MESSAGES) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
