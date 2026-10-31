"""Does she pick the right tool? Sends the requests of tool_cases.json and scores the first action she asks for.
Needs GPU + Ollama (close Capri first: they share the one resident model).

Run: uv run --project backend python scripts/eval_tools.py [--runs 3] [--save results.json]
Each request is a fresh conversation, run --runs times (the model varies). Scores: the right tool (or none at all),
the right argument (a word that has to be in them), for the questions that need today's data, whether she searched,
and, where a case sets min_chars or max_chars, whether she said what was asked (not just announced it).
"""

import argparse
import asyncio
import json
import os
import re
import statistics
import sys
import tempfile
import time
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.llm.client import SYSTEM_PROMPT, reply  # noqa: E402

CASES = Path(__file__).with_name("tool_cases.json")
NUMBERED = re.compile(r"(^|\s)[12][.)]\s")  # "1. ..." at the start of a line or in the middle of one


def load_cases() -> list[dict]:
    return json.loads(CASES.read_text(encoding="utf-8"))


def plain(text: str) -> str:
    """Lowercase without accents: «dólar» and «dolar» are the same word here."""
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")


def score(case: dict, accion) -> tuple[bool, bool]:
    """(right tool, right argument) for the first action she asked for (None = no action)."""
    if case["tool"] is None:
        return accion is None, accion is None
    if accion is None or accion.nombre not in case["tool"]:
        return False, False
    args = plain(json.dumps(accion.args, ensure_ascii=False))
    return True, case["arg"] is None or plain(case["arg"]) in args


def delivered(case: dict, texto: str) -> bool | None:
    """She said as much as the request needs: announcing «10 datos» without giving them is a miss. None: not measured."""
    if "min_chars" not in case and "max_chars" not in case:
        return None
    return case.get("min_chars", 0) <= len(texto) <= case.get("max_chars", len(texto))


def summary(rows: list[dict]) -> dict:
    def rate(rs: list[dict], key: str) -> float:
        return sum(r[key] for r in rs) / len(rs) if rs else 0.0

    acting = [r for r in rows if r["case"]["tool"] is not None]
    measured = [r for r in rows if r.get("delivered") is not None]
    silent = [r for r in rows if r["case"]["tool"] is None]
    web = [r for r in rows if r["case"].get("needs_web")]
    right_tool = [r for r in acting if r["tool_ok"]]
    return {
        "tool_ok": rate(rows, "tool_ok"),
        "arg_ok": rate(right_tool, "arg_ok"),
        "needs_web_searched": rate(web, "tool_ok"),
        "false_actions": 1 - rate(silent, "tool_ok"),  # asked for a tool when none was needed
        "delivered": rate(measured, "delivered"),
        "numbered": rate(measured, "numbered"),  # the prompt says no lists: "1. ..." is read out and looks like one
        "json_first_try": rate(rows, "clean"),
        "first_char_ms": round(statistics.median(r["first_ms"] for r in rows if r["first_ms"])) if any(r["first_ms"] for r in rows) else 0,
        "system_prompt_chars": len(SYSTEM_PROMPT),
        "runs": len(rows),
    }


async def ask(msg: str) -> tuple[object, bool, float]:
    t0, first, retried, r = time.perf_counter(), None, False, None
    async for event in reply([{"role": "user", "content": msg}], slang=False):
        if event[0] == "delta" and first is None:
            first = time.perf_counter() - t0
        elif event[0] == "retry":
            retried = True
        elif event[0] == "end":
            r = event[1]
    return r, not retried, (first or 0) * 1000


async def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--runs", type=int, default=3)
    p.add_argument("--save", type=Path)
    p.add_argument("--provider", default="ollama", help="her brain for this run only (her own config.toml is not touched)")
    p.add_argument("--model", default="gemma3:12b")
    args = p.parse_args()
    cfg = Path(tempfile.mkdtemp(prefix="capri-eval-")) / "config.toml"
    cfg.write_text("\n".join(["[modelo]", f'proveedor = "{args.provider}"', f'nombre = "{args.model}"', 'esfuerzo = "low"', ""]), encoding="utf-8")
    os.environ["CAPRI_CONFIG"] = str(cfg)
    print(f"brain: {args.provider} / {args.model}", flush=True)
    rows = []
    await ask("hola")  # the cold start of the model doesn't count
    for case in load_cases():
        for _ in range(args.runs):
            r, clean, ms = await ask(case["msg"])
            tool_ok, arg_ok = score(case, r.accion)
            rows.append({"case": case, "tool_ok": tool_ok, "arg_ok": arg_ok, "clean": clean, "first_ms": ms, "texto": r.texto,
                         "delivered": delivered(case, r.texto), "numbered": bool(NUMBERED.search(r.texto)),
                         "got": None if r.accion is None else {"nombre": r.accion.nombre, "args": r.accion.args}})
        bad = [x for x in rows[-args.runs:] if not x["tool_ok"] or not x["arg_ok"] or x["delivered"] is False]
        mark = "OK " if not bad else f"{args.runs - len(bad)}/{args.runs}"
        print(f"[{mark:>4}] {case['msg'][:60]:60} -> {(bad[0]['got'] if bad else rows[-1]['got'])} ({len(rows[-1]['texto'])} chars)", flush=True)
    out = summary(rows)
    print("\n" + json.dumps(out, indent=2))
    if args.save:
        args.save.write_text(json.dumps({"summary": out, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
