// Shows the procedurally painted pet (src/pet) on screen through PixiJS, scaled up with crisp pixels.
import { Application, Sprite, Texture } from "pixi.js";

import { Painter } from "../pet/draw.ts";
import { H, W, type Pose } from "../pet/rig.ts";

export const SCALE = 3;

export interface PetRenderer {
  app: Application;
  paint(pose: Pose, time: number, glitch: number): void;
  /** Opaque area of the last frame in CSS px, relative to the canvas. */
  bounds(): { x: number; y: number; w: number; h: number } | null;
}

export async function createPet(parent: HTMLElement): Promise<PetRenderer> {
  const app = new Application();
  await app.init({ width: W * SCALE, height: H * SCALE, backgroundAlpha: 0, antialias: false, preference: "webgl" });
  parent.appendChild(app.canvas);

  const painter = new Painter();
  const texture = Texture.from(painter.canvas);
  texture.source.scaleMode = "nearest";
  const sprite = new Sprite(texture);
  sprite.scale.set(SCALE);
  app.stage.addChild(sprite);

  return {
    app,
    paint(pose, time, glitch) {
      painter.paint(pose, time, glitch);
      texture.source.update();
    },
    bounds() {
      const b = painter.bounds();
      return b && { x: b.x * SCALE, y: b.y * SCALE, w: b.w * SCALE, h: b.h * SCALE };
    },
  };
}
