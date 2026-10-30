"""Her first start on a new PC: what this PC has (GPU, memory, disk, Ollama, Claude Code, her cloned voice) and
the brain and voice that suit it. The wizard (avatar/setup.html) shows it; a fresh config.toml says it's due
([inicio] listo = false, from the example), an older one without that key is taken as done."""

import os
import shutil
import subprocess
import tomllib
from dataclasses import dataclass
from pathlib import Path

import psutil

from app import settings

BIG_GPU_MB = 11000  # 12 GB cards report a little under: room for a 12B model, Whisper and her clone
MID_GPU_MB = 7500  # 8 GB: a 4B model and Whisper
QWEN_GPU_MB = 6000


@dataclass
class Pc:
    gpu: str  # the NVIDIA card's name, "" without one
    vram_mb: int
    ram_gb: float
    disco_gb: float  # free where her models go
    ollama: bool
    claude_code: bool
    qwen: bool  # her cloned voice's environment is installed (the installer does it)


def _nvidia() -> tuple[str, int]:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return "", 0
    try:
        out = subprocess.run([exe, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], capture_output=True,
                             text=True, timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
        name, mb = out.strip().splitlines()[0].rsplit(",", 1)
        return name.strip(), int(mb)
    except (OSError, subprocess.TimeoutExpired, ValueError, IndexError):
        return "", 0


def _ollama() -> bool:
    local = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe"
    return local.exists() or shutil.which("ollama") is not None


def detect() -> Pc:
    s = settings.load()
    gpu, vram = _nvidia()
    models = Path(s.tts_dir)
    free_at = next((p for p in (models, *models.parents) if p.exists()), Path.home())
    return Pc(gpu=gpu, vram_mb=vram, ram_gb=round(psutil.virtual_memory().total / 2**30, 1),
              disco_gb=round(shutil.disk_usage(free_at).free / 2**30, 1), ollama=_ollama(),
              claude_code=shutil.which("claude") is not None,
              qwen=(models / "qwen" / "env" / "Scripts" / "python.exe").exists())


def recommend(pc: Pc, voices_ready: list[str]) -> tuple[str, str, str, str]:
    """(provider, model, voice, why) for this PC. `voices_ready`: the voices already on it."""
    if pc.ollama and pc.vram_mb >= BIG_GPU_MB:
        brain, why = ("ollama", "gemma3:12b"), f"Tu GPU tiene {round(pc.vram_mb / 1024)} GB: un modelo local de 12B, todo en tu PC y gratis."
    elif pc.ollama and pc.vram_mb >= MID_GPU_MB:
        brain, why = ("ollama", "gemma3:4b"), f"Tu GPU tiene {round(pc.vram_mb / 1024)} GB: un modelo local pequeño, todo en tu PC y gratis."
    elif pc.claude_code:
        brain, why = ("claude_code", "sonnet"), "Tienes Claude Code: usa tu plan de Claude, sin clave."
    else:
        brain, why = ("gemini", "gemini-2.5-flash"), ("Sin una GPU NVIDIA de 8 GB, mejor un cerebro en la nube: Gemini tiene uso gratis "
                                                    "con una clave de aistudio.google.com.")
    if pc.qwen and pc.vram_mb >= QWEN_GPU_MB and "capri" in voices_ready:
        voice = "capri"
    else:
        voice = "capri_ligera" if "capri_ligera" in voices_ready else "dora"
    return *brain, voice, why


def done() -> bool:
    """Whether the wizard already ran here (an older config, without [inicio], counts as done)."""
    data = tomllib.loads(settings.path().read_text(encoding="utf-8")) if settings.path().exists() else {}
    return bool(data.get("inicio", {}).get("listo", True))


def finish() -> None:
    settings.set_value("inicio", "listo", True)
