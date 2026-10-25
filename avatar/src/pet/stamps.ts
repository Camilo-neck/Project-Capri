// Hand-drawn pixel stamps. One letter per pixel, "." = transparent. Colors come from PALETTE.
import type { EyeKind, MouthKind } from "./rig.ts";

export const PALETTE: Record<string, string> = {
  K: "#140a14", // outline
  W: "#ffffff",
  B: "#2f7dff", // iris
  G: "#3fe07c", // skin
  g: "#22a85a", // skin shade
  H: "#b82060", // hair
  h: "#861445", // hair shade
  R: "#a61a4c", // suit
  r: "#6c0f30", // suit shade
  N: "#1f1622", // black suit parts (gloves, boots)
  P: "#ff4f8b", // hearts, blush
  Y: "#ffe066", // stars
  C: "#5ad1ff", // tears
  M: "#4a0820", // mouth inside
  S: "#77728a", // laptop
  s: "#3a3546", // laptop dark
  A: "#ff3344", // anger mark
  V: "#8b38ff", // glitch purple
};

export type Stamp = string[];

/** Open eye: sclera plus a 3x3 iris whose position follows the gaze. Built per call. */
export function openEye(ox: 0 | 1, oy: 0 | 1): Stamp {
  const rows = [".KKKK.", "KWWWWK", "KWWWWK", "KWWWWK", "KWWWWK", ".KKKK."].map((r) => r.split(""));
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) rows[1 + oy + y][1 + ox + x] = x === 2 && y === 0 ? "W" : "B";
  return rows.map((r) => r.join(""));
}

const EYES: Partial<Record<EyeKind, Stamp>> = {
  closed: ["......", "......", "KKKKKK", "......", "......", "......"],
  relaxed: ["......", "......", "K....K", ".KKKK.", "......", "......"],
  happy: ["......", "..KK..", ".K..K.", "K....K", "......", "......"],
  wink: ["KK....", "..KK..", "....KK", "..KK..", "KK....", "......"],
  heart: [".P..P.", "PPPPPP", "PPPPPP", ".PPPP.", "..PP..", "......"],
  spiral: ["KKKKK.", "K...K.", "K.K.K.", "K.KKK.", "K.....", "KKKKKK"],
  star: ["..YY..", ".YYYY.", "YYYYYY", ".YYYY.", ".Y..Y.", "......"],
  wide: [".KKKK.", "KWWWWK", "KWWWWK", "KWBBWK", "KWWWWK", ".KKKK."],
  angry: ["KK....", ".KKK..", "KWWKKK", "KWBBWK", "KWBBWK", ".KKKK."],
  sad: ["......", "...KKK", ".KKWWK", "KWBBWK", "KWBBWK", ".KKKK."],
  focused: ["......", "KKKKKK", "KWBBWK", ".KKKK.", "......", "......"],
};

const mirror = (s: Stamp): Stamp => s.map((r) => r.split("").reverse().join(""));

/** Stamp for one eye. side: -1 = viewer's left eye, 1 = right. look: gaze -1..1. */
export function eyeStamp(kind: EyeKind, side: -1 | 1, look: [number, number]): Stamp {
  if (kind === "open" || kind === "up") {
    const lx = kind === "up" ? 0 : look[0];
    const ly = kind === "up" ? -1 : look[1];
    // At rest both irises sit toward the nose, which reads as looking at you.
    const ox: 0 | 1 = lx > 0.3 ? 1 : lx < -0.3 ? 0 : side < 0 ? 1 : 0;
    const oy: 0 | 1 = ly > 0.3 ? 1 : 0;
    return openEye(ox, oy);
  }
  const s = EYES[kind] ?? EYES.closed!;
  // Asymmetric stamps are drawn for the left eye; the right one is mirrored.
  const asymmetric = kind === "angry" || kind === "sad" || kind === "spiral";
  if (kind === "wink") return side > 0 ? mirror(s) : s;
  return asymmetric && side > 0 ? mirror(s) : s;
}

export const MOUTHS: Record<MouthKind, Stamp> = {
  smile: ["K....K", ".KKKK."],
  grin: ["KKKKKKK", "KWWWWWK", ".KWKWK.", "..KKK.."],
  flat: ["KKKK"],
  closed: ["KKK"],
  frown: [".KKKK.", "K....K"],
  smirk: [".....K", "KKKKK."],
  o: [".KK.", "KMMK", ".KK."],
  yawn: [".KKK.", "KMMMK", "KMMMK", "KMMMK", ".KKK."],
  wavy: [".K..K.", "K.KK.K"],
  teeth: ["KKKKKK", "KWWWWK", "KKKKKK"],
  A: [".KKKK.", "KMMMMK", "KMMMMK", ".KMMK.", "..KK.."],
  E: ["KKKKKK", "KWWWWK", "KMMMMK", ".KKKK."],
  O: [".KK.", "KMMK", "KMMK", ".KK."],
};

// Effect shapes: single color, the renderer adds the black outline.
export const FX_STAMPS = {
  z: ["WWWW", "..W.", ".W..", "WWWW"],
  heart: ["PP.PP", "PPPPP", ".PPP.", "..P.."],
  question: [".WW.", "W..W", "...W", "..W.", "....", "..W."],
  exclaim: ["WW", "WW", "WW", "WW", "..", "WW"],
  anger: [".A.A.", "AA.AA", ".....", "AA.AA", ".A.A."],
  tear: [".C", "CC", "CC"],
  sparkle: [".Y.", "YWY", ".Y."],
  dot: ["WW", "WW"],
  key: ["Y"],
} satisfies Record<string, Stamp>;
