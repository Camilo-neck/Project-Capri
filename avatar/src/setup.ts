// The first-run wizard (tray.rs opens it on a fresh install, or from the panel): this PC, her brain, her voice, his
// calendar and Spotify, and a few tips. Its own socket to the backend, as the panel's; nothing is kept here, each
// step saves as it goes and "Empezar" marks the wizard done (firstrun.py).
import "@fontsource/chakra-petch/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "./settings.css";
import "./setup.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import face from "../assets/faces/grin.png";
import { KEY_PAGES } from "./cloudkeys.ts";
import type { ModelInfo, ServerMessage, SetupInfo, VoiceInfo } from "./net/protocol.ts";
import { connect } from "./net/ws.ts";
import { voiceCard } from "./voicecard.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
($("face") as HTMLImageElement).src = face;
const steps = [...document.querySelectorAll<HTMLElement>(".step")];
const rail = [...document.querySelectorAll<HTMLElement>("#rail li")];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
let at = 0;
let pc: SetupInfo | null = null;
let brain: ModelInfo | null = null;
let voice: VoiceInfo | null = null;
let kind = "ollama"; // the brain step's choice: ollama | claude_code | nube
let cloud = "gemini";
const downloading = new Map<string, number>();
let pulling = ""; // the local model being downloaded: chosen once it's there

function go(to: number): void {
  at = Math.max(0, Math.min(steps.length - 1, to));
  steps.forEach((s, i) => (s.hidden = i !== at));
  rail.forEach((li, i) => {
    li.classList.toggle("on", i === at);
    li.classList.toggle("done", i < at);
  });
  $("step-of").textContent = `paso ${at + 1} de ${steps.length}`;
  $("back").hidden = at === 0;
  $("next").textContent = at === 0 ? "Empezar" : at === steps.length - 1 ? "Listo, ¡a trabajar!" : at >= 4 ? "Siguiente (o saltar)" : "Siguiente";
}

// ---- this PC ----
function showPc(): void {
  if (!pc) return;
  const row = (ok: boolean | null, what: string, detail: string) =>
    `<div class="check ${ok === null ? "" : ok ? "ok" : "no"}"><i></i><b>${what}</b><span>${esc(detail)}</span></div>`;
  $("pc").innerHTML = [
    row(!!pc.gpu, "Tarjeta gráfica", pc.gpu ? `${pc.gpu}, ${Math.round(pc.vram_mb / 1024)} GB` : "Sin NVIDIA: su cerebro y su oído irán por la CPU o la nube"),
    row(null, "Memoria", `${pc.ram_gb} GB de RAM`),
    row(pc.disco_gb > 10, "Espacio libre", `${pc.disco_gb} GB donde van sus modelos`),
    row(pc.ollama, "Ollama", pc.ollama ? "Instalado: puede pensar en tu PC" : "No está: hace falta para un cerebro local"),
    row(pc.claude_code || null, "Claude Code", pc.claude_code ? "Instalado: puede usar tu plan de Claude" : "No está (opcional)"),
    row(pc.qwen || null, "Su voz clonada", pc.qwen ? "Instalada" : "No instalada (la pone el instalador): usará otra voz"),
  ].join("");
  $("get-ollama").hidden = pc.ollama;
  $("advice").innerHTML = `<b>Recomendado:</b> ${esc(names(pc.proveedor))} · ${esc(pc.modelo)}<br /><span>${esc(pc.por_que)}</span>`;
  $("voice-advice").textContent = `Recomendada para este PC: ${voice?.voces.find((v) => v.id === pc!.voz)?.nombre ?? pc.voz}.`;
}

const names = (p: string) => (p === "ollama" ? "Local" : p === "claude_code" ? "Mi Claude" : brain?.nombres[p] ?? p);

// ---- her brain ----
function showBrain(): void {
  if (!brain) return;
  document.querySelectorAll<HTMLElement>("#brain-kind button").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
  $("brain-local").hidden = kind !== "ollama";
  $("brain-claude").hidden = kind !== "claude_code";
  $("brain-cloud").hidden = kind !== "nube";
  const note = $("brain-note");
  note.className = "note";
  note.textContent = "";
  if (kind === "ollama") {
    const local = brain.opciones.ollama ?? [];
    const sel = $<HTMLSelectElement>("local-model");
    sel.replaceChildren(...local.map((m) => new Option(m, m, false, brain!.proveedor === "ollama" && m === brain!.nombre)));
    sel.hidden = !local.length;
    const want = pc?.proveedor === "ollama" ? pc.modelo : "gemma3:4b";
    const pull = $("pull-rec");
    pull.hidden = local.includes(want) || !pc?.ollama;
    pull.textContent = `Descargar ${want}`;
    pull.dataset.model = want;
    if (!pc?.ollama) note.textContent = "Sin Ollama no hay cerebro local: instálalo (paso anterior) o elige otro.";
    else if (!local.length) note.textContent = "Aún no hay modelos: descarga el recomendado.";
  } else if (kind === "claude_code") {
    $("claude-note").textContent = pc?.claude_code
      ? "Usa tu plan de Claude a través de Claude Code, sin clave. Gasta de tu cupo y tarda unos segundos más en hablar."
      : "Instala Claude Code e inicia sesión (claude.com/claude-code); luego vuelve a abrir este asistente.";
  } else {
    const keyed = Object.keys(brain.claves);
    const sel = $<HTMLSelectElement>("cloud");
    sel.replaceChildren(...keyed.map((p) => new Option(`${brain!.nombres[p] ?? p}${brain!.claves[p] ? "  · clave guardada" : ""}`, p, false, p === cloud)));
    $("get-key").dataset.web = KEY_PAGES[cloud]?.page ?? "";
    $("get-key").textContent = `Conseguir una clave de ${brain.nombres[cloud] ?? cloud}`;
    const models = brain.opciones[cloud] ?? [];
    const m = $<HTMLSelectElement>("cloud-model");
    m.replaceChildren(new Option(brain.claves[cloud] ? "Elige un modelo…" : "Guarda tu clave para ver sus modelos", "", true, true),
      ...models.map((x) => new Option(x, x, false, brain!.proveedor === cloud && x === brain!.nombre)));
    m.disabled = !models.length;
    note.className = "note warn";
    note.textContent = `Tus mensajes y las capturas que le pidas se envían a ${brain.nombres[cloud] ?? cloud}. ${KEY_PAGES[cloud]?.hint ?? ""}`;
  }
  if (brain.error) {
    note.className = "note err";
    note.textContent = brain.error;
  }
}

// ---- her voice ----
function showVoices(): void {
  if (!voice) return;
  $("voices").innerHTML = voice.voces.map((o) => voiceCard(o, o.id === voice!.voz, downloading.get(o.id))).join("");
}

const link = connect(`${(await invoke<{ ws_url: string }>("config")).ws_url}&panel=1`, (m: ServerMessage) => {
  if (m.type === "setup_info") {
    const first = !pc;
    pc = m;
    if (first) {
      kind = m.proveedor === "ollama" || m.proveedor === "claude_code" ? m.proveedor : "nube";
      if (kind === "nube") cloud = m.proveedor;
    }
    showPc();
    showBrain();
  } else if (m.type === "model_info") {
    brain = m;
    if (pulling && m.opciones.ollama?.includes(pulling)) {
      link.send({ type: "model_set", proveedor: "ollama", nombre: pulling });
      pulling = "";
    }
    $("pull-bar").hidden = true;
    showBrain();
  } else if (m.type === "model_progress") {
    $("pull-bar").hidden = false;
    ($("pull-bar").firstElementChild as HTMLElement).style.width = m.total ? `${(100 * m.completado) / m.total}%` : "0";
    $("brain-note").textContent = `${m.nombre}: ${m.estado}${m.total ? ` · ${(m.completado / 1e9).toFixed(1)} / ${(m.total / 1e9).toFixed(1)} GB` : ""}`;
  } else if (m.type === "voice_info") {
    voice = m;
    showVoices();
    showPc();
  } else if (m.type === "voice_progress") {
    if (m.error || m.completado >= m.total) downloading.delete(m.voz);
    else downloading.set(m.voz, m.total ? m.completado / m.total : 0);
    showVoices();
  } else if (m.type === "setup_saved") {
    const note = $(m.campo === "calendario" ? "cal-note" : "spotify-note");
    note.className = m.ok ? "note okay" : "note err";
    note.textContent = m.ok ? (m.campo === "calendario" ? "Guardado. Te avisaré antes de tus eventos." : "Guardado. Dile «conecta Spotify» cuando quieras.") : m.error;
  }
}, (up) => up && refresh());

function refresh(): void {
  link.send({ type: "setup_get" });
  link.send({ type: "model_get" });
  link.send({ type: "voice_get" });
}
void listen("setup-open", () => {
  go(0);
  refresh();
});

document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("button, .voice.pick");
  if (!t) return;
  if (t.dataset.web) void invoke("open_web", { url: t.dataset.web }).catch((err) => console.warn("open_web", err));
  else if (t.id === "next") {
    if (at === steps.length - 1) {
      link.send({ type: "setup_done" });
      void invoke("setup_close");
    } else go(at + 1);
  } else if (t.id === "back") go(at - 1);
  else if (t.dataset.kind) {
    kind = t.dataset.kind;
    if (kind === "claude_code" && brain?.opciones.claude_code?.length) link.send({ type: "model_set", proveedor: "claude_code", nombre: "sonnet" });
    showBrain();
  } else if (t.id === "pull-rec" && t.dataset.model) {
    if (link.send({ type: "model_pull", nombre: t.dataset.model })) {
      pulling = t.dataset.model;
      $("pull-bar").hidden = false;
      $("brain-note").textContent = `Descargando ${t.dataset.model}…`;
    }
  } else if (t.id === "key-save") {
    const key = $<HTMLInputElement>("key");
    if (key.value.trim()) link.send({ type: "model_key", proveedor: cloud, clave: key.value.trim() });
    key.value = "";
  } else if (t.id === "cal-save") link.send({ type: "setup_save", campo: "calendario", valor: $<HTMLInputElement>("cal").value });
  else if (t.id === "spotify-save") link.send({ type: "setup_save", campo: "spotify", valor: $<HTMLInputElement>("spotify").value });
  else if (t.id === "copy-redirect") void navigator.clipboard.writeText($("redirect").textContent ?? "");
  else if (t.dataset.get) {
    if (link.send({ type: "voice_download", voz: t.dataset.get })) downloading.set(t.dataset.get, 0);
    showVoices();
  } else if (t.classList.contains("pick") && voice && t.dataset.voice !== voice.voz) {
    link.send({ type: "voice_set", velocidad: voice.velocidad, robot: voice.robot, glitch: voice.glitch, voz: t.dataset.voice!, probar: true });
  }
});
$("local-model").addEventListener("change", (e) => {
  const m = (e.target as HTMLSelectElement).value;
  if (m) link.send({ type: "model_set", proveedor: "ollama", nombre: m });
});
$("cloud").addEventListener("change", (e) => {
  cloud = (e.target as HTMLSelectElement).value;
  showBrain();
});
$("cloud-model").addEventListener("change", (e) => {
  const m = (e.target as HTMLSelectElement).value;
  if (m) link.send({ type: "model_set", proveedor: cloud, nombre: m });
});
addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "BUTTON") $("next").click();
});

go(0);
