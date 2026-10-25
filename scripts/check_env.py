"""Check that this machine can run Capri. Stdlib only.

Run: uv run --project backend python scripts/check_env.py
Loads the model into VRAM to verify it fits entirely on the GPU.
"""

import json
import shutil
import subprocess
import sys
import urllib.request

OLLAMA = "http://127.0.0.1:11434"
MODEL = "qwen3-vl:8b"
NUM_CTX = 8192
VRAM_BUDGET_MB = 15 * 1024

failures = 0


def report(ok: bool, label: str, detail: str = "") -> None:
    global failures
    failures += not ok
    print(f"[{'OK' if ok else 'FAIL'}] {label}" + (f": {detail}" if detail else ""))


def run(*cmd: str) -> str | None:
    if not shutil.which(cmd[0]):
        return None
    out = subprocess.run(cmd, capture_output=True, text=True)
    return out.stdout.strip() if out.returncode == 0 else None


def ollama(path: str, body: dict | None = None, timeout: float = 5) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(OLLAMA + path, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def parse_gpu(line: str) -> tuple[str, str, int, int]:
    name, driver, total, used = (x.strip() for x in line.split(","))
    return name, driver, int(total), int(used)


def main() -> int:
    v = sys.version_info
    report(v[:2] == (3, 12), "Python 3.12", f"{v.major}.{v.minor}.{v.micro}")

    node = run("node", "--version")
    report(node is not None and int(node.lstrip("v").split(".")[0]) >= 20, "Node 20+", node or "not found")
    cargo = run("cargo", "--version")
    report(cargo is not None, "Rust (cargo)", cargo or "not found (open a new terminal after installing rustup)")

    smi = run("nvidia-smi", "--query-gpu=name,driver_version,memory.total,memory.used", "--format=csv,noheader,nounits")
    if smi is None:
        report(False, "NVIDIA driver", "nvidia-smi not found")
        return 1
    name, driver, total, used = parse_gpu(smi.splitlines()[0])
    report(True, "GPU", f"{name}, driver {driver}")
    print(f"       VRAM: {used} MB used by other apps / {total} MB")

    try:
        version = ollama("/api/version")["version"]
        report(True, "Ollama", version)
    except OSError as e:
        report(False, "Ollama", f"not reachable at {OLLAMA} ({e})")
        return 1

    names = [m["name"] for m in ollama("/api/tags")["models"]]
    if MODEL not in names:
        report(False, f"Model {MODEL}", f"missing, run: ollama pull {MODEL}")
        return 1
    report(True, f"Model {MODEL}", "downloaded")

    print(f"       loading {MODEL} with num_ctx={NUM_CTX}...")
    ollama("/api/generate", {"model": MODEL, "prompt": "", "options": {"num_ctx": NUM_CTX}}, timeout=180)
    loaded = next(m for m in ollama("/api/ps")["models"] if m["name"] == MODEL)
    size_mb, vram_mb = loaded["size"] // 2**20, loaded["size_vram"] // 2**20
    report(vram_mb == size_mb, "Model fully on GPU", f"{vram_mb}/{size_mb} MB in VRAM")
    report(vram_mb < VRAM_BUDGET_MB, "Model within VRAM budget", f"{vram_mb} MB < {VRAM_BUDGET_MB} MB")

    _, _, _, used_now = parse_gpu(run("nvidia-smi", "--query-gpu=name,driver_version,memory.total,memory.used", "--format=csv,noheader,nounits").splitlines()[0])
    print(f"       VRAM now: {used_now}/{total} MB, {total - used_now} MB free")

    print("\nAll checks passed." if failures == 0 else f"\n{failures} check(s) failed.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
