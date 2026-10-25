export type Mouth = "A" | "E" | "O" | "closed";

const VOWELS: Record<string, Mouth> = { a: "A", e: "E", i: "E", o: "O", u: "O" };

/** Mouth shape for a revealed character; null keeps the current one. */
export function mouthFor(ch: string): Mouth | null {
  const base = ch.normalize("NFD")[0]?.toLowerCase() ?? "";
  if (base in VOWELS) return VOWELS[base];
  if (/[\s.,;:!?¡¿…"'()\-—]/.test(ch)) return "closed";
  return null;
}

/** Reveals pushed text at a fixed rate. */
export class Typewriter {
  private queue: string[] = [];
  private budget = 0;
  readonly cps: number;

  constructor(cps = 50) {
    this.cps = cps;
  }

  push(text: string): void {
    this.queue.push(...Array.from(text)); // code points, so emoji are not split
  }

  clear(): void {
    this.queue = [];
    this.budget = 0;
  }

  get pending(): boolean {
    return this.queue.length > 0;
  }

  /** Advances dtMs and returns the newly revealed characters. */
  tick(dtMs: number): string {
    if (!this.queue.length) {
      this.budget = 0;
      return "";
    }
    this.budget += (dtMs * this.cps) / 1000;
    const n = Math.min(Math.floor(this.budget), this.queue.length);
    this.budget -= n;
    return this.queue.splice(0, n).join("");
  }
}
