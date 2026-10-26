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

/** "4 acciones · 2 archivos modificados · 2 min 10 s" */
export function summary(e: ClaudeEvent): string {
  const t = e.segundos >= 60 ? `${Math.floor(e.segundos / 60)} min ${e.segundos % 60} s` : `${e.segundos} s`;
  const parts = [`${e.acciones} ${e.acciones === 1 ? "acción" : "acciones"}`];
  if (e.archivos) parts.push(`${e.archivos} ${e.archivos === 1 ? "archivo modificado" : "archivos modificados"}`);
  return [...parts, t].join(" · ");
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

export type Face = "grin" | "look";
export interface Panel {
  project: string;
  badge: string; // the tag in the corner
  title: string; // her line
  body: string; // Claude's words
  stats: string; // termino: actions, files and time
  face: Face;
  tone: "done" | "answer";
}

const DONE_LINES = ["Misión cumplida, choom.", "Listo. Claude ya acabó.", "Terminado, y sin romper nada… creo.", "Trabajo hecho. ¿Lo miras?"];

/** The bubble for an end (always) or an answer to `/claude` with words, or null. */
export function panelFor(e: ClaudeEvent, pick = Math.random): Panel | null {
  if (e.estado === "termino") {
    const title = DONE_LINES[Math.floor(pick() * DONE_LINES.length)];
    return { project: e.project, badge: "TERMINADO", title, body: e.resumen, stats: summary(e), face: "grin", tone: "done" };
  }
  if (e.estado === "respuesta" && e.resumen) {
    return { project: e.project, badge: "RESPUESTA", title: "Esto me dijo Claude:", body: e.resumen, stats: "", face: "look", tone: "answer" };
  }
  return null;
}
