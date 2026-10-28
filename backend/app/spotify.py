"""Spotify through its Web API, to play what the user asks for. An external call authorized by the
user (accounts.spotify.com and api.spotify.com only). Uses the same Spotify app as the user's
"telon" project: PKCE, so only a public Client ID, no secret. Playback goes through the Spotify app (opening
the song starts it): the API only finds what to play and checks that it plays.

Connecting: authorize() opens the browser on Spotify's consent page and listens once on the
registered redirect (127.0.0.1) for the code, then keeps the tokens next to the user's config."""

import base64
import hashlib
import json
import logging
import os
import secrets
import threading
import re
import time
import unicodedata
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


# what the model copies from "ponme X en Spotify" that isn't the song
ASKING = re.compile(r"^\s*(?:pon(?:me|le)?|reproduce|toca|play|quiero escuchar|escuchemos)\s+|\s+(?:en|on|in)\s+spotify\s*$", re.I)
SOMETHING_BY = re.compile(r"^\s*(?:algo|una canci[oó]n|canciones|m[uú]sica|something|a song|songs|music)\s+(?:de|del|by)\s+", re.I)
DECORATION = re.compile(r"\s+-\s+.*$|\s*[(\[].*?[)\]]")  # " - Remastered 2011", "(feat. X)", "[Live]"


def compact(text: str) -> str:
    """Lowercase letters and digits only, no accents or spaces: "Top Boy" and "topboy" are the same."""
    plain = unicodedata.normalize("NFKD", text.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[\W_]+", "", plain)


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
    """Finds with the Web API and plays by opening the item in the Spotify app. Starting playback through
    the API is refused for this app ("Restriction violated", the app's owner needs Premium), so the API
    only reads: what to play, and whether it's playing."""

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
        r = self.call("GET", "/search", params={"q": query, "type": t, "limit": 5})
        r.raise_for_status()
        items = [i for i in r.json()[f"{t}s"]["items"] if i]
        if not items:
            raise SpotifyError(f"no encontré nada en Spotify para «{query}»")
        # Spotify's ranking stays unless a later item's title (and then artist) is in the query and the first's
        # isn't. Counting shared words picked "Top Boy" by Boy Pablo for "Nalguisima de Top Boy".
        want = compact(query)

        def fits(i: dict) -> tuple[bool, bool]:
            title = compact(DECORATION.sub("", i["name"])) or compact(i["name"])
            return title in want, any(compact(a["name"]) in want for a in i.get("artists", []) if a.get("name"))

        return max(items, key=fits)  # max keeps the first of equals: Spotify's order

    def playing(self, uri: str) -> bool:
        """That item is what's playing (not something already on, here or on another device)."""
        r = self.call("GET", "/me/player")
        if r.status_code != 200 or not r.content:
            return False
        j = r.json()
        return bool(j.get("is_playing")) and (j.get("item") or {}).get("uri") == uri

    def play(self, query: str, kind: str = "cancion") -> str:
        query = ASKING.sub("", query).strip() or query
        if kind == "artista":  # a song by them, the way "pon algo de Shakira" means it
            artist = SOMETHING_BY.sub("", query).strip() or query
            try:
                item = self.find(f'artist:"{artist}"', "cancion")
            except SpotifyError:  # "Bad Bunny y J Balvin" isn't one artist's name
                item = self.find(artist, "cancion")
            kind = "cancion"
        else:
            item = self.find(query, kind)
        name = item["name"] + (f" de {item['artists'][0]['name']}" if item.get("artists") else "")
        self.open_url(item["uri"])  # starts a song by itself; a playlist or album waits for a play
        if kind != "cancion":
            return f"Abrí {name} en Spotify. Dale play ahí; desde aquí no puedo empezarla sola."
        for _ in range(6):  # the app takes a moment to start
            self.sleep(1)
            if self.playing(item["uri"]):
                return f"Sonando en Spotify: {name}."
        return f"Abrí {name} en Spotify; si no suena, dale play ahí."
