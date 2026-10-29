import assert from "node:assert/strict";
import { test } from "node:test";

import { canonical, COMMANDS, parse } from "./commands.ts";

test("typed in any case, with accents or in English, a command is her Spanish one", () => {
  assert.equal(canonical("/Escóndete"), "/escondete");
  assert.equal(canonical("/HIDE on"), "/escondete on");
  assert.equal(canonical("/back"), "/vuelve");
  assert.equal(canonical("/forget everything"), "/olvida todo");
  assert.equal(canonical("/look qué es esto"), "/mira qué es esto");
  assert.equal(canonical("hola"), "hola");
  assert.equal(canonical("/algo"), "/algo");
});

test("the avatar's own commands, with their argument", () => {
  assert.deepEqual(parse("/escóndete"), { name: "/escondete", arg: "" });
  assert.deepEqual(parse("/hide OFF"), { name: "/escondete", arg: "off" });
  assert.deepEqual(parse("/Mira qué ves"), { name: "/mira", arg: "qué ves" });
  assert.equal(parse("/olvida todo"), null, "the backend's");
  assert.equal(parse("hola"), null);
});

test("the list is the backend's own", () => {
  assert.ok(COMMANDS.some((c) => c.nombre === "/ayuda" && c.donde === "backend"));
  assert.ok(COMMANDS.filter((c) => c.donde === "avatar").map((c) => c.nombre).includes("/cierra"));
});
