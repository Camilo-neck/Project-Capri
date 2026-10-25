import assert from "node:assert/strict";
import { test } from "node:test";

import { Doze, DOZE_OUT_MS, LAND_MS, PEEK, sleepy, STIR, WAKE_MS } from "./doze.ts";

const MIN = 60_000;

test("she sleeps only after the limit without using the PC and without talking to her", () => {
  assert.equal(sleepy(20 * MIN, 20 * MIN, 20 * MIN), true);
  assert.equal(sleepy(20 * MIN, 25 * MIN, 5 * MIN), false); // you're at the PC
  assert.equal(sleepy(20 * MIN, 5 * MIN, 25 * MIN), false); // she just talked
  assert.equal(sleepy(0, 99 * MIN, 99 * MIN), false); // 0 = never
});

test("comes apart, then the mask lands as one white drawing, eyes shut", () => {
  const d = new Doze(() => 0.5);
  d.start(0);
  assert.equal(d.tick(DOZE_OUT_MS - 1), "dozing");
  assert.equal(d.tick(DOZE_OUT_MS), "mask");
  assert.ok(d.landing(DOZE_OUT_MS + LAND_MS - 1));
  assert.ok(!d.landing(DOZE_OUT_MS + LAND_MS));
  assert.deepEqual(d.eyes(DOZE_OUT_MS + 1000, false), [0, 0]);
});

test("now and then she cracks one eye open, briefly", () => {
  const d = new Doze(() => 0.5);
  d.start(0);
  d.tick(DOZE_OUT_MS);
  const seen: string[] = [];
  for (let t = DOZE_OUT_MS; t < DOZE_OUT_MS + 60_000; t += 100) seen.push(d.eyes(t, false).join());
  const peeks = seen.filter((e) => e !== "0,0");
  assert.ok(peeks.length > 0 && peeks.length < seen.length * 0.2, `${peeks.length}/${seen.length}`);
  assert.ok(peeks.every((e) => e === `0,${PEEK}` || e === `${PEEK},0`));
});

test("a pointer close stirs her; waking snaps both eyes open, then she's back", () => {
  const d = new Doze(() => 0.5);
  d.start(0);
  d.tick(DOZE_OUT_MS);
  assert.deepEqual(d.eyes(2000, true), [STIR, STIR]);
  d.wake(3000);
  assert.equal(d.tick(3000), "waking");
  assert.deepEqual(d.eyes(3100, false), [1, 1]);
  assert.equal(d.tick(3000 + WAKE_MS), "awake");
  assert.ok(!d.asleep);
});

test("woken while still coming apart, she just stops; awake, wake does nothing", () => {
  const d = new Doze(() => 0.5);
  d.wake(0);
  assert.equal(d.phase, "awake");
  d.start(0);
  d.wake(100);
  assert.equal(d.tick(DOZE_OUT_MS + 1), "awake");
});
