"""Cut the pet sprites out of the reference sheet (avatar/assets/pet/source.png).

Run: uv run --project backend python scripts/slice_pet.py
Background is removed by flood fill from each crop's border, so whites inside the
sprite (eyes, teeth) survive. Original colors are kept (palette reduction dulled the
green). Every sprite lands bottom-centered on the same canvas.
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "avatar" / "assets" / "pet"
BG = np.array([229, 227, 230])
CANVAS = (240, 250)  # w, h: every sprite shares it so swapping frames never jumps

# name: (x0, y0, x1, y1) in the sheet, from the empty-gap scan of the three rows
SPRITES = {
    "meditar": (26, 94, 181, 328),
    "recostada": (202, 94, 399, 328),
    "dormir": (420, 94, 591, 328),
    "sentada_a": (620, 94, 776, 328),
    "sentada_b": (790, 94, 956, 328),
    "confundida": (44, 432, 227, 669),
    "enamorada": (288, 432, 445, 669),
    "girando": (501, 432, 696, 669),
    "cursor": (752, 432, 927, 669),
    "asomada": (32, 766, 235, 984),
    "malabar": (279, 766, 480, 984),
    "laptop": (507, 766, 704, 984),
    "pino": (756, 766, 932, 984),
}


# The cursor's arrow is filled with the sheet gray itself: its enclosed pockets are painted white.
FILL_POCKETS_WHITE = {"cursor"}


def background(rgb: np.ndarray, tol: int = 70) -> np.ndarray:
    """Pixels close to the sheet background and connected to the crop border."""
    near = np.abs(rgb.astype(int) - BG).sum(2) < tol
    reach = np.zeros_like(near)
    reach[0, :], reach[-1, :], reach[:, 0], reach[:, -1] = near[0, :], near[-1, :], near[:, 0], near[:, -1]
    while True:
        grown = reach.copy()
        grown[1:] |= reach[:-1]
        grown[:-1] |= reach[1:]
        grown[:, 1:] |= reach[:, :-1]
        grown[:, :-1] |= reach[:, 1:]
        grown &= near
        if (grown == reach).all():
            return reach
        reach = grown


def main() -> None:
    sheet = Image.open(ROOT / "source.png").convert("RGB")
    for name, (x0, y0, x1, y1) in SPRITES.items():
        pad = 4
        crop = sheet.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad))
        rgb = np.asarray(crop)
        clear = background(rgb)
        # Enclosed pockets of the sheet's gray (e.g. between an arm and a leg). Art whites are pure
        # white, far from this gray, so eyes and teeth stay.
        pockets = (np.abs(rgb.astype(int) - BG).sum(2) < 20) & ~clear
        if name in FILL_POCKETS_WHITE:
            rgb = rgb.copy()
            rgb[pockets] = 255
        else:
            clear |= pockets
        # Light anti-aliasing halo along the outline: peel it off the edge.
        light = rgb.min(2) > 140
        for _ in range(2):
            edge = np.zeros_like(clear)
            edge[1:] |= clear[:-1]
            edge[:-1] |= clear[1:]
            edge[:, 1:] |= clear[:, :-1]
            edge[:, :-1] |= clear[:, 1:]
            clear |= edge & light
        alpha = np.where(clear, 0, 255).astype(np.uint8)
        sprite = Image.fromarray(np.dstack([rgb, alpha]), "RGBA")
        sprite = sprite.crop(sprite.getbbox())
        out = Image.new("RGBA", CANVAS)
        out.paste(sprite, ((CANVAS[0] - sprite.width) // 2, CANVAS[1] - sprite.height - 2))
        out.save(ROOT / f"{name}.png")
        print(f"{name}: {sprite.size}")


if __name__ == "__main__":
    main()
