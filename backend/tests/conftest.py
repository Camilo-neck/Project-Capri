import pytest


@pytest.fixture(autouse=True)
def isolated_config(tmp_path, monkeypatch):
    """Tests never read or write the user's real %APPDATA%\\Capri (config and audit log)."""
    path = tmp_path / "capri" / "config.toml"
    monkeypatch.setenv("CAPRI_CONFIG", str(path))
    return path


@pytest.fixture(autouse=True)
def no_real_apps(monkeypatch):
    """Tests never list (or start) the PC's real Start menu apps and games; a test that needs some sets them."""
    from app import launch

    monkeypatch.setattr(launch, "launchables", lambda: [])
