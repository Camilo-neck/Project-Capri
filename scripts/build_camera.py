"""Builds the camera mode's shots (avatar/assets/camera/*.webp) from frames of the show.

Source: the "Capri Cyberpunk2" GIF on Tenor (Edgerunners 2 footage, 148 frames, 498x498), the one
mochiiwuff/capri-desktop cut its faces from:
https://media1.tenor.com/m/TOW1CCj7DREAAAAC/capri-cyberpunk2-cyberpunk-2.gif

    uv run --project backend python scripts/build_camera.py path/to/capri.gif   (from the repo root)

Each shot is a strip of 3:2 frames, 360x240, side by side (WebP: at most 45 of them). Keep SHOTS in sync with
avatar/src/state/camera.ts (frame counts).
"""

import sys
from pathlib import Path

from PIL import Image, ImageSequence

OUT = Path(__file__).resolve().parent.parent / "avatar" / "assets" / "camera"
SIZE = (360, 240)
SRC = 498  # the GIF's side; crops below are for it

# name: (first frame, last frame, top of the 498x332 crop[, every nth frame])
SHOTS = {
    "escucha": (0, 19, 70),  # wide: her small face among the mane and its sparkles, eyes on you
    "lado": (26, 30, 94),  # turned away, the fang: thinking it over, a sigh
    "piensa": (36, 85, 40, 2),  # looking down and aside, mane drifting: working on it (a near hold)
    "gira": (87, 95, 83),  # turning to the camera
    "mira": (96, 101, 83),  # close, looking right at you, the zigzag above
    "muchos": (127, 133, 83),  # her face covered in eyes
    "ojos": (134, 135, 83),  # extreme close-up of the big eyes
    "risa": (136, 138, 60),  # mouth wide open, laughing
    "sonrisa": (139, 147, 24),  # wide again, the jagged grin
}


def main() -> None:
    gif = Image.open(sys.argv[1])
    if gif.size != (SRC, SRC):
        sys.exit(f"expected a {SRC}x{SRC} GIF, got {gif.size}")
    frames = [f.convert("RGB") for f in ImageSequence.Iterator(gif)]
    OUT.mkdir(parents=True, exist_ok=True)
    h = SRC * SIZE[1] // SIZE[0]
    for name, (a, b, top, *step) in SHOTS.items():
        cells = [frames[i].crop((0, top, SRC, top + h)).resize(SIZE, Image.LANCZOS) for i in range(a, b + 1, *step)]
        strip = Image.new("RGB", (SIZE[0] * len(cells), SIZE[1]))
        for i, c in enumerate(cells):
            strip.paste(c, (i * SIZE[0], 0))
        path = OUT / f"{name}.webp"
        strip.save(path, "WEBP", quality=82, method=6)
        print(f"{name}: {len(cells)} frames, {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
