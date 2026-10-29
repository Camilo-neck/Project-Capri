// Her face in pixel art for the transmission's portrait (Pixel style): a 28x28 drawing per emotion, from the
// same design as her body: a mass of neon red shard hair with glitter, a black head, the green two-panel mask
// with concentric eyes, a thin mouth. One letter per pixel, "." transparent. Pure; render/portrait.ts shows it.
import type { Emocion } from "../net/protocol.ts";

export const SIZE = 28;

export const FACE_PALETTE: Record<string, string> = {
  K: "#140a14", // black: head, folds, outline
  R: "#ff2457", // neon red hair
  r: "#b81d48", // its shade
  W: "#ffffff", // glitter, highlights, teeth
  G: "#16f46c", // mask
  g: "#0fa84a", // the rings of her eyes and the mask's shade
  B: "#1e7bff", // iris
  Y: "#fcee0a", // a spark
  P: "#ff7fa6", // a blush
  M: "#4a0820", // inside the mouth
};

type Grid = string[][];

const blank = (): Grid => Array.from({ length: SIZE }, () => Array<string>(SIZE).fill("."));

/** Stamps `rows` with its top-left at (x, y); "." leaves what's there. */
function put(g: Grid, x: number, y: number, rows: string[]): void {
  rows.forEach((row, dy) => [...row].forEach((c, dx) => {
    if (c !== "." && g[y + dy]?.[x + dx] !== undefined) g[y + dy][x + dx] = c;
  }));
}

const hash = (n: number) => {
  const v = Math.sin(n * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

/** The hair: a rounded mass with a torn edge, its shade on the lower half, specks of glitter. */
function hair(g: Grid): void {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x - 13.5) / 13.5, dy = (y - 13) / 13.5;
      const a = Math.atan2(dy, dx);
      const spike = ((a * 7) / Math.PI) % 1; // a saw-tooth of shards round the head
      const edge = 0.74 + 0.26 * Math.abs(spike < 0 ? spike + 1 : spike) ** 1.4;
      if (Math.hypot(dx, dy) < edge) g[y][x] = y > 20 && hash(x + y * 5) > 0.45 ? "r" : "R";
    }
  }
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(hash(i * 2.3) * SIZE), y = Math.floor(hash(i * 5.1 + 1) * SIZE);
    if (g[y][x] === "R" && (y < 8 || x < 7 || x > 20)) g[y][x] = "W";
  }
  // two lightning tips falling to the sides
  put(g, 1, 17, ["R.", "RR", ".R", ".R"]);
  put(g, 25, 17, [".R", "RR", "R.", "R."]);
}

/** The black head and the green mask in two panels with a notch between them. */
function mask(g: Grid): void {
  for (let y = 7; y < 25; y++) {
    const half = 7 - Math.max(0, y - 19) * 1.1; // the head narrows to a chin
    for (let x = 0; x < SIZE; x++) if (Math.abs(x - 13.5) < half) g[y][x] = "K";
  }
  for (const x0 of [8, 15]) {
    for (let y = 11; y < 18; y++) for (let x = x0; x < x0 + 5; x++) g[y][x] = "G";
  }
  put(g, 8, 11, ["K"]); // the panels' outer top corners and inner bottom corners are cut
  put(g, 19, 11, ["K"]);
  put(g, 12, 17, ["K"]);
  put(g, 15, 17, ["K"]);
  put(g, 8, 17, ["g"]);
  put(g, 19, 17, ["g"]);
}

// 5x5 eyes for the viewer's left; the right is the mirror image. g: ring, B: iris, W: highlight, K: folds.
const EYES: Record<string, string[]> = {
  open: ["KgggK", "gBBBg", "gBWBg", "gBBBg", "KgggK"],
  wide: ["KgggK", "gWWWg", "gWBWg", "gWWWg", "KgggK"],
  shine: ["KgggK", "gBWBg", "gBBBg", "gBWBg", "KgggK"],
  happy: [".....", ".KKK.", "K...K", ".....", "....."],
  up: ["KgggK", "gBWBg", "gBBBg", "gGGGg", "KgggK"],
  side: ["KgggK", "gGBBg", "gGBWg", "gGBBg", "KgggK"],
  half: ["KKKKK", "gBBBg", "gBWBg", ".ggg.", "....."],
  angry: ["KKK..", "gKKKg", "gBWBg", "gBBBg", ".ggg."],
  sad: ["..KKK", "gKKKg", "gBBBg", "gBWBg", ".ggg."],
  flat: ["KKKKK", "gBBBg", "gBWBg", "gBBBg", ".ggg."],
};
const mirror = (rows: string[]) => rows.map((r) => [...r].reverse().join(""));

function eyes(g: Grid, left: string, right: string, rise = 0): void {
  put(g, 8, 12 + rise, EYES[left]);
  put(g, 15, 12, right === "angry" || right === "sad" ? mirror(EYES[right]) : EYES[right]);
}

const MOUTH: Record<string, string[]> = {
  zigzag: ["W.W.W.W", ".W.W.W."],
  grin: ["WWWWWWWWW", ".WKWKWKW.", "..WWWWW.."],
  smirk: [".......W", "W.W.W.W.", ".W.W...."],
  o: [".WW.", "WMMW", ".WW."],
  flat: ["WWWWWW"],
  frown: [".WWWW.", "W....W"],
  small: ["W.W.W"],
};

function mouth(g: Grid, kind: string, dx = 0): void {
  const rows = MOUTH[kind];
  put(g, 14 - Math.floor(rows[0].length / 2) + dx, 19, rows);
}

const FACES: Record<Emocion, (g: Grid) => void> = {
  neutral: (g) => (eyes(g, "open", "open"), mouth(g, "zigzag")),
  feliz: (g) => (eyes(g, "happy", "happy"), mouth(g, "grin")),
  emocionada: (g) => (eyes(g, "shine", "shine"), mouth(g, "grin"), put(g, 22, 8, [".Y.", "YWY", ".Y."])),
  traviesa: (g) => (eyes(g, "half", "open"), mouth(g, "smirk", 1)),
  curiosa: (g) => (eyes(g, "wide", "open"), mouth(g, "small")),
  pensativa: (g) => (eyes(g, "up", "up"), mouth(g, "small", 2)),
  sorprendida: (g) => (eyes(g, "wide", "wide"), mouth(g, "o")),
  molesta: (g) => (eyes(g, "angry", "angry"), mouth(g, "flat")),
  triste: (g) => (eyes(g, "sad", "sad"), mouth(g, "frown")),
  seria: (g) => (eyes(g, "flat", "flat"), mouth(g, "flat")),
};

/** The face for how she feels: 28 rows of 28 letters (FACE_PALETTE). */
export function faceGrid(e: Emocion): string[] {
  const g = blank();
  hair(g);
  mask(g);
  FACES[e](g);
  return g.map((r) => r.join(""));
}
