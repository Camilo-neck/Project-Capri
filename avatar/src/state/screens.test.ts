import assert from "node:assert/strict";
import { test } from "node:test";

import { Follow, FOLLOW_MS, sideOf } from "./screens.ts";

test("she follows once the pointer has stayed on another screen a few seconds", () => {
  const f = new Follow();
  assert.equal(f.tick(1, 0, 0), false);
  assert.equal(f.tick(1, 0, FOLLOW_MS - 1), false);
  assert.equal(f.tick(1, 0, FOLLOW_MS), true);
  assert.equal(f.tick(0, 0, FOLLOW_MS + 10), false); // she's there now (or it came back): the count starts over
});

test("a quick pass over another screen doesn't move her", () => {
  const f = new Follow();
  f.tick(1, 0, 0);
  f.tick(0, 0, 1000);
  assert.equal(f.tick(1, 0, 2000), false);
  assert.equal(f.tick(1, 0, 2000 + FOLLOW_MS), true);
});

test("which side another screen touches hers on, if any", () => {
  const main = { x: 0, y: 0, w: 1920, h: 1080 };
  assert.equal(sideOf(main, { x: 1920, y: 0, w: 2560, h: 1440 }), "right");
  assert.equal(sideOf(main, { x: -1280, y: 200, w: 1280, h: 1024 }), "left");
  assert.equal(sideOf(main, { x: 0, y: -1080, w: 1920, h: 1080 }), "top");
  assert.equal(sideOf(main, { x: 1920, y: 1080, w: 1920, h: 1080 }), null); // only a corner touches
  assert.equal(sideOf(main, { x: 4000, y: 0, w: 1920, h: 1080 }), null); // not next to it
});
