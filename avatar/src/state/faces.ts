// Her faces from the show (the camera-mode shots, assets/camera): a portrait by what she says that
// follows how she feels, and anime cut-ins for the big moments. Pure logic; render/portrait.ts and
// Fx.cutin draw them.
import type { Emocion, Gesto } from "../net/protocol.ts";
import { EMOTION_SHOT, type ShotName } from "./camera.ts";

export const CUTIN_GAP_MS = 90_000; // at most one this often
export const SWAP_MS = 180; // a new face comes in through this much glitch

// the drawing of each shot that reads best small (some open on a blur or a half turn)
const BEST: Partial<Record<ShotName, number>> = { gira: 8, risa: 1, sonrisa: 1, muchos: 3, mira: 3, ojos: 1, lado: 2, piensa: 4, escucha: 6 };
// where her face is in the wide ones (shot px, 360x240): its middle and a square around it
const FACE: Partial<Record<ShotName, { x: number; y: number; side: number }>> = {
  sonrisa: { x: 180, y: 70, side: 110 }, // her small face high in the frame
  piensa: { x: 135, y: 90, side: 150 }, // looking down, at the left
  escucha: { x: 180, y: 100, side: 150 },
};

export function portraitFor(e: Emocion): { shot: ShotName; index: number } {
  const shot = EMOTION_SHOT[e];
  return { shot, index: BEST[shot] ?? 0 };
}

type Region = { sx: number; sy: number; sw: number; sh: number };

/** The square of a shot's drawing (`r`: where that drawing is in its strip) that frames her face. */
export function faceSquare<T extends Region>(r: T, shot: ShotName): T {
  const f = FACE[shot] ?? { x: r.sw / 2, y: r.sh / 2, side: Math.min(r.sw, r.sh) };
  const half = f.side / 2;
  const x = Math.min(Math.max(f.x - half, 0), r.sw - f.side), y = Math.min(Math.max(f.y - half, 0), r.sh - f.side);
  return { ...r, sx: r.sx + x, sy: r.sy + y, sw: f.side, sh: f.side };
}

/** The cut-in this reply earns, or null: her laugh when she's thrilled or jumps, her big eyes when
 * surprised, the zigzag grin with a wink, all her eyes when annoyed. Half the time, once every
 * CUTIN_GAP_MS at most, never when she must keep quiet (hidden, do-not-disturb, camera, fullscreen). */
export function cutinFor(e: Emocion, g: Gesto, now: number, lastAt: number, quiet: boolean,
                         rand: () => number = Math.random): ShotName | null {
  if (quiet || now - lastAt < CUTIN_GAP_MS) return null;
  const shot: ShotName | null = e === "emocionada" || g === "saltar" ? "risa"
    : e === "sorprendida" ? "ojos"
    : e === "traviesa" && g === "guino" ? "sonrisa"
    : e === "molesta" ? "muchos"
    : null;
  return shot && rand() < 0.5 ? shot : null;
}

/** How torn her portrait is `ms` after a new face: the old one ripped at first, then the new one with
 * its colours apart, settling. */
export function swapGlitch(ms: number): { split: number; bands: number; old: boolean } {
  if (ms >= SWAP_MS) return { split: 0, bands: 0, old: false };
  const t = 1 - ms / SWAP_MS;
  return { split: Math.round(1 + 7 * t), bands: Math.max(1, Math.round(4 * t)), old: ms < SWAP_MS / 4 };
}
