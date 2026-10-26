"""Claude Code hook: forwards what a session is doing to Capri (see backend/app/claude_link.py).

Standard library only, so it starts fast. Sends only what the avatar shows, clipped: tool name, a file
name, the start of a command or prompt, Claude's last message. Never file contents. If Capri isn't
running, or this is one of her own headless runs, it does nothing and never blocks Claude.
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

CLIP = {"prompt": 300, "error": 400, "message": 300, "last_assistant_message": 2000}
INPUT = {"file_path": 300, "notebook_path": 300, "command": 200, "pattern": 100}
PLAIN = ("session_id", "cwd", "hook_event_name", "tool_name", "notification_type", "is_interrupt", "agent_id")


def main() -> None:
    if os.environ.get("CAPRI_CLAUDE_RUN"):
        return
    config = Path(os.environ.get("CAPRI_CONFIG") or Path(os.environ["APPDATA"]) / "Capri" / "config.toml")
    try:
        link = json.loads((config.parent / "claude_link.json").read_text(encoding="utf-8"))
        sys.stdin.reconfigure(encoding="utf-8")
        p = json.load(sys.stdin)
    except (OSError, KeyError, ValueError):
        return
    out = {k: p[k] for k in PLAIN if k in p}
    out.update({k: str(p[k])[:n] for k, n in CLIP.items() if k in p})
    if isinstance(p.get("tool_input"), dict):
        out["tool_input"] = {k: str(v)[:INPUT[k]] for k, v in p["tool_input"].items() if k in INPUT}
    req = urllib.request.Request(
        f"http://127.0.0.1:{int(link['port'])}/claude/event", json.dumps(out).encode(),
        {"Content-Type": "application/json", "X-Capri-Token": link["token"]})
    try:
        urllib.request.urlopen(req, timeout=2).close()
    except OSError:
        pass  # Capri closed since the file was written


if __name__ == "__main__":
    main()
