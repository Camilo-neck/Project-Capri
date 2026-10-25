"""Test client: sends messages to a running backend and prints what comes back.

Run (from the repo root, backend running with the same token):
  $env:CAPRI_TOKEN = "dev"; uv run --project backend python -m app.main --demo   (in backend/)
  $env:CAPRI_TOKEN = "dev"; uv run --project backend python scripts/ws_client.py [--count 10] [message]
With --demo on the server, --count 10 walks through all emotions and checks each turn arrives in order.
"""

import argparse
import asyncio
import json
import os
import sys

import websockets

ORDER = ["state", "state", "utterance_start", "text_delta", "utterance_end", "state"]


async def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("message", nargs="?", default="Hola Capri")
    p.add_argument("--count", type=int, default=1)
    p.add_argument("--token", default=os.environ.get("CAPRI_TOKEN", ""))
    args = p.parse_args()

    url = f"ws://127.0.0.1:8765/ws?token={args.token}"
    ok = True
    async with websockets.connect(url, origin="http://localhost:1420") as ws:
        for _ in range(args.count):
            await ws.send(json.dumps({"type": "text_input", "text": args.message}))
            kinds, text = [], ""
            while True:
                msg = json.loads(await ws.recv())
                if msg["type"] == "utterance_start":
                    print(f"[{msg['emocion']} · {msg['gesto']}] ", end="", flush=True)
                elif msg["type"] == "text_delta":
                    text += msg["text"]
                    print(msg["text"], end="", flush=True)
                if not kinds or kinds[-1] != msg["type"] or msg["type"] == "state":
                    kinds.append(msg["type"])
                if msg == {"type": "state", "value": "idle"}:
                    break
            in_order = kinds == ORDER
            ok &= in_order
            print(f"\n  {'OK' if in_order else 'OUT OF ORDER: ' + ' > '.join(kinds)}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
