import assert from "node:assert/strict";
import { test } from "node:test";

import { canSit, CARD_ID, cardSeat, CORNER, covered, freeSeat, ledgeAt, pickSeat, roomNeeded, seatOf, type Win, type Windows } from "./perch.ts";

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

test("letting her go on a ledge seats her right there, and she stays at that spot as the window moves", () => {
  const ws: Windows = { fg: 1, wins: [win(1, 1000, 650, 600, 300), win(2, 200, 700)] };
  assert.deepEqual(ledgeAt(ws, { x: 1100, y: 640 }, ROOM), { id: 1, side: "left", x: 100 }); // 10 px above, nearer its left
  assert.deepEqual(ledgeAt(ws, { x: 800, y: 715 }, ROOM), { id: 2, side: "right", x: 600 });
  assert.deepEqual(seatOf(ws, { id: 1, side: "left", x: 100 }, ROOM), { x: 1100, y: 650 });
  assert.deepEqual(seatOf({ fg: 1, wins: [win(1, 1200, 680, 600, 300)] }, { id: 1, side: "left", x: 100 }, ROOM), { x: 1300, y: 680 });
  assert.equal(ledgeAt({ fg: 1, wins: [win(1, 1000, 650, 600, 300), win(2, 800, 700)] }, { x: 1100, y: 715 }, ROOM), null, "that edge is under window 1");
  assert.equal(ledgeAt(ws, { x: 1590, y: 650 }, ROOM)?.x, 600 - CORNER, "near its end she stays on it");
  assert.equal(ledgeAt(ws, { x: 1100, y: 900 }, ROOM), null); // in the middle of the window
  assert.equal(ledgeAt(ws, { x: 1700, y: 650 }, ROOM), null); // past its right end
  const front: Windows = { fg: 1, wins: [win(1, 100, 600, 800, 400), win(2, 200, 610)] };
  assert.equal(ledgeAt(front, { x: 400, y: 612 }, ROOM)?.id, 1); // two ledges close: the front one
});

test("on her own she takes the left corner (the right one has the close button), unless it's off screen", () => {
  assert.equal(pickSeat({ fg: 1, wins: [win(1, 600, 600)] }, ROOM)?.side, "left");
  assert.equal(pickSeat({ fg: 1, wins: [win(1, 0, 600)] }, ROOM)?.side, "right"); // its left corner is past the margin
  const atRight = win(1, 1800, 600, 760); // dropped by its right corner, which is past the margin
  assert.equal(ledgeAt({ fg: 1, wins: [atRight] }, { x: 2400, y: 600 }, ROOM)?.x, 2380 - 1800); // past the margin: the nearest she can be
});

test("a spot in the air keeps her there, until the transmission needs the room", () => {
  const spot = freeSeat({ x: 900, y: 620 });
  assert.deepEqual(seatOf({ fg: 1, wins: [] }, spot, ROOM), { x: 900, y: 620 });
  assert.equal(seatOf({ fg: 1, wins: [] }, spot, { ...ROOM, room: 700 }), null);
});

test("her card is a seat near its left end, but never one she wanders to", () => {
  const card = win(CARD_ID, 1900, 800, 330, 140);
  const ws: Windows = { fg: 1, wins: [card, win(1, 200, 600)] };
  assert.deepEqual(seatOf(ws, cardSeat(card), ROOM), { x: 1933, y: 800 });
  assert.equal(pickSeat(ws, ROOM)?.id, 1);
  assert.equal(pickSeat({ fg: 9, wins: [card] }, ROOM), null);
  assert.equal(ledgeAt(ws, { x: 2000, y: 795 }, ROOM)?.id, CARD_ID, "dropped on it, she sits on it");
  assert.equal(seatOf({ fg: 1, wins: [win(1, 200, 600)] }, cardSeat(card), ROOM), null, "closed, she falls");
});

test("room above a ledge: just her while the transmission is closed, her and the transmission while it's open", () => {
  const sizes = { pet: 288, hud: 560, below: 54 };
  const quiet = roomNeeded({ ...sizes, quiet: true });
  const talking = roomNeeded({ ...sizes, quiet: false });
  assert.ok(quiet < talking);
  const win = { id: 1, x: 100, y: 300, w: 800, h: 500, max: false };
  const lim = (room: number) => ({ room, width: 1920, margin: 196 });
  assert.equal(canSit(win, lim(quiet)), true, "a window a third of the way down: she fits above it");
  assert.equal(canSit(win, lim(talking)), false, "...but not with the transmission above her");
});
