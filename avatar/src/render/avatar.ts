// Placeholder Capri drawn from flat shapes. Final layered art replaces this in phase 7.
import { Application, Container, Graphics, Rectangle, Text } from "pixi.js";

import type { Emocion } from "../net/protocol.ts";
import type { Pose } from "../state/avatar.ts";
import { asciiFilter, glitchFilter, pixelFilter, setUniform } from "../shaders/filters.ts";

export type Style = "layers" | "pixel" | "ascii";

const W = 420;
const H = 340;
const TOP = 40; // headroom for the hair spikes; scene coordinates below are drawn on a 300 px tall layout
const C = {
  red: 0xff2a5f,
  green: 0x19ff6e,
  blue: 0x1e7bff,
  black: 0x0a0710,
  purple: 0x8a3cff,
  white: 0xffffff,
};

type EyeKind = "open" | "wide" | "happy" | "wink" | "up" | "down" | "angry" | "fixed" | "closed";
type RestMouth = "closed" | "smile" | "smirk" | "frown" | "open_big";

interface Look {
  eyes: [EyeKind, EyeKind];
  mouth: RestMouth;
  hair: { amp: number; spread: number; droop: number; wave: number };
  tilt: number;
  idleGlitch: number; // chance per pose frame of a tiny glitch
  dim: boolean;
}

const LOOKS: Record<Emocion, Look> = {
  neutral: { eyes: ["open", "open"], mouth: "closed", hair: { amp: 2, spread: 1, droop: 0, wave: 0 }, tilt: 0, idleGlitch: 0.01, dim: false },
  feliz: { eyes: ["happy", "happy"], mouth: "smile", hair: { amp: 4, spread: 1, droop: 0, wave: 0.5 }, tilt: 0, idleGlitch: 0.01, dim: false },
  emocionada: { eyes: ["wide", "wide"], mouth: "open_big", hair: { amp: 7, spread: 1.25, droop: 0, wave: 0 }, tilt: 0, idleGlitch: 0.08, dim: false },
  traviesa: { eyes: ["open", "wink"], mouth: "smirk", hair: { amp: 4, spread: 1, droop: 0, wave: 1 }, tilt: 0.06, idleGlitch: 0.04, dim: false },
  curiosa: { eyes: ["wide", "wide"], mouth: "closed", hair: { amp: 2, spread: 1, droop: 0, wave: 0.3 }, tilt: 0.14, idleGlitch: 0.01, dim: false },
  pensativa: { eyes: ["up", "up"], mouth: "closed", hair: { amp: 0.6, spread: 1, droop: 0, wave: 0 }, tilt: -0.05, idleGlitch: 0.01, dim: false },
  sorprendida: { eyes: ["wide", "wide"], mouth: "open_big", hair: { amp: 6, spread: 1.15, droop: 0, wave: 0 }, tilt: 0, idleGlitch: 0.08, dim: false },
  molesta: { eyes: ["angry", "angry"], mouth: "closed", hair: { amp: 1, spread: 1.15, droop: 0, wave: 0 }, tilt: 0, idleGlitch: 0.04, dim: false },
  triste: { eyes: ["down", "down"], mouth: "frown", hair: { amp: 1, spread: 0.9, droop: 0.35, wave: 0 }, tilt: -0.04, idleGlitch: 0.01, dim: true },
  seria: { eyes: ["fixed", "fixed"], mouth: "closed", hair: { amp: 0, spread: 1, droop: 0, wave: 0 }, tilt: 0, idleGlitch: 0, dim: false },
};

// Hair spikes: [angle from straight up (rad), length, base half-width]
const SPIKES: [number, number, number][] = [
  [-1.25, 150, 22], [-0.8, 175, 26], [-0.35, 165, 24], [0.15, 180, 26], [0.6, 170, 24], [1.05, 160, 22],
];
const SPECKS = Array.from({ length: 70 }, (_, i) => [rng(i * 7 + 1)(), rng(i * 13 + 5)(), rng(i * 3 + 9)()]);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ease = (t: number) => Math.sin(t * Math.PI); // 0 -> 1 -> 0

function drawHair(g: Graphics, look: Look, frame: number, cx: number, cy: number): void {
  const r = rng(frame);
  const { amp, spread, droop, wave } = look.hair;
  SPIKES.forEach(([angle, len, hw], i) => {
    const a = angle * spread + droop * Math.sign(angle || 1) + Math.sin(frame * 0.5 + i) * 0.04 * wave;
    const jx = (r() - 0.5) * amp;
    const jy = (r() - 0.5) * amp;
    const tip = [cx + Math.sin(a) * len + jx, cy - Math.cos(a) * len * (1 - droop * 0.5) + jy];
    const nx = Math.cos(a) * hw;
    const ny = Math.sin(a) * hw;
    const mid = [cx + Math.sin(a) * len * 0.55 + nx * 0.9, cy - Math.cos(a) * len * 0.55 + ny * 0.9];
    g.poly([cx - nx, cy - ny, mid[0], mid[1], tip[0], tip[1], cx + nx, cy + ny])
      .fill(C.red)
      .stroke({ width: 3, color: C.purple, alignment: 1 });
  });
  for (const [u, v, s] of SPECKS) {
    // white specks scattered over the hair area, like the show's sparkle texture
    const x = cx + (u - 0.5) * 300;
    const y = cy - 20 - v * 140;
    g.circle(x, y, 0.8 + s * 1.4).fill({ color: C.white, alpha: 0.75 });
  }
}

function drawEye(g: Graphics, x: number, y: number, kind: EyeKind, flip: number): void {
  if (kind === "closed") {
    g.poly([x - 18, y, x + 18, y - 3, x + 18, y + 1, x - 18, y + 4]).fill(C.black);
    return;
  }
  if (kind === "wink") {
    g.poly([x - 18, y - 12, x + 16, y + 10, x + 12, y + 13, x - 20, y - 8]).fill(C.black);
    g.poly([x + 14, y - 14, x - 14, y + 12, x - 18, y + 9, x + 10, y - 16]).fill(C.black);
    return;
  }
  if (kind === "happy") {
    g.poly([x - 18, y + 6, x, y - 10, x + 18, y + 6, x + 12, y + 8, x, y - 2, x - 12, y + 8]).fill(C.black);
    return;
  }
  const size = kind === "wide" ? 1.25 : kind === "fixed" ? 0.95 : 1;
  const w = 22 * size;
  const h = 17 * size;
  // almond with sharp corners
  g.poly([x - w, y + 2, x - w * 0.3, y - h, x + w, y - h * 0.4, x + w * 0.5, y + h, x - w * 0.5, y + h * 0.8]).fill(C.black);
  const py = kind === "up" ? -6 : kind === "down" ? 5 : 0;
  g.circle(x, y + py, 12 * size).fill(C.green);
  g.circle(x, y + py, 9 * size).fill(C.blue);
  g.circle(x, y + py, kind === "fixed" ? 3 : 4 * size).fill(C.white);
  if (kind === "angry") g.poly([x - w - 4, y - h - 6 + flip * 10, x + w + 4, y - h - 6 - flip * 10, x + w + 4, y - h * 0.2 - flip * 10, x - w - 4, y - h * 0.2 + flip * 10]).fill(C.green);
  if (kind === "down") g.poly([x - w - 2, y - h - 2, x + w + 2, y - h - 2, x + w + 2, y - h * 0.3 - flip * 4, x - w - 2, y - h * 0.3 + flip * 4]).fill(C.green);
}

/** Jagged white grin: zigzag teeth on top, curved bottom. */
function drawMouth(g: Graphics, x: number, y: number, w: number, h: number, curve: number, shift = 0): void {
  const pts: number[] = [];
  const teeth = 7;
  for (let i = 0; i <= teeth * 2; i++) {
    const t = i / (teeth * 2);
    const px = x - w / 2 + t * w + shift;
    const bend = -curve * (1 - Math.pow(2 * t - 1, 2));
    pts.push(px, y + bend + (i % 2 ? Math.min(6, h * 0.5) : 0) - curve);
  }
  for (let i = 8; i >= 0; i--) {
    const t = i / 8;
    const px = x - w / 2 + t * w + shift;
    pts.push(px, y + h * (1 - Math.pow(2 * t - 1, 2)) - curve * (1 - Math.pow(2 * t - 1, 2)) * 0.5 - curve + 2);
  }
  g.poly(pts).fill(C.white).stroke({ width: 2, color: C.black });
}

function drawFace(g: Graphics, pose: Pose, look: Look): void {
  // head silhouette and the green mask
  g.poly([210, 70, 290, 110, 285, 200, 230, 235, 190, 235, 135, 200, 130, 110]).fill(C.black).stroke({ width: 3, color: C.purple });
  g.poly([142, 112, 282, 100, 272, 168, 152, 176]).fill(C.green);
  const [l, r] = pose.blinking ? (["closed", look.eyes[1] === "wink" ? "wink" : "closed"] as EyeKind[]) : look.eyes;
  const right = pose.gesto === "guino" ? "wink" : r;
  drawEye(g, 180, 140, l, 1);
  drawEye(g, 245, 135, right, -1);

  const m = pose.mouth ?? look.mouth;
  const shapes: Record<string, [number, number, number, number]> = {
    // w, h, curve, shift
    closed: [60, 4, 2, 0],
    E: [64, 14, 3, 0],
    A: [56, 28, 2, 0],
    O: [34, 26, 0, 0],
    smile: [74, 14, 10, 0],
    smirk: [56, 10, 8, 10],
    frown: [50, 6, -8, 0],
    open_big: [70, 34, 6, 0],
  };
  const [w, h, curve, shift] = shapes[m];
  drawMouth(g, 212, 200, w, h, curve, shift);
}

function drawBody(g: Graphics, pose: Pose): void {
  g.poly([180, 225, 240, 225, 330, 300, 90, 300]).fill(C.black).stroke({ width: 3, color: C.purple });
  g.poly([150, 270, 185, 252, 200, 300, 140, 300]).fill(C.green);
  g.poly([250, 245, 290, 280, 270, 300, 240, 290]).fill(C.green);
  g.poly([205, 240, 215, 240, 225, 300, 195, 300]).fill(C.red);
  const t = pose.gestureT;
  if (pose.gesto === "senalar") {
    const reach = Math.min(1, t * 3) * (t > 0.8 ? (1 - t) / 0.2 : 1);
    const hx = 290 + 95 * reach;
    const hy = 255 - 70 * reach;
    g.poly([280, 250, hx, hy - 6, hx + 14, hy - 2, hx, hy + 8, 292, 268]).fill(C.black).stroke({ width: 3, color: C.purple });
  }
  if (pose.gesto === "cruzar_brazos") {
    g.poly([125, 255, 300, 248, 305, 274, 120, 280]).fill(C.black).stroke({ width: 3, color: C.purple });
    g.poly([160, 258, 220, 256, 215, 270, 158, 272]).fill(C.green);
  }
}

export interface AvatarRenderer {
  app: Application;
  draw(pose: Pose, now: number): void;
}

export async function createAvatar(parent: HTMLElement, style: Style, showFps: boolean): Promise<AvatarRenderer> {
  const app = new Application();
  await app.init({
    width: W,
    height: H,
    backgroundAlpha: 0,
    antialias: true,
    preference: "webgl",
    resolution: window.devicePixelRatio,
    autoDensity: true,
  });
  parent.appendChild(app.canvas);

  const root = new Container();
  const hair = new Graphics();
  const head = new Container();
  const face = new Graphics();
  const body = new Graphics();
  head.addChild(face);
  const scene = new Container(); // moved for headroom and jumps; root keeps the filters fixed
  scene.addChild(hair, body, head);
  root.addChild(scene);
  head.pivot.set(210, 230);
  head.position.set(210, 230);
  hair.pivot.set(210, 230);
  hair.position.set(210, 230);
  app.stage.addChild(root);

  const glitch = glitchFilter();
  const styleFilter = style === "pixel" ? pixelFilter() : style === "ascii" ? asciiFilter() : null;
  root.filters = styleFilter ? [glitch, styleFilter] : [glitch];
  root.filterArea = new Rectangle(0, 0, W, H);
  scene.position.y = TOP;

  let fps: Text | null = null;
  if (showFps) {
    fps = new Text({ text: "", style: { fill: 0xb6ff3b, fontSize: 11, fontFamily: "JetBrains Mono" } });
    fps.position.set(4, 4);
    app.stage.addChild(fps);
  }

  let lastFrame = -1;
  let idleGlitch = 0;
  return {
    app,
    draw(pose, now) {
      const look = LOOKS[pose.emocion];
      if (pose.frame !== lastFrame) {
        lastFrame = pose.frame;
        const t = pose.gestureT;
        const breath = pose.breath * 2;
        hair.clear();
        drawHair(hair, look, pose.frame, 210, 150);
        face.clear();
        drawFace(face, pose, look);
        body.clear();
        drawBody(body, pose);

        let tilt = look.tilt;
        let dy = breath;
        if (pose.gesto === "asentir") dy += Math.sin(t * Math.PI * 2) * 8;
        if (pose.gesto === "ladear_cabeza") tilt += ease(t) * 0.25;
        head.rotation = hair.rotation = tilt;
        head.position.y = hair.position.y = 230 + dy;
        scene.position.y = TOP - (pose.gesto === "saltar" ? ease(t) * 30 : 0);
        root.tint = look.dim ? 0x9a9ab8 : 0xffffff;
        if (Math.random() < look.idleGlitch) idleGlitch = 0.35;
      }
      const amount = Math.max(pose.glitch, idleGlitch);
      glitch.enabled = amount > 0;
      setUniform(glitch, "uAmount", amount);
      setUniform(glitch, "uSeed", Math.floor(now / 50));
      idleGlitch = Math.max(0, idleGlitch - 0.05);
      if (fps) fps.text = `${style} ${app.ticker.FPS.toFixed(0)} fps`;
    },
  };
}
