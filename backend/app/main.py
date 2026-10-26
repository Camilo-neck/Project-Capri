"""Backend server. Run: uv run python -m app.main [--demo] (inside backend/).

The token comes from CAPRI_TOKEN (set by whoever launches the backend) or is generated per start.
"""

import argparse
import json
import logging
import os
import secrets
import socket
import sys
import threading

import uvicorn

from app import settings
from app.demo import demo_generate_factory
from app.memory import Memory
from app.orchestrator import Orchestrator
from app.ws import create_app

HOST, PORT = "127.0.0.1", 8765


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true", help="scripted replies instead of the LLM")
    parser.add_argument("--exit-with-stdin", action="store_true", help="exit when the parent closes our stdin")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    if args.exit_with_stdin:
        # The launcher holds our stdin; EOF means it exited or crashed, so don't outlive it.
        threading.Thread(target=lambda: (sys.stdin.read(), os._exit(0)), daemon=True).start()

    token = os.environ.get("CAPRI_TOKEN") or secrets.token_urlsafe(32)
    if args.demo:  # no LLM and no traces: scripted replies, a throwaway memory, canned summaries
        async def demo_summary(text: str) -> str:
            return "Conversación de demostración."

        orchestrator = Orchestrator(demo_generate_factory(), memory=Memory(":memory:"), summarize=demo_summary)
    else:
        orchestrator = Orchestrator()
    sock = socket.create_server((HOST, PORT))  # fails here if another Capri has the port, before touching its link file
    # where the Claude Code hooks find us (they run in other processes and can't know the per-start token)
    link_file = settings.path().parent / "claude_link.json"
    link_file.parent.mkdir(parents=True, exist_ok=True)
    link_file.write_text(json.dumps({"port": PORT, "token": token}), encoding="utf-8")
    print(f"ws://{HOST}:{PORT}/ws?token={token}", flush=True)
    uvicorn.Server(uvicorn.Config(create_app(token, orchestrator), log_level="warning")).run(sockets=[sock])


if __name__ == "__main__":
    main()
