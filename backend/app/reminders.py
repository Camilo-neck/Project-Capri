"""Reminders he asks for ("recuérdame en 20 min sacar la ropa", "remind me at 6pm to call mom"). When
is read straight off his words, in Spanish or English, never worked out by the model (a small one gets
the arithmetic wrong): she only writes what to remind. Kept in memoria.db, so they survive a restart."""

import re
import unicodedata
from datetime import datetime, timedelta

NUMBERS = {"un": 1, "una": 1, "uno": 1, "a": 1, "an": 1, "one": 1, "dos": 2, "two": 2, "tres": 3, "three": 3,
           "cuatro": 4, "four": 4, "cinco": 5, "five": 5, "diez": 10, "ten": 10, "quince": 15, "fifteen": 15,
           "veinte": 20, "twenty": 20, "treinta": 30, "thirty": 30, "cuarenta": 40, "forty": 40,
           "cincuenta": 50, "fifty": 50}
NUM = r"(\d+(?:[.,]\d+)?|" + "|".join(sorted(NUMBERS, key=len, reverse=True)) + ")"
UNIT = r"(segundos?|seconds?|secs?|minutos?|minutes?|mins?|m|horas?|hours?|hrs?|h)"
SOON = r"\b(?:en|dentro de|in)\s+"
IN = re.compile(SOON + NUM + r"\s*" + UNIT + r"\b(?:\s*(?:y|and)?\s*" + NUM + r"\s*" + UNIT + r"\b)?")
IN_HM = re.compile(SOON + r"(\d{1,2})\s*h\s*(\d{1,2})\b")  # "en 1h30"
IN_PART = re.compile(SOON + r"(?:una |un |a |an )?(media hora|half an hour|cuarto de hora|quarter of an hour)")
AT = re.compile(r"\b(?:a las|a la|para las|at)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*(a\.?m\.?|p\.?m\.?))?"
                r"(?:\s+de la (manana|tarde|noche|madrugada))?(?![\d:])")
AT_BARE = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b")  # "6pm", "6:45 pm"
NOON = re.compile(r"\b(?:mediodia|noon)\b")
MIDNIGHT = re.compile(r"\b(?:medianoche|midnight)\b")
AFTER_TOMORROW = re.compile(r"\bpasado manana\b|\bthe day after tomorrow\b")
# "en el PC", "alarma de Windows", "aunque cierres Capri": the alarm goes to Windows (winalarm), not to her
ON_PC = re.compile(r"\b(?:en|on|in) (?:el |mi |my |the )?(?:pc|computador|computadora|ordenador|windows|laptop|portatil)\b"
                   r"|\balarmas? de windows\b|\bwindows alarm|\baunque (?:te )?cierr|\beven if (?:you'?re |you are )?closed")
TOMORROW = re.compile(r"(?<!de la )\bmanana\b|\btomorrow\b")


def on_pc(text: str) -> bool:
    """He wants it on Windows itself (rings with Capri closed), by his own words."""
    return bool(ON_PC.search(fold(text)))


def fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")


def number(word: str) -> float:
    return NUMBERS[word] if word in NUMBERS else float(word.replace(",", "."))


def span(n: str, unit: str) -> timedelta:
    v = number(n)
    if unit.startswith(("h", "hora")):
        return timedelta(hours=v)
    if unit.startswith(("s", "seg")):
        return timedelta(seconds=v)
    return timedelta(minutes=v)


def when(text: str, now: datetime) -> datetime | None:
    """When his message says, or None if it doesn't say (then she asks)."""
    t = fold(text)
    if m := IN_HM.search(t):
        return now + timedelta(hours=int(m[1]), minutes=int(m[2]))
    if m := IN_PART.search(t):
        return now + timedelta(minutes=30 if m[1] in ("media hora", "half an hour") else 15)
    if m := IN.search(t):
        return now + span(m[1], m[2]) + (span(m[3], m[4]) if m[3] else timedelta())
    days = 2 if AFTER_TOMORROW.search(t) else 1 if TOMORROW.search(t) else 0
    meridiem = None
    if NOON.search(t):
        hour, minute, meridiem = 12, 0, "fixed"
    elif MIDNIGHT.search(t):
        hour, minute, meridiem = 0, 0, "fixed"
    elif m := AT.search(t) or AT_BARE.search(t):
        hour, minute = int(m[1]), int(m[2] or 0)
        part = m[3] or (m[4] if m.re is AT else None)
        if part:
            meridiem = "pm" if part.startswith("p") or part in ("tarde", "noche") else "am"
    else:
        return None
    if hour > 23 or minute > 59:
        return None
    if meridiem == "pm" and hour < 12:
        hour += 12
    elif meridiem == "am" and hour == 12:
        hour = 0
    day = (now + timedelta(days=days)).replace(hour=hour, minute=minute, second=0, microsecond=0)
    if days:
        return day
    if day <= now and meridiem is None and hour < 12 and day + timedelta(hours=12) > now:
        return day + timedelta(hours=12)  # "a las 6" at 3 pm: this evening
    return day if day > now else day + timedelta(days=1)


from app.calendar_ics import DAYS


def said_when(at: datetime, now: datetime) -> str:
    """"hoy a las 15:30", "mañana a las 9:00", "el jueves 30/10 a las 8:00"."""
    hour = f"a las {at.hour}:{at.minute:02d}"
    days = (at.date() - now.date()).days
    if days == 0:
        return f"hoy {hour}"
    if days == 1:
        return f"mañana {hour}"
    return f"el {DAYS[at.weekday()]} {at:%d/%m} {hour}"


class Alarms:
    """The reminders, in memoria.db: pending until said (or done, or cancelled)."""

    def __init__(self, db):
        self.db = db
        with db:
            db.execute("create table if not exists recordatorios (id integer primary key, texto text not null, "
                       "cuando text not null, estado text not null default 'pendiente')")
            if "donde" not in {r[1] for r in db.execute("pragma table_info(recordatorios)")}:
                db.execute("alter table recordatorios add column donde text not null default 'capri'")  # capri | windows

    def add(self, texto: str, at: datetime, donde: str = "capri") -> int:
        with self.db:
            return self.db.execute("insert into recordatorios (texto, cuando, donde) values (?, ?, ?)",
                                   (texto.strip(), at.isoformat(timespec="seconds"), donde)).lastrowid

    def pending(self, donde: str = "capri") -> list[tuple[int, str, datetime]]:
        """Hers (she says them), or with donde="windows" the alarms Windows rings."""
        rows = self.db.execute("select id, texto, cuando from recordatorios where estado = 'pendiente' and donde = ? "
                               "order by cuando, id", (donde,))
        return [(i, t, datetime.fromisoformat(c)) for i, t, c in rows]

    def on_windows(self, now: datetime | None = None) -> list[tuple[int, str, datetime]]:
        """The Windows alarms still to ring (ones already past are marked rung)."""
        alarms = self.pending("windows")
        for rid, _, at in alarms:
            if now and at <= now:
                self.set(rid, "dicho")
        return [a for a in alarms if not now or a[2] > now]

    def due(self, now: datetime) -> list[tuple[int, str, datetime]]:
        return [r for r in self.pending() if r[2] <= now]

    def set(self, id: int, estado: str, at: datetime | None = None) -> None:
        """estado: pendiente (again, at `at`: snoozed), dicho, hecho or cancelado."""
        with self.db:
            if at:
                self.db.execute("update recordatorios set estado = ?, cuando = ? where id = ?", (estado, at.isoformat(timespec="seconds"), id))
            else:
                self.db.execute("update recordatorios set estado = ? where id = ?", (estado, id))
