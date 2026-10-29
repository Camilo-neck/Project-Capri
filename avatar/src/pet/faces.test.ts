import assert from "node:assert/strict";
import { test } from "node:test";

import type { Emocion } from "../net/protocol.ts";
import { FACE_PALETTE, faceGrid, SIZE } from "./faces.ts";

const EMOTIONS: Emocion[] = ["neutral", "feliz", "emocionada", "traviesa", "curiosa", "pensativa", "sorprendida", "molesta", "triste", "seria"];

test("every emotion has a square face made only of palette colours", () => {
  for (const e of EMOTIONS) {
    const g = faceGrid(e);
    assert.equal(g.length, SIZE, e);
    for (const row of g) {
      assert.equal(row.length, SIZE, e);
      for (const c of row) assert.ok(c === "." || c in FACE_PALETTE, `${e}: ${c}`);
    }
  }
});

test("every emotion looks different from the others", () => {
  const seen = new Map<string, Emocion>();
  for (const e of EMOTIONS) {
    const key = faceGrid(e).join("\n");
    assert.equal(seen.get(key), undefined, `${e} looks like ${seen.get(key)}`);
    seen.set(key, e);
  }
});

test("her face has her hair, her mask and eyes", () => {
  const flat = faceGrid("neutral").join("");
  for (const c of ["R", "G", "B", "K"]) assert.ok(flat.includes(c), c);
});

test("the same emotion always draws the same face (the glitter is not random)", () => {
  assert.deepEqual(faceGrid("feliz"), faceGrid("feliz"));
});
