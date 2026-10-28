"""Speech to text: the microphone, Silero VAD (ONNX) to cut utterances, faster-whisper (GPU) to read
them in Spanish or English, and the "hey Capri" gate. What was said goes to the avatar as `Heard`,
which sends it back as if it had been typed, so every command works the same by voice.

Her answers stay text. The microphone is only open while voice is on (the avatar shows it); the
audio never leaves this process and is never written to disk."""

import asyncio
import logging
import os
import queue
import threading
import time
from collections.abc import Awaitable, Callable
from pathlib import Path

import numpy as np

from app import spoken
from app.protocol import Heard, ServerMessage, Voice as VoiceState

log = logging.getLogger(__name__)

RATE = 16_000
CHUNK = 512  # what Silero takes at 16 kHz (32 ms)
CONTEXT = 64
LANGS = ("es", "en")
# what Whisper writes over silence and noise
HALLUCINATIONS = ("amara.org", "thanks for watching", "gracias por ver", "subtitulos", "subtítulos", "suscríbete", "like and subscribe")
PROMPT = "Capri. Hey Capri. Oye Capri."


class Segmenter:
    """Cuts a stream of VAD probabilities into utterances. Pure: `feed` gets a chunk and its probability
    and returns the finished utterance (a float32 array) or None."""

    def __init__(self, silence_ms: int = 900, min_ms: int = 250, max_s: float = 20, pre_ms: int = 300, threshold: float = 0.5):
        ms = CHUNK * 1000 / RATE
        self.silence, self.min, self.max = int(silence_ms / ms), int(min_ms / ms), int(max_s * 1000 / ms)
        self.pre: list[np.ndarray] = []
        self.pre_max = int(pre_ms / ms)
        self.threshold = threshold
        self.chunks: list[np.ndarray] = []
        self.quiet = 0
        self.voiced = 0

    @property
    def speaking(self) -> bool:
        return bool(self.chunks)

    def feed(self, chunk: np.ndarray, prob: float) -> np.ndarray | None:
        voice = prob >= self.threshold
        if not self.chunks:
            if not voice:
                self.pre = (self.pre + [chunk])[-self.pre_max:]
                return None
            self.chunks, self.pre, self.quiet, self.voiced = list(self.pre), [], 0, 0
        self.chunks.append(chunk)
        self.voiced += voice
        self.quiet = 0 if voice else self.quiet + 1
        if self.quiet >= self.silence or len(self.chunks) >= self.max:
            audio, ok = np.concatenate(self.chunks), self.voiced >= self.min
            self.chunks, self.quiet, self.voiced = [], 0, 0
            return audio if ok else None
        return None


class Gate:
    """Who is she being talked to? With the wake phrase on, only what starts with "hey Capri" gets through,
    and the sentence right after it (the rest after a pause, or his answer to her); the hotkey opens the
    same window. Only her name opens it, so overheard talk can't keep it open."""

    def __init__(self, wake: bool = True, window_s: float = 8):
        self.wake, self.window = wake, window_s
        self.until = 0.0
        self.followup = False  # the window was opened by a whole sentence to her, not a bare name or the hotkey
        self.chat = False  # what decide() let through came only from such a window: chat, never a command

    def arm(self, now: float) -> None:
        self.until, self.followup = now + self.window, False

    def armed(self, now: float) -> bool:
        return now < self.until

    def decide(self, text: str, now: float) -> str | None:
        called, rest = spoken.strip_wake(text)  # "hey Capri, ..." inside the window still works
        if self.armed(now):
            self.until = 0.0
            said = (rest if called else text).strip()
            self.chat = self.followup and not called  # overheard "mira esto" must not take a screenshot
        elif self.wake and called:
            said, self.chat = rest.strip(), False
        else:
            return None
        if called and self.wake:  # with the hotkey only ([voz] llamada = false), her name opens nothing
            self.arm(now)
            self.followup = bool(said)
        return said or None


def junk(text: str, avg_logprob: float, no_speech: float) -> bool:
    low = text.lower()
    return len(text.strip()) < 2 or no_speech > 0.6 or avg_logprob < -1.2 or any(h in low for h in HALLUCINATIONS)


def cuda_dlls() -> None:
    """ctranslate2 wants cuBLAS and cuDNN: they come as pip packages (nvidia-*-cu12), not on the PATH."""
    try:
        import nvidia
    except ImportError:
        return
    for sub in ("cublas", "cudnn"):
        for root in nvidia.__path__:
            d = Path(root) / sub / "bin"
            if d.is_dir():
                os.add_dll_directory(str(d))
                os.environ["PATH"] = f"{d}{os.pathsep}{os.environ['PATH']}"


class SileroVad:
    """Streaming Silero VAD: the model bundled with faster-whisper, one 32 ms chunk at a time."""

    def __init__(self) -> None:
        import onnxruntime
        from faster_whisper.utils import get_assets_path

        opts = onnxruntime.SessionOptions()
        opts.inter_op_num_threads = opts.intra_op_num_threads = 1
        opts.log_severity_level = 4
        self.session = onnxruntime.InferenceSession(str(Path(get_assets_path()) / "silero_vad_v6.onnx"),
                                                    providers=["CPUExecutionProvider"], sess_options=opts)
        self.h = np.zeros((1, 1, 128), dtype="float32")
        self.c = np.zeros((1, 1, 128), dtype="float32")
        self.context = np.zeros(CONTEXT, dtype="float32")

    def __call__(self, chunk: np.ndarray) -> float:
        x = np.concatenate([self.context, chunk])[None]
        self.context = chunk[-CONTEXT:]
        out, self.h, self.c = self.session.run(None, {"input": x, "h": self.h, "c": self.c})
        return float(out[0])


class Voice:
    def __init__(self, model: str = "turbo", model_dir: str = "", silence_ms: int = 900, wake: bool = True, autostart: bool = False):
        self.autostart = autostart
        self.model_name, self.model_dir, self.silence_ms = model, model_dir or None, silence_ms
        self.gate = Gate(wake)
        self.state = "off"  # off | loading | idle | listening | hearing | thinking
        self._whisper = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._sink: Callable[[ServerMessage], Awaitable[None]] | None = None

    @property
    def on(self) -> bool:
        return self._thread is not None and self._thread.is_alive() and not self._stop.is_set()

    def attach(self, loop: asyncio.AbstractEventLoop, sink: Callable[[ServerMessage], Awaitable[None]]) -> None:
        """Where the messages go: `sink` runs on the server's loop."""
        self._loop, self._sink = loop, sink

    def _emit(self, msg: ServerMessage) -> None:
        if self._loop and self._sink:
            asyncio.run_coroutine_threadsafe(self._sink(msg), self._loop)

    def _set(self, state: str) -> None:
        if state != self.state:
            self.state = state
            self._emit(VoiceState(estado=state))

    def start(self) -> None:
        if self.on:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="voice", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def toggle(self) -> None:
        self.stop() if self.on else self.start()

    def listen_now(self) -> None:
        """The hotkey: the next sentence is for her, no wake phrase needed."""
        if not self.on:
            self.start()
        self.gate.arm(time.monotonic())
        self._set("listening")

    def _load(self):
        if self._whisper is None:
            cuda_dlls()
            from faster_whisper import WhisperModel

            t = time.perf_counter()
            self._whisper = WhisperModel(self.model_name, device="cuda", compute_type="int8_float16", download_root=self.model_dir)
            log.info("voice: %s loaded in %.1f s", self.model_name, time.perf_counter() - t)
        return self._whisper

    def transcribe(self, audio: np.ndarray) -> tuple[str, str] | None:
        """(text, language) of an utterance, Spanish or English; None for noise."""
        model = self._load()
        opts = dict(beam_size=1, condition_on_previous_text=False, initial_prompt=PROMPT, vad_filter=False)
        segments, info = model.transcribe(audio, language=None, **opts)
        if info.language not in LANGS:  # it only speaks these two: the likelier of them
            probs = dict(info.all_language_probs or [])
            lang = max(LANGS, key=lambda k: probs.get(k, 0))
            segments, info = model.transcribe(audio, language=lang, **opts)
        parts = list(segments)
        if not parts or any(junk(s.text, s.avg_logprob, s.no_speech_prob) for s in parts):
            return None
        return " ".join(s.text.strip() for s in parts), info.language

    def _run(self) -> None:
        import sounddevice as sd

        try:
            self._set("loading")
            self._load()
            vad, seg = SileroVad(), Segmenter(self.silence_ms)
            blocks: queue.Queue[np.ndarray] = queue.Queue()
            with sd.InputStream(samplerate=RATE, channels=1, dtype="float32", blocksize=CHUNK,
                                callback=lambda data, *_: blocks.put(data[:, 0].copy())):
                self._set("idle")
                while not self._stop.is_set():
                    try:
                        chunk = blocks.get(timeout=0.25)
                    except queue.Empty:
                        continue
                    audio = seg.feed(chunk, vad(chunk))
                    now = time.monotonic()
                    if audio is None:
                        self._set("hearing" if seg.speaking else "listening" if self.gate.armed(now) else "idle")
                        continue
                    self._set("thinking")
                    t = time.perf_counter()
                    heard = self.transcribe(audio)
                    log.info("voice: %.2f s of audio read in %.2f s: %r", len(audio) / RATE, time.perf_counter() - t, heard)
                    text = heard and self.gate.decide(heard[0], time.monotonic())
                    if text:
                        texto = text if self.gate.chat else spoken.to_command(text)
                        self._emit(Heard(texto=texto, original=text, idioma=heard[1]))
                    # what piled up while it was reading stays queued: it's the next thing he said
                    self._set("listening" if self.gate.armed(time.monotonic()) else "idle")
        except Exception:
            log.exception("voice stopped")
        finally:
            self._stop.set()
            self._set("off")
