"""What she can open by name beyond what Windows finds on its own: the Start menu's apps (Store apps
like Spotify or WhatsApp included), Steam's and Epic's games, and a Roblox game by its name. Adapted
from mochiiwuff/capri-desktop's launch.js. Windows only."""

import difflib
import json
import logging
import os
import re
import subprocess
import time
import unicodedata
import uuid
from pathlib import Path
from typing import NamedTuple
from urllib.parse import quote

import httpx

log = logging.getLogger(__name__)


class Item(NamedTuple):
    name: str
    kind: str  # app (Start menu, by its AppID) | steam | epic
    id: str


STEAM_SKIP = re.compile(r"redistributable|dedicated server|steamworks", re.I)
# words that don't tell apps apart ("Roblox Player" is roblox, "AM Music" is am)
FILLER = {"player", "launcher", "app", "the", "for", "windows", "desktop", "client", "x64", "x86", "beta", "music",
          "media", "audio", "video", "videos"}
CACHE_S = 600  # installed apps hardly change
_cache: tuple[float, list[Item]] | None = None


def words(text: str) -> list[str]:
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return [w for w in re.split(r"[^\w]+", t) if len(w) >= 2]


def steam_root() -> Path | None:
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as k:
            return Path(winreg.QueryValueEx(k, "SteamPath")[0])
    except OSError:
        return None


def steam_games(root: Path | None) -> list[Item]:
    """Steam's games, from the manifests in each of its libraries."""
    if not root:
        return []
    libraries = {Path(root)}
    try:
        vdf = (Path(root) / "steamapps" / "libraryfolders.vdf").read_text(encoding="utf-8", errors="replace")
        libraries |= {Path(m.replace("\\\\", "\\")) for m in re.findall(r'"path"\s+"([^"]+)"', vdf)}
    except OSError:
        pass  # one library, the main one
    games = []
    for library in libraries:
        for f in sorted((library / "steamapps").glob("appmanifest_*.acf")):
            try:
                acf = f.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue  # one being written
            appid, name = re.search(r'"appid"\s+"(\d+)"', acf), re.search(r'"name"\s+"([^"]+)"', acf)
            if appid and name and not STEAM_SKIP.search(name[1]):
                games.append(Item(name[1], "steam", appid[1]))
    return games


def epic_games(folder: Path | None = None) -> list[Item]:
    """Epic's games, from its launcher's manifests (not the Unreal Engine plugins it keeps there too)."""
    folder = folder or Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "Epic" / "EpicGamesLauncher" / "Data" / "Manifests"
    games = []
    for f in sorted(Path(folder).glob("*.item")) if Path(folder).is_dir() else []:
        try:
            m = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if m.get("bIsIncompleteInstall") or m.get("CatalogNamespace") == "ue" or not m.get("DisplayName") or not m.get("AppName"):
            continue
        games.append(Item(m["DisplayName"], "epic", f"{m['CatalogNamespace']}:{m['CatalogItemId']}:{m['AppName']}"))
    return games


def start_apps() -> list[Item]:
    """The Start menu's apps (Get-StartApps: Store apps too), by name and AppID. A few seconds, cold."""
    out = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
         "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress"],
        capture_output=True, text=True, encoding="utf-8", timeout=45, creationflags=0x0800_0000)
    rows = json.loads(out.stdout or "[]")
    rows = rows if isinstance(rows, list) else [rows]
    return [Item(r["Name"], "app", r["AppID"]) for r in rows if r.get("Name") and r.get("AppID") and not r["AppID"].startswith("http")]


def launchables() -> list[Item]:
    """Everything she can open by name, games first (a game's own entry wins over a shortcut to it)."""
    global _cache
    if _cache and time.monotonic() - _cache[0] < CACHE_S:
        return _cache[1]
    items, seen = [], set()
    try:
        apps = start_apps()
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        log.warning("Start menu apps: %s", e)
        apps = None
    for item in [*steam_games(steam_root()), *epic_games(), *(apps or [])]:
        key = " ".join(words(item.name))
        if key and key not in seen:
            seen.add(key)
            items.append(item)
    if apps is not None:  # a list that failed isn't kept: next time, again
        _cache = (time.monotonic(), items)
    return items


def match(items: list[Item], text: str) -> Item | None:
    """The one of `items` named in `text`: all the words of its name, else at least half; the closest wins."""
    said = set(words(text))
    joined = "".join(words(text))
    best, rank = None, 0.0
    for item in items:
        every = words(item.name)
        key = [w for w in every if w not in FILLER] or every  # a name made only of those: all of it
        if not key:
            continue
        hits = [w for w in key if w in said or (len(w) >= 5 and w in joined)]
        # a word of 3 letters or more, or all of a short name ("am" for AM Music), and half of them at least
        if not (any(len(w) >= 3 for w in hits) or len(hits) == len(key)) or len(hits) / len(key) < 0.5:
            continue
        r = len(hits) / len(key) * 10 + len("".join(hits)) / 10
        if r > rank:
            best, rank = item, r
    return best


def similar(name: str, items: list[Item], n: int = 3) -> list[str]:
    """The names of `items` closest to a misheard or mistyped one, best first."""
    names = {i.name.lower(): i.name for i in items}
    return [names[m] for m in difflib.get_close_matches(name.lower(), names, n=n, cutoff=0.6)]


def find(name: str) -> Item | None:
    return match(launchables(), name)


def start(item: Item) -> None:
    """Opens it: a Steam or Epic game through its launcher's link, an app through the Start menu's AppsFolder."""
    if item.kind == "steam":
        os.startfile(f"steam://rungameid/{item.id}")  # noqa: S606
    elif item.kind == "epic":
        os.startfile(f"com.epicgames.launcher://apps/{quote(item.id, safe='')}?action=launch&silent=true")  # noqa: S606
    else:
        subprocess.Popen(["explorer.exe", f"shell:AppsFolder\\{item.id}"], creationflags=0x0800_0000)


# ---- Roblox (an external call authorized 28/10/2026: apis.roblox.com, one search per game asked) ----

def roblox_installed() -> bool:
    try:
        import winreg

        winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, "roblox").Close()
        return True
    except OSError:
        return False


def roblox(query: str) -> str | None:
    """Starts the first game Roblox's own search gives for `query`, in the Roblox app (or its page
    without the app). Its name, or None if Roblox found nothing."""
    r = httpx.get("https://apis.roblox.com/search-api/omni-search",
                  params={"searchQuery": query[:100], "pageType": "all", "sessionId": str(uuid.uuid4())},
                  headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}, timeout=8)
    r.raise_for_status()
    games = [c for g in r.json().get("searchResults", []) if g.get("contentGroupType") == "Game" for c in g.get("contents", [])]
    if not games or not games[0].get("rootPlaceId"):
        return None
    place = games[0]["rootPlaceId"]
    os.startfile(f"roblox://experiences/start?placeId={place}" if roblox_installed() else f"https://www.roblox.com/games/{place}")  # noqa: S606
    # "[💀] Steal a Brainrot" is "Steal a Brainrot"
    name = re.sub(r"\[[^\]]*\]\s*", "", str(games[0].get("name", ""))).strip()
    return "".join(c for c in name if unicodedata.category(c) != "So").strip() or str(games[0].get("name"))


# ---- closing an app he names (always after his click: it can lose unsaved work) ----

# never these: the desktop and Windows' own pieces, her (avatar, her backend, her webview), Claude
# (she watches it) and Ollama (her brain)
KEEP = {"explorer", "applicationframehost", "textinputhost", "shellexperiencehost", "startmenuexperiencehost", "searchhost",
        "searchapp", "lockapp", "dwm", "taskmgr", "avatar", "python", "pythonw", "msedgewebview2", "claude", "codex",
        "ollama", "ollama app"}


def powershell(script: str, timeout: float = 15) -> str:
    out = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                          f"[Console]::OutputEncoding = [Text.Encoding]::UTF8; {script}"],
                         capture_output=True, text=True, encoding="utf-8", timeout=timeout, creationflags=0x0800_0000)
    return out.stdout.strip()


def window_processes() -> list[dict]:
    """[{id, name, label}] of the processes with a window open."""
    out = powershell("Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { "
                     "[pscustomobject]@{ id = $_.Id; name = $_.ProcessName; label = $_.Description } } | ConvertTo-Json -Compress")
    rows = json.loads(out or "[]")
    return rows if isinstance(rows, list) else [rows]


def open_apps() -> list[Item]:
    """The apps with a window open, one per program: by its description ("AM Music"), else its process name."""
    apps: dict[str, Item] = {}
    for r in window_processes():
        name = r.get("name") or ""
        if name and name.lower() not in KEEP and name not in apps:
            apps[name] = Item(r.get("label") or name, "proc", name)
    return list(apps.values())


def _quoted(name: str) -> str:
    return "'" + name.replace("'", "''") + "'"


def close(item: Item) -> bool:
    """Closes it the way its own close button does (it can still ask to save). False if it's still running
    a few seconds later (it hid in the tray, or it's asking)."""
    left = powershell(f"Get-Process -Name {_quoted(item.id)} -ErrorAction SilentlyContinue | ForEach-Object {{ [void]$_.CloseMainWindow() }}; "
                      f"Start-Sleep -Seconds 3; @(Get-Process -Name {_quoted(item.id)} -ErrorAction SilentlyContinue).Count", timeout=20)
    return left.strip() in ("", "0")


def force(item: Item) -> None:
    """Ends it for good (what wasn't saved is lost): only on his click."""
    powershell(f"Stop-Process -Name {_quoted(item.id)} -Force -ErrorAction SilentlyContinue")
