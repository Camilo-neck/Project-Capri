// Camera mode: instead of her whole body, a transmission feed of her close-ups from the show
// (avatar/assets/camera, scripts/build_camera.py). Which shot fits the moment, its tag, and how
// shots play and cut. Pure logic; render/camera.ts draws it.
import type { Emocion, VoiceState } from "../net/protocol.ts";

export type ShotName = "escucha" | "lado" | "piensa" | "gira" | "mira" | "muchos" | "ojos" | "risa" | "sonrisa";

export interface Shot {
  frames: number;
  fps: number;
  /** One-shot lead-in: plays once, then this shot. */
  then?: ShotName;
}

export const SHOTS: Record<ShotName, Shot> = {
  escucha: { frames: 20, fps: 12 }, // wide, her small face among the mane and its sparkles
  lado: { frames: 5, fps: 8 }, // turned away, the fang
  piensa: { frames: 25, fps: 10 }, // looking down and aside
  gira: { frames: 9, fps: 24, then: "mira" }, // turning to the camera
  mira: { frames: 6, fps: 12 }, // close, looking right at you
  muchos: { frames: 7, fps: 12 }, // her face covered in eyes
  ojos: { frames: 2, fps: 6 }, // the big eyes
  risa: { frames: 3, fps: 12 }, // mouth wide open
  sonrisa: { frames: 9, fps: 12 }, // wide again, the jagged grin
};

export const EMOTION_SHOT: Record<Emocion, ShotName> = {
  neutral: "mira",
  feliz: "risa",
  emocionada: "risa",
  traviesa: "sonrisa",
  curiosa: "gira",
  pensativa: "lado",
  sorprendida: "ojos",
  molesta: "muchos",
  triste: "lado",
  seria: "piensa",
};

export interface Scene {
  status: "down" | "idle" | "looking" | "thinking" | "speaking";
  emocion: Emocion;
  talking: boolean; // speaking, or just done and still in the reply's mood
  listening: boolean; // the input bar is open
  confirming: boolean; // an action waits on your click
  asleep: boolean;
  voice: VoiceState; // the microphone
}

/** The shot for the moment; null = no signal (the backend is down) or her mask (asleep). */
export function shotFor(s: Scene): ShotName | null {
  if (s.status === "down" || s.asleep) return null;
  if (s.confirming) return "muchos";
  if (s.status === "looking") return "ojos";
  if (s.status === "thinking") return "piensa";
  if (s.status === "speaking" || s.talking) return EMOTION_SHOT[s.emocion];
  return "escucha";
}

/** The tag over the feed: CAPRI // <this>. */
export function tagFor(s: Scene): string {
  if (s.status === "down") return "SIN SEÑAL";
  if (s.asleep) return "EN REPOSO";
  if (s.confirming) return "ESPERA TU OK";
  if (s.status === "looking") return "ESCANEANDO";
  if (s.status === "thinking") return "PROCESANDO";
  if (s.status === "speaking") return "TRANSMITIENDO";
  if (s.voice === "hearing") return "OYÉNDOTE";
  if (s.voice === "listening") return "TE ESCUCHO";
  return s.listening || s.voice !== "off" ? "ESCUCHANDO" : "EN LÍNEA";
}

export const PUSH_MS = 9000; // the slow push-in on each shot
export const PUSH = 0.07; // how far it goes

export interface CameraFrame {
  shot: ShotName;
  index: number;
  zoom: number; // 1 .. 1 + PUSH
}

export class CameraPlayer {
  private wanted: ShotName | null = null;
  private shot: ShotName | null = null;
  private since = 0;

  /** Points the camera at `target`; true when that's a cut (the feed glitches on cuts). */
  want(target: ShotName | null, now: number): boolean {
    if (target === this.wanted) return false;
    const cut = this.wanted !== null || target !== null;
    this.wanted = target;
    this.shot = target;
    this.since = now;
    return cut;
  }

  frame(now: number): CameraFrame | null {
    if (!this.shot) return null;
    let info: Shot = SHOTS[this.shot];
    let t = now - this.since;
    const lead = (info.frames / info.fps) * 1000;
    if (info.then && t >= lead) {
      // the lead-in is over: its shot takes over without a cut, the push-in carries on
      this.shot = info.then;
      this.since += lead;
      info = SHOTS[this.shot];
      t = now - this.since;
    }
    const i = Math.floor((t / 1000) * info.fps);
    let index: number;
    if (info.then) index = Math.min(i, info.frames - 1);
    else if (info.frames < 2) index = 0;
    else {
      const period = 2 * (info.frames - 1); // forth and back: the show's frames don't loop
      index = i % period;
      if (index >= info.frames) index = period - index;
    }
    const k = Math.min(1, t / PUSH_MS);
    return { shot: this.shot, index, zoom: 1 + PUSH * k * (2 - k) };
  }
}
