// Paints a Pose as pixel art: each body part is drawn with canvas shapes at native
// resolution, made crisp, outlined in black, and stacked; the face is stamped on top.
import { crisp, glitch, hexToRgb, outline, over, type RGB } from "./raster.ts";
import { GROUND, H, solve, W, type Fx, type Joints, type Pose, type Pt } from "./rig.ts";
import { eyeStamp, FX_STAMPS, MOUTHS, PALETTE, type Stamp } from "./stamps.ts";

const COLOR = PALETTE;
const PAL: RGB[] = Object.values(PALETTE).map(hexToRgb);
const K = hexToRgb(PALETTE.K);
const palettes = new Map<string, RGB[]>();
/** Palette from palette letters, e.g. "HhK". */
function paletteOf(letters: string): RGB[] {
  let p = palettes.get(letters);
  if (!p) palettes.set(letters, (p = letters.split("").map((ch) => hexToRgb(PALETTE[ch]))));
  return p;
}

// Head-local shapes (origin = head center, y down, unrotated).
const FACE: Pt[] = [[-9, -6], [-8, -9], [0, -10], [8, -9], [9, -6], [9, 1], [7, 5], [3, 8], [0, 9], [-3, 8], [-7, 5], [-9, 1]];
// Magenta tufts over the forehead, drawn without outline so they merge with the hair mass.
const FRINGE: Pt[] = [
  [-11, -3], [-12, -9], [-8, -13], [-2, -15], [4, -15], [9, -12], [12, -8], [11, -3],
  [9, -6], [7, -4], [5, -7], [2, -5], [0, -7], [-2, -5], [-5, -7], [-7, -4], [-9, -6],
];
// Thin black jagged mask over the eyes, with a spike dropping between them.
const VISOR: Pt[] = [
  [-10, -6], [10, -6], [10, -3], [8, -4], [6, -2], [4, -4], [2, -3], [0, 2],
  [-2, -3], [-4, -4], [-6, -2], [-8, -4], [-10, -3],
];
// Voluminous mass: shard tufts along a rounded top (no horns), flicks at the sides, tips to the shoulders.
const HAIR: Pt[] = [
  [0, -21], [5, -22], [9, -20], [13, -21], [16, -18], [19, -18], [19, -15], [22, -13], [26, -12],
  [22, -9], [23, -5], [27, -3], [22, -1], [22, 3], [25, 7], [21, 7], [19, 11], [16, 10], [15, 15], [11, 10], [9, 9],
  [-9, 9], [-11, 10], [-15, 15], [-16, 10], [-19, 11], [-21, 7], [-25, 7], [-22, 3], [-22, -1], [-27, -3],
  [-23, -5], [-22, -9], [-26, -12], [-22, -13], [-19, -15], [-19, -18], [-16, -18], [-13, -21],
  [-9, -20], [-5, -22],
];
const STRANDS: Pt[][] = [
  [[-16, -14], [-13, -8], [-14, 1], [-17, 6]],
  [[16, -14], [13, -8], [14, 1], [17, 6]],
  [[-6, -18], [-3, -15]],
  [[5, -19], [8, -16]],
];
const EYE_L: Pt = [-5, 1];
const EYE_R: Pt = [5, 1];
const MOUTH_AT: Pt = [0, 6];

// Torso-local (origin = pelvis, y up is negative, unrotated).
const TORSO: Pt[] = [[-5, 0], [5, 0], [4, -4], [3, -7], [6, -12], [6, -14], [-6, -14], [-6, -12], [-3, -7], [-4, -4]];
const TORSO_PANEL: Pt[] = [[-3, -7], [3, -12], [6, -12], [0, -5]];
const TORSO_HIP: Pt[] = [[-5, 0], [-1, 0], [-4, -4]];
const TORSO_SHADE: Pt[] = [[3, -7], [4, -4], [5, 0], [2, 0]];
const COLLAR: Pt[] = [[-3, -14], [3, -14], [0, -11]];

const rot = ([x, y]: Pt, deg: number): Pt => {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
};
const place = (local: Pt, origin: Pt, deg: number): Pt => {
  const [x, y] = rot(local, deg);
  return [origin[0] + x, origin[1] + y];
};

function poly(c: CanvasRenderingContext2D, pts: Pt[], color: string): void {
  c.fillStyle = color;
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fill();
}

/** Tapered limb from a to b with rounded joints. */
function limb(c: CanvasRenderingContext2D, a: Pt, b: Pt, wa: number, wb: number, color: string): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  poly(c, [
    [a[0] + (nx * wa) / 2, a[1] + (ny * wa) / 2],
    [b[0] + (nx * wb) / 2, b[1] + (ny * wb) / 2],
    [b[0] - (nx * wb) / 2, b[1] - (ny * wb) / 2],
    [a[0] - (nx * wa) / 2, a[1] - (ny * wa) / 2],
  ], color);
  c.beginPath();
  c.arc(a[0], a[1], wa / 2, 0, Math.PI * 2);
  if (wb > 1.5) c.arc(b[0], b[1], wb / 2, 0, Math.PI * 2);
  c.fill();
}

export class Painter {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer: CanvasRenderingContext2D;
  private frame = new Uint8ClampedArray(W * H * 4);
  private squashT: (p: Pt) => Pt = (p) => p;

  constructor(doc: Document = document) {
    this.canvas = doc.createElement("canvas");
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    const l = doc.createElement("canvas");
    l.width = W;
    l.height = H;
    this.layer = l.getContext("2d", { willReadFrequently: true })!;
  }

  /**
   * Draws one part with canvas shapes, then makes it crisp (snapping to the part's own colors, so
   * anti-aliased edges never turn into stray grays) and outlined, and stacks it on the frame.
   */
  private part(draw: (c: CanvasRenderingContext2D) => void, opts: { outline?: boolean; raw?: boolean; colors?: string } = {}): void {
    const c = this.layer;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    c.setTransform(this.xform[0], 0, 0, this.xform[1], this.xform[2], this.xform[3]);
    draw(c);
    const img = c.getImageData(0, 0, W, H);
    if (!opts.raw) {
      crisp(img.data, opts.colors ? paletteOf(opts.colors) : PAL);
      if (opts.outline !== false) outline(img.data, W, H, K);
    }
    over(this.frame, img.data);
  }

  private xform: [number, number, number, number] = [1, 1, 0, 0];

  private stamp(s: Stamp, at: Pt, center = true): void {
    const [cx, cy] = this.squashT(at);
    const x0 = Math.round(cx - (center ? s[0].length / 2 : 0));
    const y0 = Math.round(cy - (center ? s.length / 2 : 0));
    for (let y = 0; y < s.length; y++) {
      for (let x = 0; x < s[y].length; x++) {
        const ch = s[y][x];
        if (ch === ".") continue;
        const px = x0 + x;
        const py = y0 + y;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const [r, g, b] = hexToRgb(COLOR[ch]);
        const i = (py * W + px) * 4;
        this.frame[i] = r;
        this.frame[i + 1] = g;
        this.frame[i + 2] = b;
        this.frame[i + 3] = 255;
      }
    }
  }

  paint(p: Pose, time: number, glitchAmount = 0): void {
    this.frame.fill(0);
    const j = solve(p);
    // Squash and stretch around her feet, widening as she flattens.
    const sy = p.squash;
    const sx = 1 + (1 - sy) * 0.8;
    const cx = j.pelvis[0];
    this.xform = [sx, sy, cx * (1 - sx), GROUND * (1 - sy)];
    this.squashT = ([x, y]) => [x * sx + cx * (1 - sx), y * sy + GROUND * (1 - sy)];

    const back = p.fx.filter((f) => f.kind === "shadow");
    for (const f of back) this.shadow(f, j);
    this.part((c) => this.hair(c, p, j, time), { colors: "Hh" });
    if (p.armsBehind) this.part((c) => this.arms(c, j), { colors: "GN" });
    this.part((c) => this.legs(c, j), { colors: "GNR" });
    this.part((c) => this.torso(c, j), { colors: "RrNG" });
    if (!p.armsBehind) this.part((c) => this.arms(c, j), { colors: "GN" });
    this.part((c) => this.head(c, j), { colors: "GK" });
    this.part((c) => this.fringe(c, j), { colors: "H", outline: false });
    this.face(p, j);
    for (const f of p.fx) this.effect(f, j, p);
    glitch(this.frame, W, H, glitchAmount, Math.floor(time / 60));
    this.ctx.putImageData(new ImageData(this.frame, W, H), 0, 0);
  }

  /** Bounding box of the opaque pixels of the last frame (native px), for mouse hit-testing. */
  bounds(): { x: number; y: number; w: number; h: number } | null {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (this.frame[(y * W + x) * 4 + 3] < 200) continue; // ignore the translucent shadow
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  private hair(c: CanvasRenderingContext2D, p: Pose, j: Joints, time: number): void {
    // Puffs out and wobbles a little with p.hair; always breathes slightly.
    const puff = 1 + p.hair * 0.1;
    const pts = HAIR.map(([x, y], i): Pt => {
      const wob = Math.sin(time / 260 + i * 1.7) * (0.4 + p.hair * 0.9);
      return [x * puff + wob * 0.6, (y + 4) * puff - 4 + wob * 0.5];
    }).map((q) => place(q, j.headCenter, j.headAngle));
    poly(c, pts, COLOR.H);
    c.strokeStyle = COLOR.h;
    c.lineWidth = 1.2;
    for (const s of STRANDS) {
      c.beginPath();
      s.map((q) => place(q, j.headCenter, j.headAngle)).forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.stroke();
    }
  }

  private legs(c: CanvasRenderingContext2D, j: Joints): void {
    limb(c, j.hipL, j.kneeL, 5, 4, COLOR.G);
    limb(c, j.kneeL, j.footL, 4, 1, COLOR.N);
    limb(c, j.hipR, j.kneeR, 5, 4, COLOR.R);
    limb(c, j.kneeR, j.footR, 4, 1, COLOR.R);
  }

  private torso(c: CanvasRenderingContext2D, j: Joints): void {
    const t = (pts: Pt[]) => pts.map((q) => place(q, j.pelvis, j.torsoAngle));
    limb(c, j.neck, place([0, -3], j.neck, j.headAngle), 3, 3, COLOR.G);
    poly(c, t(TORSO), COLOR.R);
    poly(c, t(TORSO_SHADE), COLOR.r);
    poly(c, t(TORSO_PANEL), COLOR.N);
    poly(c, t(TORSO_HIP), COLOR.N);
    poly(c, t(COLLAR), COLOR.G);
  }

  private arms(c: CanvasRenderingContext2D, j: Joints): void {
    for (const [s, e, h] of [[j.shoulderL, j.elbowL, j.handL], [j.shoulderR, j.elbowR, j.handR]] as Pt[][]) {
      limb(c, s, e, 3, 3, COLOR.G);
      limb(c, e, h, 3, 2, COLOR.N);
      c.beginPath();
      c.arc(h[0], h[1], 1.6, 0, Math.PI * 2);
      c.fill();
    }
  }

  private head(c: CanvasRenderingContext2D, j: Joints): void {
    const h = (pts: Pt[]) => pts.map((q) => place(q, j.headCenter, j.headAngle));
    poly(c, h(FACE), COLOR.G);
    poly(c, h(VISOR), COLOR.K);
  }

  private fringe(c: CanvasRenderingContext2D, j: Joints): void {
    poly(c, FRINGE.map((q) => place(q, j.headCenter, j.headAngle)), COLOR.H);
  }

  private face(p: Pose, j: Joints): void {
    const at = (q: Pt) => place(q, j.headCenter, j.headAngle);
    this.stamp(eyeStamp(p.eyes, -1, p.look), at(EYE_L));
    this.stamp(eyeStamp(p.eyesR ?? p.eyes, 1, p.look), at(EYE_R));
    this.stamp(MOUTHS[p.mouth], at(MOUTH_AT));
    if (p.blush) {
      this.stamp(["PP"], at([-7, 4]));
      this.stamp(["PP"], at([7, 4]));
    }
  }

  private shadow(f: Fx, j: Joints): void {
    const size = f.size ?? 1;
    this.part((c) => {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = "rgba(10, 4, 16, 0.35)";
      c.beginPath();
      c.ellipse(Math.round(j.pelvis[0]), GROUND + 1, 11 * size, 2.2 * size, 0, 0, Math.PI * 2);
      c.fill();
    }, { raw: true });
  }

  /** Floating effects and props. Each animates from its own clock f.t. */
  private effect(f: Fx, j: Joints, p: Pose): void {
    const head = j.headCenter;
    const t = f.t;
    const fx = (s: Stamp, at: Pt) => this.part((c) => {
      c.setTransform(1, 0, 0, 1, 0, 0);
      const x0 = Math.round(at[0] - s[0].length / 2);
      const y0 = Math.round(at[1] - s.length / 2);
      s.forEach((row, y) => row.split("").forEach((ch, x) => {
        if (ch === ".") return;
        c.fillStyle = COLOR[ch];
        c.fillRect(x0 + x, y0 + y, 1, 1);
      }));
    });
    switch (f.kind) {
      case "laptop": {
        // Lid seen from behind, resting on her lap; the hands type behind it.
        const [x, y] = j.pelvis;
        this.part((c) => {
          poly(c, [[x - 10, y - 12], [x + 10, y - 12], [x + 9, y + 1], [x - 9, y + 1]], COLOR.s);
          poly(c, [[x - 10, y - 12], [x + 10, y - 12], [x + 10, y - 11], [x - 10, y - 11]], COLOR.S);
          c.fillStyle = COLOR.G;
          c.fillRect(Math.round(x - 1), Math.round(y - 7), 2, 2);
        }, { colors: "SsG" });
        break;
      }
      case "keys": {
        // little sparks over the keyboard edge while typing
        const k = Math.floor(t / 90);
        const x = j.pelvis[0] - 7 + ((k * 7) % 14);
        if (k % 3 !== 2) this.stamp(FX_STAMPS.key, [x, j.pelvis[1] - 13]);
        break;
      }
      case "zzz":
        for (let k = 0; k < 3; k++) {
          const ph = (t / 1600 + k / 3) % 1;
          if (ph < 0.85) fx(FX_STAMPS.z, [head[0] + 8 + ph * 8, head[1] - 12 - ph * 16]);
        }
        break;
      case "hearts":
        for (let k = 0; k < 3; k++) {
          const ph = (t / 1500 + k / 3) % 1;
          if (ph < 0.8) fx(FX_STAMPS.heart, [head[0] + (k - 1) * 10 + Math.sin(ph * 9) * 2, head[1] - 10 - ph * 18]);
        }
        break;
      case "question":
        fx(FX_STAMPS.question, [head[0] + 15, head[1] - 16 + Math.round(Math.sin(t / 250))]);
        break;
      case "exclaim":
        if (t > 120) fx(FX_STAMPS.exclaim, [head[0] + 14, head[1] - 18 - (t < 300 ? 2 : 0)]);
        break;
      case "anger":
        if (Math.floor(t / 350) % 3 !== 2) fx(FX_STAMPS.anger, [head[0] + 11, head[1] - 12]);
        break;
      case "tear": {
        const ph = (t % 1400) / 1400;
        const eye = place(EYE_L, head, j.headAngle);
        if (ph < 0.7) fx(FX_STAMPS.tear, [eye[0] - 2, eye[1] + 3 + ph * 16]);
        break;
      }
      case "sparkles":
        for (let k = 0; k < 3; k++) {
          const slot = Math.floor(t / 350) + k * 7;
          const r1 = Math.abs(Math.sin(slot * 12.99) * 437.5) % 1;
          const r2 = Math.abs(Math.sin(slot * 78.23) * 437.5) % 1;
          if ((Math.floor(t / 175) + k) % 2) fx(FX_STAMPS.sparkle, [p.x - 24 + r1 * 48, GROUND - 60 + r2 * 50]);
        }
        break;
      case "stars":
        for (let k = 0; k < 3; k++) {
          const a = t / 260 + (k * Math.PI * 2) / 3;
          fx(FX_STAMPS.sparkle, [head[0] + Math.cos(a) * 13, head[1] - 11 + Math.sin(a) * 4]);
        }
        break;
      case "dots": {
        const n = Math.floor(t / 400) % 4;
        for (let k = 0; k < n; k++) fx(FX_STAMPS.dot, [head[0] + 12 + k * 4, head[1] - 14]);
        break;
      }
      case "shadow":
        break; // drawn first, under everything
    }
  }
}
