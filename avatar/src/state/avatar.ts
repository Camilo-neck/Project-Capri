import type { Emocion, Gesto } from "../net/protocol.ts";
import type { Mouth } from "./text.ts";

export const POSE_MS = 1000 / 20; // the pet animates at 20 fps (pixel-art pacing), the page renders at 60
export const GLITCH_MS = 150;
export const BLINK_MS = 120;

export const GESTURE_MS: Record<Gesto, number> = {
  ninguno: 0,
  asentir: 500,
  ladear_cabeza: 700,
  guino: 400,
  saltar: 600,
  senalar: 900,
  cruzar_brazos: 1000,
};

export interface Pose {
  frame: number; // pose frame index; the renderer redraws only when it changes
  emocion: Emocion;
  gesto: Gesto;
  gestureT: number; // 0..1 progress of the gesture, 0 when idle
  mouth: Mouth | null; // null = resting mouth of the current emotion
  blinking: boolean;
  glitch: number; // 0..1, flash after an emotion change
  breath: number; // -1..1
}

export class AvatarState {
  emocion: Emocion = "neutral";
  mouth: Mouth | null = null;
  private gesto: Gesto = "ninguno";
  private gestureStart = 0;
  private emotionChangedAt = -Infinity;
  private nextBlink: number;
  private blinkUntil = -Infinity;
  private rand: () => number;

  constructor(now = 0, rand: () => number = Math.random) {
    this.rand = rand;
    this.nextBlink = now + this.blinkGap();
  }

  private blinkGap(): number {
    return 2000 + this.rand() * 4000;
  }

  setEmotion(e: Emocion, now: number): void {
    if (e !== this.emocion) this.emotionChangedAt = now;
    this.emocion = e;
  }

  playGesture(g: Gesto, now: number): void {
    this.gesto = g;
    this.gestureStart = now;
  }

  pose(now: number): Pose {
    const frame = Math.floor(now / POSE_MS);
    const t = frame * POSE_MS; // quantized time: everything below moves at 12 fps
    if (now >= this.nextBlink) {
      this.blinkUntil = now + BLINK_MS;
      this.nextBlink = now + this.blinkGap();
    }
    const dur = GESTURE_MS[this.gesto];
    const elapsed = t - this.gestureStart;
    if (this.gesto !== "ninguno" && elapsed >= dur) this.gesto = "ninguno";
    const sinceChange = now - this.emotionChangedAt;
    return {
      frame,
      emocion: this.emocion,
      gesto: this.gesto,
      gestureT: this.gesto === "ninguno" ? 0 : Math.max(0, elapsed / dur),
      mouth: this.mouth,
      blinking: now < this.blinkUntil,
      glitch: sinceChange < GLITCH_MS ? 1 - sinceChange / GLITCH_MS : 0,
      breath: Math.sin((t / 3500) * Math.PI * 2),
    };
  }
}
