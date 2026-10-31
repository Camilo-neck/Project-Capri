"""What she looks up to answer him, with public sources meant to be asked: weather, currencies, Wikipedia and news.

No key and no account, so it works on any PC. Nothing here opens anything on his screen: that's `buscar` and `youtube`.
All of it is someone else's writing: cleaned, clipped and handed to the model as data.
"""

import re
import time
import unicodedata
import xml.etree.ElementTree as ET
from collections.abc import Callable
from email.utils import parsedate_to_datetime
from urllib.parse import quote

import httpx

from app.media_now import clean

UA = {"User-Agent": "Capri/1.0 (personal desktop assistant)"}
GEO = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST = "https://api.open-meteo.com/v1/forecast"
TRM = "https://www.datos.gov.co/resource/32sa-8pi3.json"
RATES = "https://open.er-api.com/v6/latest"
NEWS = "https://news.google.com/rss/search"
MEMO_S = 15 * 60  # the same question within this time isn't asked again
MEMO_MAX = 64
NEWS_MAX = 6

CURRENCIES = {"peso mexicano": "MXN", "pesos mexicanos": "MXN", "peso argentino": "ARS", "pesos argentinos": "ARS",
              "peso chileno": "CLP", "pesos chilenos": "CLP", "peso colombiano": "COP", "pesos colombianos": "COP",
              "dolares": "USD", "dolar": "USD", "euros": "EUR", "euro": "EUR", "pesos": "COP", "peso": "COP",
              "libras": "GBP", "libra": "GBP", "yenes": "JPY", "yen": "JPY", "reales": "BRL", "real": "BRL", "soles": "PEN", "sol": "PEN"}
CODES = {"usd", "eur", "cop", "mxn", "ars", "clp", "gbp", "jpy", "brl", "pen", "cad", "chf", "cny"}
NOT_A_PLACE = re.compile(r"\b(clima|tiempo|temperatura|pron[oó]stico|weather|lluvia|hoy|ma[nñ]ana|ahora|actual|en|de|del|el|la|in|the|today)\b", re.I)
SKIP_WORDS = {"cual", "cuales", "como", "cuando", "donde", "quien", "para", "esta", "este", "esto", "that", "what", "when", "where", "which", "with"}

memo: dict[tuple, tuple[float, str]] = {}


class ResearchError(Exception):
    pass


def plain(text: str) -> str:
    """Lowercase without accents."""
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")


def cached(key: tuple, get: Callable[[], str]) -> str:
    """The answer of the last 15 minutes, or a new one. Failures aren't kept."""
    now = time.monotonic()
    if key in memo and now - memo[key][0] < MEMO_S:
        return memo[key][1]
    text = get()
    if len(memo) >= MEMO_MAX:
        memo.clear()
    memo[key] = (now, text)
    return text


def fetch(url: str, **params) -> httpx.Response:
    try:
        r = httpx.get(url, params=params or None, headers=UA, timeout=10, follow_redirects=True)
        r.raise_for_status()
        return r
    except httpx.HTTPError:
        raise ResearchError(f"{httpx.URL(url).host} no respondió; prueba en un momento") from None


def weather(question: str) -> str:
    place = re.sub(r"\s+", " ", NOT_A_PLACE.sub(" ", question)).strip(" ¿?.,") or question
    hits = fetch(GEO, name=place, count=1, language="es").json().get("results")
    if not hits:
        raise ResearchError(f"no encontré el lugar «{place}»")
    p = hits[0]
    d = fetch(FORECAST, latitude=p["latitude"], longitude=p["longitude"], timezone="auto", forecast_days=2,
              current="temperature_2m,apparent_temperature,precipitation",
              daily="temperature_2m_max,temperature_2m_min,precipitation_probability_max").json()
    now, day = d["current"], d["daily"]
    low, high, rain = day["temperature_2m_min"], day["temperature_2m_max"], day["precipitation_probability_max"]
    return (f"{p['name']}, {p.get('country', '')}: ahora {now['temperature_2m']} °C (sensación {now['apparent_temperature']} °C), "
            f"{now['precipitation']} mm de lluvia. Hoy de {low[0]} a {high[0]} °C, {rain[0]} % de probabilidad de lluvia. "
            f"Mañana de {low[1]} a {high[1]} °C, {rain[1]} %.")


def codes(question: str) -> tuple[str, str]:
    """The currencies asked about, in order: "euro a pesos" -> EUR, COP. Alone it's against the Colombian peso."""
    text = plain(question)
    names = "|".join(sorted(CURRENCIES, key=len, reverse=True))
    found = [CURRENCIES.get(m) or m.upper() for m in re.findall(rf"\b(?:{names}|{'|'.join(CODES)})\b", text)]
    first = found[0] if found else "USD"
    second = next((c for c in found[1:] if c != first), "COP" if first != "COP" else "USD")
    return first, second


def money(n: float) -> str:
    return f"{n:,.2f}".replace(",", " ").replace(".", ",").replace(" ", ".")


def currency(question: str) -> str:
    base, to = codes(question)
    if (base, to) == ("USD", "COP"):
        rows = fetch(TRM, **{"$limit": 1, "$order": "vigenciadesde DESC"}).json()
        if rows:
            return f"TRM oficial de Colombia: 1 USD = {money(float(rows[0]['valor']))} COP (vigente desde {rows[0]['vigenciadesde'][:10]})."
    d = fetch(f"{RATES}/{base}").json()
    rate = d.get("rates", {}).get(to)
    if d.get("result") != "success" or not rate:
        raise ResearchError(f"no tengo la tasa de {base} a {to}")
    return f"1 {base} = {money(rate)} {to} (tasa de mercado de hoy, aproximada)."


def wikipedia(question: str) -> str:
    # ponytail: by exact title. Its search endpoints refuse without contact details in the User-Agent (their robot policy)
    title = quote(question.strip().replace(" ", "_"), safe="")
    for lang in ("es", "en"):
        try:
            s = fetch(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}").json()
        except ResearchError:
            continue
        return f"Wikipedia, {clean(s.get('title', ''), 100)}: {clean(s.get('extract', ''), 1500)}"
    raise ResearchError(f"Wikipedia no tiene una página llamada «{question}»")


def news(question: str) -> str:
    try:
        items = ET.fromstring(fetch(NEWS, q=f"{question} when:7d", hl="es-419", gl="CO", ceid="CO:es-419").text).findall("./channel/item")
    except ET.ParseError:
        raise ResearchError("las noticias no llegaron bien; prueba en un momento") from None
    if not items:
        return f"No hay noticias de la última semana sobre «{question}»."
    dated = [(parsedate_to_datetime(i.findtext("pubDate", "Thu, 01 Jan 1970 00:00:00 GMT")), clean(i.findtext("title", ""), 140)) for i in items[:20]]
    newest = sorted(dated, key=lambda d: d[0], reverse=True)[:NEWS_MAX]
    return "Titulares de la última semana, del más nuevo al más viejo:\n" + "\n".join(f"- {at:%d/%m}: {title}" for at, title in newest)


SOURCES = {"clima": weather, "divisas": currency, "wikipedia": wikipedia, "noticias": news}


def consult(topic: str, question: str) -> str:
    return cached((topic, plain(question)), lambda: SOURCES[topic](question))


def relevant(text: str, question: str, limit: int) -> str:
    """A page cut down to `limit` characters: its first lines and those that share words with the question, in page order."""
    if len(text) <= limit:
        return text
    words = {w for w in re.findall(r"\w{4,}", plain(question)) if w not in SKIP_WORDS}
    if not words:
        return text[:limit]
    lines = text.splitlines()
    hits = lambda i: sum(w in plain(lines[i]) for w in words)  # noqa: E731
    keep, used = set(), 0
    for i in [*range(min(3, len(lines))), *sorted(range(3, len(lines)), key=hits, reverse=True)]:
        if used + len(lines[i]) + 1 <= limit:
            keep.add(i)
            used += len(lines[i]) + 1
    return "\n".join(lines[i] for i in sorted(keep)) or text[:limit]  # one huge line: nothing fit
