"""Download a PixelLab animation job into avatar/assets/pet/anim/<name>/ and build review files.

Run: uv run --no-project --with pillow python scripts/fetch_pet_anim.py <name> <url> [<url> ...]
     uv run --no-project --with pillow python scripts/fetch_pet_anim.py <name> --pattern <url with {i}> <count>
Each url is one frame, in order; --pattern takes get_character's ".../{i}.png?t=..." link and the
frame count (i = 0..count-1). Writes <name>_01.png ..., plus <name>_strip.png (frames side by side)
and <name>.gif (both 4x, for review only).
"""

import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / "avatar" / "assets" / "pet" / "anim"
REVIEW_SCALE = 4


def main() -> None:
    name, urls = sys.argv[1], sys.argv[2:]
    if urls and urls[0] == "--pattern":
        urls = [urls[1].replace("{i}", str(i)) for i in range(int(urls[2]))]
    out = ROOT / name
    out.mkdir(parents=True, exist_ok=True)
    frames = []
    for i, url in enumerate(urls, 1):
        path = out / f"{name}_{i:02d}.png"
        # PixelLab's file host rejects Python's default user agent (403).
        req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
        with urllib.request.urlopen(req) as r:
            path.write_bytes(r.read())
        frames.append(Image.open(path).convert("RGBA"))
    w, h = frames[0].size
    big = [f.resize((w * REVIEW_SCALE, h * REVIEW_SCALE), Image.NEAREST) for f in frames]
    strip = Image.new("RGBA", (w * REVIEW_SCALE * len(big), h * REVIEW_SCALE), (30, 28, 40, 255))
    for i, f in enumerate(big):
        strip.alpha_composite(f, (i * w * REVIEW_SCALE, 0))
    strip.save(out / f"{name}_strip.png")
    bg = [Image.alpha_composite(Image.new("RGBA", f.size, (30, 28, 40, 255)), f).convert("P") for f in big]
    bg[0].save(out / f"{name}.gif", save_all=True, append_images=bg[1:], duration=125, loop=0)
    print(f"{len(frames)} frames -> {out}")


if __name__ == "__main__":
    main()
