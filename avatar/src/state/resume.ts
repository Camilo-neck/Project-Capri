// Coming back from sleep (or a long freeze): a wall-clock jump between two ticks of a 1 s interval.
// Pure logic: spotting the jump and picking what she says about it.
import type { Emocion } from "../net/protocol.ts";

export const TICK_MS = 1000;
export const JUMP_MS = 20_000; // a tick this late means the PC was asleep, not just busy
const LONG_MS = 2 * 3_600_000;

export class ResumeWatch {
  private last: number;
  constructor(now: number) {
    this.last = now;
  }
  /** Wall-clock `now`; returns how long the PC was away (ms), or 0 when nothing happened. */
  tick(now: number): number {
    const gap = now - this.last;
    this.last = now;
    return gap >= JUMP_MS ? gap : 0;
  }
}

const SHORT = ["Ya volví. ¿Me extrañaste?", "Uf, me quedé dormida un segundo.", "Aquí sigo. ¿Qué me perdí?"];
const LONG = ["¿Cuánto estuve fuera? Se sintió largo.", "Buenas. Me desconectaste un buen rato, choom.", "Todo en orden por aquí. Tardaste."];

export function resumeLine(gapMs: number, rand: () => number = Math.random): { texto: string; emocion: Emocion } {
  const pool = gapMs >= LONG_MS ? LONG : SHORT;
  return { texto: pool[Math.floor(rand() * pool.length)], emocion: gapMs >= LONG_MS ? "sorprendida" : "traviesa" };
}
