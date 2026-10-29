"""User settings in %APPDATA%\\Capri\\config.toml: allowlists for tools and the calendar.

Read on every use, so edits apply without a restart. Created from config.example.toml if missing.
"""

import json
import os
import re
import tomllib
from dataclasses import dataclass, field
from datetime import datetime, time
from pathlib import Path

DIR = Path(os.environ.get("APPDATA", Path.home())) / "Capri"
EXAMPLE = Path(__file__).parent / "config.example.toml"
SPOTIFY_REDIRECT = "http://127.0.0.1:5173/callback"  # the one registered for the Spotify app (shared with telon)


@dataclass(frozen=True)
class Routine:
    """Several things from one phrase of his: programs to open and some music."""

    phrases: tuple[str, ...]
    apps: tuple[str, ...] = ()
    music: str = ""  # a Spotify search; "" for none
    music_kind: str = "cancion"  # cancion | playlist | album | artista (only a song starts by itself)


DEFAULT_ROUTINES = {"chamba": Routine(("modo chamba", "chamba mode"), ("vscode", "warp"), "lofi hip hop")}


@dataclass
class Settings:
    apps: dict[str, str] = field(default_factory=dict)  # name -> program or path
    routines: dict[str, Routine] = field(default_factory=lambda: dict(DEFAULT_ROUTINES))
    scripts: dict[str, str] = field(default_factory=dict)  # name -> path
    calendar_url: str = ""
    remind_minutes: int = 10
    proactive: bool = True
    proactive_per_hour: int = 2
    idle_hours: float = 2
    quiet: tuple[time, time] | None = (time(23), time(8))  # no chatter from..to (may wrap midnight)
    spotify_client_id: str = ""
    spotify_redirect: str = SPOTIFY_REDIRECT
    model_provider: str = "ollama"  # "ollama", "anthropic" (Claude) or "openai" (GPT)
    model_name: str = "qwen3-vl:8b-instruct"
    model_effort: str = "low"  # Claude: low | medium | high (more is slower)
    voice_on: bool = True  # the microphone opens at start
    pc_react: bool = True  # she reacts to the PC: processor, battery, network, USB, devices, games ([avatar] reaccionar_pc)
    voice_model: str = "turbo"  # faster-whisper model
    voice_dir: str = ""  # where the model is downloaded ("" = the Hugging Face cache)
    voice_silence_ms: int = 900  # silence that ends a sentence (600 cut "pon... algo de Bad Bunny" in two)
    voice_wake: bool = True  # only what starts with "hey Capri" counts
    voice_names: tuple[str, ...] = ("capri",)  # what she answers to (compared loosely: "Kapri", "Capry")
    voice_log: bool = True  # voz.log: what she heard that was meant for her
    speak: bool = True  # with the voice on, she answers out loud
    tts_voice: str = "capri"  # one of voices.CATALOG ([voz] voz)
    tts_dir: str = r"D:\capri-models\tts"  # Kokoro's model (and tuned voices)
    tts_speed: float = 1.0
    tts_robot: float = 0.0  # her metallic touch, 0-1
    tts_glitch: float = 0.0  # how often her voice stutters, 0-1

    def quiet_now(self, now: datetime) -> bool:
        if not self.quiet:
            return False
        start, end, t = *self.quiet, now.time()
        return start <= t < end if start < end else t >= start or t < end


def parse_quiet(text: str) -> tuple[time, time] | None:
    """"23:00-08:00" -> (23:00, 08:00); "" -> None."""
    if not text.strip():
        return None
    a, b = (time.fromisoformat(part.strip().zfill(5)) for part in text.split("-"))
    return a, b


def path() -> Path:
    return Path(os.environ.get("CAPRI_CONFIG", DIR / "config.toml"))


def load() -> Settings:
    p = path()
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
    data = tomllib.loads(p.read_text(encoding="utf-8"))
    cal = data.get("calendario", {})
    pro = data.get("proactividad", {})
    return Settings(
        apps={k.lower(): v for k, v in data.get("apps", {}).items()},
        routines={**DEFAULT_ROUTINES, **{
            name.lower(): Routine(tuple(str(f) for f in r.get("frases", [f"modo {name}"])), tuple(str(a) for a in r.get("apps", [])),
                                  str(r.get("musica", "")), str(r.get("tipo", "cancion")))
            for name, r in data.get("rutinas", {}).items()}},
        scripts={k.lower(): v for k, v in data.get("scripts", {}).items()},
        calendar_url=cal.get("url", ""),
        remind_minutes=int(cal.get("aviso_minutos", 10)),
        proactive=bool(pro.get("activa", True)),
        proactive_per_hour=int(pro.get("max_por_hora", 2)),
        idle_hours=float(pro.get("inactividad_horas", 2)),
        quiet=parse_quiet(pro.get("silencio", "23:00-08:00")),
        spotify_client_id=data.get("spotify", {}).get("client_id", ""),
        spotify_redirect=data.get("spotify", {}).get("redirect_uri", SPOTIFY_REDIRECT),
        model_provider=data.get("modelo", {}).get("proveedor", "ollama"),
        model_name=data.get("modelo", {}).get("nombre", "qwen3-vl:8b-instruct"),
        model_effort=data.get("modelo", {}).get("esfuerzo", "low"),
        voice_on=bool(data.get("voz", {}).get("activa", True)),
        pc_react=bool(data.get("avatar", {}).get("reaccionar_pc", True)),
        voice_model=data.get("voz", {}).get("modelo", "turbo"),
        voice_dir=data.get("voz", {}).get("carpeta_modelo", ""),
        voice_silence_ms=int(data.get("voz", {}).get("silencio_ms", 900)),
        voice_wake=bool(data.get("voz", {}).get("llamada", True)),
        voice_names=tuple(n.lower() for n in data.get("voz", {}).get("nombres", ["capri"]) if n.strip()) or ("capri",),
        voice_log=bool(data.get("voz", {}).get("registro", True)),
        speak=bool(data.get("voz", {}).get("hablar", True)),
        tts_voice=_voice(data.get("voz", {})),
        tts_dir=str(data.get("voz", {}).get("carpeta_tts", r"D:\capri-models\tts")),
        tts_speed=min(1.5, max(0.7, float(data.get("voz", {}).get("velocidad", 1.0)))),
        tts_robot=min(1.0, max(0.0, float(data.get("voz", {}).get("robot", 0.0)))),
        tts_glitch=min(1.0, max(0.0, float(data.get("voz", {}).get("glitch", 0.0)))),
    )


def _voice(voz: dict) -> str:
    """[voz] voz, or what the older motor + voz_tts meant: Kokoro with her tuned style or its stock ones, else her clone."""
    from app import voices

    if "voz" in voz:
        return voices.get(str(voz["voz"])).id
    if voz.get("motor") == "kokoro":
        return "capri_ligera" if voz.get("voz_tts", "capri") else "dora"
    return voices.DEFAULT


def set_value(section: str, key: str, value: str | bool | float) -> None:
    """Writes `key = value` in [section], keeping the rest of the file (and its comments) as it is."""
    load()  # creates the file if needed
    p = path()
    text = p.read_text(encoding="utf-8")
    line = f"{key} = {json.dumps(value, ensure_ascii=False)}"  # a TOML basic string is JSON-compatible
    head = re.search(rf"^\[{re.escape(section)}\]\s*$", text, re.M)
    if not head:
        text = text.rstrip() + f"\n\n[{section}]\n{line}\n"
    else:
        nxt = re.search(r"^\[", text[head.end():], re.M)
        end = head.end() + (nxt.start() if nxt else len(text) - head.end())
        body = text[head.end():end]
        key_line = re.compile(rf"^{re.escape(key)}\s*=.*$", re.M)
        body = key_line.sub(lambda _: line, body, count=1) if key_line.search(body) else f"\n{line}" + body
        text = text[:head.end()] + body + text[end:]
    p.write_text(text, encoding="utf-8")


def calendar_source(text: str) -> str:
    """What the calendar is read from: an iCal address (https, or webcal as Apple gives it), a .ics file on this PC,
    or "outlook" (Outlook for Windows, the classic one). Whether an address is public is checked when it's read."""
    t = text.strip().strip('"').strip()
    if t.lower() == "outlook":
        return "outlook"
    if t.lower().startswith("webcal://"):
        t = "https://" + t[len("webcal://"):]
    if re.match(r"^https://[^\s/]+\.[^\s/]+/\S*$", t, re.I):
        return t
    if Path(t).suffix.lower() == ".ics" and Path(t).is_file():
        return str(Path(t))
    raise ValueError("no es una dirección iCal (https o webcal), un archivo .ics de este PC ni «outlook»")


def save_calendar_url(url: str) -> None:
    set_value("calendario", "url", calendar_source(url))
