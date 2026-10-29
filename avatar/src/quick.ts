// Her quick menu: a right click on her opens it at the pointer (tray.rs quick_menu). The few things changed most:
// her voice, her brain, how she looks, listening / talking / do not disturb; the rest in the full panel. It holds
// no state of its own: toggles go through Rust (tray_action) and come back as tray-state events, voices and
// models through its own socket to the backend, as the panel's.
import "@fontsource/chakra-petch/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "./quick.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ModelInfo, ServerMessage, VoiceInfo } from "./net/protocol.ts";
import { connect } from "./net/ws.ts";
import { brainItems, PROVIDERS, step, voiceItems } from "./quickmenu.ts";

type View = "root" | "voz" | "cerebro";
const menu = document.getElementById("menu")!;
const body = document.getElementById("m-body")!;
const title = document.getElementById("m-title")!;
let view: View = "root";
let states: Record<string, boolean> = {};
let voice: VoiceInfo | null = null;
let brain: ModelInfo | null = null;

const act = (id: string): void => void invoke("tray_action", { id });
const close = (): void => void getCurrentWindow().hide();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const look = () => (states.camera ? "camara" : states.style ? "pixel" : "original");
const BACK = '<button class="m-item back" data-back role="menuitem"><i class="chev">‹</i><span class="k">Volver</span></button>';

function root(): string {
  const v = voice?.voces.find((o) => o.id === voice!.voz)?.nombre ?? "…";
  const toggle = (id: string, label: string) =>
    `<button class="m-tog" data-toggle="${id}" aria-pressed="${!!states[id]}" role="menuitemcheckbox"><i></i>${label}</button>`;
  const seg = (id: string, label: string) => `<button data-look="${id}" class="${look() === id ? "on" : ""}" role="menuitemradio">${label}</button>`;
  return `
    <button class="m-item" data-go="voz" role="menuitem"><span class="k">Voz</span><span class="v">${esc(v)}</span><i class="chev">›</i></button>
    <button class="m-item" data-go="cerebro" role="menuitem"><span class="k">Cerebro</span><span class="v">${esc(brain?.nombre || "…")}</span><i class="chev">›</i></button>
    <p class="m-label">Apariencia</p>
    <div class="m-seg">${seg("original", "Original")}${seg("pixel", "Pixel")}${seg("camara", "Cámara")}</div>
    <p class="m-label">Modos</p>
    <div class="m-toggles">${toggle("voz", "Escuchar")}${toggle("hablar", "Hablar")}${toggle("dnd", "No molestar")}</div>
    <hr class="m-rule" />
    <button class="m-item" data-panel="comandos" role="menuitem"><span class="k">Comandos</span><i class="chev">↗</i></button>
    <button class="m-item" data-panel="general" role="menuitem"><span class="k">Más ajustes…</span><i class="chev">↗</i></button>
    <div class="m-pair"><button class="m-item" data-act="hide" role="menuitem">Esconderse</button><button class="m-item danger" data-act="quit" role="menuitem">Cerrar Capri</button></div>`;
}

function voices(): string {
  const items = voice ? voiceItems(voice) : [];
  const rows = items.map((v) => `<button class="m-item pick${v.on ? " on" : ""}" data-voice="${v.id}" role="menuitemradio" aria-checked="${v.on}">` +
    `<span class="k">${esc(v.label)}</span><span class="tag${v.gpu ? " gpu" : ""}">${v.gpu ? "GPU" : "CPU"}</span></button>`).join("");
  return BACK + (rows || '<p class="m-note">Cargando sus voces…</p>') + '<p class="m-note">Tócala para oírla. Más voces: Más ajustes › Voz.</p>';
}

function brains(): string {
  const items = brain ? brainItems(brain) : [];
  let group = "";
  const rows = items.map((b) => {
    const head = b.grupo !== group ? `<p class="m-label">${(group = b.grupo)}</p>` : "";
    return `${head}<button class="m-item pick${b.on ? " on" : ""}" data-prov="${b.proveedor}" data-model="${esc(b.nombre)}" ` +
      `role="menuitemradio" aria-checked="${b.on}"><span class="k">${esc(b.nombre)}</span></button>`;
  }).join("");
  const now = brain && brain.proveedor !== "ollama" ? `Ahora: ${PROVIDERS[brain.proveedor] ?? brain.proveedor}. ` : "";
  return BACK + (rows || '<p class="m-note">Cargando sus modelos…</p>') + `<p class="m-note">${now}Claves y descargas: Más ajustes › Cerebro.</p>`;
}

/** Draws the view, keeping the keyboard on the same item (a toggle coming back, a voice picked). */
function render(): void {
  const was = document.activeElement instanceof HTMLButtonElement ? [...body.querySelectorAll("button")].indexOf(document.activeElement) : -1;
  title.textContent = view === "root" ? "acceso" : view;
  body.innerHTML = view === "root" ? root() : view === "voz" ? voices() : brains();
  if (was >= 0) body.querySelectorAll<HTMLElement>("button")[was]?.focus();
}

function go(to: View): void {
  view = to;
  render();
  body.querySelector<HTMLElement>(to === "root" ? "button" : ".pick.on, .pick, button")?.focus();
}

const sync = (): Promise<void> => invoke<Record<string, boolean>>("tray_states").then((s) => ((states = s), render()));
void listen<[string, boolean]>("tray-state", (e) => {
  states[e.payload[0]] = e.payload[1];
  render();
});

const link = connect(`${(await invoke<{ ws_url: string }>("config")).ws_url}&panel=1`, (m: ServerMessage) => {
  if (m.type === "voice_info") voice = m;
  else if (m.type === "model_info") brain = m;
  else return;
  render();
}, (up) => {
  if (up) {
    link.send({ type: "voice_get" });
    link.send({ type: "model_get" });
  }
});

void listen("quick-open", () => {
  view = "root";
  void sync();
  link.send({ type: "voice_get" });
  link.send({ type: "model_get" });
  render();
  menu.focus();
});

body.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!t) return;
  const d = t.dataset;
  if (d.go) go(d.go as View);
  else if (d.back !== undefined) go("root");
  else if (d.toggle) act(d.toggle);
  else if (d.look) {
    if (look() !== d.look) act(`mode-${d.look}`);
    close();
  } else if (d.voice && voice) {
    link.send({ type: "voice_set", velocidad: voice.velocidad, robot: voice.robot, glitch: voice.glitch, voz: d.voice, probar: true });
  } else if (d.prov && d.model) {
    link.send({ type: "model_set", proveedor: d.prov, nombre: d.model });
    close();
  } else if (d.panel) {
    void invoke("open_panel", { tab: d.panel });
    close();
  } else if (d.act) {
    act(d.act);
    close();
  }
});

addEventListener("keydown", (e) => {
  const items = [...body.querySelectorAll<HTMLElement>("button")];
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (e.key === "Escape") {
    if (view === "root") close();
    else go("root");
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    items[step(at, e.key === "ArrowDown" ? 1 : -1, items.length)]?.focus();
  } else if (e.key === "ArrowRight" && items[at]?.dataset.go) go(items[at].dataset.go as View);
  else if ((e.key === "ArrowLeft" || e.key === "Backspace") && view !== "root") go("root");
});

void sync();
