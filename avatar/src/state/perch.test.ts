import assert from "node:assert/strict";
import { test } from "node:test";

import { canSit, CORNER, covered, ledgeAt, pickSeat, seatOf, type Win, type Windows } from "./perch.ts";

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

test("she sits on a top corner, rides along with its window and falls when it goes away", () => {
  const right = { id: 1, side: "right" as const };
  assert.deepEqual(seatOf({ fg: 1, wins: [win(1, 300, 600)] }, right, ROOM), { x: 1100 - CORNER, y: 600 });
  assert.deepEqual(seatOf({ fg: 1, wins: [win(1, 300, 600)] }, { id: 1, side: "left" }, ROOM), { x: 300 + CORNER, y: 600 });
  assert.deepEqual(seatOf({ fg: 1, wins: [win(1, 350, 700)] }, right, ROOM), { x: 1150 - CORNER, y: 700 }); // moved
  assert.deepEqual(seatOf({ fg: 1, wins: [win(1, 300, 600, 320)] }, right, ROOM), { x: 620 - CORNER, y: 600 }); // resized
  assert.deepEqual(seatOf({ fg: 1, wins: [win(1, -150, 700)] }, { id: 1, side: "left" }, ROOM), { x: 180, y: 700 }); // kept on screen
  assert.equal(seatOf({ fg: 1, wins: [] }, right, ROOM), null); // closed or minimized
  assert.equal(seatOf({ fg: 1, wins: [win(1, 100, 600, 800, 400, true)] }, right, ROOM), null); // maximized
  assert.equal(seatOf({ fg: 2, wins: [win(2, 700, 550), win(1, 100, 600)] }, right, ROOM), null); // covered
});

test("seats prefer the focused window, skip the current one, and can insist on the front", () => {
  const ws: Windows = { fg: 2, wins: [win(1, 200, 600), win(2, 1000, 700)] };
  assert.equal(pickSeat(ws, ROOM)?.id, 2);
  assert.equal(pickSeat(ws, ROOM, { except: 2 })?.id, 1);
  assert.equal(pickSeat({ fg: 9, wins: ws.wins }, ROOM, { frontOnly: true }), null);
  assert.equal(pickSeat({ fg: 1, wins: [] }, ROOM), null);
});

test("letting her go on a ledge seats her at its nearer corner; elsewhere, nothing", () => {
  const ws: Windows = { fg: 1, wins: [win(1, 1000, 650, 600, 300), win(2, 200, 700)] };
  assert.deepEqual(ledgeAt(ws, { x: 1100, y: 640 }, ROOM), { id: 1, side: "left" }); // 10 px above, nearer its left
  assert.deepEqual(ledgeAt(ws, { x: 800, y: 715 }, ROOM), { id: 2, side: "left" }); // its right corner is under window 1
  assert.deepEqual(ledgeAt({ fg: 2, wins: [win(2, 200, 700)] }, { x: 800, y: 715 }, ROOM), { id: 2, side: "right" });
  assert.equal(ledgeAt(ws, { x: 1100, y: 900 }, ROOM), null); // in the middle of the window
  assert.equal(ledgeAt(ws, { x: 1700, y: 650 }, ROOM), null); // past its right end
  const front: Windows = { fg: 1, wins: [win(1, 100, 600, 800, 400), win(2, 200, 610)] };
  assert.equal(ledgeAt(front, { x: 400, y: 612 }, ROOM)?.id, 1); // two ledges close: the front one
});

test("on her own she takes the left corner (the right one has the close button), unless it's off screen", () => {
  assert.equal(pickSeat({ fg: 1, wins: [win(1, 600, 600)] }, ROOM)?.side, "left");
  assert.equal(pickSeat({ fg: 1, wins: [win(1, 0, 600)] }, ROOM)?.side, "right"); // its left corner is past the margin
  const atRight = win(1, 1800, 600, 760); // dropped by its right corner, which is past the margin
  assert.equal(ledgeAt({ fg: 1, wins: [atRight] }, { x: 2400, y: 600 }, ROOM)?.side, "left");
});
