import assert from "node:assert/strict";
import { test } from "node:test";

import { micView } from "./mic.ts";

const view = (voice: Parameters<typeof micView>[0]["voice"], over: { hiding?: boolean; camera?: boolean } = {}) =>
  micView({ voice, hiding: false, camera: false, ...over });

test("no microphone, no indicator", () => {
  assert.equal(view("off"), "none");
  assert.equal(view("off", { hiding: true }), "none");
  assert.equal(view("off", { camera: true }), "none");
});

test("at rest just a dot; the words only while she's actually listening", () => {
  assert.equal(view("idle"), "dot");
  assert.equal(view("loading"), "dot");
  assert.equal(view("hearing"), "bar");
  assert.equal(view("listening"), "bar");
  assert.equal(view("thinking"), "bar");
});

test("hiding it goes on her mask, in camera mode on the feed's own tag", () => {
  assert.equal(view("idle", { hiding: true }), "mask");
  assert.equal(view("hearing", { hiding: true }), "mask");
  assert.equal(view("idle", { camera: true }), "tag");
  assert.equal(view("hearing", { camera: true, hiding: true }), "mask");
});
