import assert from "node:assert/strict";
import { test } from "node:test";

import { GAP_MS, KINDS, RECIPES, gain, length } from "./sfxrecipes.ts";

test("every kind has a recipe with sensible tones", () => {
  for (const kind of KINDS) {
    const r = RECIPES[kind];
    assert.ok(r.tones.length + (r.noise?.length ?? 0) > 0, kind);
    for (const t of r.tones) {
      assert.ok(t.f0 > 20 && t.f0 < 12000 && t.f1 > 20 && t.f1 < 12000, `${kind} frequency`);
      assert.ok(t.ms > 0 && t.at >= 0 && t.gain > 0 && t.gain <= 0.5, `${kind} tone timing or gain`);
    }
    for (const n of r.noise ?? []) assert.ok(n.ms > 0 && n.at >= 0 && n.gain > 0 && n.gain <= 0.5 && n.high > 100, `${kind} noise`);
  }
});

test("no effect runs longer than a second and a half", () => {
  for (const kind of KINDS) assert.ok(length(RECIPES[kind]) <= 1500, kind);
});

test("every kind has a minimum gap, and the typing tick is the most frequent", () => {
  for (const kind of KINDS) assert.ok(GAP_MS[kind] >= 0, kind);
  assert.ok(GAP_MS.tick > 0 && GAP_MS.tick < GAP_MS.blip);
});

test("gain follows the volume, is silent at zero and never goes over the ceiling", () => {
  assert.equal(gain(0), 0);
  assert.ok(gain(50) > 0 && gain(50) < gain(100));
  assert.ok(gain(100) <= 0.5);
  assert.equal(gain(500), gain(100));
  assert.equal(gain(-5), 0);
});
