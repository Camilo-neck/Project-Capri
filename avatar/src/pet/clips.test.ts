import assert from "node:assert/strict";
import { test } from "node:test";

import { ClipPlayer, CLIPS, clipDuration } from "./clips.ts";

const sit = clipDuration(CLIPS.sentarse);

test("arriving at a clip behavior plays the enter clip once, then loops", () => {
  const p = new ClipPlayer();
  p.update("sentada", 0);
  assert.deepEqual(p.frame(0), { clip: "sentarse", index: 0 });
  assert.equal(p.frame(sit - 1)!.index, CLIPS.sentarse.frames - 1);
  assert.deepEqual(p.frame(sit), { clip: "sentada_idle", index: 0 });
});

test("pingpong loops go forth and back without jumping", () => {
  const p = new ClipPlayer();
  p.update("sentada", 0);
  const fps = CLIPS.sentada_idle.fps;
  const seq: number[] = [];
  for (let k = 0; k < 2 * CLIPS.sentada_idle.frames + 2; k++) seq.push(p.frame(sit + (k * 1000) / fps + 1)!.index);
  for (let k = 1; k < seq.length; k++) assert.ok(Math.abs(seq[k] - seq[k - 1]) <= 1, seq.join(","));
  assert.ok(seq.includes(CLIPS.sentada_idle.frames - 1));
});

test("leaving plays the enter clip reversed, then hands back to the code-drawn pet", () => {
  const p = new ClipPlayer();
  p.update("sentada", 0);
  p.update("feliz", 10_000);
  assert.deepEqual(p.frame(10_000), { clip: "sentarse", index: CLIPS.sentarse.frames - 1 });
  assert.equal(p.frame(10_000 + sit - 1)!.index, 0);
  assert.equal(p.frame(10_000 + sit), null);
});

test("mouse reactions leave the clip instantly", () => {
  const p = new ClipPlayer();
  p.update("sentada", 0);
  p.update("pinchada", 5_000);
  assert.equal(p.frame(5_000), null);
});

test("behaviors without clips never show one", () => {
  const p = new ClipPlayer();
  p.update("escribir", 0);
  assert.equal(p.frame(0), null);
});
