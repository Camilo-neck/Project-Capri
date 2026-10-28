// Throwing her: let go of her mid-swing and she flies with the pointer's speed, spinning. Into a side
// of the screen she sticks to the glass a moment and bounces off; falling onto a window's top edge she
// grabs it (or bounces off it, too fast); on the floor she lands on her feet or flat. Thrown three
// times in a minute, she gets mad. Pure logic: main.ts draws it and feeds it the windows.

export const THROW_SPEED = 0.6; // px/ms at the let-go: faster is a throw, slower she just drops
export const GRAVITY = 0.0028; // px/ms², as when she falls off a ledge
export const STICK_MS = 160; // flattened against the glass before she bounces off
export const BOUNCE = 0.5; // what's left of her speed off a side
export const LEDGE_BOUNCE = 0.45;
export const CATCH_VY = 0.9; // px/ms: falling slower than this onto a window's edge, she grabs it
const UPRIGHT = 0.7; // rad from upright: landing within it, she's on her feet
const SAMPLE_MS = 100; // the pointer's speed over its last this-many ms
export const MAD_MS = 20_000; // mad: no picking her up for this long
const TEMPER_MS = 60_000; // three throws within this make her mad

export type Pt = { x: number; y: number };
export interface Bounds {
  left: number;
  right: number;
  top: number;
  floor: number;
}
export interface Ledge {
  id: number;
  x1: number;
  x2: number;
  y: number;
}
export interface Flight {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number; // rad, 0 upright
  spin: number; // rad/ms
  stuck: number; // ms left flattened against the glass
}
export type Hit =
  | { kind: "wall"; side: "left" | "right" | "top"; x: number; y: number } // the glass cracks there
  | { kind: "ledge"; id: number; x: number; y: number } // she grabbed it: she sits there
  | { kind: "bounce"; id: number; x: number; y: number } // off a window's edge, too fast
  | { kind: "feet" | "flat"; x: number; y: number; vx: number }; // on the floor
export type Pull = { flight: Flight | null };

/** The pointer's speed, from where it was over the last SAMPLE_MS. */
export class Velocity {
  private pts: { x: number; y: number; t: number }[] = [];

  push(x: number, y: number, t: number): void {
    this.pts.push({ x, y, t });
    while (this.pts.length > 2 && t - this.pts[0].t > SAMPLE_MS) this.pts.shift();
  }

  get(now: number): { vx: number; vy: number } {
    const a = this.pts[0], b = this.pts[this.pts.length - 1];
    if (!a || !b || b.t - a.t < 10 || now - b.t > SAMPLE_MS) return { vx: 0, vy: 0 }; // held still at the end
    return { vx: (b.x - a.x) / (b.t - a.t), vy: (b.y - a.y) / (b.t - a.t) };
  }
}

export function thrown(v: { vx: number; vy: number }): boolean {
  return Math.hypot(v.vx, v.vy) >= THROW_SPEED;
}

export function launch(at: Pt, v: { vx: number; vy: number }): Flight {
  return { x: at.x, y: at.y, vx: v.vx, vy: v.vy, rot: 0, spin: Math.max(-0.03, Math.min(0.03, v.vx * 0.012)), stuck: 0 };
}

/** One step of `dt` ms. `ledges`: the windows' top edges she can catch. */
export function step(f: Flight, dt: number, b: Bounds, ledges: Ledge[], now: number): { flight: Flight | null; hit?: Hit } {
  void now;
  if (f.stuck > 0) return { flight: { ...f, stuck: f.stuck - dt } }; // flattened on the glass
  const vy = f.vy + GRAVITY * dt;
  const n = { ...f, vy, x: f.x + f.vx * dt, y: f.y + vy * dt, rot: f.rot + f.spin * dt };
  for (const side of ["left", "right"] as const) {
    const edge = side === "left" ? b.left : b.right;
    if (side === "left" ? n.x <= edge : n.x >= edge) {
      const flight = { ...n, x: edge, vx: -f.vx * BOUNCE, vy: vy * 0.5, spin: -f.spin, stuck: STICK_MS };
      return { flight, hit: { kind: "wall", side, x: edge, y: n.y } };
    }
  }
  if (n.y <= b.top) return { flight: { ...n, y: b.top, vy: -vy * BOUNCE, stuck: STICK_MS }, hit: { kind: "wall", side: "top", x: n.x, y: b.top } };
  for (const l of ledges) {
    if (vy > 0 && f.y <= l.y && n.y >= l.y && n.x >= l.x1 && n.x <= l.x2) {
      if (vy < CATCH_VY) return { flight: null, hit: { kind: "ledge", id: l.id, x: n.x, y: l.y } };
      return { flight: { ...n, y: l.y, vy: -vy * LEDGE_BOUNCE }, hit: { kind: "bounce", id: l.id, x: n.x, y: l.y } };
    }
  }
  if (n.y >= b.floor) {
    const tilt = Math.abs(Math.atan2(Math.sin(n.rot), Math.cos(n.rot)));
    return { flight: null, hit: { kind: tilt < UPRIGHT ? "feet" : "flat", x: n.x, y: b.floor, vx: n.vx } };
  }
  return { flight: n };
}

/** How she takes being thrown: once is fun, again is a bit much, three times in a minute and she's mad. */
export class Temper {
  private times: number[] = [];
  private madUntil = -Infinity;

  thrown(now: number): "once" | "again" | "mad" {
    this.times = [...this.times.filter((t) => now - t < TEMPER_MS), now];
    if (this.times.length >= 3) {
      this.times = [];
      this.madUntil = now + MAD_MS;
      return "mad";
    }
    return this.times.length === 1 ? "once" : "again";
  }

  canGrab(now: number): boolean {
    return now >= this.madUntil;
  }
}
