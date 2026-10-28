"""She feels the PC she lives in: the processor at full tilt, the charger, the battery, the network,
a USB stick, a phone or a controller plugged in, a game in front. Read here, locally, every few
seconds; the avatar reacts (state/pc.ts). Nothing of it goes to the model or leaves the PC.
Adapted from mochiiwuff/capri-desktop's pc.js. `[avatar] reaccionar_pc = false` turns it off."""

import asyncio
import ctypes
import logging
import re
import subprocess
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

import psutil

log = logging.getLogger(__name__)

HOT = 85  # % of the processor...
HOT_FOR = 15  # ...for this many seconds
HOT_EVERY = 30 * 60  # at most once this often
CHARGER_EVERY = 60
LOW = (20, 10)  # battery levels she warns about, once each until it's charged
GAME_AFTER = 6  # a game in front this long: he's playing
GAME_OVER = 8  # and gone this long: he's done
DEVICES_EVERY = 20  # s between looks at the plugged-in devices (PowerShell: not cheap)


@dataclass(frozen=True)
class Reading:
    t: float  # seconds (monotonic)
    cpu: float
    plugged: bool | None  # None: no battery (a desktop)
    battery: int | None
    online: bool
    drives: dict[str, str]  # removable drives: letter -> label
    devices: dict[str, str] | None  # plugged-in devices: name -> Windows' class (None: not looked at this time)
    game: str | None  # the game in front, by name


PAD = re.compile(r"controller|gamepad|mando|xbox|dualsense|dualshock|joy-?con", re.I)
PHONE = re.compile(r"phone|iphone|apple|galaxy|samsung|pixel|xiaomi|redmi|poco|oneplus|huawei|honor|motorola|oppo|vivo|realme|"
                   r"nokia|xperia|android|mobile|celular", re.I)


def device_kind(name: str, cls: str) -> str:
    if PAD.search(name):
        return "controller"
    if cls in ("DiskDrive", "Volume"):
        return "drive"  # USB sticks: by their drive letter
    if cls == "WPD" or PHONE.search(name):
        return "phone"
    if cls in ("AudioEndpoint", "MEDIA"):
        return "audio"
    if cls in ("Camera", "Image"):
        return "camera"
    if cls in ("Keyboard", "Mouse", "HIDClass"):
        return "input"
    return "device"


class Senses:
    """What changed since the last reading, as (tipo, detalle) for the avatar. The first reading only
    says how things are: nothing is news yet."""

    def __init__(self):
        self.last: Reading | None = None
        self.hot_since: float | None = None
        self.hot_at = -1e18
        self.charger_at = -1e18
        self.warned: set[int] = set()
        self.devices: dict[str, str] | None = None
        self.game: str | None = None
        self.game_since = 0.0
        self.playing = False
        self.gone_since: float | None = None

    def feel(self, r: Reading) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        before, self.last = self.last, r
        # the processor: hot for a while, then not again for a long while
        if r.cpu >= HOT:
            self.hot_since = r.t if self.hot_since is None else self.hot_since
            if r.t - self.hot_since >= HOT_FOR and r.t - self.hot_at >= HOT_EVERY:
                self.hot_at = r.t
                out.append(("caliente", ""))
        else:
            self.hot_since = None
        # the game in front, held a while: playing; gone a while: done
        if r.game:
            if r.game != self.game:
                self.game, self.game_since = r.game, r.t
            self.gone_since = None
            if not self.playing and r.t - self.game_since >= GAME_AFTER:
                self.playing = True
                out.append(("juego", f"inicio:{r.game}"))
        elif self.playing:
            self.gone_since = r.t if self.gone_since is None else self.gone_since
            if r.t - self.gone_since >= GAME_OVER:
                self.playing = False
                out.append(("juego", f"fin:{self.game}"))
                self.game = None
        else:
            self.game = None
        if before is None:
            self.devices = r.devices
            return out
        if r.plugged is not None and before.plugged is not None and r.plugged != before.plugged:
            if r.t - self.charger_at >= CHARGER_EVERY:
                self.charger_at = r.t
                out.append(("cargador", "on" if r.plugged else "off"))
            if r.plugged:
                self.warned.clear()
        if r.battery is not None and r.plugged is False:
            for level in LOW:
                if r.battery <= level and level not in self.warned:
                    self.warned.add(level)
                    out.append(("bateria", str(level)))
                    break
        if r.online != before.online:
            out.append(("red", "vuelve" if r.online else "caida"))
        for letter in r.drives.keys() - before.drives.keys():
            out.append(("usb", letter))
        if r.devices is not None:
            if self.devices is not None:
                for name, cls in r.devices.items():
                    kind = device_kind(name, cls)
                    if name not in self.devices and kind not in ("input", "drive"):
                        out.append(("dispositivo", f"{kind}:{name}"))
            self.devices = r.devices
        return out


# ---- what's in front, plugged in, on a stick ----

GAME_DIRS = (r"\steamapps\common", r"\epic games", r"\riot games", r"\xboxgames", r"\gog games", r"\gog galaxy\games")


def game_of(exe: str, steam_names: dict[str, str]) -> str | None:
    """The game a program belongs to, by the folder it's installed in (Steam's own name when it has one)."""
    low = exe.lower()
    for d in GAME_DIRS:
        i = low.find(d + "\\")
        if i >= 0:
            folder = exe[i + len(d) + 1:].split("\\")[0]
            if folder and not re.search(r"launcher|client|redistributable", folder, re.I):
                return steam_names.get(folder.lower(), folder)
    return None


KINDS = {"foto": "jpg jpeg png heic gif webp bmp", "video": "mp4 mov mkv avi webm wmv", "canción": "mp3 wav flac m4a ogg",
         "documento": "pdf docx doc xlsx xls pptx ppt txt odt"}
PLURAL = {"foto": "fotos", "video": "videos", "canción": "canciones", "documento": "documentos"}


def verdict(root: Path, label: str) -> str:
    """What she found rummaging in a USB stick: its files by kind, two levels down at most. Names only."""
    counts = dict.fromkeys([*KINDS, "otro"], 0)
    seen = 0
    for level in (0, 1):
        dirs = [root] if level == 0 else [d for d in root.iterdir() if d.is_dir()] if root.is_dir() else []
        for d in dirs:
            try:
                files = [f for f in d.iterdir() if f.is_file()]
            except OSError:
                continue
            for f in files[:3000 - seen]:
                ext = f.suffix.lower().lstrip(".")
                counts[next((k for k, es in KINDS.items() if ext in es.split()), "otro")] += 1
                seen += 1
    if not seen:
        return "Tu USB está vacía."
    parts = [f"{n} {k if n == 1 else PLURAL[k]}" for k, n in counts.items() if n and k != "otro"]
    if counts["otro"]:
        parts.append(f"{counts['otro']} archivo{'s' if counts['otro'] != 1 else ''} más")
    said = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " y " + parts[-1]
    return f"Tu USB{f' «{label}»' if label else ''} tiene {said}."


def front_exe() -> str | None:
    """The program of the window in front."""
    user32 = ctypes.windll.user32
    pid = ctypes.c_ulong()
    user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), ctypes.byref(pid))
    try:
        return psutil.Process(pid.value).exe()
    except (psutil.Error, ValueError):
        return None


def online() -> bool:
    """A network adapter up with an address (no ping: nothing leaves the PC)."""
    stats, addrs = psutil.net_if_stats(), psutil.net_if_addrs()
    return any(s.isup and "loopback" not in name.lower() and any(
        a.family.name == "AF_INET" and not a.address.startswith(("127.", "169.254.")) for a in addrs.get(name, []))
        for name, s in stats.items())


def removable() -> dict[str, str]:
    out = {}
    for p in psutil.disk_partitions(all=False):
        if "removable" in p.opts:
            letter = p.device.rstrip("\\")
            try:
                label = subprocess.run(["cmd", "/c", "vol", letter], capture_output=True, text=True, timeout=3,
                                       creationflags=0x0800_0000).stdout
                label = re.search(r"(?:es|is)\s+(.+)\s*$", label.splitlines()[0]).group(1).strip() if label else ""
            except (OSError, subprocess.SubprocessError, AttributeError, IndexError):
                label = ""
            out[letter] = label
    return out


def devices() -> dict[str, str] | None:
    out = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                          "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-PnpDevice -PresentOnly -Class WPD,AudioEndpoint,"
                          "HIDClass,Camera,Image,Bluetooth -ErrorAction SilentlyContinue | ForEach-Object { \"$($_.Class)`t$($_.FriendlyName)\" }"],
                         capture_output=True, text=True, encoding="utf-8", timeout=15, creationflags=0x0800_0000)
    if out.returncode:
        return None
    return {name: cls for cls, _, name in (line.partition("\t") for line in out.stdout.splitlines()) if name.strip()}


async def watch(send: Callable[[str, str], Awaitable[None]], enabled: Callable[[], bool], every_s: float = 3) -> None:
    """Reads the PC every few seconds and sends what changed (the USB stick with her verdict on it)."""
    from app import launch

    steam = {g.name.lower(): g.name for g in await asyncio.to_thread(launch.steam_games, launch.steam_root())}
    senses, loop, devices_at = Senses(), asyncio.get_running_loop(), -1e18
    psutil.cpu_percent(None)  # the first call only starts the count
    while True:
        await asyncio.sleep(every_s)
        if not enabled():
            continue
        try:
            t = loop.time()
            look = t - devices_at >= DEVICES_EVERY
            if look:
                devices_at = t
            battery = psutil.sensors_battery()
            exe = front_exe()
            r = Reading(t=t, cpu=psutil.cpu_percent(None), plugged=battery.power_plugged if battery else None,
                        battery=round(battery.percent) if battery else None, online=online(),
                        drives=await asyncio.to_thread(removable), devices=await asyncio.to_thread(devices) if look else None,
                        game=game_of(exe, steam) if exe else None)
            for tipo, detalle in senses.feel(r):
                if tipo == "usb":
                    detalle = await asyncio.to_thread(verdict, Path(detalle + "\\"), r.drives.get(detalle, ""))
                await send(tipo, detalle)
        except Exception:
            log.exception("reading the PC")
