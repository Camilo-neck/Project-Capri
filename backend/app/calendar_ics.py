"""Google Calendar through its secret iCal address (read-only). The one external call Capri makes,
authorized by the user: only calendar.google.com, only that URL, at most every CACHE_S seconds."""

import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import httpx
import icalendar
import recurring_ical_events

from app.settings import GOOGLE_ICAL

CACHE_S = 15 * 60
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


def fetch(url: str, now: float | None = None) -> bytes:
    if not GOOGLE_ICAL.match(url):
        raise ValueError("la URL del calendario no es de Google Calendar")
    now = time.time() if now is None else now
    hit = _cache.get(url)
    if hit and now - hit[0] < CACHE_S:
        return hit[1]
    r = httpx.get(url, timeout=15, follow_redirects=False)
    r.raise_for_status()
    _cache[url] = (now, r.content)
    return r.content


def _local(v: date | datetime) -> tuple[datetime, bool]:
    if isinstance(v, datetime):
        return (v.astimezone() if v.tzinfo else v).replace(tzinfo=None), False  # naive = already local
    return datetime(v.year, v.month, v.day), True


def events(ics: bytes, start: datetime, end: datetime) -> list[Event]:
    """Events overlapping [start, end) in local time, recurring ones expanded, sorted by start."""
    cal = icalendar.Calendar.from_ical(ics)
    out = []
    for ev in recurring_ical_events.of(cal).between(start, end):
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
