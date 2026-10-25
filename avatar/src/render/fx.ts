// Screen-wide effects for the teleport: shards, the column of light where she leaves and lands,
// and the streak between the two spots. A 2D canvas over the whole overlay, drawn in chunky
// pixels like the sprite clips; its loop only runs while something is on it.

const PX = 2; // effect pixel, CSS px (same as a sprite-clip pixel)
const RED = "#ff2152";
const VIOLET = "#8b38ff";
const GREEN = "#36ff7a";
const WHITE = "#ffffff";
const SHARD_COLORS = [RED, RED, VIOLET, GREEN, WHITE];

const snap = (v: number) => Math.round(v / PX) * PX;

export type Rect = { x: number; y: number; w: number; h: number };

const EYE_RING = "#36ff7a";
const EYE_IRIS = "#3a5bff";
const INK = "#140f1c";

/** Small deterministic random sequence, so a frame's glitch can be redrawn the same. */
function mulberry(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two big eyes in the middle, smaller ones scattered around them. */
function eyeLayout(r: Rect): { x: number; y: number; r: number }[] {
  const big = Math.max(12, Math.min(r.w, r.h) * 0.09);
  const cx = r.x + r.w / 2, cy = r.y + r.h * 0.42;
  const eyes = [{ x: cx - big * 1.5, y: cy, r: big }, { x: cx + big * 1.5, y: cy, r: big }];
  const rand = mulberry(Math.round(r.w * 7 + r.h));
  for (let i = 0, tries = 0; i < 7 && tries < 80; tries++) {
    const e = { x: r.x + r.w * (0.1 + rand() * 0.8), y: r.y + r.h * (0.12 + rand() * 0.76), r: big * (0.35 + rand() * 0.3) };
    if (eyes.some((o) => Math.hypot(o.x - e.x, o.y - e.y) < (o.r + e.r) * 1.4)) continue;
    eyes.push(e);
    i++;
  }
  return eyes;
}

/** A pixel disc of radius `rad`, squashed vertically by `open` (0 shut .. 1 open). */
function disc(g: CanvasRenderingContext2D, x: number, y: number, rad: number, open: number, color: string): void {
  g.fillStyle = color;
  const cell = PX;
  for (let dy = -rad; dy <= rad; dy += cell) {
    const half = Math.sqrt(Math.max(0, rad * rad - dy * dy));
    g.fillRect(snap(x - half), snap(y + dy * open), snap(2 * half), cell);
  }
}

/** One of her eyes: green ring, blue almond iris, black pupil on the pointer, white glint. */
function eye(g: CanvasRenderingContext2D, x: number, y: number, r: number, open: number, at: [number, number] | null): void {
  disc(g, x, y, r + PX, open, INK);
  disc(g, x, y, r, open, EYE_RING);
  disc(g, x, y, r * 0.72, open, EYE_IRIS);
  let px = x, py = y;
  if (at) {
    const d = Math.hypot(at[0] - x, at[1] - y) || 1;
    const k = Math.min(1, d / 200) * r * 0.35;
    px += ((at[0] - x) / d) * k;
    py += ((at[1] - y) / d) * k * open;
  }
  disc(g, px, py, r * 0.3, open, INK);
  if (open > 0.6) {
    g.fillStyle = WHITE;
    g.fillRect(snap(px - r * 0.3), snap(py - r * 0.35), snap(r * 0.2) + PX, snap(r * 0.2) + PX);
  }
}

/** Her zigzag grin: a white sawtooth with an ink outline. */
function grin(g: CanvasRenderingContext2D, cx: number, y: number, w: number): void {
  const teeth = 4, tw = w / teeth, th = tw * 0.6;
  for (const [color, pad] of [[INK, PX], [WHITE, 0]] as const) {
    g.fillStyle = color;
    for (let i = 0; i < teeth * 2; i++) {
      // each half tooth as a staircase of pixel rows
      const x0 = cx - w / 2 + (i * tw) / 2;
      for (let s = 0; s <= th; s += PX) {
        const k = s / th;
        const xx = i % 2 === 0 ? x0 + (k * tw) / 2 : x0 + ((1 - k) * tw) / 2;
        g.fillRect(snap(xx - pad), snap(y + s - pad), 3 * PX + 2 * pad, 2 * PX + 2 * pad);
      }
    }
  }
}

interface Item {
  born: number;
  life: number;
  draw(g: CanvasRenderingContext2D, t: number): void; // t: 0..1 through its life
}

export class Fx {
  private g: CanvasRenderingContext2D;
  private items: Item[] = [];
  private running = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext("2d")!;
    this.resize();
    addEventListener("resize", () => this.resize());
  }

  private resize(): void {
    const dpr = devicePixelRatio || 1;
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private add(life: number, draw: Item["draw"]): void {
    this.items.push({ born: performance.now(), life, draw });
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this.frame);
    }
  }

  private frame = (now: number): void => {
    const g = this.g;
    g.clearRect(0, 0, innerWidth, innerHeight);
    this.items = this.items.filter((it) => {
      const t = (now - it.born) / it.life;
      if (t >= 1) return false;
      it.draw(g, Math.max(0, t));
      return true;
    });
    this.running = this.items.length > 0;
    if (this.running) requestAnimationFrame(this.frame);
  };

  /** Shards flying off a body centered at (x, y), or (inward) gathering into it. */
  burst(x: number, y: number, size: number, inward: boolean): void {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = size * (0.6 + Math.random() * 0.9);
      const start = inward ? dist : Math.random() * size * 0.25;
      const end = inward ? 0 : dist;
      const [w, h] = i % 3 === 0 ? [4 * PX, PX] : [2 * PX, 2 * PX];
      const color = SHARD_COLORS[i % SHARD_COLORS.length];
      this.add(inward ? 220 : 300, (g, t) => {
        const r = start + (end - start) * (inward ? t * t : 1 - (1 - t) * (1 - t));
        g.globalAlpha = t < 0.65 ? 1 : 0.5; // two steps, no smooth fade
        g.fillStyle = color;
        g.fillRect(snap(x + Math.cos(a) * r), snap(y + Math.sin(a) * r * 1.3), w, h);
        g.globalAlpha = 1;
      });
    }
  }

  /** A column of light from the top of the screen down to `ground` at x; `down`: it lands first. */
  beam(x: number, ground: number, down = false): void {
    const seg = 4 * PX;
    this.add(240, (g, t) => {
      const width = snap(28 * (1 - t)) + PX;
      const top = down ? 0 : ground * t * t; // leaving: it lifts off the ground; landing: it drops onto it
      const bottom = down ? ground * Math.min(1, t * 4) : ground;
      for (let y = snap(top); y < bottom; y += seg) {
        const jit = (Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0) * PX;
        const cx = snap(x) + jit;
        g.fillStyle = VIOLET;
        g.fillRect(cx - width / 2 - PX, y, width + 2 * PX, seg);
        g.fillStyle = RED;
        g.fillRect(cx - width / 2, y, width, seg);
        g.fillStyle = WHITE;
        g.fillRect(cx - PX, y, 2 * PX, seg);
      }
    });
  }

  /**
   * She's inside a window: its frame crackles, slices of it glitch, and it looks at you with her
   * eyes (all on the pointer) and her zigzag grin. Only drawn over it, never reads it; the parts of it
   * under windows in front (`covers`) are left alone.
   */
  possess(r: Rect, covers: () => Rect[], look: () => [number, number] | null, life = 2000): void {
    const eyes = eyeLayout(r);
    this.add(life, (g, t) => {
      const ms = t * life;
      const open = Math.min(1, ms / 300) * Math.min(1, (life - ms) / 250); // eyes open, then shut
      // glitch slices, a new set every 100 ms
      const slices = mulberry(Math.floor(ms / 100) + 1);
      for (let i = 0; i < 6; i++) {
        g.globalAlpha = 0.55;
        g.fillStyle = [RED, VIOLET, GREEN][i % 3];
        const y = r.y + slices() * r.h;
        const w = r.w * (0.2 + slices() * 0.5);
        g.fillRect(snap(r.x + slices() * (r.w - w)), snap(y), snap(w), PX * (1 + Math.floor(slices() * 3)));
      }
      g.globalAlpha = 1;
      // crackling frame
      const jag = mulberry(Math.floor(ms / 60) + 7);
      for (const [color, off] of [[VIOLET, 2 * PX], [RED, 0]] as const) {
        g.fillStyle = color;
        for (let x = r.x; x < r.x + r.w; x += 4 * PX) {
          g.fillRect(snap(x), snap(r.y + off + (jag() - 0.5) * 3 * PX), 4 * PX, PX);
          g.fillRect(snap(x), snap(r.y + r.h - off + (jag() - 0.5) * 3 * PX), 4 * PX, PX);
        }
        for (let y = r.y; y < r.y + r.h; y += 4 * PX) {
          g.fillRect(snap(r.x + off + (jag() - 0.5) * 3 * PX), snap(y), PX, 4 * PX);
          g.fillRect(snap(r.x + r.w - off + (jag() - 0.5) * 3 * PX), snap(y), PX, 4 * PX);
        }
      }
      // her eyes, opening one after another, and the grin under the big two
      const at = look();
      eyes.forEach((e, i) => {
        const o = Math.max(0, Math.min(1, open * 1.6 - i * 0.08));
        if (o > 0) eye(g, e.x, e.y, e.r, o, at);
      });
      if (open > 0.5) grin(g, r.x + r.w / 2, eyes[0].y + eyes[0].r * 1.7, eyes[0].r * 4.5);
      for (const c of covers()) g.clearRect(c.x, c.y, c.w, c.h);
    });
  }

  /** A streak of light from one spot to the other, in three misregistered colors. */
  streak(x1: number, y1: number, x2: number, y2: number): void {
    const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / PX);
    this.add(140, (g, t) => {
      const head = Math.min(1, t * 2.5); // shoots across, then the tail catches up
      const tail = Math.max(0, t * 2.5 - 1) / 1.5;
      for (const [color, dy] of [[VIOLET, 3 * PX], [RED, -2 * PX], [WHITE, 0]] as const) {
        g.fillStyle = color;
        for (let i = Math.floor(tail * n); i < head * n; i += 1) {
          const k = i / n;
          g.fillRect(snap(x1 + (x2 - x1) * k), snap(y1 + (y2 - y1) * k) + dy, PX, 2 * PX);
        }
      }
    });
  }
}
