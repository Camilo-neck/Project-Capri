"""Her voice out loud: the reply cut into sentences as it streams, cleaned of what can't be said, in her
language, with her robotic touches; and telling her own voice (coming back through the speakers) apart
from his. Pure functions here; `Speaker` plays them."""

import logging
import queue
import re
import threading
import time
import unicodedata
from collections import deque
from collections.abc import Callable
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np

from app import spoken
from app.protocol import Level, TextDelta, UtteranceEnd, UtteranceStart

log = logging.getLogger(__name__)

# a sentence ends at . ! ? … (and closing quotes) followed by a space, or at a line break
_END = re.compile(r"[.!?…]+[\"»”’)\]]*(?=\s)|\n+")
_ABBR = {"dr", "dra", "sr", "sra", "srta", "ud", "uds", "etc", "vs", "mr", "mrs", "ms", "st", "pag", "num", "no"}


def level(chunk: np.ndarray) -> float:
    """How loud a chunk is, 0-1 (RMS scaled so normal speech fills most of the meter)."""
    return min(1.0, float(np.sqrt(np.mean(chunk ** 2))) * 10) if len(chunk) else 0.0


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


STOCK = {"es": "ef_dora", "en": "af_heart"}  # Kokoro's voices when no tuned one is set


def kokoro(folder: str, voice: str = "") -> Callable[[str, str, float], tuple[np.ndarray, int]]:
    """Kokoro on the CPU, loaded on first use. `voice`: a tuned style (<folder>/<voice>.npy, scripts/tune_voice.py),
    one of Kokoro's voices, or "" for STOCK by language."""
    loaded: dict = {}

    def synth(text: str, lang: str, speed: float = 1.0) -> tuple[np.ndarray, int]:
        if not loaded:
            from kokoro_onnx import Kokoro

            root = Path(folder)
            k = Kokoro(str(root / "kokoro-v1.0.onnx"), str(root / "voices-v1.0.bin"))
            tuned = root / f"{voice}.npy"
            loaded["style"] = np.load(tuned) if voice and tuned.exists() else voice if voice in k.get_voices() else None
            loaded["k"] = k
        style = loaded["style"] if loaded["style"] is not None else STOCK.get(lang, STOCK["es"])
        audio, rate = loaded["k"].create(text, voice=style, speed=speed, lang="en-us" if lang == "en" else "es")
        return np.asarray(audio, dtype="float32"), rate

    return synth


def sound_card(audio: np.ndarray, rate: int, block: Callable[[np.ndarray], np.ndarray | None]) -> None:
    """Plays in 50 ms blocks, each through `block` (volume, level); None from it cuts the sound at once."""
    import sounddevice as sd

    n = rate // 20
    with sd.OutputStream(samplerate=rate, channels=1, dtype="float32", blocksize=n) as out:
        for i in range(0, len(audio), n):
            b = block(audio[i:i + n])
            if b is None:
                out.abort()  # drop what's buffered: she stops now, not in a second
                return
            out.write(np.ascontiguousarray(b, dtype="float32").reshape(-1, 1))


class Speaker:
    """Says her replies while they stream: sentences go to a synth thread, which works on the next one while a
    play thread plays the last. `stop()` drops everything at once (a generation counter: whatever was queued
    before it is skipped); `duck()` turns her down while he might be talking over her."""

    DUCK = 0.25
    RECENT_S = 10

    def __init__(self, synth: Callable[..., tuple[np.ndarray, int]], play: Callable = sound_card,
                 emit: Callable[[object], None] = lambda m: None):
        self.synth, self.play, self.emit = synth, play, emit
        self.enabled = True
        self.lang = "es"  # what he spoke last (set by the voice)
        self.speed, self.robot, self.glitch = 1.0, 0.0, 0.0
        self.on_first_audio: Callable[[float], None] | None = None  # seconds from the reply's start to her voice
        self._lock = threading.Lock()
        self._gen = 0
        self._pending = 0  # sentences queued and not played yet
        self._waiters: list[Callable[[], None]] = []
        self._gain = 1.0
        self._said: deque[tuple[float, str]] = deque(maxlen=20)
        self._sentences = Sentences()
        self._started_at: float | None = None
        self._text: queue.Queue = queue.Queue()
        self._audio: queue.Queue = queue.Queue(maxsize=2)
        self._threads: list[threading.Thread] = []

    @property
    def playing(self) -> bool:
        return self._pending > 0

    def see(self, msg: object) -> None:
        """A message of her turn, on its way to the avatar."""
        if isinstance(msg, UtteranceStart):
            self._sentences = Sentences()
            self._started_at = time.perf_counter()
        elif isinstance(msg, TextDelta):
            for s in self._sentences.feed(msg.text):
                self._queue(s)
        elif isinstance(msg, UtteranceEnd):
            if msg.cortada:
                self.stop()
            else:
                for s in self._sentences.flush():
                    self._queue(s)

    def say(self, text: str) -> None:
        """A line of hers that didn't come from a turn (the avatar's own: a greeting, a reaction)."""
        self._started_at = time.perf_counter()
        lines = Sentences()
        for s in lines.feed(text) + lines.flush():
            self._queue(s)

    def stop(self) -> None:
        with self._lock:
            self._gen += 1
            self._pending = 0
            waiters, self._waiters = self._waiters, []
        self._sentences = Sentences()
        for q in (self._text, self._audio):
            while True:
                try:
                    q.get_nowait()
                except queue.Empty:
                    break
        for cb in waiters:
            cb()

    def duck(self, on: bool) -> None:
        self._gain = self.DUCK if on else 1.0

    def after(self, cb: Callable[[], None]) -> None:
        """`cb` once she's done saying what's queued (now, if nothing is)."""
        with self._lock:
            if self._pending:
                self._waiters.append(cb)
                return
        cb()

    def recent(self, s: float | None = None) -> list[str]:
        since = time.monotonic() - (s or self.RECENT_S)
        return [text for at, text in self._said if at >= since]

    def _queue(self, sentence: str) -> None:
        text = clean(sentence)
        if not text or not self.enabled:
            return
        lang = lang_of(text) if len(text.split()) >= 4 else self.lang
        with self._lock:
            self._pending += 1
            self._text.put((self._gen, text, lang))
        if not self._threads:
            self._threads = [threading.Thread(target=f, daemon=True, name=f"speech{f.__name__}")
                             for f in (self._synth_loop, self._play_loop)]
            for t in self._threads:
                t.start()

    def _done(self, gen: int) -> None:
        with self._lock:
            if gen != self._gen:
                return
            self._pending -= 1
            if self._pending:
                return
            waiters, self._waiters = self._waiters, []
        for cb in waiters:
            cb()

    def _fail(self, what: str) -> None:
        log.exception("speech: %s failed, back to text only", what)
        self.enabled = False
        self.stop()

    def _synth_loop(self) -> None:
        while True:
            gen, text, lang = self._text.get()
            if gen != self._gen:
                continue
            try:
                audio, rate = self.synth(text, lang, self.speed)
            except Exception:
                self._fail("synthesis")
                continue
            audio = fx(audio, rate, self.robot, self.glitch)
            while gen == self._gen:  # the play queue holds two: wait, but not past a stop
                try:
                    self._audio.put((gen, audio, rate, text), timeout=0.1)
                    break
                except queue.Full:
                    pass

    def _play_loop(self) -> None:
        while True:
            gen, audio, rate, text = self._audio.get()
            if gen != self._gen:
                continue
            if self._started_at is not None:
                took = time.perf_counter() - self._started_at
                self._started_at = None
                log.info("speech: first audio %.2f s after the reply started", took)
                if self.on_first_audio:
                    self.on_first_audio(took)
            self._said.append((time.monotonic(), text))

            def block(b: np.ndarray) -> np.ndarray | None:
                if gen != self._gen:
                    return None
                try:
                    self.emit(Level(fuente="tts", valor=level(b)))
                except Exception:
                    log.exception("speech: level")
                return b * self._gain

            try:
                self.play(audio, rate, block)
            except Exception:
                self._fail("playback")
                continue
            self._done(gen)
