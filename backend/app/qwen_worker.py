"""Her cloned voice in its own process, run with the Qwen3-TTS env's Python (torch cu128, faster-qwen3-tts), not
the backend's (speech.qwen starts it):

    python -I qwen_worker.py <model dir> <voice.wav> <voice.txt>

stdin: a JSON line per sentence, {"text", "lang"}, or {"stop": true} to cut the one being made.
stdout: frames, a little-endian int32 n then n bytes of float32 PCM at 24 kHz; n = 0 ends a sentence (the first
one says it's ready), n = -1 means that sentence failed. It ends when stdin closes (and so with the backend)."""

import json
import os
import queue
import struct
import sys
import threading
import traceback

LANGS = {"es": "Spanish", "en": "English"}


def main() -> None:
    out = os.fdopen(os.dup(1), "wb")
    os.dup2(2, 1)  # whatever the libraries print goes to the log, not into her audio

    import numpy as np
    from faster_qwen3_tts import FasterQwen3TTS

    def frame(data: bytes = b"", n: int | None = None) -> None:
        out.write(struct.pack("<i", len(data) if n is None else n) + data)
        out.flush()

    model, wav, txt = sys.argv[1:4]
    tts = FasterQwen3TTS.from_pretrained(model, local_files_only=True)
    with open(txt, encoding="utf-8") as f:
        voice = dict(ref_audio=wav, ref_text=f.read().strip(), append_silence=False)  # True runs away (minutes of audio)

    def say(text: str, lang: str):
        steps = 40 + 3 * len(text)  # 12 steps a second of her: room for slow speech, none for a runaway
        return tts.generate_voice_clone_streaming(text=text, language=LANGS.get(lang, "Spanish"), chunk_size=4,
                                                  max_new_tokens=steps, **voice)

    for _ in say("Hola.", "es"):  # captures the CUDA graphs and caches her recording
        pass
    frame()

    requests: queue.Queue = queue.Queue()
    stop = threading.Event()

    def read() -> None:
        for line in sys.stdin:
            req = json.loads(line)
            if req.get("stop"):
                stop.set()  # comes before the next sentence: it's for the one being made
            else:
                requests.put(req)
        requests.put(None)

    threading.Thread(target=read, daemon=True).start()
    while (req := requests.get()) is not None:
        stop.clear()
        try:
            for audio, _, _ in say(req["text"], req.get("lang", "es")):
                if stop.is_set():
                    break
                frame(np.asarray(audio, dtype="<f4").reshape(-1).tobytes())
            frame()
        except Exception:
            traceback.print_exc()
            frame(n=-1)


if __name__ == "__main__":
    main()
