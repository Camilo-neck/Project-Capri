"""Her voices to pick from (all women's): her cloned voice on the GPU, and voices on the CPU (Kokoro, Piper),
each a Spanish and an English one since she answers in the language he speaks. What each needs on disk, what can
be downloaded from the panel (Kokoro's model, Piper's voices; authorized 28/10/2026), and the engine for each."""

import shutil
import subprocess
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app import speech

KOKORO_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
PIPER_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
KOKORO_FILES = {"kokoro-v1.0.onnx": 310, "voices-v1.0.bin": 27}  # MB
PIPER_MB = {"high": 114, "medium": 63}
QWEN_GPU_MB = 6000  # total VRAM her clone needs (2.7 GB of its own, with room for the rest)


@dataclass(frozen=True)
class Voice:
    id: str
    nombre: str
    motor: str  # qwen | kokoro | piper | edge
    es: str  # the Spanish voice (Kokoro: one of its voices or a tuned <name>.npy; Piper: the model's name)
    en: str
    nota: str
    tono: int = 0  # edge: Hz up from the voice's own, to sit near hers


CATALOG = [
    Voice("capri", "Capri", "qwen", "capri", "capri", "Su voz, clonada de su grabación. En la GPU."),
    Voice("capri_ligera", "Capri ligera", "kokoro", "capri", "capri", "Afinada a su voz, en la CPU. Se parece menos."),
    Voice("dora", "Dora", "kokoro", "ef_dora", "af_heart", "Kokoro, en la CPU. La de respaldo."),
    Voice("daniela", "Daniela", "piper", "es_AR-daniela-high", "en_US-amy-medium", "Piper, acento argentino. En la CPU."),
    Voice("claude_mx", "Claude MX", "piper", "es_MX-claude-high", "en_US-amy-medium", "Piper, acento mexicano. En la CPU."),
    Voice("aria", "Aria", "edge", "es-MX-DaliaNeural", "en-US-AriaNeural", "Microsoft Edge, con su toque de holograma. En la nube: lo que dice va a Microsoft.", 40),
    Voice("jenny", "Jenny", "edge", "es-CO-SalomeNeural", "en-US-JennyNeural", "Microsoft Edge, con su toque de holograma. En la nube: lo que dice va a Microsoft.", 80),
    Voice("bella", "Bella", "kokoro", "af_bella", "af_bella", "Kokoro, americana: en español con acento."),
    Voice("emma", "Emma", "kokoro", "bf_emma", "bf_emma", "Kokoro, británica: en español con acento."),
]
DEFAULT, BACKUP = "capri", "dora"


def get(voice_id: str) -> Voice:
    return next((v for v in CATALOG if v.id == voice_id), CATALOG[0])


def _piper_path(name: str) -> str:
    """es_AR-daniela-high -> es/es_AR/daniela/high/ (how rhasspy/piper-voices is laid out)."""
    lang, who, quality = name.split("-")
    return f"{lang[:2]}/{lang}/{who}/{quality}/"


def url_for(name: str) -> str:
    if name in KOKORO_FILES:
        return KOKORO_URL + name
    model = name.removesuffix(".json").removesuffix(".onnx")
    return PIPER_URL + _piper_path(model) + name


def needs(v: Voice) -> list[tuple[str, int, bool]]:
    """(file under the TTS folder, MB, whether it can be downloaded from the panel) for a voice."""
    if v.motor == "edge":
        return []  # nothing to download: it's a service
    if v.motor == "qwen":
        return [(f, 0, False) for f in ("qwen/env/Scripts/python.exe", "qwen/Qwen3-TTS-12Hz-0.6B-Base/config.json",
                                        f"qwen/{v.es}.wav", f"qwen/{v.es}.txt")]
    if v.motor == "kokoro":
        files = [(f, mb, True) for f, mb in KOKORO_FILES.items()]
        return files + [(f"{s}.npy", 0, False) for s in dict.fromkeys((v.es, v.en)) if "_" not in s]  # a tuned style, not one of its own
    return [(f"{m}{ext}", PIPER_MB[m.rsplit("-", 1)[1]] if ext == ".onnx" else 0, True)
            for m in dict.fromkeys((v.es, v.en)) for ext in (".onnx", ".onnx.json")]


@dataclass
class Option:
    id: str
    nombre: str
    motor: str
    nota: str
    gpu: bool
    nube: bool  # a service: what she says leaves this PC
    descargada: bool
    descargable: bool  # what's missing can be downloaded from the panel
    disponible: bool  # this PC can run it
    motivo: str  # why not
    mb: int  # left to download


def parse_gpu(text: str) -> tuple[int, int] | None:
    """nvidia-smi's "used, total" (MB) of the first GPU."""
    try:
        used, total = (int(x) for x in text.strip().splitlines()[0].split(","))
        return used, total
    except (ValueError, IndexError):
        return None


def gpu() -> tuple[int, int] | None:
    """(used, total) MB of the NVIDIA GPU, or None without one."""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        out = subprocess.run([exe, "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired):
        return None
    return parse_gpu(out.stdout)


def options(folder: str, gpu: tuple[int, int] | None) -> list[Option]:
    root = Path(folder)
    out = []
    for v in CATALOG:
        missing = [(f, mb, ok) for f, mb, ok in needs(v) if not (root / f).exists()]
        reason = ""
        if v.motor == "qwen":
            if gpu is None:
                reason = "Necesita una tarjeta gráfica NVIDIA."
            elif gpu[1] < QWEN_GPU_MB:
                reason = f"Tu GPU tiene {round(gpu[1] / 1024)} GB; necesita {QWEN_GPU_MB // 1000} GB."
        out.append(Option(v.id, v.nombre, v.motor, v.nota, v.motor == "qwen", v.motor == "edge", not missing,
                          bool(missing) and all(ok for _, _, ok in missing), not reason, reason, sum(mb for _, mb, _ in missing)))
    return out


def make(voice_id: str, folder: str) -> Callable:
    """The engine for a voice. Her clone falls back to Dora on the CPU if it fails."""
    v = get(voice_id)
    if v.motor == "piper":
        return speech.piper(folder, {"es": v.es, "en": v.en})
    if v.motor == "kokoro":
        return speech.kokoro(folder, {"es": v.es, "en": v.en})
    backup = get(BACKUP)
    if v.motor == "edge":  # no internet: Dora, so she still talks
        return speech.fallback(speech.edge({"es": v.es, "en": v.en}, v.tono), speech.kokoro(folder, {"es": backup.es, "en": backup.en}))
    return speech.fallback(speech.qwen(folder, v.es), speech.kokoro(folder, {"es": backup.es, "en": backup.en}))


def download(voice_id: str, folder: str, progress: Callable[[int, int], None]) -> None:
    """Downloads what's missing for a voice (bytes done, bytes total as it goes). A file only appears once whole."""
    root = Path(folder)
    todo = [f for f, _, ok in needs(get(voice_id)) if ok and not (root / f).exists()]
    sizes = {}
    for f in todo:
        with urllib.request.urlopen(urllib.request.Request(url_for(f), method="HEAD")) as r:
            sizes[f] = int(r.headers.get("Content-Length") or 0)
    total, done = sum(sizes.values()), 0
    root.mkdir(parents=True, exist_ok=True)
    for f in todo:
        part = root / (f + ".part")
        try:
            with urllib.request.urlopen(url_for(f)) as r, open(part, "wb") as out:
                while chunk := r.read(1 << 16):
                    out.write(chunk)
                    done += len(chunk)
                    progress(done, max(total, done))
            part.replace(root / f)
        finally:
            part.unlink(missing_ok=True)
    progress(done, max(total, done))
