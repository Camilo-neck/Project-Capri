"""Spotify through its Web API, to play what the user asks for. An external call authorized by the
user (accounts.spotify.com and api.spotify.com only). Uses the same Spotify app as the user's
"telon" project: PKCE, so only a public Client ID, no secret. Playback needs Spotify Premium; without
it Capri opens the song in the Spotify app instead.

Connecting: authorize() opens the browser on Spotify's consent page and listens once on the
registered redirect (127.0.0.1) for the code, then keeps the tokens next to the user's config."""

import base64
import hashlib
import json
import logging
import os
import secrets
import threading
import time
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from app import settings

log = logging.getLogger(__name__)

AUTH = "https://accounts.spotify.com/authorize"
TOKEN = "https://accounts.spotify.com/api/token"
API = "https://api.spotify.com/v1"
SCOPES = "user-modify-playback-state user-read-playback-state"
KINDS = {"cancion": "track", "playlist": "playlist", "album": "album", "artista": "artist"}
LOGIN_S = 180  # how long the one-shot callback server waits for the user to authorize


class SpotifyError(Exception):
    """Something to tell the user (not connected, nothing found, no device...)."""


def token_path():
    return settings.path().parent / "spotify_token.json"


def challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def save_token(data: dict, now: float | None = None) -> None:
    old = load_token() or {}
    token = {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token") or old.get("refresh_token"),  # refreshes may omit it
        "expires_at": (now or time.time()) + int(data.get("expires_in", 3600)) - 60,
    }
    token_path().parent.mkdir(parents=True, exist_ok=True)
    token_path().write_text(json.dumps(token), encoding="utf-8")


def load_token() -> dict | None:
    try:
        return json.loads(token_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def connected() -> bool:
    return bool((load_token() or {}).get("refresh_token"))


# ---- connecting (PKCE) ----


def authorize_url(client_id: str, redirect: str, verifier: str, state: str) -> str:
    return AUTH + "?" + urlencode({
        "client_id": client_id, "response_type": "code", "redirect_uri": redirect, "scope": SCOPES,
        "code_challenge_method": "S256", "code_challenge": challenge(verifier), "state": state,
    })


def exchange(code: str, client_id: str, redirect: str, verifier: str, http: httpx.Client) -> None:
    r = http.post(TOKEN, data={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect,
                               "client_id": client_id, "code_verifier": verifier})
    r.raise_for_status()
    save_token(r.json())


def authorize(open_url: Callable[[str], None] = os.startfile) -> str:
    """Opens Spotify's consent page and, in the background, waits for the redirect with the code.
    Returns at once (the user takes a while); the tokens get saved when they come back."""
    s = settings.load()
    if not s.spotify_client_id:
        raise SpotifyError("falta el Client ID de Spotify en config.toml ([spotify] client_id)")
    verifier, state = secrets.token_urlsafe(64), secrets.token_urlsafe(16)
    target = urlparse(s.spotify_redirect)
    done = threading.Event()

    class Callback(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            q = parse_qs(urlparse(self.path).query)
            ok = urlparse(self.path).path == target.path and q.get("state") == [state] and "code" in q
            if ok:
                try:
                    with httpx.Client(timeout=15) as http:
                        exchange(q["code"][0], s.spotify_client_id, s.spotify_redirect, verifier, http)
                except httpx.HTTPError as e:
                    log.warning("spotify token exchange failed: %s", e)
                    ok = False
            self.send_response(200 if ok else 400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            msg = "Listo, Capri ya puede poner tu música. Puedes cerrar esta pestaña." if ok else "No se pudo conectar Spotify."
            self.wfile.write(f"<p style='font:18px sans-serif'>{msg}</p>".encode())
            done.set()

        def log_message(self, *args):
            pass

    try:
        server = HTTPServer((target.hostname, target.port or 80), Callback)
    except OSError as e:
        raise SpotifyError(f"no pude escuchar en {s.spotify_redirect} (¿lo está usando otra app?): {e}") from e
    server.timeout = 1

    def serve():
        deadline = time.time() + LOGIN_S
        while not done.is_set() and time.time() < deadline:
            server.handle_request()
        server.server_close()

    threading.Thread(target=serve, daemon=True).start()
    open_url(authorize_url(s.spotify_client_id, s.spotify_redirect, verifier, state))
    return "Abrí Spotify en el navegador: el usuario tiene que aceptar ahí. Luego ya podrás poner música."


# ---- the Web API ----


class Spotify:
    def __init__(self, http: httpx.Client | None = None, open_url: Callable[[str], None] = os.startfile,
                 sleep: Callable[[float], None] = time.sleep):
        self.http = http or httpx.Client(timeout=15)
        self.open_url = open_url
        self.sleep = sleep

    def access(self) -> str:
        t = load_token()
        if not t or not t.get("refresh_token"):
            raise SpotifyError("Spotify no está conectado: usa conectar_spotify")
        if time.time() < t["expires_at"]:
            return t["access_token"]
        r = self.http.post(TOKEN, data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"],
                                        "client_id": settings.load().spotify_client_id})
        if r.status_code in (400, 401):
            raise SpotifyError("la conexión con Spotify caducó: usa conectar_spotify otra vez")
        r.raise_for_status()
        save_token(r.json())
        return load_token()["access_token"]

    def call(self, method: str, path: str, **kw) -> httpx.Response:
        return self.http.request(method, API + path, headers={"Authorization": f"Bearer {self.access()}"}, **kw)

    def find(self, query: str, kind: str) -> dict:
        t = KINDS[kind]
        r = self.call("GET", "/search", params={"q": query, "type": t, "limit": 1})
        r.raise_for_status()
        items = [i for i in r.json()[f"{t}s"]["items"] if i]
        if not items:
            raise SpotifyError(f"no encontré nada en Spotify para «{query}»")
        return items[0]

    def device(self) -> str | None:
        """The active device, else this PC's Spotify app (opened if needed)."""
        for attempt in range(6):
            r = self.call("GET", "/me/player/devices")
            r.raise_for_status()
            devices = r.json()["devices"]
            pick = next((d for d in devices if d["is_active"]), None) or next(
                (d for d in devices if d["type"] == "Computer"), None) or (devices[0] if devices else None)
            if pick:
                return pick["id"]
            if attempt == 0:
                self.open_url("spotify:")  # the desktop app shows up as a device once it's running
            self.sleep(1.5)
        return None

    def play(self, query: str, kind: str = "cancion") -> str:
        item = self.find(query, kind)
        name = item["name"] + (f" de {item['artists'][0]['name']}" if item.get("artists") else "")
        body = {"uris": [item["uri"]]} if kind == "cancion" else {"context_uri": item["uri"]}
        device = self.device()
        r = self.call("PUT", "/me/player/play", params={"device_id": device} if device else None, json=body)
        if r.status_code in (200, 202, 204):
            # Spotify may accept the command and still not play (seen on free accounts): check it really does.
            for _ in range(3):
                self.sleep(1)
                st = self.call("GET", "/me/player")
                if st.status_code == 200 and st.json().get("is_playing"):
                    return f"Sonando en Spotify: {name}."
            self.open_url(item["uri"])
            return f"Spotify no la empezó a sonar (sin Premium no deja); abrí {name} en la app para que le des play."
        if r.status_code == 403:  # playback through the API is Premium only: open it in the app instead
            self.open_url(item["uri"])
            return f"Abrí {name} en Spotify (para que suene solo hace falta Premium; dale a play)."
        if r.status_code == 404:
            self.open_url(item["uri"])
            return f"No encontré un Spotify activo; abrí {name} en la app."
        r.raise_for_status()
        return f"Sonando en Spotify: {name}."
