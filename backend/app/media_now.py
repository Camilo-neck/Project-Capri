"""What is playing on this PC, from the Windows media session (the one behind the volume flyout).

Works for any player that registers there: Spotify, YouTube in the browser, VLC... No account, no network.
Titles are whatever the player or a web page says, so they're data: cleaned and clipped, never trusted.
"""

import asyncio
import re
from dataclasses import dataclass

PLAYING = 4  # GlobalSystemMediaTransportControlsSessionPlaybackStatus.PLAYING
APPS = {"spotify": "Spotify", "msedge": "Edge", "chrome": "Chrome", "firefox": "Firefox", "brave": "Brave", "vlc": "VLC",
        "microsoft.zunemusic_8wekyb3d8bbwe!microsoft.zunemusic": "Reproductor multimedia"}


@dataclass(frozen=True)
class Track:
    title: str
    artist: str
    album: str
    app: str
    playing: bool
    position: float  # seconds when it was read
    duration: float  # 0 when it has no end (a live stream) or the player doesn't say


def clean(text: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", text or "")).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def app_name(source: str) -> str:
    key = (source or "").lower().removesuffix(".exe")
    return APPS.get(key) or clean((source or "").removesuffix(".exe"), 30) or "un reproductor"


def timeline(position: float, duration: float) -> tuple[float, float]:
    if duration <= 0 or duration > 6 * 3600:
        return 0.0, 0.0
    return min(max(position, 0.0), duration), duration


def pick(tracks: list[Track]) -> Track | None:
    """What is playing, else the first thing paused; sessions with no title (idle players) don't count."""
    titled = [t for t in tracks if t.title]
    return next((t for t in titled if t.playing), titled[0] if titled else None)


async def read() -> list[Track]:
    from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as Manager

    tracks = []
    for s in (await Manager.request_async()).get_sessions():
        props = await s.try_get_media_properties_async()
        line = s.get_timeline_properties()
        position, duration = timeline(line.position.total_seconds(), line.end_time.total_seconds())
        tracks.append(Track(clean(props.title, 120), clean(props.artist, 80), clean(props.album_title, 80),
                            app_name(s.source_app_user_model_id), s.get_playback_info().playback_status == PLAYING,
                            position, duration))
    return tracks


def now_playing() -> Track | None:
    try:
        return pick(asyncio.run(read()))
    except (ImportError, OSError, RuntimeError):  # no WinRT, or the session service isn't answering
        return None
