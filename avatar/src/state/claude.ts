import type { ClaudeEvent, Emocion, Gesto } from "../net/protocol.ts";

/** Claude mode: what the ticker says about the Claude Code session that moved last (the data is only displayed). */
export const THINK_MS = 15_000; // no news for this long while it works: "pensando…"
const FLASH_MS = { inicio: 4000, fallo: 6000, termino: 12_000, respuesta: 4000 };

export type Tone = "work" | "think" | "need" | "fail" | "done" | "info";
export interface Line {
  text: string;
  tone: Tone;
}

export class Tracker {
  private last: ClaudeEvent | null = null;
  private at = 0;

  push(e: ClaudeEvent, now: number): void {
    this.last = e.estado === "fin" ? null : e;
    this.at = now;
  }

  /** What the ticker shows now, or null for nothing. */
  line(now: number): Line | null {
    const e = this.last;
    if (!e) return null;
    const age = now - this.at;
    const who = `${e.project} › `;
    switch (e.estado) {
      case "trabajando":
        return age >= THINK_MS
          ? { text: `${who}pensando… ${Math.floor(age / 1000)} s`, tone: "think" }
          : { text: who + e.detalle, tone: "work" };
      case "necesita":
        return { text: `${who}te necesita: ${e.detalle}`, tone: "need" };
      case "inicio":
      case "fallo":
      case "termino":
      case "respuesta":
        if (age >= FLASH_MS[e.estado]) return null;
        const lines: Record<"inicio" | "fallo" | "termino" | "respuesta", Line> = {
          inicio: { text: who + e.detalle, tone: "info" },
          fallo: { text: `${who}falló: ${e.detalle}`, tone: "fail" },
          termino: { text: `${who}terminó · ${summary(e)}`, tone: "done" },
          respuesta: { text: `${who}respondió`, tone: "info" },
        };
        return lines[e.estado];
      default:
        return null;
    }
  }
}

/** "3 acciones · 2 archivos · 2 min 10 s" */
export function summary(e: ClaudeEvent): string {
  const t = e.segundos >= 60 ? `${Math.floor(e.segundos / 60)} min ${e.segundos % 60} s` : `${e.segundos} s`;
  const parts = [t, `${e.acciones} ${e.acciones === 1 ? "acción" : "acciones"}`];
  if (e.archivos) parts.push(`${e.archivos} ${e.archivos === 1 ? "archivo" : "archivos"}`);
  return parts.join(" · ");
}

/** How she reacts to an event, for when she is out and about (not hiding, not on do-not-disturb). */
export function reaction(e: ClaudeEvent): { emocion: Emocion; gesto: Gesto } | null {
  switch (e.estado) {
    case "termino":
      return { emocion: "feliz", gesto: "saltar" };
    case "fallo":
      return { emocion: "sorprendida", gesto: "ninguno" };
    case "necesita":
      return { emocion: "curiosa", gesto: "senalar" };
    default:
      return null;
  }
}

/** The panel's content for an event that carries Claude's words, or null. */
export function panelFor(e: ClaudeEvent): { title: string; body: string } | null {
  if (e.estado === "termino" && e.resumen) return { title: `${e.project} · ${summary(e)}`, body: e.resumen };
  if (e.estado === "respuesta" && e.resumen) return { title: `${e.project} · respuesta a Capri`, body: e.resumen };
  return null;
}
