// Her sound effects as data: each one a few oscillator sweeps and noise bursts (sfx.ts plays them with WebAudio).
// Digital blips, falling and rising sweeps and a little static: Cyberpunk, in her palette. No files, no licences.

export type SfxKind =
  | "boot" | "vanish" | "arrive" | "tick" | "blip" | "hurt" | "poke" | "sleep" | "wake"
  | "alert" | "alert_red" | "click" | "notify" | "reminder" | "radio";

/** A sweep from f0 to f1 Hz, starting `at` ms in and lasting `ms`. */
export interface Tone { wave: OscillatorType; f0: number; f1: number; at: number; ms: number; gain: number }
/** A burst of static, high-passed at `high` Hz. */
export interface Noise { at: number; ms: number; gain: number; high: number }
export interface Recipe { tones: Tone[]; noise?: Noise[] }

const tone = (wave: OscillatorType, f0: number, f1: number, at: number, ms: number, gain: number): Tone => ({ wave, f0, f1, at, ms, gain });

export const RECIPES: Record<SfxKind, Recipe> = {
  // the chip going in, then her waking up: a stepped climb and a bright sweep
  boot: { tones: [tone("square", 220, 220, 0, 70, 0.12), tone("square", 330, 330, 90, 70, 0.12), tone("square", 440, 440, 180, 70, 0.12),
                  tone("sawtooth", 300, 1800, 280, 420, 0.14), tone("sine", 880, 1320, 560, 300, 0.12)], noise: [{ at: 0, ms: 60, gain: 0.1, high: 3000 }] },
  vanish: { tones: [tone("sawtooth", 1400, 120, 0, 220, 0.16), tone("square", 700, 60, 30, 190, 0.1)], noise: [{ at: 0, ms: 200, gain: 0.14, high: 1800 }] },
  arrive: { tones: [tone("sawtooth", 120, 1500, 0, 230, 0.14), tone("sine", 660, 990, 200, 140, 0.12)], noise: [{ at: 0, ms: 150, gain: 0.1, high: 2200 }] },
  tick: { tones: [tone("square", 1900, 1500, 0, 18, 0.05)] },
  blip: { tones: [tone("square", 880, 1175, 0, 55, 0.1)] },
  hurt: { tones: [tone("sawtooth", 220, 90, 0, 260, 0.18), tone("square", 110, 70, 0, 260, 0.1)], noise: [{ at: 0, ms: 160, gain: 0.14, high: 900 }] },
  poke: { tones: [tone("sine", 520, 780, 0, 90, 0.16), tone("sine", 780, 520, 90, 70, 0.1)] },
  sleep: { tones: [tone("sine", 660, 110, 0, 600, 0.12), tone("triangle", 330, 55, 80, 520, 0.08)] },
  wake: { tones: [tone("sine", 110, 660, 0, 380, 0.12), tone("square", 660, 990, 300, 90, 0.1)] },
  alert: { tones: [tone("square", 740, 740, 0, 110, 0.12), tone("square", 988, 988, 140, 140, 0.12)] },
  alert_red: { tones: [tone("sawtooth", 330, 330, 0, 140, 0.16), tone("sawtooth", 247, 247, 170, 140, 0.16), tone("sawtooth", 330, 330, 340, 140, 0.16)],
               noise: [{ at: 0, ms: 80, gain: 0.08, high: 2500 }] },
  click: { tones: [tone("square", 1200, 900, 0, 30, 0.08)] },
  notify: { tones: [tone("sine", 988, 988, 0, 90, 0.14), tone("sine", 1319, 1319, 110, 160, 0.14)] },
  reminder: { tones: [tone("sine", 784, 784, 0, 100, 0.14), tone("sine", 988, 988, 130, 100, 0.14), tone("sine", 1319, 1319, 260, 220, 0.14)] },
  radio: { tones: [tone("sawtooth", 200, 2400, 0, 120, 0.1), tone("square", 1760, 1760, 140, 60, 0.08)], noise: [{ at: 0, ms: 140, gain: 0.08, high: 3500 }] },
};

export const KINDS = Object.keys(RECIPES) as SfxKind[];

/** The shortest time between two of the same, ms: a typing tick may come often, the rest never pile up. */
export const GAP_MS: Record<SfxKind, number> = {
  boot: 0, vanish: 150, arrive: 150, tick: 55, blip: 120, hurt: 300, poke: 150, sleep: 500, wake: 500,
  alert: 400, alert_red: 400, click: 60, notify: 400, reminder: 400, radio: 400,
};

/** Total length of a recipe, ms. */
export function length(r: Recipe): number {
  return Math.max(0, ...r.tones.map((t) => t.at + t.ms), ...(r.noise ?? []).map((n) => n.at + n.ms));
}

const CEILING = 0.5; // the master gain at full volume: effects sit under her voice

/** The master gain for a volume of 0..100. */
export function gain(volume: number): number {
  return (Math.min(100, Math.max(0, volume)) / 100) * CEILING;
}
