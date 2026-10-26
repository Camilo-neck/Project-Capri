import assert from "node:assert/strict";
import { test } from "node:test";

import type { ClaudeEvent } from "../net/protocol.ts";
import { panelFor, reaction, summary, THINK_MS, Tracker } from "./claude.ts";

const ev = (estado: ClaudeEvent["estado"], more: Partial<ClaudeEvent> = {}): ClaudeEvent => ({
  type: "claude", session: "s1", project: "capri", estado, detalle: "", resumen: "", segundos: 0, acciones: 0, archivos: 0, ...more,
});

test("it shows what Claude is doing, and 'pensando' once it goes quiet", () => {
  const t = new Tracker();
  assert.equal(t.line(0), null);
  t.push(ev("trabajando", { detalle: "Editando main.ts" }), 1000);
  assert.deepEqual(t.line(2000), { text: "capri › Editando main.ts", tone: "work" });
  assert.deepEqual(t.line(1000 + THINK_MS + 3200), { text: "capri › pensando… 18 s", tone: "think" });
});

test("needing you stays until something else happens; a failure and an end are flashes", () => {
  const t = new Tracker();
  t.push(ev("necesita", { detalle: "permiso para Bash" }), 0);
  assert.equal(t.line(600_000)?.tone, "need");
  t.push(ev("fallo", { detalle: "npm ERR!" }), 0);
  assert.equal(t.line(1000)?.tone, "fail");
  assert.equal(t.line(7000), null);
  t.push(ev("termino", { segundos: 130, acciones: 4, archivos: 2 }), 0);
  assert.equal(t.line(1000)?.text, "capri › terminó · 2 min 10 s · 4 acciones · 2 archivos");
  assert.equal(t.line(13_000), null);
  t.push(ev("trabajando", { detalle: "x" }), 0);
  t.push(ev("fin"), 5);
  assert.equal(t.line(10), null);
});

test("summary uses the singular and skips files when none were edited", () => {
  assert.equal(summary(ev("termino", { segundos: 9, acciones: 1 })), "9 s · 1 acción");
  assert.equal(summary(ev("termino", { segundos: 60, acciones: 3, archivos: 1 })), "1 min 0 s · 3 acciones · 1 archivo");
});

test("she reacts to the end, a failure and a request, not to routine work", () => {
  assert.deepEqual(reaction(ev("termino")), { emocion: "feliz", gesto: "saltar" });
  assert.equal(reaction(ev("fallo"))?.emocion, "sorprendida");
  assert.equal(reaction(ev("necesita"))?.gesto, "senalar");
  assert.equal(reaction(ev("trabajando")), null);
});

test("only an end or an answer with words opens the panel", () => {
  assert.equal(panelFor(ev("termino")), null);
  assert.equal(panelFor(ev("termino", { resumen: "Hecho." }))?.body, "Hecho.");
  assert.match(panelFor(ev("respuesta", { resumen: "Sí." }))!.title, /respuesta a Capri/);
  assert.equal(panelFor(ev("trabajando", { resumen: "x" })), null);
});
