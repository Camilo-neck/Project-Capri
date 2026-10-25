import assert from "node:assert/strict";
import { test } from "node:test";

import { AvatarState, GESTURE_MS, GLITCH_MS, POSE_MS } from "./avatar.ts";
import { mouthFor, Typewriter } from "./text.ts";

test("mouth follows vowels and closes on punctuation", () => {
  assert.equal(mouthFor("a"), "A");
  assert.equal(mouthFor("Á"), "A");
  assert.equal(mouthFor("é"), "E");
  assert.equal(mouthFor("i"), "E");
  assert.equal(mouthFor("ó"), "O");
  assert.equal(mouthFor("ü"), "O");
  for (const p of [".", ",", "?", "¿", "!", "¡", "…", " "]) assert.equal(mouthFor(p), "closed");
  assert.equal(mouthFor("t"), null);
  assert.equal(mouthFor("ñ"), null);
});

test("typewriter reveals at its rate without splitting emoji", () => {
  const tw = new Typewriter(50);
  tw.push("hola 😺 mundo");
  assert.equal(tw.tick(10), ""); // 0.5 chars
  assert.equal(tw.tick(10), "h"); // 1 char
  assert.equal(tw.tick(100), "ola 😺"); // 5 chars, emoji counts as one
  assert.equal(tw.tick(10_000), " mundo");
  assert.equal(tw.pending, false);
  assert.equal(tw.tick(1000), "");
  tw.push("x");
  assert.equal(tw.tick(20), "x"); // idle time does not bank budget
});

test("emotion change flashes glitch then settles", () => {
  const s = new AvatarState(0, () => 1);
  s.setEmotion("feliz", 1000);
  assert.ok(s.pose(1000).glitch > 0.9);
  assert.equal(s.pose(1000 + GLITCH_MS).glitch, 0);
  s.setEmotion("feliz", 2000); // same emotion: no flash
  assert.equal(s.pose(2000).glitch, 0);
});

test("gestures play once and return to idle", () => {
  const s = new AvatarState(0, () => 1);
  s.playGesture("saltar", 0);
  const mid = s.pose(GESTURE_MS.saltar / 2);
  assert.equal(mid.gesto, "saltar");
  assert.ok(mid.gestureT > 0 && mid.gestureT < 1);
  assert.equal(s.pose(GESTURE_MS.saltar + POSE_MS).gesto, "ninguno");
});

test("poses change at 12 fps and blinks happen every 2-6 s", () => {
  const s = new AvatarState(0, () => 0); // blink gap = 2000 ms
  assert.equal(s.pose(10).frame, s.pose(POSE_MS - 1).frame);
  assert.notEqual(s.pose(POSE_MS - 1).frame, s.pose(POSE_MS).frame);
  assert.equal(s.pose(1999).blinking, false);
  assert.equal(s.pose(2000).blinking, true);
  assert.equal(s.pose(2200).blinking, false);
  assert.equal(s.pose(4000).blinking, true);
});
