"""Builds docs/capri-sprites.png, the sheet of her pixel animations: one row per clip in avatar/assets/pet/anim, six
frames spread over its length, at x2. Run from the root: uv run --project backend python scripts/build_sprite_sheet.py"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ANIM = ROOT / "avatar" / "assets" / "pet" / "anim"
BG, FG, DIM = (11, 9, 22), (182, 255, 59), (138, 134, 166)
SHOWN, SCALE, PAD, LABEL = 6, 2, 8, 150


def main() -> None:
    rows = []
    for folder in sorted(p for p in ANIM.iterdir() if p.is_dir()):
        frames = [Image.open(f).convert("RGBA") for f in sorted(folder.glob("*.png"))]
        box = None
        for f in frames:
            b = f.getbbox()
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
        picks = sorted({round(i * (len(frames) - 1) / max(1, SHOWN - 1)) for i in range(min(SHOWN, len(frames)))})
        rows.append((folder.name, len(frames), box, [frames[i].crop(box) for i in picks]))
    cell = max((r[2][2] - r[2][0]) for r in rows) * SCALE + PAD
    height = max((r[2][3] - r[2][1]) for r in rows) * SCALE + PAD
    sheet = Image.new("RGBA", (LABEL + SHOWN * cell, len(rows) * height), BG + (255,))
    d = ImageDraw.Draw(sheet)
    for y, (name, n, box, picks) in enumerate(rows):
        d.text((12, y * height + 14), name, fill=FG + (255,), font_size=17)
        d.text((12, y * height + 38), f"{n} fotogramas", fill=DIM + (255,), font_size=13)
        for x, f in enumerate(picks):
            f = f.resize((f.width * SCALE, f.height * SCALE), Image.NEAREST)
            sheet.alpha_composite(f, (LABEL + x * cell + PAD // 2, y * height + PAD // 2 + (height - PAD - f.height)))
    out = ROOT / "docs" / "capri-sprites.png"
    sheet.convert("RGB").save(out, optimize=True)
    print(out, sheet.size, f"{out.stat().st_size // 1024} KB")


main()
