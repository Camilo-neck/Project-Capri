// Capri's installer page: boot, options, progress, done; or, run with --uninstall, the removal. The work happens in
// Rust (src-tauri/src/lib.rs), which reports each step ("step"), each line ("log") and the end ("done").
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const win = window.__TAURI__.window.getCurrentWindow();

const $ = (id) => document.getElementById(id);
const chip = $("chip");
const LABELS = {
  copiar: "Copiar la app", python: "Preparar Python", voces: "Sus voces en CPU", ollama: "Instalar Ollama",
  clonada: "Su voz clonada", accesos: "Accesos directos", registro: "Registrar en Windows",
  cerrar: "Cerrarla", alarmas: "Sus alarmas de Windows", app: "Quitar la app", memoria: "Su memoria y configuración",
  modelos: "Sus modelos", claves: "Tus claves de API",
};
let info = null;
let order = []; // the tasks of this run, for the chip's progress
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => (s.hidden = s.id !== id));
  chip.classList.toggle("small", id !== "boot" && id !== "done"); // room for the options and the progress
}

// Capri (the show's art, her idle), on the screens she's on
let frame = 0;
setInterval(() => {
  frame = (frame % 8) + 1;
  for (const img of [$("capri-boot"), $("capri-done")]) img.src = `img/capri_${frame}.png`;
}, reduced ? 1e9 : 110);

async function typeLines(el, lines) {
  for (const [text, cls] of lines) {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    el.append(line);
    for (const ch of text) {
      line.textContent += ch;
      if (!reduced) await new Promise((r) => setTimeout(r, 12));
    }
    if (!reduced) await new Promise((r) => setTimeout(r, 140));
  }
}

async function boot() {
  info = await invoke("info");
  $("ver").textContent = `v${info.version}`;
  if (info.modo === "uninstall") return removal();
  chip.classList.add("slot");
  const host = info.gpu ? `${info.gpu} · ${Math.round(info.vram_mb / 1024)} GB` : "sin GPU NVIDIA";
  const lines = [
    ["> biochip detectado", "dim"],
    [`> constructo: CAPRI · v${info.version}`],
    [`> huésped: ${host} · ${info.libre_gb} GB libres`],
    [info.instalada ? `> ya vive en ${info.instalada}: se actualiza` : "> listo para insertar"],
  ];
  if (!info.payload) lines.push(["> este instalador no trae la app dentro (compílalo con scripts/build_installer.ps1)", "err"]);
  await typeLines($("boot-log"), lines);
  $("to-options").disabled = !info.payload;
  $("to-options").textContent = info.instalada ? "Actualizar" : "Insertar chip";
  $("to-remove").hidden = !info.instalada;
  $("to-options").focus();
}

function options() {
  $("dir").value = info.dir;
  const ollama = $("ollama");
  ollama.checked = !info.ollama;
  ollama.disabled = info.ollama;
  $("opt-ollama").classList.toggle("off", info.ollama);
  $("ollama-note").textContent = info.ollama ? "ya está instalado" : "para un cerebro en tu PC (recomendado con GPU)";
  const voz = $("voz");
  voz.checked = info.clonada;
  voz.disabled = !info.clonada;
  $("opt-voz").classList.toggle("off", !info.clonada);
  $("voz-note").textContent = info.clonada ? `su propia voz, en tu ${info.gpu}` : info.gpu ? `necesita 6 GB de GPU (tienes ${Math.round(info.vram_mb / 1024)})` : "necesita una tarjeta NVIDIA";
  space();
  show("options");
}

function space() {
  const gb = 2.9 + ($("ollama").checked ? 1 : 0) + ($("voz").checked ? 6 : 0);
  const enough = info.libre_gb === 0 || info.libre_gb > gb;
  $("space").textContent = `Necesita unos ${gb.toFixed(1)} GB y descarga casi todo de internet. ${info.libre_gb ? `Tienes ${info.libre_gb} GB libres.` : ""}`;
  $("space").style.color = enough ? "" : "#ff8095";
}

async function install() {
  const opts = {
    dir: $("dir").value.trim(), inicio: $("inicio").checked, escritorio: $("escritorio").checked, arranque: $("arranque").checked,
    ollama: $("ollama").checked && !info.ollama, voz: $("voz").checked && info.clonada,
  };
  order = ["copiar", "python", "voces", ...(opts.ollama ? ["ollama"] : []), ...(opts.voz ? ["clonada"] : []), "accesos", "registro"];
  try {
    await invoke("install", { opts });
  } catch (e) {
    $("dir").classList.add("bad");
    $("space").textContent = String(e);
    $("space").style.color = "#ff8095";
    return;
  }
  info.dir = opts.dir;
  start();
}

function start() {
  $("tasks").innerHTML = order.map((t) => `<li id="t-${t}"><i></i><b>${LABELS[t]}</b><small></small></li>`).join("");
  $("log").textContent = "";
  chip.classList.add("working");
  chip.style.setProperty("--p", "0.03");
  $("close").disabled = true; // not halfway through
  show("progress");
  $("min").focus();
}

listen("step", ({ payload: s }) => {
  const li = $(`t-${s.tarea}`);
  if (!li) return;
  li.className = s.estado;
  li.querySelector("small").textContent = s.detalle;
  const done = order.filter((t) => ["hecha", "fallo"].includes($(`t-${t}`)?.className)).length;
  chip.style.setProperty("--p", String(Math.min(1, (done + (s.estado === "activa" ? 0.4 : 0)) / order.length)));
});

const MAX_LOG = 400;
listen("log", ({ payload: line }) => {
  const log = $("log");
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  // a download's "  name: N MB" replaces its last one instead of piling up
  const last = log.lastChild?.textContent ?? "";
  const key = line.startsWith("  ") ? line.slice(0, line.indexOf(":") + 1) : "";
  if (key && last.startsWith(key)) log.lastChild.textContent = line + "\n";
  else log.append(document.createTextNode(line + "\n"));
  while (log.childNodes.length > MAX_LOG) log.firstChild.remove();
  if (near) log.scrollTop = log.scrollHeight;
});

listen("done", ({ payload: d }) => {
  chip.classList.remove("working");
  $("close").disabled = false;
  chip.style.setProperty("--p", d.ok ? "1" : chip.style.getPropertyValue("--p"));
  const removing = info.modo === "uninstall";
  $("done-title").textContent = removing ? (d.ok ? "Chip extraído" : "Extraído, con avisos") : d.ok ? "Constructo en línea" : "No se pudo instalar";
  $("done-text").textContent = removing
    ? "Capri ya no está en este PC. Hasta pronto."
    : d.ok
      ? "Capri ya vive en tu PC. Al despertar te guiará un minuto para elegir su cerebro y su voz."
      : `Falló: ${d.error}. Revisa tu conexión y vuelve a abrir el instalador: retoma lo que falte.`;
  $("warns").innerHTML = d.avisos.map((a) => `<li>${a.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)}</li>`).join("");
  $("wake").hidden = removing || !d.ok;
  $("capri-done").hidden = removing;
  show("done");
  ($("wake").hidden ? $("close-done") : $("wake")).focus();
});

// ---- uninstalling ----
function removal() {
  $("bar-title").textContent = "extraer el chip";
  chip.style.setProperty("--p", "1");
  show("remove");
}

async function remove() {
  order = ["cerrar", "alarmas", "accesos", "registro", "app", ...["memoria", "modelos", "claves"].filter((k) => $(k).checked)];
  try {
    await invoke("uninstall", { r: { dir: info.dir, memoria: $("memoria").checked, modelos: $("modelos").checked, claves: $("claves").checked } });
  } catch (e) {
    alertLine(String(e));
    return;
  }
  start();
  chip.style.setProperty("--p", "1");
}

function alertLine(text) {
  const p = document.querySelector("#remove .note");
  p.textContent = text;
  p.style.color = "#ff8095";
}

$("to-options").onclick = options;
$("to-remove").onclick = () => {
  info.dir = info.instalada;
  info.modo = "uninstall";
  removal();
};
$("back-boot").onclick = () => show("boot");
$("install").onclick = install;
$("ollama").onchange = space;
$("voz").onchange = space;
$("dir").oninput = () => $("dir").classList.remove("bad");
$("wake").onclick = () => invoke("launch", { dir: info.dir });
$("close-done").onclick = () => invoke("quit");
$("close").onclick = () => invoke("quit");
$("min").onclick = () => win.minimize();
$("do-remove").onclick = remove;
$("cancel-remove").onclick = () => invoke("quit");
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.querySelector("#progress:not([hidden])")) invoke("quit");
});
// the progress of the uninstall counts down the chip
listen("step", () => {
  if (info?.modo === "uninstall") {
    const done = order.filter((t) => $(`t-${t}`)?.className === "hecha").length;
    chip.style.setProperty("--p", String(1 - done / order.length));
  }
});

boot();
