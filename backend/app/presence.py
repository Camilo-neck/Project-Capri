"""Is the user at the PC? Seconds since the last keyboard or mouse input (Windows), nothing else."""

import ctypes
from ctypes import wintypes


class _LastInput(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def idle_seconds() -> float:
    info = _LastInput(cbSize=ctypes.sizeof(_LastInput))
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        return 0.0
    return ((ctypes.windll.kernel32.GetTickCount() - info.dwTime) & 0xFFFFFFFF) / 1000
