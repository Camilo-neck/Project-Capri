import assert from "node:assert/strict";
import { test } from "node:test";

import { ClipPlayer, CLIPS, clipDuration, EXIT_SPEED, gestureFrame, mouthCell, ORIGINAL_CLIPS, PERCHED, SPRITE_FOR } from "./clips.ts";

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

const O = ORIGINAL_CLIPS;
const at = (clip: string, k: number) => (k * 1000) / O[clip].fps + 1; // ms into frame k of a clip

test("original: every behavior has the show's clips", () => {
  const p = new ClipPlayer("original");
  for (const b of ["sentada", "escribir", "hablar", "triste", "dormir", "pinchada", "acariciada"] as const) {
    p.update(b, 0);
    assert.notEqual(p.frame(100_000), null, b);
  }
});

test("original: falling asleep glitches into the sleep loop; waking plays the boot glitch forward", () => {
  const p = new ClipPlayer("original");
  p.update("sentada", 0);
  p.update("dormir", 1000);
  assert.equal(p.frame(1000)!.clip, "glitch");
  assert.equal(p.frame(1000 + clipDuration(O.glitch) + 1)!.clip, "sleep");
  p.update("hablar", 60_000);
  assert.deepEqual(p.frame(60_000), { clip: "wake", index: 0 });
  assert.equal(p.frame(60_000 + clipDuration(O.wake) - 1)!.index, O.wake.frames - 1);
  assert.equal(p.frame(60_000 + clipDuration(O.wake) + 1)!.clip, "idle");
});

test("original: the greeting after sleep wakes her once", () => {
  const p = new ClipPlayer("original");
  p.update("dormir", 0);
  p.update("saludar", 60_000);
  assert.equal(p.frame(60_000)!.clip, "wake");
  assert.equal(p.frame(60_000 + clipDuration(O.wake) + 1)!.clip, "idle");
});

test("original: a cheeky reply grins first; the next emotion with a grin doesn't repeat it", () => {
  const p = new ClipPlayer("original");
  p.update("sentada", 0);
  p.update("traviesa", 1000);
  assert.deepEqual(p.frame(1000), { clip: "sonrisa", index: 0 });
  assert.equal(p.frame(1000 + clipDuration(O.sonrisa) + 1)!.clip, "idle");
  p.update("feliz", 10_000);
  assert.equal(p.frame(10_000)!.clip, "idle");
  p.update("sentada", 20_000); // calming down: straight back, no grin backwards
  assert.equal(p.frame(20_000)!.clip, "idle");
});

test("original: idle blinks on some cycles, a few of them glitched, and never mid-cell", () => {
  const p = new ClipPlayer("original");
  p.update("sentada", 0);
  const cycle = clipDuration(O.idle);
  const seen = new Set<string>();
  for (let c = 0; c < 40; c++) {
    for (let k = 0; k < O.idle.frames; k++) {
      const f = p.frame(c * cycle + at("idle", k))!;
      if (k < 9 || k >= 13) assert.deepEqual(f, { clip: "idle", index: k });
      else {
        seen.add(f.clip);
        assert.equal(f.index, f.clip === "idle" ? k : k - 9);
      }
    }
  }
  assert.deepEqual([...seen].sort(), ["blink", "blink_glitch", "idle"]);
});

test("original: perched twins have the same length, and only idle takes the talking jaw", () => {
  for (const [stand, sit] of Object.entries(PERCHED)) assert.equal(O[stand].frames, O[sit].frames, stand);
  assert.equal(mouthCell("A", { clip: "idle", index: 3 }), 3);
  assert.equal(mouthCell("closed", { clip: "idle", index: 3 }), 0);
  assert.equal(mouthCell(null, { clip: "idle", index: 3 }), null);
  assert.equal(mouthCell("A", { clip: "blink", index: 0 }), null);
  assert.equal(gestureFrame("saltar", 0.5, { clip: "idle", index: 0 }, "feliz", "original"), null);
});
