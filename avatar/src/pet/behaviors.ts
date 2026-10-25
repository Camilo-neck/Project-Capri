// What Capri does: each behavior turns local time (ms) into a Pose. The Director picks one
// from the app state and blends between them so changes never pop.
import type { Emocion, Gesto } from "../net/protocol.ts";
import type { Mouth } from "../state/text.ts";
import { BASE, blend, GROUND, ik, LEN, smooth, solve, W, type Fx, type Pose, type Pt } from "./rig.ts";

export type Behavior =
  | "sentada" | "meditar" | "estirarse" | "dormir" | "saludar"
  | "escribir"
  | "hablar" | "feliz" | "enamorada" | "emocionada" | "traviesa" | "curiosa"
  | "pensativa" | "sorprendida" | "molesta" | "triste" | "seria"
  | "pinchada" | "acariciada";

export interface Ctx {
  look: [number, number]; // gaze toward the mouse cursor, -1..1
  petSide: number; // -1 / 1: side the petting hand is on
}

const TAU = Math.PI * 2;
const wave = (t: number, period: number, phase = 0) => Math.sin((t / period) * TAU + phase);
const pulse = (t: number, period: number) => Math.max(0, wave(t, period)); // 0..1 half waves
const ease = (u: number) => Math.sin(Math.min(1, Math.max(0, u)) * Math.PI); // 0 -> 1 -> 0

const pose = (over: Partial<Pose>): Pose => ({ ...BASE, fx: [], ...over });

/** Points both hands at targets with inverse kinematics; elbows out unless told otherwise. */
function hands(p: Pose, left: Pt | null, right: Pt | null, outL: -1 | 1 = -1, outR: -1 | 1 = 1): Pose {
  const j = solve(p);
  if (left) p.armL = ik(j.shoulderL, left, LEN.upperArm, LEN.forearm, outL);
  if (right) p.armR = ik(j.shoulderR, right, LEN.upperArm, LEN.forearm, outR);
  return p;
}

/** Puts both feet at targets; knees out. */
function feet(p: Pose, left: Pt, right: Pt): Pose {
  const j = solve(p);
  p.legL = ik(j.hipL, left, LEN.thigh * p.thigh, LEN.shin, -1);
  p.legR = ik(j.hipR, right, LEN.thigh * p.thigh, LEN.shin, 1);
  return p;
}

const CX = W / 2;
const STAND_Y = GROUND - 23;

/** Sitting on the bottom edge of the screen, legs dangling below it. */
function sitEdge(t: number, swing = 1): Pose {
  const s = wave(t, 1600) * 14 * swing;
  const p = pose({ y: GROUND - 1, thigh: 0.45, legL: [-25, 25 + s], legR: [25, -25 + s * -1], mouth: "smile" });
  p.y -= pulse(t, 2600) > 0.7 ? 1 : 0; // breathing
  return hands(p, [CX - 10, GROUND + 1], [CX + 10, GROUND + 1]);
}

/** Cross-legged, `lift` px above the ground (meditation floats): thighs open, shins folded to the middle. */
function crossLegged(lift: number): Pose {
  return pose({ y: GROUND - 7 - lift, legL: [-75, 145], legR: [75, -145] });
}

function standing(t: number, sway = 1): Pose {
  const p = pose({ y: STAND_Y, torso: wave(t, 2400) * 2 * sway, head: wave(t, 3100) * 3 * sway });
  p.y -= pulse(t, 2600) > 0.7 ? 1 : 0;
  return p;
}

const fx = (kind: Fx["kind"], t: number, size?: number): Fx => ({ kind, t, size });

export interface BehaviorDef {
  pose: (t: number, c: Ctx) => Pose;
  /** One-shot behaviors end after this many ms; loops have none. */
  duration?: number;
  /** Lets the text drive the mouth while she is talking. */
  talks: boolean;
  title: string;
  trigger: string;
}

export const BEHAVIORS: Record<Behavior, BehaviorDef> = {
  sentada: {
    title: "Sentada en el borde",
    trigger: "Reposo por defecto",
    talks: true,
    pose: (t, c) => ({ ...sitEdge(t), head: wave(t, 5200) * 4, look: c.look }),
  },
  meditar: {
    title: "Meditando, flotando",
    trigger: "Actividad de reposo (20 %)",
    talks: false,
    pose: (t) => {
      const lift = 7 + wave(t, 2400) * 2;
      const p = crossLegged(lift);
      const j = solve(p);
      Object.assign(p, { eyes: "relaxed", mouth: "smile", hair: 0.5 + wave(t, 2400) * 0.3 });
      hands(p, j.kneeL, j.kneeR);
      p.fx = [fx("shadow", t, 1 - lift / 30)];
      return p;
    },
  },
  estirarse: {
    title: "Estirándose y bostezando",
    trigger: "Actividad de reposo (15 %), 2,6 s",
    duration: 2600,
    talks: false,
    pose: (t) => {
      const e = ease(t / 2600);
      const p = sitEdge(t, 0.3);
      const j = solve(p);
      const mix = (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
      // hands travel from the ledge to above the head
      hands(p, mix(j.handL, [j.shoulderL[0] - 4, j.shoulderL[1] - 15]), mix(j.handR, [j.shoulderR[0] + 4, j.shoulderR[1] - 15]));
      p.squash = 1 + e * 0.05;
      p.eyes = e > 0.3 ? "closed" : "open";
      p.mouth = e > 0.4 ? "yawn" : "smile";
      p.head = -e * 6;
      return p;
    },
  },
  dormir: {
    title: "Dormida",
    trigger: "3 min sin hablar, o sin conexión",
    talks: false,
    pose: (t) => {
      const p = crossLegged(0);
      const b = wave(t, 3400);
      Object.assign(p, { torso: 6, head: 20, nod: 2, eyes: "closed", mouth: b > 0.2 ? "o" : "closed", squash: 1 + b * 0.02 });
      hands(p, [CX - 2, GROUND - 4], [CX + 3, GROUND - 4]);
      p.fx = [fx("zzz", t)];
      return p;
    },
  },
  saludar: {
    title: "Saludando",
    trigger: "Al conectar con el backend, 1,8 s",
    duration: 1800,
    talks: false,
    pose: (t) => {
      const p = standing(t);
      const j = solve(p);
      hands(p, [CX - 8, STAND_Y - 2], [j.headCenter[0] + 13 + wave(t, 360) * 3, j.headCenter[1] - 6]);
      Object.assign(p, { eyes: "happy", mouth: "grin", head: -4 });
      return p;
    },
  },
  escribir: {
    title: "Escribiendo en el portátil",
    trigger: "Mientras piensa la respuesta",
    talks: false,
    pose: (t) => {
      const p = sitEdge(t, 0.4);
      const tapL = Math.floor(t / 110) % 2;
      const tapR = 1 - tapL;
      const glance = t % 4200 > 3400; // stops now and then to think
      hands(p, [CX - 3 - tapL, GROUND - 4 - tapL], [CX + 3 + tapR, GROUND - 4 - tapR]);
      Object.assign(p, {
        head: glance ? -6 : 3,
        nod: glance ? 0 : 1,
        eyes: glance ? "up" : "focused",
        mouth: glance ? "o" : "flat",
        fx: glance ? [fx("laptop", t), fx("dots", t)] : [fx("laptop", t), fx("keys", t)],
      });
      return p;
    },
  },
  hablar: {
    title: "Hablando",
    trigger: "Emoción neutral",
    talks: true,
    pose: (t, c) => {
      const p = standing(t);
      const g = pulse(t, 1300);
      const j = solve(p);
      hands(p, [CX - 7, STAND_Y + 6], [j.shoulderR[0] + 7 + g * 3, j.shoulderR[1] + 6 - g * 8]);
      return { ...p, look: c.look };
    },
  },
  feliz: {
    title: "Contenta, dando saltitos",
    trigger: "Emoción feliz",
    talks: true,
    pose: (t) => {
      const hop = Math.abs(Math.sin((t / 450) * Math.PI));
      const p = standing(t, 0.5);
      p.y -= hop * 3;
      p.squash = hop < 0.15 ? 0.94 : 1;
      p.armL = [-25 - hop * 20, 25];
      p.armR = [25 + hop * 20, -25];
      Object.assign(p, { eyes: "happy", mouth: "grin", hair: hop * 0.5 });
      if (t % 2400 < 900) p.fx = [fx("sparkles", t)];
      return p;
    },
  },
  enamorada: {
    title: "Encantada, manos en las mejillas",
    trigger: "Emoción feliz (variante)",
    talks: true,
    pose: (t) => {
      const p = standing(t, 0);
      p.torso = wave(t, 1600) * 5;
      p.head = wave(t, 1600) * 6;
      const j = solve(p);
      hands(p, [j.headCenter[0] - 8, j.headCenter[1] + 5], [j.headCenter[0] + 8, j.headCenter[1] + 5]);
      Object.assign(p, { eyes: "heart", mouth: "smile", blush: true, fx: [fx("hearts", t)] });
      return p;
    },
  },
  emocionada: {
    title: "Emocionada, saltando",
    trigger: "Emoción emocionada",
    talks: true,
    pose: (t) => {
      const ph = (t % 750) / 750;
      const air = ph < 0.6 ? Math.sin((ph / 0.6) * Math.PI) : 0;
      const p = standing(t, 0);
      p.y -= air * 12;
      p.squash = ph >= 0.6 && ph < 0.75 ? 0.88 : 1 + air * 0.04;
      p.armL = [-150 + wave(t, 300) * 10, 10];
      p.armR = [150 - wave(t, 300) * 10, -10];
      p.legL = [-8 - air * 10, air * 30];
      p.legR = [8 + air * 10, -air * 30];
      Object.assign(p, { eyes: "star", mouth: "A", hair: 0.6 + air * 0.4, fx: [fx("sparkles", t), fx("shadow", t, 1 - air * 0.4)] });
      return p;
    },
  },
  traviesa: {
    title: "Traviesa, riéndose por lo bajo",
    trigger: "Emoción traviesa",
    talks: true,
    pose: (t) => {
      const p = standing(t, 0.5);
      p.torso = -5;
      p.y += Math.floor(t / 140) % 2 ? 0 : -0.6; // shoulders shaking with laughter
      const j = solve(p);
      hands(p, [j.pelvis[0] - 8, j.pelvis[1] - 3], [j.headCenter[0] + 2, j.headCenter[1] + 7], -1, 1);
      Object.assign(p, { eyes: "open", eyesR: "wink", mouth: "smirk", head: -6 });
      return p;
    },
  },
  curiosa: {
    title: "Curiosa, ladeando la cabeza",
    trigger: "Emoción curiosa",
    talks: true,
    pose: (t, c) => {
      const p = standing(t, 0.3);
      p.y += 2; // knees bent a bit, leaning in
      feet(p, [CX - 5, GROUND], [CX + 5, GROUND]);
      p.head = 10 + wave(t, 1800) * 6;
      const j = solve(p);
      hands(p, [j.headCenter[0] - 3, j.headCenter[1] + 9], [CX + 8, STAND_Y + 6], -1, 1);
      Object.assign(p, { eyes: "wide", mouth: "o", look: c.look, fx: [fx("question", t)] });
      return p;
    },
  },
  pensativa: {
    title: "Pensativa, mano en la barbilla",
    trigger: "Emoción pensativa",
    talks: true,
    pose: (t) => {
      const p = standing(t, 0.6);
      p.head = -8;
      const j = solve(p);
      hands(p, [j.pelvis[0] + 4, j.pelvis[1] - 7], [j.headCenter[0] + 3, j.headCenter[1] + 9], -1, 1);
      Object.assign(p, { eyes: "up", mouth: "flat", fx: [fx("dots", t)] });
      return p;
    },
  },
  sorprendida: {
    title: "Sorprendida",
    trigger: "Emoción sorprendida",
    talks: true,
    pose: (t) => {
      const p = standing(t, 0);
      const jump = t < 380 ? Math.sin((t / 380) * Math.PI) : 0;
      p.y -= jump * 6;
      p.x += t < 380 ? -jump * 2 : (Math.floor(t / 50) % 2) * 0.6; // hop back, then tremble
      p.squash = t > 380 && t < 480 ? 0.9 : 1;
      const j = solve(p);
      hands(p, [j.shoulderL[0] - 4, j.shoulderL[1] - 5], [j.shoulderR[0] + 4, j.shoulderR[1] - 5]);
      Object.assign(p, { eyes: "wide", mouth: "O", hair: Math.max(0, 1 - t / 1500), fx: [fx("exclaim", t)] });
      return p;
    },
  },
  molesta: {
    title: "Molesta, brazos cruzados",
    trigger: "Emoción molesta",
    talks: true,
    pose: (t) => {
      const p = standing(t, 0.3);
      const tap = pulse(t, 520);
      p.legR = [10 + tap * 12, -tap * 18]; // foot tapping
      p.head = -7;
      const j = solve(p);
      hands(p, [j.pelvis[0] + 5, j.pelvis[1] - 9], [j.pelvis[0] - 5, j.pelvis[1] - 8]);
      Object.assign(p, { eyes: "angry", mouth: "teeth", fx: [fx("anger", t)] });
      return p;
    },
  },
  triste: {
    title: "Triste, abrazando las rodillas",
    trigger: "Emoción triste",
    talks: true,
    pose: (t) => {
      // knees pulled up in front of her (thighs point up, foreshortened), shins back down
      const p = pose({ y: GROUND - 2, thigh: 0.6, torso: wave(t, 3000) * 2, head: 6, nod: 1, legL: [-160, 165], legR: [160, -165] });
      const j = solve(p);
      hands(p, [j.kneeL[0] + 3, j.kneeL[1] + 1], [j.kneeR[0] - 3, j.kneeR[1] + 1]);
      Object.assign(p, { eyes: "sad", mouth: "frown", fx: [fx("tear", t)] });
      return p;
    },
  },
  seria: {
    title: "Seria, manos a la espalda",
    trigger: "Emoción seria",
    talks: true,
    pose: (t) => {
      const p = standing(t, 0.2);
      p.armsBehind = true;
      const j = solve(p);
      hands(p, [j.pelvis[0] + 2, j.pelvis[1] - 4], [j.pelvis[0] - 2, j.pelvis[1] - 4]);
      Object.assign(p, { eyes: "open", mouth: "flat", nod: t % 3200 < 300 ? 1 : 0 });
      return p;
    },
  },
  pinchada: {
    title: "Pinchada (clic)",
    trigger: "Clic sobre ella, 1,3 s",
    duration: 1300,
    talks: false,
    pose: (t) => {
      const p = sitEdge(t, 0);
      const decay = Math.exp(-t / 450);
      p.squash = t < 140 ? 0.8 : 1 + Math.sin(t / 45) * 0.04 * decay;
      p.torso = Math.sin(t / 70) * 10 * decay;
      p.head = -Math.sin(t / 70) * 12 * decay;
      const j = solve(p);
      hands(p, [j.shoulderL[0] - 7, j.shoulderL[1] - 2 + Math.sin(t / 60) * 3], [j.shoulderR[0] + 7, j.shoulderR[1] - 2 - Math.sin(t / 60) * 3]);
      Object.assign(p, { eyes: "spiral", mouth: "wavy", hair: decay, fx: [fx("stars", t)] });
      return p;
    },
  },
  acariciada: {
    title: "Acariciada (pasar el ratón por la cabeza)",
    trigger: "Mover el ratón sobre su cabeza",
    talks: false,
    pose: (t, c) => {
      const p = sitEdge(t, 0.5);
      p.head = 12 * (c.petSide || 1) + wave(t, 900) * 3;
      p.torso = 3 * (c.petSide || 1);
      Object.assign(p, { eyes: "happy", mouth: "smile", blush: true, fx: t % 1800 < 1200 ? [fx("hearts", t)] : [] });
      return p;
    },
  },
};

export const EMOTION_BEHAVIOR: Record<Emocion, Behavior[]> = {
  neutral: ["hablar"],
  feliz: ["feliz", "enamorada"],
  emocionada: ["emocionada"],
  traviesa: ["traviesa"],
  curiosa: ["curiosa"],
  pensativa: ["pensativa"],
  sorprendida: ["sorprendida"],
  molesta: ["molesta"],
  triste: ["triste"],
  seria: ["seria"],
};

export const TRANSITION_MS = 320;
export const LINGER_MS = 15_000; // keep the reply's behavior after she stops talking
export const SLEEP_MS = 180_000;
export const SLOT_MS = 25_000; // idle activity slots
export const POKE_MS = BEHAVIORS.pinchada.duration!;
export const PET_MS = 900; // petting lasts this long after the last stroke

export interface DirectorInput {
  now: number;
  status: "down" | "idle" | "thinking" | "speaking";
  emocion: Emocion;
  variant: number;
  lastTalk: number; // = now while talking
  pokeAt: number; // -Infinity when never
  petAt: number;
  greetAt: number; // when the link came up
}

function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Which behavior the inputs call for, and since when (for one-shots and idle slots). */
export function choose(i: DirectorInput): { name: Behavior; since?: number } {
  if (i.now - i.pokeAt < POKE_MS) return { name: "pinchada", since: i.pokeAt };
  if (i.now - i.petAt < PET_MS) return { name: "acariciada" };
  if (i.status === "thinking") return { name: "escribir" };
  const quiet = i.now - i.lastTalk;
  if (i.status === "speaking" || quiet < LINGER_MS) {
    const options = EMOTION_BEHAVIOR[i.emocion];
    return { name: options[i.variant % options.length] };
  }
  if (i.status === "down" || quiet > SLEEP_MS) return { name: "dormir" };
  if (i.now - i.greetAt < BEHAVIORS.saludar.duration!) return { name: "saludar", since: i.greetAt };
  // Idle: mostly sitting; some slots meditate or stretch (stretching is short, then she sits again).
  const slot = Math.floor(quiet / SLOT_MS);
  const slotStart = i.lastTalk + slot * SLOT_MS;
  const roll = hash(slot + Math.floor(i.lastTalk));
  if (roll < 0.2) return { name: "meditar", since: slotStart };
  if (roll < 0.35 && i.now - slotStart < BEHAVIORS.estirarse.duration!) return { name: "estirarse", since: slotStart };
  return { name: "sentada" };
}

export interface Overlay {
  gesto: Gesto;
  gestureT: number; // 0..1
  mouth: Mouth | null; // from the text being typed; null = not talking
  blinking: boolean;
}

/** Short gestures and talking/blinking on top of any behavior. */
export function overlay(p: Pose, def: BehaviorDef, o: Overlay): Pose {
  const u = o.gestureT;
  const e = ease(u);
  switch (o.gesto) {
    case "asentir":
      p.nod += Math.max(0, Math.sin(u * Math.PI * 4)) * 2;
      break;
    case "ladear_cabeza":
      p.head += e * 14;
      break;
    case "guino":
      p.eyesR = "wink";
      break;
    case "saltar":
      p.y -= e * 10;
      p.squash = u < 0.1 || u > 0.9 ? 0.92 : p.squash;
      break;
    case "senalar": {
      const j = solve(p);
      p.armR = ik(j.shoulderR, [j.shoulderR[0] + 16 * e + 0.1, j.shoulderR[1] - 6 * e + 4], LEN.upperArm, LEN.forearm, 1);
      break;
    }
    case "cruzar_brazos": {
      const j = solve(p);
      if (e > 0.2) hands(p, [j.pelvis[0] + 5, j.pelvis[1] - 9], [j.pelvis[0] - 5, j.pelvis[1] - 8]);
      break;
    }
  }
  if (def.talks && o.mouth) p.mouth = o.mouth === "closed" ? "closed" : o.mouth;
  const blinkable = p.eyes === "open" || p.eyes === "wide" || p.eyes === "focused" || p.eyes === "up";
  if (o.blinking && blinkable) {
    p.eyes = "closed";
    if (p.eyesR !== "wink") p.eyesR = undefined;
  }
  return p;
}

/** Keeps track of the current behavior and blends into the next one. */
export class Director {
  current: Behavior = "sentada";
  private since = 0;
  private from: Pose | null = null;
  private fromAt = 0;
  last: Pose = BASE;

  frame(i: DirectorInput, c: Ctx, o: Overlay): { name: Behavior; pose: Pose } {
    const { name, since } = choose(i);
    if (name !== this.current) {
      this.from = this.last;
      this.fromAt = i.now;
      this.current = name;
      this.since = since ?? i.now;
    } else if (since !== undefined) {
      this.since = since;
    }
    const def = BEHAVIORS[name];
    let p = overlay(def.pose(i.now - this.since, c), def, o);
    if (this.from) {
      const k = (i.now - this.fromAt) / TRANSITION_MS;
      if (k >= 1) this.from = null;
      else p = blend(this.from, p, smooth(k));
    }
    this.last = p;
    return { name, pose: p };
  }
}
