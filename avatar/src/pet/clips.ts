// Frame-by-frame sprite clips (PixelLab art in avatar/assets/pet/anim) for the behaviors that have
// them. Behaviors without clips keep the code-drawn pet. Pure logic: which clip and frame to show.
import type { Behavior } from "./behaviors.ts";

export interface ClipInfo {
  frames: number;
  fps: number;
  pingpong?: boolean; // loops forth and back (for clips whose last frame doesn't lead into the first)
}

export const CLIPS: Record<string, ClipInfo> = {
  sentarse: { frames: 9, fps: 12 },
  sentada_idle: { frames: 7, fps: 7, pingpong: true },
};

/** Behaviors drawn with clips: `enter` plays once on arrival (and reversed on leaving), then `loop`. */
export const SPRITE_FOR: Partial<Record<Behavior, { enter?: string; loop: string }>> = {
  sentada: { enter: "sentarse", loop: "sentada_idle" },
};

/** Mouse reactions must answer at once, so leaving a clip for them skips the exit animation. */
const INSTANT: ReadonlySet<Behavior> = new Set(["pinchada", "acariciada"]);

interface Step {
  clip: string;
  reverse: boolean;
  once: boolean;
}

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
    const prev = this.behavior ? SPRITE_FOR[this.behavior] : undefined;
    const next = SPRITE_FOR[behavior];
    this.behavior = behavior;
    const steps: Step[] = [];
    if (prev && !next && prev.enter && !INSTANT.has(behavior)) steps.push({ clip: prev.enter, reverse: true, once: true });
    if (next) {
      if (!prev && next.enter) steps.push({ clip: next.enter, reverse: false, once: true });
      steps.push({ clip: next.loop, reverse: false, once: false });
    }
    this.steps = steps;
    this.stepStart = now;
  }

  /** The clip frame to show now, or null to show the code-drawn pet. */
  frame(now: number): ClipFrame | null {
    while (this.steps.length) {
      const step = this.steps[0];
      const info = CLIPS[step.clip];
      const t = now - this.stepStart;
      if (step.once && t >= clipDuration(info)) {
        this.steps.shift();
        this.stepStart += clipDuration(info);
        continue;
      }
      let i = Math.floor((t / 1000) * info.fps);
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
