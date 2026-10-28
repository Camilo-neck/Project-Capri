import assert from "node:assert/strict";
import { test } from "node:test";

import type { PcEvent } from "../net/protocol.ts";
import { reaction } from "./pc.ts";

const ev = (tipo: PcEvent["tipo"], detalle = ""): PcEvent => ({ type: "pc", tipo, detalle });
const first = () => 0;

test("each thing she feels has its own look and word", () => {
  assert.equal(reaction(ev("caliente"), first)!.fx, "heat");
  assert.equal(reaction(ev("caliente"), first)!.emocion, "molesta");
  assert.equal(reaction(ev("cargador", "on"), first)!.fx, "bolt");
  assert.notEqual(reaction(ev("cargador", "on"), first)!.texto, reaction(ev("cargador", "off"), first)!.texto);
  assert.equal(reaction(ev("bateria", "10"), first)!.fx, "sag");
  assert.equal(reaction(ev("red", "caida"), first)!.fx, "hurt");
  assert.equal(reaction(ev("red", "vuelve"), first)!.emocion, "feliz");
});

test("a USB stick: she dives into it and comes back with her verdict", () => {
  const r = reaction(ev("usb", "Tu USB tiene 3 fotos."), first)!;
  assert.equal(r.fx, "dive");
  assert.equal(r.texto, "Tu USB tiene 3 fotos.");
});

test("a device by its kind, and by its name when it's something else", () => {
  assert.match(reaction(ev("dispositivo", "controller:Xbox Wireless Controller"), first)!.texto, /mando/i);
  assert.match(reaction(ev("dispositivo", "device:Stream Deck"), first)!.texto, /Stream Deck/);
});

test("a game: she wishes him luck and hides; it's over: she's back and asks", () => {
  const start = reaction(ev("juego", "inicio:Cyberpunk 2077"), first)!;
  assert.ok(start.hide && start.texto.includes("Cyberpunk 2077"));
  const end = reaction(ev("juego", "fin:Cyberpunk 2077"), first)!;
  assert.ok(end.unhide && /ganaste/i.test(end.texto));
});
