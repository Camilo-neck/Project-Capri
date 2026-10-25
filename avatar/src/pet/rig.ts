// Skeleton of the pixel-art pet. Native resolution, y down. Angles in degrees:
// a limb angle of 0 points straight down, +90 to the viewer's right, -90 left, 180 up.

export const W = 80;
export const H = 96;
export const GROUND = 78; // feet line; the strip below is where her legs dangle when sitting on the edge

export const LEN = { torso: 14, neck: 3, head: 8, upperArm: 8, forearm: 8, thigh: 11, shin: 12, hip: 3, shoulder: 5 };

export type EyeKind =
  | "open" | "closed" | "happy" | "wink" | "heart" | "spiral" | "star" | "wide"
  | "angry" | "sad" | "focused" | "up" | "relaxed";
export type MouthKind =
  | "smile" | "grin" | "flat" | "frown" | "smirk" | "o" | "yawn" | "wavy" | "teeth" | "A" | "E" | "O" | "closed";

export type FxKind =
  | "shadow" | "laptop" | "zzz" | "hearts" | "question" | "exclaim" | "anger" | "tear"
  | "sparkles" | "dots" | "stars" | "keys";

export interface Fx {
  kind: FxKind;
  t: number; // effect-local time in ms, drives its own animation
  size?: number;
}

export interface Pose {
  x: number; // pelvis position
  y: number;
  torso: number; // lean, + = toward viewer's right
  head: number; // tilt relative to torso
  nod: number; // head drop in px (nodding)
  armL: [number, number]; // [shoulder, elbow bend]; viewer's left arm
  armR: [number, number];
  legL: [number, number]; // [hip, knee bend]
  legR: [number, number];
  thigh: number; // thigh length factor: < 1 when it points at the viewer (sitting)
  squash: number; // vertical scale around the feet, 1 = none
  hair: number; // hair bounce/puff, 0..1
  eyes: EyeKind;
  eyesR?: EyeKind; // right eye when it differs (wink)
  look: [number, number]; // pupil offset, -1..1 each
  mouth: MouthKind;
  blush: boolean;
  armsBehind: boolean; // draw arms behind the torso (hands behind back)
  fx: Fx[];
}

export const BASE: Pose = {
  x: W / 2,
  y: GROUND - 23,
  torso: 0,
  head: 0,
  nod: 0,
  armL: [-12, 6],
  armR: [12, -6],
  legL: [-5, 0],
  legR: [5, 0],
  thigh: 1,
  squash: 1,
  hair: 0,
  eyes: "open",
  look: [0, 0],
  mouth: "smile",
  blush: false,
  armsBehind: false,
  fx: [],
};

export type Pt = [number, number];

export const rad = (deg: number) => (deg * Math.PI) / 180;
/** Unit vector for a limb angle (0 = down). */
export const dir = (deg: number): Pt => [Math.sin(rad(deg)), Math.cos(rad(deg))];
const add = (p: Pt, v: Pt, k: number): Pt => [p[0] + v[0] * k, p[1] + v[1] * k];

export interface Joints {
  pelvis: Pt;
  neck: Pt;
  headCenter: Pt;
  headAngle: number; // absolute tilt of the head
  torsoAngle: number;
  shoulderL: Pt; elbowL: Pt; handL: Pt;
  shoulderR: Pt; elbowR: Pt; handR: Pt;
  hipL: Pt; kneeL: Pt; footL: Pt;
  hipR: Pt; kneeR: Pt; footR: Pt;
}

/** Forward kinematics: joint positions for a pose (before squash). */
export function solve(p: Pose): Joints {
  const pelvis: Pt = [p.x, p.y];
  const up = dir(180 - p.torso); // torso points up, leaning right for positive angles
  const side: Pt = [-up[1], up[0]]; // perpendicular, toward viewer's right when upright
  const neck = add(pelvis, up, LEN.torso);
  const headAngle = p.torso + p.head;
  const headCenter = add(add(neck, dir(180 - headAngle), LEN.neck + LEN.head - 2), [0, 1], p.nod);
  const shoulderBase = add(neck, up, -2);
  const shoulderL = add(shoulderBase, side, -LEN.shoulder);
  const shoulderR = add(shoulderBase, side, LEN.shoulder);
  const elbowL = add(shoulderL, dir(p.armL[0]), LEN.upperArm);
  const handL = add(elbowL, dir(p.armL[0] + p.armL[1]), LEN.forearm);
  const elbowR = add(shoulderR, dir(p.armR[0]), LEN.upperArm);
  const handR = add(elbowR, dir(p.armR[0] + p.armR[1]), LEN.forearm);
  const hipL = add(pelvis, side, -LEN.hip);
  const hipR = add(pelvis, side, LEN.hip);
  const kneeL = add(hipL, dir(p.legL[0]), LEN.thigh * p.thigh);
  const footL = add(kneeL, dir(p.legL[0] + p.legL[1]), LEN.shin);
  const kneeR = add(hipR, dir(p.legR[0]), LEN.thigh * p.thigh);
  const footR = add(kneeR, dir(p.legR[0] + p.legR[1]), LEN.shin);
  return {
    pelvis, neck, headCenter, headAngle, torsoAngle: p.torso,
    shoulderL, elbowL, handL, shoulderR, elbowR, handR,
    hipL, kneeL, footL, hipR, kneeR, footR,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp2 = (a: [number, number], b: [number, number], t: number): [number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

/** Blend two poses: numbers interpolate, discrete parts (face, effects) switch halfway. */
export function blend(a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const d = t < 0.5 ? a : b;
  return {
    ...d,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    torso: lerp(a.torso, b.torso, t),
    head: lerp(a.head, b.head, t),
    nod: lerp(a.nod, b.nod, t),
    armL: lerp2(a.armL, b.armL, t),
    armR: lerp2(a.armR, b.armR, t),
    legL: lerp2(a.legL, b.legL, t),
    legR: lerp2(a.legR, b.legR, t),
    thigh: lerp(a.thigh, b.thigh, t),
    squash: lerp(a.squash, b.squash, t),
    hair: lerp(a.hair, b.hair, t),
    look: lerp2(a.look, b.look, t),
  };
}

/** Smoothstep easing for transitions. */
export const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Two-bone inverse kinematics: [first angle, bend] so a limb rooted at `from` reaches `to`.
 * The middle joint (elbow/knee) goes to the side `out` (-1 = viewer's left, 1 = right).
 */
export function ik(from: Pt, to: Pt, l1: number, l2: number, out: -1 | 1): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const d = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(l1 - l2) + 0.01), l1 + l2 - 0.01);
  const base = (Math.atan2(dx, dy) * 180) / Math.PI;
  const alpha = (Math.acos((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)) * 180) / Math.PI;
  const beta = (Math.acos((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2)) * 180) / Math.PI;
  // Two solutions (elbow on either side); keep the one whose middle joint lies toward `out`.
  const options: [number, number][] = [[base + alpha, -(180 - beta)], [base - alpha, 180 - beta]];
  const midX = ([a]: [number, number]) => from[0] + Math.sin(rad(a)) * l1;
  options.sort((p, q) => (midX(q) - midX(p)) * out);
  return options[0];
}
