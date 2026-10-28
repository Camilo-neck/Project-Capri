"""What Capri may do beyond her fixed tools: files, PowerShell and the web. Four tiers:

- free: reading and listing inside the user's folder, reading web pages, read-only commands
- click: anything else (the button shows the exact path or command)
- red click: deleting, installing, downloading to run, the registry, the system, anything outside the
  user's folder, and anything after she read content from outside (a page, a file) in the same turn
- never: credentials, browser profiles, keys, and her own config and tokens

The command classifier is a heuristic: a shell can say the same thing many ways. What actually keeps
it safe is that every command that isn't plainly read-only shows its exact text and waits for a click."""

import ipaddress
import re
import socket
import subprocess
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, unquote, urljoin, urlparse

import httpx

from app import settings

HOME = Path.home()
MAX_READ = 200_000  # bytes of a file looked at
MAX_PAGE = 2_000_000  # bytes of a web page downloaded
LIST_MAX = 100
SHELL_S = 120
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36", "Accept-Language": "es-CO,es;q=0.9"}


class ToolError(Exception):
    """A refusal or failure to tell the model about (not a crash)."""


# ---- files ----

SENSITIVE = re.compile(
    r"(^|/)(\.ssh|\.aws|\.gnupg|\.azure|\.kube|\.git-credentials|\.npmrc|\.pypirc|\.netrc|id_rsa[^/]*|id_ed25519[^/]*|"
    r"[^/]*\.(pem|key|kdbx|pfx|p12)|\.env(\..*)?|login data|cookies|web data|ntuser\.dat.*)(/|$)"
    r"|appdata/roaming/capri(/|$)|user data/|mozilla/firefox/profiles|microsoft/(credentials|protect|vault)|spotify_token",
    re.I,
)


def resolve(raw: str) -> Path:
    p = Path(raw.strip().strip('"')).expanduser()
    return (p if p.is_absolute() else HOME / p).resolve()


def inside_home(p: Path) -> bool:
    return p == HOME or HOME in p.parents


def guard(raw: str) -> tuple[Path, str]:
    """The resolved path and its risk ("normal" inside the user's folder, "alto" outside); refuses the private ones."""
    p = resolve(raw)
    cfg = settings.path().parent.resolve()
    if SENSITIVE.search(p.as_posix()) or p == cfg or cfg in p.parents:
        raise ToolError("eso son credenciales, claves o datos privados (o mi propia configuración): no los toco")
    return p, "normal" if inside_home(p) else "alto"


def list_dir(raw: str) -> str:
    p, _ = guard(raw)
    if not p.is_dir():
        raise ToolError(f"{p} no es una carpeta")
    rows = []
    for e in sorted(p.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
        if SENSITIVE.search(e.as_posix()):
            continue
        try:
            rows.append(e.name + ("/" if e.is_dir() else f"  ({e.stat().st_size:,} B)"))
        except OSError:
            rows.append(e.name + "  (sin acceso)")
    more = f"\n… y {len(rows) - LIST_MAX} más" if len(rows) > LIST_MAX else ""
    return f"{p}:\n" + "\n".join(rows[:LIST_MAX]) + more if rows else f"{p} está vacía."


def read_file(raw: str) -> str:
    p, _ = guard(raw)
    if not p.is_file():
        raise ToolError(f"{p} no es un archivo")
    with p.open("rb") as f:
        data = f.read(MAX_READ)
    if b"\0" in data[:2048]:
        raise ToolError(f"{p.name} no es un archivo de texto")
    return data.decode("utf-8", errors="replace")


def write_file(raw: str, text: str, mode: str) -> str:
    p, _ = guard(raw)
    if mode == "crear" and p.exists():
        raise ToolError(f"{p.name} ya existe: usa «añadir» o «reemplazar»")
    p.parent.mkdir(parents=True, exist_ok=True)
    if mode == "añadir":
        with p.open("a", encoding="utf-8") as f:
            f.write(text)
    else:
        p.write_text(text, encoding="utf-8")
    return f"Escribí {len(text)} caracteres en {p}."


# ---- PowerShell ----

# First word of each pipeline stage must be one of these, and no way to chain, redirect or nest.
READ_ONLY = {
    "get-process", "get-service", "get-ciminstance", "get-computerinfo", "get-date", "get-psdrive", "get-volume",
    "get-disk", "get-netipaddress", "get-netadapter", "get-childitem", "get-item", "get-location", "get-command",
    "get-host", "get-counter", "get-timezone", "get-hotfix", "get-wmiobject", "get-localuser", "get-childitem",
    "select-object", "where-object", "sort-object", "measure-object", "format-table", "format-list", "out-string",
    "convertto-json", "group-object", "hostname", "whoami", "ipconfig", "systeminfo", "tasklist", "dir", "ls", "date",
}
CHAINING = re.compile(r"[;&<>`${}()\n]")
# `{ $_.Name -eq 'x' }`: a plain comparison on the piped object is the one script block that stays read-only.
SIMPLE_BLOCK = re.compile(
    r"\{\s*\$_(\.\w+)+\s+-(?:eq|ne|like|notlike|match|notmatch|gt|lt|ge|le|contains)\s+('[^']*'|\"[^\"$`]*\"|[\w.-]+)\s*\}", re.I)
DANGEROUS = re.compile(
    r"\b(remove-item|ri|rm|del|erase|rd|rmdir|diskpart|clear-disk|reg|regedit|set-itemproperty|new-itemproperty|"
    r"remove-itemproperty|taskkill|stop-process|kill|stop-service|sc|shutdown|restart-computer|stop-computer|logoff|"
    r"winget|choco|scoop|msiexec|pip|pipx|npm|npx|cargo|install|uninstall|iwr|irm|curl|wget|invoke-webrequest|"
    r"invoke-restmethod|start-bitstransfer|invoke-expression|iex|schtasks|netsh|net|set-executionpolicy|set-mppreference|"
    r"add-mppreference|bcdedit|icacls|takeown|cipher|wmic|enter-pssession|invoke-command)\b"
    r"|\bformat\s+[a-z]:|\bgit\s+(push|reset|clean|rebase|rm|checkout\s+--|branch\s+-d|stash\s+drop)\b"
    r"|[a-z]:[\\/](windows|program files)|\\system32",
    re.I,
)


def command_risk(cmd: str) -> str:
    """"libre" (read-only, runs without asking), "normal" (asks) or "alto" (asks in red). Refuses private paths."""
    flat = cmd.replace("\\", "/")
    if SENSITIVE.search(flat) or SENSITIVE.search(re.sub(r"[\s\"']+", "/", flat)):
        raise ToolError("ese comando toca credenciales, claves o datos privados (o mi propia configuración): no lo ejecuto")
    plain = SIMPLE_BLOCK.sub("BLOCK", cmd)
    stages = [s.split() for s in plain.split("|")]
    if not CHAINING.search(plain) and all(s and s[0].lower() in READ_ONLY for s in stages):
        return "libre"
    return "alto" if DANGEROUS.search(cmd) else "normal"


def run_command(cmd: str) -> str:
    prefix = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; "
    try:
        done = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", prefix + cmd], capture_output=True,
            encoding="utf-8", errors="replace", timeout=SHELL_S, cwd=HOME, creationflags=0x0800_0000, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired as e:
        raise ToolError(f"tardó más de {SHELL_S} s y lo detuve") from e
    out = (done.stdout + done.stderr).strip() or "(sin salida)"
    return f"Terminó con código {done.returncode}.\n{out}"


# ---- the web (reading) ----


def public(url: str) -> str:
    """The address, if it's http(s) to a public host: never this PC, the local network or Capri's own socket."""
    u = urlparse(url.strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ToolError(f"«{url}» no es una dirección web (tiene que empezar por https://)")
    try:
        ips = {ipaddress.ip_address(i[4][0]) for i in socket.getaddrinfo(u.hostname, u.port or 443)}
    except OSError as e:
        raise ToolError(f"no encontré {u.hostname}") from e
    if any(not ip.is_global for ip in ips):
        raise ToolError(f"{u.hostname} es una dirección de esta red o de este PC: no la leo")
    return u.geturl()


class Text(HTMLParser):
    """Visible text of a page: no scripts or styles, a line break at block tags."""

    SKIP = {"script", "style", "noscript", "svg", "head", "template"}
    BREAK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "table"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        self.skip += tag in self.SKIP
        if tag in self.BREAK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        self.skip -= tag in self.SKIP and self.skip > 0
        if tag in self.BREAK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def page_text(html: str) -> str:
    p = Text()
    p.feed(html)
    lines = (re.sub(r"[ \t\xa0]+", " ", ln).strip() for ln in "".join(p.parts).splitlines())
    return re.sub(r"\n{2,}", "\n", "\n".join(ln for ln in lines if ln))


def get(url: str, http: httpx.Client | None = None) -> str:
    """Downloads a page (each redirect checked as public too) and returns its text."""
    http = http or httpx.Client(timeout=12, headers=UA)
    for _ in range(5):
        url = public(url)
        with http.stream("GET", url) as r:
            if r.is_redirect:
                url = urljoin(url, r.headers["location"])
                continue
            r.raise_for_status()
            body = b"".join(c for _, c in zip(range(MAX_PAGE // 65536 + 1), r.iter_bytes(65536)))[:MAX_PAGE]
            kind = r.headers.get("content-type", "")
            text = body.decode(r.encoding or "utf-8", errors="replace")
        if "html" in kind:
            return page_text(text)
        if kind.startswith("text/") or "json" in kind or "xml" in kind:
            return text
        raise ToolError(f"eso no es una página de texto ({kind or 'tipo desconocido'})")
    raise ToolError("demasiadas redirecciones")


def search(query: str, http: httpx.Client | None = None) -> str:
    """Top web results (title, address, snippet) from DuckDuckGo's HTML page."""
    http = http or httpx.Client(timeout=12, headers=UA)
    r = http.post("https://html.duckduckgo.com/html/", data={"q": query}, follow_redirects=True)
    r.raise_for_status()
    if r.status_code == 202 or "anomaly" in r.text:  # its bot challenge: not "nothing found"
        raise ToolError("el buscador (DuckDuckGo) me está bloqueando con un captcha; no es que no exista. "
                        "Ábrele la búsqueda en su navegador con `buscar` y díselo")
    links = re.findall(r'class="result__a" href="([^"]+)"[^>]*>(.*?)</a>', r.text, re.S)
    snippets = re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', r.text, re.S)
    rows = []
    for (href, title), snippet in zip(links, snippets):
        if "uddg=" in href:  # DuckDuckGo's redirect wrapper
            href = unquote(parse_qs(urlparse(href).query).get("uddg", [href])[0])
        clean = lambda s: unescape(re.sub(r"<.*?>", "", s)).strip()  # noqa: E731
        rows.append(f"{clean(title)}\n{href}\n{clean(snippet)}")
        if len(rows) == 5:
            break
    if not rows:
        raise ToolError(f"no encontré resultados para «{query}»")
    return "\n\n".join(rows)
