"""Her brain, from config.toml [modelo]: a local model through Ollama, Claude through Claude Code on the
user's own plan (`claude -p`, no key), or a cloud one with a key: Claude (Anthropic API), GPT (OpenAI), or
Gemini, OpenRouter, Groq, Mistral, DeepSeek and Grok through their OpenAI-compatible addresses. Read on
every call, so switching applies to the next message.

All of them take the same messages (Ollama's shape: system/user/assistant, images as bytes on a user
message) and yield the reply's text in chunks, then the context tokens used. The cloud ones get the
JSON format from the prompt and the reply is validated like any other (client.reply)."""

import asyncio
import base64
import json as jsonlib
import logging
import os
import shutil
import tempfile
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

import keyring
from ollama import AsyncClient

from app import config, settings

log = logging.getLogger(__name__)

@dataclass(frozen=True)
class Compatible:
    """A cloud brain that speaks OpenAI's API at another address."""

    url: str
    keep: tuple[str, ...] = ()  # model ids worth listing start with one of these ("" = all of them)


COMPATIBLE = {
    "gemini": Compatible("https://generativelanguage.googleapis.com/v1beta/openai/", ("gemini",)),
    "openrouter": Compatible("https://openrouter.ai/api/v1"),
    "groq": Compatible("https://api.groq.com/openai/v1"),
    "mistral": Compatible("https://api.mistral.ai/v1"),
    "deepseek": Compatible("https://api.deepseek.com"),
    "xai": Compatible("https://api.x.ai/v1", ("grok",)),
}
PROVIDERS = ("ollama", "claude_code", "anthropic", "openai", *COMPATIBLE)
NAMES = {"ollama": "Ollama", "claude_code": "Claude de tu plan", "anthropic": "Claude API", "openai": "GPT", "gemini": "Gemini",
         "openrouter": "OpenRouter", "groq": "Groq", "mistral": "Mistral", "deepseek": "DeepSeek", "xai": "Grok"}
ENV = {"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY", "openrouter": "OPENROUTER_API_KEY",
       "groq": "GROQ_API_KEY", "mistral": "MISTRAL_API_KEY", "deepseek": "DEEPSEEK_API_KEY", "xai": "XAI_API_KEY"}
# Claude Code's aliases for the latest of each; it runs on the user's Claude plan, no key
PLAN_MODELS = ["sonnet", "haiku", "opus"]
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
    elif s.model_provider == "openai" or s.model_provider in COMPATIBLE:
        gen = _openai(messages, s.model_name, json, s.model_provider)
    elif s.model_provider == "claude_code":
        gen = _claude_code(messages, s.model_name, s.model_effort, json)
    else:
        gen = _ollama(messages, s.model_name, json)
    said = False
    try:
        async for part in gen:
            said = said or isinstance(part, str) and bool(part)
            yield part
    except Exception as e:  # no key, no network, a limit reached, Ollama down: she says so instead of freezing
        log.exception("%s failed", s.model_provider)
        if not json or said:
            raise
        why = f"{type(e).__name__}: {e}"[:160].replace('"', "'").replace("\\", "/").replace("\n", " ")
        yield ('{"emocion":"triste","gesto":"ninguno","accion":null,"texto":"Se me desconectó el cerebro '
               f'({NAMES[s.model_provider]}): {why}"}}')


async def complete(messages: list[dict]) -> str:
    """Plain text, all at once (summaries)."""
    return "".join([p async for p in generate(messages, json=False) if isinstance(p, str)]).strip()


async def _ollama(messages: list[dict], model: str, json: bool) -> AsyncIterator[str | int]:
    from app.llm.client import SCHEMA

    stream = await ollama.chat(model=model, messages=messages, stream=True, format=SCHEMA if json else None, think=False,
                               keep_alive=config.KEEP_ALIVE, options={"num_ctx": config.NUM_CTX, "temperature": config.TEMPERATURE})
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


def _openai_client(provider: str):
    import openai

    return openai.AsyncOpenAI(api_key=key(provider) or None, base_url=COMPATIBLE[provider].url if provider in COMPATIBLE else None)


async def _openai(messages: list[dict], model: str, json: bool, provider: str = "openai") -> AsyncIterator[str | int]:
    import openai

    client = _openai_client(provider)
    ask = {"model": model, "messages": to_openai(messages), "stream": True, "stream_options": {"include_usage": True}}
    try:
        stream = await client.chat.completions.create(**ask, **({"response_format": {"type": "json_object"}} if json else {}))
    except openai.BadRequestError:
        if not json:
            raise
        # not every compatible provider (or model) takes JSON mode: the prompt asks for JSON anyway, and it's validated
        stream = await client.chat.completions.create(**ask)
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
        if chunk.usage:
            yield chunk.usage.total_tokens


def to_claude_code(messages: list[dict]) -> tuple[str, dict]:
    """`claude -p` takes one system prompt and one user message: the persona and the turn's context, then
    the conversation so far as a transcript (her lines by their text) and the message to answer, images first."""
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    turns = [m for m in messages if m["role"] != "system"]
    *before, last = turns or [{"role": "user", "content": ""}]

    def line(m: dict) -> str:
        if m["role"] == "user":
            return f"Usuario: {m['content']}"
        try:
            said = jsonlib.loads(m["content"])
            act = said.get("accion") or {}
            used = f" (usó {act['nombre']} {jsonlib.dumps(act.get('args') or {}, ensure_ascii=False)})" if act.get("nombre") else ""
            return f"Capri{used}: {said['texto']}"
        except (ValueError, KeyError, TypeError, AttributeError):
            return f"Capri: {m['content']}"

    text = last["content"]
    if before:
        text = ("La conversación hasta ahora (ya pasó; no la repitas):\n" + "\n".join(map(line, before))
                + f"\n\nEl mensaje que respondes ahora:\n{text}")
    content = [*({"type": "image", "source": {"type": "base64", "media_type": mime(i), "data": b64(i)}} for i in last.get("images", [])),
               {"type": "text", "text": text}]
    return system, {"type": "user", "message": {"role": "user", "content": content}}


async def _claude_code(messages: list[dict], model: str, effort: str, json: bool) -> AsyncIterator[str | int]:
    """Claude Code headless, on the user's plan: no tools, no MCP, no saved session, and its hooks keep
    quiet (CAPRI_CLAUDE_RUN) so her own Claude-mode ticker doesn't show her thinking."""
    from app.claude_link import RUN_ENV

    exe = shutil.which("claude")
    if not exe:
        raise RuntimeError("no encuentro el comando `claude` (instala Claude Code e inicia sesión)")
    system, message = to_claude_code(messages)
    if json:
        system += "\n\nResponde únicamente con el objeto JSON."
    work = Path(tempfile.mkdtemp(prefix="capri-brain-"))  # an empty folder: no project, no CLAUDE.md of one
    (work / "system.md").write_text(system, encoding="utf-8")
    proc = await asyncio.create_subprocess_exec(
        # --safe-mode: none of his CLAUDE.md, skills, plugins or hooks, whose injected text she once took for
        # the user's message (checked by hand: only Claude Code's own environment block is left). --bare
        # would skip them too but drops the plan's login.
        exe, "-p", "--safe-mode", "--system-prompt-file", str(work / "system.md"), "--tools", "", "--strict-mcp-config",
        "--no-session-persistence", "--input-format", "stream-json", "--output-format", "stream-json",
        "--include-partial-messages", "--verbose", "--model", model, "--effort", effort,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        cwd=work, env={**os.environ, RUN_ENV: "1"}, creationflags=0x0800_0000, limit=2**24)
    try:
        proc.stdin.write((jsonlib.dumps(message) + "\n").encode())
        await proc.stdin.drain()
        proc.stdin.close()
        failure = ""
        async for raw in proc.stdout:
            try:
                ev = jsonlib.loads(raw)
            except ValueError:
                continue
            if ev.get("type") == "stream_event":
                delta = ev["event"].get("delta", {})
                if delta.get("type") == "text_delta":
                    yield delta["text"]
            elif ev.get("type") == "result":
                if ev.get("is_error"):
                    failure = str(ev.get("result") or ev.get("subtype") or "error")
                u = ev.get("usage") or {}
                yield sum(u.get(k) or 0 for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"))
        await proc.wait()
        if failure or proc.returncode:
            err = (await proc.stderr.read()).decode("utf-8", "replace").strip()
            raise RuntimeError(failure or err[:200] or f"claude salió con código {proc.returncode}")
    finally:
        if proc.returncode is None:
            proc.kill()
        shutil.rmtree(work, ignore_errors=True)


# ---- choosing ----

async def options() -> dict[str, list[str]]:
    """The models each provider offers: installed local ones, and the cloud ones the key can use."""
    out: dict[str, list[str]] = {"ollama": [], "claude_code": list(PLAN_MODELS) if shutil.which("claude") else [],
                                 "anthropic": list(CLAUDE_MODELS), "openai": [], **{p: [] for p in COMPATIBLE}}
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
    for p, c in COMPATIBLE.items():
        if not key(p):
            continue
        try:
            ids = [m.id.removeprefix("models/") async for m in _openai_client(p).models.list()]
            out[p] = sorted((i for i in ids if i.startswith(c.keep or ("",)) and not any(n in i for n in NOT_CHAT)), reverse=True)
        except Exception as e:  # a wrong key, no network
            log.warning("%s models: %s", p, e)
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
