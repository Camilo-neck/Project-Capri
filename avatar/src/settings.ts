// The tray's settings panel: a popover near the clock. It holds no state of its own: toggles ask
// Rust (`tray_action`) and show whatever `tray-state` events say, so it matches the real modes.
import "@fontsource/chakra-petch/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "./settings.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import face from "../assets/faces/grin.png";
import { entries, matches, SECTIONS } from "./commandlist.ts";
import { voiceCard } from "./voicecard.ts";
import { KEY_PAGES } from "./cloudkeys.ts";
import type { CloudVoice, ModelInfo, RoutineInfo, ServerMessage, VoiceInfo } from "./net/protocol.ts";
import { connect } from "./net/ws.ts";

document.querySelector<HTMLImageElement>("#face")!.src = face;

const act = (id: string): void => void invoke("tray_action", { id });
const close = (): void => void getCurrentWindow().hide();

// the sound effects' volume: saved when the slider is let go
const vol = document.querySelector<HTMLInputElement>("#sfx-vol")!;
const volN = document.querySelector<HTMLElement>("#sfx-vol-n")!;
const showVol = (): void => void (volN.textContent = `${vol.value}%`);
void invoke<{ sonido_volumen: number }>("avatar_settings").then((c) => {
  vol.value = String(c.sonido_volumen);
  showVol();
});
vol.addEventListener("input", showVol);
vol.addEventListener("change", () => void invoke("save_sfx_volume", { volumen: Number(vol.value) }));

const looks = { style: false, camera: false }; // how she looks: the camera over the art, or the art (original | pixel)

function show(name: string, on: boolean): void {
  const input = document.querySelector<HTMLInputElement>(`.row[data-id="${name}"] input`);
  if (input) input.checked = on;
  if (name === "style" || name === "camera") {
    looks[name] = on;
    const now = looks.camera ? "camara" : looks.style ? "pixel" : "original";
    document.querySelectorAll<HTMLElement>("#look button").forEach((b) => b.classList.toggle("on", b.dataset.look === now));
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
  const tab = t.closest<HTMLElement>("#tabs button");
  if (tab) {
    showTab(tab.dataset.tab!);
    return;
  }
  const copy = t.closest<HTMLElement>(".copy");
  if (copy) {
    void navigator.clipboard.writeText(copy.dataset.copy!).then(() => {
      copy.classList.add("done");
      setTimeout(() => copy.classList.remove("done"), 900);
    });
    return;
  }
  const seg = t.closest<HTMLElement>("#look button");
  if (seg) {
    if (!seg.classList.contains("on")) act(`mode-${seg.dataset.look}`);
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
const cloud = $<HTMLSelectElement>("cloud");
const LOCALS = ["ollama", "claude_code"];
let lastCloud = "anthropic"; // the cloud brain "Nube" shows
const SUGGESTED = ["gemma3:12b", "qwen3-vl:8b-instruct", "gemma3:4b"];
$("suggest").innerHTML = SUGGESTED.map((m) => `<option value="${m}">`).join("");

let info: ModelInfo | null = null;
let shown = "ollama"; // the provider whose models are listed (picking one saves it)

function render(error = info?.error ?? ""): void {
  if (!info) return;
  const keyedAll = Object.keys(info.claves);
  if (keyedAll.includes(shown)) lastCloud = shown;
  const seg = LOCALS.includes(shown) ? shown : "nube";
  prov.querySelectorAll<HTMLElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.prov === seg));
  cloud.hidden = seg !== "nube";
  cloud.replaceChildren(...keyedAll.map((p) => new Option(`${info!.nombres[p] ?? p}${info!.claves[p] ? "" : "  · sin clave"}`, p, false, p === shown)));
  const isCloud = shown !== "ollama";
  const keyed = keyedAll.includes(shown);
  const hasKey = !keyed || info.claves[shown];
  const list = info.opciones[shown] ?? [];
  const current = info.proveedor === shown ? info.nombre : "";
  const pick = new Option("Elige un modelo…", "", true, true);
  pick.disabled = true;
  const names = [...new Set([current, ...list].filter(Boolean))];
  model.replaceChildren(...(current ? [] : [pick]), ...names.map((m) => new Option(m, m, false, m === current)));
  model.disabled = !hasKey || !list.length;
  keyRow.hidden = !keyed;
  const name = info.nombres[shown] ?? shown;
  key.placeholder = info.claves[shown] ? "Clave guardada · pega otra para cambiarla" : `Tu clave de API de ${name}`;
  pullRow.hidden = isCloud;
  const company = shown === "claude_code" ? "Anthropic" : name;
  const away = `Tus mensajes, lo que recuerda de ti y las capturas de /mira se envían a ${company}.`;
  note.className = "note" + (error ? " err" : isCloud ? " warn" : "");
  note.textContent = error || (shown === "ollama"
    ? (list.length ? "Todo en tu PC. Los modelos locales gastan GPU: uno a la vez." : "Ollama no responde o no tiene modelos.")
    : shown === "claude_code"
      ? (list.length
        ? `Usa tu plan de Claude a través de Claude Code, sin clave: gasta de tu cupo y tarda unos segundos más en empezar a hablar. ${away}`
        : "No encuentro Claude Code (el comando `claude`) en este PC.")
      : `${name}: pago por uso con tu clave. ${away} ${hasKey ? "" : `Consigue tu clave en ${KEY_PAGES[shown]?.hint ?? "su web"} y pégala aquí para elegir modelo.`}`);
}

// ---- her voice: speed and her digital touches ----
const sliders = { velocidad: $<HTMLInputElement>("v-speed"), robot: $<HTMLInputElement>("v-robot"), glitch: $<HTMLInputElement>("v-glitch") };

const voiceList = $("voices"), voiceNote = $("voice-note");
let voice: VoiceInfo | null = null;
const downloading = new Map<string, number>(); // voice -> 0-1

function showVoice(v: VoiceInfo): void {
  voice = v;
  voiceList.innerHTML = v.voces.map((o) => voiceCard(o, o.id === v.voz, downloading.get(o.id))).join("");
  const motor = v.voces.find((o) => o.id === v.voz)?.motor;
  const ownPace = motor === "qwen" || motor === "nube";
  sliders.velocidad.disabled = ownPace;
  voiceNote.className = "note";
  voiceNote.textContent = ownPace ? "Esta voz habla a su ritmo: la velocidad es para las demás." : "Toca una voz para oírla y quedártela.";
  for (const [k, input] of Object.entries(sliders)) {
    input.value = String(v[k as keyof typeof sliders]);
    input.nextElementSibling!.textContent = k === "velocidad" ? `${Number(input.value).toFixed(2)}×` : `${Math.round(Number(input.value) * 100)} %`;
  }
  showCloud(v);
}

const vcService = $<HTMLSelectElement>("vc-service"), vcKey = $<HTMLInputElement>("vc-key"), vcVoice = $<HTMLInputElement>("vc-voice"), vcModel = $<HTMLInputElement>("vc-model"), vcNote = $("vc-note");
const CLOUD_NOTE = "Lo que ella dice va a ese servicio. Usa solo voces que puedas usar: nunca clones a una persona sin su permiso.";
let vcFilled = ""; // the service the boxes show: a voice_info mustn't wipe what he's typing
let vcSaving = false;

const vcPicked = (): CloudVoice | undefined => voice?.nube.find((c) => c.id === vcService.value);

function showCloud(v: VoiceInfo): void {
  if (!vcService.options.length) vcService.innerHTML = v.nube.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join("");
  const c = vcPicked();
  if (!c) return;
  vcKey.placeholder = c.clave ? "Clave guardada (escribe otra para cambiarla)" : "Tu clave";
  vcVoice.placeholder = c.pide_voz ? "ID de tu voz" : "Voz (opcional)";
  vcModel.placeholder = `Modelo: ${c.modelo_base}`;
  if (vcFilled !== c.id) {
    vcFilled = c.id;
    vcVoice.value = c.voz;
    vcModel.value = c.modelo;
    vcKey.value = "";
    vcNote.className = "note";
    vcNote.textContent = `${c.ayuda} ${CLOUD_NOTE}`;
  }
  if (vcSaving) {
    vcSaving = false;
    vcKey.value = "";
    vcNote.className = "note";
    vcNote.textContent = "Listo: funciona. Tócala arriba para que hable con ella.";
  }
}

function sendVoice(probar: boolean): void {
  const n = (k: keyof typeof sliders) => Number(sliders[k].value);
  link.send({ type: "voice_set", velocidad: n("velocidad"), robot: n("robot"), glitch: n("glitch"), voz: "", probar });
}

// ---- her commands: what to type, what to say, the shortcuts, her routines ----
const search = $<HTMLInputElement>("cmd-search"), list = $("cmd-list");
let routines: RoutineInfo[] = [];
let shortcuts: [string, string][] = [];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const COPY_ICON = '<svg viewBox="0 0 24 24"><path d="M9 9h11v11H9zM5 15H4V4h11v1" /></svg>';

const TABS = ["general", "cerebro", "voz", "comandos"];

/** One of the four tabs; the panel opens on the last one (or the one her quick menu asks for). */
function showTab(name: string): void {
  if (!TABS.includes(name)) name = "general";
  document.querySelectorAll<HTMLElement>("#tabs button").forEach((b) => {
    b.classList.toggle("on", b.dataset.tab === name);
    b.setAttribute("aria-selected", String(b.dataset.tab === name));
  });
  document.querySelectorAll<HTMLElement>(".tab").forEach((t) => (t.hidden = t.id !== `tab-${name}`));
  try {
    localStorage.setItem("tab", name);
  } catch {
    // no storage: it opens on General next time
  }
  if (name === "comandos") {
    void invoke<[string, string][]>("shortcuts").then((s) => ((shortcuts = s), renderCommands()));
    link.send({ type: "routines_get" });
    renderCommands();
  }
}

function renderCommands(): void {
  const shown = entries(routines, shortcuts).filter((e) => matches(e, search.value));
  list.innerHTML = SECTIONS.map((s) => {
    const rows = shown.filter((e) => e.seccion === s);
    if (!rows.length) return "";
    return `<section><h2>${s}</h2>${rows.map((e) => `<div class="cmd"><div class="cmd-top">${
      s === "Atajos" ? e.titulo.split("+").map((k) => `<kbd>${esc(k)}</kbd>`).join("+") : `<code>${esc(e.titulo)}</code>`
    }${e.alias.map((a) => `<span class="alias">${esc(a)}</span>`).join("")}</div><small>${esc(e.detalle)}</small>${
      e.copiar ? `<button class="copy" data-copy="${esc(e.copiar)}" title="Copiar">${COPY_ICON}</button>` : ""
    }</div>`).join("")}</section>`;
  }).join("") || '<p class="empty">Nada con eso.</p>';
}
search.addEventListener("input", renderCommands);
void listen<string>("panel-tab", (e) => showTab(e.payload)); // her quick menu: "Comandos", "Más ajustes…"

const link = connect(`${(await invoke<{ ws_url: string }>("config")).ws_url}&panel=1`, (m: ServerMessage) => {
  if (m.type === "voice_info") showVoice(m);
  else if (m.type === "voice_progress") {
    if (m.error && voice?.nube.some((c) => c.id === m.voz)) {
      vcNote.className = "note err";
      vcNote.textContent = m.error;
      return;
    }
    if (m.error) {
      downloading.delete(m.voz);
      voiceNote.className = "note err";
      voiceNote.textContent = m.error;
    } else downloading.set(m.voz, m.total ? m.completado / m.total : 0);
    if (m.error || m.completado >= m.total) downloading.delete(m.voz);
    if (voice && !m.error) showVoice(voice);
  }
  else if (m.type === "routines") {
    routines = m.rutinas;
    renderCommands();
  }
  else if (m.type === "model_info") {
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
}, (up) => {
  if (up) {
    link.send({ type: "model_get" });
    link.send({ type: "voice_get" });
  }
});
void getCurrentWindow().onFocusChanged(({ payload }) => {
  if (payload) {
    link.send({ type: "model_get" });
    link.send({ type: "voice_get" });
  }
});
for (const input of Object.values(sliders)) input.addEventListener("change", () => sendVoice(false));
$("v-try").addEventListener("click", () => sendVoice(true));
voiceList.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const get = t.closest<HTMLElement>("[data-get]")?.dataset.get;
  if (get) {
    if (link.send({ type: "voice_download", voz: get })) downloading.set(get, 0);
    if (voice) showVoice(voice);
    return;
  }
  const card = t.closest<HTMLElement>(".voice.pick:not(.on)");
  if (card) {
    const n = (k: keyof typeof sliders) => Number(sliders[k].value);
    link.send({ type: "voice_set", velocidad: n("velocidad"), robot: n("robot"), glitch: n("glitch"), voz: card.dataset.voice!, probar: true });
  }
});

vcService.addEventListener("change", () => voice && showCloud(voice));
$("vc-web").addEventListener("click", () => {
  const c = vcPicked();
  if (c) void invoke("open_web", { url: c.web }).catch((err) => console.warn("open_web", err));
});
$("vc-save").addEventListener("click", () => {
  if (link.send({ type: "voice_cloud_save", servicio: vcService.value, clave: vcKey.value, voz: vcVoice.value, modelo: vcModel.value })) {
    vcSaving = true;
    vcNote.className = "note";
    vcNote.textContent = "Probando…";
  }
});

prov.addEventListener("click", (e) => {
  const p = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.prov;
  if (p) {
    shown = p === "nube" ? lastCloud : p;
    render("");
  }
});
cloud.addEventListener("change", () => {
  shown = cloud.value;
  render("");
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

try {
  showTab(localStorage.getItem("tab") ?? "general");
} catch {
  showTab("general");
}
