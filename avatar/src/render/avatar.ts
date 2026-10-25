// Capri drawn from SVG layers in avatar/assets/capri: one SVG per body pose plus a shared head.
// The face (eyes, mouth) is drawn in code on anchors so it can change with emotion and text.
import { Application, Container, Graphics, Rectangle, Text } from "pixi.js";

import apoyadaSvg from "../../assets/capri/apoyada.svg?raw";
import amenazaSvg from "../../assets/capri/amenaza.svg?raw";
import dePieSvg from "../../assets/capri/de_pie.svg?raw";
import headSvg from "../../assets/capri/head.svg?raw";
import inclinadaSvg from "../../assets/capri/inclinada.svg?raw";
import sentadaSvg from "../../assets/capri/sentada.svg?raw";
import type { Emocion } from "../net/protocol.ts";
import type { Pose } from "../state/avatar.ts";
import { asciiFilter, glitchFilter, pixelFilter, setUniform } from "../shaders/filters.ts";

export type Style = "layers" | "pixel" | "ascii";
export const W = 480;
export const H = 560;

const C = { red: 0xff2457, green: 0x16f46c, blue: 0x1e7bff, black: 0x07050c, white: 0xffffff };

type BodyPose = "de_pie" | "sentada" | "inclinada" | "amenaza" | "apoyada";
type Arms = "arms-rest" | "arms-point" | "arms-cross";
type EyeKind = "open" | "wide" | "happy" | "wink" | "up" | "down" | "angry" | "fixed" | "closed";
type RestMouth = "zigzag" | "grin" | "smirk" | "frown" | "open_big";

const SVGS: Record<BodyPose, string> = {
  de_pie: dePieSvg,
  sentada: sentadaSvg,
  inclinada: inclinadaSvg,
  amenaza: amenazaSvg,
  apoyada: apoyadaSvg,
};

interface Look {
  pose: BodyPose;
  arms?: Arms;
  eyes: [EyeKind, EyeKind];
  mouth: RestMouth;
  extraEyes?: boolean;
  hair: number; // jitter amplitude in px
  dim?: boolean;
  idleGlitch: number; // chance per pose frame of a short glitch
}

const LOOKS: Record<Emocion, Look> = {
  neutral: { pose: "sentada", eyes: ["open", "open"], mouth: "zigzag", hair: 1.5, idleGlitch: 0.01 },
  pensativa: { pose: "sentada", eyes: ["up", "up"], mouth: "zigzag", hair: 0.5, idleGlitch: 0.01 },
  feliz: { pose: "de_pie", eyes: ["happy", "happy"], mouth: "grin", hair: 3, idleGlitch: 0.02 },
  emocionada: { pose: "de_pie", eyes: ["wide", "wide"], mouth: "open_big", hair: 5, idleGlitch: 0.08 },
  sorprendida: { pose: "de_pie", eyes: ["wide", "wide"], mouth: "open_big", hair: 4, idleGlitch: 0.08 },
  seria: { pose: "de_pie", arms: "arms-cross", eyes: ["fixed", "fixed"], mouth: "zigzag", hair: 0, idleGlitch: 0 },
  curiosa: { pose: "inclinada", eyes: ["wide", "wide"], mouth: "zigzag", hair: 1.5, idleGlitch: 0.01 },
  traviesa: { pose: "inclinada", eyes: ["open", "wink"], mouth: "smirk", hair: 3, idleGlitch: 0.04 },
  molesta: { pose: "amenaza", eyes: ["angry", "angry"], mouth: "grin", extraEyes: true, hair: 2, idleGlitch: 0.05 },
  triste: { pose: "apoyada", eyes: ["down", "down"], mouth: "frown", hair: 0.8, dim: true, idleGlitch: 0.01 },
};

interface Anchor {
  x: number;
  y: number;
  r: number;
  rot: number;
}

const RIM = { color: 0x8b38ff, dx: -3, dy: 3 }; // the show's offset purple edge

/** Breaks long edges into sharp notches so shapes read as torn shards. Seeded, so the art is stable. */
function roughen(pts: number[], amount: number, seed: number): number[] {
  if (!amount) return pts;
  const r = rng(seed);
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const [ax, ay] = [pts[i], pts[i + 1]];
    const [bx, by] = [pts[(i + 2) % pts.length], pts[(i + 3) % pts.length]];
    out.push(ax, ay);
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.floor(len / 18);
    for (let k = 1; k < n; k++) {
      const t = (k + (r() - 0.5) * 0.5) / n;
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      const d = (k % 2 ? 1 : -0.4) * amount * r();
      out.push(ax + (bx - ax) * t + nx * d, ay + (by - ay) * t + ny * d);
    }
  }
  return out;
}

/**
 * Reads groups of <polygon> (fill, optional data-rough) and invisible anchor circles.
 * Each group becomes a Container with a purple rim copy behind the shapes.
 */
function parseArt(src: string): { groups: Record<string, Container>; glitter: Record<string, Graphics>; anchors: Record<string, Anchor> } {
  const doc = new DOMParser().parseFromString(src, "image/svg+xml");
  const groups: Record<string, Container> = {};
  const glitter: Record<string, Graphics> = {}; // red shapes of each group: where the sparkle shows
  let seed = 1;
  for (const g of doc.querySelectorAll("svg > g[id]")) {
    const rim = new Graphics();
    const shapes = new Graphics();
    const red = new Graphics();
    const groupRough = Number(g.getAttribute("data-rough") ?? 0);
    for (const poly of g.querySelectorAll("polygon")) {
      const raw = (poly.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
      const pts = roughen(raw, Number(poly.getAttribute("data-rough") ?? groupRough), seed++);
      const fill = poly.getAttribute("fill") ?? "#07050c";
      shapes.poly(pts).fill(fill);
      if (fill.toLowerCase() === "#ff2457") red.poly(pts).fill(0xffffff);
      if (poly.getAttribute("data-rim") !== "none") rim.poly(pts.map((v, i) => v + (i % 2 ? RIM.dy : RIM.dx))).fill(RIM.color);
    }
    const c = new Container();
    c.addChild(rim, shapes);
    groups[g.id] = c;
    glitter[g.id] = red;
  }
  const anchors: Record<string, Anchor> = {};
  for (const c of doc.querySelectorAll("circle[id]")) {
    const n = (a: string) => Number(c.getAttribute(a) ?? 0);
    anchors[c.id] = { x: n("cx"), y: n("cy"), r: n("r"), rot: n("data-rot") };
  }
  return { groups, glitter, anchors };
}

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

/** Eye on anchor (x, y) with size r: black pointed lens, star creases, green ring, blue iris, white glint. */
function drawEye(g: Graphics, x: number, y: number, r: number, kind: EyeKind, side: number): void {
  if (kind === "closed") {
    g.poly([x - r * 1.3, y + r * 0.1, x + r * 1.3, y - r * 0.25, x + r * 1.2, y + r * 0.2, x - r * 1.2, y + r * 0.4]).fill(C.black);
    return;
  }
  if (kind === "wink") {
    // curved slash plus a crossing cut, as in the reference wink
    g.poly([x - r * 1.4, y + r * 0.9, x - r * 0.2, y - r * 0.1, x + r * 1.6, y + r * 0.2, x + r * 0.6, y + r * 0.35, x - r * 0.3, y + r * 0.35]).fill(C.black);
    g.poly([x - r * 0.4, y - r * 1.1, x + r * 0.2, y + r * 1.2, x - r * 0.05, y + r * 1.25, x - r * 0.7, y - r * 0.9]).fill(C.black);
    return;
  }
  if (kind === "happy") {
    g.poly([x - r * 1.3, y + r * 0.5, x, y - r * 0.8, x + r * 1.3, y + r * 0.5, x + r * 0.9, y + r * 0.6, x, y - r * 0.2, x - r * 0.9, y + r * 0.6]).fill(C.black);
    return;
  }
  const s = kind === "wide" ? 1.2 : kind === "fixed" ? 0.95 : 1;
  const R = r * s;
  // star creases (4 thin black spikes) behind the eye
  for (const [dx, dy] of [[-1.5, -1.6], [1.4, 1.7], [1.7, -1.2], [-1.6, 1.3]]) {
    g.poly([x - R * 0.2, y, x + R * dx, y + R * dy, x + R * 0.2, y]).fill(C.black);
  }
  g.poly([x - R * 1.35, y + R * 0.15, x - R * 0.4, y - R * 1.05, x + R * 1.35, y - R * 0.35, x + R * 0.45, y + R * 1.05]).fill(C.black);
  const py = kind === "up" ? -R * 0.3 : kind === "down" ? R * 0.3 : 0;
  g.circle(x, y + py, R * 0.86).fill(C.green);
  g.circle(x, y + py, R * 0.7).fill(C.black);
  g.circle(x, y + py, R * 0.6).fill(C.blue);
  g.circle(x + R * 0.2, y + py - R * 0.12, kind === "fixed" ? R * 0.16 : R * 0.26).fill(C.white);
  if (kind === "angry") {
    // heavy lid slashing down toward the center
    g.poly([x - R * 1.5, y - R * 1.3 - side * R * 0.6, x + R * 1.5, y - R * 1.3 + side * R * 0.6, x + R * 1.5, y - R * 0.3 + side * R * 0.7, x - R * 1.5, y - R * 0.3 - side * R * 0.7]).fill(C.green);
    g.poly([x - R * 1.4, y - R * 0.45 - side * R * 0.7, x + R * 1.4, y - R * 0.45 + side * R * 0.7, x + R * 1.4, y - R * 0.25 + side * R * 0.7, x - R * 1.4, y - R * 0.25 - side * R * 0.7]).fill(C.black);
  }
  if (kind === "down") {
    g.poly([x - R * 1.5, y - R * 1.3, x + R * 1.5, y - R * 1.3, x + R * 1.5, y - R * 0.2 + side * R * 0.4, x - R * 1.5, y - R * 0.2 - side * R * 0.4]).fill(C.green);
  }
}

/** Triangular white grin pointing down, with notched teeth along the top edge. */
function drawGrin(g: Graphics, x: number, y: number, w: number, h: number, skew = 0): void {
  const pts: number[] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = x - w / 2 + t * w;
    pts.push(px, y - h * 0.15 * (1 - t) + (i % 2 ? h * 0.12 : 0) - skew * t * h * 0.3);
  }
  pts.push(x + w * 0.08 + skew * w * 0.2, y + h);
  g.poly(pts).fill(C.white);
}

function drawZigzag(g: Graphics, x: number, y: number, w: number, curve: number): void {
  const pts: number[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(x - w / 2 + t * w, y - curve * (1 - (2 * t - 1) ** 2) + (i % 2 ? -3 : 3));
  }
  g.poly(pts, false).stroke({ width: 2.5, color: C.white, join: "miter" });
}

function drawMouth(g: Graphics, a: Anchor, shape: string): void {
  const { x, y, r } = a;
  switch (shape) {
    case "zigzag":
    case "closed":
      return drawZigzag(g, x, y, r * 1.3, -2);
    case "frown":
      return drawZigzag(g, x, y + 4, r * 1.1, 5);
    case "grin":
      return drawGrin(g, x, y - r * 0.3, r * 2, r * 0.9);
    case "smirk":
      return drawGrin(g, x + r * 0.25, y - r * 0.25, r * 1.5, r * 0.6, 1);
    case "open_big":
      return drawGrin(g, x, y - r * 0.35, r * 2.2, r * 1.3);
    case "A":
      return drawGrin(g, x, y - r * 0.3, r * 1.4, r * 0.95);
    case "E":
      return drawGrin(g, x, y - r * 0.25, r * 1.8, r * 0.5);
    case "O":
      g.poly([x, y - r * 0.35, x + r * 0.4, y + r * 0.1, x, y + r * 0.6, x - r * 0.4, y + r * 0.1]).fill(C.white);
      return;
  }
}

interface PoseView {
  root: Container;
  hair: Container;
  speckles: Graphics;
  hairBounds: Rectangle;
  arms: Partial<Record<Arms, Container>>;
  head: Container;
  headAnchor: Anchor;
  face: Graphics;
}

function buildPose(src: string, head: ReturnType<typeof parseArt>): PoseView {
  const art = parseArt(src);
  const root = new Container();
  const hairShape = art.groups.hair;
  const hairRed = art.glitter.hair;
  const hair = new Container();
  const speckles = new Graphics();
  const mask = hairRed;
  speckles.mask = mask;
  hair.addChild(hairShape, speckles, mask);
  if (art.groups["hair-front"]) hair.addChild(art.groups["hair-front"]); // dark shards above the glitter
  root.addChild(hair);
  if (art.groups.body) root.addChild(art.groups.body);
  const arms: PoseView["arms"] = {};
  for (const k of ["arms-rest", "arms-point", "arms-cross"] as Arms[]) {
    if (art.groups[k]) {
      arms[k] = art.groups[k];
      root.addChild(art.groups[k]);
    }
  }
  const headC = new Container();
  const face = new Graphics();
  const share = (c: Container) => {
    const copy = new Container();
    for (const g of c.children as Graphics[]) copy.addChild(new Graphics(g.context));
    return copy;
  };
  headC.addChild(share(head.groups.crown), share(head.groups.mask), face);
  const a = art.anchors.head;
  headC.position.set(a.x, a.y);
  headC.scale.set(a.r / 10);
  headC.rotation = (a.rot * Math.PI) / 180;
  root.addChild(headC);
  if (art.groups.front) root.addChild(art.groups.front);
  return { root, hair, speckles, hairBounds: hairRed.getLocalBounds().rectangle.clone(), arms, head: headC, headAnchor: a, face };
}

export interface AvatarRenderer {
  app: Application;
  draw(pose: Pose, now: number): void;
}

export async function createAvatar(parent: HTMLElement, style: Style, showFps: boolean, scale = 1): Promise<AvatarRenderer> {
  const app = new Application();
  await app.init({
    width: W * scale,
    height: H * scale,
    backgroundAlpha: 0,
    antialias: true,
    preference: "webgl",
    resolution: window.devicePixelRatio,
    autoDensity: true,
  });
  parent.appendChild(app.canvas);

  const head = parseArt(headSvg);
  const poses = Object.fromEntries(
    (Object.keys(SVGS) as BodyPose[]).map((k) => [k, buildPose(SVGS[k], head)]),
  ) as Record<BodyPose, PoseView>;

  const root = new Container(); // fixed: holds the filters
  const scene = new Container(); // moves: jumps
  root.addChild(scene);
  root.scale.set(scale);
  for (const p of Object.values(poses)) scene.addChild(p.root);
  app.stage.addChild(root);

  const glitch = glitchFilter();
  const styleFilter = style === "pixel" ? pixelFilter() : style === "ascii" ? asciiFilter() : null;
  root.filters = [glitch, ...(styleFilter ? [styleFilter] : [])];
  root.filterArea = new Rectangle(0, 0, W * scale, H * scale);

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
        const r = rng(pose.frame);
        const t = pose.gestureT;
        // Pointing and crossing arms are drawn on the standing pose.
        const gestureArms: Arms | null = pose.gesto === "senalar" ? "arms-point" : pose.gesto === "cruzar_brazos" ? "arms-cross" : null;
        const bodyPose: BodyPose = gestureArms ? "de_pie" : look.pose;
        const arms = gestureArms ?? look.arms ?? "arms-rest";
        for (const [name, v] of Object.entries(poses)) v.root.visible = name === bodyPose;
        const v = poses[bodyPose];
        for (const [k, g] of Object.entries(v.arms)) g.visible = k === arms;

        // hair: jitter at 12 fps, sparkling specks re-scattered every pose frame
        v.hair.position.set((r() - 0.5) * look.hair, (r() - 0.5) * look.hair);
        v.speckles.clear();
        const b = v.hairBounds;
        const count = Math.round((b.width * b.height) / 55); // dense fine glitter, like the show
        for (let i = 0; i < count; i++) {
          v.speckles.circle(b.x + r() * b.width, b.y + r() * b.height, 0.45 + r() ** 4 * 1.8);
        }
        v.speckles.fill({ color: C.white, alpha: 0.85 });

        // face
        v.face.clear();
        const ha = head.anchors;
        let [le, re] = look.eyes;
        if (pose.gesto === "guino") re = "wink";
        if (pose.blinking) {
          le = "closed";
          if (re !== "wink") re = "closed";
        }
        drawEye(v.face, ha["eye-l"].x, ha["eye-l"].y, ha["eye-l"].r, le, 1);
        drawEye(v.face, ha["eye-r"].x, ha["eye-r"].y, ha["eye-r"].r, re, -1);
        if (look.extraEyes) {
          for (const [id, a] of Object.entries(ha)) {
            if (id.startsWith("eye-x")) drawEye(v.face, a.x, a.y, a.r, pose.blinking ? "closed" : "wide", 1);
          }
        }
        drawMouth(v.face, ha.mouth, pose.mouth ?? look.mouth);

        // head motion: breathing, nod, tilt
        const base = v.headAnchor;
        let rot = (base.rot * Math.PI) / 180;
        let dy = pose.breath * 1.5;
        if (pose.gesto === "asentir") dy += Math.sin(t * Math.PI * 2) * 7;
        if (pose.gesto === "ladear_cabeza") rot += ease(t) * 0.25;
        v.head.rotation = rot;
        v.head.position.set(base.x, base.y + dy);
        scene.position.y = pose.gesto === "saltar" ? -ease(t) * 34 : 0;
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
