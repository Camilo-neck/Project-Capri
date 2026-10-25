// Desktop-pet Capri: pixel-art sprites cut from the reference sheet (scripts/slice_pet.py).
import { Application, Assets, Container, Sprite, type Texture } from "pixi.js";

import { glitchFilter, setUniform } from "../shaders/filters.ts";
import type { Pose } from "../state/avatar.ts";
import type { Sprite as SpriteName } from "../state/pet.ts";

export const W = 240;
export const H = 250;

const urls = import.meta.glob("../../assets/pet/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

const ease = (t: number) => Math.sin(t * Math.PI); // 0 -> 1 -> 0
const SWING = new Set<SpriteName>(["sentada_a", "sentada_b"]);

export interface PetRenderer {
  app: Application;
  draw(sprite: SpriteName, pose: Pose, now: number): void;
}

export async function createPet(parent: HTMLElement): Promise<PetRenderer> {
  const app = new Application();
  await app.init({ width: W, height: H, backgroundAlpha: 0, antialias: false, roundPixels: true, preference: "webgl" });
  parent.appendChild(app.canvas);

  const textures: Partial<Record<SpriteName, Texture>> = {};
  for (const [path, url] of Object.entries(urls)) {
    const name = path.split("/").pop()!.replace(".png", "");
    if (name === "source") continue;
    const tex: Texture = await Assets.load(url);
    tex.source.scaleMode = "nearest"; // crisp pixels
    textures[name as SpriteName] = tex;
  }

  // Anchored at the bottom center, so jumps and tilts pivot on her feet.
  const holder = new Container();
  holder.position.set(W / 2, H);
  const sprite = new Sprite();
  sprite.anchor.set(0.5, 1);
  holder.addChild(sprite);
  app.stage.addChild(holder);

  const glitch = glitchFilter();
  holder.filters = [glitch];

  let current: SpriteName | null = null;
  let flash = 0;
  return {
    app,
    draw(name, pose, now) {
      if (name !== current) {
        // A new pose pops in with a short glitch, except the leg swing, which is just animation.
        if (current && !(SWING.has(name) && SWING.has(current))) flash = 1;
        current = name;
        sprite.texture = textures[name]!;
      }
      const t = pose.gestureT;
      const tq = pose.frame * (1000 / 12); // 12 fps motion, like the rest of the avatar
      let y = 0;
      if (name === "meditar") y -= 3 + Math.sin(tq / 600) * 3; // floating
      if (pose.mouth && pose.mouth !== "closed") y -= 2; // talking bounce
      if (pose.gesto === "saltar") y -= ease(t) * 24;
      if (pose.gesto === "asentir") y += Math.sin(t * Math.PI * 2) * 3;
      holder.position.y = H + Math.round(y);
      holder.rotation = pose.gesto === "ladear_cabeza" ? ease(t) * 0.12 : 0;

      const amount = Math.max(pose.glitch, flash);
      glitch.enabled = amount > 0;
      setUniform(glitch, "uAmount", amount);
      setUniform(glitch, "uSeed", Math.floor(now / 50));
      flash = Math.max(0, flash - 0.08);
    },
  };
}
