from pathlib import Path

import pytest

from app import settings, voices


def touch(root: Path, *names: str) -> None:
    for n in names:
        p = root / n
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")


KOKORO = ("kokoro-v1.0.onnx", "voices-v1.0.bin")
QWEN = ("qwen/env/Scripts/python.exe", "qwen/Qwen3-TTS-12Hz-0.6B-Base/config.json", "qwen/capri.wav", "qwen/capri.txt")


def by_id(opts):
    return {o.id: o for o in opts}


def test_the_catalog():
    ids = [v.id for v in voices.CATALOG]
    assert ids[:6] == ["aria", "capri", "capri_ligera", "dora", "daniela", "claude_mx"]  # Aria first, then her clone, then the rest
    assert {"bella", "emma"} <= set(ids) and len(ids) == len(set(ids))
    assert voices.get("nada") is voices.get(voices.DEFAULT)
    assert all(v.motor in ("qwen", "kokoro", "piper", "edge", "nube") for v in voices.CATALOG)


def test_what_is_downloaded_and_what_can_be(tmp_path):
    touch(tmp_path, *KOKORO, "es_AR-daniela-high.onnx", "es_AR-daniela-high.onnx.json")
    o = by_id(voices.options(str(tmp_path), gpu=None))
    assert o["dora"].descargada and o["bella"].descargada
    assert not o["daniela"].descargada and o["daniela"].descargable  # amy is missing
    assert not o["capri_ligera"].descargada and not o["capri_ligera"].descargable  # her tuned style is made, not downloaded
    assert o["daniela"].mb > 0 and o["dora"].mb == 0  # what's left to download


def test_her_cloned_voice_needs_an_nvidia_gpu(tmp_path):
    touch(tmp_path, *QWEN)
    assert not by_id(voices.options(str(tmp_path), gpu=None))["capri"].disponible
    assert "NVIDIA" in by_id(voices.options(str(tmp_path), gpu=None))["capri"].motivo
    small = by_id(voices.options(str(tmp_path), gpu=(3000, 4096)))["capri"]
    assert not small.disponible and "4 GB" in small.motivo
    ok = by_id(voices.options(str(tmp_path), gpu=(9000, 16311)))["capri"]
    assert ok.disponible and ok.descargada
    assert by_id(voices.options(str(tmp_path), gpu=None))["dora"].disponible  # the CPU ones always are


def test_nvidia_smi_parsed():
    assert voices.parse_gpu("15742, 16311\n") == (15742, 16311)
    assert voices.parse_gpu("") is None
    assert voices.parse_gpu("garbage") is None


def test_each_voice_builds_its_engine(monkeypatch, tmp_path):
    made = []
    monkeypatch.setattr(voices.speech, "kokoro", lambda folder, styles: made.append(("kokoro", styles)) or (lambda *a: None))
    monkeypatch.setattr(voices.speech, "piper", lambda folder, models: made.append(("piper", models)) or (lambda *a: None))
    monkeypatch.setattr(voices.speech, "qwen", lambda folder, ref: made.append(("qwen", ref)) or (lambda *a: None))
    voices.make("daniela", str(tmp_path))
    voices.make("capri_ligera", str(tmp_path))
    voices.make("capri", str(tmp_path))
    assert made[0] == ("piper", {"es": "es_AR-daniela-high", "en": "en_US-amy-medium"})
    assert made[1] == ("kokoro", {"es": "capri", "en": "capri"})
    assert made[2:] == [("qwen", "capri"), ("kokoro", {"es": "ef_dora", "en": "af_heart"})]  # Dora if her clone fails


def test_a_voice_downloads_with_progress_and_no_half_files(monkeypatch, tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    for name in ("es_MX-claude-high.onnx", "es_MX-claude-high.onnx.json", "en_US-amy-medium.onnx", "en_US-amy-medium.onnx.json"):
        (src / name).write_bytes(b"y" * 5000)
    monkeypatch.setattr(voices, "url_for", lambda name: (src / name).as_uri())
    dest = tmp_path / "tts"
    seen = []
    voices.download("claude_mx", str(dest), lambda done, total: seen.append((done, total)))
    assert by_id(voices.options(str(dest), gpu=None))["claude_mx"].descargada
    assert seen[-1][0] == seen[-1][1] > 0
    assert not list(dest.glob("*.part"))


def test_an_unreachable_file_leaves_nothing_behind(monkeypatch, tmp_path):
    monkeypatch.setattr(voices, "url_for", lambda name: (tmp_path / "nope" / name).as_uri())
    with pytest.raises(OSError):
        voices.download("daniela", str(tmp_path / "tts"), lambda d, t: None)
    assert not list((tmp_path / "tts").glob("*"))


@pytest.mark.parametrize("voz, expected", [
    ("", "aria"),
    ('motor = "kokoro"\nvoz_tts = "capri"', "capri_ligera"),
    ('motor = "kokoro"\nvoz_tts = ""', "dora"),
    ('motor = "qwen"', "capri"),
    ('voz = "daniela"', "daniela"),
    ('voz = "inventada"', "aria"),
])
def test_her_voice_from_config_old_and_new(monkeypatch, tmp_path, voz, expected):
    (tmp_path / "config.toml").write_text(f"[voz]\n{voz}\n", encoding="utf-8")
    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    assert settings.load().tts_voice == expected


def test_her_models_default_to_this_users_local_app_data(monkeypatch, tmp_path):
    (tmp_path / "config.toml").write_text("[voz]\n", encoding="utf-8")
    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    s = settings.load()
    assert s.tts_dir == str(tmp_path / "local" / "Capri" / "modelos" / "tts")
    assert s.voice_dir == str(tmp_path / "local" / "Capri" / "modelos" / "whisper")
    (tmp_path / "config.toml").write_text('[voz]\ncarpeta_tts = "E:/voces"\n', encoding="utf-8")
    assert settings.load().tts_dir == "E:/voces"  # his own stays


def test_a_fresh_config_carries_nothing_of_this_pc():
    text = settings.EXAMPLE.read_text(encoding="utf-8")
    assert "D:\\" not in text and "capri-models" not in text and "carco" not in text.lower()


def test_an_older_install_keeps_its_voices_where_they_were(monkeypatch, tmp_path):
    # her voices used to default to D:\capri-models\tts: a config that never set the folder keeps finding them there
    old = tmp_path / "old-tts"
    old.mkdir()
    monkeypatch.setattr(settings, "LEGACY_TTS", old)
    (tmp_path / "config.toml").write_text("[voz]\n", encoding="utf-8")
    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    assert settings.load().tts_dir == str(old)
    old.rmdir()
    assert settings.load().tts_dir.endswith("tts") and "old-tts" not in settings.load().tts_dir


def test_the_edge_voices_are_cloud_ones_that_need_nothing_on_disk(tmp_path):
    ids = {v.id: v for v in voices.CATALOG}
    assert ids["aria"].en == "en-US-AriaNeural" and ids["jenny"].en == "en-US-JennyNeural" and ids["aria"].motor == "edge"
    o = by_id(voices.options(str(tmp_path), gpu=None))
    for vid in ("aria", "jenny"):
        assert o[vid].nube and o[vid].descargada and o[vid].disponible and o[vid].mb == 0
        assert "Microsoft" in o[vid].nota  # what she says goes to them: it says so
    assert not o["dora"].nube


def test_an_edge_voice_falls_back_to_dora_without_internet(monkeypatch, tmp_path):
    made = []
    monkeypatch.setattr(voices.speech, "edge", lambda v, pitch=0: made.append(("edge", v, pitch)) or (lambda *a: 1 / 0))
    monkeypatch.setattr(voices.speech, "kokoro", lambda folder, styles: made.append(("kokoro", styles)) or (lambda *a: (None, 24000)))
    synth = voices.make("aria", str(tmp_path))
    assert synth("hola", "es", 1.0) == (None, 24000)  # edge failed: Dora said it
    assert made[0] == ("edge", {"es": "es-MX-DaliaNeural", "en": "en-US-AriaNeural"}, 12)  # pitched up toward hers
