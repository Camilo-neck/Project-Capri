from app import media_now, tools
from app.media_now import Track


def track(**kw) -> Track:
    return Track(**{"title": "PALO DE VERDE", "artist": "Topboy TGR", "album": "", "app": "Spotify", "playing": True,
                    "position": 82.0, "duration": 137.0, **kw})


def test_clean_strips_control_characters_and_clips():
    assert media_now.clean("  a\x00b\n\tc  ", 20) == "a b c"
    assert media_now.clean("x" * 200, 10) == "x" * 9 + "…"


def test_app_names_are_friendly():
    assert media_now.app_name("Spotify.exe") == "Spotify"
    assert media_now.app_name("MSEdge") == "Edge"
    assert media_now.app_name("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic") == "Reproductor multimedia"
    assert media_now.app_name("SomeThing.exe") == "SomeThing"


def test_pick_prefers_what_is_playing_and_skips_untitled():
    paused, playing = track(playing=False), track(title="otra", playing=True)
    assert media_now.pick([paused, playing]) == playing
    assert media_now.pick([paused, track(title="")]) == paused
    assert media_now.pick([track(title="")]) is None
    assert media_now.pick([]) is None


def test_duration_that_makes_no_sense_is_dropped():
    assert media_now.timeline(82.0, 137.0) == (82.0, 137.0)
    assert media_now.timeline(5.0, 0.0) == (0.0, 0.0)  # a live stream has no end
    assert media_now.timeline(500.0, 100.0) == (100.0, 100.0)


def test_tool_tells_the_model_and_keeps_the_track_for_the_card(monkeypatch):
    monkeypatch.setattr(media_now, "now_playing", lambda: track())
    text = tools.what_plays(tools.NoArgs(), None)
    assert "PALO DE VERDE" in text and "Topboy TGR" in text and "Spotify" in text
    assert tools.playing == [track()]
    monkeypatch.setattr(media_now, "now_playing", lambda: None)
    assert "nada" in tools.what_plays(tools.NoArgs(), None).lower()
    assert tools.playing == []
