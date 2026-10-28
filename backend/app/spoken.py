"""What was said, as Capri understands it: the wake phrase ("hey Capri", "oye Capri"...) and spoken
commands in Spanish or English, turned into the slash commands she already has. Pure functions."""

import re
import unicodedata
from collections.abc import Sequence
from difflib import SequenceMatcher

NAME = "capri"
GREETINGS = {"hey", "hei", "ey", "eh", "oye", "oiga", "ok", "okay", "okey", "oki", "hola", "hi", "hello", "yo", "buenas",
             "bueno", "ay", "ah", "ehh", "mmm", "psst", "pss"}
_ARTICLE = re.compile(r"^(?:the|a|la|el)\s+")


def plain(text: str) -> str:
    """Lowercase, no accents or punctuation (apostrophes stay): comparing what a speech model wrote."""
    t = unicodedata.normalize("NFD", text.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(re.sub(r"[^\w\s']", " ", t).replace("_", " ").split())


def is_name(word: str, names: Sequence[str] = (NAME,)) -> bool:
    """A word (plain) that is one of her names as a speech model may write it ("Kapri", "Capry"...)."""
    return any(SequenceMatcher(None, word, n).ratio() >= 0.78 for n in names) or (NAME in names and word in {"kapri", "capri", "cabri", "capry"})


def strip_wake(text: str, names: Sequence[str] = (NAME,)) -> tuple[bool, str]:
    """(called, what is left): "Hey Capri, abre Spotify" -> (True, "abre Spotify"), "abre Spotify, Capri" ->
    (True, "abre Spotify"). The name has to be first (after a greeting or two: "eh, hey Capri") or last:
    Capri mentioned mid-sentence is talk about her, and doesn't wake her."""
    words = text.strip().split()
    for i, head in enumerate(plain(w) for w in words[:3]):
        if is_name(head, names):
            return True, " ".join(words[i + 1:]).lstrip(" ,.;:!?¡¿-")
        if head and head not in GREETINGS:
            break
    if words and is_name(plain(words[-1]), names):
        return True, " ".join(words[:-1]).rstrip(" ,.;:!?¡¿-")
    return False, text


# words a sentence doesn't end on: cut there, it was a pause, not the end ("pon algo de… bad bunny")
_HANGING = {"y", "de", "del", "que", "la", "el", "los", "las", "en", "a", "al", "con", "pon", "abre", "busca", "para", "por",
            "un", "una", "the", "and", "to", "of", "play", "open"}


def dangling(text: str) -> bool:
    """A sentence left hanging: it ends on "…", a comma or a word nothing ends on."""
    t = text.strip()
    if t.endswith(("…", "...", ",")):
        return True
    words = plain(t).split()
    return bool(words) and words[-1] in _HANGING


# said over her, these only stop her: "para", "Capri, para", "ya, basta"
_STOP = re.compile(r"(?:para|espera|esperate|callate|calla|silencio|shh+|basta|alto|stop|wait|hush|enough|ya)"
                   r"(?: (?:para|ya|basta|stop|please|porfa|por favor))*")


def stop_word(text: str, names: Sequence[str] = (NAME,)) -> bool:
    """Words that only stop her, said alone (or with her name): not "para mañana pon una alarma"."""
    rest = strip_wake(text, names)[1]
    return bool(_STOP.fullmatch(plain(rest)))


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
# asking her to look, said any way: a look verb first and the screen anywhere, or "mira lo que", or "mira
# esto" alone. Looser ones ("ve a la pantalla de inicio", "check out this song") took screenshots.
_LOOK = re.compile(r"^(?:oye |hey )?(?:mira|mirame|miremos|observa|fijate|checa|chequea|revisa|dime que|que ves|que hay|look|check|tell me what)\b")
_SCREEN = re.compile(r"\b(?:pantalla|screen)\b")
_THIS = re.compile(r"^(?:mira|look at|check out) (?:lo que\b|what\b|(?:esto|this)$)")
# what doesn't change the command: "escóndete por favor", "please hide", "Capri, escóndete"
_POLITE = re.compile(r"\b(?:por favor|porfa(?:vor)?|please|pls|ya|un rato|un momento|ahora|ahorita|capri)\b")
# the slash commands typed in English
ALIASES = {"/hide": "/escondete", "/show": "/vuelve", "/back": "/vuelve", "/quit": "/cierra", "/look": "/mira",
           "/forget": "/olvida", "/dnd": "/nomolestes", "/reminders": "/recordatorios"}


def to_command(text: str) -> str:
    """A spoken command as its slash command; anything else comes back untouched (it's chat)."""
    p = plain(text)
    core = " ".join(_POLITE.sub(" ", p).split())
    for pattern, cmd in _EXACT:
        if re.fullmatch(pattern, p) or re.fullmatch(pattern, core):  # "close capri" needs her name
            return cmd.format(core.split()[-1]) if "{}" in cmd else cmd
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
