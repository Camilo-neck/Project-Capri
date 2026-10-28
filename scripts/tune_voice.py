"""Her own voice without training anything: searches Kokoro's style space for the voice that sounds most like a
recording. Kokoro voices are style vectors; this scores each one (and blends of the best) against the recording
with a speaker-embedding model (resemblyzer, local), then walks the best one in small random steps, keeping
what gets closer. It copies the timbre, not the delivery or the effects (those are [voz] robot / glitch).

Leaves <dir>/<name>.npy (use it with [voz] voz_tts = "<name>") and samples in <dir>/bench/.

resemblyzer pulls torch and a package that won't build on Windows, so it gets its own venv, outside Capri's:
    uv venv tune && uv pip install --python tune resemblyzer --no-deps
    uv pip install --python tune torch librosa webrtcvad-wheels kokoro-onnx av
    tune/Scripts/python scripts/tune_voice.py "D:/capri-models/tts/CapriVoice/Capri-Voice.mp3" [--steps 400]
"""

import argparse
import time
import wave
from pathlib import Path

import av
import numpy as np

# scored lines: said the way she says things, in the recording's language and in Spanish (she'll speak both)
LINES = [
    ("en-us", "Come on, let's be friends! Yesterday was so much fun."),
    ("en-us", "Nobody can hear me, nobody can see me. Nobody besides you."),
    ("en-us", "Hey, don't look at me like that. I'm just trying to help!"),
    ("en-us", "What does that matter? I had a total blast, so you did too."),
    ("es", "¡Oye, no me ignores! Ya te abrí Spotify, ¿qué quieres escuchar?"),
    ("es", "Jajaja, ¿en serio? Bueno, déjame ver qué encuentro."),
]
# held out: what the walk keeps is chosen on these, so it doesn't just fit the lines above
CHECK = [
    ("en-us", "So they created me! Powerful like an AI, but born of humans."),
    ("en-us", "I tried? Doesn't mean I actually did."),
    ("es", "Mmm… hoy en Bogotá está nublado. ¿Salimos igual?"),
]


def load(path: str, rate: int) -> np.ndarray:
    out = []
    with av.open(path) as c:
        rs = av.AudioResampler(format="flt", layout="mono", rate=rate)
        for frame in c.decode(audio=0):
            out += [f.to_ndarray().reshape(-1) for f in rs.resample(frame)]
        out += [f.to_ndarray().reshape(-1) for f in rs.resample(None)]
    return np.concatenate(out)


def save(path: Path, audio: np.ndarray, rate: int) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--dir", default=r"D:\capri-models\tts")
    ap.add_argument("--name", default="capri")
    ap.add_argument("--steps", type=int, default=400)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    root = Path(args.dir)

    import librosa
    from kokoro_onnx import Kokoro
    from resemblyzer import VoiceEncoder, preprocess_wav

    enc = VoiceEncoder("cpu", verbose=False)
    target = enc.embed_utterance(preprocess_wav(load(args.audio, 16000), source_sr=16000))
    k = Kokoro(str(root / "kokoro-v1.0.onnx"), str(root / "voices-v1.0.bin"))
    names = sorted(k.get_voices())
    bank = np.stack([k.voices[n] for n in names])  # (voices, 510, 1, 256)
    lo, hi, spread = bank.min(0), bank.max(0), bank.std(0)

    def similarity(style: np.ndarray, lines=LINES) -> float:
        sims = []
        for lang, text in lines:
            audio, rate = k.create(text, voice=style.astype("float32"), speed=1.0, lang=lang)
            wav = preprocess_wav(librosa.resample(np.asarray(audio, dtype="float32"), orig_sr=rate, target_sr=16000), source_sr=16000)
            sims.append(float(enc.embed_utterance(wav) @ target))
        return float(np.mean(sims))

    t0 = time.perf_counter()
    scored = sorted(((similarity(v), n, v) for n, v in zip(names, bank)), key=lambda x: -x[0])
    print("voices closest to the recording:")
    for s, n, _ in scored[:8]:
        print(f"  {n:12} {s:.3f}")

    top = scored[:4]
    best_score, best_name, best = top[0]
    for i in range(len(top)):
        for j in range(i + 1, len(top)):
            for w in (0.25, 0.5, 0.75):
                s = similarity(w * top[i][2] + (1 - w) * top[j][2])
                if s > best_score:
                    best_score, best_name, best = s, f"{w:.2f} {top[i][1]} + {1 - w:.2f} {top[j][1]}", w * top[i][2] + (1 - w) * top[j][2]
    mix = sum(v for _, _, v in top[:3]) / 3
    if (s := similarity(mix)) > best_score:
        best_score, best_name, best = s, "1/3 each of " + ", ".join(n for _, n, _ in top[:3]), mix
    print(f"best blend: {best_name} ({best_score:.3f}) after {time.perf_counter() - t0:.0f} s")

    # the walk: small steps scaled to how much each value varies across Kokoro's voices, kept inside their range
    rng = np.random.default_rng(args.seed)
    scale, accepted = 0.10, 0
    out = root / f"{args.name}.npy"
    kept, kept_check = best, similarity(best, CHECK)  # what's saved: the best on the held-out lines
    print(f"held-out lines at the start: {kept_check:.3f}")
    for step in range(1, args.steps + 1):
        cand = np.clip(best + rng.standard_normal(best.shape) * spread * scale, lo, hi)
        if (s := similarity(cand)) > best_score:
            best_score, best, accepted = s, cand, accepted + 1
        if step % 25 == 0:
            if accepted and (c := similarity(best, CHECK)) > kept_check:
                kept, kept_check = best, c
                np.save(out, kept.astype("float32"))
            scale = scale * 1.2 if accepted >= 3 else max(scale * 0.8, 0.02)  # bolder while it keeps finding better
            print(f"step {step}: {best_score:.3f}, held-out {kept_check:.3f} (scale {scale:.3f}, {accepted} better)")
            accepted = 0
    np.save(out, kept.astype("float32"))
    print(f"\nheld-out lines: {kept_check:.3f} (closest stock voice {top[0][1]}: {similarity(top[0][2], CHECK):.3f})")

    # her Spanish with a Spanish voice in the mix: a little less like the recording, maybe a better accent
    dora = 0.7 * kept + 0.3 * k.voices["ef_dora"]
    np.save(root / f"{args.name}-dora.npy", dora.astype("float32"))
    print(f"{args.name}-dora (70 % + 30 % ef_dora): held-out {similarity(dora, CHECK):.3f}")
    (root / "bench").mkdir(exist_ok=True)
    for style, tag in ((kept, args.name), (dora, f"{args.name}-dora")):
        for i, (lang, text) in enumerate(CHECK + LINES[-2:]):
            audio, rate = k.create(text, voice=style.astype("float32"), speed=1.0, lang=lang)
            save(root / "bench" / f"{tag}-{i}-{lang[:2]}.wav", np.asarray(audio), rate)
    print(f"saved {out}, {args.name}-dora.npy and samples in {root / 'bench'} ({time.perf_counter() - t0:.0f} s)")


if __name__ == "__main__":
    main()
