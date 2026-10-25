// Shows the pet on screen through PixiJS with crisp pixels: either the code-drawn pet (src/pet)
// or, for behaviors that have them, frame-by-frame sprite clips (avatar/assets/pet/anim).
import { Application, Sprite, Texture } from "pixi.js";

import type { ClipFrame } from "../pet/clips.ts";
import { Painter } from "../pet/draw.ts";
import { GROUND, H, W, type Pose } from "../pet/rig.ts";

export const SCALE = 3; // code-drawn pet
export const CLIP_SCALE = 2; // sprite clips are drawn at a higher native resolution

type Box = { x: number; y: number; w: number; h: number };

interface ClipFrames {
  textures: Texture[];
  boxes: Box[]; // opaque area of each frame, native px
  anchor: [number, number]; // feet of the first frame (bottom center of its box), native px
}

export interface PetRenderer {
  app: Application;
  paint(pose: Pose, time: number, glitch: number): void;
  /** Shows a sprite clip frame instead of the code-drawn pet; null switches back. */
  showClip(frame: ClipFrame | null): void;
  /** Opaque area of the current frame in CSS px, relative to the canvas. */
  bounds(): Box | null;
}

const clipUrls = import.meta.glob("../../assets/pet/anim/*/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

function opaqueBox(img: HTMLImageElement): Box {
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

/** Loads every clip folder: frames named <clip>_NN.png, in order. */
async function loadClips(): Promise<Record<string, ClipFrames>> {
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
  return clips;
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
  const clips = await loadClips();
  const clip = new Sprite();
  clip.scale.set(CLIP_SCALE);
  clip.visible = false;
  app.stage.addChild(drawn, clip);

  let shown: { frames: ClipFrames; index: number } | null = null;
  const feet: [number, number] = [(W * SCALE) / 2, GROUND * SCALE];

  return {
    app,
    paint(pose, time, glitch) {
      painter.paint(pose, time, glitch);
      texture.source.update();
    },
    showClip(frame) {
      const frames = frame && clips[frame.clip];
      shown = frames ? { frames, index: Math.min(frame.index, frames.textures.length - 1) } : null;
      drawn.visible = !shown;
      clip.visible = !!shown;
      if (!shown) return;
      clip.texture = shown.frames.textures[shown.index];
      const [ax, ay] = shown.frames.anchor;
      clip.position.set(Math.round(feet[0] - ax * CLIP_SCALE), Math.round(feet[1] - ay * CLIP_SCALE));
    },
    bounds() {
      if (shown) {
        const b = shown.frames.boxes[shown.index];
        return { x: clip.x + b.x * CLIP_SCALE, y: clip.y + b.y * CLIP_SCALE, w: b.w * CLIP_SCALE, h: b.h * CLIP_SCALE };
      }
      const b = painter.bounds();
      return b && { x: b.x * SCALE, y: b.y * SCALE, w: b.w * SCALE, h: b.h * SCALE };
    },
  };
}
