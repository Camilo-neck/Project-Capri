// Her intro, when she starts: she grabs your screen by its edges, says hi, waves, lets go and dives
// down to where she stands. Adapted from mochiiwuff/capri-desktop's intro (fx.js). Pure logic: what
// happens on each drawing, at 24 a second (render/intro.ts draws it; its moves follow the clock in
// between, its drawings change on whole frames like cels).

export const FRAME_MS = 1000 / 24;
// when things happen, in drawings
export const T = { hands: 6, right: 8, reach: 10, grab: 16, hold: 21, blink: 29, hi: 34, wave: 46, regrab: 63, happy: 65,
  glance: 75, slip: 80, antic: 86, shrink: 88, land: 98, end: 101 } as const;
export const LAND = T.land; // her face reaches her spot: her body comes back there
export const STILL_LAND = T.slip + 4; // without animations: once she's faded out
export const END = T.end;

// her close-up's drawings (assets/intro/<name>.webp): the same picture with only her mouth, her eyes
// or her right arm changed
export type Cel = "grab" | "mouth1" | "mouth2" | "mouth3" | "wave1" | "wave2" | "wave3" | "smear" | "happy";
export const CELS: Cel[] = ["grab", "mouth1", "mouth2", "mouth3", "wave1", "wave2", "wave3", "smear", "happy"];
// "hola", from her mouth starting to open (two drawings each)
const SAY_HI: Cel[] = ["mouth1", "mouth1", "mouth3", "mouth3", "mouth3", "mouth3", "mouth2", "mouth2", "mouth1", "mouth1"];
// the wave, three drawings each: her hand tilted left, up, right, up, left
const WAVE: Cel[] = ["wave1", "wave3", "wave2", "wave3", "wave1"];

export type Phase = "edges" | "hands" | "reach" | "hit" | "hold" | "slip" | "antic" | "dive" | "slit" | "done";

export function phaseAt(frame: number): Phase {
  if (frame < T.hands) return "edges"; // the edges of the screen crackle red
  if (frame < T.reach) return "hands"; // her left hand slams onto an edge, then her right
  if (frame < T.grab) return "reach"; // her arms reach in along them as she hauls herself up
  if (frame < T.hold) return "hit"; // her face hits the glass
  if (frame < T.slip) return "hold"; // she looks around, says hi, waves
  if (frame < T.antic) return "slip"; // she lets go, her arms in shards
  if (frame < T.shrink) return "antic"; // a crouch to take off
  if (frame < T.land) return "dive"; // down to her spot
  if (frame < T.land + 2) return "slit"; // closing into a slit where her face will be
  return "done";
}

/** Which drawing shows while she holds on. */
export function celAt(frame: number): Cel {
  if (frame >= T.wave && frame < T.wave + 2) return "smear"; // her arm off the edge
  if (frame >= T.wave + 2 && frame < T.regrab) return WAVE[Math.floor((frame - T.wave - 2) / 3)] ?? "wave1";
  if (frame >= T.regrab && frame < T.happy) return "smear"; // and back onto it
  if (frame >= T.happy && frame < T.glance) return "happy"; // her eyes shut with joy
  return (frame >= T.hi && SAY_HI[frame - T.hi]) || "grab";
}

/** Where her eyes look (picture px): centred as she lands, left, right, on you, then toward her spot
 * (`tx`, `ty`: -1 or 1, the way it lies). */
export function lookAt(frame: number, tx: number, ty: number): { x: number; y: number } {
  const since = frame - T.hold;
  if (since < 3) return { x: 0, y: 0 };
  if (since < 7) return { x: -10, y: -3 };
  if (since < 11) return { x: 10, y: -4 };
  if (frame >= T.glance) return { x: tx * 10, y: ty * 7 };
  return { x: 0, y: 3 };
}

/** How open her eyes are: one blink. */
export function openAt(frame: number): number {
  const b = frame - T.blink;
  return b === 0 || b === 3 ? 0.5 : b === 1 || b === 2 ? 0 : 1;
}

// open: the screen's edges start crackling · crackle: around her hands · hand: one slams onto an edge
// lines: speed lines as she hauls up · grab: her face hits the glass · hi · wave · slip: she lets go
// land: her face reached her spot
export type Cue = "open" | "crackle" | "hand" | "lines" | "grab" | "hi" | "wave" | "slip" | "land";

/** What happens on the drawings after `from` up to `to` (each once, however the frames come). */
export function cuesBetween(from: number, to: number, still: boolean): Cue[] {
  const out: Cue[] = [];
  for (let f = from + 1; f <= to; f++) {
    if (f === 0) out.push("open");
    if (!still) {
      if (f === 3) out.push("crackle");
      if (f === T.hands || f === T.right) out.push("hand");
      if (f === T.reach + 3) out.push("lines");
    }
    if (f === T.grab) out.push("grab");
    if (f === T.hi + 2) out.push("hi"); // her mouth wide open
    if (f === T.wave) out.push("wave");
    if (f === T.happy && !still) out.push("hand"); // her hand back on the edge
    if (f === T.slip) {
      if (!still) out.push("crackle"); // her hands let go of the edges
      out.push("slip");
    }
    if (f === (still ? STILL_LAND : LAND)) out.push("land");
  }
  return out;
}

/** Without animations (Windows has them off): she fades in and out where she is, in four steps each way. */
export function stillAlpha(frame: number): number {
  if (frame < 4) return (frame + 1) / 4;
  if (frame >= T.slip) return Math.max(0, 1 - (frame - T.slip + 1) / 4);
  return 1;
}
