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
    assert "# Tu calendario" in text and '[nueva]\nclave = "con \\"comillas\\""' in text


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


def test_a_search_on_any_other_site_goes_through_google(opened):
    # "busca ideas en pinterest" was refused: only youtube, google and spotify were allowed
    tools.web_search(tools.WebSearchArgs(sitio="pinterest", consulta="disfraces"), settings.Settings())
    assert opened == ["https://www.google.com/search?q=disfraces%20pinterest"]


def test_a_streamer_on_kick_or_twitch_opens_their_channel(opened):
    # he had to paste kick.com/lacobraaa himself
    tools.web_search(tools.WebSearchArgs(sitio="Kick", consulta="LACOBRAAA"), settings.Settings())
    tools.web_search(tools.WebSearchArgs(sitio="kick.com", consulta="westcol"), settings.Settings())
    tools.web_search(tools.WebSearchArgs(sitio="twitch", consulta="Auron Play"), settings.Settings())
    assert opened == ["https://kick.com/lacobraaa", "https://kick.com/westcol", "https://www.twitch.tv/auronplay"]


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

    def __init__(self, plays=True, current=None, found=True):
        self.plays = plays  # what /me/player says: is something playing
        self.current = current  # and what (None: what was just opened)
        self.found = found  # does an artist:"..." search find anything
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path.endswith("/api/token"):
            return httpx.Response(200, json={"access_token": "NEW", "expires_in": 3600})
        if path.endswith("/search"):
            t = request.url.params["type"]
            item = {"name": "Bohemian Rhapsody", "uri": f"spotify:{t}:1", "artists": [{"name": "Queen"}]}
            found = self.found or "artist:" not in request.url.params["q"]
            return httpx.Response(200, json={f"{t}s": {"items": [item] if found else []}})
        if path.endswith("/me/player"):
            return httpx.Response(200, json={"is_playing": self.plays, "item": {"uri": self.current or "spotify:track:1"}})
        return httpx.Response(404)


def client(fake: FakeSpotify, opened: list[str]) -> spotify.Spotify:
    return spotify.Spotify(http=httpx.Client(transport=httpx.MockTransport(fake)), open_url=opened.append,
                           sleep=lambda s: None)


def connect(expires_in: int = 3600):
    settings.set_value("spotify", "client_id", "cid")
    spotify.save_token({"access_token": "OLD", "refresh_token": "R", "expires_in": expires_in})


def test_a_song_opens_in_the_app_and_is_checked_to_play():
    connect()
    fake, opened = FakeSpotify(), []
    assert client(fake, opened).play("bohemian rhapsody") == "Sonando en Spotify: Bohemian Rhapsody de Queen."
    assert opened == ["spotify:track:1"]
    assert not any(r.method == "PUT" for r in fake.requests)  # no playback commands through the API


def test_a_song_that_does_not_start_says_so_instead_of_claiming_it():
    connect()
    opened: list[str] = []
    msg = client(FakeSpotify(plays=False), opened).play("x")
    assert opened == ["spotify:track:1"] and "dale play" in msg and "Sonando" not in msg


def test_playlists_and_albums_open_and_wait_for_a_play():
    connect()
    opened: list[str] = []
    msg = client(FakeSpotify(), opened).play("lofi para estudiar", "playlist")
    assert opened == ["spotify:playlist:1"] and "Dale play" in msg


def test_an_artist_gives_a_song_by_them():
    connect()
    fake, opened = FakeSpotify(), []
    client(fake, opened).play("Laufey", "artista")
    search = next(r for r in fake.requests if r.url.path.endswith("/search"))
    assert search.url.params["type"] == "track" and search.url.params["q"] == 'artist:"Laufey"'
    assert opened == ["spotify:track:1"]


def test_tokens_refresh_when_stale_and_are_kept():
    connect(expires_in=0)
    fake, opened = FakeSpotify(), []
    client(fake, opened).play("lofi para estudiar", "playlist")
    assert fake.requests[0].url.path.endswith("/api/token")  # refreshed first
    assert fake.requests[1].headers["Authorization"] == "Bearer NEW"
    assert spotify.load_token()["refresh_token"] == "R"  # kept: the refresh didn't send a new one


def test_not_connected_tells_capri_to_connect():
    with pytest.raises(tools.ToolError, match="conectar_spotify"):
        tools.play_spotify(tools.SpotifyArgs(consulta="algo"), settings.load())
    assert not tools.TOOLS["spotify"].effect and tools.TOOLS["conectar_spotify"].effect


def test_the_result_with_the_most_words_of_the_query_wins():
    connect()
    items = [{"name": "MÁS DE AHÍ - Remix", "uri": "spotify:track:1", "artists": [{"name": "Topboy TGR"}]},
             {"name": "NALGUISIMA", "uri": "spotify:track:2", "artists": [{"name": "Topboy TGR"}]}]

    def fake(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"tracks": {"items": items}})

    sp = spotify.Spotify(http=httpx.Client(transport=httpx.MockTransport(fake)), open_url=lambda u: None)
    assert sp.find("Nalguisima de topboy", "cancion")["uri"] == "spotify:track:2"


def find_among(items: list[dict], query: str) -> str:
    connect()
    sp = spotify.Spotify(http=httpx.Client(transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json={"tracks": {"items": items}}))), open_url=lambda u: None)
    return sp.find(query, "cancion")["uri"]


def test_spotifys_first_result_wins_unless_another_matches_better():
    # the model split "topboy": "Top Boy" by Boy Pablo had more words of the query than the song asked for
    nalguisima = {"name": "NALGUISIMA", "uri": "spotify:track:1", "artists": [{"name": "Topboy TGR"}]}
    top_boy = {"name": "Top Boy", "uri": "spotify:track:2", "artists": [{"name": "Boy Pablo"}]}
    assert find_among([nalguisima, top_boy], "Nalguisima de Top Boy") == "spotify:track:1"
    remix = {"name": "Love On Myself (Play Remix)", "uri": "spotify:track:3", "artists": [{"name": "X"}]}
    song = {"name": "In Love With Myself", "uri": "spotify:track:4", "artists": [{"name": "Y"}]}
    assert find_among([remix, song], "in love with myself") == "spotify:track:4"


def test_verbs_and_spotify_are_left_out_of_the_search():
    connect()
    fake = FakeSpotify()
    client(fake, []).play("Play in love with myself on Spotify")
    client(fake, []).play("ponme Bohemian Rhapsody en spotify")
    qs = [r.url.params["q"] for r in fake.requests if r.url.path.endswith("/search")]
    assert qs == ["in love with myself", "Bohemian Rhapsody"]


def test_something_of_an_artist_said_any_way():
    connect()
    fake = FakeSpotify()
    client(fake, []).play("algo de Bad Bunny", "artista")
    assert [r.url.params["q"] for r in fake.requests if r.url.path.endswith("/search")] == ['artist:"Bad Bunny"']
    fake = FakeSpotify(found=False)
    opened: list[str] = []
    client(fake, opened).play("Bad Bunny y J Balvin", "artista")  # the filter finds nothing: a plain search
    assert [r.url.params["q"] for r in fake.requests if r.url.path.endswith("/search")] == \
        ['artist:"Bad Bunny y J Balvin"', "Bad Bunny y J Balvin"] and opened == ["spotify:track:1"]


def test_another_song_playing_is_not_taken_for_the_one_asked():
    connect()
    msg = client(FakeSpotify(current="spotify:track:other"), []).play("bohemian rhapsody")
    assert "Sonando" not in msg and "dale play" in msg


@pytest.mark.parametrize("error, says", [
    (httpx.HTTPStatusError("401", request=httpx.Request("GET", "https://x"), response=httpx.Response(401)), "conectar_spotify"),
    (httpx.HTTPStatusError("503", request=httpx.Request("GET", "https://x"), response=httpx.Response(503)), "Spotify no respondió"),
    (httpx.ConnectError("offline"), "Spotify no respondió"),
    (FileNotFoundError("spotify:track:1"), "app de Spotify"),
])
def test_spotify_failures_reach_her_in_plain_words(monkeypatch, error, says):
    def fail(self, *a):
        raise error

    monkeypatch.setattr(spotify.Spotify, "play", fail)
    with pytest.raises(tools.ToolError, match=says) as e:
        tools.play_spotify(tools.SpotifyArgs(consulta="algo"), settings.Settings())
    assert "Error" not in str(e.value) and "https://" not in str(e.value)


def test_the_volume_result_does_not_claim_a_level(monkeypatch):
    monkeypatch.setattr(tools, "press_key", lambda vk: None)
    msg = tools.media(tools.MediaArgs(accion="subir_volumen"), settings.Settings())
    assert "nivel" in msg and msg != "Hecho."


def test_youtube_opens_the_first_video_of_the_search(opened, monkeypatch):
    page = ('..."videoRenderer":{"videoId":"Cn_ydrQcB88","thumbnail":{},"title":{"runs":[{"text":"Topboy \u0026 co - NALGUISIMA"}]}...'
            '"videoRenderer":{"videoId":"zzzzzzzzzzz","title":{"runs":[{"text":"otro"}]}')
    monkeypatch.setattr(tools.httpx, "get", lambda *a, **k: httpx.Response(200, text=page, request=httpx.Request("GET", "https://x")))
    assert not tools.TOOLS["youtube"].effect
    msg = tools.play_youtube(tools.YoutubeArgs(consulta="nalguisima topboy"), settings.Settings())
    assert opened == ["https://www.youtube.com/watch?v=Cn_ydrQcB88"] and msg == "Abrí en YouTube: Topboy & co - NALGUISIMA."
    # no video found, or YouTube unreachable: the search opens in his browser instead of an error
    monkeypatch.setattr(tools.httpx, "get", lambda *a, **k: httpx.Response(200, text="nada", request=httpx.Request("GET", "https://x")))
    msg = tools.play_youtube(tools.YoutubeArgs(consulta="lo-fi"), settings.Settings())

    def offline(*a, **k):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(tools.httpx, "get", offline)
    tools.play_youtube(tools.YoutubeArgs(consulta="lo-fi"), settings.Settings())
    assert opened[1:] == ["https://www.youtube.com/results?search_query=lo-fi"] * 2 and "navegador" in msg
