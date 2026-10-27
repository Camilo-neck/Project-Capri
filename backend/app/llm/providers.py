"""Her brain, from config.toml [modelo]: a local model through Ollama, or Claude (Anthropic) or GPT
(OpenAI) in the cloud. Read on every call, so switching applies to the next message.

All three take the same messages (Ollama's shape: system/user/assistant, images as bytes on a user
message) and yield the reply's text in chunks, then the context tokens used. The cloud ones get the
JSON format from the prompt and the reply is validated like any other (client.reply)."""

import base64
import logging
import os
from collections.abc import AsyncIterator

import keyring
from ollama import AsyncClient

from app import config, settings

log = logging.getLogger(__name__)

PROVIDERS = ("ollama", "anthropic", "openai")
ENV = {"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY"}
# offered before a key lets her ask the provider for its list
CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]
# the server re-runs a declined request on another model (Claude API only)
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"}
# local models worth downloading: vision (for /mira) and good Spanish, within the VRAM budget
SUGGESTED = ["gemma3:12b", "qwen3-vl:8b-instruct", "gemma3:4b"]
NOT_CHAT = ("audio", "realtime", "tts", "transcribe", "embedding", "image", "search", "moderation", "dall-e", "whisper", "codex")

ollama = AsyncClient(host=config.OLLAMA_HOST)


# ---- keys: Windows Credential Manager (or the usual environment variable) ----

def key(provider: str) -> str:
    return os.environ.get(ENV.get(provider, ""), "") or keyring.get_password("capri", provider) or ""


def set_key(provider: str, value: str) -> None:
    if provider not in ENV:
        raise ValueError(provider)
    if value:
        keyring.set_password("capri", provider, value.strip())
    else:
        try:
            keyring.delete_password("capri", provider)
        except keyring.errors.PasswordDeleteError:
            pass


# ---- message shapes ----

def mime(image: bytes) -> str:
    return "image/png" if image[:4] == b"\x89PNG" else "image/jpeg"


def b64(image: bytes) -> str:
    return base64.standard_b64encode(image).decode()


def to_anthropic(messages: list[dict]) -> tuple[list[dict], list[dict]]:
    """System blocks (the persona cached, then the turn's context) and the turns, images as content blocks."""
    system = [m["content"] for m in messages if m["role"] == "system"]
    blocks = [{"type": "text", "text": system[0], "cache_control": {"type": "ephemeral"}}] if system else []
    blocks += [{"type": "text", "text": s} for s in system[1:]]
    turns = []
    for m in messages:
        if m["role"] == "system":
            continue
        content = m["content"]
        if m.get("images"):
            content = [*({"type": "image", "source": {"type": "base64", "media_type": mime(i), "data": b64(i)}} for i in m["images"]),
                       {"type": "text", "text": content}]
        turns.append({"role": m["role"], "content": content})
    if not turns or turns[0]["role"] != "user":
        turns.insert(0, {"role": "user", "content": "(empieza la conversación)"})
    return blocks, turns


def to_openai(messages: list[dict]) -> list[dict]:
    out = []
    for m in messages:
        content = m["content"]
        if m.get("images"):
            content = [{"type": "text", "text": content},
                       *({"type": "image_url", "image_url": {"url": f"data:{mime(i)};base64,{b64(i)}"}} for i in m["images"])]
        out.append({"role": m["role"], "content": content})
    return out


# ---- generation ----

async def generate(messages: list[dict], json: bool = True) -> AsyncIterator[str | int]:
    """The reply in chunks, then the tokens used. `json`: Capri's reply format (else plain text)."""
    s = settings.load()
    if s.model_provider == "anthropic":
        gen = _anthropic(messages, s.model_name, s.model_effort)
    elif s.model_provider == "openai":
        gen = _openai(messages, s.model_name, json)
    else:
        gen = _ollama(messages, s.model_name, json)
    async for part in gen:
        yield part


async def complete(messages: list[dict]) -> str:
    """Plain text, all at once (summaries)."""
    return "".join([p async for p in generate(messages, json=False) if isinstance(p, str)]).strip()


async def _ollama(messages: list[dict], model: str, json: bool) -> AsyncIterator[str | int]:
    from app.llm.client import SCHEMA

    stream = await ollama.chat(model=model, messages=messages, stream=True, format=SCHEMA if json else None, think=False,
                               keep_alive=config.KEEP_ALIVE, options={"num_ctx": config.NUM_CTX})
    async for part in stream:
        yield part.message.content or ""
        if part.done:
            yield (part.prompt_eval_count or 0) + (part.eval_count or 0)


async def _anthropic(messages: list[dict], model: str, effort: str) -> AsyncIterator[str | int]:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=key("anthropic") or None)
    system, turns = to_anthropic(messages)
    extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"} if model in FALLBACK_MODELS else {}
    async with client.beta.messages.stream(model=model, max_tokens=16000, system=system, messages=turns,
                                           output_config={"effort": effort}, **extra) as stream:
        async for text in stream.text_stream:
            yield text
        final = await stream.get_final_message()
    if final.stop_reason == "refusal":
        log.warning("claude declined the request")
    u = final.usage
    yield u.input_tokens + (u.cache_read_input_tokens or 0) + (u.cache_creation_input_tokens or 0) + u.output_tokens


async def _openai(messages: list[dict], model: str, json: bool) -> AsyncIterator[str | int]:
    import openai

    client = openai.AsyncOpenAI(api_key=key("openai") or None)
    stream = await client.chat.completions.create(model=model, messages=to_openai(messages), stream=True,
                                                  stream_options={"include_usage": True},
                                                  **({"response_format": {"type": "json_object"}} if json else {}))
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
        if chunk.usage:
            yield chunk.usage.total_tokens


# ---- choosing ----

async def options() -> dict[str, list[str]]:
    """The models each provider offers: installed local ones, and the cloud ones the key can use."""
    out: dict[str, list[str]] = {"ollama": [], "anthropic": list(CLAUDE_MODELS), "openai": []}
    try:
        out["ollama"] = sorted(m.model for m in (await ollama.list()).models)
    except Exception as e:  # Ollama not running
        log.warning("ollama list: %s", e)
    if key("anthropic"):
        try:
            import anthropic

            ids = [m.id async for m in anthropic.AsyncAnthropic(api_key=key("anthropic")).models.list(limit=100)]
            out["anthropic"] = list(dict.fromkeys(CLAUDE_MODELS + ids))
        except Exception as e:
            log.warning("anthropic models: %s", e)
    if key("openai"):
        try:
            import openai

            ids = [m.id async for m in openai.AsyncOpenAI(api_key=key("openai")).models.list()]
            out["openai"] = sorted((i for i in ids if i.startswith(("gpt", "o")) and not any(n in i for n in NOT_CHAT)), reverse=True)
        except Exception as e:
            log.warning("openai models: %s", e)
    return out


async def choose(provider: str, model: str) -> None:
    """Saves the choice; a local model that stops being used leaves the GPU."""
    if provider not in PROVIDERS or not model:
        raise ValueError("proveedor o modelo no válido")
    before = settings.load()
    settings.set_value("modelo", "proveedor", provider)
    settings.set_value("modelo", "nombre", model)
    if before.model_provider == "ollama" and (provider, model) != ("ollama", before.model_name):
        try:
            await ollama.generate(model=before.model_name, prompt="", keep_alive=0)
        except Exception as e:
            log.warning("could not unload %s: %s", before.model_name, e)


async def pull(model: str) -> AsyncIterator[tuple[str, int, int]]:
    """Downloads a local model: (status, completed bytes, total bytes)."""
    async for p in await ollama.pull(model, stream=True):
        yield p.status or "", p.completed or 0, p.total or 0
