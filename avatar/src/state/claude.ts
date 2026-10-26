import type { ClaudeEvent, Emocion, Gesto } from "../net/protocol.ts";
import type { Zap } from "./zap.ts";

/** Claude mode: what the ticker says about the Claude Code session that moved last (the data is only displayed). */
export const THINK_MS = 15_000; // no news for this long while it works: "pensando…"
const FLASH_MS = { inicio: 4000, fallo: 6000, termino: 12_000, respuesta: 4000 };

export type Tone = "work" | "think" | "need" | "fail" | "done" | "info";
/** The ticker: "▪ EDITANDO main.ts · capri" */
export interface Line {
  verb: string;
  target: string;
  project: string;
  tone: Tone;
}

/** "Editando main.ts" → ["Editando", "main.ts"]; "Ejecutando: npm test" → ["Ejecutando", "npm test"]; a prompt is a "tarea". */
export function split(detalle: string): [string, string] {
  if (detalle.startsWith("«")) return ["tarea", detalle];
  const m = detalle.match(/^(\S+?):?\s+(.*)$/);
  return m ? [m[1], m[2]] : [detalle, ""];
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
    const line = (verb: string, target: string, tone: Tone): Line => ({ verb, target, project: e.project, tone });
    switch (e.estado) {
      case "trabajando":
        return age >= THINK_MS ? line("pensando", `${Math.floor(age / 1000)} s`, "think") : line(...split(e.detalle), "work");
      case "necesita":
        return line("te necesita", e.detalle, "need");
      case "inicio":
      case "fallo":
      case "termino":
      case "respuesta":
        if (age >= FLASH_MS[e.estado]) return null;
        if (e.estado === "inicio") return line("sesión nueva", "", "info");
        if (e.estado === "fallo") return line("falló", e.detalle, "fail");
        if (e.estado === "termino") return line("terminó", summary(e), "done");
        return line("respondió", "", "info");
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
    case "trabajando":
      return e.herramienta ? null : { emocion: "pensativa", gesto: "asentir" }; // got the prompt
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

// Her lightning for what Claude does (render as in state/zap.ts): a command runs into the window in front,
// the web goes to the middle of the screen, an edit is a spark on her. Reading doesn't spark.
const SPARKS: Record<string, Zap> = {
  Bash: { bolt: "window", frame: true },
  PowerShell: { bolt: "window", frame: true },
  WebFetch: { bolt: "center" },
  WebSearch: { bolt: "center" },
  Edit: { bolt: null },
  MultiEdit: { bolt: null },
  Write: { bolt: null },
  NotebookEdit: { bolt: null },
};
export const SPARK_GAP_MS = 1500; // a burst of tool calls is one spark, not a strobe

export function sparkFor(e: ClaudeEvent): Zap | null {
  return e.estado === "trabajando" ? SPARKS[e.herramienta] ?? null : null;
}

/** A long job earns her victory sequence when it ends. */
export function bigJob(e: ClaudeEvent): boolean {
  return e.estado === "termino" && (e.segundos >= 120 || e.acciones >= 20);
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
