import assert from "node:assert/strict";
import { test } from "node:test";

import { CameraPlayer, EMOTION_SHOT, PUSH, PUSH_MS, SHOTS, shotFor, tagFor, type Scene } from "./camera.ts";

const scene = (over: Partial<Scene> = {}): Scene => ({
  status: "idle", emocion: "neutral", talking: false, listening: false, confirming: false, asleep: false, voice: "off", ...over,
});

test("the shot follows what she's doing, and her mood while she talks", () => {
  assert.equal(shotFor(scene()), "escucha");
  assert.equal(shotFor(scene({ status: "thinking" })), "piensa");
  assert.equal(shotFor(scene({ status: "looking" })), "ojos");
  assert.equal(shotFor(scene({ status: "speaking", emocion: "feliz" })), "risa");
  assert.equal(shotFor(scene({ talking: true, emocion: "traviesa" })), "sonrisa"); // just done: still in the mood
  assert.equal(shotFor(scene({ status: "speaking", confirming: true })), "muchos");
  assert.equal(shotFor(scene({ status: "down" })), null);
  assert.equal(shotFor(scene({ asleep: true })), null);
  for (const shot of Object.values(EMOTION_SHOT)) assert.ok(shot in SHOTS);
});

test("the tag says what she's doing", () => {
  assert.equal(tagFor(scene()), "EN LÍNEA");
  assert.equal(tagFor(scene({ listening: true })), "ESCUCHANDO");
  assert.equal(tagFor(scene({ status: "speaking" })), "TRANSMITIENDO");
  assert.equal(tagFor(scene({ status: "down" })), "SIN SEÑAL");
  assert.equal(tagFor(scene({ asleep: true })), "EN REPOSO");
});

test("with the microphone open the tag says how she's listening", () => {
  assert.equal(tagFor(scene({ voice: "idle" })), "ESCUCHANDO");
  assert.equal(tagFor(scene({ voice: "hearing" })), "OYÉNDOTE");
  assert.equal(tagFor(scene({ voice: "listening" })), "TE ESCUCHO");
  assert.equal(tagFor(scene({ voice: "hearing", status: "speaking" })), "TRANSMITIENDO");
  assert.equal(tagFor(scene({ voice: "hearing", confirming: true })), "ESPERA TU OK");
});

test("shots play forth and back without jumps, and only a new target is a cut", () => {
  const p = new CameraPlayer();
  assert.equal(p.want("escucha", 0), true);
  assert.equal(p.want("escucha", 500), false);
  const fps = SHOTS.escucha.fps;
  let prev = p.frame(0)!.index;
  for (let k = 1; k < 60; k++) {
    const i = p.frame((k * 1000) / fps + 1)!.index;
    assert.ok(Math.abs(i - prev) <= 1);
    prev = i;
  }
});

test("a lead-in turns to the camera, then holds the look without a cut", () => {
  const p = new CameraPlayer();
  p.want("gira", 0);
  const lead = (SHOTS.gira.frames / SHOTS.gira.fps) * 1000;
  assert.deepEqual([p.frame(0)!.shot, p.frame(0)!.index], ["gira", 0]);
  assert.equal(p.frame(lead - 1)!.index, SHOTS.gira.frames - 1);
  assert.equal(p.frame(lead + 1)!.shot, "mira");
  assert.equal(p.want("gira", lead + 2), false); // still the same target
});

test("the camera pushes in slowly and stops", () => {
  const p = new CameraPlayer();
  p.want("mira", 0);
  assert.equal(p.frame(0)!.zoom, 1);
  const half = p.frame(PUSH_MS / 2)!.zoom;
  assert.ok(half > 1 + PUSH / 2 && half < 1 + PUSH);
  assert.equal(p.frame(PUSH_MS * 3)!.zoom, 1 + PUSH);
  assert.equal(new CameraPlayer().frame(0), null);
});
