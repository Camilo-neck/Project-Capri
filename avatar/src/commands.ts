// Her commands, from the one list the backend also reads (backend/app/commands.json): what was typed, in any
// case, with or without accents, in Spanish or English, as her Spanish command. Same rules as commands.py.
import data from "../../backend/app/commands.json" with { type: "json" };

export interface Command {
  nombre: string;
  alias: string[];
  args: string;
  grupo: string;
  donde: "avatar" | "backend";
  descripcion: string;
  voz: { dice: string[]; hace: string }[];
  voz_ejemplos?: string[];
}

export const GROUPS: string[] = data.grupos;
export const COMMANDS = data.comandos as Command[];
const EVERYTHING = new Set(["todo", "everything", "all", "it all"]);

const fold = (w: string) => w.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
const NAMES = new Map(COMMANDS.flatMap((c) => [c.nombre, ...c.alias].map((w) => [fold(w), c.nombre] as const)));

/** "/Escóndete", "/hide on", "/forget everything" -> "/escondete", "/escondete on", "/olvida todo". */
export function canonical(text: string): string {
  const t = text.trim();
  const at = t.search(/\s/);
  const name = NAMES.get(fold(at < 0 ? t : t.slice(0, at)));
  if (!name) return text;
  let rest = at < 0 ? "" : t.slice(at).trim();
  if (name === "/olvida" && EVERYTHING.has(fold(rest))) rest = "todo";
  return `${name} ${rest}`.trim();
}

/** One of the avatar's own commands (it runs them, not the backend), or null. */
export function parse(text: string): { name: string; arg: string } | null {
  const c = canonical(text);
  const at = c.search(/\s/);
  const name = at < 0 ? c : c.slice(0, at);
  if (!COMMANDS.some((x) => x.nombre === name && x.donde === "avatar")) return null;
  const arg = at < 0 ? "" : c.slice(at).trim();
  return { name, arg: name === "/mira" ? arg : arg.toLowerCase() };
}
