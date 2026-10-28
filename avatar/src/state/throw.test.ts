import assert from "node:assert/strict";
import { test } from "node:test";

import { type Bounds, launch, MAD_MS, type Pull, step, STICK_MS, Temper, thrown, Velocity } from "./throw.ts";

const B: Bounds = { left: 50, right: 950, top: 40, floor: 700 };

test("the pointer's speed at the moment she's let go", () => {
  const v = new Velocity();
  for (let t = 0; t <= 200; t += 10) v.push(100 + t, 300 - t / 2, t); // 1 px/ms right, 0.5 up
  const { vx, vy } = v.get(200);
  assert.ok(Math.abs(vx - 1) < 0.01 && Math.abs(vy + 0.5) < 0.01);
  assert.ok(thrown({ vx, vy }));
  assert.ok(!thrown({ vx: 0.2, vy: 0.1 })); // a gentle let-go: she just drops, like before
  assert.deepEqual(new Velocity().get(0), { vx: 0, vy: 0 });
});

function fly(f: Pull, ms: number, ledges = [] as Parameters<typeof step>[3]) {
  const hits = [];
  let now = 0;
  for (; now < ms && f.flight; now += 16) {
    const r = step(f.flight, 16, B, ledges, now);
    f = { flight: r.flight };
    if (r.hit) hits.push({ ...r.hit, now });
  }
  return { f, hits };
}

test("into a side of the screen: stuck to it a moment, then she bounces back off", () => {
  let f: Pull = { flight: launch({ x: 800, y: 300 }, { vx: 2, vy: 0 }) };
  const { f: after, hits } = fly(f, 120);
  assert.equal(hits[0].kind, "wall");
  assert.equal(hits[0].kind === "wall" && hits[0].side, "right");
  const stuck = after.flight!;
  assert.equal(stuck.x, B.right);
  f = { flight: stuck };
  assert.ok(stuck.stuck > 0 && stuck.stuck <= STICK_MS);
  const later = fly(f, 40).f.flight!;
  assert.equal(later.x, B.right); // still stuck to the glass
  const off = fly({ flight: later }, 200).f.flight!;
  assert.ok(off.x < B.right && off.vx < 0); // bounced, slower, the other way
});

test("falling onto a window's top edge: slow, she grabs it; fast, she bounces off", () => {
  const ledge = [{ id: 7, x1: 300, x2: 600, y: 400 }];
  const slow = fly({ flight: launch({ x: 400, y: 380 }, { vx: 0, vy: 0.2 }) }, 400, ledge);
  assert.deepEqual(slow.hits.map((h) => h.kind), ["ledge"]);
  assert.equal(slow.f.flight, null);
  const fast = fly({ flight: launch({ x: 400, y: 300 }, { vx: 0, vy: 2.5 }) }, 60, ledge);
  assert.equal(fast.hits[0].kind, "bounce");
  assert.ok(fast.f.flight!.vy < 0);
});

test("on the floor: upright she lands on her feet, tumbling she lands flat", () => {
  const upright = fly({ flight: { ...launch({ x: 500, y: 650 }, { vx: 0.3, vy: 1 }), spin: 0, rot: 0 } }, 400);
  assert.equal(upright.hits.at(-1)!.kind, "feet");
  const tumbling = fly({ flight: { ...launch({ x: 500, y: 650 }, { vx: 0.3, vy: 1 }), spin: 0, rot: Math.PI / 2 } }, 400);
  assert.equal(tumbling.hits.at(-1)!.kind, "flat");
});

test("thrown three times in a minute she gets mad and won't be picked up for a while", () => {
  const t = new Temper();
  assert.equal(t.thrown(0), "once");
  assert.equal(t.thrown(10_000), "again");
  assert.equal(t.thrown(20_000), "mad");
  assert.equal(t.canGrab(20_000 + MAD_MS - 1), false);
  assert.equal(t.canGrab(20_000 + MAD_MS), true);
  const calm = new Temper();
  calm.thrown(0);
  calm.thrown(61_000);
  assert.notEqual(calm.thrown(122_000), "mad"); // spread out: never mad
});
