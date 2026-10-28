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


# ---- folders and the desktop ----

@pytest.mark.parametrize("said, target", [
    ("descargas", "shell:Downloads"), ("mis descargas", "shell:Downloads"), ("Downloads", "shell:Downloads"),
    ("la papelera", "shell:RecycleBinFolder"), ("recycle bin", "shell:RecycleBinFolder"),
    ("el explorador de archivos", "shell:MyComputerFolder"), ("mis documentos", "shell:Personal"),
    ("imágenes", "shell:My Pictures"), ("capturas de pantalla", "shell:Screenshots"), ("escritorio", "shell:Desktop"),
])
def test_known_folders_open_in_the_explorer(monkeypatch, said, target):
    ran = []
    monkeypatch.setattr(tools.subprocess, "Popen", lambda args, **kw: ran.append(args))
    tools.open_folder(tools.FolderArgs(nombre=said), settings.Settings())
    assert ran == [["explorer.exe", target]]


def test_a_file_or_shortcut_on_the_desktop_by_its_name(monkeypatch, tmp_path):
    (tmp_path / "CV Camilo 2026.pdf").write_text("")
    (tmp_path / "instalar.exe").write_text("")
    monkeypatch.setattr(tools, "desktops", lambda: [tmp_path])
    opened = []
    monkeypatch.setattr(tools.os, "startfile", opened.append, raising=False)
    tools.open_folder(tools.FolderArgs(nombre="mi cv"), settings.Settings())
    assert opened == [str(tmp_path / "CV Camilo 2026.pdf")]
    assert tools.folder_risk(tools.FolderArgs(nombre="mi cv"), settings.Settings()) == "normal"
    assert tools.folder_risk(tools.FolderArgs(nombre="instalar"), settings.Settings()) == "alto"  # runs a program: always a click
    with pytest.raises(tools.ToolError, match="no encontré"):
        tools.folder_target("algo que no existe")


# ---- a screenshot to Pictures ----

def test_a_screenshot_is_saved_without_her(monkeypatch, tmp_path):
    from app import vision

    monkeypatch.setattr(vision, "cursor_monitor", lambda: (0, 0, 800, 600))
    saved = []
    monkeypatch.setattr(vision, "save_shot", lambda rect, folder: saved.append((rect, folder)) or folder / "Capri 2026-10-28 153000.png")
    monkeypatch.setattr(tools, "screenshots_folder", lambda: tmp_path)
    msg = tools.TOOLS["captura"].run(tools.NoArgs(), settings.Settings())
    assert saved == [((0, 0, 800, 600), tmp_path)] and "Capri 2026-10-28 153000.png" in msg
    assert tools.named_in(tools.TOOLS["captura"].named(tools.NoArgs()), "toma un pantallazo")
    assert tools.named_in(tools.TOOLS["captura"].named(tools.NoArgs()), "take a screenshot")


# ---- finding his files ----

def test_kinds_of_file_said_in_words():
    assert "mp4" in tools.extensions("video") and "aep" in tools.extensions("proyecto de after effects")
    assert tools.extensions("pdf") == ["pdf"] and tools.extensions("") == []


def test_the_index_query_asks_his_folder_by_name_kind_and_contents():
    home = r"C:\Users\c"
    by_name, by_text = tools.index_queries(["factura", "marzo"], ["pdf"], home)
    assert f"SCOPE='file:{home}'" in by_name and "System.FileName LIKE '%factura%'" in by_name
    assert "System.FileExtension = '.pdf'" in by_name and "node_modules" in by_name and "ORDER BY System.DateModified DESC" in by_name
    assert by_text is None  # a kind asked: names only
    assert """CONTAINS(*, '"factura" AND "marzo"')""" in tools.index_queries(["factura", "marzo"], [], home)[1]
    assert tools.index_queries(["o'brien"], [], home)[0].count("'") % 2 == 0  # nothing can close its quotes


def test_the_index_answers_first_and_junk_never_shows(monkeypatch, tmp_path):
    from app import power

    monkeypatch.setattr(power, "HOME", tmp_path.resolve())
    keep, junk = tmp_path / "Factura marzo.pdf", tmp_path / "node_modules" / "factura.js"
    keep.write_text("x")
    monkeypatch.setattr(tools, "indexed", lambda terms, exts: [str(junk), str(keep)])
    out = tools.search_files(tools.SearchArgs(texto="factura"), settings.Settings())
    assert "Factura marzo.pdf" in out and "node_modules" not in out and tools.found == [keep]


def test_without_the_index_it_walks_his_folder_by_name_and_kind(monkeypatch, tmp_path):
    from app import power

    (tmp_path / "Videos").mkdir()
    (tmp_path / "Videos" / "viaje.mp4").write_text("x")
    (tmp_path / "Videos" / "viaje.txt").write_text("x")
    monkeypatch.setattr(power, "HOME", tmp_path.resolve())
    out = tools.search_files(tools.SearchArgs(texto="", tipo="video"), settings.Settings())
    assert "viaje.mp4" in out and "viaje.txt" not in out


# ---- closing an app ----

ROWS = [{"id": 11, "name": "Discord", "label": "Discord"}, {"id": 12, "name": "Discord", "label": "Discord"},
        {"id": 20, "name": "AMMusic", "label": "AM Music"}, {"id": 30, "name": "explorer", "label": "Windows Explorer"},
        {"id": 31, "name": "claude", "label": "Claude"}, {"id": 32, "name": "ollama app", "label": "Ollama"},
        {"id": 33, "name": "avatar", "label": "Capri"}]


def test_open_apps_by_name_never_windows_pieces_claude_ollama_or_her(monkeypatch):
    monkeypatch.setattr(launch, "window_processes", lambda: ROWS)
    names = {i.id for i in launch.open_apps()}
    assert names == {"Discord", "AMMusic"}
    assert launch.match(launch.open_apps(), "cierra discord").id == "Discord"
    assert launch.match(launch.open_apps(), "cierra am music").id == "AMMusic"
    assert launch.match(launch.open_apps(), "cierra el explorador") is None


def test_closing_always_asks_and_offers_force_if_it_stays(monkeypatch):
    from fastapi.testclient import TestClient

    from app.orchestrator import Orchestrator
    from app.ws import create_app
    from tests.test_tools import ORIGIN, TOKEN, say, scripted, until, until_idle

    monkeypatch.setattr(launch, "window_processes", lambda: ROWS)
    closed, forced = [], []
    monkeypatch.setattr(launch, "close", lambda item: closed.append(item.id) or False)  # it hid in the tray
    monkeypatch.setattr(launch, "force", lambda item: forced.append(item.id))
    generate, calls = scripted(say("La cierro.", {"nombre": "cerrar_app", "args": {"nombre": "Discord"}}), say("Se quedó en la bandeja."))
    with TestClient(create_app(TOKEN, Orchestrator(generate), reminders=False)).websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN) as ws:
        ws.send_json({"type": "text_input", "text": "cierra Discord"})  # named, and still a click: it can lose work
        ask = until(ws, "confirm_request")[-1]
        assert ask["texto"].startswith("Cerrar Discord")
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})
        buttons = until(ws, "buttons")[-1]
        assert [b["texto"] for b in buttons["botones"]] == ["Forzar cierre de Discord (se pierde lo no guardado)"]
        ws.send_json({"type": "pressed", "id": buttons["id"], "boton": buttons["botones"][0]["id"]})
        until_idle(ws)
    assert closed == ["Discord"] and forced == ["Discord"]
