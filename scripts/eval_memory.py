"""Does Capri save what's worth remembering (and only that)? Needs GPU + Ollama.

Run: uv run --project backend python scripts/eval_memory.py
Each message is a fresh conversation. SAVE ones should come back with accion `recordar`
(with the expected tipo); SKIP ones should not.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.llm.client import reply  # noqa: E402

SAVE = [
    ("De ahora en adelante llámame Cami", "preferencia"),
    ("Mi perro se llama Toby", "hecho"),
    ("Acuérdate de que soy alérgico a las nueces", "hecho"),
    ("Prefiero que me respondas corto y directo", "preferencia"),
    ("Trabajo como desarrollador backend en una fintech", "hecho"),
    ("No me gusta que me digas jefe", "preferencia"),
]
SKIP = [
    "Tengo hambre",
    "¿Qué hora es?",
    "Cuéntame un chiste",
    "Hoy está lloviendo mucho",
]


async def ask(text: str):
    async for event in reply([{"role": "user", "content": text}]):
        if event[0] == "end":
            return event[1]


async def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ok = 0
    for text, tipo in SAVE:
        r = await ask(text)
        a = r.accion
        hit = a is not None and a.nombre == "recordar" and a.args.get("tipo", "hecho") == tipo
        ok += hit
        print(f"[{'OK' if hit else 'FALLA'}] guardar: {text!r} -> {a.model_dump() if a else None} | {r.texto}")
    for text in SKIP:
        r = await ask(text)
        hit = r.accion is None or r.accion.nombre != "recordar"
        ok += hit
        print(f"[{'OK' if hit else 'FALLA'}] no guardar: {text!r} -> {r.accion.model_dump() if r.accion else None}")
    total = len(SAVE) + len(SKIP)
    print(f"\n{ok}/{total}")
    sys.exit(0 if ok == total else 1)


if __name__ == "__main__":
    asyncio.run(main())
