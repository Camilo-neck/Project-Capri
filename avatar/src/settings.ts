// The tray's settings panel: a popover near the clock. It holds no state of its own: toggles ask
// Rust (`tray_action`) and show whatever `tray-state` events say, so it matches the real modes.
import "@fontsource/chakra-petch/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "./settings.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import face from "../assets/faces/grin.png";
import type { ModelInfo, ServerMessage } from "./net/protocol.ts";
import { connect } from "./net/ws.ts";

document.querySelector<HTMLImageElement>("#face")!.src = face;

const act = (id: string): void => void invoke("tray_action", { id });
const close = (): void => void getCurrentWindow().hide();

function show(name: string, on: boolean): void {
  const input = document.querySelector<HTMLInputElement>(`.row[data-id="${name}"] input`);
  if (input) input.checked = on;
  if (name === "style") {
    document.querySelectorAll<HTMLElement>("#style button").forEach((b) => b.classList.toggle("on", (b.dataset.style === "pixel") === on));
  }
}

const sync = (): Promise<void> => invoke<Record<string, boolean>>("tray_states").then((s) => Object.entries(s).forEach(([k, v]) => show(k, v)));
void sync();
void listen<[string, boolean]>("tray-state", (e) => show(...e.payload));
void getCurrentWindow().onFocusChanged(({ payload }) => payload && void sync()); // shown again

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const row = t.closest<HTMLElement>(".row");
  if (row) {
    e.preventDefault(); // the real state comes back as an event
    act(row.dataset.id!);
    return;
  }
  const seg = t.closest<HTMLElement>("#style button");
  if (seg) {
    if (!seg.classList.contains("on")) act("style");
    return;
  }
  const id = t.closest<HTMLElement>("[data-act]")?.dataset.act;
  if (id === "close") close();
  else if (id) {
    act(id);
    if (id !== "quit" && id !== "quit-ollama") close();
  }
});
document.addEventListener("keydown", (e) => e.key === "Escape" && close());

// ---- her brain: its own socket to the backend (as the panel, so it gets no turns) ----

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const prov = $("prov"), model = $<HTMLSelectElement>("model"), note = $("brain-note");
const keyRow = $("key-row"), key = $<HTMLInputElement>("key"), pull = $<HTMLInputElement>("pull");
const pullRow = $("pull-row"), bar = $("pull-bar");
const NAMES: Record<string, string> = { ollama: "Local", anthropic: "Claude", openai: "GPT" };
const KEY_HINT: Record<string, string> = { anthropic: "Clave de API de Anthropic (sk-ant-…)", openai: "Clave de API de OpenAI (sk-…)" };
const SUGGESTED = ["gemma3:12b", "qwen3-vl:8b-instruct", "gemma3:4b"];
$("suggest").innerHTML = SUGGESTED.map((m) => `<option value="${m}">`).join("");

let info: ModelInfo | null = null;
let shown = "ollama"; // the provider whose models are listed (picking one saves it)

function render(error = info?.error ?? ""): void {
  if (!info) return;
  prov.querySelectorAll<HTMLElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.prov === shown));
  const cloud = shown !== "ollama";
  const hasKey = !cloud || info.claves[shown];
  const list = info.opciones[shown] ?? [];
  const current = info.proveedor === shown ? info.nombre : "";
  const pick = new Option("Elige un modelo…", "", true, true);
  pick.disabled = true;
  const names = [...new Set([current, ...list].filter(Boolean))];
  model.replaceChildren(...(current ? [] : [pick]), ...names.map((m) => new Option(m, m, false, m === current)));
  model.disabled = !hasKey || !list.length;
  keyRow.hidden = !cloud;
  key.placeholder = info.claves[shown] ? "Clave guardada · pega otra para cambiarla" : KEY_HINT[shown] ?? "";
  pullRow.hidden = cloud;
  note.className = "note" + (error ? " err" : cloud ? " warn" : "");
  note.textContent = error ||
    (cloud
      ? `Con ${NAMES[shown]} tus mensajes, lo que recuerda de ti y las capturas de /mira se envían a ${shown === "anthropic" ? "Anthropic" : "OpenAI"}. ${hasKey ? "" : "Pega tu clave para elegir modelo."}`
      : list.length ? "Todo en tu PC. Los modelos locales gastan GPU: uno a la vez." : "Ollama no responde o no tiene modelos.");
}

const link = connect(`${(await invoke<{ ws_url: string }>("config")).ws_url}&panel=1`, (m: ServerMessage) => {
  if (m.type === "model_info") {
    const first = !info;
    info = m;
    if (first) shown = m.proveedor;
    bar.hidden = true;
    render();
  } else if (m.type === "model_progress") {
    bar.hidden = false;
    (bar.firstElementChild as HTMLElement).style.width = m.total ? `${(100 * m.completado) / m.total}%` : "0";
    note.className = "note";
    note.textContent = `${m.nombre}: ${m.estado}${m.total ? ` · ${(m.completado / 1e9).toFixed(1)} / ${(m.total / 1e9).toFixed(1)} GB` : ""}`;
  }
}, (up) => up && link.send({ type: "model_get" }));
void getCurrentWindow().onFocusChanged(({ payload }) => payload && link.send({ type: "model_get" }));

prov.addEventListener("click", (e) => {
  const p = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.prov;
  if (p) {
    shown = p;
    render("");
  }
});
model.addEventListener("change", () => model.value && link.send({ type: "model_set", proveedor: shown, nombre: model.value }));
$("key-save").addEventListener("click", () => {
  if (!key.value.trim()) return;
  link.send({ type: "model_key", proveedor: shown, clave: key.value.trim() });
  key.value = "";
});
$("pull-go").addEventListener("click", () => {
  const name = pull.value.trim();
  if (name && link.send({ type: "model_pull", nombre: name })) {
    pull.value = "";
    bar.hidden = false;
    note.textContent = `Descargando ${name}…`;
  }
});
