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
