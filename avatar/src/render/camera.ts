// Camera mode's feed: her shots from the show (avatar/assets/camera) on a 2D canvas, with the slow
// push-in, the glitch of her filter redone in 2D (displaced bands, colour split, collapse, impact
// frames, missing cells), film grain, and her mask when she's asleep or static when there's no link.
import type { CameraFrame, ShotName } from "../state/camera.ts";
import { SHOTS } from "../state/camera.ts";
import type { Glitch } from "../state/glitch.ts";
import { drawMask, type MaskLook } from "./mask.ts";

export const FEED_W = 360;
export const FEED_H = 240;

const stripUrls = import.meta.glob("../../assets/camera/*.webp", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

function hash(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

export interface FeedLook {
  frame: CameraFrame | null;
  glitch: Glitch;
  seed: number;
  mask: MaskLook | null; // asleep: her mask instead of a shot
}

export class CameraView {
  private readonly g: CanvasRenderingContext2D;
  private strips: Partial<Record<ShotName, HTMLImageElement>> = {};
  private loading: Promise<void> | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = FEED_W;
    canvas.height = FEED_H;
    this.g = canvas.getContext("2d")!;
  }

  load(): Promise<void> {
    return (this.loading ??= (async () => {
      await Promise.all((Object.keys(SHOTS) as ShotName[]).map(async (name) => {
        const url = Object.entries(stripUrls).find(([path]) => path.endsWith(`/${name}.webp`))?.[1];
        if (url) this.strips[name] = await loadImage(url);
      }));
    })());
  }

  /** One frame of a shot, for a cut-in (null until the shots have loaded). */
  still(shot: ShotName, index = 0): { img: HTMLImageElement; sx: number; sy: number; sw: number; sh: number } | null {
    const img = this.strips[shot];
    return img ? { img, sx: Math.min(index, SHOTS[shot].frames - 1) * FEED_W, sy: 0, sw: FEED_W, sh: FEED_H } : null;
  }

  draw({ frame, glitch: gl, seed, mask }: FeedLook): void {
    const g = this.g;
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#0b0916";
    g.fillRect(0, 0, FEED_W, FEED_H);
    const strip = frame && this.strips[frame.shot];
    if (mask) {
      this.grain(seed, 0.35);
      drawMask(g, FEED_W / 2, FEED_H / 2 + 30, 1.1, mask);
    } else if (frame && strip && gl.collapse < 1) {
      this.shot(strip, frame, gl, seed);
    } else {
      this.grain(seed, 1); // no signal
    }
    if (!mask && frame) this.grain(seed, 0.12);
  }

  private shot(strip: HTMLImageElement, f: CameraFrame, gl: Glitch, seed: number): void {
    const g = this.g;
    // source rect: the frame's cell, cropped toward its centre by the push-in
    const sw = FEED_W / f.zoom, sh = FEED_H / f.zoom;
    const sx = f.index * FEED_W + (FEED_W - sw) / 2, sy = (FEED_H - sh) / 2;
    // teleport collapse: squeezed toward the middle
    const dw = FEED_W * (1 - gl.collapse), dx0 = (FEED_W - dw) / 2;
    const bandH = 6 + Math.floor(hash(seed, 7) * 14);
    for (let y = 0; y < FEED_H; y += bandH) {
      const h = Math.min(bandH, FEED_H - y);
      const band = y / bandH;
      const shift = hash(band, seed) < gl.glitch * 0.6 ? Math.round((hash(band + 3, seed) - 0.5) * 50 * gl.glitch) : 0;
      g.drawImage(strip, sx, sy + (y * sh) / FEED_H, sw, (h * sh) / FEED_H, dx0 + shift, y, dw, h);
    }
    if (gl.split > 0) {
      // the colours coming apart: a lightened ghost on each side
      g.globalCompositeOperation = "lighten";
      g.globalAlpha = 0.45;
      for (const d of [-gl.split * 2, gl.split * 2]) g.drawImage(strip, sx, sy, sw, sh, dx0 + d, 0, dw, FEED_H);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    if (gl.sil[3] > 0) {
      const [r, gg, b, a] = gl.sil;
      g.fillStyle = `rgba(${r * 255}, ${gg * 255}, ${b * 255}, ${a})`;
      g.fillRect(0, 0, FEED_W, FEED_H);
    }
    if (gl.dissolve > 0) {
      for (let y = 0; y < FEED_H; y += 12) {
        for (let x = 0; x < FEED_W; x += 12) if (hash(x * 0.37 + seed, y * 0.53) < gl.dissolve) g.clearRect(x, y, 12, 12);
      }
    }
  }

  /** Film grain (`amount` 1: a full screen of static). */
  private grain(seed: number, amount: number): void {
    const g = this.g;
    const n = Math.round(amount * (amount >= 1 ? 9000 : 400));
    for (let i = 0; i < n; i++) {
      const v = hash(i, seed);
      g.fillStyle = v < 0.6 ? `rgba(255,255,255,${0.15 + v * 0.5})` : `rgba(255,33,82,${v * 0.4})`;
      g.fillRect(Math.floor(hash(seed, i * 1.7) * FEED_W), Math.floor(hash(i * 2.3, seed + 1) * FEED_H), v < 0.95 ? 1 : 2, 1);
    }
    if (amount >= 1 || hash(seed, 99) < 0.08) {
      // a tear across the picture
      const y = Math.floor(hash(seed, 5) * FEED_H);
      g.fillStyle = "rgba(255,255,255,0.18)";
      g.fillRect(0, y, FEED_W, 1 + Math.floor(hash(seed, 6) * 3));
    }
  }
}
