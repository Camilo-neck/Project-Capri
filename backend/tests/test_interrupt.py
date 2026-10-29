import asyncio
import json

from app.memory import Memory
from app.orchestrator import Orchestrator
from app.protocol import State, TextDelta, UtteranceEnd


def talker():
    """A reply that starts and then never ends: she's mid-sentence when he cuts in."""

    async def generate(messages):
        yield '{"emocion":"feliz","gesto":"ninguno","accion":null,"texto":"Hola, te iba a contar que'
        await asyncio.Event().wait()

    return generate


async def mid_sentence(orch, sent):
    async def send(m):
        sent.append(m)

    async def turn():
        async with orch.lock:
            orch.current = asyncio.current_task()
            await orch.turn("hola", send)

    task = asyncio.create_task(turn())
    while not any(isinstance(m, TextDelta) for m in sent):
        await asyncio.sleep(0.01)
    return task


def test_interrupting_her_stops_the_turn_where_she_was():
    async def run():
        orch, sent = Orchestrator(talker(), memory=Memory(":memory:")), []
        task = await mid_sentence(orch, sent)
        assert orch.interrupt()
        await asyncio.gather(task, return_exceptions=True)
        assert task.cancelled()
        last = json.loads(orch.history[-1]["content"])
        assert orch.history[-1]["role"] == "assistant" and last["texto"].endswith("—")
        assert last["texto"].startswith("Hola, te iba a contar")
        assert sent[-2:] == [UtteranceEnd(cortada=True), State(value="idle")]
        assert not orch.lock.locked()  # the next turn runs

    asyncio.run(run())


def test_nothing_to_interrupt():
    orch = Orchestrator(talker(), memory=Memory(":memory:"))
    assert not orch.interrupt()


def test_a_confirmation_waiting_on_his_click_is_not_interrupted():
    async def run():
        orch, sent = Orchestrator(talker(), memory=Memory(":memory:")), []
        task = await mid_sentence(orch, sent)
        fut = asyncio.get_running_loop().create_future()
        orch.pending["x"] = fut
        assert not orch.interrupt()  # the voice never answers a confirmation
        assert not task.done()
        orch.confirm("x", True)
        assert fut.result() is True
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    asyncio.run(run())



def test_trimming_the_context_after_her_reply_cant_be_interrupted():
    async def run():
        async def generate(messages):
            yield '{"emocion":"feliz","gesto":"ninguno","accion":null,"texto":"Listo."}'

        orch, sent, during = Orchestrator(generate, memory=Memory(":memory:")), [], []

        async def trim():
            during.append(orch.interrupt())

        orch.trim = trim
        orch.ctx = 10_000

        async def send(m):
            sent.append(m)

        async def turn():
            async with orch.lock:
                orch.current = asyncio.current_task()
                await orch.turn("hola", send)

        await asyncio.create_task(turn())
        assert during == [False]

    asyncio.run(run())


def test_her_own_turns_can_be_cut_too_without_ending_her_reminders():
    async def run():
        orch, sent = Orchestrator(talker(), memory=Memory(":memory:")), []

        async def send(m):
            sent.append(m)

        async def reminders():  # what reminders()/chatter() do: take the lock and speak on her own
            async with orch.lock:
                await orch.own_turn("[aviso] hola", send)
            return "still alive"

        task = asyncio.create_task(reminders())
        while not any(isinstance(m, TextDelta) for m in sent):
            await asyncio.sleep(0.01)
        assert orch.interrupt()
        assert await asyncio.wait_for(task, 2) == "still alive"
        assert sent[-2:] == [UtteranceEnd(cortada=True), State(value="idle")]

    asyncio.run(run())


def test_cutting_a_tool_call_still_closes_its_action():
    import threading

    from app import tools
    from app.protocol import Action
    from app.schema import Accion

    async def run():
        gate = threading.Event()
        orch, sent = Orchestrator(talker(), memory=Memory(":memory:")), []
        real = tools.TOOLS["leer_portapapeles"]
        slow = type(real)(**{**real.__dict__, "run": lambda a, s: gate.wait(2)}) if hasattr(real, "__dict__") else None
        assert slow is not None

        async def send(m):
            sent.append(m)

        tools.TOOLS["leer_portapapeles"] = slow
        try:
            task = asyncio.create_task(orch.act(Accion(nombre="leer_portapapeles", args={}), send))
            while not any(isinstance(m, Action) for m in sent):
                await asyncio.sleep(0.01)
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            gate.set()
            assert [m.fase for m in sent if isinstance(m, Action)] == ["inicio", "fin"]
            assert sent[-1].ok is False
        finally:
            tools.TOOLS["leer_portapapeles"] = real

    asyncio.run(run())
