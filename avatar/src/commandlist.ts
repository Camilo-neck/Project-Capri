// The panel's command list: every command (commands.json), what to say to her, the shortcuts in use and her
// routines, as rows to show and search. Pure: settings.ts draws them.
import { COMMANDS } from "./commands.ts";
import type { RoutineInfo } from "./net/protocol.ts";

export const SECTIONS = ["Escritos", "Por voz", "Atajos", "Rutinas"];

export interface Entry {
  seccion: string;
  titulo: string; // a command, a shortcut's keys, a routine's phrase
  alias: string[];
  detalle: string;
  copiar: string; // what the copy button copies ("" = nothing to copy)
}

const quote = (xs: string[]) => xs.map((x) => `«${x}»`).join(", ");

export function entries(routines: RoutineInfo[], shortcuts: [string, string][]): Entry[] {
  return [
    ...COMMANDS.map((c) => ({
      seccion: "Escritos", titulo: `${c.nombre} ${c.args}`.trim(), alias: c.alias, detalle: c.descripcion, copiar: c.nombre,
    })),
    ...COMMANDS.flatMap((c) => [
      ...c.voz.map((v) => ({ seccion: "Por voz", titulo: v.hace, alias: [], detalle: quote(v.dice), copiar: "" })),
      ...(c.voz_ejemplos?.length
        ? [{ seccion: "Por voz", titulo: `${c.nombre} …`, alias: [], detalle: quote(c.voz_ejemplos), copiar: "" }]
        : []),
    ]),
    ...shortcuts.map(([what, keys]) => ({ seccion: "Atajos", titulo: keys, alias: [], detalle: what, copiar: "" })),
    ...routines.map((r) => ({
      seccion: "Rutinas", titulo: r.frases[0] ?? r.nombre, alias: r.frases.slice(1),
      detalle: [r.apps.length ? `Abre ${r.apps.join(", ")}` : "", r.musica ? `pone «${r.musica}»` : ""].filter(Boolean).join(" y "),
      copiar: r.frases[0] ?? "",
    })),
  ];
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");

/** Whether a row has every word of the search, anywhere (accents and case aside). */
export function matches(e: Entry, query: string): boolean {
  const hay = fold([e.titulo, ...e.alias, e.detalle].join(" "));
  return fold(query).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
