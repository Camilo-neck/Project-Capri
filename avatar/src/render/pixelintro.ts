// Her intro in the Pixel style (state/pixelintro.ts says when): her waving clip, big, climbing up into the
// screen from under its bottom edge, a "¡HOLA!" tag and its line, then down to her spot at her usual size.
// Same lifecycle as IntroView (render/intro.ts), so main.ts plays either.
import { captionChars, cuesBetween, dive, END, phaseAt, rise, T, type Cue } from "../state/pixelintro.ts";
import type { IntroHooks, IntroPlay } from "./intro.ts";

const urls = import.meta.glob("../../assets/pet/anim/saludar/saludar_*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const VIOLET = "#8b38ff", INK = "#140f1c", PAPER = "#fdfdfb";
const FPS = 10; // the clip's own pace
const SMALL = 2; // the scale her clips have on screen (render/pet.ts CLIP_SCALE)
const HEAD = { x: 54, y: 34 }; // her face in a 108 px frame, from its top-left

interface Run extends IntroPlay {
  born: number;
  cued: number;
  big: number; // her scale at the top of the screen
  landed: () => void;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class PixelIntroView {
  private g: CanvasRenderingContext2D;
  private frames: HTMLImageElement[] = [];
  private shadows: HTMLCanvasElement[] = [];
  private run: Run | null = null;
  freezeAt: number | null = null; // ms into it, held there (for screenshots)

  constructor(private canvas: HTMLCanvasElement, private hooks: IntroHooks) {
    this.g = canvas.getContext("2d")!;
  }

  /** Her waving clip and its violet copies. False if it isn't there. */
  async load(): Promise<boolean> {
    try {
      const sorted = Object.entries(urls).sort(([a], [b]) => a.localeCompare(b)).map(([, u]) => u);
      if (!sorted.length) return false;
      this.frames = await Promise.all(sorted.map(async (u) => {
        const img = new Image();
        img.src = u;
        await img.decode();
        return img;
      }));
      this.shadows = this.frames.map((img) => { // her violet copy, a little off to one side, like in the show
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        g.globalCompositeOperation = "source-in";
        g.fillStyle = VIOLET;
        g.fillRect(0, 0, c.width, c.height);
        return c;
      });
      return true;
    } catch (e) {
      console.warn("pixel intro", e);
      return false;
    }
  }

  get playing(): boolean {
    return this.run !== null;
  }

  /** Plays it; resolves when she's reached her spot. With animations off there's none of it. */
  play(p: IntroPlay): Promise<void> {
    if (!this.frames.length || p.still) return Promise.resolve();
    const dpr = devicePixelRatio || 1;
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const big = Math.max(4, Math.min(8, Math.floor((innerHeight * 0.55) / 90)));
    return new Promise((landed) => {
      this.run = { ...p, born: performance.now(), cued: -1, big, landed };
      this.canvas.hidden = false;
      requestAnimationFrame(this.frame);
    });
  }

  /** A click: it ends now. */
  skip(): void {
    const r = this.run;
    if (!r) return;
    this.stop();
    r.landed();
  }

  private stop(): void {
    this.run = null;
    this.g.clearRect(0, 0, innerWidth, innerHeight);
    this.canvas.hidden = true;
  }

  private frame = (now: number): void => {
    const r = this.run;
    if (!r) return;
    const ms = this.freezeAt ?? now - r.born;
    if (ms > END) {
      this.stop();
      r.landed();
      return;
    }
    for (const c of cuesBetween(r.cued, ms)) this.cue(r, c);
    r.cued = ms;
    this.g.clearRect(0, 0, innerWidth, innerHeight);
    this.draw(r, ms);
    requestAnimationFrame(this.frame);
  };

  private cue(r: Run, c: Cue): void {
    const w = innerWidth, h = innerHeight;
    if (c === "crackle") {
      this.hooks.crackle(0, h * 0.55, h * 0.35, 500);
      this.hooks.crackle(w, h * 0.55, h * 0.35, 500);
    } else if (c === "slip") this.hooks.rush(w / 2, h * 0.5);
    else if (c === "land") this.hooks.burst(r.to.x, r.to.y, r.to.size);
  }

  /** Where her face is, and how big she is: below the screen, up in place, then down to her spot. */
  private pose(r: Run, ms: number): { x: number; y: number; k: number } {
    const w = innerWidth, h = innerHeight;
    const spot = { x: w / 2, y: h * 0.4 };
    const d = dive(ms);
    const crouch = phaseAt(ms) === "antic" ? 10 * r.big / 4 : 0;
    const k = lerp(r.big, SMALL, d);
    const x = lerp(spot.x, r.to.x, d);
    const y = lerp(lerp(h + HEAD.y * r.big, spot.y, rise(ms)) + crouch, r.to.y, d * d);
    return { x, y, k };
  }

  private draw(r: Run, ms: number): void {
    const g = this.g;
    g.imageSmoothingEnabled = false;
    const { x, y, k } = this.pose(r, ms);
    const holding = phaseAt(ms) === "hold";
    const i = holding ? Math.floor(((ms - T.hold[0]) / 1000) * FPS) % this.frames.length : 0;
    const img = this.frames[i], sh = this.shadows[i];
    const left = Math.round(x - HEAD.x * k), top = Math.round(y - HEAD.y * k);
    const tear = holding && ms % 700 < 70 ? 3 * k : 0; // now and then she tears for a moment
    g.drawImage(sh, left + k * 1.2 + tear, top + k * 1.2, img.width * k, img.height * k);
    g.drawImage(img, left - tear, top, img.width * k, img.height * k);
    if (ms >= T.tag && ms < T.dive[0]) this.tag(r, x + 38 * k, y - 20 * k, ms);
  }

  /** "¡HOLA!" on a cut-corner tag, its line typing under it. */
  private tag(r: Run, x: number, y: number, ms: number): void {
    const g = this.g;
    const fs = Math.max(26, Math.round(innerHeight / 22));
    g.font = `700 ${fs}px "Chakra Petch", sans-serif`;
    const w = g.measureText(r.label).width + fs, h = fs * 1.3;
    const pop = Math.min(1, (ms - T.tag) / 120); // it snaps in
    g.save();
    g.translate(Math.round(x), Math.round(y));
    g.scale(pop, pop);
    const shape = (dx: number) => {
      g.beginPath();
      g.moveTo(dx, dx);
      g.lineTo(w + dx, dx);
      g.lineTo(w + dx, h - 9 + dx);
      g.lineTo(w - 9 + dx, h + dx);
      g.lineTo(dx, h + dx);
      g.fill();
    };
    g.fillStyle = VIOLET;
    shape(5);
    g.fillStyle = PAPER;
    shape(0);
    g.fillStyle = INK;
    g.textBaseline = "middle";
    g.fillText(r.label, fs / 2, h / 2 + 1);
    const n = captionChars(ms, r.caption.length);
    if (n > 0) {
      g.font = `500 ${Math.round(fs * 0.5)}px "JetBrains Mono", monospace`;
      g.fillStyle = PAPER;
      g.fillText(r.caption.slice(0, n), fs / 2, h + fs * 0.6);
    }
    g.restore();
  }
}
