// Her portrait by what she says (state/faces.ts picks the face): a square of one of her shots from the
// show, on a violet offset copy, torn by a short glitch when the face changes.
import type { Still } from "./fx.ts";
import { swapGlitch } from "../state/faces.ts";

const VIOLET = "#8b38ff";

function hash(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class Portrait {
  private g: CanvasRenderingContext2D;
  private cur: Still | null = null;
  private prev: Still | null = null;
  private key = "";
  private since = -Infinity;

  constructor(private canvas: HTMLCanvasElement, private size = 56) {
    const dpr = devicePixelRatio || 1;
    canvas.width = canvas.height = Math.round(size * dpr);
    this.g = canvas.getContext("2d")!;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** A new face (`key` names it: the same one again does nothing). */
  set(key: string, still: Still | null, now: number): void {
    if (key === this.key || !still) return;
    this.prev = this.cur;
    this.cur = still;
    this.key = key;
    this.since = now;
  }

  /** Draws it; true while it still changes (the glitch), so the caller can stop redrawing after. */
  draw(now: number): boolean {
    const g = this.g, s = this.size;
    const gl = swapGlitch(now - this.since);
    const face = gl.old && this.prev ? this.prev : this.cur;
    g.clearRect(0, 0, s, s);
    if (!face) return false;
    const { sx, sy, sw: side } = face; // a square around her face (faces.ts faceSquare)
    g.imageSmoothingEnabled = !face.shadow; // her pixel faces stay pixels
    if (face.shadow) g.drawImage(face.shadow, sx, sy, side, side, 2, 2, s - 2, s - 2);
    else {
      g.fillStyle = VIOLET; // her misregistered violet copy, like in the show
      g.fillRect(2, 2, s - 2, s - 2);
    }
    g.drawImage(face.img, sx, sy, side, side, 0, 0, s - 2, s - 2);
    if (gl.split) {
      const seed = Math.floor(now / 40);
      g.globalCompositeOperation = "screen";
      g.globalAlpha = 0.6;
      g.drawImage(face.img, sx, sy, side, side, gl.split, 0, s - 2, s - 2); // colours pulled apart
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      for (let i = 0; i < gl.bands; i++) { // displaced bands
        const y = Math.floor(hash(i, seed) * (s - 8)), h = 3 + Math.floor(hash(i, seed + 7) * 6);
        const dx = (hash(i, seed + 3) - 0.5) * 4 * gl.split;
        g.drawImage(this.canvas, 0, y * (devicePixelRatio || 1), this.canvas.width, h * (devicePixelRatio || 1), dx, y, s, h);
      }
    }
    return gl.split > 0;
  }
}
