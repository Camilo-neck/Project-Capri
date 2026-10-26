// Her lightning when she does something on the PC, like David's arcs when he jacks into her in the
// show: red sparks crawl over her while a tool runs and a bolt leaps from her to where it acts (the
// middle of the screen for what opens there, the tray corner for the music keys, the window in front
// for a script, whose frame the current runs around). The end: a quick spark, a victory for something
// long (or a script), a red impact if it failed. Tools that only read (calendar, files, clipboard)
// don't spark. Pure logic; render/fx.ts draws it.

export type BoltTarget = "center" | "tray" | "window";
export type Finale = "chispa" | "victoria" | "fallo";

export const LONG_MS = 4000; // a tool running this long earns a victory
export const AURA_MAX_MS = 15_000; // the sparks stop by then even if the end never comes

export interface Zap {
  bolt: BoltTarget | null;
  frame?: boolean; // the current runs around the target window's frame
}

const ZAPS: Record<string, Zap> = {
  abrir_app: { bolt: "center" },
  abrir_web: { bolt: "center" },
  buscar: { bolt: "center" },
  spotify: { bolt: "center" },
  conectar_spotify: { bolt: "center" },
  musica: { bolt: "tray" },
  ejecutar_script: { bolt: "window", frame: true },
  copiar_al_portapapeles: { bolt: null },
  configurar_calendario: { bolt: null },
};

/** What sparks when a tool starts; null for the ones that only read. */
export function zapStart(nombre: string): Zap | null {
  return ZAPS[nombre] ?? null;
}

/** How it ends; null for the ones that only read. */
export function zapEnd(nombre: string, ok: boolean | null, ms: number | null): Finale | null {
  if (!(nombre in ZAPS)) return null;
  if (!ok) return "fallo";
  return nombre === "ejecutar_script" || (ms ?? 0) >= LONG_MS ? "victoria" : "chispa";
}
