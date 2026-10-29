import assert from "node:assert/strict";
import { test } from "node:test";

import { brainItems, step, voiceItems } from "./quickmenu.ts";
import type { ModelInfo, VoiceInfo, VoiceOption } from "./net/protocol.ts";

const opt = (id: string, extra: Partial<VoiceOption> = {}): VoiceOption => ({
  id, nombre: id.toUpperCase(), motor: "kokoro", nota: "", gpu: false, descargada: true, descargable: false,
  disponible: true, motivo: "", mb: 0, ...extra,
});

test("only the voices this PC can use right now, hers marked", () => {
  const info: VoiceInfo = {
    type: "voice_info", velocidad: 1, robot: 0, glitch: 0, voz: "dora",
    voces: [opt("capri", { motor: "qwen", gpu: true, disponible: false }), opt("dora"), opt("emma", { descargada: false })],
  };
  assert.deepEqual(voiceItems(info).map((v) => [v.id, v.on]), [["dora", true]]);
});

test("the brains: models of each provider it can use, keys needed for the cloud ones", () => {
  const info: ModelInfo = {
    type: "model_info", proveedor: "ollama", nombre: "gemma3:12b", error: "",
    opciones: { ollama: ["gemma3:12b", "qwen3-vl:8b"], claude_code: ["sonnet"], anthropic: ["claude-opus-5-5"], openai: [] },
    claves: { anthropic: false, openai: true },
  };
  const items = brainItems(info);
  assert.deepEqual(items.map((i) => [i.proveedor, i.nombre, i.on]), [
    ["ollama", "gemma3:12b", true], ["ollama", "qwen3-vl:8b", false], ["claude_code", "sonnet", false],
  ]); // no key for the API one; GPT has a key but no models
  assert.equal(items[2].grupo, "Mi Claude");
});

test("arrow keys go round the items", () => {
  assert.equal(step(0, 1, 3), 1);
  assert.equal(step(2, 1, 3), 0);
  assert.equal(step(0, -1, 3), 2);
  assert.equal(step(-1, 1, 3), 0); // nothing focused yet: the first
  assert.equal(step(-1, -1, 3), 2);
});
