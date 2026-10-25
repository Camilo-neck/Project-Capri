// Her little mischief, from mochiiwuff/capri-desktop: now and then she zaps the pointer with red
// lightning when it comes near, and sometimes she peeks in from a screen edge (half hidden at a side,
// or hanging upside down from the top), shy: bring the pointer close and she ducks away.
// Pure logic: when, and where she goes; main.ts and render/fx.ts do the rest.

export const ZAP_NEAR: [number, number] = [70, 190]; // px from her middle: close, but not on her
export const ZAP_GAP_MS: [number, number] = [90_000, 240_000];
export const ZAP_CHANCE = 0.35; // when the pointer comes near and she's allowed
export const SHY_NEAR = 160; // px: the pointer this close and she ducks away from her edge
export const PEEK_MS: [number, number] = [20_000, 50_000];

const between = (rand: () => number, [a, b]: [number, number]) => a + rand() * (b - a);

export class Mischief {
  private nextZap: number;
  private readonly rand: () => number;

  constructor(now: number, rand: () => number = Math.random) {
    this.rand = rand;
    this.nextZap = now + between(rand, ZAP_GAP_MS);
  }

  /** The pointer at `dist` px from her: zap it now? At most once per gap, and only some of the times it's in range. */
  zap(now: number, dist: number, idle: boolean): boolean {
    if (!idle || now < this.nextZap || dist < ZAP_NEAR[0] || dist > ZAP_NEAR[1]) return false;
    this.nextZap = now + between(this.rand, ZAP_GAP_MS) * (this.rand() < ZAP_CHANCE ? 1 : 0.15); // missed: try again soon
    return this.nextZap - now >= ZAP_GAP_MS[0];
  }
}

export type Edge = "left" | "right" | "top";

export interface PeekPose {
  edge: Edge;
  cx: number; // where the middle of her canvas goes, page px
  cy: number;
  rot: number; // degrees, clockwise
  flip: boolean; // mirrored, to face into the screen from the right
}

/** Another edge than `except`, at random. */
export function pickEdge(rand: () => number, except?: Edge): Edge {
  const edges = (["left", "right", "top"] as Edge[]).filter((e) => e !== except);
  return edges[Math.floor(rand() * edges.length)];
}

/** Half hidden at a side, leaning in; or hanging upside down from the top. `u` 0..1 picks the spot along it. */
export function peekPose(edge: Edge, w: number, h: number, u: number): PeekPose {
  switch (edge) {
    case "left":
      return { edge, cx: 6, cy: h * (0.3 + 0.4 * u), rot: 22, flip: false };
    case "right":
      return { edge, cx: w - 6, cy: h * (0.3 + 0.4 * u), rot: -22, flip: true };
    case "top":
      return { edge, cx: w * (0.2 + 0.6 * u), cy: 60, rot: 180, flip: false };
  }
}

/** The pointer is close enough to scare her off her edge. */
export function shy(pose: PeekPose, cursor: [number, number] | null): boolean {
  return !!cursor && Math.hypot(cursor[0] - pose.cx, cursor[1] - pose.cy) < SHY_NEAR;
}
