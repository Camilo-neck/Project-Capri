import assert from "node:assert/strict";
import { test } from "node:test";

import { JUMP_MS, resumeLine, ResumeWatch, TICK_MS } from "./resume.ts";

test("normal ticks are silent; a big jump reports how long she was away", () => {
  const w = new ResumeWatch(0);
  assert.equal(w.tick(TICK_MS), 0);
  assert.equal(w.tick(TICK_MS * 2 + 1500), 0); // a slow frame
  const prev = TICK_MS * 2 + 1500;
  const t = prev + JUMP_MS + 5;
  assert.equal(w.tick(t), JUMP_MS + 5);
  assert.equal(w.tick(t + TICK_MS), 0); // and it re-arms
});

test("a short nap and a long one get different lines", () => {
  const short = resumeLine(60_000, () => 0);
  const long = resumeLine(3 * 3_600_000, () => 0);
  assert.notEqual(short.texto, long.texto);
  assert.equal(long.emocion, "sorprendida");
});
