// Where Capri can sit: on a top corner of other windows (Rust watches them, see win_watch.rs), her
// legs hanging down outside it, never over what's in it. Pure geometry, page px; window lists come
// front to back.

export interface Win {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  max: boolean;
}

export interface Windows {
  fg: number; // the focused window
  wins: Win[]; // front to back
}

export type Side = "left" | "right";

export type Point = { x: number; y: number };

/** She sits on a top corner of window `id` (on the left one she's mirrored, legs out to the left),
 * or `x` px along its top edge where he dropped her, or, with `at`, in the air where he left her. */
export interface Perch {
  id: number;
  side: Side;
  x?: number;
  at?: Point;
}

export const CARD_ID = -1; // her player card, in front of the windows while it's up
const FREE_ID = -2;
const CARD_SPOT = 0.1; // where she sits on it, along its width

/** The overlay: `room` px needed above a ledge (her and the transmission), seats kept `margin` px inside `width`. */
export interface Limits {
  room: number;
  width: number;
  margin: number;
}

const HALF = 30; // half her width at the seat: that much of the ledge must be visible
const MIN_W = 300;
export const CORNER = 18; // px from the window's side to where she sits: her legs hang just past it

/** Room a ledge needs above it. `quiet` (the transmission and the input are closed): just her, `pet` px tall
 * with the strip under her feet (`below`) not counting. Otherwise the whole column, `hud` px, which stacks
 * the transmission above her. */
export function roomNeeded({ quiet, pet, hud, below }: { quiet: boolean; pet: number; hud: number; below: number }): number {
  return (quiet ? pet + 4 : hud) - below;
}

/** A ledge she can use: not maximized, wide enough, room above it, and some of it on this screen. */
export function canSit(win: Win, lim: Limits): boolean {
  return !win.max && win.w >= MIN_W && win.y >= lim.room && win.x + win.w - HALF * 2 > lim.margin && win.x + HALF * 2 < lim.width - lim.margin;
}

/** A spot in the air, where he left her. */
export const freeSeat = (at: Point): Perch => ({ id: FREE_ID, side: "right", at });

/** Her seat on her card, near its left end. */
export const cardSeat = (card: Win): Perch => ({ id: card.id, side: "left", x: Math.round(card.w * CARD_SPOT) });

const onScreen = (x: number, lim: Limits) => Math.min(Math.max(x, lim.margin), lim.width - lim.margin);

const cornerX = (win: Win, side: Side) => (side === "right" ? win.x + win.w - CORNER : win.x + CORNER);

/** Her x on a corner of a window, kept on the screen. */
function seatX(win: Win, side: Side, lim: Limits): number {
  return onScreen(cornerX(win, side), lim);
}

/** A corner of `win` to sit on, `prefer` first: on the screen (else clamped) and not under another window. */
function seatOn(ws: Windows, win: Win, lim: Limits, prefer: Side): Perch | null {
  const fits = (side: Side) => cornerX(win, side) >= lim.margin && cornerX(win, side) <= lim.width - lim.margin;
  const other: Side = prefer === "right" ? "left" : "right";
  let sides: Side[] = [prefer, other].filter(fits);
  if (!sides.length) sides = [prefer]; // a narrow screen: kept on it
  const side = sides.find((s) => !covered(ws, win, seatX(win, s, lim)));
  return side ? { id: win.id, side } : null;
}

/** Is the ledge at x hidden under a window in front of `win`? */
export function covered(ws: Windows, win: Win, x: number): boolean {
  for (const o of ws.wins) {
    if (o.id === win.id) return false; // everything after is behind it
    if (o.x < x + HALF && o.x + o.w > x - HALF && o.y <= win.y && o.y + o.h >= win.y) return true;
  }
  return false;
}

/** Where her feet go on a perch, or null if she can't stay there (closed, minimized, maximized, covered). */
export function seatOf(ws: Windows, perch: Perch, lim: Limits): Point | null {
  if (perch.at) return perch.at.y >= lim.room ? perch.at : null;
  const win = ws.wins.find((w) => w.id === perch.id);
  if (!win || !canSit(win, lim)) return null;
  const x = perch.x === undefined ? seatX(win, perch.side, lim) : onScreen(win.x + perch.x, lim);
  return covered(ws, win, x) ? null : { x, y: win.y };
}

/** Dropped (dragged and let go) with her feet at `p`: the ledge right there, if any, at that very spot.
 * The top-most window wins. */
export function ledgeAt(ws: Windows, p: Point, lim: Limits, tolerance = 30): Perch | null {
  for (const win of ws.wins) {
    if (Math.abs(p.y - win.y) > tolerance || p.x < win.x || p.x > win.x + win.w || !canSit(win, lim)) continue;
    const x = onScreen(Math.min(Math.max(p.x, win.x + CORNER), win.x + win.w - CORNER), lim);
    if (!covered(ws, win, x)) return { id: win.id, side: p.x < win.x + win.w / 2 ? "left" : "right", x: x - win.x };
  }
  return null;
}

/** A free seat, the focused window first. `except`: a window to skip (the one she's on). On her own she
 * takes the left corner: on the right one she'd sit on the window's close button. */
export function pickSeat(ws: Windows, lim: Limits, { frontOnly = false, except = -1 } = {}): Perch | null {
  const options: Perch[] = [];
  for (const win of ws.wins) {
    if (win.id === except || win.id === CARD_ID || !canSit(win, lim)) continue;
    const seat = seatOn(ws, win, lim, "left");
    if (seat) options.push(seat);
  }
  const front = options.find((p) => p.id === ws.fg);
  return frontOnly ? front ?? null : front ?? options[0] ?? null;
}
