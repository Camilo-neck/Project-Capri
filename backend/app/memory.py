"""Capri's long-term memory: SQLite + FTS5 next to the user's config (memoria.db).

- recuerdos: durable preferences and facts, searched with FTS5 (accent-insensitive).
- mensajes / sesiones: every conversation as it happens, and a summary per session.
"""

import re
import sqlite3
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path

from app import settings

SCHEMA = """
create table if not exists recuerdos (
  id integer primary key,
  texto text not null unique,
  tipo text not null check (tipo in ('preferencia', 'hecho')),
  creado text not null
);
create virtual table if not exists recuerdos_fts using fts5(
  texto, content='recuerdos', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
create trigger if not exists recuerdos_ai after insert on recuerdos begin
  insert into recuerdos_fts(rowid, texto) values (new.id, new.texto);
end;
create trigger if not exists recuerdos_ad after delete on recuerdos begin
  insert into recuerdos_fts(recuerdos_fts, rowid, texto) values ('delete', old.id, old.texto);
end;
create table if not exists sesiones (id integer primary key, inicio text not null, resumen text);
create table if not exists estado (clave text primary key, valor text not null);
create table if not exists mensajes (
  id integer primary key,
  sesion integer not null references sesiones(id) on delete cascade,
  rol text not null,
  contenido text not null
);
"""

BUDGET = 1200  # chars of memory injected per turn (~300 tokens)
MAX_FACTS = 5
# a fact about "today" stops being true tomorrow
RELATIVE = re.compile(r"\b(hoy|mañana|ahorita|esta (noche|tarde|mañana|semana)|today|tomorrow|tonight|this (morning|afternoon|evening|week))\b", re.IGNORECASE)


# words that say nothing about what a message is about ("que", "por", "the"...), folded
STOPWORDS = set(
    "que por para con los las del una uno unos unas como mas pero sus esta este esto eso esa ese hay ser fue era "
    "muy algo todo toda todos nada cuando donde quien cual porque pues tambien solo hoy ayer manana ahora luego "
    "tengo tiene tienes quiero puedes puedo dime hola gracias favor porfa vale bueno usuario capri "
    "the and for you your with this that what are was have has can not but from about please".split())


def words(text: str) -> list[str]:
    """Search terms: words of 3+ letters."""
    return [w for w in re.findall(r"\w+", text.lower()) if len(w) >= 3]


def content_words(text: str) -> set[str]:
    """The words that say what `text` is about: folded, 3+ letters, no stopwords."""
    return {w for w in re.findall(r"\w+", fold(text)) if len(w) >= 3 and w not in STOPWORDS}


def fold(text: str) -> str:
    """Lowercase without accents, to match like FTS5's remove_diacritics."""
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")


class Memory:
    def __init__(self, path: Path | str | None = None):
        path = path or settings.path().parent / "memoria.db"
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("pragma foreign_keys = on")
        self.db.executescript(SCHEMA)

    # ---- facts ----

    def remember(self, texto: str, tipo: str = "hecho") -> None:
        with self.db:
            self.db.execute(
                "insert or ignore into recuerdos (texto, tipo, creado) values (?, ?, ?)",
                (texto.strip(), tipo, datetime.now().isoformat(timespec="seconds")),
            )

    def search(self, query: str, limit: int = MAX_FACTS) -> list[tuple[int, str, str]]:
        """(id, texto, tipo) of the facts that best match `query`: all its words if any fact has them, else any.
        Words that say nothing ("por", "que") are left out: "por favor" brought up "va al gimnasio por las tardes"."""
        terms = sorted(content_words(query))
        if not terms:
            return []
        quoted = ['"' + t.replace('"', "") + '"' for t in terms]
        for match in dict.fromkeys((" AND ".join(quoted), " OR ".join(quoted))):
            rows = self.db.execute(
                "select r.id, r.texto, r.tipo from recuerdos_fts f join recuerdos r on r.id = f.rowid "
                "where recuerdos_fts match ? order by bm25(recuerdos_fts) limit ?",
                (match, limit),
            ).fetchall()
            if rows:
                return rows
        return []

    def preferences(self) -> list[str]:
        return [t for (t,) in self.db.execute("select texto from recuerdos where tipo = 'preferencia' order by id")]

    def forget(self, ids: list[int]) -> None:
        with self.db:
            self.db.executemany("delete from recuerdos where id = ?", [(i,) for i in ids])

    def forget_all(self) -> None:
        """Every fact, summary and stored message."""
        with self.db:
            self.db.execute("delete from recuerdos")
            self.db.execute("delete from mensajes")
            self.db.execute("update sesiones set resumen = null")

    def mentioning(self, terms: set[str]) -> tuple[list[int], list[int]]:
        """Ids of the stored messages and of the sessions whose summary say any of `terms` (folded whole words)."""
        says = lambda text: bool(terms & set(re.findall(r"\w+", fold(text))))  # noqa: E731
        msgs = [i for i, c in self.db.execute("select id, contenido from mensajes") if says(c)]
        sums = [i for i, r in self.db.execute("select id, resumen from sesiones where resumen != ''") if says(r)]
        return msgs, sums

    def scrub(self, terms: set[str]) -> None:
        """Drops stored messages and summaries mentioning any of `terms`, so a forgotten fact can't come back."""
        msgs, sums = self.mentioning(terms)
        with self.db:
            self.db.executemany("delete from mensajes where id = ?", [(i,) for i in msgs])
            self.db.executemany("update sesiones set resumen = '' where id = ?", [(i,) for i in sums])  # '' = nothing to keep

    # ---- sessions ----

    def new_session(self) -> int:
        with self.db:
            return self.db.execute("insert into sesiones (inicio) values (?)", (datetime.now().isoformat(timespec="seconds"),)).lastrowid

    def log(self, session: int, rol: str, contenido: str) -> None:
        with self.db:
            self.db.execute("insert into mensajes (sesion, rol, contenido) values (?, ?, ?)", (session, rol, contenido))

    def set_summary(self, session: int, resumen: str) -> None:
        with self.db:
            self.db.execute("update sesiones set resumen = ? where id = ?", (resumen, session))

    def last_summary(self, before: int) -> str | None:
        row = self.db.execute(
            "select resumen from sesiones where id < ? and resumen is not null and resumen != '' order by id desc limit 1",
            (before,),
        ).fetchone()
        return row[0] if row else None

    def recent_tail(self, before: int, hours: float, n: int) -> list[dict]:
        """The last turns of the previous session if it started less than `hours` ago (a restart mid-talk)."""
        row = self.db.execute("select id, inicio from sesiones where id < ? order by id desc limit 1", (before,)).fetchone()
        if not row or datetime.now() - datetime.fromisoformat(row[1]) > timedelta(hours=hours):
            return []
        msgs = [{"role": r, "content": c} for r, c in
                self.db.execute("select rol, contenido from mensajes where sesion = ? order by id desc limit ?", (row[0], n))][::-1]
        while msgs and (msgs[0]["role"] != "user" or msgs[0]["content"].startswith("[")):
            msgs.pop(0)  # start where he spoke
        return msgs

    def unsummarized(self, before: int) -> list[tuple[int, list[tuple[str, str]]]]:
        """Earlier sessions with messages but no summary yet (the app closed mid-session)."""
        out = []
        for (sid,) in self.db.execute("select id from sesiones where id < ? and resumen is null", (before,)).fetchall():
            msgs = self.db.execute("select rol, contenido from mensajes where sesion = ? order by id", (sid,)).fetchall()
            if msgs:
                out.append((sid, msgs))
            else:
                self.set_summary(sid, "")  # nothing to summarize
        return out

    # ---- small state that must survive a restart (e.g. the day she last greeted) ----

    def get(self, key: str) -> str | None:
        row = self.db.execute("select valor from estado where clave = ?", (key,)).fetchone()
        return row[0] if row else None

    def put(self, key: str, value: str) -> None:
        with self.db:
            self.db.execute("insert or replace into estado (clave, valor) values (?, ?)", (key, value))

    # ---- what goes into the prompt ----

    def context(self, query: str, session: int, running: str = "", first: bool = False, own: bool = False) -> str:
        """The memory block for this turn: preferences, related facts and summaries, within BUDGET.
        The last conversation only on his `first` message of this one or when he brings it up, never on
        her `own` turns: always there, she kept going back to it."""
        today = datetime.now().date().isoformat()

        def dated(ids: list[int]) -> list[str]:
            """Dated, and a "hoy" or "mañana" noted another day is left out: it already passed."""
            rows = {i: (t, c) for i, t, c in self.db.execute(
                f"select id, texto, creado from recuerdos where id in ({','.join('?' * len(ids))})", ids)}
            pairs = [rows[i] for i in dict.fromkeys(ids) if i in rows]  # in the order given: the best match first
            return [f"- {t} (anotado el {c[8:10]}/{c[5:7]})" for t, c in pairs if c[:10] == today or not RELATIVE.search(t)]

        # Most important first, since what doesn't fit is cut from the end: this conversation, what he
        # likes and the facts that match, then the last conversation.
        parts = [f"Antes en esta conversación: {running}"] if running else []
        prefs = [i for (i,) in self.db.execute("select id from recuerdos where tipo = 'preferencia' order by id")]
        lines = dated(prefs + [i for i, _, tipo in self.search(query) if tipo == "hecho"])
        if lines:
            parts.append("Lo que recuerdas del usuario:\n" + "\n".join(lines))
        previous = None if own else self.last_summary(session)
        # ponytail: a 5-letter prefix as the stem ("disfraz" ~ "disfraces"); FTS over summaries if it falls short
        stems = lambda t: {w[:5] for w in content_words(t)}  # noqa: E731
        if previous and (first or stems(query) & stems(previous)):
            when = self.db.execute("select inicio from sesiones where resumen = ? order by id desc", (previous,)).fetchone()[0]
            parts.append(f"Vuestra última conversación, el {when[8:10]}/{when[5:7]} (ya pasó: no la retomes si él no la saca): {previous}")
        block = "\n".join(parts)
        return block if len(block) <= BUDGET else block[:BUDGET].rsplit("\n", 1)[0]
