// Shows the pet on screen through PixiJS: in the pixel style, either the code-drawn pet (src/pet) or,
// for behaviors that have them, PixelLab sprite clips (avatar/assets/pet/anim), with crisp pixels; in
// the original style, the show's art (avatar/assets/original), scaled down smoothly once on load.
import { Application, Rectangle, Sprite, Texture } from "pixi.js";

import { ORIGINAL_CLIPS, type ClipFrame, type Style } from "../pet/clips.ts";
import { Painter } from "../pet/draw.ts";
import { GROUND, H, W, type Pose } from "../pet/rig.ts";
import { glitchFilter, setUniform } from "../shaders/filters.ts";
import type { Glitch } from "../state/glitch.ts";

export const SCALE = 3; // code-drawn pet
export const CLIP_SCALE = 2; // pixel sprite clips are drawn at a higher native resolution
export const ORIGINAL_SCALE = 0.6; // the show's art: 384 px tall cells, ~220 px on screen

type Box = { x: number; y: number; w: number; h: number };

interface ClipFrames {
  textures: Texture[];
  boxes: Box[]; // opaque area of each frame, texture px
  anchor: [number, number]; // feet (or seat), texture px
}

interface ClipSet {
  clips: Record<string, ClipFrames>;
  scale: number; // sprite scale
  grid: number; // glitch bands snap to this many screen px
}

export interface PetRenderer {
  app: Application;
  paint(pose: Pose, time: number): void;
  /** Glitch on top of whatever is shown; seed picks the bands, change it per frame. */
  glitch(g: Glitch, seed: number): void;
  /** Switches the clip art; the original strips load the first time. */
  setStyle(style: Style): Promise<void>;
  /** Shows a sprite clip frame instead of the code-drawn pet (null switches back), with a jaw cell over it. */
  showClip(frame: ClipFrame | null, mouth?: number | null): void;
  /** Opaque area of the current frame in CSS px, relative to the canvas. */
  bounds(): Box | null;
  /** A copy of what's on the canvas now (for her afterimages), the canvas's size. */
  snapshot(): HTMLCanvasElement;
}

const clipUrls = import.meta.glob("../../assets/pet/anim/*/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const stripUrls = import.meta.glob("../../assets/original/*.webp", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

function opaqueBox(img: HTMLImageElement | HTMLCanvasElement): Box {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] < 128) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Loads every pixel clip folder: frames named <clip>_NN.png, in order. */
async function loadPixelClips(): Promise<ClipSet> {
  const byClip: Record<string, [string, string][]> = {};
  for (const [path, url] of Object.entries(clipUrls)) {
    const m = path.match(/anim\/([^/]+)\/\1_(\d+)\.png$/);
    if (m) (byClip[m[1]] ??= []).push([m[2], url]);
  }
  const clips: Record<string, ClipFrames> = {};
  for (const [name, entries] of Object.entries(byClip)) {
    entries.sort(([a], [b]) => Number(a) - Number(b));
    const imgs = await Promise.all(entries.map(([, url]) => loadImage(url)));
    const textures = imgs.map((img) => {
      const t = Texture.from(img);
      t.source.scaleMode = "nearest";
      return t;
    });
    const boxes = imgs.map(opaqueBox);
    const b = boxes[0];
    clips[name] = { textures, boxes, anchor: [b.x + b.w / 2, b.y + b.h] };
  }
  return { clips, scale: CLIP_SCALE, grid: CLIP_SCALE };
}

/** Cuts the original strips into frames at screen size (a GPU downscale of painted art would shimmer). */
async function loadOriginalClips(): Promise<ClipSet> {
  const strips: Record<string, Promise<HTMLImageElement>> = {};
  const clips: Record<string, ClipFrames> = {};
  await Promise.all(Object.entries(ORIGINAL_CLIPS).map(async ([name, info]) => {
    const strip = info.strip ?? name;
    const url = Object.entries(stripUrls).find(([path]) => path.endsWith(`/${strip}.webp`))?.[1];
    if (!url) return;
    const img = await (strips[strip] ??= loadImage(url));
    const cw = img.width / info.frames;
    const w = Math.round(cw * ORIGINAL_SCALE), h = Math.round(img.height * ORIGINAL_SCALE);
    const frames = Array.from({ length: info.frames }, (_, i) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.imageSmoothingQuality = "high";
      g.drawImage(img, i * cw, 0, cw, img.height, 0, 0, w, h);
      return c;
    });
    const [ax, ay] = info.anchor ?? [cw / 2, img.height];
    clips[name] = {
      textures: frames.map((c) => Texture.from(c)),
      boxes: frames.map(opaqueBox),
      anchor: [ax * ORIGINAL_SCALE, ay * ORIGINAL_SCALE],
    };
  }));
  return { clips, scale: 1, grid: 2 };
}

export async function createPet(parent: HTMLElement): Promise<PetRenderer> {
  const app = new Application();
  await app.init({ width: W * SCALE, height: H * SCALE, backgroundAlpha: 0, antialias: false, preference: "webgl" });
  parent.appendChild(app.canvas);

  const painter = new Painter();
  const texture = Texture.from(painter.canvas);
  texture.source.scaleMode = "nearest";
  const drawn = new Sprite(texture);
  drawn.scale.set(SCALE);

  // Clip frames stand on the same ground line as the code-drawn pet, centered.
  const sets: Partial<Record<Style, Promise<ClipSet>>> = { pixel: loadPixelClips() };
  let set = await sets.pixel!;
  const clip = new Sprite();
  clip.visible = false;
  const jaw = new Sprite();
  jaw.visible = false;
  app.stage.addChild(drawn, clip, jaw);
  const filter = glitchFilter();
  filter.padding = 36; // room for shifted bands
  filter.enabled = false;
  app.stage.filters = [filter];

  let shown: { frames: ClipFrames; index: number } | null = null;
  const feet: [number, number] = [(W * SCALE) / 2, GROUND * SCALE];

  function bounds(): Box | null {
    if (shown) {
      const b = shown.frames.boxes[shown.index];
      const s = set.scale;
      return { x: clip.x + b.x * s, y: clip.y + b.y * s, w: b.w * s, h: b.h * s };
    }
    const b = painter.bounds();
    return b && { x: b.x * SCALE, y: b.y * SCALE, w: b.w * SCALE, h: b.h * SCALE };
  }

  return {
    app,
    bounds,
    snapshot() {
      return app.renderer.extract.canvas({ target: app.stage, frame: new Rectangle(0, 0, W * SCALE, H * SCALE) }) as HTMLCanvasElement;
    },
    paint(pose, time) {
      painter.paint(pose, time);
      texture.source.update();
    },
    glitch(g, seed) {
      filter.enabled = g.glitch > 0 || g.split > 0 || g.sil[3] > 0 || g.collapse > 0 || g.dissolve > 0;
      if (!filter.enabled) return;
      setUniform(filter, "uGlitch", g.glitch);
      setUniform(filter, "uSplit", g.split);
      setUniform(filter, "uSeed", seed);
      setUniform(filter, "uSil", g.sil);
      setUniform(filter, "uGrid", shown ? [clip.x, clip.y, set.grid] : [drawn.x, drawn.y, SCALE]);
      setUniform(filter, "uCollapse", g.collapse);
      setUniform(filter, "uDissolve", g.dissolve);
      const b = bounds();
      setUniform(filter, "uAxis", b ? b.x + b.w / 2 : 0);
    },
    async setStyle(style) {
      set = await (sets[style] ??= style === "pixel" ? loadPixelClips() : loadOriginalClips());
      shown = null;
    },
    showClip(frame, mouth = null) {
      const frames = frame && set.clips[frame.clip];
      shown = frames ? { frames, index: Math.min(frame.index, frames.textures.length - 1) } : null;
      drawn.visible = !shown;
      clip.visible = !!shown;
      const jawFrames = set.clips.mouth;
      jaw.visible = !!shown && mouth !== null && !!jawFrames;
      if (!shown) return;
      clip.texture = shown.frames.textures[shown.index];
      clip.scale.set(set.scale);
      const [ax, ay] = shown.frames.anchor;
      clip.position.set(Math.round(feet[0] - ax * set.scale), Math.round(feet[1] - ay * set.scale));
      if (jaw.visible) {
        // the jaw cells line up with idle's
        jaw.texture = jawFrames.textures[Math.min(mouth!, jawFrames.textures.length - 1)];
        jaw.scale.set(set.scale);
        jaw.position.copyFrom(clip.position);
      }
    },
  };
}
