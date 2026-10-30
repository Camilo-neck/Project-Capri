import pytest

from app import firstrun
from app.firstrun import Pc, recommend


def pc(**kw) -> Pc:
    return Pc(**{"gpu": "", "vram_mb": 0, "ram_gb": 16, "disco_gb": 100, "ollama": True, "claude_code": False, "qwen": False, **kw})


@pytest.mark.parametrize("p, brain", [
    (pc(gpu="RTX 4070", vram_mb=12282), ("ollama", "gemma3:12b")),
    (pc(gpu="RTX 3060 Ti", vram_mb=8192), ("ollama", "gemma3:4b")),
    (pc(gpu="GTX 1650", vram_mb=4096, claude_code=True), ("claude_code", "sonnet")),
    (pc(), ("gemini", "gemini-2.5-flash")),  # no GPU, no Claude Code: a cloud one with a free tier
    (pc(gpu="RTX 4090", vram_mb=24564, ollama=False, claude_code=True), ("claude_code", "sonnet")),  # no Ollama yet
])
def test_her_brain_is_picked_for_this_pc(p, brain):
    assert recommend(p, voices_ready=["dora"])[:2] == brain


def test_her_cloned_voice_only_with_room_for_it_and_installed():
    big = pc(gpu="RTX 4080", vram_mb=16376)
    assert recommend(big, voices_ready=["dora", "capri"])[2] == "dora"  # its environment isn't installed
    assert recommend(pc(gpu="RTX 4080", vram_mb=16376, qwen=True), voices_ready=["capri", "dora"])[2] == "capri"
    assert recommend(pc(gpu="GTX 1650", vram_mb=4096, qwen=True), voices_ready=["capri", "dora"])[2] == "dora"
    assert recommend(pc(), voices_ready=["capri_ligera", "dora"])[2] == "capri_ligera"  # hers, on the CPU
    assert recommend(pc(), voices_ready=[])[2] == "dora"  # downloaded by the wizard


def test_each_recommendation_says_why():
    assert "12 GB" in recommend(pc(gpu="RTX 4070", vram_mb=12282), [])[3]
    assert "gratis" in recommend(pc(), [])[3].lower()


def test_the_wizard_shows_on_a_fresh_install_only(monkeypatch, tmp_path):
    from app import settings

    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    settings.load()  # a fresh one, from the example
    assert not firstrun.done()
    firstrun.finish()
    assert firstrun.done()
    (tmp_path / "config.toml").write_text("[voz]\nactiva = true\n", encoding="utf-8")  # an older one, his
    assert firstrun.done()
