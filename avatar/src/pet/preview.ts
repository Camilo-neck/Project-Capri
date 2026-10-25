// Dev page (http://localhost:1420/preview.html). Default: documented sprite sheet with sampled
// frames of every behavior. ?live: every behavior animating. ?only=feliz,triste to filter.
import { BEHAVIORS, overlay, type Behavior } from "./behaviors.ts";
import { Painter } from "./draw.ts";
import { GROUND, H, W, type EyeKind, type MouthKind } from "./rig.ts";
import { eyeStamp, MOUTHS, PALETTE, type Stamp } from "./stamps.ts";

const q = new URLSearchParams(location.search);
const only = q.get("only")?.split(",");
const root = document.getElementById("root")!;
const names = (Object.keys(BEHAVIORS) as Behavior[]).filter((n) => !only || only.includes(n));
const ctx = { look: [0, 0] as [number, number], petSide: 1 };
const noOverlay = { gesto: "ninguno" as const, gestureT: 0, mouth: null, blinking: false };

function frameCanvas(name: Behavior, t: number, scale: number): HTMLCanvasElement {
  const painter = new Painter();
  const def = BEHAVIORS[name];
  painter.paint(overlay(def.pose(t, ctx), def, noOverlay), t);
  return upscale(painter.canvas, scale);
}

function upscale(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width * scale;
  c.height = src.height * scale;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  ledge(g, scale);
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** The taskbar edge she sits on, for context (not part of the sprite). */
function ledge(g: CanvasRenderingContext2D, scale: number): void {
  g.fillStyle = "#b9b5c2";
  g.fillRect(0, (GROUND + 1) * scale, W * scale, (H - GROUND) * scale);
}

function stampCanvas(s: Stamp, scale: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 8 * scale;
  c.height = 7 * scale;
  const g = c.getContext("2d")!;
  s.forEach((row, y) => row.split("").forEach((ch, x) => {
    if (ch === ".") return;
    g.fillStyle = PALETTE[ch];
    g.fillRect((x + 1) * scale, (y + 1) * scale, scale, scale);
  }));
  return c;
}

const h = (tag: string, text = "", cls = "") => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

if (q.has("live")) {
  const grid = h("div", "", "live");
  root.append(h("h1", "Capri · animaciones en vivo"), grid);
  const items = names.map((name) => {
    const fig = h("figure");
    const painter = new Painter();
    const view = document.createElement("canvas");
    view.width = W * 3;
    view.height = H * 3;
    fig.append(view, h("figcaption", `${name} · ${BEHAVIORS[name].title}`));
    grid.append(fig);
    return { name, painter, view };
  });
  const start = performance.now();
  const tick = () => {
    const t = performance.now() - start;
    const tq = Math.floor(t / 50) * 50; // 20 fps, like the app
    for (const { name, painter, view } of items) {
      const def = BEHAVIORS[name];
      const local = def.duration ? tq % (def.duration + 600) : tq;
      painter.paint(overlay(def.pose(Math.min(local, def.duration ?? Infinity), ctx), def, noOverlay), tq);
      const g = view.getContext("2d")!;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, view.width, view.height);
      ledge(g, 3);
      g.drawImage(painter.canvas, 0, 0, view.width, view.height);
    }
    requestAnimationFrame(tick);
  };
  tick();
} else {
  root.append(
    h("h1", "Capri · hoja de sprites"),
    h("p", "Mascota en pixel art generada por código (avatar/src/pet). Lienzo nativo 80×96 px, en pantalla ×3, a 20 fps. Cada fila muestra fotogramas de una animación a lo largo de su ciclo; los cambios entre estados se mezclan en 320 ms.", "lead"),
  );
  const FRAMES = 6;
  for (const name of names) {
    const def = BEHAVIORS[name];
    const row = h("div", "", "row");
    const info = h("div");
    info.append(h("h2", def.title), h("div", name, "id"), h("div", def.trigger + (def.duration ? "" : " · bucle"), "trig"));
    const frames = h("div", "", "frames");
    const span = def.duration ?? 2400;
    for (let k = 0; k < FRAMES; k++) {
      const t = Math.round((k * span) / FRAMES) + 60;
      const fig = h("figure");
      fig.append(frameCanvas(name, t, Number(q.get("scale") ?? 2)), h("figcaption", `${t} ms`));
      frames.append(fig);
    }
    row.append(info, frames);
    root.append(row);
  }
  // Face parts
  const eyes: EyeKind[] = ["open", "closed", "relaxed", "happy", "wink", "heart", "spiral", "star", "wide", "angry", "sad", "focused", "up"];
  const mouths = Object.keys(MOUTHS) as MouthKind[];
  for (const [title, list] of [["Ojos", eyes], ["Bocas", mouths]] as const) {
    const row = h("div", "", "row");
    const legend = h("div", "", "legend");
    for (const k of list) {
      const s = title === "Ojos" ? eyeStamp(k as EyeKind, -1, [0, 0]) : MOUTHS[k as MouthKind];
      const fig = h("figure");
      fig.append(stampCanvas(s, 5), h("figcaption", k));
      legend.append(fig);
    }
    const info = h("div");
    info.append(h("h2", title), h("div", title === "Ojos" ? "Sellos de 6×6; los abiertos siguen al ratón" : "Al hablar, A/E/O/closed siguen las vocales del texto", "trig"));
    row.append(info, legend);
    root.append(row);
  }
}
document.body.dataset.ready = "1";
