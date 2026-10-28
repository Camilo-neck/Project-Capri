import assert from "node:assert/strict";
import { test } from "node:test";

import { celAt, cuesBetween, END, LAND, lookAt, openAt, phaseAt, stillAlpha, STILL_LAND, T } from "./intro.ts";

const frames = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

test("the phases come in order and end with her landed", () => {
  const order = ["edges", "hands", "reach", "hit", "hold", "slip", "antic", "dive", "slit", "done"];
  const seen = frames(0, END + 3).map(phaseAt).filter((p, i, a) => p !== a[i - 1]);
  assert.deepEqual(seen, order);
  assert.equal(phaseAt(LAND), "slit");
});

test("she says hi with her mouth: ajar, wide, half, ajar, then shut", () => {
  const mouth = frames(T.hi, T.hi + 12).map(celAt);
  assert.deepEqual([...new Set(mouth)], ["mouth1", "mouth3", "mouth2", "grab"]);
});

test("the wave: a smear off the edge, her hand tilting, a smear back, then her eyes shut with joy", () => {
  assert.equal(celAt(T.wave), "smear");
  const waving = new Set(frames(T.wave + 2, T.regrab).map(celAt));
  assert.deepEqual([...waving].sort(), ["wave1", "wave2", "wave3"]);
  assert.equal(celAt(T.regrab), "smear");
  assert.equal(celAt(T.happy), "happy");
  assert.equal(celAt(T.glance), "grab");
});

test("her eyes: around the room, one blink, then toward where she's going", () => {
  assert.notDeepEqual(lookAt(T.hold + 4, 1, 1), lookAt(T.hold + 8, 1, 1));
  assert.deepEqual(frames(T.blink - 1, T.blink + 5).map(openAt), [1, 0.5, 0, 0, 0.5, 1]);
  assert.deepEqual(lookAt(T.glance, -1, 1), { x: -10, y: 7 });
});

test("each cue fires once, in order, however the frames are split", () => {
  const whole = cuesBetween(-1, END, false);
  let split: string[] = [];
  for (let f = -1; f < END; f += 7) split = split.concat(cuesBetween(f, Math.min(f + 7, END), false));
  assert.deepEqual(split, whole);
  for (const c of ["open", "grab", "hi", "wave", "slip", "land"]) assert.equal(whole.filter((x) => x === c).length, 1, c);
  assert.equal(whole.filter((x) => x === "hand").length, 3);
  assert.ok(whole.indexOf("grab") < whole.indexOf("hi") && whole.indexOf("slip") < whole.indexOf("land"));
});

test("without animations she only fades in and out where she is, and lands sooner", () => {
  assert.ok(stillAlpha(0) > 0 && stillAlpha(0) < 1);
  assert.equal(stillAlpha(T.hi), 1);
  assert.equal(stillAlpha(STILL_LAND), 0);
  const cues = cuesBetween(-1, END, true);
  assert.ok(cues.includes("land") && !cues.includes("hand"));
  assert.ok(STILL_LAND < LAND);
});
