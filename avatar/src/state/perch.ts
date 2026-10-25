// Where Capri can sit: on the top edge of other windows (Rust watches them, see win_watch.rs).
// Pure geometry, page px; window lists come front to back.

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

/** She sits on window `id`, `dx` px from its left edge. */
export interface Perch {
  id: number;
  dx: number;
}

export type Point = { x: number; y: number };

/** The overlay: `room` px needed above a ledge (her and the transmission), seats kept `margin` px inside `width`. */
export interface Limits {
  room: number;
  width: number;
  margin: number;
}

const HALF = 30; // half her width at the seat: that much of the ledge must be visible
const MIN_W = 300;

/** A ledge she can use: not maximized, wide enough, room above it, and some of it on this screen. */
export function canSit(win: Win, lim: Limits): boolean {
  return !win.max && win.w >= MIN_W && win.y >= lim.room && win.x + win.w - HALF * 2 > lim.margin && win.x + HALF * 2 < lim.width - lim.margin;
}

/** Her x on a window, kept on its ledge and on the screen. */
function seatX(win: Win, dx: number, lim: Limits): number {
  const x = win.x + Math.min(Math.max(dx, HALF * 2), win.w - HALF * 2);
  return Math.min(Math.max(x, lim.margin), lim.width - lim.margin);
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
  const win = ws.wins.find((w) => w.id === perch.id);
  if (!win || !canSit(win, lim)) return null;
  const x = seatX(win, perch.dx, lim);
  return covered(ws, win, x) ? null : { x, y: win.y };
}

/** A free seat, the focused window first. `except`: a window to skip (the one she's on). */
export function pickSeat(
  ws: Windows,
  lim: Limits,
  rand: () => number = Math.random,
  { frontOnly = false, except = -1 } = {},
): Perch | null {
  const options: Perch[] = [];
  for (const win of ws.wins) {
    if (win.id === except || !canSit(win, lim)) continue;
    const dx = Math.round(seatX(win, win.w * (0.2 + rand() * 0.6), lim) - win.x);
    if (!covered(ws, win, win.x + dx)) options.push({ id: win.id, dx });
  }
  const front = options.find((p) => p.id === ws.fg);
  return frontOnly ? front ?? null : front ?? options[0] ?? null;
}
