// Several screens: she follows the pointer to another one once it has stayed there a few seconds,
// jumping through the edge when that screen is right next to hers. Pure logic; main.ts moves her.

export const FOLLOW_MS = 3000;
export type Rect = { x: number; y: number; w: number; h: number }; // physical px
export type Side = "left" | "right" | "top" | "bottom";

export class Follow {
  private since: number | null = null;

  /** `cursor`, `here`: the screen the pointer is on and hers. True when it's time to go. */
  tick(cursor: number, here: number, now: number): boolean {
    if (cursor === here) {
      this.since = null;
      return false;
    }
    this.since ??= now;
    if (now - this.since < FOLLOW_MS) return false;
    this.since = null;
    return true;
  }
}

/** The side of `here` that `there` touches along an edge (a corner alone doesn't count), or null. */
export function sideOf(here: Rect, there: Rect): Side | null {
  const overlapY = Math.min(here.y + here.h, there.y + there.h) - Math.max(here.y, there.y);
  const overlapX = Math.min(here.x + here.w, there.x + there.w) - Math.max(here.x, there.x);
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  if (overlapY > 0 && near(there.x, here.x + here.w)) return "right";
  if (overlapY > 0 && near(there.x + there.w, here.x)) return "left";
  if (overlapX > 0 && near(there.y + there.h, here.y)) return "top";
  if (overlapX > 0 && near(there.y, here.y + here.h)) return "bottom";
  return null;
}
