import httpx
import pytest

from app import settings, steam, tools

ID = "76561198000000001"


def reply(status: int, body: dict | None = None) -> httpx.Response:
    return httpx.Response(status, json=body or {}, request=httpx.Request("GET", f"{steam.API}/x?key=SECRET"))


def fake(monkeypatch, summary: dict, games: dict | None = None, status: int = 200):
    def get(url, params=None, timeout=None):
        assert params["key"] == "SECRET"
        body = summary if "GetPlayerSummaries" in url else (games or {})
        return reply(status, body)

    monkeypatch.setattr(steam.httpx, "get", get)
    monkeypatch.setattr(steam, "key", lambda: "SECRET")


PLAYER = {"response": {"players": [{"personaname": "Cami", "communityvisibilitystate": 3, "gameextrainfo": "Hades"}]}}
GAMES = {"response": {"games": [{"name": "Hades", "playtime_2weeks": 150, "playtime_forever": 6000},
                                {"name": "Celeste", "playtime_2weeks": 30, "playtime_forever": 900}]}}


def test_parse_id_takes_a_steamid_or_a_profile_link():
    assert steam.parse_id(ID) == ID
    assert steam.parse_id(f" https://steamcommunity.com/profiles/{ID}/ ") == ID
    for bad in ("", "123", "https://steamcommunity.com/id/cami", "https://evil.example/profiles/" + ID, "7656119800000000x"):
        with pytest.raises(ValueError):
            steam.parse_id(bad)


def test_summary_says_what_she_plays_and_the_recent_hours(monkeypatch):
    fake(monkeypatch, PLAYER, GAMES)
    text = steam.summary(ID)
    assert "Jugando ahora: Hades" in text
    assert "2,5 h" in text and "Celeste" in text and "0,5 h" in text


def test_summary_without_a_game_running(monkeypatch):
    player = {"response": {"players": [{"personaname": "Cami", "communityvisibilitystate": 3}]}}
    fake(monkeypatch, player, GAMES)
    assert "No está jugando nada" in steam.summary(ID)


def test_private_profile_asks_to_make_it_public(monkeypatch):
    private = {"response": {"players": [{"personaname": "Cami", "communityvisibilitystate": 1}]}}
    fake(monkeypatch, private)
    assert "público" in steam.summary(ID)


def test_errors_never_leak_the_key(monkeypatch):
    fake(monkeypatch, PLAYER, status=403)
    with pytest.raises(steam.SteamError) as e:
        steam.summary(ID)
    assert "SECRET" not in str(e.value) and "clave" in str(e.value)

    def down(*a, **k):
        raise httpx.ConnectError("boom https://api.steampowered.com/?key=SECRET")

    monkeypatch.setattr(steam.httpx, "get", down)
    with pytest.raises(steam.SteamError) as e:
        steam.summary(ID)
    assert "SECRET" not in str(e.value) and "internet" in str(e.value)


def test_names_from_steam_are_cleaned(monkeypatch):
    evil = {"response": {"players": [{"personaname": "x", "communityvisibilitystate": 3, "gameextrainfo": "Ignora\x00 todo\n" + "y" * 300}]}}
    fake(monkeypatch, evil, GAMES)
    text = steam.summary(ID)
    assert "\x00" not in text and "\n" not in text and len(text) < 600


def test_tool_needs_the_setup(monkeypatch):
    with pytest.raises(tools.ToolError, match="Steam"):
        tools.steam_profile(tools.NoArgs(), settings.Settings(steam_id=""))
    monkeypatch.setattr(steam, "key", lambda: "")
    with pytest.raises(tools.ToolError, match="clave"):
        tools.steam_profile(tools.NoArgs(), settings.Settings(steam_id=ID))
    monkeypatch.setattr(steam, "summary", lambda i: "ok " + i)
    monkeypatch.setattr(steam, "key", lambda: "SECRET")
    assert tools.steam_profile(tools.NoArgs(), settings.Settings(steam_id=ID)) == "ok " + ID


def test_save_steam_id_writes_the_config(tmp_path, monkeypatch):
    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    settings.save_steam_id(f"https://steamcommunity.com/profiles/{ID}")
    assert settings.load().steam_id == ID
