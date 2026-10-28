// Back at the PC: he left it alone for a while (no keyboard or mouse) and now touched it again. She
// wakes up if she was asleep and says something about it. Pure logic: spotting the return and picking
// what she says (main.ts wires it to the idle time the backend window reads every second).
import type { Emocion } from "../net/protocol.ts";

export const AWAY_MS = 10 * 60_000; // gone at least this long for it to count
const MID_MS = 30 * 60_000;
const LONG_MS = 2 * 3_600_000;

export class AwayWatch {
  private longest = 0; // the idle time this absence reached so far

  /** `idleMs`: time since his last input. Returns how long he was gone when he just came back, else 0. */
  tick(idleMs: number): number {
    if (idleMs >= this.longest) {
      this.longest = idleMs;
      return 0;
    }
    const gone = this.longest;
    this.longest = idleMs;
    return gone >= AWAY_MS ? gone : 0;
  }

  /** Forget this absence (the PC woke from sleep: that has its own greeting). */
  reset(): void {
    this.longest = 0;
  }
}

const SHORT = ["¿Ya volviste?", "Te tardaste, ¿eh?", "Ah, ahí estás.", "Volviste. Aquí te cuidé el escritorio."];
const MID = ["Por fin. Me estaba aburriendo aquí sola.", "Mira quién volvió.", "Ya era hora, choom.", "Te fuiste un buen rato. ¿Todo bien?"];
const LONG = ["¿Cuánto estuviste fuera? Casi me apago de verdad.", "Buenas. Pensé que te habías olvidado de mí.",
  "Volviste. El PC estaba muy callado sin ti.", "Horas sin verte. ¿Qué me cuentas?"];
const NIGHT = ["¿Todavía despierto?", "Es tardísimo. ¿No duermes?", "Volviste a estas horas… yo también soy noctámbula.",
  "Shh, que es de madrugada. ¿Qué haces despierto?"];

/** What she says when he's back after `goneMs`, at `hour` (0-23); `claude` is the project Claude finished meanwhile. */
export function backLine(goneMs: number, hour: number, claude: string | null, last: string,
                         rand: () => number = Math.random): { texto: string; emocion: Emocion } {
  const night = hour < 6;
  const pool = (night ? NIGHT : goneMs >= LONG_MS ? LONG : goneMs >= MID_MS ? MID : SHORT).filter((t) => t !== last);
  const texto = pool[Math.floor(rand() * pool.length)] + (claude ? ` Ah, y Claude terminó lo de ${claude}.` : "");
  return { texto, emocion: night ? "curiosa" : goneMs >= LONG_MS ? "sorprendida" : "traviesa" };
}

export interface Quiet {
  hiding: boolean; // put away (/escondete)
  dnd: boolean; // do not disturb
  fullscreen: boolean; // a game or video in front
  moving: boolean; // teleporting, falling, dragged, possessing a window
  down: boolean; // no backend
}

/** She only says it when nothing asks her to keep quiet (she still wakes up). */
export function speaksOnBack(q: Quiet): boolean {
  return !(q.hiding || q.dnd || q.fullscreen || q.moving || q.down);
}
