import importlib.util
from pathlib import Path

from app import tools
from app.schema import Accion

SPEC = importlib.util.spec_from_file_location("eval_tools", Path(__file__).parents[2] / "scripts" / "eval_tools.py")
eval_tools = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(eval_tools)


def test_every_case_points_at_a_real_tool():
    cases = eval_tools.load_cases()
    assert len(cases) >= 50
    assert len({c["msg"] for c in cases}) == len(cases)
    for c in cases:
        assert c["tool"] is None or (c["tool"] and all(t in tools.TOOLS for t in c["tool"])), c["msg"]
        assert c["tool"] is None or "arg" in c, c["msg"]
    assert any(c.get("needs_web") for c in cases) and any(c["tool"] is None for c in cases)


def test_score_checks_the_tool_and_the_argument():
    case = {"msg": "x", "tool": ["spotify"], "arg": "shakira"}
    assert eval_tools.score(case, Accion(nombre="spotify", args={"consulta": "Shakira"})) == (True, True)
    assert eval_tools.score(case, Accion(nombre="spotify", args={"consulta": "Bad Bunny"})) == (True, False)
    assert eval_tools.score(case, Accion(nombre="youtube", args={"consulta": "shakira"})) == (False, False)
    assert eval_tools.score(case, None) == (False, False)


def test_score_of_a_request_that_needs_no_tool():
    case = {"msg": "x", "tool": None, "arg": None}
    assert eval_tools.score(case, None) == (True, True)
    assert eval_tools.score(case, Accion(nombre="buscar_web", args={"consulta": "x"})) == (False, False)


def test_summary_separates_misses_from_false_actions():
    def row(tool, ok, arg=True, web=False):
        return {"case": {"tool": tool, "needs_web": web}, "tool_ok": ok, "arg_ok": arg, "clean": True, "first_ms": 100.0}

    s = eval_tools.summary([row(["spotify"], True), row(["spotify"], False, False), row(None, True), row(None, False, False),
                            row(["buscar_web"], True, True, web=True)])
    assert s["false_actions"] == 0.5 and s["needs_web_searched"] == 1.0 and s["arg_ok"] == 1.0
    assert round(s["tool_ok"], 2) == 0.6


def test_score_ignores_accents_and_case():
    case = {"msg": "x", "tool": ["buscar_web"], "arg": "dólar"}
    assert eval_tools.score(case, Accion(nombre="buscar_web", args={"consulta": "DOLAR hoy"})) == (True, True)
