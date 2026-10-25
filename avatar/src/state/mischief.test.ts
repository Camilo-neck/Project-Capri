import assert from "node:assert/strict";
import { test } from "node:test";

import { Mischief, peekPose, pickEdge, shy, ZAP_GAP_MS, ZAP_NEAR } from "./mischief.ts";

test("she zaps the pointer only when it's near (not on her), idle, and not again for a long while", () => {
  const m = new Mischief(0, () => 0); // gap = the minimum, every roll a yes
  const ready = ZAP_GAP_MS[0];
  assert.equal(m.zap(ready - 1, 100, true), false); // too soon
  assert.equal(m.zap(ready, ZAP_NEAR[0] - 1, true), false); // on her
  assert.equal(m.zap(ready, ZAP_NEAR[1] + 1, true), false); // far
  assert.equal(m.zap(ready, 100, false), false); // busy talking
  assert.equal(m.zap(ready, 100, true), true);
  assert.equal(m.zap(ready + 1000, 100, true), false);
  assert.equal(m.zap(ready * 2, 100, true), true);
});

test("a missed roll tries again soon instead of waiting the whole gap", () => {
  const rolls = [0, 0, 0.99]; // first gap, then: gap, the chance roll fails
  const m = new Mischief(0, () => rolls.shift() ?? 0);
  assert.equal(m.zap(ZAP_GAP_MS[0], 100, true), false);
  assert.equal(m.zap(ZAP_GAP_MS[0] * 1.2, 100, true), true); // retried after 15% of a gap
});

test("peeking: half off a side leaning in (mirrored on the right), or upside down from the top", () => {
  const l = peekPose("left", 2560, 1440, 0.5);
  assert.ok(l.cx < 20 && l.rot > 0 && !l.flip && l.cy > 400 && l.cy < 1040);
  const r = peekPose("right", 2560, 1440, 0);
  assert.ok(r.cx > 2540 && r.rot < 0 && r.flip);
  const t = peekPose("top", 2560, 1440, 1);
  assert.equal(t.rot, 180);
  assert.ok(t.cy < 100 && t.cx <= 2560 * 0.8);
  for (let i = 0; i < 20; i++) assert.notEqual(pickEdge(Math.random, "top"), "top");
});

test("shy: the pointer close to where she peeks scares her off", () => {
  const p = peekPose("left", 2560, 1440, 0.5);
  assert.ok(shy(p, [p.cx + 100, p.cy]));
  assert.ok(!shy(p, [p.cx + 400, p.cy]));
  assert.ok(!shy(p, null));
});
