"""Text chat CLI. Run: uv run python -m app.chat (inside backend/)."""

import asyncio
import logging
import time

from app.llm.client import reply


async def main() -> None:
    history: list[dict] = []
    print("Capri (Ctrl+C para salir)")
    while True:
        try:
            user = await asyncio.to_thread(input, "\n› ")
        except (EOFError, KeyboardInterrupt):
            return
        if not user.strip():
            continue
        history.append({"role": "user", "content": user})
        t0 = time.perf_counter()
        first = None
        async for event in reply(history):
            match event:
                case ("start", emocion, gesto):
                    print(f"[{emocion} · {gesto}] ", end="", flush=True)
                case ("delta", text):
                    first = first or time.perf_counter() - t0
                    print(text, end="", flush=True)
                case ("retry",):
                    print("\n(reintentando)\n", end="", flush=True)
                case ("end", r):
                    history.append({"role": "assistant", "content": r.model_dump_json()})
        print(f"\n  ({(first or 0) * 1000:.0f} ms a primer carácter, {(time.perf_counter() - t0) * 1000:.0f} ms total)")


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    asyncio.run(main())
