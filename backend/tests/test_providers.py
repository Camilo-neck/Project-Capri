import asyncio

from app.llm.client import reply
from app.llm.providers import to_anthropic, to_openai

PNG = b"\x89PNG\r\n\x1a\nxxxx"
MSGS = [
    {"role": "system", "content": "persona"},
    {"role": "assistant", "content": "hola"},
    {"role": "user", "content": "¿qué ves?", "images": [PNG]},
    {"role": "system", "content": "Contexto actual: hoy"},
]


def test_claude_gets_the_persona_cached_and_starts_with_the_user():
    system, turns = to_anthropic(MSGS)
    assert system[0] == {"type": "text", "text": "persona", "cache_control": {"type": "ephemeral"}}
    assert system[1]["text"] == "Contexto actual: hoy"
    assert turns[0]["role"] == "user" and turns[1] == {"role": "assistant", "content": "hola"}
    image, text = turns[2]["content"]
    assert image["source"]["media_type"] == "image/png" and text == {"type": "text", "text": "¿qué ves?"}


def test_gpt_gets_images_as_data_urls():
    msg = to_openai(MSGS)[2]
    assert msg["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_a_reply_wrapped_in_a_code_fence_still_parses():
    async def fenced(_):
        for part in ['```json\n{"emocion":"feliz","gesto":"ninguno",', '"accion":null,"texto":"Hola. ¿Algo más?"}', "\n```"]:
            yield part

    async def run():
        return [e async for e in reply([{"role": "user", "content": "hola"}], generate=fenced, slang=False)]

    events = asyncio.run(run())
    shown = "".join(e[1] for e in events if e[0] == "delta")
    assert shown == "Hola. " and events[-1][1].texto.strip() == "Hola."


def test_claude_code_gets_one_message_with_the_conversation_as_a_transcript():
    from app.llm.providers import to_claude_code

    system, msg = to_claude_code([
        {"role": "system", "content": "persona"},
        {"role": "user", "content": "hola"},
        {"role": "assistant", "content": '{"emocion":"feliz","gesto":"ninguno","accion":null,"texto":"¡Hola!"}'},
        {"role": "user", "content": "¿qué ves?", "images": [PNG]},
        {"role": "system", "content": "Contexto actual: hoy"},
    ])
    assert system == "persona\n\nContexto actual: hoy"
    image, text = msg["message"]["content"]
    assert msg["type"] == "user" and image["type"] == "image"
    assert "Usuario: hola\nCapri: ¡Hola!" in text["text"] and text["text"].endswith("respondes ahora:\n¿qué ves?")


def test_claude_code_sees_what_she_did_before():
    # without it, a "[resultado de buscar_web]" looked like something he found himself
    from app.llm.providers import to_claude_code

    _, msg = to_claude_code([
        {"role": "system", "content": "persona"},
        {"role": "user", "content": "busca el clima"},
        {"role": "assistant", "content": '{"emocion":"neutral","gesto":"ninguno","accion":{"nombre":"buscar_web","args":{"consulta":"clima"}},"texto":"Busco."}'},
        {"role": "user", "content": "[resultado de buscar_web para «busca el clima»]\nSoleado"},
    ])
    assert 'Capri (usó buscar_web {"consulta": "clima"}): Busco.' in msg["message"]["content"][0]["text"]


def test_claude_code_runs_without_his_settings_hooks_or_plugins(monkeypatch):
    from app.llm import providers

    got = []

    async def spawn(*args, **kw):
        got.extend(args)
        raise RuntimeError("stop here")

    monkeypatch.setattr(providers.shutil, "which", lambda name: "claude")
    monkeypatch.setattr(providers.asyncio, "create_subprocess_exec", spawn)

    async def run():
        return [p async for p in providers._claude_code([{"role": "user", "content": "hola"}], "haiku", "low", True)]

    try:
        asyncio.run(run())
    except RuntimeError:
        pass
    assert "--safe-mode" in got  # no CLAUDE.md, skills, plugins or hooks of his; the plan's login still works


def test_a_brain_that_fails_says_so_instead_of_freezing(monkeypatch):
    from app import settings
    from app.llm import providers

    monkeypatch.setattr(settings, "load", lambda: settings.Settings(model_provider="claude_code", model_name="sonnet"))

    async def broken(*a):
        raise RuntimeError("rate limit")
        yield ""

    monkeypatch.setattr(providers, "_claude_code", broken)

    async def run():
        return [e async for e in reply([{"role": "user", "content": "hola"}], generate=providers.generate, slang=False)]

    r = asyncio.run(run())[-1][1]
    assert r.emocion == "triste" and "Claude de tu plan" in r.texto and "rate limit" in r.texto


def test_the_local_model_runs_at_a_steady_temperature(monkeypatch):
    # Gemma's own default (1.0) makes the same JSON pass that picks tools too random.
    from app import config
    from app.llm import providers

    got = {}

    async def chat(**kw):
        got.update(kw)

        async def parts():
            return
            yield

        return parts()

    monkeypatch.setattr(providers.ollama, "chat", chat)

    async def run():
        return [p async for p in providers._ollama([], "gemma3:12b", True)]

    asyncio.run(run())
    assert got["options"]["temperature"] == config.TEMPERATURE < 1
