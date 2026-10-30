"""Builds the README's pictures (docs/img) from the project's own assets: python scripts/build_readme_assets.py
(uv run --project backend python scripts/build_readme_assets.py)."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
A = ROOT / "avatar" / "assets"
OUT = ROOT / "docs" / "img"
BG = (11, 9, 22)


def clips(name: str) -> list[Image.Image]:
    return [Image.open(p).convert("RGBA") for p in sorted((A / "pet" / "anim" / name).glob("*.png"))]


def strip(name: str, w: int, h: int) -> list[Image.Image]:
    im = Image.open(A / "camera" / f"{name}.webp").convert("RGBA")
    return [im.crop((i * w, 0, i * w + w, h)) for i in range(im.width // w)]


def on_dark(frame: Image.Image, scale: int, pad: int = 0) -> Image.Image:
    f = frame.resize((frame.width * scale, frame.height * scale), Image.NEAREST)
    bg = Image.new("RGBA", (f.width + 2 * pad, f.height + 2 * pad), BG + (255,))
    bg.alpha_composite(f, (pad, pad))
    return bg.convert("P", palette=Image.ADAPTIVE)


def gif(name: str, frames: list[Image.Image], ms: int) -> None:
    frames[0].save(OUT / name, save_all=True, append_images=frames[1:], duration=ms, loop=0, optimize=True, disposal=2)


def glow_bg(w: int, h: int) -> Image.Image:
    img = Image.new("RGBA", (w, h), BG + (255,))
    over = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    d.polygon([(0, h), (w * 0.35, h), (0, h * 0.55)], fill=(162, 75, 255, 70))
    d.polygon([(w, 0), (w * 0.62, 0), (w, h * 0.5)], fill=(182, 255, 59, 40))
    img.alpha_composite(over)
    lines = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(lines).line([(0, y) for y in range(0, h, 4)] and [(0, 0)], fill=(0, 0, 0, 0))
    for y in range(0, h, 4):
        ImageDraw.Draw(lines).line([(0, y), (w, y)], fill=(255, 255, 255, 7))
    img.alpha_composite(lines)
    return img


def banner() -> None:
    w, h = 1600, 520
    img = glow_bg(w, h)
    chip = Image.open(ROOT / "installer" / "ui" / "img" / "chip.png").convert("RGBA")
    chip = chip.resize((900, round(chip.height * 900 / chip.width)), Image.LANCZOS)
    img.alpha_composite(chip, (60, 250))
    capri = Image.open(A / "original" / "idle.webp").convert("RGBA").crop((0, 0, 240, 384))
    capri = capri.resize((340, 544), Image.LANCZOS).crop((0, 0, 340, 520))
    img.alpha_composite(capri, (1000, 0))
    pix = clips("saludar")[0]
    pix = pix.resize((pix.width * 3, pix.height * 3), Image.NEAREST)
    img.alpha_composite(pix, (1255, 190))
    d = ImageDraw.Draw(img)
    d.text((70, 90), "PROYECTO CAPRI // DESKTOP", fill=(182, 255, 59, 255), font_size=54)
    d.text((70, 160), "una IA que vive en tu PC, dentro de un biochip", fill=(236, 233, 246, 255), font_size=26)
    img.convert("RGB").save(OUT / "banner.png", optimize=True)


def poses() -> None:
    names = ["feliz", "emocionada", "traviesa", "curiosa", "sorprendida", "enamorada", "triste", "molesta", "peligro", "seria", "pensativa", "guino"]
    cell = 108 * 2 + 16
    img = Image.new("RGBA", (cell * 6, cell * 2), BG + (255,))
    for i, n in enumerate(names):
        c = clips(n)
        f = c[len(c) // 2]
        f = f.resize((f.width * 2, f.height * 2), Image.NEAREST)
        img.alpha_composite(f, ((i % 6) * cell + 8, (i // 6) * cell + 8))
    img.convert("RGB").save(OUT / "emociones.png", optimize=True)


def scene() -> None:
    im = Image.open(A / "intro" / "wave2.webp").convert("RGB")
    im.resize((960, round(im.height * 960 / im.width)), Image.LANCZOS).save(OUT / "escena.jpg", quality=88)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    banner()
    poses()
    scene()
    gif("pixel.gif", [on_dark(f, 3, 12) for n in ("saludar", "feliz", "traviesa") for f in clips(n)], 110)
    cam = [f for n in ("mira", "sonrisa", "risa") for f in strip(n, 360, 240)[:10]]
    gif("camara.gif", [f.convert("RGB").convert("P", palette=Image.ADAPTIVE) for f in cam], 100)
    f = Image.open(A / "original" / "idle.webp").convert("RGBA").crop((0, 0, 240, 384))
    f = f.crop(f.getbbox())
    bg = Image.new("RGBA", (f.width + 40, f.height + 40), BG + (255,))
    bg.alpha_composite(f, (20, 20))
    bg.convert("RGB").save(OUT / "original.png", optimize=True)
    print(*(f"{p.name} {p.stat().st_size // 1024} KB" for p in sorted(OUT.iterdir())), sep="\n")
