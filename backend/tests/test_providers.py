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
