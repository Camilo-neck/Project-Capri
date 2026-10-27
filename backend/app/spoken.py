"""What was said, as Capri understands it: the wake phrase ("hey Capri", "oye Capri"...) and spoken
commands in Spanish or English, turned into the slash commands she already has. Pure functions."""

import re
import unicodedata
from difflib import SequenceMatcher

NAME = "capri"
GREETINGS = {"hey", "hei", "ey", "eh", "oye", "oiga", "ok", "okay", "hola", "hi", "hello", "yo", "buenas"}
_ARTICLE = re.compile(r"^(?:the|a|la|el)\s+")


def plain(text: str) -> str:
    """Lowercase, no accents or punctuation (apostrophes stay): comparing what a speech model wrote."""
    t = unicodedata.normalize("NFD", text.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(re.sub(r"[^\w\s']", " ", t).replace("_", " ").split())


def _is_name(word: str) -> bool:
    return SequenceMatcher(None, word, NAME).ratio() >= 0.74 or word in {"kapri", "capri", "cabri", "capry"}


def strip_wake(text: str) -> tuple[bool, str]:
    """(called, what is left): "Hey Capri, abre Spotify" -> (True, "abre Spotify"). The name has to be
    first, or right after a greeting: Capri mentioned mid-sentence doesn't wake her."""
    words = text.strip().split()
    for take in (1, 2):  # "capri ..." or "hey capri ..."
        if len(words) < take:
            continue
        head = [plain(w) for w in words[:take]]
        if "".join(head) == "":
            continue
        if take == 1 and _is_name(head[0]):
            return True, " ".join(words[1:]).lstrip(" ,.;:!?¡¿-")
        if take == 2 and head[0] in GREETINGS and _is_name(head[1]):
            return True, " ".join(words[2:]).lstrip(" ,.;:!?¡¿-")
    return False, text


# spoken phrase (plain text) -> slash command, whole utterance. "{}" takes the rest.
_EXACT: list[tuple[str, str]] = [
    (r"escondete|ocultate|desaparece|hide|hide yourself|go away", "/escondete"),
    (r"vuelve|sal|aparece|ven|come back|come out|show yourself|show up", "/vuelve"),
    (r"cierrate|cierra capri|apagate|close capri|close yourself|quit capri|shut down capri|goodbye capri", "/cierra"),
    (r"no molestes|no me molestes|no molestar|modo no molestar|do not disturb|don't disturb me|dont disturb me|dnd", "/nomolestes"),
    (r"olvida todo|olvidalo todo|forget everything|forget it all|forget all", "/olvida todo"),
    (r"mira la pantalla|mira mi pantalla|mira esto|que ves|que hay en pantalla|look at the screen|look at my screen|what do you see|what's on my screen|whats on my screen", "/mira"),
    (r"modo claude (?:on|off)", "/claude {}"),
]
_PREFIX: list[tuple[str, str]] = [
    (r"(?:olvida|olvidate de|forget(?: about)?)\s+(?:que\s+|that\s+)?(.+)", "/olvida {}"),
    (r"(?:preguntale a claude|pregunta a claude|ask claude)\s+(.+)", "/claude {}"),
]
# asking her to look, said any way: a look verb first and the screen anywhere, or "mira lo que / esto"
_LOOK = re.compile(r"^(?:oye |hey )?(?:mira|mirame|miremos|ve|observa|fijate|checa|chequea|revisa|dime que|que ves|que hay|look|check|see|tell me what|what)\b")
_SCREEN = re.compile(r"\b(?:pantalla|screen|monitor)\b")
_THIS = re.compile(r"^(?:mira|look at|check out) (?:lo que|esto|this|what)\b")
# the slash commands typed in English
ALIASES = {"/hide": "/escondete", "/show": "/vuelve", "/back": "/vuelve", "/quit": "/cierra", "/look": "/mira",
           "/forget": "/olvida", "/dnd": "/nomolestes"}


def to_command(text: str) -> str:
    """A spoken command as its slash command; anything else comes back untouched (it's chat)."""
    p = plain(text)
    for pattern, cmd in _EXACT:
        m = re.fullmatch(pattern, p)
        if m:
            return cmd.format(p.split()[-1]) if "{}" in cmd else cmd
    if (_LOOK.search(p) and _SCREEN.search(p)) or _THIS.search(p):
        return f"/mira {text.strip()}"  # the whole sentence is her question about it
    for pattern, cmd in _PREFIX:
        m = re.fullmatch(pattern, p)
        if m:
            rest = m.group(1)
            if cmd.startswith("/olvida") and rest in {"todo", "everything", "all", "it all"}:
                return "/olvida todo"
            words = text.split()  # the rest as it was said (accents, case), not as it was compared
            return cmd.format(" ".join(words[len(words) - len(rest.split()):]).strip(" ,.;:!?"))
    return text.strip()


def alias(text: str) -> str:
    """A slash command typed in English -> the Spanish one the rest of the code knows."""
    head, _, rest = text.strip().partition(" ")
    cmd = ALIASES.get(head.lower())
    return f"{cmd} {rest}".strip() if cmd else text
