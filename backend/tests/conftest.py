import pytest


@pytest.fixture(autouse=True)
def isolated_config(tmp_path, monkeypatch):
    """Tests never read or write the user's real %APPDATA%\\Capri (config and audit log)."""
    path = tmp_path / "capri" / "config.toml"
    monkeypatch.setenv("CAPRI_CONFIG", str(path))
    from app import settings

    monkeypatch.setattr(settings, "LEGACY_TTS", tmp_path / "no-legacy-tts")  # nor this PC's old voices folder
    return path


@pytest.fixture(autouse=True)
def no_real_apps(monkeypatch):
    """Tests never list (or start) the PC's real Start menu apps and games; a test that needs some sets them."""
    from app import launch, tools

    monkeypatch.setattr(launch, "launchables", lambda: [])
    monkeypatch.setattr(launch, "window_processes", lambda: [])  # nor the windows open on it (closing one)
    monkeypatch.setattr(tools, "indexed", lambda terms, exts: None)  # nor Windows' search index: they walk
