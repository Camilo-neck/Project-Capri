// Frame-by-frame sprite clips for the behaviors that have them, in two styles: "pixel" (PixelLab art
// in avatar/assets/pet/anim; behaviors without clips keep the code-drawn pet) and "original" (the
// show's art, strips in avatar/assets/original). Pure logic: which clip and frame to show.
import type { Gesto } from "../net/protocol.ts";
import type { Mouth } from "../state/text.ts";
import type { Behavior } from "./behaviors.ts";

export type Style = "pixel" | "original";

export interface ClipInfo {
  frames: number;
  fps: number;
  pingpong?: boolean; // loops forth and back (for clips whose last frame doesn't lead into the first)
  strip?: string; // original: the strip it plays (default: its own name), for faster copies of one
  anchor?: [number, number]; // original: where the feet (or the seat) are in a frame, native px
  /** Loops that blink: cells `at`.. of a cycle come from a blink clip (55% of cycles, 1 in 10 glitched). */
  blinks?: { at: number; normal: string; glitchy: string };
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

// The original strips (lachydotmcg/capri-desktop): 240x384 cells, perch ones 384x384.
const STAND: [number, number] = [120, 367];
const SEAT: [number, number] = [115, 303]; // where she sits on the ledge, legs over it
const stand = (frames: number, fps: number, more: Partial<ClipInfo> = {}): ClipInfo => ({ frames, fps, anchor: STAND, ...more });
const seat = (frames: number, fps: number): ClipInfo => ({ frames, fps, anchor: SEAT });

export const ORIGINAL_CLIPS: Record<string, ClipInfo> = {
  idle: stand(16, 8, { blinks: { at: 9, normal: "blink", glitchy: "blink_glitch" } }),
  blink: stand(4, 8),
  blink_glitch: stand(4, 8),
  grin: stand(16, 8),
  sonrisa: stand(16, 16, { strip: "grin" }), // a quick grin before a cheeky reply
  glitch: stand(10, 15),
  dangle: stand(24, 10),
  sleep: stand(16, 6),
  wake: stand(13, 15),
  perch: seat(16, 8),
  perch_blink: seat(4, 8),
  perch_blink_glitch: seat(4, 8),
  perch_glitch: seat(10, 15),
  mouth: stand(5, 12), // jaw overlay for idle, one cell per mouth shape
};

/** Sitting on a window, the standing clips that have a perched twin (same length) use it. */
export const PERCHED: Record<string, string> = {
  idle: "perch",
  blink: "perch_blink",
  blink_glitch: "perch_blink_glitch",
  glitch: "perch_glitch",
};

/** Jaw cell over idle for a mouth shape; null when not talking or not on idle. */
export function mouthCell(mouth: Mouth | null, frame: ClipFrame | null): number | null {
  if (!mouth || frame?.clip !== "idle") return null;
  return { closed: 0, E: 2, A: 3, O: 3 }[mouth];
}

/** Model gestures as clips; they replace the standing loop while the gesture lasts. */
export const GESTURE_CLIPS: Partial<Record<Gesto, ClipInfo & { clip: string }>> = {
  asentir: { clip: "asentir", frames: 7, fps: 12 },
  ladear_cabeza: { clip: "ladear", frames: 7, fps: 10 },
  guino: { clip: "guino", frames: 7, fps: 10 },
  saltar: { clip: "saltar", frames: 9, fps: 12 },
  senalar: { clip: "senalar", frames: 7, fps: 10 },
  cruzar_brazos: { clip: "cruzar_brazos", frames: 7, fps: 10 },
};

/** Frame of a gesture clip at progress t (0..1), if the gesture has one and the pet is standing (pixel
 * only: the show's art has no gestures short enough). */
export function gestureFrame(gesto: Gesto, t: number, current: ClipFrame | null, behavior: Behavior, style: Style = "pixel"): ClipFrame | null {
  const g = style === "pixel" ? GESTURE_CLIPS[gesto] : undefined;
  const standing = current && !spritesFor(behavior, "pixel")?.enter?.length;
  if (!g || !standing || t <= 0 || t >= 1) return null;
  return { clip: g.clip, index: Math.min(g.frames - 1, Math.floor(t * g.frames)) };
}

/**
 * Behaviors drawn with clips. `enter` is the chain of one-shot transitions that leads from
 * standing into the behavior's pose (e.g. sit down, then open the laptop); `loop` plays after it.
 * Switching behaviors undoes (reversed) the transitions the next one doesn't share, then plays the
 * ones it adds: sitting -> typing only opens the laptop; typing -> talking closes it and stands up.
 */
interface SpriteDef {
  enter?: string[];
  loop: string;
  /** Played forward on leaving, instead of the enter chain reversed (waking up is not falling asleep backwards). */
  exit?: string[];
}

export const SPRITE_FOR: Partial<Record<Behavior, SpriteDef>> = {
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

/** The show's art has no clip per emotion: replies mostly talk over idle (10.C adds her close-ups). */
export const ORIGINAL_SPRITE_FOR: Record<Behavior, SpriteDef> = {
  sentada: { loop: "idle" },
  meditar: { loop: "idle" },
  estirarse: { loop: "idle" },
  escribir: { loop: "idle" },
  hablar: { loop: "idle" },
  enamorada: { loop: "idle" },
  curiosa: { loop: "idle" },
  pensativa: { loop: "idle" },
  seria: { loop: "idle" },
  triste: { loop: "idle" },
  feliz: { enter: ["sonrisa"], exit: [], loop: "idle" },
  emocionada: { enter: ["sonrisa"], exit: [], loop: "idle" },
  traviesa: { enter: ["sonrisa"], exit: [], loop: "idle" },
  sorprendida: { enter: ["glitch"], exit: [], loop: "idle" },
  molesta: { enter: ["glitch"], exit: [], loop: "idle" },
  dormir: { enter: ["glitch"], loop: "sleep", exit: ["wake"] },
  saludar: { enter: ["wake"], exit: [], loop: "idle" },
  pinchada: { loop: "glitch" },
  acariciada: { loop: "grin" },
};

export const STYLE_CLIPS: Record<Style, Record<string, ClipInfo>> = { pixel: CLIPS, original: ORIGINAL_CLIPS };

/** The behavior's clips, only if every one of them is available (art arrives a batch at a time). */
function spritesFor(b: Behavior, style: Style) {
  const def = style === "pixel" ? SPRITE_FOR[b] : ORIGINAL_SPRITE_FOR[b];
  const clips = STYLE_CLIPS[style];
  return def && [...(def.enter ?? []), def.loop, ...(def.exit ?? [])].every((c) => c in clips) ? def : undefined;
}

function hash(n: number): number {
  const x = Math.sin(n * 78.233 + 11.3) * 43758.5453;
  return x - Math.floor(x);
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
  private readonly clips: Record<string, ClipInfo>;
  readonly style: Style;

  constructor(style: Style = "pixel") {
    this.style = style;
    this.clips = STYLE_CLIPS[style];
  }

  /** Call every frame with the director's behavior. */
  update(behavior: Behavior, now: number): void {
    if (behavior === this.behavior) return;
    const prev = this.behavior ? spritesFor(this.behavior, this.style) : undefined;
    const next = spritesFor(behavior, this.style);
    this.behavior = behavior;
    const steps: Step[] = [];
    const had = prev?.enter ?? [];
    const wants = next?.enter ?? [];
    if (!INSTANT.has(behavior)) {
      let shared = 0; // length of the common prefix
      while (shared < had.length && had[shared] === wants[shared]) shared++;
      if (prev?.exit) for (const clip of prev.exit) steps.push({ clip, reverse: false, once: true, speed: 1 });
      else for (const clip of had.slice(shared).reverse()) steps.push({ clip, reverse: true, once: true, speed: EXIT_SPEED });
      for (const clip of wants.slice(shared)) {
        if (steps[steps.length - 1]?.clip !== clip) steps.push({ clip, reverse: false, once: true, speed: 1 }); // just woke: no second wake
      }
    }
    if (next) steps.push({ clip: next.loop, reverse: false, once: false, speed: 1 });
    this.steps = steps;
    this.stepStart = now;
  }

  /** The clip frame to show now, or null to show the code-drawn pet. */
  frame(now: number): ClipFrame | null {
    while (this.steps.length) {
      const step = this.steps[0];
      const info = this.clips[step.clip];
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
      } else {
        const cycle = Math.floor(i / info.frames);
        i %= info.frames;
        const b = info.blinks;
        if (b && i >= b.at && i < b.at + this.clips[b.normal].frames) {
          const roll = hash(cycle);
          if (roll < 0.55) return { clip: roll < 0.1 ? b.glitchy : b.normal, index: i - b.at };
        }
      }
      return { clip: step.clip, index: step.reverse ? info.frames - 1 - i : i };
    }
    return null;
  }
}
