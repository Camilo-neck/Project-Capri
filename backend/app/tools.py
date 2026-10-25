"""Tools Capri can ask for through `accion`. Each has a pydantic model for its args and is either
safe (runs at once) or has effects (runs only after the user confirms with a click in the UI).
Everything they touch is allowlisted in the user's config (app/settings.py)."""

import json
import os
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal

import pyperclip
from pydantic import BaseModel, Field

from app import calendar_ics, settings
from app.settings import Settings

MAX_RESULTS = 20
MAX_SCANNED = 20_000  # files looked at per search
MAX_TEXT = 1500  # chars of tool output handed to the model

SETUP_STEPS = (
    "El calendario no está configurado. Pasos para el usuario: en calendar.google.com, Configuración (rueda "
    "dentada) > en la izquierda, su calendario > 'Integrar el calendario' > copiar la 'Dirección secreta en "
    "formato iCal' y pegarla en el chat. Con esa URL puedes pedir la acción configurar_calendario."
)


class NoArgs(BaseModel):
    pass


class AppArgs(BaseModel):
    nombre: str


class SearchArgs(BaseModel):
    texto: str = Field(min_length=2)


class TextArgs(BaseModel):
    texto: str = Field(max_length=10_000)


class ScriptArgs(BaseModel):
    nombre: str


class CalendarArgs(BaseModel):
    dias: int = Field(default=1, ge=1, le=14)


class CalendarUrlArgs(BaseModel):
    url: str


class RememberArgs(BaseModel):
    texto: str = Field(min_length=3, max_length=300)
    tipo: Literal["preferencia", "hecho"] = "hecho"


class ForgetArgs(BaseModel):
    texto: str = Field(min_length=2)


@dataclass(frozen=True)
class Tool:
    args: type[BaseModel]
    effect: bool
    run: Callable[[BaseModel, Settings], str] | None  # None: the orchestrator runs it (memory tools)
    describe: Callable[[BaseModel], str] = lambda a: ""  # what the confirmation asks (effects only)


class ToolError(Exception):
    """A refusal or failure to tell the model about (not a crash)."""


def open_app(a: AppArgs, s: Settings) -> str:
    target = s.apps.get(a.nombre.lower())
    if not target:
        raise ToolError(f"'{a.nombre}' no está en la lista de apps permitidas: {', '.join(s.apps) or 'ninguna'}")
    os.startfile(target)  # noqa: S606  (allowlisted)
    return f"Abrí {a.nombre}."


def search_files(a: SearchArgs, s: Settings) -> str:
    if not s.search_roots:
        raise ToolError("no hay carpetas de búsqueda configuradas")
    needle, found, scanned = a.texto.lower(), [], 0
    for root in s.search_roots:
        for folder, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for f in files:
                scanned += 1
                if needle in f.lower():
                    found.append(str(Path(folder) / f))
                if len(found) >= MAX_RESULTS or scanned >= MAX_SCANNED:
                    break
            if len(found) >= MAX_RESULTS or scanned >= MAX_SCANNED:
                break
    return "\n".join(found) if found else f"Ningún archivo con '{a.texto}' en {', '.join(map(str, s.search_roots))}."


def read_clipboard(a: NoArgs, s: Settings) -> str:
    return pyperclip.paste() or "(el portapapeles está vacío o no tiene texto)"


def copy_text(a: TextArgs, s: Settings) -> str:
    pyperclip.copy(a.texto)
    return "Copiado al portapapeles."


def run_script(a: ScriptArgs, s: Settings) -> str:
    target = s.scripts.get(a.nombre.lower())
    if not target:
        raise ToolError(f"'{a.nombre}' no está en la lista de scripts permitidos: {', '.join(s.scripts) or 'ninguno'}")
    ext = Path(target).suffix.lower()
    cmd = {
        ".ps1": ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", target],
        ".bat": ["cmd", "/c", target],
        ".cmd": ["cmd", "/c", target],
        ".py": [sys.executable, target],
    }.get(ext, [target])
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=120, creationflags=0x0800_0000)
    out = (done.stdout + done.stderr).strip() or "(sin salida)"
    return f"Terminó con código {done.returncode}.\n{out}"


def calendar(a: CalendarArgs, s: Settings) -> str:
    if not s.calendar_url:
        return SETUP_STEPS
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    evs = calendar_ics.events(calendar_ics.fetch(s.calendar_url), start, start + timedelta(days=a.dias))
    return "\n".join(e.line() for e in evs) or "No hay eventos en esos días."


def configure_calendar(a: CalendarUrlArgs, s: Settings) -> str:
    try:
        settings.save_calendar_url(a.url.strip())
    except ValueError as e:
        raise ToolError(str(e)) from e
    return "Calendario configurado. Ya puedes consultarlo."


TOOLS: dict[str, Tool] = {
    "abrir_app": Tool(AppArgs, True, open_app, lambda a: f"Abrir {a.nombre}"),
    "buscar_archivos": Tool(SearchArgs, False, search_files),
    "leer_portapapeles": Tool(NoArgs, False, read_clipboard),
    "copiar_al_portapapeles": Tool(TextArgs, True, copy_text,
                                   lambda a: f"Copiar al portapapeles: «{a.texto[:80]}{'…' if len(a.texto) > 80 else ''}»"),
    "ejecutar_script": Tool(ScriptArgs, True, run_script, lambda a: f"Ejecutar el script «{a.nombre}»"),
    "calendario": Tool(CalendarArgs, False, calendar),
    "configurar_calendario": Tool(CalendarUrlArgs, True, configure_calendar, lambda a: "Guardar la dirección de tu calendario"),
    # Memory: they need the memory store and the avatar, so the orchestrator runs them. Forgetting
    # deletes, so it confirms (with the list of what goes) like any action with effects.
    "recordar": Tool(RememberArgs, False, None),
    "olvidar": Tool(ForgetArgs, True, None),
}

ToolName = Literal[tuple(TOOLS)]  # type: ignore[valid-type]  # the grammar only lets the model pick these


def audit(entry: dict) -> None:
    """Every action with effects: what was asked, what the user answered, what happened."""
    p = settings.path().parent / "audit.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"at": datetime.now().isoformat(timespec="seconds"), **entry}, ensure_ascii=False) + "\n")


def clip(text: str) -> str:
    return text if len(text) <= MAX_TEXT else text[:MAX_TEXT] + "…"
