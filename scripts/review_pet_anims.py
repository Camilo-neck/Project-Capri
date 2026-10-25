"""Contact sheet of every downloaded pet clip: one row per clip, frames left to right.

Run: uv run --no-project --with pillow python scripts/review_pet_anims.py [out.png] [clip ...]
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / "avatar" / "assets" / "pet" / "anim"
SCALE = 2
LABEL = 90


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "review.png"
    names = sys.argv[2:] or sorted(p.name for p in ROOT.iterdir() if p.is_dir())
    rows = []
    for name in names:
        frames = sorted((ROOT / name).glob(f"{name}_[0-9][0-9].png"))
        rows.append((name, [Image.open(f).convert("RGBA") for f in frames]))
    cell = max(f.width for _, fs in rows for f in fs) * SCALE
    width = LABEL + cell * max(len(fs) for _, fs in rows)
    sheet = Image.new("RGBA", (width, cell * len(rows)), (30, 28, 40, 255))
    d = ImageDraw.Draw(sheet)
    for r, (name, frames) in enumerate(rows):
        d.text((6, r * cell + cell // 2), name, fill=(230, 230, 230, 255))
        for c, f in enumerate(frames):
            sheet.alpha_composite(f.resize((f.width * SCALE, f.height * SCALE), Image.NEAREST), (LABEL + c * cell, r * cell))
    sheet.save(out)
    print(out, sheet.size)


if __name__ == "__main__":
    main()
