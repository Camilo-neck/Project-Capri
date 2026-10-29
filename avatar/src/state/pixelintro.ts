// Her intro in the Pixel style, when she starts: she climbs up into the screen from below its edge (her edges
// crackling red), says hi and waves, crouches and dives down to her spot. A short one in her own pixels, not the
// show's close-up (state/intro.ts). Pure logic: when things happen; render/pixelintro.ts draws it.

// ms: [from, to] of each phase
export const T = {
  edges: [0, 400],
  rise: [400, 1100],
  hold: [1100, 3300],
  antic: [3300, 3600],
  dive: [3600, 4100],
  tag: 1300, // "¡HOLA!" pops
  caption: 1700, // its line starts to type
} as const;
export const END = T.dive[1];

export type Phase = "edges" | "rise" | "hold" | "antic" | "dive" | "done";

export function phaseAt(ms: number): Phase {
  if (ms < T.edges[1]) return "edges";
  if (ms < T.rise[1]) return "rise";
  if (ms < T.hold[1]) return "hold";
  return ms < T.antic[1] ? "antic" : ms < T.dive[1] ? "dive" : "done";
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** How far up she is, 0 (below the screen) to 1 (in place): fast at first, settling. */
export function rise(ms: number): number {
  const u = clamp01((ms - T.rise[0]) / (T.rise[1] - T.rise[0]));
  return 1 - (1 - u) ** 3;
}

/** How far down she is on her way to her spot, 0 to 1: slow to take off, then fast. */
export function dive(ms: number): number {
  const u = clamp01((ms - T.dive[0]) / (T.dive[1] - T.dive[0]));
  return u * u;
}

export type Cue = "open" | "crackle" | "hi" | "slip" | "land";

/** What happens after `from` up to `to` (ms), each once however the frames come. */
export function cuesBetween(from: number, to: number): Cue[] {
  const at: [Cue, number][] = [["open", 0], ["crackle", 100], ["hi", T.tag], ["slip", T.antic[0]], ["land", T.dive[1]]];
  return at.filter(([, t]) => t > from && t <= to || (t === 0 && from < 0)).map(([c]) => c);
}

/** How many characters of her line show: two every 40 ms from when it starts. */
export function captionChars(ms: number, length: number): number {
  return Math.min(length, Math.max(0, Math.floor((ms - T.caption) / 40) * 2));
}
