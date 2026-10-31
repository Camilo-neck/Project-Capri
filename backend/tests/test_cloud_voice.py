import httpx
import pytest

from app import cloudvoice, settings, speech, voices


class Http:
    """httpx.post answering `status`, remembering what was sent."""

    def __init__(self, monkeypatch, status=200, fails=False):
        self.sent = []

        def post(url, headers=None, json=None, timeout=None):
            self.sent.append((url, headers, json))
            if fails:
                raise httpx.ConnectError("no route")
            return httpx.Response(status, content=b"mp3", request=httpx.Request("POST", url))

        monkeypatch.setattr(cloudvoice.httpx, "post", post)
        monkeypatch.setattr(speech, "_decode_mp3", lambda data: speech.np.zeros(2400, dtype="float32"))


@pytest.fixture(autouse=True)
def keys(monkeypatch, tmp_path):
    saved = {}
    monkeypatch.setenv("CAPRI_CONFIG", str(tmp_path / "config.toml"))
    for env in ("FISH_API_KEY", "ELEVENLABS_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(env, raising=False)
    monkeypatch.setattr(cloudvoice.keyring, "get_password", lambda _, name: saved.get(name))
    monkeypatch.setattr(cloudvoice.keyring, "set_password", lambda _, name, value: saved.__setitem__(name, value))
    return saved


def test_fish_takes_a_link_and_uses_its_free_model(monkeypatch, keys):
    http = Http(monkeypatch)
    cloudvoice.save("fish", "clave-secreta", "https://fish.audio/m/0123456789abcdef0123456789abcdef/", "")
    audio, rate = cloudvoice.synth("fish")("hola", "es")
    url, headers, body = http.sent[0]
    assert url == "https://api.fish.audio/v1/tts" and rate == 24000 and len(audio)
    assert headers["model"] == "s2.1-pro-free" and headers["Authorization"] == "Bearer clave-secreta"
    assert body["text"] == "hola" and body["reference_id"] == "0123456789abcdef0123456789abcdef" and body["format"] == "mp3"


def test_elevenlabs_and_openai_requests(monkeypatch):
    http = Http(monkeypatch)
    cloudvoice.save("elevenlabs", "k1", "abc/../d", "")
    cloudvoice.synth("elevenlabs")("hola", "es")
    url, headers, body = http.sent[0]
    assert url.startswith("https://api.elevenlabs.io/v1/text-to-speech/abc%2F") and headers["xi-api-key"] == "k1"
    assert body == {"text": "hola", "model_id": "eleven_flash_v2_5"}
    cloudvoice.save("openai", "k2", "", "")
    cloudvoice.synth("openai")("hola", "es")
    url, headers, body = http.sent[1]
    assert url == "https://api.openai.com/v1/audio/speech" and headers["Authorization"] == "Bearer k2"
    assert body == {"model": "gpt-4o-mini-tts", "voice": "marin", "input": "hola", "response_format": "mp3"}


def test_a_key_stays_out_of_the_config_and_of_what_the_panel_gets(monkeypatch):
    Http(monkeypatch)
    cloudvoice.save("fish", "clave-secreta", "voz", "")
    assert "clave-secreta" not in settings.path().read_text(encoding="utf-8")
    info = {c.id: c for c in cloudvoice.info()}
    assert info["fish"].clave is True and info["elevenlabs"].clave is False
    assert "clave-secreta" not in repr(info)
    cloudvoice.save("fish", "", "otra", "s2-pro")  # no new key: the old one stays
    assert cloudvoice.key("fish") == "clave-secreta" and cloudvoice.info()[0].modelo == "s2-pro"


@pytest.mark.parametrize(("status", "word"), [(401, "clave"), (402, "saldo"), (404, "voz"), (429, "ocupado"), (500, "500")])
def test_a_refusal_says_what_to_do(monkeypatch, status, word):
    Http(monkeypatch, status)
    cloudvoice.save("fish", "k", "v", "")
    with pytest.raises(cloudvoice.CloudVoiceError, match=word):
        cloudvoice.synth("fish")("hola", "es")


def test_no_network_says_so_without_the_key(monkeypatch):
    Http(monkeypatch, fails=True)
    cloudvoice.save("fish", "clave-secreta", "v", "")
    with pytest.raises(cloudvoice.CloudVoiceError) as e:
        cloudvoice.synth("fish")("hola", "es")
    assert "internet" in str(e.value) and "clave-secreta" not in str(e.value)


def test_they_need_a_key_and_the_voice_their_service_asks_for(monkeypatch, tmp_path):
    Http(monkeypatch)
    opts = {o.id: o for o in voices.options(str(tmp_path), None)}
    assert all(opts[s].nube and not opts[s].descargada and not opts[s].descargable and "clave" in opts[s].nota for s in cloudvoice.SERVICES)
    cloudvoice.save("elevenlabs", "k", "", "")
    assert not {o.id: o for o in voices.options(str(tmp_path), None)}["elevenlabs"].descargada  # it has no default voice
    cloudvoice.save("elevenlabs", "k", "id", "")
    assert {o.id: o for o in voices.options(str(tmp_path), None)}["elevenlabs"].descargada


def test_without_the_service_she_falls_back_to_dora(monkeypatch, tmp_path):
    Http(monkeypatch, 500)
    cloudvoice.save("fish", "k", "v", "")
    dora = []
    monkeypatch.setattr(voices.speech, "kokoro", lambda folder, styles: lambda t, l, s=1.0: dora.append(t) or (speech.np.zeros(1), 24000))
    voices.make("fish", str(tmp_path))("hola", "es")
    assert dora == ["hola"]
