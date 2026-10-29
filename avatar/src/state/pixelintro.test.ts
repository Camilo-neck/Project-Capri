import assert from "node:assert/strict";
import { test } from "node:test";

import { captionChars, cuesBetween, dive, END, phaseAt, rise, T } from "./pixelintro.ts";

test("the phases follow one another in order and end", () => {
  const seen: string[] = [];
  for (let ms = 0; ms <= END + 50; ms += 10) {
    const p = phaseAt(ms);
    if (seen[seen.length - 1] !== p) seen.push(p);
  }
  assert.deepEqual(seen, ["edges", "rise", "hold", "antic", "dive", "done"]);
});

test("she rises from below the screen to her place and stays", () => {
  assert.equal(rise(0), 0);
  assert.equal(rise(T.rise[0]), 0);
  assert.equal(rise(T.rise[1]), 1);
  assert.equal(rise(T.hold[0] + 500), 1);
  let last = 0;
  for (let ms = T.rise[0]; ms <= T.rise[1]; ms += 5) {
    const r = rise(ms);
    assert.ok(r >= last, "never goes back down");
    last = r;
  }
});

test("the dive to her spot starts at 0, ends at 1 and only goes forward", () => {
  assert.equal(dive(T.dive[0] - 1), 0);
  assert.equal(dive(T.dive[1]), 1);
  assert.equal(dive(END + 500), 1);
  let last = 0;
  for (let ms = T.dive[0]; ms <= T.dive[1]; ms += 5) {
    const d = dive(ms);
    assert.ok(d >= last);
    last = d;
  }
});

test("each cue happens once, however the frames come", () => {
  const all = cuesBetween(-1, END + 100);
  assert.deepEqual(all, ["open", "crackle", "hi", "slip", "land"]);
  const split = [...cuesBetween(-1, 700), ...cuesBetween(700, 2000), ...cuesBetween(2000, END + 100)];
  assert.deepEqual(split, all);
});

test("the caption types itself in after her tag and never shrinks", () => {
  assert.equal(captionChars(0, 20), 0);
  assert.equal(captionChars(T.caption, 20), 0);
  assert.ok(captionChars(T.caption + 400, 20) > 0);
  assert.equal(captionChars(T.caption + 60_000, 20), 20);
  let last = 0;
  for (let ms = 0; ms < 4000; ms += 17) {
    const n = captionChars(ms, 20);
    assert.ok(n >= last);
    last = n;
  }
});
