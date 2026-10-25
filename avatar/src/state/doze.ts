// Asleep for real: after a long while with nobody at the PC and nobody talking to her, she comes
// apart (shards, the drawing dissolving) and all that's left is her green mask, eyes shut, floating
// where her head was. Now and then she cracks one eye open. A pointer coming close stirs her; closer,
// a click, a message or something to say, and her eyes snap open and she comes back together.
// Pure logic: phases and eyes over time (render/mask.ts draws them).

export type DozePhase = "awake" | "dozing" | "mask" | "waking";
export type Eyes = [number, number]; // how open each eye is, 0 shut .. 1 open

export const DOZE_OUT_MS = 700; // coming apart
export const WAKE_MS = 280; // eyes open, before she comes back together
export const LAND_MS = 70; // the mask arrives as one white drawing
export const PEEK_MS: [number, number] = [700, 1100];
export const PEEK_GAP_MS: [number, number] = [7000, 14000];
export const STIR = 0.35; // pointer close: eyes half open
export const PEEK = 0.45; // one eye cracked open

/** Time to sleep: `limitMs` (0 = never) without input on the PC and without talking to her. */
export function sleepy(limitMs: number, quietMs: number, pcIdleMs: number): boolean {
  return limitMs > 0 && quietMs >= limitMs && pcIdleMs >= limitMs;
}

export class Doze {
  phase: DozePhase = "awake";
  private since = 0;
  private nextPeek = Infinity;
  private peek: { eye: 0 | 1; until: number } | null = null;
  private readonly rand: () => number;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
  }

  private between([a, b]: [number, number]): number {
    return a + this.rand() * (b - a);
  }

  /** True while her body is gone or going (no clicks, no wandering). */
  get asleep(): boolean {
    return this.phase !== "awake";
  }

  start(now: number): void {
    if (this.phase !== "awake") return;
    this.phase = "dozing";
    this.since = now;
  }

  /** Eyes snap open; she's back after WAKE_MS. Coming apart, she just stops. */
  wake(now: number): void {
    if (this.phase === "mask") {
      this.phase = "waking";
      this.since = now;
    } else if (this.phase === "dozing") {
      this.phase = "awake";
    }
  }

  /** Advances the phases; returns the one she ended up in. */
  tick(now: number): DozePhase {
    if (this.phase === "dozing" && now - this.since >= DOZE_OUT_MS) {
      this.phase = "mask";
      this.since = now;
      this.peek = null;
      this.nextPeek = now + this.between([5000, 9000]);
    } else if (this.phase === "waking" && now - this.since >= WAKE_MS) {
      this.phase = "awake";
    }
    return this.phase;
  }

  /** The mask's first drawing: a flat white silhouette, like her impact frames. */
  landing(now: number): boolean {
    return this.phase === "mask" && now - this.since < LAND_MS;
  }

  /** How open her eyes are; `stirred` while the pointer is close. */
  eyes(now: number, stirred: boolean): Eyes {
    if (this.phase === "waking") return [1, 1];
    if (this.phase !== "mask") return [0, 0];
    if (!this.peek && now >= this.nextPeek) {
      this.peek = { eye: this.rand() < 0.5 ? 0 : 1, until: now + this.between(PEEK_MS) };
      this.nextPeek = now + this.between(PEEK_GAP_MS);
    }
    if (this.peek && now > this.peek.until) this.peek = null;
    if (stirred) return [STIR, STIR];
    const eyes: Eyes = [0, 0];
    if (this.peek) eyes[this.peek.eye] = PEEK;
    return eyes;
  }
}
