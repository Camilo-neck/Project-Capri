"""One-hour soak test: is anything leaking? Needs GPU + Ollama and Capri running with remote debugging:

    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
    (then start Capri: npm run tauri dev, or the release avatar.exe)
    uv run --project backend python scripts/soak.py [--minutes 60] [--every 120] [--out soak.csv]

Every `--every` seconds it sends Capri a message through her own input bar (chat, a screen look,
a file search, the calendar), so the whole path runs: avatar, backend, model. Every minute it records
the memory of the app, its webview and the backend, and the GPU's used VRAM. At the end it reports
each one's trend; a steady climb is a leak.
"""

import argparse
import asyncio
import csv
import json
import subprocess
import sys
import time
import urllib.request

import psutil
import websockets

MESSAGES = [
    "hola, ¿qué tal vas?",
    "/mira",
    "cuéntame un dato curioso sobre el espacio",
    "busca archivos que se llamen PLAN",
    "¿qué tengo hoy en el calendario?",
    "dime algo para animarme, porfa",
]
LIMIT_MB_PER_H = 30  # growth per hour above this is reported as a likely leak


async def submit(text: str) -> None:
    page = next(t for t in json.load(urllib.request.urlopen("http://127.0.0.1:9222/json")) if t["type"] == "page")
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=None) as ws:
        js = ("(()=>{const f=document.getElementById('input-row');f.hidden=false;"
              f"document.getElementById('input').value={json.dumps(text)};f.requestSubmit();}})()")
        await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": js}}))
        await ws.recv()


def processes() -> dict[str, list[psutil.Process]]:
    groups: dict[str, list[psutil.Process]] = {"app": [], "webview": [], "backend": []}
    for p in psutil.process_iter(["name", "cmdline"]):
        try:
            name, cmd = (p.info["name"] or "").lower(), " ".join(p.info["cmdline"] or [])
        except (psutil.Error, TypeError):
            continue
        if name == "avatar.exe":
            groups["app"].append(p)
        elif name == "msedgewebview2.exe" and "com.capri.avatar" in cmd:
            groups["webview"].append(p)
        elif name == "python.exe" and "app.main" in cmd:
            groups["backend"].append(p)
    return groups


def sample() -> dict[str, float]:
    row = {}
    for group, procs in processes().items():
        total = 0
        for p in procs:
            try:
                total += p.memory_info().private
            except psutil.Error:
                pass
        row[f"{group}_mb"] = round(total / 2**20, 1)
    out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                         capture_output=True, text=True)
    row["vram_mb"] = float(out.stdout.split()[0]) if out.returncode == 0 else float("nan")
    return row


def slope_per_hour(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    den = sum((x - mx) ** 2 for x in xs) or 1
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den * 3600


async def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=60)
    ap.add_argument("--every", type=float, default=120)
    ap.add_argument("--out", default="soak.csv")
    a = ap.parse_args()
    if not processes()["app"]:
        sys.exit("Capri no está corriendo.")
    t0 = time.time()
    rows, next_msg, next_sample, i = [], t0 + 10, t0, 0  # let the first sample settle before talking
    while time.time() - t0 < a.minutes * 60:
        now = time.time()
        if now >= next_sample:
            row = {"t_s": round(now - t0), **sample()}
            rows.append(row)
            print(row, flush=True)
            next_sample += 60
        if now >= next_msg:
            try:
                await submit(MESSAGES[i % len(MESSAGES)])
            except Exception as e:  # the page reloading or busy: try the next one
                print("no se pudo enviar:", e, flush=True)
            i += 1
            next_msg += a.every
        await asyncio.sleep(1)
    rows.append({"t_s": round(time.time() - t0), **sample()})

    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    # Trend after a 5-minute warm-up (model caches, first JIT and so on settle first).
    warm = [r for r in rows if r["t_s"] >= 300] or rows
    xs = [r["t_s"] for r in warm]
    leaks = []
    print(f"\n{len(rows)} muestras, {i} mensajes. Tendencia tras 5 min de calentamiento:")
    for key in [k for k in rows[0] if k.endswith("_mb")]:
        ys = [r[key] for r in warm]
        s = slope_per_hour(xs, ys)
        flag = s > LIMIT_MB_PER_H
        leaks += [key] * flag
        print(f"  {key:12} {ys[0]:8.0f} -> {ys[-1]:8.0f} MB   {s:+7.1f} MB/h {'<- posible fuga' if flag else ''}")
    print("\nSin fugas." if not leaks else f"\nRevisar: {', '.join(leaks)}")
    sys.exit(1 if leaks else 0)


if __name__ == "__main__":
    asyncio.run(main())
