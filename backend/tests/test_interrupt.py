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
