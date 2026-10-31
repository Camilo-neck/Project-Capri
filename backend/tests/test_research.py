import httpx
import pytest

from app import power, research, tools
from app.settings import Settings

RSS = """<rss><channel><title>x</title>
<item><title>Vieja - El Tiempo</title><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Nueva - Semana</title><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item>
</channel></rss>"""


def serve(monkeypatch, routes: dict):
    """httpx.get answered by the first route whose text is in the address."""
    seen = []

    def get(url, params=None, headers=None, timeout=None, follow_redirects=None):
        seen.append((url, params))
        for part, body in routes.items():
            if part in url:
                if isinstance(body, int):
                    return httpx.Response(body, request=httpx.Request("GET", url))
                kind = {"text": body} if isinstance(body, str) else {"json": body}
                return httpx.Response(200, request=httpx.Request("GET", url), **kind)
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(research.httpx, "get", get)
    research.memo.clear()
    return seen


GEO = {"results": [{"name": "Bogotá", "country": "Colombia", "latitude": 4.6, "longitude": -74.1}]}
SKY = {"current": {"temperature_2m": 12.1, "apparent_temperature": 10.4, "precipitation": 0.0},
       "daily": {"temperature_2m_max": [19.0, 20.0], "temperature_2m_min": [8.0, 9.0], "precipitation_probability_max": [40, 70]}}


def test_weather_takes_the_place_out_of_the_question(monkeypatch):
    seen = serve(monkeypatch, {"geocoding": GEO, "forecast": SKY})
    text = research.consult("clima", "clima en Bogotá hoy")
    assert seen[0][1]["name"] == "Bogotá"
    assert "Bogotá" in text and "12.1" in text and "40 %" in text and "70 %" in text


def test_weather_of_an_unknown_place(monkeypatch):
    serve(monkeypatch, {"geocoding": {}})
    with pytest.raises(research.ResearchError, match="Narnia"):
        research.consult("clima", "Narnia")


def test_dollar_in_pesos_is_the_official_trm(monkeypatch):
    serve(monkeypatch, {"datos.gov.co": [{"valor": "3182.99", "vigenciadesde": "2026-10-31T00:00:00.000"}]})
    text = research.consult("divisas", "cuánto está el dólar hoy")
    assert "TRM" in text and "3.182,99" in text and "2026-10-31" in text


def test_other_currencies_use_the_market_rate(monkeypatch):
    serve(monkeypatch, {"er-api": {"result": "success", "rates": {"COP": 3700.5, "EUR": 1}}})
    assert "1 EUR = 3.700,50 COP" in research.consult("divisas", "euro a pesos colombianos")


def test_codes_keep_the_order_they_were_asked_in():
    assert research.codes("de MXN a USD") == ("MXN", "USD")
    assert research.codes("peso mexicano a euros") == ("MXN", "EUR")
    assert research.codes("dólar") == ("USD", "COP")
    assert research.codes("euros") == ("EUR", "COP")


def test_wikipedia_falls_back_to_english(monkeypatch):
    seen = serve(monkeypatch, {"es.wikipedia.org": 404, "en.wikipedia.org": {"title": "Night City", "extract": "A fictional city."}})
    assert "A fictional city." in research.consult("wikipedia", "Night City")
    assert seen[-1][0].endswith("/page/summary/Night_City")
    serve(monkeypatch, {"wikipedia.org": 404})
    with pytest.raises(research.ResearchError, match="Narnia"):
        research.consult("wikipedia", "Narnia")


def test_news_come_newest_first_with_their_date(monkeypatch):
    seen = serve(monkeypatch, {"news.google.com": RSS})
    text = research.consult("noticias", "Real Madrid")
    assert "when:7d" in seen[0][1]["q"]
    assert text.index("Nueva") < text.index("Vieja") and "30/10" in text


def test_a_failed_source_says_so_and_is_not_remembered(monkeypatch):
    serve(monkeypatch, {"news.google.com": 500})
    with pytest.raises(research.ResearchError):
        research.consult("noticias", "x")
    assert not research.memo
    serve(monkeypatch, {"news.google.com": "esto no es xml"})
    with pytest.raises(research.ResearchError):
        research.consult("noticias", "x")


def test_the_same_question_is_asked_once(monkeypatch):
    seen = serve(monkeypatch, {"news.google.com": RSS})
    assert research.consult("noticias", "Real Madrid") == research.consult("noticias", "real madrid")
    assert len(seen) == 1


def test_relevant_keeps_what_the_question_is_about_in_page_order():
    filler = [f"relleno sin interés número {i} " * 4 for i in range(200)]
    text = "\n".join(["Título de la página", *filler[:100], "El horario de apertura es de 8 a 5", *filler[100:]])
    out = research.relevant(text, "¿cuál es el horario?", 500)
    assert len(out) <= 500 and "horario de apertura" in out and out.startswith("Título")


def test_relevant_without_a_question_is_the_start_of_the_page():
    assert research.relevant("a\nb\nc", "", 3) == "a\nb"
    assert research.relevant("corto", "cualquier cosa", 100) == "corto"
    assert research.relevant("x" * 900, "horario de hoy", 50) == "x" * 50  # a page in one huge line


def test_read_page_reports_a_site_that_refuses(monkeypatch):
    research.memo.clear()

    def refuse(url):
        r = httpx.Response(403, request=httpx.Request("GET", url))
        raise httpx.HTTPStatusError("no", request=r.request, response=r)

    monkeypatch.setattr(power, "get", refuse)
    with pytest.raises(tools.ToolError, match="no deja"):
        tools.read_page(tools.PageArgs(url="https://ejemplo.com/a"), Settings())


def test_read_page_asks_for_the_part_that_matters(monkeypatch):
    research.memo.clear()
    page = "\n".join(["Tienda"] + ["texto de relleno cualquiera " * 5] * 300 + ["Abrimos los domingos"])
    monkeypatch.setattr(power, "get", lambda url: page)
    out = tools.read_page(tools.PageArgs(url="https://ejemplo.com/b", pregunta="abren los domingos?"), Settings())
    assert "Abrimos los domingos" in out and len(out) <= tools.MAX_TEXT


def test_a_page_with_almost_no_text_says_why(monkeypatch):
    research.memo.clear()
    monkeypatch.setattr(power, "get", lambda url: "Cargando")
    assert "JavaScript" in tools.read_page(tools.PageArgs(url="https://ejemplo.com/c"), Settings())


def test_a_bot_check_page_is_reported_never_passed_along(monkeypatch):
    class Fake:
        status_code, is_redirect, headers, encoding = 200, False, {"content-type": "text/html"}, "utf-8"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def raise_for_status(self):
            pass

        def iter_bytes(self, n):
            return iter([b"<p>Please complete the CAPTCHA to continue</p>"])

    class Http:
        def stream(self, method, url):
            return Fake()

    with pytest.raises(power.ToolError, match="humano"):
        power.get("https://93.184.216.34/", Http())


def test_the_tool_turns_a_source_failure_into_her_words(monkeypatch):
    serve(monkeypatch, {"geocoding": {}})
    with pytest.raises(tools.ToolError, match="Narnia"):
        tools.investigate(tools.ResearchArgs(tema="clima", consulta="Narnia"), Settings())
