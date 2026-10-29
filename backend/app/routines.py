"""His routines: a phrase of his that does several things at once ("modo chamba": VS Code, Warp and some music).
Defined in config.toml ([rutinas.<name>]), matched on what he said (never by the model, never from what's on screen),
run by the orchestrator."""

import re

from app import spoken
from app.settings import Routine

# what may come before the phrase: "activa el modo chamba", "oye, pon modo chamba", "entra en modo chamba"
_LEAD = (r"(?:(?:oye|hey) )?(?:(?:activa(?:me)?|pon(?:me)?|inicia|empieza|arranca|enciende|entra(?: en)?|vamos(?: a)?|"
         r"activate|start|turn on|enter|let's go(?: into)?) )?(?:el |la |al |a |the )?")


def match(text: str, routines: dict[str, Routine]) -> str | None:
    """The routine he's asking for: his phrase said alone, maybe with a verb before it. Talking about it
    ("no quiero modo chamba hoy") isn't asking for it."""
    p = " ".join(spoken._POLITE.sub(" ", spoken.plain(text)).split())
    for name, r in routines.items():
        for phrase in r.phrases:
            if re.fullmatch(_LEAD + re.escape(spoken.plain(phrase)), p):
                return name
    return None
