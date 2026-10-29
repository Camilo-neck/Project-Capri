"""Her voice out loud: the reply cut into sentences as it streams, cleaned of what can't be said, in her
language, with her robotic touches; and telling her own voice (coming back through the speakers) apart
from his. Pure functions here; `Speaker` plays them."""

import json
import logging
import queue
import re
import struct
import subprocess
import threading
import time
import unicodedata
from collections import deque
from collections.abc import Callable, Iterable, Iterator
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np

from app import spoken
from app.protocol import Level, TextDelta, UtteranceEnd, UtteranceStart

log = logging.getLogger(__name__)

# a sentence ends at . ! ? … (and closing quotes) followed by a space, or at a line break
_END = re.compile(r"[.!?…]+[\"»”’)\]]*(?=\s)|\n+")
_ABBR = {"dr", "dra", "sr", "sra", "srta", "ud", "uds", "etc", "vs", "mr", "mrs", "ms", "st", "pag", "num"}


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
    """What's said of a text: no markdown, no emojis, links as "el enlace". A line of a list ("• …", "/comando …",
    her /ayuda) is for reading: nothing is said of it."""
    if text.lstrip().startswith(("/", "•")):
        return ""
    t =_MARKS.sub("", _URL.sub("el enlace", text))
    t = "".join(c for c in t if unicodedata.category(c) not in ("So", "Cs", "Co", "Cn") and c not in "️‍")
    return " ".join(t.split()) if any(c.isalnum() for c in t) else ""  # "-", "* * *": nothing to say


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


def fx(audio: np.ndarray, rate: int, robot: float = 0, glitch: float = 0, seed: int | None = None,
       start: int = 0, before: np.ndarray | None = None) -> np.ndarray:
    """Her digital touches, 0-1 each: `robot` rings and combs the voice (metallic), `glitch` stutters bits of it.
    For a chunk of a streamed sentence, `start` (samples before it) and `before` (the plain audio before it) carry
    the effect on from the last chunk without a click."""
    if (robot <= 0 and glitch <= 0) or not audio.size:
        return audio
    x = audio.astype("float32")
    if robot > 0:
        t = (start + np.arange(len(x))) / rate
        ring = x * np.sin(2 * np.pi * 70 * t)
        d = int(0.004 * rate)
        prev = np.zeros(d, dtype="float32") if before is None else np.asarray(before, dtype="float32")[-d:]
        delayed = np.concatenate([np.zeros(d - len(prev), dtype="float32"), prev, x])[:len(x)]
        comb = x + 0.6 * delayed
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
    return np.clip(x, -1, 1).astype("float32")  # not scaled to its peak: a chunk's own peak would jump the volume


PREBUFFER_S = 0.4  # a streamed sentence starts once this much is made: with the LLM busy too, it's about real time


def kokoro(folder: str, styles: dict[str, str]) -> Callable[[str, str, float], tuple[np.ndarray, int]]:
    """Kokoro on the CPU, loaded on first use. `styles` by language ("es", "en"): one of Kokoro's voices or a tuned
    one (<folder>/<name>.npy, scripts/tune_voice.py)."""
    loaded: dict = {}
    lock = threading.Lock()  # warm() and her first sentence: one load

    def synth(text: str, lang: str, speed: float = 1.0) -> tuple[np.ndarray, int]:
        with lock:
            if not loaded:
                from kokoro_onnx import Kokoro

                root = Path(folder)
                loaded["k"] = Kokoro(str(root / "kokoro-v1.0.onnx"), str(root / "voices-v1.0.bin"))
                loaded["styles"] = {k: np.load(root / f"{s}.npy") if (root / f"{s}.npy").exists() else s for k, s in styles.items()}
        style = loaded["styles"].get(lang, loaded["styles"]["es"])
        audio, rate = loaded["k"].create(text, voice=style, speed=speed, lang="en-us" if lang == "en" else "es")
        return np.asarray(audio, dtype="float32"), rate

    return synth


def piper(folder: str, models: dict[str, str]) -> Callable[[str, str, float], tuple[np.ndarray, int]]:
    """Piper on the CPU: a model by language (<folder>/<name>.onnx + .onnx.json), each loaded on first use."""
    loaded: dict = {}
    lock = threading.Lock()

    def synth(text: str, lang: str, speed: float = 1.0) -> tuple[np.ndarray, int]:
        name = models.get(lang, models["es"])
        with lock:
            if name not in loaded:
                from piper import PiperVoice

                loaded[name] = PiperVoice.load(str(Path(folder) / f"{name}.onnx"))
        from piper import SynthesisConfig

        chunks = list(loaded[name].synthesize(text, SynthesisConfig(length_scale=1 / speed, volume=0.65)))
        if not chunks:
            return np.zeros(0, dtype="float32"), loaded[name].config.sample_rate
        return np.concatenate([c.audio_float_array for c in chunks]).astype("float32"), chunks[0].sample_rate

    return synth


def qwen(folder: str, voice: str = "capri", cmd: list[str] | None = None) -> Callable[..., tuple[Iterator[np.ndarray], int]]:
    """Her cloned voice (Qwen3-TTS) in its own process with its own Python (torch, CUDA graphs): app/qwen_worker.py
    with <folder>/qwen/env, the 0.6B model and her recording, <folder>/qwen/<voice>.wav + .txt (what it says).
    Started on first use; the audio streams in chunks; `synth.close()` ends it and frees its GPU memory."""
    root = Path(folder) / "qwen"
    cmd = cmd or [str(root / "env" / "Scripts" / "python.exe"), "-I", str(Path(__file__).with_name("qwen_worker.py")),
                  str(root / "Qwen3-TTS-12Hz-0.6B-Base"), str(root / f"{voice}.wav"), str(root / f"{voice}.txt")]

    def read(n: int) -> bytes:
        b = synth.proc.stdout.read(n)
        if len(b) < n:
            raise RuntimeError("her voice's process died (see qwen/worker.log)")
        return b

    def size() -> int:
        return struct.unpack("<i", read(4))[0]

    def send(msg: dict) -> None:
        synth.proc.stdin.write((json.dumps(msg) + "\n").encode())
        synth.proc.stdin.flush()

    starting = threading.Lock()  # warm() and her first sentence may both start it: one process

    def synth(text: str, lang: str, speed: float = 1.0) -> tuple[Iterator[np.ndarray], int]:
        with starting:
            if synth.proc is None or synth.proc.poll() is not None:
                err = open(root / "worker.log", "ab") if root.is_dir() else subprocess.DEVNULL
                synth.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err,
                                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                if size() != 0:  # it says it's ready once the model is loaded and its graphs captured
                    raise RuntimeError("her voice didn't load (see qwen/worker.log)")

        def chunks() -> Iterator[np.ndarray]:
            send({"text": text, "lang": lang})
            ended = False
            try:
                while (n := size()) > 0:
                    yield np.frombuffer(read(n), dtype="<f4")
                ended = True
                if n < 0:
                    raise RuntimeError(f"her voice couldn't say {text!r} (see qwen/worker.log)")
            finally:
                if not ended and synth.proc.poll() is None:  # cut: it stops, and the rest isn't mixed into the next
                    send({"stop": True})
                    while (n := size()) > 0:
                        read(n)

        return chunks(), 24000

    def close() -> None:
        if synth.proc is not None and synth.proc.poll() is None:
            synth.proc.kill()
            synth.proc.wait()

    synth.proc, synth.close = None, close
    return synth


def fallback(primary: Callable, backup: Callable) -> Callable:
    """`primary` until it fails once (no model, no GPU memory), then `backup` for good."""
    failed = []

    def synth(text: str, lang: str, speed: float = 1.0):
        if not failed:
            try:
                return primary(text, lang, speed)
            except Exception:
                log.exception("speech: her cloned voice failed, Kokoro from now on")
                failed.append(True)
                synth.close()
        return backup(text, lang, speed)

    synth.close = getattr(primary, "close", lambda: None)
    return synth


def _until_none(q: queue.Queue) -> Iterator[np.ndarray]:
    while (c := q.get()) is not None:
        yield c


def sound_card(chunks: Iterable[np.ndarray], rate: int, block: Callable[[np.ndarray], np.ndarray | None]) -> None:
    """Plays the chunks as they come in 50 ms blocks, each through `block` (volume, level); None from it cuts the
    sound at once."""
    import sounddevice as sd

    n = rate // 20
    with sd.OutputStream(samplerate=rate, channels=1, dtype="float32", blocksize=n) as out:
        for audio in chunks:
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
                 emit: Callable[[object], None] = lambda m: None, voice: str = ""):
        self.synth, self.play, self.emit = synth, play, emit
        self.voice = voice  # which of voices.CATALOG this is
        self.enabled = True
        self.lang = "es"  # what he spoke last (set by the voice)
        self.speed, self.robot, self.glitch = 1.0, 0.0, 0.0
        self.on_first_audio: Callable[[float], None] | None = None  # seconds from the reply's start to her voice
        self.on_disabled: Callable[[], None] | None = None  # her voice failed for good (no model, no sound card)
        self._spoke = False  # a sentence came out once: the voice works, a failure after that is that sentence's
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

    def say(self, text: str, force: bool = False) -> None:
        """A line of hers that didn't come from a turn (the avatar's own: a greeting, a reaction); `force`: even
        with her voice off (the panel's "Probar")."""
        self._started_at = time.perf_counter()
        lines = Sentences()
        for s in lines.feed(text) + lines.flush():
            self._queue(s, force)

    def warm(self) -> None:
        """Loads the voice model ahead of her first reply (a second or two the first time)."""
        try:
            self.synth("Hola.", "es", self.speed)
        except Exception:
            log.exception("speech: the voice model didn't load")

    def stop(self) -> None:
        with self._lock:  # drained inside the lock: a sentence queued right after the stop must survive it
            self._gen += 1
            self._pending = 0
            waiters, self._waiters = self._waiters, []
            for q in (self._text, self._audio):
                while True:
                    try:
                        q.get_nowait()
                    except queue.Empty:
                        break
        self._sentences = Sentences()
        for cb in waiters:
            cb()

    def release(self) -> None:
        """Stops her and frees her voice model (the cloned one's GPU memory) until she speaks again."""
        self.stop()
        if close := getattr(self.synth, "close", None):
            close()

    def use(self, synth: Callable[..., tuple[np.ndarray, int]], voice: str) -> None:
        """Another voice: she stops, the old one's model is freed, the next sentence is in the new one."""
        self.release()
        self.synth, self.voice = synth, voice

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

    def _queue(self, sentence: str, force: bool = False) -> None:
        text = clean(sentence)
        if not text or not (self.enabled or force):
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
        if self.on_disabled:
            self.on_disabled()

    def _hand(self, gen: int, held: list[np.ndarray], rate: int, text: str) -> queue.Queue | None:
        """The sentence goes to the play thread with what's made of it so far (None if she was stopped meanwhile)."""
        stream: queue.Queue = queue.Queue()
        for c in held:
            stream.put(c)
        while gen == self._gen:  # the play queue holds two: wait, but not past a stop
            try:
                self._audio.put((gen, stream, rate, text), timeout=0.1)
                self._spoke = True
                return stream
            except queue.Full:
                pass
        return None

    def _synth_loop(self) -> None:
        while True:
            gen, text, lang = self._text.get()
            if gen != self._gen:
                continue
            stream, chunks = None, None  # stream: the chunks on their way to the play thread, once it has the sentence
            try:
                audio, rate = self.synth(text, lang, self.speed)
                chunks = iter([audio]) if isinstance(audio, np.ndarray) else iter(audio)
                held, have, at, last = [], 0, 0, None
                for c in chunks:
                    if gen != self._gen:
                        break
                    plain = np.asarray(c, dtype="float32")
                    c = fx(plain, rate, self.robot, self.glitch, start=at, before=last)
                    at, last = at + plain.size, plain
                    if not c.size:
                        continue
                    if stream is not None:
                        stream.put(c)
                        continue
                    held.append(c)
                    have += c.size
                    if have >= PREBUFFER_S * rate:
                        stream = self._hand(gen, held, rate, text)
                if stream is None and held and gen == self._gen:  # a short sentence: all of it at once
                    stream = self._hand(gen, held, rate, text)
                if stream is None and gen == self._gen:  # nothing to say in it
                    self._done(gen)
            except Exception:
                if gen != self._gen or stream is not None:  # stopped meanwhile, or it broke off mid-sentence
                    log.exception("speech: %r broke off", text)
                elif not self._spoke:  # never worked: no model
                    self._fail("synthesis")
                else:  # this sentence only ("-" has no phonemes): skip it
                    log.exception("speech: couldn't say %r", text)
                    self._done(gen)
            finally:
                if close := getattr(chunks, "close", None):
                    close()  # cut: the voice model stops making the rest
                if stream is not None:
                    stream.put(None)

    def _play_loop(self) -> None:
        while True:
            gen, stream, rate, text = self._audio.get()
            audio = _until_none(stream)
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
