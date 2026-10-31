"""Tools Capri can ask for through `accion`. Each has a pydantic model for its args and a risk: "libre"
(runs at once), "normal" (waits for a click that shows exactly what it will do) or "alto" (the same,
in red). A tool with effects is "normal" unless its `risk` says otherwise; one without is "libre".
What each may touch (files, commands, web) is decided in app/power.py."""

import ctypes
import json
import os
import re
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal
from urllib.parse import quote, unquote, urlparse

import httpx
import pyperclip
from pydantic import BaseModel, Field

from app import calendar_ics, launch, media_now, power, research, settings, spotify, steam, vision
from app.memory import STOPWORDS, content_words, fold
from app.power import ToolError
from app.settings import Settings

MAX_RESULTS = 20
MAX_SCANNED = 300_000  # files looked at per search
SEARCH_S = 10  # seconds a file search may take
NEARLY_EMPTY = 200  # chars of a page: under this it's a shell its scripts fill in
MAX_TEXT = 3000  # chars of tool output handed to the model (~800 tokens: one page read must not force a trim)

SETUP_STEPS = (
    "El calendario no está configurado. Que te pase uno de estos y con eso pides la acción configurar_calendario: "
    "Google Calendar: en calendar.google.com, Configuración (rueda dentada) > en la izquierda, su calendario > "
    "'Integrar el calendario' > copiar la 'Dirección secreta en formato iCal'. Outlook.com: Configuración > Calendario > "
    "Calendarios compartidos > Publicar un calendario > copiar el vínculo ICS. iCloud: en la app Calendario, compartir "
    "el calendario como público y copiar el enlace (webcal://). Outlook para Windows (el clásico) instalado: que diga "
    "«outlook». O la ruta de un archivo .ics de su PC. Sin nada de eso, tus recordatorios siguen funcionando."
)


class NoArgs(BaseModel):
    pass


class AppArgs(BaseModel):
    nombre: str


class FolderArgs(BaseModel):
    nombre: str = Field(min_length=1, max_length=260)  # "descargas", "la papelera", "mi cv" (on the desktop), a path


class SearchArgs(BaseModel):
    texto: str = ""  # words of its name (or what's in it)
    tipo: str = ""  # what kind of file: "video", "pdf", "proyecto de after effects", extensions
    carpeta: str = ""  # where to look; empty = the user's whole folder


class PathArgs(BaseModel):
    ruta: str = Field(min_length=1)


class WriteArgs(BaseModel):
    ruta: str = Field(min_length=1)
    texto: str = Field(max_length=100_000)
    modo: Literal["crear", "añadir", "reemplazar"] = "crear"


class CommandArgs(BaseModel):
    comando: str = Field(min_length=1, max_length=2000)  # PowerShell


class PageArgs(BaseModel):
    url: str
    pregunta: str = Field(default="", max_length=200)  # what she wants from it: keeps those parts of a long page


class ResearchArgs(BaseModel):
    tema: Literal["clima", "divisas", "wikipedia", "noticias"]
    consulta: str = Field(min_length=2, max_length=200)


class QueryArgs(BaseModel):
    consulta: str = Field(min_length=2, max_length=200)


class TextArgs(BaseModel):
    texto: str = Field(max_length=10_000)


class ScriptArgs(BaseModel):
    nombre: str


class CalendarArgs(BaseModel):
    dias: int = Field(default=2, ge=1, le=14)  # from today: 2 = today and tomorrow


class CalendarUrlArgs(BaseModel):
    url: str


class RememberArgs(BaseModel):
    texto: str = Field(min_length=3, max_length=300)
    tipo: Literal["preferencia", "hecho"] = "hecho"


class ForgetArgs(BaseModel):
    texto: str = Field(min_length=2)


class ReminderArgs(BaseModel):
    texto: str = Field(min_length=1, max_length=200)  # what to remind; when comes from his own words


class UrlArgs(BaseModel):
    url: str


class WebSearchArgs(BaseModel):
    sitio: str = Field(min_length=1, max_length=40)  # youtube, google, spotify; any other goes through Google
    consulta: str = Field(min_length=1, max_length=200)


class RobloxArgs(BaseModel):
    juego: str = Field(min_length=1, max_length=100)


class YoutubeArgs(BaseModel):
    consulta: str = Field(min_length=1, max_length=200)


class MediaArgs(BaseModel):
    accion: Literal["play_pausa", "siguiente", "anterior", "subir_volumen", "bajar_volumen", "silencio"]


class SpotifyArgs(BaseModel):
    consulta: str = Field(min_length=1, max_length=200)
    tipo: Literal["cancion", "playlist", "album", "artista"] = "cancion"


@dataclass(frozen=True)
class Tool:
    args: type[BaseModel]
    effect: bool
    run: Callable[[BaseModel, Settings], str] | None  # None: the orchestrator runs it (memory tools)
    describe: Callable[[BaseModel], str] = lambda a: ""  # what the confirmation asks
    risk: Callable[[BaseModel, Settings], str] | None = None  # "libre" | "normal" | "alto" for these args; may refuse
    log: bool = False  # also leave a line in the audit log when it runs without asking
    # what he has to have named for it to run without a button (an app, a site...); None: always asks
    named: Callable[[BaseModel], str] | None = None

    def level(self, args: BaseModel, s: Settings) -> str:
        return self.risk(args, s) if self.risk else ("normal" if self.effect else "libre")


def named_in(target: str, message: str) -> bool:
    """He asked for it himself: at least half the words of `target` (and one at least) are in his message.
    `target` may give alternatives, "captura|pantallazo|screenshot": any of them will do."""
    have = set(re.findall(r"\w+", fold(message)))
    for alt in target.split("|"):
        want = content_words(alt)
        if want and 2 * len(want & have) >= len(want):
            return True
    return False


def site(url: str) -> str:
    """What he'd call a site: "https://www.kick.com/westcol" is kick."""
    host = urlparse(url if "//" in url else f"//{url}").hostname or url
    return host.removeprefix("www.").split(".")[0]


# the registry, disks, boot and policies: one wrong click there can break Windows
SYSTEM_APPS = {"regedit", "regedt32", "gpedit", "secpol", "diskpart", "diskmgmt", "msconfig", "services", "bcdedit"}
RUNNABLE = {".exe", ".bat", ".cmd", ".ps1", ".msi", ".vbs", ".js", ".scr", ".com", ".lnk"}


# what people call them -> the name Windows knows them by (App Paths)
APP_NAMES = {"edge": "msedge", "microsoft edge": "msedge", "word": "winword", "powerpoint": "powerpnt",
             "vs code": "code", "vscode": "code", "visual studio code": "code", "terminal": "wt",
             "explorador": "explorer", "explorador de archivos": "explorer", "bloc de notas": "notepad"}
START_MENUS = [Path(os.environ.get(v, "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
               for v in ("APPDATA", "PROGRAMDATA") if os.environ.get(v)]


def app_target(a: AppArgs, s: Settings) -> str:
    name = a.nombre.strip()  # a name in the user's list, a common one, or whatever was asked
    return s.apps.get(name.lower(), APP_NAMES.get(name.lower(), name))


# shortcuts that install, uninstall or repair: "abre bittorrent" opened "Desinstalar qBittorrent" under a plain click
NOT_THE_APP = re.compile(r"install|uninst|desinstal|setup|remove|repair|reparar|quitar", re.I)


def shortcut(name: str) -> Path | None:
    """The Start menu shortcut for `name` (Discord isn't an App Paths name): the same name, else one that
    starts with it, else the shortest that contains it. Never one that installs or uninstalls."""
    want = name.lower()
    links = [p for d in START_MENUS if d.is_dir() for p in d.rglob("*.lnk") if not NOT_THE_APP.search(p.stem)]
    fits = [p for p in links if want in p.stem.lower()]
    return min(fits, key=lambda p: (p.stem.lower() != want, not p.stem.lower().startswith(want), len(p.stem)), default=None)


def app_risk(a: AppArgs, s: Settings) -> str:
    """A program by name or one from the list is a plain click; a file path that runs code is red."""
    t = app_target(a, s)
    if Path(t).stem.lower() in SYSTEM_APPS:
        return "alto"  # the registry and the system: always a red click, even when he named it
    pathlike = "\\" in t or "/" in t or t.startswith("~")
    return "alto" if a.nombre.lower() not in s.apps and pathlike and Path(t).suffix.lower() in RUNNABLE else "normal"


def open_app(a: AppArgs, s: Settings) -> str:
    target = app_target(a, s)
    try:
        os.startfile(target)  # noqa: S606  (the user confirmed this exact name)
    except OSError as e:
        pathlike = "\\" in target or "/" in target
        # a Steam or Epic game, or a Start menu app (Store apps too), by its name
        item = None if pathlike else launch.find(target)
        if item:
            launch.start(item)
            return f"Abrí {item.name}."
        link = None if pathlike else shortcut(target)
        if link is None:
            raise ToolError(f"no encontré «{a.nombre}» entre sus programas ni juegos ({e.strerror or e}); pregúntale cómo se "
                            "llama en el menú Inicio o su ruta") from e
        os.startfile(str(link))  # noqa: S606  (the Start menu shortcut of the program he confirmed)
    return f"Abrí {a.nombre}."


# ---- folders, the desktop, a screenshot ----

# what he calls them -> the shell's own name for them (it follows them wherever they were moved)
FOLDERS = {
    "shell:Downloads": "descargas downloads",
    "shell:Personal": "documentos documents",
    "shell:Desktop": "escritorio desktop",
    "shell:My Pictures": "imagenes fotos pictures photos",
    "shell:My Music": "musica music",
    "shell:My Video": "videos",
    "shell:Screenshots": "capturas pantallazos screenshots",
    "shell:RecycleBinFolder": "papelera reciclaje recycle trash",
    "shell:MyComputerFolder": "explorador explorer equipo computer",
}
NOT_A_NAME = re.compile(r"^(?:(?:mi|mis|la|el|los|las|my|the|carpeta|folder|de|del|of)\s+)+|\s+(?:folder|carpeta)$")


def desktops() -> list[Path]:
    """His desktop (wherever Windows keeps it) and the public one."""
    out = []
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as k:
            out.append(Path(os.path.expandvars(winreg.QueryValueEx(k, "Desktop")[0])))
    except OSError:
        out.append(Path.home() / "Desktop")
    return out + [Path(os.environ.get("PUBLIC", r"C:\Users\Public")) / "Desktop"]


def folder_target(nombre: str) -> str:
    """Where "abre X" goes: a known folder (shell:...), a path, or a file or shortcut on his desktop by name."""
    said = NOT_A_NAME.sub("", fold(nombre).strip()).strip()
    words = set(re.findall(r"\w+", said))
    for target, names in FOLDERS.items():
        if words & set(names.split()):
            return target
    p = power.resolve(nombre)
    if p.exists():
        power.guard(str(p))  # never his keys and credentials
        return str(p)
    for d in desktops():
        for f in sorted(d.iterdir()) if d.is_dir() else []:
            if said and said in fold(f.stem):
                return str(f)
    raise ToolError(f"no encontré «{nombre}»: ni carpeta conocida, ni ruta, ni nada en el escritorio con ese nombre")


def folder_risk(a: FolderArgs, s: Settings) -> str:
    """A folder or a document is a plain click (none if he named it); something that runs a program, or a
    place outside his folder, always asks in red."""
    t = folder_target(a.nombre)
    if t.startswith("shell:"):
        return "normal"
    p = Path(t)
    return "alto" if p.suffix.lower() in RUNNABLE - {".lnk"} or not power.inside_home(p.resolve()) and not any(
        d in p.parents for d in desktops()) else "normal"


def open_folder(a: FolderArgs, s: Settings) -> str:
    t = folder_target(a.nombre)
    if t.startswith("shell:"):
        subprocess.Popen(["explorer.exe", t], creationflags=0x0800_0000)
    else:
        os.startfile(t)  # noqa: S606  (he named it, or confirmed it)
    return f"Abrí {a.nombre}."


unclosed: list[launch.Item] = []  # an app the last cerrar_app couldn't close (her button forces it)


def app_to_close(nombre: str) -> launch.Item:
    item = launch.match(launch.open_apps(), nombre)
    if not item:
        raise ToolError(f"no veo abierta ninguna app llamada «{nombre}» (las de Windows, Claude, Ollama y yo no se cierran desde aquí)")
    return item


def close_app(a: AppArgs, s: Settings) -> str:
    item = app_to_close(a.nombre)
    unclosed.clear()
    if launch.close(item):
        return f"Cerré {item.name}."
    unclosed.append(item)
    return (f"{item.name} no se cerró del todo (seguramente se quedó en la bandeja, o te está preguntando si guardas): "
            "abajo tiene un botón para forzar el cierre.")


def screenshots_folder() -> Path:
    """Pictures › Screenshots, wherever Windows keeps his Pictures."""
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as k:
            pictures = Path(os.path.expandvars(winreg.QueryValueEx(k, "My Pictures")[0]))
    except OSError:
        pictures = Path.home() / "Pictures"
    return pictures / "Screenshots"


def screenshot(a: NoArgs, s: Settings) -> str:
    """The screen he's on (where the pointer is), full size, saved; she keeps herself out of it."""
    path = vision.save_shot(vision.cursor_monitor(), screenshots_folder())
    return f"Guardé la captura en {path}."


SKIP_DIRS = {"node_modules", "appdata", "$recycle.bin", "windows", "site-packages", "target", "__pycache__"}


# kinds of file said in words -> their extensions ("mi último video", "el proyecto de After Effects")
KINDS = {
    "video": "mp4 mov mkv avi webm wmv", "foto": "jpg jpeg png heic webp", "imagen": "jpg jpeg png gif webp heic bmp",
    "audio": "mp3 wav flac m4a ogg", "cancion": "mp3 wav flac m4a", "musica": "mp3 wav flac m4a",
    "documento": "docx doc pdf odt txt", "word": "docx doc", "excel": "xlsx xls csv", "hoja": "xlsx xls csv",
    "presentacion": "pptx ppt key", "powerpoint": "pptx ppt", "comprimido": "zip rar 7z", "zip": "zip rar 7z",
    "after effects": "aep", "premiere": "prproj", "photoshop": "psd", "illustrator": "ai", "blender": "blend",
    "figma": "fig", "unity": "unity",
}
# never in the results: code dependencies, app data, git internals
JUNK = ("node_modules", "\\appdata\\", "\\.git\\", "\\site-packages\\", "\\$recycle.bin\\")
# what's in these is code or noise: a content search leaves them out
CODE_EXTS = ("js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "map", "lock", "yml", "yaml", "py", "css", "html", "md", "txt", "xml", "log")
found: list[Path] = []  # the files the last search showed him (her buttons open these)


def extensions(tipo: str) -> list[str]:
    t = fold(tipo)
    exts = [e for kind, es in KINDS.items() if kind in t for e in es.split()]
    return exts or [w for w in re.findall(r"[a-z0-9]{2,8}", t) if w not in STOPWORDS and w not in {"archivo", "archivos", "file", "proyecto", "de"}]


def index_queries(terms: list[str], exts: list[str], home: str) -> tuple[str, str | None]:
    """Windows Search SQL: by name (every word, of those kinds if any), and by what's in documents (not
    code) when no kind was asked. Words are letters and digits only: nothing can close their quotes."""
    terms = [re.sub(r"[^\w.]", "", t) for t in terms]
    exts = [re.sub(r"[^a-z0-9]", "", e) for e in exts]
    not_junk = "NOT System.ItemUrl LIKE '%node_modules%' AND NOT System.ItemUrl LIKE '%/AppData/%' AND NOT System.ItemUrl LIKE '%/.git/%'"
    of_kind = "(" + " OR ".join(f"System.FileExtension = '.{e}'" for e in exts) + ")" if exts else ""
    query = lambda where: (f"SELECT TOP {MAX_RESULTS} System.ItemUrl FROM SYSTEMINDEX WHERE SCOPE='file:{home}' "  # noqa: E731
                           f"AND {not_junk} AND {where} ORDER BY System.DateModified DESC")
    by_name = " AND ".join([*(f"System.FileName LIKE '%{t}%'" for t in terms if t), *([of_kind] if of_kind else [])])
    by_text = None
    if terms and not exts:
        words = " AND ".join(f'"{t}"' for t in terms if t)
        by_text = f"CONTAINS(*, '{words}') AND " + " AND ".join(f"System.FileExtension <> '.{e}'" for e in CODE_EXTS)
    return query(by_name), by_text and query(by_text)


def indexed(terms: list[str], exts: list[str]) -> list[str] | None:
    """Paths from Windows' search index (his whole folder, in a blink), newest first; None if it can't be asked."""
    script = ["[Console]::OutputEncoding = [Text.Encoding]::UTF8", "$c = New-Object -ComObject ADODB.Connection",
              "$c.Open(\"Provider=Search.CollatorDSO;Extended Properties='Application=Windows';\")"]
    for q in filter(None, index_queries(terms, exts, str(power.HOME))):
        script.append(f"$r = New-Object -ComObject ADODB.Recordset; $r.Open('{q.replace(chr(39), chr(39) * 2)}', $c); "
                      "while (-not $r.EOF) { $r.Fields.Item('System.ItemUrl').Value; $r.MoveNext() }; $r.Close()")
    try:
        out = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "; ".join(script)],
                             capture_output=True, text=True, encoding="utf-8", timeout=10, creationflags=0x0800_0000)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode:
        return None
    paths = [unquote(line.strip()[5:]).replace("/", "\\") for line in out.stdout.splitlines() if line.strip().lower().startswith("file:")]
    return list(dict.fromkeys(paths))


def walked(root: Path, terms: list[str], exts: list[str]) -> list[str]:
    """Without the index: a walk through his folder, by name and kind."""
    out, scanned, deadline = [], 0, time.monotonic() + SEARCH_S
    for folder, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d.lower() not in SKIP_DIRS]
        for f in files:
            scanned += 1
            name = fold(f)
            if all(t in name for t in terms) and (not exts or Path(f).suffix.lower().lstrip(".") in exts):
                out.append(str(Path(folder) / f))
        if len(out) >= MAX_RESULTS or scanned >= MAX_SCANNED or time.monotonic() > deadline:
            break
    return out


def search_files(a: SearchArgs, s: Settings) -> str:
    """His files by name, kind and (in documents) contents: Windows' search index first, else a walk.
    The newest first; never code dependencies, app data or anything private."""
    terms, exts = [fold(w) for w in re.findall(r"[\w.]{2,}", a.texto)][:5], extensions(a.tipo)
    if not terms and not exts:
        raise ToolError("dime qué buscar: parte del nombre o qué tipo de archivo")
    root = power.guard(a.carpeta)[0] if a.carpeta else power.HOME
    paths = (indexed(terms, exts) if not a.carpeta else None) or walked(root, terms, exts)
    def junk(p: Path) -> bool:  # judged inside his folder ("…\AppData\…" there), not by where his folder is
        inside = "\\" + str(p.relative_to(power.HOME)) if p.is_relative_to(power.HOME) else str(p)
        return any(j in inside.lower() for j in JUNK)

    found[:] = [p for p in map(Path, paths) if not junk(p) and not power.SENSITIVE.search(p.as_posix()) and p.exists()][:MAX_RESULTS]
    if not found:
        return f"Ningún archivo con «{a.texto or a.tipo}» en {root}."
    return "\n".join(f"{p.name} — en {p.parent} ({datetime.fromtimestamp(p.stat().st_mtime):%d/%m/%Y})" for p in found)


def files_risk(a: PathArgs, s: Settings) -> str:
    return power.guard(a.ruta)[1]


def write_risk(a: WriteArgs, s: Settings) -> str:
    p, level = power.guard(a.ruta)
    return "alto" if level == "alto" or (a.modo == "reemplazar" and p.exists()) else "normal"


def command_risk(a: CommandArgs, s: Settings) -> str:
    return power.command_risk(a.comando)


def describe_write(a: WriteArgs) -> str:
    verb = {"crear": "Crear", "añadir": "Añadir texto a", "reemplazar": "Reemplazar el contenido de"}[a.modo]
    return f"{verb} {a.ruta} ({len(a.texto)} caracteres: «{a.texto[:60]}{'…' if len(a.texto) > 60 else ''}»)"


def read_clipboard(a: NoArgs, s: Settings) -> str:
    return pyperclip.paste() or "(el portapapeles está vacío o no tiene texto)"


def copy_text(a: TextArgs, s: Settings) -> str:
    pyperclip.copy(a.texto)
    return "Copiado al portapapeles."


def read_file(a: PathArgs, s: Settings) -> str:
    return power.read_file(a.ruta)


def list_folder(a: PathArgs, s: Settings) -> str:
    return power.list_dir(a.ruta)


def write_file(a: WriteArgs, s: Settings) -> str:
    return power.write_file(a.ruta, a.texto, a.modo)


def run_command(a: CommandArgs, s: Settings) -> str:
    return power.run_command(a.comando)


def read_page(a: PageArgs, s: Settings) -> str:
    try:
        text = research.cached(("page", a.url), lambda: power.get(a.url))
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403, 429, 503):
            raise ToolError("ese sitio no deja leerlo a un programa: prueba otra página o buscar_web") from e
        raise ToolError(f"la página respondió con error {e.response.status_code}") from e
    except httpx.HTTPError as e:
        raise ToolError(f"no pude abrir la página: {e}") from e
    if len(text) < NEARLY_EMPTY:
        return f"{text}\n(La página casi no trae texto: seguramente la dibuja con JavaScript. Prueba otra página o buscar_web.)"
    return research.relevant(text, a.pregunta, MAX_TEXT)


def investigate(a: ResearchArgs, s: Settings) -> str:
    try:
        return research.consult(a.tema, a.consulta)
    except research.ResearchError as e:
        raise ToolError(str(e)) from None



def run_script(a: ScriptArgs, s: Settings) -> str:
    target = s.scripts.get(a.nombre.lower())
    if not target:
        raise ToolError(f"'{a.nombre}' no está en la lista de scripts permitidos: {', '.join(s.scripts) or 'ninguno'}")
    ext = Path(target).suffix.lower()
    cmd = {
        ".ps1": ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", target],
        ".bat": ["cmd", "/c", target],
        ".cmd": ["cmd", "/c", target],
        ".py": [sys.executable, target],
    }.get(ext, [target])
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=120, creationflags=0x0800_0000)
    out = (done.stdout + done.stderr).strip() or "(sin salida)"
    return f"Terminó con código {done.returncode}.\n{out}"


def calendar(a: CalendarArgs, s: Settings) -> str:
    if not s.calendar_url:
        return SETUP_STEPS
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    evs = calendar_ics.events(calendar_ics.fetch(s.calendar_url), start, start + timedelta(days=a.dias))
    # Every day labeled and "sin eventos" said outright: the model must never infer an empty day.
    lines = []
    for i in range(a.dias):
        day = start + timedelta(days=i)
        label = {0: "Hoy", 1: "Mañana"}.get(i, calendar_ics.DAYS[day.weekday()].capitalize())
        todays = [e for e in evs if e.start.date() == day.date()]
        lines.append(f"{label} ({day:%d/%m}): " + ("; ".join(e.line().split(" ", 1)[1] for e in todays) or "sin eventos"))
    return "\n".join(lines)


def configure_calendar(a: CalendarUrlArgs, s: Settings) -> str:
    try:
        settings.save_calendar_url(a.url.strip())
    except ValueError as e:
        raise ToolError(str(e)) from e
    return "Calendario configurado. Ya puedes consultarlo."


def open_url(a: UrlArgs, s: Settings) -> str:
    url = a.url.strip()
    if not (url.startswith("https://") or url.startswith("http://")) or not urlparse(url).hostname:
        raise ToolError(f"«{url}» no es una dirección web (tiene que empezar por https://)")
    os.startfile(url)  # noqa: S606  (the user confirmed this exact address)
    return f"Abrí {urlparse(url).hostname}."


SEARCH_URLS = {
    "youtube": "https://www.youtube.com/results?search_query={}",
    "google": "https://www.google.com/search?q={}",
    "spotify": "spotify:search:{}",  # the desktop app's search
}


# a streamer "on Kick" is their channel: the address is the name, lowercase and without spaces
CHANNEL_URLS = {"kick": "https://kick.com/{}", "twitch": "https://www.twitch.tv/{}"}


def web_search(a: WebSearchArgs, s: Settings) -> str:
    site = a.sitio.strip().lower().split(".")[0]  # "kick.com" is kick
    if site in CHANNEL_URLS:
        os.startfile(CHANNEL_URLS[site].format(quote(re.sub(r"\s+", "", a.consulta.lower()))))  # noqa: S606  (fixed sites)
        return f"Abrí el canal de «{a.consulta}» en {site.capitalize()}."
    url = SEARCH_URLS[site].format(quote(a.consulta)) if site in SEARCH_URLS else \
        SEARCH_URLS["google"].format(quote(f"{a.consulta} {a.sitio.strip()}"))
    os.startfile(url)  # noqa: S606  (fixed sites)
    return f"Abrí la búsqueda de «{a.consulta}» en {a.sitio if site in SEARCH_URLS else 'Google'}."


FIRST_VIDEO = re.compile(r'"videoRenderer":\{"videoId":"([\w-]{11})".{0,1500}?"title":\{"runs":\[\{"text":"(.*?)"\}', re.S)


def play_roblox(a: RobloxArgs, s: Settings) -> str:
    try:
        name = launch.roblox(a.juego)
    except httpx.HTTPError as e:
        raise ToolError("Roblox no respondió; prueba en un momento") from e
    if not name:
        raise ToolError(f"no encontré ningún juego de Roblox para «{a.juego}»")
    return f"Abrí {name} en Roblox."


def play_youtube(a: YoutubeArgs, s: Settings) -> str:
    """Opens the first video of a YouTube search (the page opens and starts playing). One request to
    youtube.com's results page, the same one the browser would load; no API key."""
    try:
        r = httpx.get("https://www.youtube.com/results", params={"search_query": a.consulta}, timeout=10,
                      headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36",
                               "Accept-Language": "es-CO,es;q=0.9"}, cookies={"CONSENT": "YES+1"}, follow_redirects=True)
        r.raise_for_status()
        m = FIRST_VIDEO.search(r.text)
    except httpx.HTTPError:
        m = None
    if not m:  # YouTube didn't answer her, or the page changed: the search in his browser still works
        os.startfile(SEARCH_URLS["youtube"].format(quote(a.consulta)))  # noqa: S606  (fixed site)
        return f"No pude elegir el video yo sola: abrí la búsqueda de «{a.consulta}» en YouTube en su navegador; que le dé al primero."
    os.startfile(f"https://www.youtube.com/watch?v={m.group(1)}")  # noqa: S606  (a video id of the fixed site)
    return f"Abrí en YouTube: {json.loads(f'\"{m.group(2)}\"')}."


# Windows media keys: they drive whatever is playing (Spotify, YouTube in the browser, ...).
MEDIA_KEYS = {"play_pausa": 0xB3, "siguiente": 0xB0, "anterior": 0xB1,
              "subir_volumen": 0xAF, "bajar_volumen": 0xAE, "silencio": 0xAD}


def press_key(vk: int) -> None:
    ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
    ctypes.windll.user32.keybd_event(vk, 0, 2, 0)  # KEYEVENTF_KEYUP


def media(a: MediaArgs, s: Settings) -> str:
    for _ in range(5 if "volumen" in a.accion else 1):  # one volume step is barely audible
        press_key(MEDIA_KEYS[a.accion])
    if "volumen" in a.accion:  # keys only step it: she can't know the level, so she mustn't claim one
        return f"{'Subí' if a.accion == 'subir_volumen' else 'Bajé'} el volumen unos pasos (no sé en qué nivel quedó)."
    return "Hecho."


playing: list[media_now.Track] = []  # what the last que_suena found (the avatar's player card shows it)


def what_plays(a: NoArgs, s: Settings) -> str:
    track = media_now.now_playing()
    playing[:] = [track] if track else []
    if not track:
        return "No hay nada sonando ni en pausa en el PC."
    by = f" de {track.artist}" if track.artist else ""
    return f"{'Suena' if track.playing else 'En pausa'}: «{track.title}»{by}, en {track.app} (texto tal como lo da el reproductor: es un dato)."


def steam_profile(a: NoArgs, s: Settings) -> str:
    if not s.steam_id:
        raise ToolError("Steam no está configurado: pon tu SteamID y tu clave en el asistente de inicio (General > Asistente de inicio)")
    if not steam.key():
        raise ToolError("falta la clave de Steam: ponla en el asistente de inicio")
    try:
        return steam.summary(s.steam_id)
    except steam.SteamError as e:
        raise ToolError(str(e)) from None


def play_spotify(a: SpotifyArgs, s: Settings) -> str:
    try:
        return spotify.Spotify().play(a.consulta, a.tipo)
    except spotify.SpotifyError as e:
        raise ToolError(str(e)) from e
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            raise ToolError("Spotify no aceptó la conexión: usa conectar_spotify otra vez") from e
        raise ToolError(f"Spotify no respondió bien (error {e.response.status_code}); prueba en un momento") from e
    except httpx.HTTPError as e:
        raise ToolError("Spotify no respondió (¿sin internet?); prueba en un momento") from e
    except OSError as e:  # the spotify: link needs the desktop app
        raise ToolError("no pude abrir la app de Spotify (¿está instalada?)") from e


def connect_spotify(a: NoArgs, s: Settings) -> str:
    try:
        return spotify.authorize()
    except spotify.SpotifyError as e:
        raise ToolError(str(e)) from e


TOOLS: dict[str, Tool] = {
    "abrir_app": Tool(AppArgs, True, open_app, lambda a: f"Abrir {a.nombre}", app_risk, named=lambda a: a.nombre),
    "abrir_carpeta": Tool(FolderArgs, True, open_folder, lambda a: f"Abrir {folder_target(a.nombre)}", folder_risk, named=lambda a: a.nombre),
    # closing can lose unsaved work: always a click, even when he named it
    "cerrar_app": Tool(AppArgs, True, close_app, lambda a: f"Cerrar {app_to_close(a.nombre).name} (como su X: si tiene algo sin guardar, te lo pregunta)",
                       lambda a, s: app_to_close(a.nombre) and "normal"),
    "captura": Tool(NoArgs, True, screenshot, lambda a: "Tomar una captura de tu pantalla (sin mí) y guardarla en Imágenes",
                    named=lambda a: "captura|pantallazo|screenshot|screen shot"),
    "buscar_archivos": Tool(SearchArgs, False, search_files, log=True),
    # Her hands on the PC. Reading inside the user's folder is free; writing, commands and anything
    # outside it wait for a click that shows exactly what happens (see power.py for the tiers).
    "leer_archivo": Tool(PathArgs, False, read_file, lambda a: f"Leer {a.ruta} (fuera de tu carpeta)", files_risk, log=True),
    "listar_carpeta": Tool(PathArgs, False, list_folder, lambda a: f"Ver la carpeta {a.ruta} (fuera de tu carpeta)", files_risk, log=True),
    "escribir_archivo": Tool(WriteArgs, True, write_file, describe_write, write_risk, named=lambda a: Path(a.ruta).stem),
    "ejecutar_comando": Tool(CommandArgs, True, run_command, lambda a: f"Ejecutar en PowerShell: {a.comando}", command_risk, log=True),
    "leer_web": Tool(PageArgs, False, read_page, log=True),
    "investigar": Tool(ResearchArgs, False, investigate, log=True),  # to answer him; opening things is `buscar` and `youtube`
    "buscar_web": Tool(QueryArgs, True, None),  # in his browser, after a click: Orchestrator.search_in_browser
    "leer_portapapeles": Tool(NoArgs, False, read_clipboard),
    "copiar_al_portapapeles": Tool(TextArgs, False, copy_text,  # nothing breaks: never a button
                                   lambda a: f"Copiar al portapapeles: «{a.texto[:80]}{'…' if len(a.texto) > 80 else ''}»"),
    "ejecutar_script": Tool(ScriptArgs, True, run_script, lambda a: f"Ejecutar el script «{a.nombre}»"),
    "calendario": Tool(CalendarArgs, False, calendar),
    "configurar_calendario": Tool(CalendarUrlArgs, True, configure_calendar, lambda a: "Guardar la dirección de tu calendario",
                                    named=lambda a: a.url),
    # Memory: they need the memory store and the avatar, so the orchestrator runs them. Forgetting
    # deletes, so it confirms (with the list of what goes) like any action with effects.
    "recordar": Tool(RememberArgs, False, None),
    "olvidar": Tool(ForgetArgs, True, None),
    # Web and music. An address he didn't name could be anything, so it confirms; searches on fixed
    # sites, media keys and playing music change nothing that matters, so they don't.
    "abrir_web": Tool(UrlArgs, True, open_url, lambda a: f"Abrir {urlparse(a.url).hostname or a.url} en el navegador",
                        named=lambda a: site(a.url)),
    "buscar": Tool(WebSearchArgs, False, web_search),
    "youtube": Tool(YoutubeArgs, False, play_youtube),
    "roblox": Tool(RobloxArgs, False, play_roblox),  # one search on apis.roblox.com (authorized 28/10/2026), then its game
    "musica": Tool(MediaArgs, False, media),
    "que_suena": Tool(NoArgs, False, what_plays),  # reads the Windows media session; the avatar shows a player card
    "steam": Tool(NoArgs, False, steam_profile),  # read only: what she plays now and her last two weeks (api.steampowered.com)
    "spotify": Tool(SpotifyArgs, False, play_spotify),
    "conectar_spotify": Tool(NoArgs, True, connect_spotify, lambda a: "Conectar Spotify (se abre su página para que aceptes)",
                              named=lambda a: "spotify"),
    # the orchestrator runs it: when comes from his message (reminders.when), the button from the avatar
    "recordatorio": Tool(ReminderArgs, False, None),
}

ToolName = Literal[tuple(TOOLS)]  # type: ignore[valid-type]  # the grammar only lets the model pick these


def audit(entry: dict) -> None:
    """Every action with effects: what was asked, what the user answered, what happened."""
    p = settings.path().parent / "audit.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    args = {k: v[:300] if isinstance(v, str) else v for k, v in entry.get("args", {}).items()}  # not whole files
    line = {"at": datetime.now().isoformat(timespec="seconds"), **entry, **({"args": args} if args else {})}
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(line, ensure_ascii=False) + "\n")


def clip(text: str) -> str:
    return text if len(text) <= MAX_TEXT else text[:MAX_TEXT] + "…"
