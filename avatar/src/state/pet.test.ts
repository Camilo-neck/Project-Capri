import assert from "node:assert/strict";
import { test } from "node:test";

import { LINGER_MS, pickSprite, SLEEP_MS, SLOT_MS, SWING_MS, type PetInput } from "./pet.ts";

const base: PetInput = { now: 1_000_000, status: "idle", emocion: "neutral", variant: 0, lastTalk: 1_000_000 };

test("thinking shows her at the laptop", () => {
  assert.equal(pickSprite({ ...base, status: "thinking", emocion: "feliz" }), "laptop");
});

test("while talking and shortly after, the sprite follows the emotion", () => {
  assert.equal(pickSprite({ ...base, status: "speaking", emocion: "traviesa" }), "cursor");
  assert.equal(pickSprite({ ...base, emocion: "curiosa", now: base.lastTalk + LINGER_MS - 1 }), "asomada");
  assert.equal(pickSprite({ ...base, emocion: "feliz", variant: 1 }), "enamorada");
  assert.equal(pickSprite({ ...base, emocion: "feliz", variant: 2 }), "malabar");
});

test("neutral sitting swings her legs", () => {
  const a = pickSprite({ ...base, now: 0, lastTalk: 0 });
  const b = pickSprite({ ...base, now: SWING_MS, lastTalk: SWING_MS });
  assert.deepEqual(new Set([a, b]), new Set(["sentada_a", "sentada_b"]));
});

test("idle activities hold for a whole slot, then she falls asleep", () => {
  const t0 = base.lastTalk + LINGER_MS + 10;
  const slotStart = base.lastTalk + Math.ceil((LINGER_MS + 10) / SLOT_MS) * SLOT_MS;
  const inSlot = [slotStart + 5, slotStart + SLOT_MS / 2, slotStart + SLOT_MS - 5].map((now) =>
    pickSprite({ ...base, emocion: "seria", now }).replace(/_[ab]$/, ""),
  );
  assert.equal(new Set(inSlot).size, 1);
  assert.ok(["sentada", "meditar", "recostada"].includes(pickSprite({ ...base, now: t0 }).replace(/_[ab]$/, "")));
  assert.equal(pickSprite({ ...base, now: base.lastTalk + SLEEP_MS + 1 }), "dormir");
  assert.equal(pickSprite({ ...base, status: "down", now: base.lastTalk + LINGER_MS + 1 }), "dormir");
});
