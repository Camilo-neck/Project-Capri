import assert from "node:assert/strict";
import { test } from "node:test";

import { ClipPlayer, CLIPS, clipDuration, EXIT_SPEED, gestureFrame, SPRITE_FOR } from "./clips.ts";

const sit = clipDuration(CLIPS.sentarse);
const standUp = sit / EXIT_SPEED;

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

test("standing up before a standing clip: reversed sit-down, then the new loop", () => {
  const p = new ClipPlayer();
  p.update("sentada", 0);
  p.update("feliz", 10_000);
  assert.deepEqual(p.frame(10_000), { clip: "sentarse", index: CLIPS.sentarse.frames - 1 });
  assert.equal(p.frame(10_000 + standUp + 1)!.clip, "feliz");
  p.update("hablar", 20_000); // same (standing) family: straight to the loop
  assert.equal(p.frame(20_000)!.clip, "hablar");
});

/** Runs fn with a behavior's clips removed, as if its art had not arrived yet. */
function withoutClips(b: keyof typeof SPRITE_FOR, fn: () => void): void {
  const saved = SPRITE_FOR[b];
  delete SPRITE_FOR[b];
  try {
    fn();
  } finally {
    SPRITE_FOR[b] = saved;
  }
}

test("leaving for a behavior without clips: reversed sit-down, then the code-drawn pet", () =>
  withoutClips("escribir", () => {
    const p = new ClipPlayer();
    p.update("sentada", 0);
    p.update("escribir", 10_000);
    assert.deepEqual(p.frame(10_000), { clip: "sentarse", index: CLIPS.sentarse.frames - 1 });
    assert.equal(p.frame(10_000 + standUp - 1)!.index, 0);
    assert.equal(p.frame(10_000 + standUp + 1), null);
  }));

test("transition chains: sitting -> typing opens the laptop; typing -> talking closes it and stands up", () => {
  const p = new ClipPlayer();
  const open = clipDuration(CLIPS.abrir_portatil);
  p.update("sentada", 0);
  p.update("escribir", 10_000);
  assert.deepEqual(p.frame(10_000), { clip: "abrir_portatil", index: 0 });
  assert.equal(p.frame(10_000 + open)!.clip, "escribir");
  p.update("hablar", 20_000);
  assert.deepEqual(p.frame(20_000), { clip: "abrir_portatil", index: CLIPS.abrir_portatil.frames - 1 });
  assert.equal(p.frame(20_000 + open / EXIT_SPEED + 1)!.clip, "sentarse");
  assert.equal(p.frame(20_000 + (open + sit) / EXIT_SPEED + 1)!.clip, "hablar");
});

test("gestures play over standing loops only", () => {
  const standing = { clip: "feliz", index: 3 };
  assert.deepEqual(gestureFrame("saltar", 0.5, standing, "feliz"), { clip: "saltar", index: 4 });
  assert.equal(gestureFrame("saltar", 0.5, { clip: "sentada_idle", index: 0 }, "sentada"), null);
  assert.equal(gestureFrame("ninguno", 0.5, standing, "feliz"), null);
  assert.equal(gestureFrame("saltar", 0.5, null, "feliz"), null);
});

test("mouse reactions skip transitions", () => {
  const p = new ClipPlayer();
  p.update("feliz", 0); // standing
  p.update("pinchada", 5_000); // sitting reaction: no sit-down first
  assert.equal(p.frame(5_000)!.clip, "pinchada");
});

test("behaviors without clips never show one", () =>
  withoutClips("escribir", () => {
    const p = new ClipPlayer();
    p.update("escribir", 0);
    assert.equal(p.frame(0), null);
  }));
