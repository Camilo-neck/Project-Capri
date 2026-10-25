import assert from "node:assert/strict";
import { test } from "node:test";

import { LONG_MS, zapEnd, zapStart } from "./zap.ts";

test("tools that act on the PC spark toward where they act; the ones that only read don't", () => {
  assert.deepEqual(zapStart("abrir_app"), { bolt: "center" });
  assert.deepEqual(zapStart("musica"), { bolt: "tray" });
  assert.deepEqual(zapStart("ejecutar_script"), { bolt: "window", frame: true });
  assert.deepEqual(zapStart("copiar_al_portapapeles"), { bolt: null }); // sparks on her, no bolt
  for (const quiet of ["calendario", "buscar_archivos", "leer_portapapeles", "recordar"]) assert.equal(zapStart(quiet), null);
});

test("the end: a spark, a victory for something long or a script, an impact if it failed", () => {
  assert.equal(zapEnd("abrir_web", true, 300), "chispa");
  assert.equal(zapEnd("spotify", true, LONG_MS), "victoria");
  assert.equal(zapEnd("ejecutar_script", true, 50), "victoria");
  assert.equal(zapEnd("abrir_app", false, 20), "fallo");
  assert.equal(zapEnd("calendario", false, 20), null);
});
