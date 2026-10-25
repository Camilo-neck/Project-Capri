// When and how hard Capri glitches: a pure function of time, fed to the glitch filter
// (shaders/filters.ts). One effect at a time; idle twitches only fill quiet moments.
import { POSE_MS } from "./avatar.ts";

export type GlitchKind = "twitch" | "change" | "poke" | "hurt";
export type RGBA = [number, number, number, number];

export interface Glitch {
  glitch: number; // 0..1, share of displaced bands and how far they move
  split: number; // RGB split, native px
  sil: RGBA; // flat silhouette color, a = how much
}

export const OFF: Glitch = { glitch: 0, split: 0, sil: [0, 0, 0, 0] };
const INK: RGBA = [0.08, 0.06, 0.11, 1];
const RED: RGBA = [1, 0.13, 0.32, 1];

/** Length of each effect, ms. */
export const GLITCH_MS: Record<GlitchKind, number> = {
  twitch: 2 * POSE_MS,
  change: 150,
  poke: 200,
  hurt: 500,
};

function shape(kind: GlitchKind, e: number): Glitch {
  const fade = 1 - e / GLITCH_MS[kind];
  switch (kind) {
    case "twitch":
      return { glitch: 0.25, split: 1, sil: OFF.sil };
    case "change":
      return { glitch: 0.6 * fade, split: Math.round(2 * fade), sil: OFF.sil };
    case "poke": // one impact frame, then a short shake
      return e < POSE_MS ? { ...OFF, sil: INK } : { glitch: 0.4 * fade, split: 1, sil: OFF.sil };
    case "hurt":
      return e < POSE_MS ? { ...OFF, sil: RED } : { glitch: 0.8 * fade, split: Math.round(3 * fade), sil: OFF.sil };
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
    return this.kind ? shape(this.kind, e) : OFF;
  }
}
