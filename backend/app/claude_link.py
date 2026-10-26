"""Claude mode: shows what Claude Code sessions are doing and lets Capri ask one a read-only question.

Claude Code's hooks (scripts/claude_hook.py) post each event to /claude/event; `ingest` turns it into a
ClaudeEvent for the avatar. Everything in an event is data to display: it never reaches Capri's model.
`/claude <question>` continues the latest session headless and forked (the live one isn't touched), with
only Read, Glob and Grep, and nothing that would ask permission is allowed.
"""

import asyncio
import os
import shutil
import time
from dataclasses import dataclass, field
from pathlib import PurePath

from app.protocol import ClaudeEvent

ASKS = {"permission_prompt", "elicitation_dialog", "agent_needs_input"}  # Notification types that mean "it needs you"
FAILS = {"Bash", "PowerShell"}  # a failed edit or read is routine; a failed command is worth a flinch
ASK_S = 300  # a question to Claude may take this long
RUN_ENV = "CAPRI_CLAUDE_RUN"  # set for the headless runs, so their own hooks don't echo back here
READ_ONLY = ["--tools", "Read,Glob,Grep", "--allowedTools", "Read,Glob,Grep", "--permission-mode", "dontAsk", "--permission-prompts", "none"]


def clip(text: object, n: int) -> str:
    one = " ".join(str(text or "").split())
    return one if len(one) <= n else one[: n - 1] + "…"


def base(path: object) -> str:
    return PurePath(str(path).replace("\\", "/")).name or clip(path, 40)


@dataclass
class Session:
    id: str
    project: str
    cwd: str
    started: float = field(default_factory=time.monotonic)  # when the current prompt began
    seen: float = field(default_factory=time.monotonic)  # last event
    actions: int = 0
    files: set[str] = field(default_factory=set)


def doing(tool: str, args: dict) -> str:
    """What a tool call looks like on the avatar's ticker."""
    a = args if isinstance(args, dict) else {}
    match tool:
        case "Edit" | "MultiEdit" | "Write" | "NotebookEdit":
            return f"Editando {base(a.get('file_path') or a.get('notebook_path'))}"
        case "Read":
            return f"Leyendo {base(a.get('file_path'))}"
        case "Bash" | "PowerShell":
            return f"Ejecutando: {clip(a.get('command'), 60)}"
        case "Grep" | "Glob":
            return f"Buscando {clip(a.get('pattern'), 40)}"
        case "WebFetch" | "WebSearch":
            return "Mirando la web"
        case "Task" | "Agent":
            return "Lanzando un subagente"
        case "TodoWrite":
            return "Actualizando sus tareas"
        case _:
            return f"Usando {clip(tool, 30)}"


class ClaudeLink:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}
        self.enabled = True

    def latest(self) -> Session | None:
        return max(self.sessions.values(), key=lambda s: s.seen, default=None)

    def ingest(self, p: dict) -> ClaudeEvent | None:
        """A hook payload (already trimmed by the hook script) as an event for the avatar, or None to ignore it."""
        sid, event = clip(p.get("session_id"), 80), p.get("hook_event_name")
        if not self.enabled or not sid or p.get("agent_id"):  # subagents' own hooks would double every line
            return None
        s = self.sessions.get(sid)
        if s is None:
            cwd = str(p.get("cwd") or "")
            s = self.sessions[sid] = Session(sid, clip(base(cwd), 40) or "Claude", cwd)
            if len(self.sessions) > 20:  # sessions that never said goodbye
                del self.sessions[min(self.sessions, key=lambda k: self.sessions[k].seen)]
        s.seen = time.monotonic()

        def out(estado: str, **kw) -> ClaudeEvent:
            return ClaudeEvent(session=sid, project=s.project, estado=estado, **kw)

        match event:
            case "SessionStart":
                return out("inicio", detalle="sesión abierta")
            case "SessionEnd":
                self.sessions.pop(sid, None)
                return out("fin")
            case "UserPromptSubmit":
                s.started, s.actions, s.files = time.monotonic(), 0, set()
                return out("trabajando", detalle=f"«{clip(p.get('prompt'), 70)}»")
            case "PreToolUse":
                s.actions += 1
                args = p.get("tool_input") or {}
                if p.get("tool_name") in ("Edit", "MultiEdit", "Write", "NotebookEdit"):
                    s.files.add(str(args.get("file_path") or args.get("notebook_path") or ""))
                return out("trabajando", detalle=doing(str(p.get("tool_name")), args))
            case "PostToolUseFailure" if p.get("tool_name") in FAILS and not p.get("is_interrupt"):
                error = str(p.get("error") or "")
                lines = [ln for ln in error.splitlines()[1:] if ln.strip()] or [error]
                return out("fallo", detalle=clip(lines[-1], 120))
            case "Notification":
                kind, message = p.get("notification_type"), str(p.get("message") or "")
                if kind in ASKS or (kind is None and "permission" in message.lower()):
                    return out("necesita", detalle=clip(message, 120))
            case "Stop":
                return out("termino", resumen=str(p.get("last_assistant_message") or "")[:2000],
                           segundos=round(time.monotonic() - s.started), acciones=s.actions, archivos=len(s.files - {""}))
        return None

    def toggle(self, on: bool | None = None) -> bool:
        self.enabled = (not self.enabled) if on is None else on
        return self.enabled


async def ask(session: Session, question: str) -> str:
    """Claude's answer to a question about a session, read-only. Raises RuntimeError with a message for the user."""
    exe = shutil.which("claude")
    if not exe:
        raise RuntimeError("no encuentro el comando `claude` en el PATH")
    proc = await asyncio.create_subprocess_exec(
        exe, "-p", "--resume", session.id, "--fork-session", *READ_ONLY,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        cwd=session.cwd or None, env={**os.environ, RUN_ENV: "1"}, creationflags=0x0800_0000)
    try:
        out, err = await asyncio.wait_for(proc.communicate(question.encode()), ASK_S)
    except TimeoutError:
        proc.kill()
        raise RuntimeError(f"Claude tardó más de {ASK_S // 60} minutos y lo dejé") from None
    text = out.decode("utf-8", "replace").strip()
    if proc.returncode or not text:
        raise RuntimeError(clip(err.decode("utf-8", "replace") or "no contestó nada", 200))
    return text[:4000]
