// How she takes what she feels in the PC (backend pcsense.py): what she says, how she looks, and the
// effect on her. Pure logic; main.ts plays it (and keeps her quiet on do-not-disturb).
import type { Emocion, PcEvent } from "../net/protocol.ts";

export type PcFx = "heat" | "bolt" | "sag" | "hurt" | "dive" | null;
export interface PcReaction {
  texto: string;
  emocion: Emocion;
  fx: PcFx; // heat off her mane, a bolt toward the clock, sagging, a hit, diving into the stick
  hide?: boolean; // a game started: she puts herself away while he plays
  unhide?: boolean; // and comes back when it's over
}

const pick = (lines: string[], rand: () => number) => lines[Math.floor(rand() * lines.length)];

const DEVICE: Record<string, [string[], Emocion]> = {
  phone: [["Hola, teléfono.", "¿Un teléfono? ¿Me vas a pasar fotos?"], "curiosa"],
  controller: [["¿Un mando? ¿Vamos a jugar?", "Mando conectado. Esto se pone bueno."], "emocionada"],
  audio: [["Buenos audífonos. ¿Qué vas a escuchar?", "Audio nuevo. Que suene bien."], "feliz"],
  camera: [["¿Una cámara? Sonríe.", "Cámara conectada. Yo salgo de mi lado bueno."], "traviesa"],
};

export function reaction(e: PcEvent, rand: () => number = Math.random): PcReaction | null {
  const [what, ...rest] = e.detalle.split(":");
  const name = rest.join(":");
  switch (e.tipo) {
    case "caliente":
      return { texto: pick(["Uf, me estoy cocinando aquí dentro.", "¿Qué estás corriendo? Me sudan los circuitos.", "Hace un calor aquí dentro…"], rand), emocion: "molesta", fx: "heat" };
    case "cargador":
      return e.detalle === "on"
        ? { texto: pick(["Mmm, energía.", "Enchufada. Mucho mejor."], rand), emocion: "feliz", fx: "bolt" }
        : { texto: pick(["¿Me desenchufas? Atrevido.", "Eh, ¿y mi cargador?"], rand), emocion: "sorprendida", fx: "bolt" };
    case "bateria":
      return { texto: e.detalle === "10" ? "¡Diez por ciento! Me estoy apagando…" : pick(["Me queda poquita batería…", "Batería al 20. Ve buscando el cargador."], rand), emocion: "triste", fx: "sag" };
    case "red":
      return e.detalle === "caida"
        ? { texto: pick(["¡Ay! Se cayó internet.", "Me quedé sin red. Qué silencio."], rand), emocion: "sorprendida", fx: "hurt" }
        : { texto: pick(["¡Volvió la red!", "Ya hay internet otra vez."], rand), emocion: "feliz", fx: null };
    case "usb":
      return { texto: e.detalle, emocion: "curiosa", fx: "dive" };
    case "dispositivo": {
      const [lines, emocion] = DEVICE[what] ?? [[`Conectaste ${name}. A ver qué es.`], "curiosa" as Emocion];
      return { texto: pick(lines, rand), emocion, fx: "bolt" };
    }
    case "juego":
      return what === "inicio"
        ? { texto: pick([`¿${name}? Suerte. Me escondo mientras juegas.`, `${name}, ¿eh? Dale duro, yo no molesto.`], rand), emocion: "emocionada", fx: null, hide: true }
        : { texto: pick([`¿Qué tal ${name}? ¿Ganaste?`, `¿Y? ¿Ganaste en ${name}?`], rand), emocion: "curiosa", fx: null, unhide: true };
  }
  return null;
}
