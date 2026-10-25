"""User settings in %APPDATA%\\Capri\\config.toml: allowlists for tools and the calendar.

Read on every use, so edits apply without a restart. Created from config.example.toml if missing.
"""

import os
import re
import tomllib
from dataclasses import dataclass, field
from datetime import datetime, time
from pathlib import Path

DIR = Path(os.environ.get("APPDATA", Path.home())) / "Capri"
EXAMPLE = Path(__file__).parent / "config.example.toml"
GOOGLE_ICAL = re.compile(r"^https://calendar\.google\.com/calendar/ical/[^\s\"']+\.ics$")


@dataclass
class Settings:
    apps: dict[str, str] = field(default_factory=dict)  # name -> program or path
    search_roots: list[Path] = field(default_factory=list)
    scripts: dict[str, str] = field(default_factory=dict)  # name -> path
    calendar_url: str = ""
    remind_minutes: int = 10
    proactive: bool = True
    proactive_per_hour: int = 2
    idle_hours: float = 2
    quiet: tuple[time, time] | None = (time(23), time(8))  # no chatter from..to (may wrap midnight)

    def quiet_now(self, now: datetime) -> bool:
        if not self.quiet:
            return False
        start, end, t = *self.quiet, now.time()
        return start <= t < end if start < end else t >= start or t < end


def parse_quiet(text: str) -> tuple[time, time] | None:
    """"23:00-08:00" -> (23:00, 08:00); "" -> None."""
    if not text.strip():
        return None
    a, b = (time.fromisoformat(part.strip().zfill(5)) for part in text.split("-"))
    return a, b


def path() -> Path:
    return Path(os.environ.get("CAPRI_CONFIG", DIR / "config.toml"))


def load() -> Settings:
    p = path()
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
    data = tomllib.loads(p.read_text(encoding="utf-8"))
    cal = data.get("calendario", {})
    pro = data.get("proactividad", {})
    return Settings(
        apps={k.lower(): v for k, v in data.get("apps", {}).items()},
        search_roots=[Path(r).expanduser() for r in data.get("rutas", {}).get("buscar", [])],
        scripts={k.lower(): v for k, v in data.get("scripts", {}).items()},
        calendar_url=cal.get("url", ""),
        remind_minutes=int(cal.get("aviso_minutos", 10)),
        proactive=bool(pro.get("activa", True)),
        proactive_per_hour=int(pro.get("max_por_hora", 2)),
        idle_hours=float(pro.get("inactividad_horas", 2)),
        quiet=parse_quiet(pro.get("silencio", "23:00-08:00")),
    )


def save_calendar_url(url: str) -> None:
    """Writes [calendario] url, keeping the rest of the file (and its comments) as it is."""
    if not GOOGLE_ICAL.match(url):
        raise ValueError("no es una dirección secreta de Google Calendar en formato iCal")
    load()  # creates the file if needed
    p = path()
    text = p.read_text(encoding="utf-8")
    line = f'url = "{url}"'
    if re.search(r"^\[calendario\]", text, re.M):
        if re.search(r"^url\s*=.*$", text, re.M):
            text = re.sub(r"^url\s*=.*$", lambda _: line, text, count=1, flags=re.M)
        else:
            text = re.sub(r"^\[calendario\]\s*$", lambda m: f"{m.group(0)}\n{line}", text, count=1, flags=re.M)
    else:
        text = text.rstrip() + f"\n\n[calendario]\n{line}\n"
    p.write_text(text, encoding="utf-8")
