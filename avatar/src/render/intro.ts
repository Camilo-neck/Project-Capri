// Her intro on its own 2D canvas over everything (state/intro.ts says what happens when). Adapted
// from mochiiwuff/capri-desktop's fx.js: her close-up from the show holding your screen by its edges,
// never a straight edge of the picture on screen (jagged cuts, new jags every drawing), flat copies
// of her for the impact frames, her colours pulled apart, her eyes redrawn so they can look and blink.
import { type Cel, CELS, celAt, cuesBetween, END, FRAME_MS, lookAt, openAt, phaseAt, stillAlpha, T } from "../state/intro.ts";

const urls = import.meta.glob("../../assets/intro/*.webp", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

// where things are on the close-up, in its pixels (assets/intro, 1672x941)
const GRAB = {
  w: 1672, h: 941,
  face: { x: 830, y: 330, size: 430 }, // the middle of her face, and about how wide it is
  eyes: [{ x: 719.5, y: 382.5 }, { x: 935, y: 297.5 }],
  tilt: -0.38, // her head's tilt (radians), for her lids
  socket: 48, iris: 34, pupil: 13.5,
  irisColor: "#026ffe", pupilColor: "#fdfdfb", inkColor: "#010207", // the picture's own colours
  tag: { x: 1110, y: 175 }, // where "hola" pops, by her face
  hands: [{ x: 0, y: 610 }, { x: 1672, y: 520 }], // where her hands hold the edges of the screen
};
const OWN_EYES = new Set<Cel>(["happy"]); // drawings whose eyes are their own (shut with joy)
const RED = "#ff2152", VIOLET = "#8b38ff", GREEN = "#36ff7a", PAPER = "#fdfdfb", INK = "#140f1c";
const JAG = 70; // picture px between two points of a cut
const JAG_AMP = 46;

type Pt = { x: number; y: number };
type Clip = (g: CanvasRenderingContext2D) => void;
type Flat = "paper" | "ink" | "violet";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** A stable random number in [0, 1) for (i, seed): the same drawing gets the same jags. */
const hash = (i: number, seed: number) => {
  const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

// ---- what shows of the picture: jagged cuts, in its pixels ----

/** From the sides in: `rL`, `rR` how far in from the left and right edges (1: half the picture). */
function cutEdges(g: CanvasRenderingContext2D, rL: number, rR: number, seed: number): void {
  const side = (r: number, left: boolean) => {
    if (r <= 0) return;
    const reach = r * GRAB.w * 0.5;
    const amp = JAG_AMP * Math.min(1, r * 4);
    g.moveTo(left ? -60 : GRAB.w + 60, -60);
    for (let y = -60, i = 0; y <= GRAB.h + 60 + JAG; y += JAG, i++) {
      const x = reach + (hash(i, seed + (left ? 0 : 50)) - 0.5) * 2 * amp;
      g.lineTo(left ? x : GRAB.w - x, y);
    }
    g.lineTo(left ? -60 : GRAB.w + 60, GRAB.h + 60 + JAG);
    g.closePath();
  };
  side(rL, true);
  side(rR, false);
}

/** From the middle out: a band `half` wide on each side of her face. */
function cutBand(g: CanvasRenderingContext2D, half: number, seed: number): void {
  const ys: number[] = [];
  for (let y = -60; y <= GRAB.h + 60 + JAG; y += JAG) ys.push(y);
  ys.forEach((y, i) => {
    const x = GRAB.face.x - half - (hash(i, seed) - 0.5) * 2 * JAG_AMP;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  });
  for (let i = ys.length - 1; i >= 0; i--) g.lineTo(GRAB.face.x + half + (hash(i, seed + 50) - 0.5) * 2 * JAG_AMP, ys[i]);
  g.closePath();
}

/** Her head and mane: a spiky disc of radius R around her face. */
function cutHead(g: CanvasRenderingContext2D, R: number, seed: number): void {
  const N = 30;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = R * (i % 2 ? 0.78 : 1) * (0.92 + hash(i, seed) * 0.16);
    const x = GRAB.face.x + Math.cos(a) * r * 1.15, y = GRAB.face.y + Math.sin(a) * r * 0.95;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}

export interface IntroHooks {
  burst(x: number, y: number, size: number): void; // shards flying off
  crackle(x: number, y: number, r: number, life: number): void; // red lightning
  rush(x: number, y: number): void; // speed lines and a shockwave
}

export interface IntroPlay {
  to: Pt & { size: number }; // her face where she'll stand, CSS px, and about how wide it is there
  label: string; // on her tag ("¡HOLA!")
  caption: string; // typed under it
  still: boolean; // Windows has its animations off: a fade where she is
}

interface Run extends IntroPlay {
  born: number;
  cued: number;
  shattered: number; // the last drawing her arms threw shards on
  s: number; // picture px -> CSS px, filling the screen
  at: Pt; // her face on screen
  ctrl: Pt; // the bend of her dive
  landed: () => void;
}

export class IntroView {
  private g: CanvasRenderingContext2D;
  private cels: Partial<Record<Cel, HTMLImageElement>> = {};
  private copies: Record<Flat, HTMLCanvasElement> & { channels: HTMLCanvasElement[] } | null = null;
  private run: Run | null = null;
  freezeAt: number | null = null; // ms into it, held there (intro.html ?at=, for screenshots)

  constructor(private canvas: HTMLCanvasElement, private hooks: IntroHooks) {
    this.g = canvas.getContext("2d")!;
  }

  /** The close-up's drawings, and its flat and split copies made ahead. False if they couldn't load. */
  async load(): Promise<boolean> {
    try {
      await Promise.all(CELS.map(async (c) => {
        const url = Object.entries(urls).find(([k]) => k.endsWith(`/${c}.webp`))?.[1];
        if (!url) throw new Error(`missing intro drawing ${c}`);
        const img = new Image();
        img.src = url;
        await img.decode();
        this.cels[c] = img;
      }));
    } catch (e) {
      console.warn("intro", e);
      return false;
    }
    const grab = this.cels.grab!;
    const copy = (fill: string, mode: GlobalCompositeOperation) => {
      const c = document.createElement("canvas");
      c.width = GRAB.w;
      c.height = GRAB.h;
      const g = c.getContext("2d")!;
      g.drawImage(grab, 0, 0);
      g.globalCompositeOperation = mode;
      g.fillStyle = fill;
      g.fillRect(0, 0, c.width, c.height);
      if (mode === "multiply") {
        g.globalCompositeOperation = "destination-in"; // multiply fills her cut-out background too
        g.drawImage(grab, 0, 0);
      }
      return c;
    };
    this.copies = {
      paper: copy(PAPER, "source-in"),
      ink: copy(INK, "source-in"),
      violet: copy(VIOLET, "source-in"),
      channels: ["#ff0000", "#00ff00", "#0000ff"].map((c) => copy(c, "multiply")),
    };
    return true;
  }

  get playing(): boolean {
    return this.run !== null;
  }

  /** Plays it; resolves when her face reaches `to` (her body comes back there). */
  play(p: IntroPlay): Promise<void> {
    if (!this.copies) return Promise.resolve();
    this.size();
    const w = innerWidth, h = innerHeight;
    const s = Math.max(w / GRAB.w, h / GRAB.h); // filling the screen, her hands on its edges
    const at = { x: (w - GRAB.w * s) / 2 + GRAB.face.x * s, y: (h - GRAB.h * s) / 2 + GRAB.face.y * s };
    const ctrl = { x: lerp(at.x, p.to.x, 0.25) - (p.to.x - at.x) * 0.2, y: lerp(at.y, p.to.y, 0.15) };
    return new Promise((landed) => {
      this.run = { ...p, born: performance.now(), cued: -1, shattered: -1, s, at, ctrl, landed };
      this.canvas.hidden = false;
      requestAnimationFrame(this.frame);
    });
  }

  /** A click: it ends now and she's straight at her spot. */
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

  private size(): void {
    const dpr = devicePixelRatio || 1;
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private frame = (now: number): void => {
    const r = this.run;
    if (!r) return;
    const t = (this.freezeAt ?? now - r.born) / FRAME_MS; // in drawings, not rounded: the moves follow it smoothly
    const frame = Math.floor(t); // the drawings change on whole frames
    if (frame > END) {
      this.stop();
      r.landed(); // in case it never got there (a hidden window skips frames)
      return;
    }
    for (let f = r.cued + 1; f <= frame; f++) this.cue(r, f);
    r.cued = frame;
    this.g.clearRect(0, 0, innerWidth, innerHeight);
    this.draw(r, t, frame);
    requestAnimationFrame(this.frame);
  };

  /** A point of the close-up (its pixels) on screen, its face at (x, y), k times its size. */
  private onScreen(r: Run, p: Pt, x = r.at.x, y = r.at.y, k = 1): Pt {
    return { x: x + (p.x - GRAB.face.x) * r.s * k, y: y + (p.y - GRAB.face.y) * r.s * k };
  }

  private hands(r: Run): Pt[] {
    return GRAB.hands.map((p) => {
      const q = this.onScreen(r, p);
      return { x: clamp(q.x, 14, innerWidth - 14), y: q.y };
    });
  }

  private cue(r: Run, f: number): void {
    const hands = this.hands(r);
    for (const c of cuesBetween(f - 1, f, r.still)) {
      if (c === "crackle") for (const q of hands) this.hooks.crackle(q.x, q.y, f === 3 ? 70 : 60, 260);
      else if (c === "hand") {
        const q = hands[f === T.hands ? 0 : 1]; // a hand slams onto the edge of the screen
        this.hooks.burst(q.x, q.y, 70);
        this.hooks.crackle(q.x, q.y, 50, 220);
      } else if (c === "lines") this.hooks.rush(r.at.x, r.at.y);
      else if (c === "grab" && !r.still) {
        this.hooks.rush(r.at.x, r.at.y);
        this.hooks.burst(r.at.x, r.at.y, 160);
      } else if (c === "land") r.landed();
    }
  }

  private draw(r: Run, t: number, frame: number): void {
    const g = this.g;
    const toward = { x: Math.sign(r.to.x - r.at.x) || 1, y: Math.sign(r.to.y - r.at.y) || 1 };
    const look = lookAt(frame, toward.x, toward.y);
    const open = openAt(frame);
    const n = frame >> 1; // the line boiling: a new drawing every other frame, a pixel or two off
    const noise = (k: number) => hash(n, k) * 2 - 1;
    const tagAt = this.onScreen(r, GRAB.tag);
    const fs = Math.round(clamp(innerHeight * 0.06, 40, 76));
    const hi = (k = 1, ky = 1) => {
      this.hiTag(tagAt.x, tagAt.y, r.label, fs, k, ky);
      if (r.caption && frame >= T.hi + 6 && ky === 1) {
        this.typed(tagAt.x + fs * 0.5, tagAt.y + fs * 1.15, r.caption, r.caption.slice(0, (frame - T.hi - 6) * 2), frame);
      }
    };

    if (r.still) {
      const a = stillAlpha(frame);
      if (a <= 0) return;
      g.save();
      g.globalAlpha = a;
      this.grabbed(r, r.at.x, r.at.y, 1.02, { look: { x: 0, y: 3 } });
      if (frame >= T.hi) hi();
      g.restore();
      return;
    }

    const s = r.s;
    switch (phaseAt(frame)) {
      case "edges":
        if (frame % 2 === 0 || frame === T.hands - 1) this.screenEdges(frame);
        return;
      case "hands": {
        // the left hand slams onto the edge, then the right, the screen jolting each time
        const right = frame >= T.right;
        const jolt = [7, -3][frame - (right ? T.right : T.hands)] ?? 0;
        this.grabbed(r, r.at.x + jolt * (right ? 1 : -1), r.at.y + 70 * s, 1.04,
          { look, open, clip: (c) => cutEdges(c, 0.16, right ? 0.16 : 0, frame) });
        return;
      }
      case "reach": {
        // her arms reaching in along them, faster and faster, as she hauls herself up to the glass
        const u = clamp((t - T.reach + 1) / (T.grab - T.reach), 0, 1);
        const rr = lerp(0.16, 1.2, u * u);
        this.grabbed(r, r.at.x, r.at.y + 70 * s * (1 - u * u), lerp(1.04, 1.02, u),
          { look, open, clip: (c) => cutEdges(c, rr, rr, frame) });
        return;
      }
      case "hit": {
        // her face hits it: a white flash of her, an ink one on its violet copy, then her colours apart
        const k = frame - T.grab;
        const shake = [24, -17, 11, -6, 3][k];
        const x = r.at.x + shake, y = r.at.y - shake * 0.4;
        if (k === 0) this.grabbed(r, x, y, 1.22, { flat: "paper" });
        else if (k === 1) {
          this.grabbed(r, x + 10, y + 10, 1.1, { flat: "violet" });
          this.grabbed(r, x, y, 1.1, { flat: "ink" });
        } else this.grabbed(r, x, y, [1.05, 1.02, 1.03][k - 2], { split: [16, 7, 2][k - 2] });
        return;
      }
      case "hold": {
        // holding on: she breathes and boils, the camera creeping in; "hola", the wave, eyes shut with joy
        const h0 = frame - T.hi - 2;
        const cel = celAt(frame);
        let shake = 0;
        if (frame === T.wave) shake = 6; // her arm off the edge
        if (frame >= T.happy && frame < T.happy + 2) shake = [8, -4][frame - T.happy]; // and back onto it
        const creep = 0.03 * clamp((t - T.hold) / (T.slip - T.hold), 0, 1);
        const bob = h0 >= 0 && h0 < 8 ? [0.024, 0.024, -0.017, -0.017, 0.009, 0.009, 0, 0][h0] : 0;
        const pop = h0 === 0 || h0 === 1 ? [0.025, 0.012][h0] : 0;
        const k = 1.025 + pop + creep + 0.006 * Math.sin(t / 7);
        const split = frame % 24 === 19 && cel === "grab" ? 6 : 0; // now and then her colours slip
        this.grabbed(r, r.at.x + noise(1) * 1.5 + shake, r.at.y + noise(2) * 1.5, k, { rot: noise(3) * 0.003 + bob, look, open, cel, split });
        if (h0 >= 0) hi([0.35, 1.22, 0.94][h0] ?? 1);
        return;
      }
      case "slip": {
        // she lets go: her arms come apart into shards from her hands in, the tag squashed away
        const u = clamp((t - T.slip + 1) / (T.antic - T.slip), 0, 1);
        const half = lerp(GRAB.w * 0.5 + 60, 330, 1 - (1 - u) * (1 - u));
        const y = r.at.y + 56 * s * u * u;
        this.grabbed(r, r.at.x, y, 1.055, { look, open, clip: (c) => cutBand(c, half, frame) });
        if (r.shattered !== frame && frame % 2 === 0) {
          r.shattered = frame; // once per drawing, however often the screen refreshes
          for (const side of [-1, 1]) {
            const q = this.onScreen(r, { x: GRAB.face.x + side * half, y: 300 + hash(frame, side) * 500 }, r.at.x, y, 1.055);
            this.hooks.burst(q.x, q.y, 40);
          }
        }
        if (frame === T.slip) hi(1, 0.45);
        return;
      }
      case "antic": {
        // her head and mane, all that's left: a crouch to take off
        const [sx, sy, dy] = ([[1.08, 0.88, 24], [0.94, 1.12, -30]] as const)[frame - T.antic];
        this.grabbed(r, r.at.x, r.at.y + 56 * s + dy * s, 1.055 * 0.9, { sx, sy, look, clip: (c) => cutHead(c, 370, frame) });
        return;
      }
      case "dive":
        this.dive(r, t, frame, toward);
        return;
      case "slit": {
        // landed: it closes into a slit where her face will be
        const k = frame - T.land;
        this.voidSlit(r.to.x, r.to.y, r.to.size * [0.4, 0.1][k], r.to.size * 1.5);
        return;
      }
      case "done":
        return;
    }
  }

  /** The dive: shrinking fast, then falling faster and faster into her spot, smeared along the way,
   * violet afterimages behind, a zigzag where she's been. */
  private dive(r: Run, t: number, frame: number, toward: Pt): void {
    const g = this.g;
    const u = clamp((t - T.shrink + 1) / (T.land - T.shrink), 0, 1);
    const lag = 0.12;
    const start = { x: r.at.x, y: r.at.y + 56 * r.s };
    const k0 = 1.055 * 0.9, k1 = (r.to.size * 1.5) / (GRAB.face.size * r.s);
    const place = (v: number) => {
      const e = v * v;
      const a = (1 - e) * (1 - e), c2 = 2 * e * (1 - e), c = e * e;
      return { x: a * start.x + c2 * r.ctrl.x + c * r.to.x, y: a * start.y + c2 * r.ctrl.y + c * r.to.y, k: lerp(k0, k1, 1 - (1 - v) * (1 - v)) };
    };
    const trail: [number, number][] = [];
    for (let j = 0; j <= 10; j++) {
      const q = place(Math.max(0, u - 0.45 + (j / 10) * 0.45));
      trail.push([q.x + (j % 2 ? 1 : -1) * (3 + hash(j, frame) * 6), q.y]);
    }
    g.save();
    g.lineJoin = "miter";
    this.stroke(trail, VIOLET, 5, -3, 3);
    this.stroke(trail, RED, 4);
    this.stroke(trail, PAPER, 1.2);
    g.restore();
    const head: Clip = (c) => cutHead(c, 370, frame);
    for (const [back, alpha] of [[2, 0.14], [1, 0.3]]) {
      const v = u - back * lag;
      if (v <= 0) continue;
      const q = place(v);
      g.save();
      g.globalAlpha = alpha;
      this.grabbed(r, q.x, q.y, q.k, { flat: "violet", clip: head });
      g.restore();
    }
    const q = place(u), prev = place(Math.max(0, u - lag * 0.5));
    const ang = Math.atan2(q.y - prev.y, q.x - prev.x);
    const size = 370 * 2 * r.s * q.k;
    const st = clamp(1 + (Math.hypot(q.x - prev.x, q.y - prev.y) / size) * 0.3, 1, 2);
    g.save();
    g.translate(q.x, q.y);
    g.rotate(ang);
    g.scale(st, 1 / Math.sqrt(st));
    g.rotate(-ang);
    this.grabbed(r, 0, 0, q.k, { look: { x: toward.x * 10, y: toward.y * 7 }, clip: head });
    g.restore();
  }

  /** Her close-up, its face at (x, y), `k` times its size: the picture (or a flat copy), her colours
   * `split` px apart, and her eyes drawn over its own (looking `look`, `open` 1, 0.5 or 0). */
  private grabbed(r: Run, x: number, y: number, k: number,
                  o: { rot?: number; sx?: number; sy?: number; flat?: Flat; split?: number; look?: Pt; open?: number; clip?: Clip; cel?: Cel } = {}): void {
    const g = this.g;
    const c = this.copies!;
    const cel = o.cel ?? "grab";
    g.save();
    g.translate(x, y);
    g.rotate(o.rot ?? 0);
    g.scale(r.s * k * (o.sx ?? 1), r.s * k * (o.sy ?? 1));
    g.translate(-GRAB.face.x, -GRAB.face.y);
    if (o.clip) {
      g.beginPath();
      o.clip(g);
      g.clip();
    }
    g.imageSmoothingQuality = "high";
    if (o.flat) g.drawImage(c[o.flat], 0, 0);
    else if (o.split) {
      const d = o.split / (r.s * k);
      g.globalCompositeOperation = "lighter";
      g.drawImage(c.channels[0], -d, d * 0.3);
      g.drawImage(c.channels[1], 0, 0);
      g.drawImage(c.channels[2], d, -d * 0.3);
      g.globalCompositeOperation = "source-over";
    } else {
      g.drawImage(this.cels[cel] ?? this.cels.grab!, 0, 0);
      if (!OWN_EYES.has(cel)) for (const e of GRAB.eyes) this.eye(e, o.look ?? { x: 0, y: 0 }, o.open ?? 1);
    }
    g.restore();
  }

  /** One of her eyes over the picture's own: iris and pupil turned `look`, or her lid half down or shut. */
  private eye(e: Pt, look: Pt, open: number): void {
    const g = this.g;
    const disk = (x: number, y: number, r: number, color: string) => {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
    };
    g.save();
    disk(e.x, e.y, GRAB.socket, GRAB.inkColor);
    g.clip();
    if (open > 0) {
      disk(e.x + look.x, e.y + look.y, GRAB.iris, GRAB.irisColor);
      disk(e.x + look.x * 1.15, e.y + look.y * 1.15, GRAB.pupil + 1.6, GRAB.inkColor);
      disk(e.x + look.x * 1.15, e.y + look.y * 1.15, GRAB.pupil, GRAB.pupilColor);
    }
    if (open < 1) {
      g.translate(e.x, e.y);
      g.rotate(GRAB.tilt);
      const edge = open > 0 ? -GRAB.socket * 0.1 : GRAB.socket * 0.15;
      g.fillStyle = GRAB.inkColor;
      g.fillRect(-GRAB.socket, -GRAB.socket, GRAB.socket * 2, GRAB.socket + edge);
      g.beginPath();
      g.moveTo(-GRAB.socket, edge - 6);
      g.quadraticCurveTo(0, edge + 10, GRAB.socket, edge - 6);
      g.strokeStyle = GREEN;
      g.lineWidth = 6;
      g.stroke();
    }
    g.restore();
  }

  /** The tag she says hi on: red, slanted, its left end at (x, y), letters `fs` px, scaled `k` (`ky`: squashed). */
  private hiTag(x: number, y: number, text: string, fs: number, k = 1, ky = 1): void {
    const g = this.g;
    g.save();
    g.font = `600 ${fs}px "Chakra Petch", sans-serif`;
    const skew = fs * 0.32, th = fs * 1.18;
    const tw = g.measureText(text).width + fs * 0.9 + skew;
    g.translate(x, y);
    g.scale(k, k * ky);
    const band = (dx: number, dy: number) => {
      g.beginPath();
      g.moveTo(skew + dx, -th / 2 + dy);
      g.lineTo(tw + dx, -th / 2 + dy);
      g.lineTo(tw - skew + dx, th / 2 + dy);
      g.lineTo(dx, th / 2 + dy);
      g.closePath();
    };
    band(7, 7);
    g.fillStyle = VIOLET;
    g.fill();
    band(0, 0);
    g.fillStyle = RED;
    g.fill();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = PAPER;
    g.fillText(text, tw / 2, fs * 0.04);
    g.restore();
  }

  /** A line typed out on an ink strip from (x, y), a red block for a cursor, blinking once it's all there. */
  private typed(x: number, y: number, full: string, text: string, frame: number): void {
    const g = this.g;
    g.save();
    g.font = '400 13px "JetBrains Mono", monospace';
    const tw = g.measureText(full).width;
    g.fillStyle = VIOLET;
    g.fillRect(x + 3, y - 12, tw + 28, 22);
    g.fillStyle = INK;
    g.fillRect(x, y - 15, tw + 28, 22);
    g.fillStyle = PAPER;
    g.textBaseline = "alphabetic";
    g.fillText(text, x + 9, y + 1);
    if (text.length < full.length || (frame >> 2) % 2) {
      g.fillStyle = RED;
      g.fillRect(x + 10 + g.measureText(text).width, y - 10, 8, 13);
    }
    g.restore();
  }

  /** The edges of the screen crackling red, in broken runs on their violet copy (new ones each `seed`). */
  private screenEdges(seed: number): void {
    const g = this.g;
    const w = innerWidth, h = innerHeight;
    let i = 0;
    const r = (a: number, b: number) => a + hash(i++, seed) * (b - a);
    const runs = (horizontal: boolean, fixed: number, len: number) => {
      for (let p = r(-60, 0); p < len; p += r(70, 230)) {
        const l = r(50, 190), th = r(4, 9);
        const [x, y, rw, rh] = horizontal ? [p, fixed, l, th] : [fixed, p, th, l];
        g.fillStyle = VIOLET;
        g.fillRect(x + 3, y + 3, rw, rh);
        g.fillStyle = RED;
        g.fillRect(x, y, rw, rh);
      }
    };
    runs(true, 0, w);
    runs(true, h - 9, w);
    runs(false, 0, h);
    runs(false, w - 9, h);
  }

  /** The void where she lands: black, with her as a red line in it. */
  private voidSlit(x: number, y: number, w: number, h: number): void {
    const g = this.g;
    g.fillStyle = VIOLET;
    g.fillRect(x - w / 2 - 3, y - h / 2, w + 6, h);
    g.fillStyle = INK;
    g.fillRect(x - w / 2, y - h / 2, w, h);
    g.fillStyle = RED;
    g.fillRect(x - 1, y - h * 0.42, 2, h * 0.84);
  }

  private stroke(pts: [number, number][], color: string, width: number, dx = 0, dy = 0): void {
    const g = this.g;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy)));
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
  }
}
