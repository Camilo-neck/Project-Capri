"""Her commands, from the one list in commands.json (the avatar reads the same file): typed in any case, with or
without accents, in Spanish or English, and the help that lists them."""

import json
import unicodedata
from pathlib import Path

_DATA = json.loads((Path(__file__).with_name("commands.json")).read_text(encoding="utf-8"))
GROUPS: list[str] = _DATA["grupos"]
COMMANDS: list[dict] = _DATA["comandos"]
EVERYTHING = {"todo", "everything", "all", "it all"}


def _fold(word: str) -> str:
    t = unicodedata.normalize("NFD", word.lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


_NAMES = {_fold(w): c["nombre"] for c in COMMANDS for w in [c["nombre"], *c["alias"]]}


def canonical(text: str) -> str:
    """"/Escóndete", "/DND on", "/forget everything" -> "/escondete", "/nomolestes on", "/olvida todo". Anything
    that isn't one of her commands comes back untouched."""
    head, _, rest = text.strip().partition(" ")
    name = _NAMES.get(_fold(head))
    if name is None:
        return text
    rest = rest.strip()
    if name == "/olvida" and _fold(rest) in EVERYTHING:
        rest = "todo"
    return f"{name} {rest}".strip()


def spoken() -> list[tuple[str, str]]:
    """(sentence as said, what it does) for every whole spoken command."""
    return [(phrase, v["hace"]) for c in COMMANDS for v in c["voz"] for phrase in v["dice"]]


def help_text(topic: str = "") -> str:
    """/ayuda [grupo]: her commands by group, or what to say to her ("voz"). Lines starting with "•" or "/" are for
    reading, not said aloud (speech.clean)."""
    t = _fold(topic.strip())
    groups = {_fold(g): g for g in GROUPS}
    if t in ("voz", "voice"):
        lines = ["Lo que me puedes decir, en español o inglés, llamándome por mi nombre o con el atajo de escuchar:"]
        for g in GROUPS:
            said = [f"«{p}»" for c in COMMANDS if c["grupo"] == g
                    for p in [*(p for v in c["voz"] for p in v["dice"][:2]), *c.get("voz_ejemplos", [])]]
            if said:
                lines.append(f"• {g}: {', '.join(said)}")
        return "\n".join(lines)
    if t and t not in groups:
        return f"No tengo un grupo «{topic.strip()}». Prueba con: {', '.join(groups)} o voz."
    shown = [groups[t]] if t else GROUPS
    lines = ["Mis comandos (en inglés también valen; «/ayuda voz» para lo que me puedes decir):"]
    for g in shown:
        lines.append(f"• {g}")
        for c in (c for c in COMMANDS if c["grupo"] == g):
            names = " ".join([c["nombre"], c["args"]]).strip()
            alias = f" ({', '.join(c['alias'])})" if c["alias"] else ""
            lines.append(f"{names}{alias}: {c['descripcion'].replace('. ', '; ')}")  # one line, one sentence
    return "\n".join(lines)
