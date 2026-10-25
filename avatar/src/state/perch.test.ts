import assert from "node:assert/strict";
import { test } from "node:test";

import { canSit, covered, ledgeAt, pickSeat, seatOf, type Win, type Windows } from "./perch.ts";

const ROOM = { room: 500, width: 2560, margin: 180 };
const win = (id: number, x: number, y: number, w = 800, h = 400, max = false): Win => ({ id, x, y, w, h, max });

test("only roomy, unmaximized, wide windows are seats", () => {
  assert.equal(canSit(win(1, 0, 600), ROOM), true);
  assert.equal(canSit(win(1, 0, 100), ROOM), false); // no room above for her and the transmission
  assert.equal(canSit(win(1, 0, 600, 200), ROOM), false); // too narrow
  assert.equal(canSit(win(1, 0, 600, 800, 400, true), ROOM), false);
  assert.equal(canSit(win(1, 2700, 600), ROOM), false); // on another monitor
});

test("a ledge is covered only by windows in front that cross it", () => {
  const back = win(2, 0, 600);
  const ws: Windows = { fg: 1, wins: [win(1, 300, 500, 400, 300), back] };
  assert.equal(covered(ws, back, 400), true);
  assert.equal(covered(ws, back, 100), false);
  const behind: Windows = { fg: 2, wins: [back, win(1, 300, 500, 400, 300)] };
  assert.equal(covered(behind, back, 400), false);
});

test("a perch rides along with its window and fails when it goes away", () => {
  const perch = { id: 1, dx: 200 };
  assert.deepEqual(seatOf({ fg: 1, wins: [win(1, 100, 600)] }, perch, ROOM), { x: 300, y: 600 });
  assert.deepEqual(seatOf({ fg: 1, wins: [win(1, 150, 700)] }, perch, ROOM), { x: 350, y: 700 }); // moved
  assert.deepEqual(seatOf({ fg: 1, wins: [win(1, -150, 700)] }, perch, ROOM), { x: 180, y: 700 }); // kept on screen
  assert.equal(seatOf({ fg: 1, wins: [] }, perch, ROOM), null); // closed or minimized
  assert.equal(seatOf({ fg: 1, wins: [win(1, 100, 600, 800, 400, true)] }, perch, ROOM), null); // maximized
  assert.equal(seatOf({ fg: 2, wins: [win(2, 200, 550), win(1, 100, 600)] }, perch, ROOM), null); // covered
  assert.deepEqual(seatOf({ fg: 1, wins: [win(1, 100, 600, 320)] }, { id: 1, dx: 900 }, ROOM), { x: 360, y: 600 }); // shrunk
});

test("seats prefer the focused window, skip the current one, and can insist on the front", () => {
  const ws: Windows = { fg: 2, wins: [win(1, 200, 600), win(2, 1000, 700)] };
  assert.equal(pickSeat(ws, ROOM, () => 0.5)?.id, 2);
  assert.equal(pickSeat(ws, ROOM, () => 0.5, { except: 2 })?.id, 1);
  assert.equal(pickSeat({ fg: 9, wins: ws.wins }, ROOM, () => 0.5, { frontOnly: true }), null);
  assert.equal(pickSeat({ fg: 1, wins: [] }, ROOM), null);
});

test("letting her go right on a ledge seats her there; elsewhere, nothing", () => {
  const ws: Windows = { fg: 1, wins: [win(1, 1000, 650, 600, 300), win(2, 200, 700)] };
  assert.deepEqual(ledgeAt(ws, { x: 1100, y: 640 }, ROOM), { id: 1, dx: 100 }); // 10 px above its top edge
  assert.deepEqual(ledgeAt(ws, { x: 400, y: 715 }, ROOM), { id: 2, dx: 200 });
  assert.equal(ledgeAt(ws, { x: 1100, y: 900 }, ROOM), null); // in the middle of the window
  assert.equal(ledgeAt(ws, { x: 1700, y: 650 }, ROOM), null); // past its right end
  const front: Windows = { fg: 1, wins: [win(1, 100, 600, 800, 400), win(2, 200, 610)] };
  assert.equal(ledgeAt(front, { x: 400, y: 612 }, ROOM)?.id, 1); // two ledges close: the front one
});
