import assert from "node:assert/strict";
import { test } from "node:test";

import { AvatarState, GESTURE_MS, POSE_MS } from "./avatar.ts";
import { GLITCH_MS, GlitchFx, OFF, VANISH_OUT_MS } from "./glitch.ts";
import { mouthFor, Typewriter } from "./text.ts";
import { DOZE_OUT_MS } from "./doze.ts";

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

test("setEmotion reports changes only", () => {
  const s = new AvatarState(0, () => 1);
  assert.equal(s.setEmotion("feliz"), true);
  assert.equal(s.setEmotion("feliz"), false);
});

test("glitch effects play once; poke and hurt open with a silhouette frame", () => {
  const fx = new GlitchFx(0, () => 1); // twitch gap = 13 s
  fx.kick("change", 1000);
  assert.ok(fx.at(1000, false).glitch > 0.5);
  assert.equal(fx.at(1000 + GLITCH_MS.change, false).glitch, 0);
  fx.kick("hurt", 2000);
  assert.deepEqual(fx.at(2000, false).sil, [1, 0.13, 0.32, 1]);
  const after = fx.at(2000 + POSE_MS, false);
  assert.equal(after.sil[3], 0);
  assert.ok(after.glitch > 0 && after.split > 0);
  fx.kick("poke", 3000);
  assert.equal(fx.at(3000, false).sil[3], 1);
});

test("teleport: vanish collapses and stays gone until arrive, which ends on two impact frames", () => {
  const fx = new GlitchFx(0, () => 1);
  fx.kick("vanish", 0);
  assert.equal(fx.at(0, false).collapse, 0);
  const mid = fx.at(VANISH_OUT_MS / 2, false);
  assert.ok(mid.collapse > 0 && mid.collapse < 1 && mid.dissolve > 0);
  assert.equal(fx.at(VANISH_OUT_MS + 500, false).collapse, 1); // the window moves meanwhile
  fx.kick("arrive", 2000);
  assert.ok(fx.at(2000, false).collapse > 0.9);
  const end = GLITCH_MS.arrive;
  assert.deepEqual(fx.at(2000 + end - 2 * POSE_MS, false).sil, [0.21, 1, 0.48, 1]);
  assert.deepEqual(fx.at(2000 + end - POSE_MS, false).sil, [0.08, 0.06, 0.11, 1]);
  assert.deepEqual(fx.at(2000 + end, false), OFF);
});

test("dozing: her body dissolves away and stays gone, with no twitches, until she arrives again", () => {
  const fx = new GlitchFx(0, () => 0);
  fx.kick("doze", 0);
  const mid = fx.at(DOZE_OUT_MS / 2, true);
  assert.ok(mid.dissolve > 0 && mid.dissolve < 0.9 && mid.collapse === 0);
  assert.equal(fx.at(DOZE_OUT_MS, true).collapse, 1);
  assert.equal(fx.at(60 * 60_000, true).collapse, 1); // an hour later: still only the mask
  fx.kick("change", 60 * 60_000); // e.g. landing after her window closed: no body yet
  assert.equal(fx.at(60 * 60_000 + 10, true).collapse, 1);
  fx.kick("arrive", 3_600_001);
  assert.deepEqual(fx.at(3_600_001 + GLITCH_MS.arrive, true), OFF);
});

test("idle twitches every 5-13 s, never while busy or over another effect", () => {
  const fx = new GlitchFx(0, () => 0); // twitch gap = 5 s
  assert.equal(fx.at(4999, true).glitch, 0);
  assert.ok(fx.at(5000, true).glitch > 0);
  assert.equal(fx.at(5000 + GLITCH_MS.twitch, true).glitch, 0);
  assert.equal(fx.at(10_000, false).glitch, 0); // busy: skipped
  fx.kick("change", 14_990);
  assert.ok(fx.at(15_000, true).glitch > 0.5); // the change plays, not a twitch on top
  assert.equal(fx.at(15_000 + GLITCH_MS.change, true).glitch, 0);
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
