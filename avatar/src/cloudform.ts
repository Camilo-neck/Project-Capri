// Her voice from a service he picked (the panel's Voz tab and the first-run wizard): the service, his key, the voice
// and the model. The backend saves them and tries a short line; the key never comes back here.
import type { ClientMessage, CloudVoice, VoiceInfo } from "./net/protocol.ts";

const NOTE = "Lo que ella dice va a ese servicio. Usa solo voces que puedas usar: nunca clones a una persona sin su permiso.";

export interface CloudForm {
  show(v: VoiceInfo): void;
  /** A failure of one of its services: shown here. False if `voz` isn't one of them. */
  error(voz: string, message: string): boolean;
}

export function cloudForm(root: HTMLElement, send: (m: ClientMessage) => boolean, open: (url: string) => void): CloudForm {
  root.className = "cloud-form";
  root.innerHTML = `<select class="field-input" data-f="service" aria-label="Servicio de voz"></select>
    <input class="field-input" data-f="key" type="password" autocomplete="off" spellcheck="false" aria-label="Clave" />
    <input class="field-input" data-f="voice" spellcheck="false" aria-label="Voz" />
    <input class="field-input" data-f="model" spellcheck="false" aria-label="Modelo" />
    <div class="field"><button type="button" class="mini" data-f="web">Conseguir clave</button><button type="button" class="mini" data-f="save">Guardar y probar</button></div>
    <small class="note" data-f="note"></small>`;
  const $ = <T extends HTMLElement>(f: string) => root.querySelector<T>(`[data-f="${f}"]`)!;
  const service = $<HTMLSelectElement>("service"), key = $<HTMLInputElement>("key"), voice = $<HTMLInputElement>("voice"), model = $<HTMLInputElement>("model"), note = $("note");
  let services: CloudVoice[] = [];
  let filled = ""; // the service the boxes show: a voice_info mustn't wipe what he's typing
  let saving = false;

  const say = (text: string, err = false) => {
    note.className = err ? "note err" : "note";
    note.textContent = text;
  };
  const picked = () => services.find((c) => c.id === service.value);
  const show = () => {
    if (!service.options.length) service.innerHTML = services.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join("");
    const c = picked();
    if (!c) return;
    key.placeholder = c.clave ? "Clave guardada (escribe otra para cambiarla)" : "Tu clave";
    voice.placeholder = c.pide_voz ? "ID de tu voz" : "Voz (opcional)";
    model.placeholder = `Modelo: ${c.modelo_base}`;
    if (filled !== c.id) {
      filled = c.id;
      voice.value = c.voz;
      model.value = c.modelo;
      key.value = "";
      say(`${c.ayuda} ${NOTE}`);
    }
    if (saving) {
      saving = false;
      key.value = "";
      say("Listo: funciona. Tócala en la lista para que hable con ella.");
    }
  };

  service.addEventListener("change", show);
  $("web").addEventListener("click", () => {
    const c = picked();
    if (c) open(c.web);
  });
  $("save").addEventListener("click", () => {
    if (send({ type: "voice_cloud_save", servicio: service.value, clave: key.value, voz: voice.value, modelo: model.value })) {
      saving = true;
      say("Probando…");
    }
  });

  return {
    show(v) {
      services = v.nube;
      show();
    },
    error(voz, message) {
      if (!services.some((c) => c.id === voz)) return false;
      saving = false;
      say(message, true);
      return true;
    },
  };
}
