import json

import httpx
import pytest

from app import launch, settings, tools
from app.launch import Item


def test_steam_games_come_from_every_library(tmp_path):
    main, other = tmp_path / "Steam", tmp_path / "Games"
    (main / "steamapps").mkdir(parents=True)
    (other / "steamapps").mkdir(parents=True)
    (main / "steamapps" / "libraryfolders.vdf").write_text(
        '"libraryfolders"\n{\n "0" { "path" "%s" }\n "1" { "path" "%s" }\n}' % (str(main).replace("\\", "\\\\"), str(other).replace("\\", "\\\\")))
    (main / "steamapps" / "appmanifest_291550.acf").write_text('"AppState"\n{\n "appid" "291550"\n "name" "Brawlhalla"\n}')
    (other / "steamapps" / "appmanifest_228980.acf").write_text('"AppState"\n{\n "appid" "228980"\n "name" "Steamworks Common Redistributables"\n}')
    (other / "steamapps" / "appmanifest_1086940.acf").write_text('"AppState"\n{\n "appid" "1086940"\n "name" "Baldur\'s Gate 3"\n}')
    assert sorted(launch.steam_games(main)) == [Item("Baldur's Gate 3", "steam", "1086940"), Item("Brawlhalla", "steam", "291550")]
    assert launch.steam_games(None) == []


def test_epic_games_come_from_its_manifests(tmp_path):
    for name, m in {"a": {"DisplayName": "Fortnite", "AppName": "Fortnite", "CatalogNamespace": "fn", "CatalogItemId": "4fe"},
                    "b": {"DisplayName": "Unreal plugin", "AppName": "P", "CatalogNamespace": "ue", "CatalogItemId": "x"},
                    "c": {"DisplayName": "Half", "AppName": "H", "CatalogNamespace": "h", "CatalogItemId": "y", "bIsIncompleteInstall": True}}.items():
        (tmp_path / f"{name}.item").write_text(json.dumps(m))
    assert launch.epic_games(tmp_path) == [Item("Fortnite", "epic", "fn:4fe:Fortnite")]


ITEMS = [Item("Brawlhalla", "steam", "291550"), Item("Roblox Player", "app", "roblox"), Item("Spotify", "app", "Spotify.ID"),
         Item("AM Music", "app", "am"), Item("Media Player", "app", "media"), Item("Fortnite", "epic", "fn:4fe:Fortnite")]


@pytest.mark.parametrize("said, name", [
    ("abre brawlhalla", "Brawlhalla"), ("launch Roblox", "Roblox Player"), ("abre spotify", "Spotify"),
    ("abre AM Music", "AM Music"), ("pon el media player", "Media Player"), ("quiero jugar fortnite", "Fortnite"),
])
def test_the_one_he_named(said, name):
    assert launch.match(ITEMS, said).name == name


def test_nothing_close_enough_is_none():
    assert launch.match(ITEMS, "abre el bloc de notas") is None


def test_each_kind_opens_its_own_way(monkeypatch):
    opened, ran = [], []
    monkeypatch.setattr(launch.os, "startfile", opened.append, raising=False)
    monkeypatch.setattr(launch.subprocess, "Popen", lambda args, **kw: ran.append(args))
    launch.start(Item("Brawlhalla", "steam", "291550"))
    launch.start(Item("Fortnite", "epic", "fn:4fe:Fortnite"))
    launch.start(Item("Spotify", "app", "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"))
    assert opened == ["steam://rungameid/291550", "com.epicgames.launcher://apps/fn%3A4fe%3AFortnite?action=launch&silent=true"]
    assert ran == [["explorer.exe", "shell:AppsFolder\\SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"]]


def test_an_app_not_on_the_path_opens_as_a_game_or_store_app(monkeypatch):
    # "abre brawlhalla" failed: os.startfile only knows programs on the PATH and App Paths
    def startfile(target):
        raise FileNotFoundError(2, "El sistema no puede encontrar el archivo especificado")

    started = []
    monkeypatch.setattr(tools.os, "startfile", startfile, raising=False)
    monkeypatch.setattr(launch, "launchables", lambda: ITEMS)
    monkeypatch.setattr(launch, "start", started.append)
    assert tools.open_app(tools.AppArgs(nombre="Brawlhalla"), settings.Settings()) == "Abrí Brawlhalla."
    assert started == [ITEMS[0]]


GAME = {"searchResults": [{"contentGroupType": "Game", "contents": [{"name": "[💀] Steal a Brainrot", "rootPlaceId": 109983668079237}]}]}


@pytest.mark.parametrize("installed, url", [
    (True, "roblox://experiences/start?placeId=109983668079237"),
    (False, "https://www.roblox.com/games/109983668079237"),
])
def test_roblox_starts_the_game_it_finds(monkeypatch, installed, url):
    opened = []
    monkeypatch.setattr(launch.os, "startfile", opened.append, raising=False)
    monkeypatch.setattr(launch, "roblox_installed", lambda: installed)
    monkeypatch.setattr(launch.httpx, "get", lambda *a, **k: httpx.Response(200, json=GAME, request=httpx.Request("GET", "https://x")))
    assert tools.TOOLS["roblox"].run(tools.RobloxArgs(juego="steal a brainrot"), settings.Settings()).startswith("Abrí Steal a Brainrot")
    assert opened == [url]
    assert not tools.TOOLS["roblox"].effect


def test_roblox_finding_nothing_says_so(monkeypatch):
    monkeypatch.setattr(launch.httpx, "get", lambda *a, **k: httpx.Response(200, json={"searchResults": []}, request=httpx.Request("GET", "https://x")))
    with pytest.raises(tools.ToolError, match="no encontré"):
        tools.TOOLS["roblox"].run(tools.RobloxArgs(juego="zzzz"), settings.Settings())
