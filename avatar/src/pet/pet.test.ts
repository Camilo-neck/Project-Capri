import assert from "node:assert/strict";
import { test } from "node:test";

import { BEHAVIORS, choose, Director, LINGER_MS, POKE_MS, SLEEP_MS, type Behavior, type DirectorInput } from "./behaviors.ts";
import { crisp, outline, over } from "./raster.ts";
import { BASE, blend, GROUND, ik, LEN, solve, type Pose } from "./rig.ts";
import { eyeStamp, FX_STAMPS, MOUTHS, PALETTE } from "./stamps.ts";

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

test("standing base pose has her feet on the ground", () => {
  const j = solve(BASE);
  assert.ok(Math.abs(j.footL[1] - GROUND) < 1 && Math.abs(j.footR[1] - GROUND) < 1);
});

test("ik reaches reachable targets with the elbow on the requested side", () => {
  const from: [number, number] = [40, 40];
  for (const to of [[30, 50], [52, 30], [40, 25], [28, 34]] as [number, number][]) {
    for (const out of [-1, 1] as const) {
      const [a, b] = ik(from, to, LEN.upperArm, LEN.forearm, out);
      const p: Pose = { ...BASE, armL: [a, b] };
      // place the shoulder at `from` by measuring relative to the solved shoulder
      const j = solve(p);
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      assert.ok(near(j.handL[0] - j.shoulderL[0], dx, 0.05) && near(j.handL[1] - j.shoulderL[1], dy, 0.05), `reach ${to}`);
      const elbowSide = Math.sign(j.elbowL[0] - j.shoulderL[0] - dx / 2);
      if (Math.abs(dx) > 1) assert.equal(elbowSide, out, `elbow side for ${to} ${out}`);
    }
  }
});

test("blend interpolates numbers and switches the face halfway", () => {
  const a: Pose = { ...BASE, x: 10, eyes: "open" };
  const b: Pose = { ...BASE, x: 20, eyes: "happy" };
  assert.equal(blend(a, b, 0), a);
  assert.equal(blend(a, b, 1), b);
  const m = blend(a, b, 0.25);
  assert.ok(near(m.x, 12.5));
  assert.equal(m.eyes, "open");
  assert.equal(blend(a, b, 0.75).eyes, "happy");
});

test("crisp makes edges hard and snaps to the palette; outline rings the shape", () => {
  const w = 3;
  const h = 3;
  const data = new Uint8ClampedArray(w * h * 4);
  // center pixel: almost-red, half-transparent corner pixel
  data.set([200, 30, 70, 255], 4 * 4);
  data.set([200, 30, 70, 60], 0);
  crisp(data, [[166, 26, 76], [0, 0, 0]]);
  assert.deepEqual([...data.slice(16, 20)], [166, 26, 76, 255]);
  assert.equal(data[3], 0);
  outline(data, w, h, [1, 2, 3]);
  const ring = [1, 3, 5, 7].map((i) => data[i * 4 + 3]);
  assert.deepEqual(ring, [255, 255, 255, 255]); // 4-neighbors outlined
  assert.equal(data[3], 0); // diagonal corner stays empty
  const dst = new Uint8ClampedArray(w * h * 4);
  over(dst, data);
  assert.deepEqual([...dst.slice(16, 20)], [166, 26, 76, 255]);
});

test("stamps are rectangular and use palette colors", () => {
  const all = [
    ...Object.values(MOUTHS),
    ...Object.values(FX_STAMPS),
    ...(["open", "closed", "relaxed", "happy", "wink", "heart", "spiral", "star", "wide", "angry", "sad", "focused", "up"] as const).flatMap(
      (k) => [eyeStamp(k, -1, [0, 0]), eyeStamp(k, 1, [1, 1])],
    ),
  ];
  for (const s of all) {
    assert.ok(s.every((row) => row.length === s[0].length), s.join("/"));
    for (const ch of s.join("")) assert.ok(ch === "." || ch in PALETTE, ch);
  }
});

test("every behavior produces finite poses over time", () => {
  const ctx = { look: [0.5, -0.5] as [number, number], petSide: -1 };
  for (const [name, def] of Object.entries(BEHAVIORS)) {
    for (let t = 0; t < 6000; t += 137) {
      const p = def.pose(t, ctx);
      const nums = [p.x, p.y, p.torso, p.head, p.nod, ...p.armL, ...p.armR, ...p.legL, ...p.legR, p.thigh, p.squash, p.hair];
      assert.ok(nums.every(Number.isFinite), `${name} @${t}`);
    }
  }
});

const input = (over: Partial<DirectorInput>): DirectorInput => ({
  now: 1_000_000, status: "idle", emocion: "neutral", variant: 0, lastTalk: 900_000,
  pokeAt: -Infinity, petAt: -Infinity, greetAt: -Infinity, ...over,
});

test("director priorities: poke > pet > thinking > talking > idle", () => {
  const now = 1_000_000;
  assert.equal(choose(input({ pokeAt: now - 10, petAt: now, status: "thinking" })).name, "pinchada");
  assert.equal(choose(input({ petAt: now - 10, status: "thinking" })).name, "acariciada");
  assert.equal(choose(input({ status: "thinking" })).name, "escribir");
  assert.equal(choose(input({ status: "speaking", emocion: "molesta" })).name, "molesta");
  assert.equal(choose(input({ emocion: "triste", lastTalk: now - LINGER_MS + 10 })).name, "triste");
  assert.equal(choose(input({ pokeAt: now - POKE_MS - 1, lastTalk: now - SLEEP_MS - 1 })).name, "dormir");
  assert.equal(choose(input({ status: "down", lastTalk: now - LINGER_MS - 1 })).name, "dormir");
  assert.equal(choose(input({ greetAt: now - 100, lastTalk: now - LINGER_MS - 1 })).name, "saludar");
  const idle = choose(input({ lastTalk: now - LINGER_MS - 1 })).name;
  assert.ok(["sentada", "meditar", "estirarse"].includes(idle), idle);
});

test("switching behaviors blends instead of popping", () => {
  const d = new Director();
  const ctx = { look: [0, 0] as [number, number], petSide: 1 };
  const o = { gesto: "ninguno" as const, gestureT: 0, mouth: null, blinking: false };
  const seq: [number, Partial<DirectorInput>][] = [];
  for (let t = 0; t < 2000; t += 50) seq.push([t, { status: "idle", lastTalk: -LINGER_MS - 1 }]);
  for (let t = 2000; t < 4000; t += 50) seq.push([t, { status: "speaking", emocion: "emocionada", lastTalk: t }]);
  for (let t = 4000; t < 6000; t += 50) seq.push([t, { status: "speaking", emocion: "triste", lastTalk: t }]);
  let prev: ReturnType<typeof solve> | null = null;
  let prevName: Behavior | null = null;
  for (const [t, over] of seq) {
    const { name, pose } = d.frame(input({ now: t, greetAt: -Infinity, ...over }), ctx, o);
    const j = solve(pose);
    if (prev && prevName !== name) {
      // right at a switch the head may only move a few pixels per frame
      const jump = Math.hypot(j.headCenter[0] - prev.headCenter[0], j.headCenter[1] - prev.headCenter[1]);
      assert.ok(jump < 6, `${prevName} -> ${name}: head jumped ${jump.toFixed(1)} px`);
    }
    prev = j;
    prevName = name;
  }
});
