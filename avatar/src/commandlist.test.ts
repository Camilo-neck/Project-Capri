import assert from "node:assert/strict";
import { test } from "node:test";

import { COMMANDS } from "./commands.ts";
import { entries, matches, SECTIONS } from "./commandlist.ts";

const routines = [{ nombre: "chamba", frases: ["modo chamba"], apps: ["vscode", "warp"], musica: "lofi hip hop" }];
const keys: [string, string][] = [["Escribirle", "Ctrl+Alt+Space"], ["Mirar la pantalla", "Ctrl+Alt+Shift+M"]];

test("every command, what to say, the shortcuts and the routines, each in its section", () => {
  const all = entries(routines, keys);
  for (const c of COMMANDS) assert.ok(all.some((e) => e.seccion === "Escritos" && e.titulo.startsWith(c.nombre)), c.nombre);
  assert.ok(all.some((e) => e.seccion === "Por voz" && e.detalle.includes("«no molestes»")));
  assert.deepEqual(all.filter((e) => e.seccion === "Atajos").map((e) => e.titulo), ["Ctrl+Alt+Space", "Ctrl+Alt+Shift+M"]);
  const r = all.find((e) => e.seccion === "Rutinas")!;
  assert.equal(r.copiar, "modo chamba");
  assert.ok(r.detalle.includes("vscode") && r.detalle.includes("lofi hip hop"));
  assert.deepEqual([...new Set(all.map((e) => e.seccion))], SECTIONS);
});

test("the search finds a command by its English name, a phrase or a word, without accents", () => {
  const all = entries(routines, keys);
  const hits = (q: string) => all.filter((e) => matches(e, q)).map((e) => e.titulo);
  assert.ok(hits("/dnd").some((t) => t.startsWith("/nomolestes")));
  assert.ok(hits("escondete").some((t) => t.startsWith("/escondete")));
  assert.ok(hits("pantalla").includes("Ctrl+Alt+Shift+M"));
  assert.equal(hits("").length, all.length);
  assert.deepEqual(hits("zzz"), []);
});
