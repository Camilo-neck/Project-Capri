"""Her voice, side by side: the same lines with Kokoro and Piper voices on the CPU, as .wav files to listen to,
with how long each takes. Downloads the models once (authorized 28/10/2026) to D:\\capri-models\\tts.

    uv run --project backend --with kokoro-onnx --with piper-tts python scripts/bench_voice.py [--dir D:\\capri-models\\tts]
"""

import argparse
import time
import urllib.request
import wave
from pathlib import Path

import numpy as np

KOKORO = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
PIPER = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
PIPER_VOICES = {
    "es_AR-daniela-high": "es/es_AR/daniela/high/",
    "es_MX-claude-high": "es/es_MX/claude/high/",
    "en_US-amy-medium": "en/en_US/amy/medium/",
}
LINES = {
    "es1": ("es", "¡Hola, C! Ya te abrí Spotify; ¿quieres que ponga algo de Bad Bunny?"),
    "es2": ("es", "Mmm… hoy en Bogotá está nublado, entre 13 y 18 grados."),
    "en": ("en", "Hey! I opened it for you. Want me to play something?"),
}


def fetch(url: str, to: Path) -> Path:
    if not to.exists():
        print(f"downloading {to.name}...")
        to.parent.mkdir(parents=True, exist_ok=True)
        tmp = to.with_suffix(to.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.rename(to)
    return to


def save(path: Path, audio: np.ndarray, rate: int) -> None:
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2") if audio.dtype != np.int16 else audio
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=r"D:\capri-models\tts")
    root = Path(ap.parse_args().dir)
    out = root / "bench"
    out.mkdir(parents=True, exist_ok=True)

    voices = []  # (name, lang, synth(text) -> (audio, rate))
    try:
        from kokoro_onnx import Kokoro

        t = time.perf_counter()
        k = Kokoro(str(fetch(KOKORO + "kokoro-v1.0.onnx", root / "kokoro-v1.0.onnx")),
                   str(fetch(KOKORO + "voices-v1.0.bin", root / "voices-v1.0.bin")))
        print(f"kokoro loaded in {time.perf_counter() - t:.1f} s")
        voices += [("kokoro-ef_dora", "es", lambda s: k.create(s, voice="ef_dora", speed=1.0, lang="es")),
                   ("kokoro-af_heart", "en", lambda s: k.create(s, voice="af_heart", speed=1.0, lang="en-us"))]
    except Exception as e:
        print(f"kokoro unavailable: {e}")
    try:
        from piper import PiperVoice

        for name, sub in PIPER_VOICES.items():
            model = fetch(f"{PIPER}{sub}{name}.onnx", root / f"{name}.onnx")
            fetch(f"{PIPER}{sub}{name}.onnx.json", root / f"{name}.onnx.json")
            v = PiperVoice.load(str(model))

            def synth(s: str, v=v):
                chunks = list(v.synthesize(s))
                return np.concatenate([c.audio_float_array for c in chunks]), chunks[0].sample_rate

            voices.append((f"piper-{name}", name[:2], synth))
    except Exception as e:
        print(f"piper unavailable: {e}")

    print(f"\n{'voice':28} {'line':5} {'synth s':>8} {'audio s':>8} {'RTF':>6}")
    for name, lang, synth in voices:
        for key, (line_lang, text) in LINES.items():
            if line_lang != lang:
                continue
            synth("Hola.")  # warm-up: the first call pays for loading
            t = time.perf_counter()
            audio, rate = synth(text)
            took = time.perf_counter() - t
            secs = len(audio) / rate
            save(out / f"{name}-{key}.wav", np.asarray(audio), rate)
            print(f"{name:28} {key:5} {took:8.2f} {secs:8.2f} {took / secs:6.2f}")
    print(f"\nwav files in {out}")


if __name__ == "__main__":
    main()
