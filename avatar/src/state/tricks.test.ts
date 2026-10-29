import assert from "node:assert/strict";
import { test } from "node:test";

import { GAP_MS, JUGGLE_CYCLE_MS, juggleOrbs, spinScale, Tricks, TRICK_MS } from "./tricks.ts";

test("a spin turns her all the way round and ends where it began, never vanishing edge-on", () => {
  assert.equal(spinScale(0), 1);
  assert.equal(spinScale(1), 1);
  assert.ok(spinScale(0.5) < -0.9, "back to the camera halfway");
  for (let i = 0; i <= 100; i++) assert.ok(Math.abs(spinScale(i / 100)) >= 0.1, `sliver left at ${i}`);
});

test("a spin goes in pixel steps, not smooth squeezing", () => {
  const seen = new Set<number>();
  for (let i = 0; i <= 200; i++) seen.add(spinScale(i / 200));
  assert.ok(seen.size <= 12, `${seen.size} different widths`);
});

test("three orbs, from hand to hand along arcs, repeating every cycle", () => {
  for (let ms = 0; ms < 2 * JUGGLE_CYCLE_MS; ms += 37) {
    const orbs = juggleOrbs(ms);
    assert.equal(orbs.length, 3);
    for (const o of orbs) assert.ok(o.x >= -1 && o.x <= 1 && o.y >= 0 && o.y <= 1, JSON.stringify(o));
    assert.equal(new Set(orbs.map((o) => `${o.x.toFixed(2)},${o.y.toFixed(2)}`)).size, 3, "never on top of each other");
    assert.deepEqual(juggleOrbs(ms + JUGGLE_CYCLE_MS).map((o) => o.y.toFixed(3)), orbs.map((o) => o.y.toFixed(3)));
  }
});

test("each orb is in a hand when it's at the bottom of its arc", () => {
  for (let ms = 0; ms < JUGGLE_CYCLE_MS; ms += 11) {
    for (const o of juggleOrbs(ms)) if (o.y < 0.02) assert.ok(Math.abs(o.x) > 0.9, `${o.x} at ${ms}`);
  }
});

test("a trick comes after a long quiet gap, never while she's busy", () => {
  const rand = () => 0.3;
  const t = new Tricks(0, rand);
  assert.equal(t.next(1000, true), null);
  assert.equal(t.next(GAP_MS[1] + 1, false), null, "busy: not now");
  const first = t.next(GAP_MS[1] + 2, true);
  assert.ok(first === "spin" || first === "juggle");
  assert.equal(t.next(GAP_MS[1] + 3, true), null, "one, then a new gap");
});

test("spins and juggling both come up, and the next gap starts after the trick is over", () => {
  let r = 0;
  const rand = () => (r = (r + 0.37) % 1);
  const t = new Tricks(0, rand);
  const seen = new Set<string>();
  let now = 0;
  for (let i = 0; i < 40; i++) {
    now += GAP_MS[1] + 1;
    const n = t.next(now, true);
    if (n) {
      seen.add(n);
      now += TRICK_MS[n];
    }
  }
  assert.deepEqual([...seen].sort(), ["juggle", "spin"]);
});
