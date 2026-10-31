import assert from "node:assert/strict";
import { test } from "node:test";

import { clock, progress, SEGMENTS } from "./player.ts";

test("clock shows minutes and seconds, and hours only when needed", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(82.9), "1:22");
  assert.equal(clock(3725), "1:02:05");
  assert.equal(clock(-3), "0:00");
});

test("progress moves with the time while it plays and stops when paused", () => {
  const t = { posicion: 60, duracion: 120, sonando: true };
  assert.equal(progress(t, 0), 60);
  assert.equal(progress(t, 30), 90);
  assert.equal(progress(t, 500), 120); // never past the end
  assert.equal(progress({ ...t, sonando: false }, 30), 60);
});

test("a live stream has no bar", () => {
  assert.equal(progress({ posicion: 5, duracion: 0, sonando: true }, 10), 0);
  assert.equal(SEGMENTS > 0, true);
});
