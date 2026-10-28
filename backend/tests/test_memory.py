import asyncio
import json

from fastapi.testclient import TestClient

from app.memory import BUDGET, Memory
from app.orchestrator import TRIM_AT, Orchestrator
from app.ws import create_app

TOKEN = "test-token"
ORIGIN = {"origin": "http://tauri.localhost"}


def say(texto: str, accion: dict | None = None) -> str:
    return json.dumps({"emocion": "neutral", "gesto": "ninguno", "accion": accion, "texto": texto})


def scripted(*replies: str | tuple[str, int]):
    """A generate answering `replies` in order (the last repeats); a (json, ctx) pair also reports context tokens."""
    calls: list[list[dict]] = []

    async def generate(messages):
        calls.append(messages)
        r = replies[min(len(calls), len(replies)) - 1]
        text, ctx = r if isinstance(r, tuple) else (r, None)
        yield text
        if ctx:
            yield ctx

    return generate, calls


def memory_block(call: list[dict]) -> str:
    return call[-1]["content"]  # the last message starts with the time, then memory


async def no_summary(text: str) -> str:
    raise AssertionError("not expected")


def connect(orch: Orchestrator):
    return TestClient(create_app(TOKEN, orch, reminders=False)).websocket_connect(f"/ws?token={TOKEN}", headers=ORIGIN)


def until(ws, kind: str) -> list[dict]:
    msgs = []
    while not msgs or msgs[-1]["type"] != kind:
        msgs.append(ws.receive_json())
    return msgs


def until_idle(ws) -> list[dict]:
    msgs = []
    while msgs[-1:] != [{"type": "state", "value": "idle"}]:
        msgs.append(ws.receive_json())
    return msgs


def test_search_ignores_accents_and_case_and_keeps_one_copy(tmp_path):
    m = Memory(tmp_path / "m.db")
    m.remember("Le encanta el café de Colombia", "preferencia")
    m.remember("Le encanta el café de Colombia", "preferencia")  # duplicate: ignored
    m.remember("Su perro se llama Toby")
    assert [t for _, t, _ in m.search("¿qué CAFE me gusta?")] == ["Le encanta el café de Colombia"]
    assert [t for _, t, _ in m.search("toby")] == ["Su perro se llama Toby"]
    assert m.search("ok") == []  # too short to search
    assert m.preferences() == ["Le encanta el café de Colombia"]


def test_memory_survives_a_restart(tmp_path):
    Memory(tmp_path / "m.db").remember("Prefiere que lo llamen Cami", "preferencia")
    assert Memory(tmp_path / "m.db").preferences() == ["Prefiere que lo llamen Cami"]


def test_context_has_preferences_related_facts_and_summaries_within_budget(tmp_path):
    m = Memory(tmp_path / "m.db")
    old = m.new_session()
    m.set_summary(old, "Hablaron de su viaje a Cartagena.")
    now = m.new_session()
    m.remember("Prefiere respuestas cortas", "preferencia")
    m.remember("Trabaja de diseñador")
    m.remember("Su perro se llama Toby")
    block = m.context("¿cómo está Toby?", now, running="Pidió ayuda con un correo.", first=True)
    assert "Prefiere respuestas cortas" in block and "Toby" in block and "diseñador" not in block
    assert "Cartagena" in block and "correo" in block
    for i in range(80):
        m.remember(f"Preferencia número {i} bastante larga para llenar el bloque", "preferencia")
    assert len(m.context("", now)) <= BUDGET


def test_recordar_saves_marks_it_and_feeds_the_next_turns(tmp_path):
    memory = Memory(tmp_path / "m.db")
    generate, calls = scripted(
        say("¡Anotado, Cami!", {"nombre": "recordar", "args": {"texto": "Prefiere que lo llamen Cami", "tipo": "preferencia"}}),
        say("Hecho."),
    )
    with connect(Orchestrator(generate, memory=memory)) as ws:
        ws.send_json({"type": "text_input", "text": "llámame Cami"})
        msgs = until_idle(ws)
    assert {"type": "remembered", "texto": "Prefiere que lo llamen Cami"} in msgs
    assert "confirm_request" not in {m["type"] for m in msgs}  # saving is safe
    # a new conversation (a restart) gets it in its prompt
    generate2, calls2 = scripted(say("¡Hola, Cami!"))
    with connect(Orchestrator(generate2, memory=Memory(tmp_path / "m.db"))) as ws:
        ws.send_json({"type": "text_input", "text": "hola"})
        until_idle(ws)
    assert "Prefiere que lo llamen Cami" in memory_block(calls2[0])


def test_olvida_asks_with_the_list_then_forgets_everywhere(tmp_path):
    memory = Memory(tmp_path / "m.db")
    memory.remember("Prefiere que lo llamen Cami", "preferencia")
    memory.remember("Su perro se llama Toby")
    generate, calls = scripted(say("¡Claro, Cami!"))
    orch = Orchestrator(generate, memory=memory, summarize=no_summary)
    with connect(orch) as ws:
        ws.send_json({"type": "text_input", "text": "dime Cami, porfa"})
        until_idle(ws)
        ws.send_json({"type": "text_input", "text": "/olvida Cami"})
        ask = until(ws, "confirm_request")[-1]
        assert ask["texto"].startswith("Olvidar 1 recuerdo: «Prefiere que lo llamen Cami»")
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})
        said = "".join(m["text"] for m in until_idle(ws) if m["type"] == "text_delta")
    assert said == "Hecho, ya no me acuerdo de eso."
    assert memory.preferences() == [] and memory.search("Toby")  # only what matched
    assert not any("cami" in m["content"].lower() for m in orch.history)  # nor in this conversation
    stored = memory.db.execute("select contenido from mensajes").fetchall()
    assert not any("cami" in c.lower() for (c,) in stored)  # nor in the stored one
    assert len(calls) == 1  # the command never reached the model


def test_olvida_keeps_it_on_no_and_says_when_nothing_matches(tmp_path):
    memory = Memory(tmp_path / "m.db")
    memory.remember("Su perro se llama Toby")
    orch = Orchestrator(scripted(say("..."))[0], memory=memory)
    with connect(orch) as ws:
        ws.send_json({"type": "text_input", "text": "/olvida Toby"})
        ask = until(ws, "confirm_request")[-1]
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": False})
        no = "".join(m["text"] for m in until_idle(ws) if m["type"] == "text_delta")
        ws.send_json({"type": "text_input", "text": "/olvida dinosaurios"})
        none = "".join(m["text"] for m in until_idle(ws) if m["type"] == "text_delta")
    assert no == "Vale, lo sigo recordando." and memory.search("Toby")
    assert none == "No encuentro nada así en mi memoria."


def test_olvida_todo_wipes_facts_summaries_and_messages(tmp_path):
    memory = Memory(tmp_path / "m.db")
    old = memory.new_session()
    memory.log(old, "user", "hola")
    memory.set_summary(old, "Saludos.")
    memory.remember("Su perro se llama Toby")
    orch = Orchestrator(scripted(say("..."))[0], memory=memory)
    with connect(orch) as ws:
        ws.send_json({"type": "text_input", "text": "/olvida todo"})
        ask = until(ws, "confirm_request")[-1]
        assert "todo" in ask["texto"]
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})
        until_idle(ws)
    assert memory.search("Toby") == [] and memory.last_summary(orch.session) is None
    assert memory.db.execute("select count(*) from mensajes").fetchone() == (0,)


def test_olvidar_tool_also_confirms(tmp_path):
    memory = Memory(tmp_path / "m.db")
    memory.remember("Su perro se llama Toby")
    generate, calls = scripted(say("Vale.", {"nombre": "olvidar", "args": {"texto": "Toby"}}), say("Olvidado."))
    with connect(Orchestrator(generate, memory=memory)) as ws:
        ws.send_json({"type": "text_input", "text": "olvida lo de mi perro Toby"})
        ask = until(ws, "confirm_request")[-1]
        assert memory.search("Toby")  # nothing gone before the click
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})
        until_idle(ws)
    assert memory.search("Toby") == []


def test_a_long_conversation_is_trimmed_into_a_summary(tmp_path):
    memory = Memory(tmp_path / "m.db")
    summaries: list[str] = []

    async def summarize(text: str) -> str:
        summaries.append(text)
        return "Hablaron del viaje a Cartagena y de su perro."

    generate, calls = scripted(say("Cuéntame más."), (say("Ajá."), TRIM_AT + 1), say("Sigo aquí."))
    orch = Orchestrator(generate, memory=memory, summarize=summarize)
    with connect(orch) as ws:
        for text in ["me voy a Cartagena", "llevo a mi perro", "¿qué más?"]:
            ws.send_json({"type": "text_input", "text": text})
            until_idle(ws)
    # after the 2nd turn the context passed TRIM_AT: the older half became a summary
    assert summaries and "Usuario: me voy a Cartagena" in summaries[0] and "Capri:" not in summaries[0]
    assert orch.history[0]["content"] == "llevo a mi perro"  # whole turns kept
    assert "Antes en esta conversación: Hablaron del viaje" in memory_block(calls[-1])
    # not the session's summary: that one is made from the whole session once it ends (catch_up)
    assert memory.db.execute("select resumen from sesiones where id = ?", (orch.session,)).fetchone()[0] is None


def test_a_session_closed_without_summary_is_summarized_next_time(tmp_path):
    first = Orchestrator(scripted(say("¡Suerte con la entrevista!"))[0], memory=Memory(tmp_path / "m.db"))
    with connect(first) as ws:
        ws.send_json({"type": "text_input", "text": "mañana tengo una entrevista"})
        until_idle(ws)
    # the app closed: no summary. Next start catches up and the new conversation knows.
    got = []

    async def summarize(text: str) -> str:
        got.append(text)
        return "Tenía una entrevista al día siguiente."

    generate, calls = scripted(say("¿Qué tal la entrevista?"))
    second = Orchestrator(generate, memory=Memory(tmp_path / "m.db"), summarize=summarize)
    with connect(second) as ws:
        ws.send_json({"type": "text_input", "text": "hola"})
        until_idle(ws)
    assert "Usuario: mañana tengo una entrevista" in got[0]
    assert "no la saca): Tenía una entrevista" in memory_block(calls[0])


def test_no_memory_tools_on_screen_turns(tmp_path):
    memory = Memory(tmp_path / "m.db")
    generate, _ = scripted(say("Visto.", {"nombre": "recordar", "args": {"texto": "La contraseña es 1234"}}))
    orch = Orchestrator(generate, capture=lambda rect: b"jpg", memory=memory)
    asyncio.run(orch.look("", (0, 0, 10, 10), lambda m: asyncio.sleep(0)))
    assert memory.search("contraseña") == []


def test_a_today_noted_yesterday_is_left_out(tmp_path):
    m = Memory(tmp_path / "m.db")
    m.remember("Prefiere que lo llamen C", "preferencia")
    m.remember("Debe recordar 10 minutos antes de su reunión de hoy", "preferencia")
    m.db.execute("update recuerdos set creado = '2020-01-01T09:00:00'")
    m.remember("Tiene reunión hoy a las 3", "preferencia")  # noted today: still true
    ctx = m.context("", m.new_session())
    assert "llamen C (anotado el 01/01)" in ctx
    assert "10 minutos" not in ctx and "reunión hoy a las 3" in ctx


def test_the_last_conversation_comes_up_only_on_the_first_turn_or_when_it_fits(tmp_path):
    m = Memory(tmp_path / "m.db")
    old = m.new_session()
    m.set_summary(old, "Habló de un reencuentro con Guzmán y de disfraces.")
    now = m.new_session()
    assert "Guzmán" in m.context("hola", now, first=True)
    assert "Guzmán" in m.context("¿qué disfraz me pongo?", now)  # he brought it up
    assert "Guzmán" not in m.context("pon música de Bad Bunny", now)
    assert "Guzmán" not in m.context("de que me hablaste?", now)  # stopwords don't count as bringing it up
    assert "Guzmán" not in m.context("[aviso automático] salúdale", now, first=True, own=True)


def test_after_a_result_she_is_reminded_what_was_asked(tmp_path):
    generate, calls = scripted(say("Busco.", {"nombre": "calendario", "args": {"dias": 1}}), say("Nada hoy."))
    with connect(Orchestrator(generate, memory=Memory(tmp_path / "m.db"))) as ws:
        ws.send_json({"type": "text_input", "text": "¿qué tengo hoy?"})
        until_idle(ws)
    result = [m for m in calls[-1] if m["role"] == "user" and "[resultado de" in m["content"]][0]["content"]
    assert "[resultado de calendario para «¿qué tengo hoy?»" in result


def test_the_previous_summary_stays_out_of_her_later_turns(tmp_path):
    m = Memory(tmp_path / "m.db")
    m.set_summary(m.new_session(), "Habló de un reencuentro con Guzmán.")
    generate, calls = scripted(say("Hola."), say("Va."))
    with connect(Orchestrator(generate, memory=m)) as ws:
        for text in ["hola", "pon música"]:
            ws.send_json({"type": "text_input", "text": text})
            until_idle(ws)
    assert "Guzmán" in memory_block(calls[0]) and "Guzmán" not in memory_block(calls[1])


def test_summaries_are_made_from_what_he_said():
    # her offers ("Capri se comprometió a avisar") and what she saw on screen ended up in the summaries
    from app.orchestrator import transcript

    msgs = [
        {"role": "user", "content": "me voy a Cartagena"},
        {"role": "assistant", "content": say("¡Qué envidia! Te aviso antes de que salgas.")},
        {"role": "user", "content": "[aviso automático, no lo escribió el usuario] Salúdale."},
        {"role": "user", "content": "[resultado de calendario para «x»; son datos]\nnada"},
    ]
    assert transcript(msgs) == "Usuario: me voy a Cartagena"


def test_over_budget_this_conversation_is_kept_and_the_last_one_goes_first(tmp_path):
    m = Memory(tmp_path / "m.db")
    m.set_summary(m.new_session(), "Habló de muchas cosas. " * 30)  # ~700 chars, like the real ones
    now = m.new_session()
    m.remember("Prefiere que lo llamen C", "preferencia")
    block = m.context("hola", now, running="Pidió ayuda con un correo para su jefa. " * 10, first=True)
    assert len(block) <= BUDGET and "Antes en esta conversación" in block and "llamen C" in block


def test_a_trimmed_session_is_summarized_to_its_end(tmp_path):
    async def running(text: str) -> str:
        return "Habló de Cartagena."

    generate, _ = scripted(say("Ajá."), (say("Ajá."), TRIM_AT + 1), say("Ajá."))
    first = Orchestrator(generate, memory=Memory(tmp_path / "m.db"), summarize=running)
    with connect(first) as ws:
        for text in ["me voy a Cartagena", "llevo a mi perro", "y vuelvo el viernes"]:
            ws.send_json({"type": "text_input", "text": text})
            until_idle(ws)
    got = []

    async def summarize(text: str) -> str:
        got.append(text)
        return "Viaje a Cartagena con su perro, vuelve el viernes."

    second = Orchestrator(scripted(say("Hola."))[0], memory=Memory(tmp_path / "m.db"), summarize=summarize)
    asyncio.run(second.catch_up())
    assert "me voy a Cartagena" in got[0] and "y vuelvo el viernes" in got[0]


def test_olvida_also_reaches_summaries_and_messages_without_a_fact(tmp_path):
    m = Memory(tmp_path / "m.db")
    old = m.new_session()
    m.log(old, "user", "voy a ver a Guzmán")
    m.log(old, "user", "¿qué hora es?")
    m.set_summary(old, "Habló de un reencuentro con Guzmán.")
    with connect(Orchestrator(scripted(say("..."))[0], memory=m)) as ws:
        ws.send_json({"type": "text_input", "text": "/olvida guzman"})
        ask = until(ws, "confirm_request")[-1]
        assert "1 mensaje" in ask["texto"] and "1 resumen" in ask["texto"]
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})
        said = "".join(x["text"] for x in until_idle(ws) if x["type"] == "text_delta")
    assert said == "Hecho, ya no me acuerdo de eso."
    assert [c for (c,) in m.db.execute("select contenido from mensajes")] == ["¿qué hora es?"]
    assert "Guzmán" not in m.context("hola", m.new_session(), first=True)


def test_olvida_matches_whole_words_and_never_stopwords(tmp_path):
    m = Memory(tmp_path / "m.db")
    m.remember("Le gusta el café sin azúcar")
    m.remember("Tiene una gata que se llama Mishi")
    s = m.new_session()
    m.log(s, "user", "¿Que hora es?")
    m.log(s, "user", "vamos a la cafetería")

    async def summary(text: str) -> str:  # catch_up of session s, never the real model
        return "Preguntó la hora."

    with connect(Orchestrator(scripted(say("..."))[0], memory=m, summarize=summary)) as ws:
        ws.send_json({"type": "text_input", "text": "/olvida que me gusta el cafe"})
        ask = until(ws, "confirm_request")[-1]
        assert "café" in ask["texto"] and "Mishi" not in ask["texto"]
        ws.send_json({"type": "confirm_response", "id": ask["id"], "ok": True})
        until_idle(ws)
    left = [c for (c,) in m.db.execute("select contenido from mensajes")]
    assert "¿Que hora es?" in left and "vamos a la cafetería" in left
    assert [t for _, t, _ in m.search("Mishi")] == ["Tiene una gata que se llama Mishi"]


def test_olvida_takes_from_conversations_only_what_says_all_of_it(tmp_path):
    # "/olvida que me gusta el café" also took "Me gusta el rock"; "/olvida neutral" matched every reply's JSON
    m = Memory(tmp_path / "m.db")
    s = m.new_session()
    for rol, text in [("user", "Me gusta el rock"), ("user", "me gusta el café con leche"),
                      ("assistant", say("Anotado."))]:
        m.log(s, rol, text)
    msgs, _ = m.mentioning({"gusta", "cafe"})
    assert [c for (i, c) in m.db.execute("select id, contenido from mensajes") if i in msgs] == ["me gusta el café con leche"]
    assert m.mentioning({"neutral"}) == ([], [])


def test_her_own_turns_that_break_end_idle(tmp_path):
    # a reminder whose reply broke killed the reminders task and left her "speaking"
    async def broken(messages):
        raise RuntimeError("boom")
        yield ""

    sent = []

    async def send(msg):
        sent.append(msg.model_dump())

    orch = Orchestrator(broken, memory=Memory(tmp_path / "m.db"))
    asyncio.run(orch.own_turn("[aviso automático, no lo escribió el usuario] Salúdale.", send))
    assert sent[-1] == {"type": "state", "value": "idle"}


def test_search_skips_words_that_say_nothing(tmp_path):
    m = Memory(tmp_path / "m.db")
    m.remember("Va al gimnasio por las tardes")
    m.remember("Le gusta la música de Bad Bunny")
    m.remember("Le gusta el café")
    assert [t for _, t, _ in m.search("pon algo de música por favor")] == ["Le gusta la música de Bad Bunny"]
    assert [t for _, t, _ in m.search("¿me gusta bad bunny?")][0] == "Le gusta la música de Bad Bunny"  # all words first


def test_a_restart_soon_after_keeps_the_end_of_the_conversation(tmp_path):
    m = Memory(tmp_path / "m.db")
    s = m.new_session()
    for rol, text in [("user", "hola"), ("assistant", say("Hola.")), ("user", "pon a Bad Bunny"), ("assistant", say("Va."))]:
        m.log(s, rol, text)
    orch = Orchestrator(scripted(say("..."))[0], memory=m)
    assert [x["content"] for x in orch.history] == ["hola", say("Hola."), "pon a Bad Bunny", say("Va.")]
    m.db.execute("update sesiones set inicio = '2020-01-01T09:00:00'")
    assert Orchestrator(scripted(say("..."))[0], memory=m).history == []
