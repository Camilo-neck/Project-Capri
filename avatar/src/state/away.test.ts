import assert from "node:assert/strict";
import { test } from "node:test";

import { AWAY_MS, AwayWatch, backLine, speaksOnBack } from "./away.ts";

const MIN = 60_000;

test("idle that keeps growing is still away; when it drops, he's back and she knows for how long", () => {
  const w = new AwayWatch();
  for (const idle of [0, 5 * MIN, 11 * MIN]) assert.equal(w.tick(idle), 0);
  assert.equal(w.tick(200), 11 * MIN); // a key pressed: back after 11 min
  assert.equal(w.tick(1200), 0); // and it re-arms
});

test("a short break doesn't count as being away", () => {
  const w = new AwayWatch();
  w.tick(AWAY_MS - MIN);
  assert.equal(w.tick(0), 0);
});

test("reset forgets the absence (the PC woke from sleep: that has its own greeting)", () => {
  const w = new AwayWatch();
  w.tick(30 * MIN);
  w.reset();
  assert.equal(w.tick(0), 0);
});

test("how long he was gone picks the line, and late at night has its own", () => {
  const pick = () => 0;
  const short = backLine(15 * MIN, 15, null, "", pick).texto;
  const mid = backLine(60 * MIN, 15, null, "", pick).texto;
  const long = backLine(5 * 60 * MIN, 15, null, "", pick);
  const night = backLine(15 * MIN, 3, null, "", pick).texto;
  assert.equal(new Set([short, mid, long.texto, night]).size, 4);
  assert.equal(long.emocion, "sorprendida");
});

test("she never says the same line twice in a row", () => {
  const first = backLine(15 * MIN, 15, null, "", () => 0).texto;
  for (let i = 0; i < 20; i++) assert.notEqual(backLine(15 * MIN, 15, null, first, () => 0).texto, first);
});

test("if Claude finished while he was away, she tells him", () => {
  assert.match(backLine(15 * MIN, 15, "capri", "", () => 0).texto, /Claude terminó lo de capri\.$/);
});

test("she keeps quiet when hidden, on do-not-disturb, behind a fullscreen app, mid-move or without her backend", () => {
  const free = { hiding: false, dnd: false, fullscreen: false, moving: false, down: false };
  assert.equal(speaksOnBack(free), true);
  for (const k of Object.keys(free) as (keyof typeof free)[]) assert.equal(speaksOnBack({ ...free, [k]: true }), false, k);
});
