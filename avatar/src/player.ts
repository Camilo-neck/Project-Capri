// The player card she shows for "¿qué suena?": a Cyberpunk-radio plate with the title, a segmented bar and the media keys.
import type { ClientMessage, NowPlaying } from "./net/protocol.ts";

export const SEGMENTS = 24;
const CLOSE_MS = 30_000;

type Timing = Pick<NowPlaying, "posicion" | "duracion" | "sonando">;

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

/** Where the track is `elapsed` seconds after it was read (0 when it has no end). */
export function progress(t: Timing, elapsed: number): number {
  if (t.duracion <= 0) return 0;
  return Math.min(t.duracion, t.posicion + (t.sonando ? elapsed : 0));
}

export interface Player {
  show(t: NowPlaying): void;
  readonly el: HTMLElement;
}

export function mountPlayer(el: HTMLElement, send: (m: ClientMessage) => void): Player {
  const $ = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
  const bar = $("[data-bar]");
  bar.replaceChildren(...Array.from({ length: SEGMENTS }, () => document.createElement("i")));
  const segs = [...bar.children] as HTMLElement[];
  let now: NowPlaying | null = null;
  let readAt = 0;
  let tick = 0;
  let closeTimer = 0;

  const draw = () => {
    if (!now) return;
    const at = progress(now, (performance.now() - readAt) / 1000);
    const lit = now.duracion > 0 ? Math.round((at / now.duracion) * SEGMENTS) : 0;
    segs.forEach((s, i) => s.classList.toggle("on", i < lit));
    $("[data-time]").textContent = now.duracion > 0 ? `${clock(at)} / ${clock(now.duracion)}` : "EN VIVO";
  };
  const close = () => {
    el.hidden = true;
    clearInterval(tick);
    clearTimeout(closeTimer);
  };
  const keepOpen = () => {
    clearTimeout(closeTimer);
    closeTimer = window.setTimeout(close, CLOSE_MS);
  };

  el.addEventListener("mouseenter", () => clearTimeout(closeTimer));
  el.addEventListener("mouseleave", keepOpen);
  el.addEventListener("click", (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>("[data-key]");
    if (key) {
      send({ type: "media_key", accion: key.dataset.key as "play_pausa" | "siguiente" | "anterior" });
      // play/pause flips what the card shows; a new track arrives by asking again
      if (key.dataset.key === "play_pausa" && now) {
        now = { ...now, posicion: progress(now, (performance.now() - readAt) / 1000), sonando: !now.sonando };
        readAt = performance.now();
        el.dataset.playing = String(now.sonando);
        $("[data-state]").textContent = now.sonando ? "SONANDO" : "PAUSA";
        draw();
      }
      return;
    }
    if (!getSelection()?.toString()) close();
  });

  return {
    el,
    show(t) {
      now = t;
      readAt = performance.now();
      $("[data-title]").textContent = t.titulo;
      $("[data-artist]").textContent = t.artista || "—";
      $("[data-app]").textContent = t.app;
      $("[data-state]").textContent = t.sonando ? "SONANDO" : "PAUSA";
      el.dataset.playing = String(t.sonando);
      el.hidden = false;
      draw();
      clearInterval(tick);
      tick = window.setInterval(draw, 500);
      keepOpen();
    },
  };
}
