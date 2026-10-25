"""Screen capture for Capri's look. Only runs on an explicit request (hotkey or /mira)."""

import io
import logging
import time

import mss
from PIL import Image

log = logging.getLogger(__name__)

WIDTH = 1280  # a 1280x720 shot is ~900 tokens for the VLM

# Physical px on the virtual screen: left, top, right, bottom.
Rect = tuple[int, int, int, int]


def encode(img: Image.Image) -> bytes:
    """Shrinks to WIDTH px wide (never enlarges) and encodes as JPEG."""
    if img.width > WIDTH:
        img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=85)
    return buf.getvalue()


def capture(rect: Rect) -> bytes:
    left, top, right, bottom = rect
    t0 = time.perf_counter()
    with mss.MSS() as sct:
        shot = sct.grab({"left": left, "top": top, "width": right - left, "height": bottom - top})
    t1 = time.perf_counter()
    data = encode(Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX"))
    log.info("capture %dx%d: grab %.0f ms, shrink+encode %.0f ms, %d KB",
             shot.width, shot.height, (t1 - t0) * 1000, (time.perf_counter() - t1) * 1000, len(data) // 1024)
    return data
