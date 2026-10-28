"""Screen capture for Capri's look. Only runs on an explicit request (hotkey, /mira, or his click to read
a web search off his browser)."""

import ctypes
import io
import logging
import time
from ctypes import wintypes

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


class _MonitorInfo(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]


def foreground() -> Rect:
    """The window in front (the browser that just opened his search), clipped to its monitor: only that
    window is captured, not the rest of his screen."""
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # physical px like mss; fails harmlessly if already set
    user32 = ctypes.windll.user32
    hwnd = user32.GetForegroundWindow()
    win, info = wintypes.RECT(), _MonitorInfo(cbSize=ctypes.sizeof(_MonitorInfo))
    user32.GetWindowRect(hwnd, ctypes.byref(win))
    user32.GetMonitorInfoW(user32.MonitorFromWindow(hwnd, 2), ctypes.byref(info))  # 2: the nearest monitor
    m = info.rcMonitor
    rect = (max(win.left, m.left), max(win.top, m.top), min(win.right, m.right), min(win.bottom, m.bottom))
    return rect if rect[2] > rect[0] and rect[3] > rect[1] else (m.left, m.top, m.right, m.bottom)


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
