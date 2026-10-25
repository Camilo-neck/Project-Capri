"""Backend server. Run: uv run python -m app.main [--demo] (inside backend/).

The token comes from CAPRI_TOKEN (set by whoever launches the backend) or is generated per start.
"""

import argparse
import logging
import os
import secrets

import uvicorn

from app.demo import demo_generate_factory
from app.orchestrator import Orchestrator
from app.ws import create_app

HOST, PORT = "127.0.0.1", 8765


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true", help="scripted replies instead of the LLM")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)

    token = os.environ.get("CAPRI_TOKEN") or secrets.token_urlsafe(32)
    orchestrator = Orchestrator(demo_generate_factory()) if args.demo else Orchestrator()
    print(f"ws://{HOST}:{PORT}/ws?token={token}", flush=True)
    uvicorn.run(create_app(token, orchestrator), host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
