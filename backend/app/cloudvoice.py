"""Her voice from a service he picked, with his own key: Fish Audio, ElevenLabs or OpenAI. What she says goes to it.

The key lives in the Credential Manager (or its environment variable), never in config.toml; the voice and the
model are in [voz_nube]. They all answer with mp3, so one decoder does."""

import os
import re
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import quote

import httpx
import keyring
import numpy as np

from app import settings, speech

TIMEOUT = 20
PROBE = "Hola."


@dataclass(frozen=True)
class Service:
    nombre: str
    env: str
    modelo: str
    voz: str  # its default, or "" when he has to bring one
    pide_voz: bool
    ayuda: str
    web: str  # where its keys are


SERVICES = {
    "fish": Service("Fish Audio", "FISH_API_KEY", "s2.1-pro-free", "", False,
                    "Voz: su ID o enlace de fish.audio; vacía usa la de Fish. s2.1-pro-free es su modelo gratis.",
                    "https://fish.audio/app/api-keys"),
    "elevenlabs": Service("ElevenLabs", "ELEVENLABS_API_KEY", "eleven_flash_v2_5", "", True,
                          "Voz: el Voice ID de tu voz (Voices › Copy Voice ID). Gasta tus créditos.",
                          "https://elevenlabs.io/app/settings/api-keys"),
    "openai": Service("OpenAI", "OPENAI_API_KEY", "gpt-4o-mini-tts", "marin", False,
                      "Voz: marin, cedar, coral... Es de pago y usa la misma clave que GPT.",
                      "https://platform.openai.com/api-keys"),
}


@dataclass
class Info:
    """A service as the panel shows it: whether there's a key, never the key."""

    id: str
    nombre: str
    clave: bool
    voz: str
    modelo: str
    modelo_base: str
    pide_voz: bool
    ayuda: str
    web: str


class CloudVoiceError(Exception):
    pass


def key(service: str) -> str:
    return os.environ.get(SERVICES[service].env, "") or keyring.get_password("capri", service) or ""


def chosen(service: str) -> tuple[str, str]:
    """(voice, model) he set, or the service's own."""
    s, saved = SERVICES[service], settings.load().cloud_voices
    return saved.get(f"{service}_voz", "") or s.voz, saved.get(f"{service}_modelo", "") or s.modelo


def ready(service: str) -> str:
    """What's missing for a voice ("" when it can talk)."""
    if not key(service):
        return "Falta tu clave: ponla abajo, en Voces en la nube."
    return "Falta el ID de tu voz: ponlo abajo, en Voces en la nube." if SERVICES[service].pide_voz and not chosen(service)[0] else ""


def save(service: str, clave: str, voz: str, modelo: str) -> None:
    """A new key if he typed one (empty keeps the one there is), and the voice and model."""
    if service not in SERVICES:
        raise ValueError(service)
    if clave.strip():
        keyring.set_password("capri", service, clave.strip())
    settings.set_value("voz_nube", f"{service}_voz", voz.strip())
    settings.set_value("voz_nube", f"{service}_modelo", modelo.strip())


def info() -> list[Info]:
    saved = settings.load().cloud_voices
    return [Info(i, s.nombre, bool(key(i)), saved.get(f"{i}_voz", ""), saved.get(f"{i}_modelo", ""), s.modelo, s.pide_voz, s.ayuda, s.web)
            for i, s in SERVICES.items()]


def _post(name: str, url: str, headers: dict, body: dict) -> bytes:
    try:
        r = httpx.post(url, headers=headers, json=body, timeout=TIMEOUT)
    except httpx.HTTPError:
        raise CloudVoiceError(f"No llego a {name}: revisa tu internet.") from None
    why = {401: f"{name} rechazó la clave.", 402: f"{name} pide saldo para ese modelo.", 403: f"{name} no deja usar esa voz o modelo con tu cuenta.",
           404: f"{name} no encuentra esa voz.", 422: f"{name} no acepta esa voz o ese modelo.", 429: f"{name} está ocupado o se acabó tu cupo."}
    if r.status_code != 200:
        raise CloudVoiceError(why.get(r.status_code, f"{name} respondió con el error {r.status_code}."))
    return r.content


def _fish(text: str, token: str, voz: str, modelo: str) -> tuple[str, dict, dict]:
    link = re.search(r"[0-9a-f]{32}", voz)  # its pages are fish.audio/m/<id>
    body = {"text": text, "format": "mp3", "latency": "balanced", **({"reference_id": link[0] if link else voz} if voz else {})}
    return "https://api.fish.audio/v1/tts", {"Authorization": f"Bearer {token}", "model": modelo}, body


def _elevenlabs(text: str, token: str, voz: str, modelo: str) -> tuple[str, dict, dict]:
    return f"https://api.elevenlabs.io/v1/text-to-speech/{quote(voz, safe='')}", {"xi-api-key": token}, {"text": text, "model_id": modelo}


def _openai(text: str, token: str, voz: str, modelo: str) -> tuple[str, dict, dict]:
    body = {"model": modelo, "voice": voz, "input": text, "response_format": "mp3"}
    return "https://api.openai.com/v1/audio/speech", {"Authorization": f"Bearer {token}"}, body


REQUESTS = {"fish": _fish, "elevenlabs": _elevenlabs, "openai": _openai}


def synth(service: str) -> Callable[[str, str, float], tuple[np.ndarray, int]]:
    """The engine for a service (each one speaks at its own pace, so `speed` doesn't reach it). It raises when the
    service fails: voices.make falls back to Dora."""
    voz, modelo = chosen(service)
    token = key(service)

    def say(text: str, lang: str, speed: float = 1.0) -> tuple[np.ndarray, int]:
        return speech._decode_mp3(_post(SERVICES[service].nombre, *REQUESTS[service](text, token, voz, modelo))), 24000

    return say


def probe(service: str) -> None:
    """A short line through the service, so a wrong key shows up when he saves it. It raises CloudVoiceError."""
    synth(service)(PROBE, "es")
