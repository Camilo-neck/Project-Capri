// One of her voices as a card (the panel's Voz tab and the first-run wizard): its name, GPU or CPU, and in use,
// downloading (0-1), a Download button or why this PC can't run it.
import type { VoiceOption } from "./net/protocol.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function voiceCard(o: VoiceOption, chosen: boolean, downloading?: number): string {
  const state = chosen ? '<span class="v-on">En uso</span>'
    : !o.disponible ? ""
    : downloading !== undefined ? `<span class="bar"><i style="width:${Math.round(downloading * 100)}%"></i></span>`
    : o.descargada ? ""
    : o.descargable ? `<button class="mini v-get" data-get="${o.id}">Descargar · ${o.mb} MB</button>`
    : '<span class="v-off">Sin instalar</span>';
  return `<div class="voice${chosen ? " on" : ""}${o.disponible && o.descargada ? " pick" : " off"}" data-voice="${o.id}">
    <div class="v-top"><b>${esc(o.nombre)}</b><span class="tag${o.gpu ? " gpu" : ""}">${o.gpu ? "GPU" : "CPU"}</span>${state}</div>
    <small>${esc(o.disponible ? o.nota : o.motivo)}</small></div>`;
}
