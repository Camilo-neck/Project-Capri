"""Export the documented sprite sheet (docs/capri-sprites.png) with headless Edge.

Run from the repo root with Vite serving the avatar (cd avatar; npx vite):
  uv run --project backend python scripts/export_sprite_sheet.py
Optional: URL OUT.png [width height] to capture something else.
"""
import asyncio
import base64
import json
import subprocess
import sys
import time
import tempfile
import urllib.request
from pathlib import Path

import websockets

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1420/preview.html?scale=2"
out = sys.argv[2] if len(sys.argv) > 2 else str(Path(__file__).resolve().parent.parent / "docs" / "capri-sprites.png")
w, h = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (1400, 1000)

proc = subprocess.Popen([EDGE, "--headless=new", "--remote-debugging-port=9333", "--disable-gpu-sandbox",
                         "--user-data-dir=" + tempfile.mkdtemp(prefix="capri-edge-"), f"--window-size={w},{h}", "about:blank"])


async def main():
    for _ in range(50):
        try:
            targets = json.load(urllib.request.urlopen("http://127.0.0.1:9333/json"))
            page = next(t for t in targets if t["type"] == "page")
            break
        except Exception:
            time.sleep(0.2)
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=None) as ws:
        n = 0

        async def call(method, params=None):
            nonlocal n
            n += 1
            await ws.send(json.dumps({"id": n, "method": method, "params": params or {}}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("method") == "Runtime.exceptionThrown":
                    print("EXC", json.dumps(msg["params"]["exceptionDetails"])[:800])
                if msg.get("method") == "Runtime.consoleAPICalled" and msg["params"]["type"] in ("error", "warning"):
                    print(msg["params"]["type"], str([a.get("value", a.get("description")) for a in msg["params"]["args"]])[:600])
                if msg.get("id") == n:
                    return msg.get("result", {})

        await call("Runtime.enable")
        await call("Emulation.setDeviceMetricsOverride", {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False})
        await call("Page.navigate", {"url": url})
        for _ in range(60):
            r = await call("Runtime.evaluate", {"expression": "document.body && document.body.dataset.ready"})
            if r.get("result", {}).get("value") == "1":
                break
            await asyncio.sleep(0.25)
        await asyncio.sleep(0.8)
        shot = await call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
        open(out, "wb").write(base64.b64decode(shot["data"]))


try:
    asyncio.run(main())
finally:
    proc.kill()
