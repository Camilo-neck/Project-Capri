// Frame-by-frame sprite clips (PixelLab art in avatar/assets/pet/anim) for the behaviors that have
// them. Behaviors without clips keep the code-drawn pet. Pure logic: which clip and frame to show.
import type { Gesto } from "../net/protocol.ts";
import type { Behavior } from "./behaviors.ts";

export interface ClipInfo {
  frames: number;
  fps: number;
  pingpong?: boolean; // loops forth and back (for clips whose last frame doesn't lead into the first)
}

// Generated loops don't always end where they start, so they play forth and back.
const loop = (frames: number, fps: number): ClipInfo => ({ frames, fps, pingpong: true });

export const CLIPS: Record<string, ClipInfo> = {
  sentarse: { frames: 7, fps: 12 },
  sentada_idle: loop(9, 7),
  hablar: loop(9, 8),
  feliz: loop(9, 10),
  enamorada: loop(9, 8),
  emocionada: loop(9, 12),
  traviesa: loop(9, 10),
  curiosa: loop(9, 8),
  pensativa: loop(9, 6),
  sorprendida: loop(9, 12),
  molesta: loop(9, 10),
  seria: loop(7, 5),
  saludar: loop(9, 10),
  // sitting family (3/4 view)
  abrir_portatil: { frames: 9, fps: 10 },
  dormirse: { frames: 9, fps: 6 },
  escribir: loop(9, 10),
  estirarse: loop(11, 8),
  hablar_sentada: loop(9, 8),
  meditar: loop(9, 6),
  dormir: loop(3, 2), // frames 4-9 had a hair artifact; the first three breathe cleanly
  triste: loop(9, 6),
  pinchada: loop(9, 12),
  acariciada: loop(9, 8),
  // standing, not tied to a behavior yet: confirmation of risky actions (phase 5)
  peligro: { frames: 9, fps: 10 },
};

/** Model gestures as clips; they replace the standing loop while the gesture lasts. */
export const GESTURE_CLIPS: Partial<Record<Gesto, ClipInfo & { clip: string }>> = {
  asentir: { clip: "asentir", frames: 7, fps: 12 },
  ladear_cabeza: { clip: "ladear", frames: 7, fps: 10 },
  guino: { clip: "guino", frames: 7, fps: 10 },
  saltar: { clip: "saltar", frames: 9, fps: 12 },
  senalar: { clip: "senalar", frames: 7, fps: 10 },
  cruzar_brazos: { clip: "cruzar_brazos", frames: 7, fps: 10 },
};

/** Frame of a gesture clip at progress t (0..1), if the gesture has one and the pet is standing. */
export function gestureFrame(gesto: Gesto, t: number, current: ClipFrame | null, behavior: Behavior): ClipFrame | null {
  const g = GESTURE_CLIPS[gesto];
  const standing = current && !spritesFor(behavior)?.enter?.length;
  if (!g || !standing || t <= 0 || t >= 1) return null;
  return { clip: g.clip, index: Math.min(g.frames - 1, Math.floor(t * g.frames)) };
}

/**
 * Behaviors drawn with clips. `enter` is the chain of one-shot transitions that leads from
 * standing into the behavior's pose (e.g. sit down, then open the laptop); `loop` plays after it.
 * Switching behaviors undoes (reversed) the transitions the next one doesn't share, then plays the
 * ones it adds: sitting -> typing only opens the laptop; typing -> talking closes it and stands up.
 */
export const SPRITE_FOR: Partial<Record<Behavior, { enter?: string[]; loop: string }>> = {
  sentada: { enter: ["sentarse"], loop: "sentada_idle" },
  escribir: { enter: ["sentarse", "abrir_portatil"], loop: "escribir" },
  estirarse: { enter: ["sentarse"], loop: "estirarse" },
  meditar: { enter: ["sentarse"], loop: "meditar" },
  dormir: { enter: ["sentarse", "dormirse"], loop: "dormir" },
  triste: { enter: ["sentarse"], loop: "triste" },
  pinchada: { enter: ["sentarse"], loop: "pinchada" },
  acariciada: { enter: ["sentarse"], loop: "acariciada" },
  hablar: { loop: "hablar" },
  feliz: { loop: "feliz" },
  enamorada: { loop: "enamorada" },
  emocionada: { loop: "emocionada" },
  traviesa: { loop: "traviesa" },
  curiosa: { loop: "curiosa" },
  pensativa: { loop: "pensativa" },
  sorprendida: { loop: "sorprendida" },
  molesta: { loop: "molesta" },
  seria: { loop: "seria" },
  saludar: { loop: "saludar" },
};

/** The behavior's clips, only if every one of them is available (art arrives a batch at a time). */
function spritesFor(b: Behavior) {
  const def = SPRITE_FOR[b];
  return def && [...(def.enter ?? []), def.loop].every((c) => c in CLIPS) ? def : undefined;
}

/** Mouse reactions must answer at once: no transitions into them. */
const INSTANT: ReadonlySet<Behavior> = new Set(["pinchada", "acariciada"]);

interface Step {
  clip: string;
  reverse: boolean;
  once: boolean;
  speed: number;
}

/** Undoing transitions (standing up, closing the laptop) runs faster so replies aren't delayed. */
export const EXIT_SPEED = 2;

export interface ClipFrame {
  clip: string;
  index: number; // 0-based frame
}

export const clipDuration = (c: ClipInfo) => (c.frames / c.fps) * 1000;

export class ClipPlayer {
  private steps: Step[] = [];
  private stepStart = 0;
  private behavior: Behavior | null = null;

  /** Call every frame with the director's behavior. */
  update(behavior: Behavior, now: number): void {
    if (behavior === this.behavior) return;
    const prev = this.behavior ? spritesFor(this.behavior) : undefined;
    const next = spritesFor(behavior);
    this.behavior = behavior;
    const steps: Step[] = [];
    const had = prev?.enter ?? [];
    const wants = next?.enter ?? [];
    if (!INSTANT.has(behavior)) {
      let shared = 0; // length of the common prefix
      while (shared < had.length && had[shared] === wants[shared]) shared++;
      for (const clip of had.slice(shared).reverse()) steps.push({ clip, reverse: true, once: true, speed: EXIT_SPEED });
      for (const clip of wants.slice(shared)) steps.push({ clip, reverse: false, once: true, speed: 1 });
    }
    if (next) steps.push({ clip: next.loop, reverse: false, once: false, speed: 1 });
    this.steps = steps;
    this.stepStart = now;
  }

  /** The clip frame to show now, or null to show the code-drawn pet. */
  frame(now: number): ClipFrame | null {
    while (this.steps.length) {
      const step = this.steps[0];
      const info = CLIPS[step.clip];
      const t = now - this.stepStart;
      const duration = clipDuration(info) / step.speed;
      if (step.once && t >= duration) {
        this.steps.shift();
        this.stepStart += duration;
        continue;
      }
      let i = Math.floor((t / 1000) * info.fps * step.speed);
      if (step.once) i = Math.min(i, info.frames - 1);
      else if (info.pingpong && info.frames > 1) {
        const period = 2 * (info.frames - 1);
        i %= period;
        if (i >= info.frames) i = period - i;
      } else i %= info.frames;
      return { clip: step.clip, index: step.reverse ? info.frames - 1 - i : i };
    }
    return null;
  }
}
