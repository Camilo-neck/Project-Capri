// Shows the pet on screen through PixiJS with crisp pixels: either the code-drawn pet (src/pet)
// or, for behaviors that have them, frame-by-frame sprite clips (avatar/assets/pet/anim).
import { Application, Container, Sprite, Texture } from "pixi.js";

import type { ClipFrame } from "../pet/clips.ts";
import { Painter } from "../pet/draw.ts";
import { GROUND, H, W, type Pose } from "../pet/rig.ts";
import { glitchFilter, setUniform } from "../shaders/filters.ts";
import type { Glitch } from "../state/glitch.ts";

export const SCALE = 3; // code-drawn pet
export const CLIP_SCALE = 2; // sprite clips are drawn at a higher native resolution

type Box = { x: number; y: number; w: number; h: number };

const SHARD_COLORS = [0xff2152, 0xff2152, 0x8b38ff, 0x36ff7a, 0xffffff];
const SHARD_MS = 260;

interface Shard {
  sprite: Sprite;
  x: number;
  y: number;
  vx: number; // px/ms
  vy: number;
  age: number;
}

interface ClipFrames {
  textures: Texture[];
  boxes: Box[]; // opaque area of each frame, native px
  anchor: [number, number]; // feet of the first frame (bottom center of its box), native px
}

export interface PetRenderer {
  app: Application;
  paint(pose: Pose, time: number): void;
  /** Glitch on top of whatever is shown; seed picks the bands, change it per frame. */
  glitch(g: Glitch, seed: number): void;
  /** Teleport shards: flying off her body, or (inward) gathering into it. */
  burst(inward: boolean): void;
  /** Moves the shards along; call every render tick. */
  step(dtMs: number): void;
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
  // The filter goes on her body only; shards fly outside it so a collapse doesn't swallow them.
  const body = new Container();
  body.addChild(drawn, clip);
  const filter = glitchFilter();
  filter.padding = 36; // room for shifted bands
  filter.enabled = false;
  body.filters = [filter];
  const shardLayer = new Container();
  app.stage.addChild(body, shardLayer);
  let shards: Shard[] = [];

  let shown: { frames: ClipFrames; index: number } | null = null;
  const feet: [number, number] = [(W * SCALE) / 2, GROUND * SCALE];

  function bounds(): Box | null {
    if (shown) {
      const b = shown.frames.boxes[shown.index];
      return { x: clip.x + b.x * CLIP_SCALE, y: clip.y + b.y * CLIP_SCALE, w: b.w * CLIP_SCALE, h: b.h * CLIP_SCALE };
    }
    const b = painter.bounds();
    return b && { x: b.x * SCALE, y: b.y * SCALE, w: b.w * SCALE, h: b.h * SCALE };
  }

  return {
    app,
    bounds,
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
      setUniform(filter, "uGrid", shown ? [clip.x, clip.y, CLIP_SCALE] : [drawn.x, drawn.y, SCALE]);
      setUniform(filter, "uCollapse", g.collapse);
      setUniform(filter, "uDissolve", g.dissolve);
      const b = bounds();
      setUniform(filter, "uAxis", b ? b.x + b.w / 2 : 0);
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
    burst(inward) {
      const b = bounds();
      if (!b) return;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 0.25 + Math.random() * 0.45; // px/ms
        const sprite = new Sprite(Texture.WHITE);
        sprite.tint = SHARD_COLORS[i % SHARD_COLORS.length];
        sprite.width = CLIP_SCALE * (i % 3 === 0 ? 4 : 2); // strips and specks, in native px
        sprite.height = CLIP_SCALE * (i % 3 === 0 ? 1 : 2);
        shardLayer.addChild(sprite);
        // inward: start where an outward shard would be at the end, flying back to the middle
        const r = inward ? speed * SHARD_MS : Math.random() * b.w * 0.4;
        shards.push({
          sprite,
          x: cx + Math.cos(a) * r,
          y: cy + Math.sin(a) * r * 1.4,
          vx: Math.cos(a) * speed * (inward ? -1 : 1),
          vy: Math.sin(a) * speed * 1.4 * (inward ? -1 : 1),
          age: 0,
        });
      }
    },
    step(dt) {
      shards = shards.filter((s) => {
        s.age += dt;
        if (s.age >= SHARD_MS) {
          s.sprite.destroy();
          return false;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.sprite.position.set(Math.round(s.x / CLIP_SCALE) * CLIP_SCALE, Math.round(s.y / CLIP_SCALE) * CLIP_SCALE);
        s.sprite.alpha = s.age < SHARD_MS * 0.6 ? 1 : 0.5; // two steps, no smooth fade
        return true;
      });
    },
  };
}
