import assert from "node:assert/strict";
import { test } from "node:test";

import type { ClaudeEvent } from "../net/protocol.ts";
import { bigJob, panelFor, reaction, sparkFor, split, summary, THINK_MS, Tracker } from "./claude.ts";

const ev = (estado: ClaudeEvent["estado"], more: Partial<ClaudeEvent> = {}): ClaudeEvent => ({
  type: "claude", session: "s1", project: "capri", estado, detalle: "", herramienta: "", resumen: "", segundos: 0, acciones: 0, archivos: 0, ...more,
});

test("it shows what Claude is doing, and 'pensando' once it goes quiet", () => {
  const t = new Tracker();
  assert.equal(t.line(0), null);
  t.push(ev("trabajando", { detalle: "Editando main.ts" }), 1000);
  assert.deepEqual(t.line(2000), { verb: "Editando", target: "main.ts", project: "capri", tone: "work" });
  assert.deepEqual(t.line(1000 + THINK_MS + 3200), { verb: "pensando", target: "18 s", project: "capri", tone: "think" });
});

test("needing you stays until something else happens; a failure and an end are flashes", () => {
  const t = new Tracker();
  t.push(ev("necesita", { detalle: "permiso para Bash" }), 0);
  assert.equal(t.line(600_000)?.tone, "need");
  t.push(ev("fallo", { detalle: "npm ERR!" }), 0);
  assert.equal(t.line(1000)?.tone, "fail");
  assert.equal(t.line(7000), null);
  t.push(ev("termino", { segundos: 130, acciones: 4, archivos: 2 }), 0);
  assert.equal(t.line(1000)?.target, "4 acciones · 2 archivos modificados · 2 min 10 s");
  assert.equal(t.line(13_000), null);
  t.push(ev("trabajando", { detalle: "x" }), 0);
  t.push(ev("fin"), 5);
  assert.equal(t.line(10), null);
});

test("summary uses the singular and skips files when none were edited", () => {
  assert.equal(summary(ev("termino", { segundos: 9, acciones: 1 })), "1 acción · 9 s");
  assert.equal(summary(ev("termino", { segundos: 60, acciones: 3, archivos: 1 })), "3 acciones · 1 archivo modificado · 1 min 0 s");
});

test("the detail splits into a verb and its target", () => {
  assert.deepEqual(split("Ejecutando: npm test"), ["Ejecutando", "npm test"]);
  assert.deepEqual(split("Mirando la web"), ["Mirando", "la web"]);
  assert.deepEqual(split("«añade paginación»"), ["tarea", "«añade paginación»"]);
  assert.deepEqual(split("x"), ["x", ""]);
});

test("commands bolt into the window, the web into the middle, edits spark; reads don't", () => {
  const work = (herramienta: string) => sparkFor(ev("trabajando", { herramienta }));
  assert.deepEqual(work("Bash"), { bolt: "window", frame: true });
  assert.deepEqual(work("WebSearch"), { bolt: "center" });
  assert.deepEqual(work("Edit"), { bolt: null });
  assert.equal(work("Read"), null);
  assert.equal(sparkFor(ev("fallo", { herramienta: "Bash" })), null);
});

test("only a long job ends in her victory", () => {
  assert.equal(bigJob(ev("termino", { segundos: 30, acciones: 5 })), false);
  assert.equal(bigJob(ev("termino", { segundos: 130 })), true);
  assert.equal(bigJob(ev("termino", { acciones: 25 })), true);
});

test("she reacts to the end, a failure and a request, not to routine work", () => {
  assert.deepEqual(reaction(ev("termino")), { emocion: "feliz", gesto: "saltar" });
  assert.equal(reaction(ev("fallo"))?.emocion, "sorprendida");
  assert.equal(reaction(ev("necesita"))?.gesto, "senalar");
  assert.equal(reaction(ev("trabajando", { herramienta: "Read" })), null);
  assert.equal(reaction(ev("trabajando"))?.gesto, "asentir"); // the prompt arrived
});

test("an end always opens the bubble with its numbers; an answer only with words", () => {
  const done = panelFor(ev("termino", { acciones: 4, archivos: 2, segundos: 2 }), () => 0)!;
  assert.deepEqual([done.badge, done.title, done.body, done.stats], ["TERMINADO", "Misión cumplida, choom.", "", "4 acciones · 2 archivos modificados · 2 s"]);
  assert.equal(panelFor(ev("termino", { resumen: "Hecho." }))?.body, "Hecho.");
  assert.equal(panelFor(ev("respuesta")), null);
  assert.equal(panelFor(ev("respuesta", { resumen: "Sí." }))?.badge, "RESPUESTA");
  assert.equal(panelFor(ev("trabajando", { resumen: "x" })), null);
});
