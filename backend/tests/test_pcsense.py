from dataclasses import replace

from app.pcsense import Reading, Senses, device_kind, game_of, verdict

CALM = Reading(t=0, cpu=10, plugged=True, battery=90, online=True, drives={}, devices={}, game=None)


def run(readings):
    s, out = Senses(), []
    for r in readings:
        out += s.feel(r)
    return out


def test_the_first_reading_is_only_what_things_are_like():
    assert run([replace(CALM, plugged=False, online=False, drives={"E:": "USB"}, devices={"Galaxy S24": "WPD"})]) == []


def test_the_processor_maxed_out_for_a_while_then_not_again_soon():
    hot = [replace(CALM, t=t, cpu=95) for t in range(0, 40, 3)]
    assert run(hot) == [("caliente", "")]
    assert run([replace(CALM, t=0, cpu=95), replace(CALM, t=6, cpu=95), replace(CALM, t=9, cpu=20), replace(CALM, t=30, cpu=95)]) == []
    again = hot + [replace(CALM, t=t, cpu=95) for t in range(60, 120, 3)]
    assert run(again) == [("caliente", "")]  # within half an hour: once


def test_the_charger_and_a_low_battery():
    out = run([CALM, replace(CALM, t=5, plugged=False), replace(CALM, t=10, plugged=False, battery=19),
               replace(CALM, t=20, plugged=False, battery=18), replace(CALM, t=30, plugged=False, battery=9)])
    assert out == [("cargador", "off"), ("bateria", "20"), ("bateria", "10")]
    assert run([CALM, replace(CALM, t=5, plugged=False), replace(CALM, t=10, plugged=True)]) == [("cargador", "off")]  # not twice a minute


def test_the_network_going_and_coming_back():
    assert run([CALM, replace(CALM, t=5, online=False), replace(CALM, t=60, online=True)]) == [("red", "caida"), ("red", "vuelve")]


def test_a_usb_stick_and_devices_plugged_in():
    out = run([CALM, replace(CALM, t=5, drives={"E:": "KINGSTON"}, devices={"Galaxy S24": "WPD", "Logitech Mouse": "Mouse"}),
               replace(CALM, t=30, drives={"E:": "KINGSTON"}, devices=None),  # devices not read this time: nothing went
               replace(CALM, t=60, drives={"E:": "KINGSTON"}, devices={"Galaxy S24": "WPD", "Xbox Wireless Controller": "HIDClass"})])
    assert out == [("usb", "E:"), ("dispositivo", "phone:Galaxy S24"), ("dispositivo", "controller:Xbox Wireless Controller")]


def test_device_kinds_by_name_and_class():
    assert device_kind("Xbox Wireless Controller", "HIDClass") == "controller"
    assert device_kind("iPhone de Cami", "WPD") == "phone"
    assert device_kind("Auriculares (WH-1000XM4)", "AudioEndpoint") == "audio"
    assert device_kind("USB Keyboard", "Keyboard") == "input"


def test_a_game_in_front_for_a_while_and_then_gone():
    playing = [replace(CALM, t=t, game="Cyberpunk 2077") for t in range(0, 10, 2)]
    after = [replace(CALM, t=t) for t in range(10, 22, 2)]
    assert run(playing + after) == [("juego", "inicio:Cyberpunk 2077"), ("juego", "fin:Cyberpunk 2077")]
    assert run([replace(CALM, t=0, game="X"), replace(CALM, t=2)]) == []  # a glance isn't playing


def test_which_programs_are_games():
    assert game_of(r"D:\SteamLibrary\steamapps\common\Cyberpunk 2077\bin\x64\Cyberpunk2077.exe", {"cyberpunk 2077": "Cyberpunk 2077"}) == "Cyberpunk 2077"
    assert game_of(r"C:\Program Files\Epic Games\Fortnite\FortniteClient.exe", {}) == "Fortnite"
    assert game_of(r"C:\Riot Games\VALORANT\live\VALORANT.exe", {}) == "VALORANT"
    assert game_of(r"C:\Program Files\Google\Chrome\chrome.exe", {}) is None


def test_her_verdict_on_a_usb_stick(tmp_path):
    for name in ["a.jpg", "b.png", "c.mp4", "notas.docx"]:
        (tmp_path / name).write_text("x")
    (tmp_path / "fotos").mkdir()
    (tmp_path / "fotos" / "d.jpg").write_text("x")
    assert verdict(tmp_path, "KINGSTON") == "Tu USB «KINGSTON» tiene 3 fotos, 1 video y 1 documento."
    (tmp_path / "vacia").mkdir()
    assert verdict(tmp_path / "vacia", "") == "Tu USB está vacía."
