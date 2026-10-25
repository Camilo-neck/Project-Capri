// When and how hard Capri glitches: a pure function of time, fed to the glitch filter
// (shaders/filters.ts). One effect at a time; idle twitches only fill quiet moments.
import { POSE_MS } from "./avatar.ts";

export type GlitchKind = "twitch" | "change" | "poke" | "hurt" | "vanish" | "arrive";
export type RGBA = [number, number, number, number];

export interface Glitch {
  glitch: number; // 0..1, share of displaced bands and how far they move
  split: number; // RGB split, native px
  sil: RGBA; // flat silhouette color, a = how much
  collapse: number; // 0..1, squeezed into a vertical line; 1 = gone
  dissolve: number; // 0..1, share of the body broken into missing cells
}

export const OFF: Glitch = { glitch: 0, split: 0, sil: [0, 0, 0, 0], collapse: 0, dissolve: 0 };
const INK: RGBA = [0.08, 0.06, 0.11, 1];
const RED: RGBA = [1, 0.13, 0.32, 1];
const GREEN: RGBA = [0.21, 1, 0.48, 1];

/** Teleport: she collapses in VANISH_OUT_MS, then stays gone until "arrive" (the window moves meanwhile). */
export const VANISH_OUT_MS = 220;
const ARRIVE_IN_MS = 200;

/** Length of each effect, ms. */
export const GLITCH_MS: Record<GlitchKind, number> = {
  twitch: 2 * POSE_MS,
  change: 150,
  poke: 200,
  hurt: 500,
  vanish: 1500, // safety net: back even if "arrive" never comes
  arrive: ARRIVE_IN_MS + 2 * POSE_MS,
};

function shape(kind: GlitchKind, e: number): Glitch {
  const fade = 1 - e / GLITCH_MS[kind];
  switch (kind) {
    case "twitch":
      return { ...OFF, glitch: 0.25, split: 1 };
    case "change":
      return { ...OFF, glitch: 0.6 * fade, split: Math.round(2 * fade) };
    case "poke": // one impact frame, then a short shake
      return e < POSE_MS ? { ...OFF, sil: INK } : { ...OFF, glitch: 0.4 * fade, split: 1 };
    case "hurt":
      return e < POSE_MS ? { ...OFF, sil: RED } : { ...OFF, glitch: 0.8 * fade, split: Math.round(3 * fade) };
    case "vanish": {
      if (e >= VANISH_OUT_MS) return { ...OFF, collapse: 1 };
      const k = e / VANISH_OUT_MS;
      return { ...OFF, glitch: 0.4 + 0.5 * k, split: Math.round(1 + 2 * k), collapse: k * k, dissolve: 0.6 * k };
    }
    case "arrive": {
      if (e >= ARRIVE_IN_MS) return { ...OFF, sil: e < ARRIVE_IN_MS + POSE_MS ? GREEN : INK }; // two impact frames
      const k = 1 - e / ARRIVE_IN_MS;
      return { ...OFF, glitch: 0.5 * k, split: Math.round(2 * k), collapse: k * k, dissolve: 0.6 * k };
    }
  }
}

export class GlitchFx {
  private kind: GlitchKind | null = null;
  private start = -Infinity;
  private nextTwitch: number;
  private rand: () => number;

  constructor(now = 0, rand: () => number = Math.random) {
    this.rand = rand;
    this.nextTwitch = now + this.twitchGap();
  }

  private twitchGap(): number {
    return 5000 + this.rand() * 8000;
  }

  kick(kind: GlitchKind, now: number): void {
    this.kind = kind;
    this.start = now;
  }

  /** The effect at `now`. Twitches fire on schedule only while `idle` and nothing else plays. */
  at(now: number, idle: boolean): Glitch {
    let e = now - this.start;
    if (this.kind && e >= GLITCH_MS[this.kind]) this.kind = null;
    if (now >= this.nextTwitch) {
      this.nextTwitch = now + this.twitchGap();
      if (idle && !this.kind) {
        this.kick("twitch", now);
        e = 0;
      }
    }
    return this.kind ? shape(this.kind, Math.max(0, e)) : OFF;
  }
}
