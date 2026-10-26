"""Adds (or with --remove, takes out) Capri's hooks in Claude Code's settings.

    uv run --project backend python scripts/claude_hooks.py [--remove] [--settings PATH]

Keeps every other hook and setting, and writes a backup next to the file first. Restart Claude Code
sessions afterwards (hooks are read at start).
"""

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "scripts" / "claude_hook.py"
PYTHON = ROOT / "backend" / ".venv" / "Scripts" / "python.exe"
EVENTS = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUseFailure", "Notification", "Stop"]


def entry() -> dict:
    # exec form (args): no shell, so the same on PowerShell and Git Bash; async: never slows Claude down
    return {"hooks": [{"type": "command", "command": PYTHON.as_posix(), "args": [HOOK.as_posix()], "async": True, "timeout": 5}]}


def is_ours(group: dict) -> bool:
    return any(HOOK.name in " ".join([h.get("command", ""), *h.get("args", [])]) for h in group.get("hooks", []))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--remove", action="store_true")
    parser.add_argument("--settings", type=Path, default=Path.home() / ".claude" / "settings.json")
    args = parser.parse_args()
    path: Path = args.settings
    settings = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if path.exists():
        shutil.copy2(path, path.with_name(path.name + ".capri-backup"))
    hooks = settings.setdefault("hooks", {})
    for event in EVENTS:
        groups = [g for g in hooks.get(event, []) if not is_ours(g)]  # never twice
        if not args.remove:
            groups.append(entry())
        if groups:
            hooks[event] = groups
        else:
            hooks.pop(event, None)
    if not hooks:
        settings.pop("hooks")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{'Quitados' if args.remove else 'Puestos'} los hooks de Capri en {path}")


if __name__ == "__main__":
    main()
