// Her little tricks while she's idle (they work on any art style, they only move her canvas or draw over
// it): a pirouette, and juggling three glitch orbs. Pure logic: when, and what the picture does; main.ts and
// render/fx.ts draw it.

export type Trick = "spin" | "juggle";

export const GAP_MS: [number, number] = [60_000, 150_000]; // quiet time between two tricks
export const TRICK_MS: Record<Trick, number> = { spin: 900, juggle: 5400 };
export const JUGGLE_CYCLE_MS = 1800; // every orb is thrown twice (once from each hand) per cycle

export class Tricks {
  private at: number;
  private readonly rand: () => number;

  constructor(now: number, rand: () => number = Math.random) {
    this.rand = rand;
    this.at = now + this.gap();
  }

  private gap(): number {
    return GAP_MS[0] + this.rand() * (GAP_MS[1] - GAP_MS[0]);
  }

  /** The trick to do now, if it's time and she's `idle` (nothing to do, nobody needing her); the next gap
   * starts once that trick is over. */
  next(now: number, idle: boolean): Trick | null {
    if (!idle || now < this.at) return null;
    const trick: Trick = this.rand() < 0.5 ? "spin" : "juggle";
    this.at = now + TRICK_MS[trick] + this.gap();
    return trick;
  }
}

/** How wide she is, -1..1 (1: facing you), `t` 0..1 through a pirouette: a whole turn in pixel-sized steps,
 * never edge-on to nothing. */
export function spinScale(t: number): number {
  const v = Math.round(Math.cos(2 * Math.PI * t) * 5) / 5;
  return Math.max(0.1, Math.abs(v)) * (v < 0 ? -1 : 1);
}

/** Where the three orbs are `ms` into the act: x -1..1 (left hand to right hand), y 0..1 (in a hand to the top of its arc). */
export function juggleOrbs(ms: number): { x: number; y: number }[] {
  return [0, 1, 2].map((i) => {
    const phase = (ms / JUGGLE_CYCLE_MS + i / 3) % 1;
    const throwing = Math.floor(phase * 2);
    const u = (phase * 2) % 1;
    // the throws from one hand go higher: two orbs never share an arc as they cross
    return { x: (throwing ? 1 : -1) * (2 * u - 1), y: (throwing ? 0.7 : 1) * 4 * u * (1 - u) };
  });
}
