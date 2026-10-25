// Dev-only grid of every emotion and gesture, frozen at a fixed time, for checking the art.
// Open http://localhost:1420/preview.html (?scale=0.5&only=feliz,senalar&cols=4).
import type { Emocion, Gesto } from "./net/protocol.ts";
import { createAvatar } from "./render/avatar.ts";
import { AvatarState, GESTURE_MS } from "./state/avatar.ts";

const EMOCIONES: Emocion[] = ["neutral", "pensativa", "feliz", "emocionada", "sorprendida", "seria", "curiosa", "traviesa", "molesta", "triste"];
const GESTOS: Gesto[] = ["senalar", "cruzar_brazos", "guino"];

const q = new URLSearchParams(location.search);
const scale = Number(q.get("scale") ?? 0.5);
const only = q.get("only")?.split(",");
const grid = document.getElementById("grid")!;
grid.style.setProperty("--cols", q.get("cols") ?? "4");

const T = 100_000; // fixed time: no glitch flash, no blink
const cases: [string, Emocion, Gesto][] = [
  ...EMOCIONES.map((e) => [e, e, "ninguno"] as [string, Emocion, Gesto]),
  ...GESTOS.map((g) => [g, "neutral", g] as [string, Emocion, Gesto]),
];

for (const [label, emo, gesto] of cases) {
  if (only && !only.includes(label)) continue;
  const fig = document.createElement("figure");
  const cap = document.createElement("figcaption");
  cap.textContent = label;
  fig.append(cap);
  grid.append(fig);
  const state = new AvatarState(T, () => 1);
  state.setEmotion(emo, 0);
  if (gesto !== "ninguno") state.playGesture(gesto, T - GESTURE_MS[gesto] / 2);
  const r = await createAvatar(fig, "layers", false, scale);
  r.app.ticker.add(() => r.draw(state.pose(T), T));
}
document.body.dataset.ready = "1";
