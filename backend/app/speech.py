"""Her voice out loud: the reply cut into sentences as it streams, cleaned of what can't be said, in her
language, with her robotic touches; and telling her own voice (coming back through the speakers) apart
from his. Pure functions here; `Speaker` plays them."""

import re
import unicodedata
from difflib import SequenceMatcher

import numpy as np

from app import spoken

# a sentence ends at . ! ? … (and closing quotes) followed by a space, or at a line break
_END = re.compile(r"[.!?…]+[\"»”’)\]]*(?=\s)|\n+")
_ABBR = {"dr", "dra", "sr", "sra", "srta", "ud", "uds", "etc", "vs", "mr", "mrs", "ms", "st", "pag", "num", "no"}


class Sentences:
    """Text deltas in, whole sentences out (so each one can be spoken while the next is still streaming)."""

    def __init__(self) -> None:
        self.buf = ""

    def feed(self, delta: str) -> list[str]:
        self.buf += delta
        out, start = [], 0
        for m in _END.finditer(self.buf):
            if m.group().startswith("."):
                before = self.buf[start:m.start()].split()
                if before and spoken.plain(before[-1]) in _ABBR:
                    continue
            out.append(self.buf[start:m.end()].strip())
            start = m.end()
        self.buf = self.buf[start:]
        return [s for s in out if s]

    def flush(self) -> list[str]:
        rest, self.buf = self.buf.strip(), ""
        return [rest] if rest else []


_URL = re.compile(r"https?://\S+|www\.\S+")
_MARKS = re.compile(r"\*\*|__|~~|`|^#+\s*|^[-*]\s+", re.M)


def clean(text: str) -> str:
    """What's said of a text: no markdown, no emojis, links as "el enlace"."""
    t = _MARKS.sub("", _URL.sub("el enlace", text))
    t = "".join(c for c in t if unicodedata.category(c) not in ("So", "Cs", "Co", "Cn") and c not in "️‍")
    return " ".join(t.split())


_EN = {"the", "you", "i", "it", "to", "and", "is", "for", "what", "my", "your", "that", "this", "of", "in", "want",
       "do", "are", "can", "let's", "hey", "me", "with", "just", "so", "be", "was", "have", "opened", "play", "yes"}
_ES = {"el", "la", "de", "que", "y", "te", "lo", "ya", "es", "en", "un", "una", "para", "por", "mi", "tu", "con", "no",
       "si", "se", "le", "los", "las", "del", "al", "esta", "pero", "como", "mas", "eso", "hoy", "quieres", "abri"}


def lang_of(text: str) -> str:
    """"es" or "en", by the common words in it (Spanish when unsure)."""
    words = spoken.plain(text).split()
    return "en" if sum(w in _EN for w in words) > sum(w in _ES for w in words) else "es"


def echo(heard: str, said: list[str]) -> bool:
    """What the microphone heard is her own voice coming back: it's in, or very like, what she just said."""
    h = spoken.plain(heard).split()
    words = spoken.plain(" ".join(said)).split()
    if not h or not words:
        return False
    if f" {' '.join(h)} " in f" {' '.join(words)} ":
        return True
    if len(h) < 2:  # one word must be there as it is: "para" is not "otra"
        return False
    target = " ".join(h)
    return any(SequenceMatcher(None, target, " ".join(words[i:i + len(h)])).ratio() >= 0.6
               for i in range(max(1, len(words) - len(h) + 1)))


def fx(audio: np.ndarray, rate: int, robot: float = 0, glitch: float = 0, seed: int | None = None) -> np.ndarray:
    """Her digital touches, 0-1 each: `robot` rings and combs the voice (metallic), `glitch` stutters bits of it."""
    if robot <= 0 and glitch <= 0:
        return audio
    x = audio.astype("float32")
    if robot > 0:
        t = np.arange(len(x)) / rate
        ring = x * np.sin(2 * np.pi * 70 * t)
        d = int(0.004 * rate)
        comb = x.copy()
        comb[d:] += 0.6 * x[:-d]
        x = (1 - robot) * x + robot * (0.5 * ring + 0.5 * comb)
    if glitch > 0:
        rng = np.random.default_rng(seed)
        n = rng.poisson(glitch * 1.5 * len(x) / rate)
        cuts = sorted(rng.integers(0, max(1, len(x) - rate // 10), size=n))
        parts, at = [], 0
        for c in cuts:
            if c < at:  # overlaps the last stutter
                continue
            size = int(rng.uniform(0.04, 0.09) * rate)
            bit = x[c:c + size]
            if rng.random() < 0.3:
                bit = bit[::2]  # a chirp: the bit at double speed
            parts += [x[at:c + size]] + [bit] * int(rng.integers(1, 4))
            at = c + size
        parts.append(x[at:])
        x = np.concatenate(parts)
    peak = np.abs(x).max()
    return (x / peak if peak > 1 else x).astype("float32")
