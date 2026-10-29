"""His calendar, read-only, at most every CACHE_S seconds: an iCal address he gave (Google's secret one, Outlook.com,
iCloud...; only public hosts, every redirect checked too), a .ics file on this PC, or Outlook for Windows (the
classic one), which exports it itself. Authorized 25/10/2026 (Google) and 29/10/2026 (any iCal, Outlook)."""

import functools
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx
import icalendar
import recurring_ical_events

from app import power, settings, winalarm

CACHE_S = 15 * 60
DAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
_cache: dict[str, tuple[float, bytes]] = {}


@dataclass(frozen=True)
class Event:
    title: str
    start: datetime  # local time; all-day events start at midnight
    end: datetime
    all_day: bool
    place: str = ""

    def line(self) -> str:
        when = "todo el día" if self.all_day else f"{self.start:%H:%M}-{self.end:%H:%M}"
        where = f" ({self.place})" if self.place else ""
        return f"{self.start:%d/%m} {when}: {self.title}{where}"


MAX_BYTES = 30 * 1024 * 1024
POWERSHELL = winalarm.POWERSHELL
# Outlook's own iCal export of the default calendar, from a week ago to two months ahead
OUTLOOK = ("$o = New-Object -ComObject Outlook.Application; $f = $o.GetNamespace('MAPI').GetDefaultFolder(9); "
           "$e = $f.GetCalendarExporter(); $e.CalendarDetail = 1; $e.IncludeWholeCalendar = $false; "
           "$e.StartDate = (Get-Date).Date.AddDays(-7); $e.EndDate = (Get-Date).Date.AddDays(62); $e.SaveAsICal('{out}')")


def _run(cmd: list[str]) -> None:
    subprocess.run(cmd, capture_output=True, timeout=60, check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def _download(url: str) -> bytes:
    for _ in range(5):
        try:
            url = power.public(url)
        except power.ToolError as e:
            raise ValueError(str(e)) from e
        r = httpx.get(url, timeout=15, follow_redirects=False)
        if r.is_redirect:
            url = httpx.URL(url).join(r.headers["location"]).__str__()
            continue
        r.raise_for_status()
        if len(r.content) > MAX_BYTES:
            raise ValueError("el calendario es demasiado grande")
        return r.content
    raise ValueError("demasiadas redirecciones")


def _outlook(folder: Path, run: Callable[[list[str]], None]) -> bytes:
    out = folder / "outlook.ics"
    out.unlink(missing_ok=True)
    run([POWERSHELL, "-NoProfile", "-NonInteractive", "-Command", OUTLOOK.format(out=str(out).replace("'", "''"))])
    return out.read_bytes()


def fetch(source: str, now: float | None = None, folder: Path | None = None, run: Callable[[list[str]], None] = _run) -> bytes:
    """The calendar's iCal bytes; the same bytes object for CACHE_S (a file on this PC: until it changes)."""
    now = time.time() if now is None else now
    hit = _cache.get(source)
    if source != "outlook" and not source.lower().startswith("https://"):
        p = Path(source)
        key = f"{source}|{p.stat().st_mtime_ns}"
        if (hit := _cache.get(key)) is None:
            _cache[key] = hit = (now, p.read_bytes()[:MAX_BYTES])
        return hit[1]
    if hit and now - hit[0] < CACHE_S:
        return hit[1]
    data = _outlook(folder or settings.path().parent, run) if source == "outlook" else _download(source)
    _cache[source] = (now, data)
    return data


def _local(v: date | datetime) -> tuple[datetime, bool]:
    if isinstance(v, datetime):
        return (v.astimezone() if v.tzinfo else v).replace(tzinfo=None), False  # naive = already local
    return datetime(v.year, v.month, v.day), True


@functools.lru_cache(maxsize=2)
def _parsed(ics: bytes):
    """Parsing a real calendar (years of events, MBs) takes ~1 s; fetch() hands back the same bytes
    object for 15 minutes, so this runs once per download (bytes cache their own hash)."""
    return recurring_ical_events.of(icalendar.Calendar.from_ical(ics))


def events(ics: bytes, start: datetime, end: datetime) -> list[Event]:
    """Events overlapping [start, end) in local time, recurring ones expanded, sorted by start."""
    out = []
    for ev in _parsed(ics).between(start, end):
        s, all_day = _local(ev["DTSTART"].dt)
        e = _local(ev["DTEND"].dt)[0] if "DTEND" in ev else s + (timedelta(days=1) if all_day else timedelta(hours=1))
        out.append(Event(str(ev.get("SUMMARY", "(sin título)")), s, e, all_day, str(ev.get("LOCATION", ""))))
    return sorted(out, key=lambda e: e.start)


def due(evs: list[Event], now: datetime, lead_min: int, notified: set, grace_min: int = 0) -> list[Event]:
    """Timed events starting within the next `lead_min` minutes (or, with `grace_min`, that started
    that recently) not reminded yet. Marks them."""
    out = []
    for e in evs:
        key = (e.title, e.start)
        early, late = now - timedelta(minutes=grace_min), now + timedelta(minutes=lead_min)
        if not e.all_day and early <= e.start <= late and key not in notified:
            notified.add(key)
            out.append(e)
    return out
