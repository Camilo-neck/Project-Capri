import type { Emocion } from "../net/protocol.ts";

export type Sprite =
  | "meditar" | "recostada" | "dormir" | "sentada_a" | "sentada_b"
  | "confundida" | "enamorada" | "girando" | "cursor"
  | "asomada" | "malabar" | "laptop" | "pino";

// ponytail: the sheet has no sad or angry sprite; triste and molesta borrow the closest ones until there are.
export const EMOTION_SPRITES: Record<Emocion, Sprite[]> = {
  neutral: ["sentada_a"],
  pensativa: ["meditar"],
  feliz: ["malabar", "enamorada"],
  emocionada: ["pino"],
  sorprendida: ["confundida"],
  curiosa: ["asomada"],
  traviesa: ["cursor"],
  molesta: ["girando"],
  triste: ["recostada"],
  seria: ["laptop"],
};

export const LINGER_MS = 20_000; // keep the reply's sprite this long after she stops talking
export const SLEEP_MS = 180_000; // then idle activities, and sleep after this much silence
export const SLOT_MS = 30_000; // idle activity changes every slot
export const SWING_MS = 700; // leg swing while sitting

export interface PetInput {
  now: number;
  status: "down" | "idle" | "thinking" | "speaking";
  emocion: Emocion;
  variant: number; // picked once per utterance, so the sprite doesn't flicker between options
  lastTalk: number; // when the last utterance ended (or is still going: = now)
}

function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function pickSprite({ now, status, emocion, variant, lastTalk }: PetInput): Sprite {
  if (status === "thinking") return "laptop";
  const quiet = now - lastTalk;
  if (status === "speaking" || quiet < LINGER_MS) {
    const options = EMOTION_SPRITES[emocion];
    const s = options[variant % options.length];
    return s === "sentada_a" ? swing(now) : s;
  }
  if (quiet > SLEEP_MS || status === "down") return "dormir";
  // Idle: mostly sitting and swinging her legs, now and then meditating or lounging.
  const roll = hash(Math.floor(quiet / SLOT_MS) + Math.floor(lastTalk));
  if (roll < 0.6) return swing(now);
  return roll < 0.8 ? "meditar" : "recostada";
}

function swing(now: number): Sprite {
  return Math.floor(now / SWING_MS) % 2 ? "sentada_b" : "sentada_a";
}
