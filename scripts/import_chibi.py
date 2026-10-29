"""Replaces avatar/assets/pet/anim with the chibi Capri clips listed in scripts/chibi_manifest.json (PixelLab).

Run: uv run --no-project --with pillow python scripts/import_chibi.py
Each clip is [state, animation id, frames, optional frames to keep]; frame 0 is the pose it starts from. Writes
<clip>/<clip>_NN.png (96-136 px canvases: avatar/src/render/pet.ts measures each clip's feet, so sizes may differ),
and prints the frame counts for avatar/src/pet/clips.ts.
"""

import json
import shutil
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "avatar" / "assets" / "pet" / "anim"
HOST = "https://backblaze.pixellab.ai/file/pixellab-characters/a3d8b7b1-2cc5-4b48-b444-b77e31eb1d8b"


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})  # the file host rejects Python's default
    return urllib.request.urlopen(req).read()


def strip_bench(png: Path) -> None:
    """The laptop pose came with the bench it sits on (brown top, navy front): she sits on a window's corner, so
    it goes. Brown anywhere, and the navy below the laptop's own."""
    from PIL import Image

    im = Image.open(png).convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            # below her hands only her legs remain (close to the middle): the bench's outline ran past them
            if a and ((r, g, b) == (154, 104, 67) or (y >= 96 and (r, g, b) == (44, 52, 104)) or (y >= 84 and abs(x - im.width // 2) > (17 if y < 96 else 12))):
                px[x, y] = (0, 0, 0, 0)
    im.save(png)


def main() -> None:
    manifest = json.loads((ROOT / "scripts" / "chibi_manifest.json").read_text(encoding="utf-8"))
    if OUT.exists():
        shutil.rmtree(OUT)
    for name, (state, anim, frames, *keep) in manifest["clips"].items():
        folder = OUT / name
        folder.mkdir(parents=True)
        wanted = keep[0] if keep else range(frames)
        for n, i in enumerate(wanted, 1):
            (folder / f"{name}_{n:02d}.png").write_bytes(fetch(f"{HOST}/{manifest['chars'][state]}/animations/{anim}/south/{i}.png"))
            if name == "escribir":
                strip_bench(folder / f"{name}_{n:02d}.png")
        print(f"{name}: {len(list(wanted))}")
    # taking the laptop out: she had none, then she has it (no clip of its own: two frames)
    pop = OUT / "abrir_portatil"
    pop.mkdir()
    shutil.copy(OUT / "sentada_idle" / "sentada_idle_01.png", pop / "abrir_portatil_01.png")
    shutil.copy(OUT / "escribir" / "escribir_01.png", pop / "abrir_portatil_02.png")
    print("abrir_portatil: 2")


if __name__ == "__main__":
    main()
