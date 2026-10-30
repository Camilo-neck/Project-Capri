// Her quick menu's lists (right click on her): the voices and the brains it can switch to right now. Downloading
// voices or models and pasting keys stay in the full panel. Pure: quick.ts draws them.
import type { ModelInfo, VoiceInfo } from "./net/protocol.ts";

const LOCAL: Record<string, string> = { ollama: "Local", claude_code: "Mi Claude" };

/** How a provider is shown: its short local name, or the one the backend gives the cloud ones. */
export const providerName = (info: ModelInfo, p: string): string => LOCAL[p] ?? info.nombres[p] ?? p;

export interface VoiceItem {
  id: string;
  label: string;
  gpu: boolean;
  on: boolean;
}

export interface BrainItem {
  proveedor: string;
  nombre: string;
  grupo: string;
  on: boolean;
}

/** The voices downloaded and runnable on this PC, hers marked. */
export function voiceItems(info: VoiceInfo): VoiceItem[] {
  return info.voces.filter((v) => v.descargada && v.disponible).map((v) => ({ id: v.id, label: v.nombre, gpu: v.gpu, on: v.id === info.voz }));
}

/** Every model of every provider it can use (the cloud ones only with their key), the one in use marked. */
export function brainItems(info: ModelInfo): BrainItem[] {
  return Object.keys(info.opciones)
    .filter((p) => !(p in info.claves) || info.claves[p])
    .flatMap((p) => info.opciones[p].map((nombre) => ({
      proveedor: p, nombre, grupo: providerName(info, p), on: info.proveedor === p && info.nombre === nombre,
    })));
}

/** The item an arrow key goes to, round the list (-1: nothing focused yet). */
export function step(i: number, delta: number, n: number): number {
  if (i < 0) return delta > 0 ? 0 : n - 1;
  return (i + delta + n) % n;
}
