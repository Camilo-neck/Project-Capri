import assert from "node:assert/strict";
import { test } from "node:test";

import { CUTIN_GAP_MS, cutinFor, faceSquare, portraitFor, swapGlitch, SWAP_MS } from "./faces.ts";

const yes = () => 0; // the coin always says yes
const no = () => 0.99;

test("her portrait follows how she feels", () => {
  assert.equal(portraitFor("emocionada").shot, "risa");
  assert.equal(portraitFor("sorprendida").shot, "ojos");
  assert.equal(portraitFor("traviesa").shot, "sonrisa");
  assert.notDeepEqual(portraitFor("neutral"), portraitFor("molesta"));
});

test("the portrait frames her face, even in the wide shots, and never leaves the drawing", () => {
  const drawing = { sx: 720, sy: 0, sw: 360, sh: 240 }; // the third drawing of a strip
  assert.deepEqual(faceSquare(drawing, "mira"), { sx: 780, sy: 0, sw: 240, sh: 240 }); // close up: the middle
  const grin = faceSquare(drawing, "sonrisa");
  assert.ok(grin.sw === grin.sh && grin.sw < 150 && grin.sx >= 720 && grin.sy >= 0 && grin.sx + grin.sw <= 1080);
});

test("a cut-in for the big moments only", () => {
  assert.equal(cutinFor("emocionada", "ninguno", 0, -Infinity, false, yes), "risa");
  assert.equal(cutinFor("feliz", "saltar", 0, -Infinity, false, yes), "risa");
  assert.equal(cutinFor("sorprendida", "ninguno", 0, -Infinity, false, yes), "ojos");
  assert.equal(cutinFor("traviesa", "guino", 0, -Infinity, false, yes), "sonrisa");
  assert.equal(cutinFor("traviesa", "ninguno", 0, -Infinity, false, yes), null);
  assert.equal(cutinFor("molesta", "cruzar_brazos", 0, -Infinity, false, yes), "muchos");
  assert.equal(cutinFor("neutral", "asentir", 0, -Infinity, false, yes), null);
});

test("not too often, not every time, and never when she must keep quiet", () => {
  assert.equal(cutinFor("emocionada", "saltar", CUTIN_GAP_MS - 1, 0, false, yes), null);
  assert.equal(cutinFor("emocionada", "saltar", CUTIN_GAP_MS, 0, false, yes), "risa");
  assert.equal(cutinFor("emocionada", "saltar", 0, -Infinity, false, no), null);
  assert.equal(cutinFor("emocionada", "saltar", 0, -Infinity, true, yes), null);
});

test("a new face comes in through a short glitch that settles", () => {
  const start = swapGlitch(0), mid = swapGlitch(SWAP_MS / 2), done = swapGlitch(SWAP_MS);
  assert.ok(start.split > mid.split && mid.split > 0);
  assert.ok(start.bands > 0);
  assert.deepEqual(done, { split: 0, bands: 0, old: false });
  assert.equal(swapGlitch(10).old, true); // the first moment still shows the old face, torn
});
