import json
import socket
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app import settings, spotify, tools


@pytest.fixture
def opened(monkeypatch):
    log: list[str] = []
    monkeypatch.setattr(tools.os, "startfile", log.append, raising=False)
    return log


def test_set_value_writes_in_its_own_section_and_keeps_the_rest(isolated_config):
    settings.load()
    settings.set_value("spotify", "client_id", "abc123")
    settings.set_value("calendario", "url", "https://calendar.google.com/calendar/ical/a/b/basic.ics")
    settings.set_value("nueva", "clave", 'con "comillas"')
    text = isolated_config.read_text(encoding="utf-8")
    s = settings.load()
    assert s.spotify_client_id == "abc123" and s.spotify_redirect == "http://127.0.0.1:5173/callback"
    assert s.calendar_url.endswith("/basic.ics") and "calculadora" in s.apps
    assert "# Dirección secreta" in text and '[nueva]\nclave = "con \\"comillas\\""' in text


def test_web_addresses_need_a_click_and_must_be_web(opened):
    assert tools.TOOLS["abrir_web"].effect
    assert tools.TOOLS["abrir_web"].describe(tools.UrlArgs(url="https://www.unal.edu.co/x")) == \
        "Abrir www.unal.edu.co en el navegador"
    with pytest.raises(tools.ToolError):
        tools.open_url(tools.UrlArgs(url="file:///C:/Windows/system32/calc.exe"), settings.Settings())
    with pytest.raises(tools.ToolError):
        tools.open_url(tools.UrlArgs(url="javascript:alert(1)"), settings.Settings())
    tools.open_url(tools.UrlArgs(url="https://www.unal.edu.co"), settings.Settings())
    assert opened == ["https://www.unal.edu.co"]


def test_searches_open_fixed_sites_without_asking(opened):
    assert not tools.TOOLS["buscar"].effect
    for sitio in ("youtube", "google", "spotify"):
        tools.web_search(tools.WebSearchArgs(sitio=sitio, consulta="lo-fi para estudiar & café"), settings.Settings())
    assert opened == [
        "https://www.youtube.com/results?search_query=lo-fi%20para%20estudiar%20%26%20caf%C3%A9",
        "https://www.google.com/search?q=lo-fi%20para%20estudiar%20%26%20caf%C3%A9",
        "spotify:search:lo-fi%20para%20estudiar%20%26%20caf%C3%A9",
    ]


def test_media_keys(monkeypatch):
    pressed: list[int] = []
    monkeypatch.setattr(tools, "press_key", pressed.append)
    tools.media(tools.MediaArgs(accion="siguiente"), settings.Settings())
    tools.media(tools.MediaArgs(accion="subir_volumen"), settings.Settings())
    assert pressed == [0xB0] + [0xAF] * 5


def test_pkce_challenge_is_unpadded_base64url_sha256():
    # SHA-256("abc") is the FIPS 180 test vector ba7816bf...15ad; base64url, no "=" padding
    assert spotify.challenge("abc") == "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_connecting_opens_consent_and_saves_tokens_from_the_redirect(monkeypatch):
    redirect = f"http://127.0.0.1:{free_port()}/callback"
    settings.set_value("spotify", "client_id", "cid")
    settings.set_value("spotify", "redirect_uri", redirect)
    got = {}

    def fake_exchange(code, client_id, redirect_uri, verifier, http):
        got.update(code=code, client_id=client_id, redirect=redirect_uri, verifier=verifier)
        spotify.save_token({"access_token": "A", "refresh_token": "R", "expires_in": 3600})

    monkeypatch.setattr(spotify, "exchange", fake_exchange)
    urls: list[str] = []
    spotify.authorize(open_url=urls.append)
    q = parse_qs(urlparse(urls[0]).query)
    assert q["client_id"] == ["cid"] and q["redirect_uri"] == [redirect] and q["code_challenge_method"] == ["S256"]
    assert "user-modify-playback-state" in q["scope"][0]
    bad = httpx.get(f"{redirect}?code=x&state=forged", timeout=5)  # someone else's redirect: ignored
    assert bad.status_code == 400 and not spotify.connected()
    spotify.authorize(open_url=urls.append)  # the first one-shot server is gone; start again
    q = parse_qs(urlparse(urls[1]).query)
    ok = httpx.get(f"{redirect}?code=thecode&state={q['state'][0]}", timeout=5)
    assert ok.status_code == 200 and spotify.connected()
    assert got["code"] == "thecode" and spotify.challenge(got["verifier"]) == q["code_challenge"][0]


class FakeSpotify:
    """Spotify's API as a MockTransport: records requests, answers from a few knobs."""

    def __init__(self, devices=None, play_status=204):
        self.devices = devices if devices is not None else [{"id": "pc", "type": "Computer", "is_active": False}]
        self.play_status = play_status
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path.endswith("/api/token"):
            return httpx.Response(200, json={"access_token": "NEW", "expires_in": 3600})
        if path.endswith("/search"):
            t = request.url.params["type"]
            item = {"name": "Bohemian Rhapsody", "uri": f"spotify:{t}:1", "artists": [{"name": "Queen"}]}
            return httpx.Response(200, json={f"{t}s": {"items": [item]}})
        if path.endswith("/devices"):
            return httpx.Response(200, json={"devices": self.devices})
        if path.endswith("/play"):
            return httpx.Response(self.play_status)
        return httpx.Response(404)


def client(fake: FakeSpotify, opened: list[str]) -> spotify.Spotify:
    return spotify.Spotify(http=httpx.Client(transport=httpx.MockTransport(fake)), open_url=opened.append,
                           sleep=lambda s: None)


def connect(expires_in: int = 3600):
    settings.set_value("spotify", "client_id", "cid")
    spotify.save_token({"access_token": "OLD", "refresh_token": "R", "expires_in": expires_in})


def test_plays_a_song_on_this_pc():
    connect()
    fake, opened = FakeSpotify(), []
    assert client(fake, opened).play("bohemian rhapsody") == "Sonando en Spotify: Bohemian Rhapsody de Queen."
    play = fake.requests[-1]
    assert play.method == "PUT" and play.url.params["device_id"] == "pc"
    assert json.loads(play.content) == {"uris": ["spotify:track:1"]} and play.headers["Authorization"] == "Bearer OLD"


def test_playlists_play_as_a_context_and_tokens_refresh_when_stale():
    connect(expires_in=0)
    fake, opened = FakeSpotify(), []
    client(fake, opened).play("lofi para estudiar", "playlist")
    assert fake.requests[0].url.path.endswith("/api/token")  # refreshed first
    assert json.loads(fake.requests[-1].content) == {"context_uri": "spotify:playlist:1"}
    assert fake.requests[-1].headers["Authorization"] == "Bearer NEW"
    assert spotify.load_token()["refresh_token"] == "R"  # kept: the refresh didn't send a new one


def test_without_premium_or_device_it_opens_the_song_in_the_app():
    connect()
    opened: list[str] = []
    assert "Premium" in client(FakeSpotify(play_status=403), opened).play("x")
    assert opened == ["spotify:track:1"]
    opened.clear()
    msg = client(FakeSpotify(devices=[], play_status=404), opened).play("x")
    assert opened[0] == "spotify:" and opened[-1] == "spotify:track:1" and "abrí" in msg.lower()


def test_not_connected_tells_capri_to_connect():
    with pytest.raises(tools.ToolError, match="conectar_spotify"):
        tools.play_spotify(tools.SpotifyArgs(consulta="algo"), settings.load())
    assert not tools.TOOLS["spotify"].effect and tools.TOOLS["conectar_spotify"].effect
