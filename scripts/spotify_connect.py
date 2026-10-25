"""Connect Capri to Spotify without opening Capri: opens Spotify's consent page in the browser and
waits until you accept. (Inside Capri, just tell her "conecta Spotify".)

Run: uv run --project backend python scripts/spotify_connect.py   (from the repo root)
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app import spotify  # noqa: E402


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        print(spotify.authorize())
    except spotify.SpotifyError as e:
        sys.exit(f"No se pudo: {e}")
    deadline = time.time() + spotify.LOGIN_S
    while time.time() < deadline:
        if spotify.connected():
            print("Spotify conectado.")
            return
        time.sleep(1)
    sys.exit("Se acabó el tiempo sin que aceptaras en el navegador.")


if __name__ == "__main__":
    main()
