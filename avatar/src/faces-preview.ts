// /faces.html with `npx vite`: her portrait for each emotion, as it sits by her text in the transmission,
// and one caught mid-glitch.
import type { Emocion } from "./net/protocol.ts";
import { CameraView } from "./render/camera.ts";
import { Portrait } from "./render/portrait.ts";
import { faceSquare, portraitFor, SWAP_MS } from "./state/faces.ts";

const EMOTIONS: Emocion[] = ["neutral", "feliz", "emocionada", "traviesa", "curiosa", "pensativa", "sorprendida", "molesta", "triste", "seria"];
const cam = new CameraView(document.createElement("canvas"));
await cam.load();
const grid = document.getElementById("grid")!;

function card(label: string, draw: (p: Portrait) => void): void {
  const fig = document.createElement("figure");
  fig.style.margin = "0";
  fig.innerHTML = `<div class="tx-body"><canvas class="tx-face"></canvas><p class="tx-text">Una respuesta suya de ejemplo, con el texto envolviendo su cara.</p></div><figcaption>${label}</figcaption>`;
  grid.append(fig);
  draw(new Portrait(fig.querySelector("canvas")!));
}

for (const e of EMOTIONS) {
  card(e, (p) => {
    const f = portraitFor(e);
    p.set(e, faceSquare(cam.still(f.shot, f.index)!, f.shot), 0);
    p.draw(SWAP_MS);
  });
}
card("neutral → sorprendida, a mitad del glitch", (p) => {
  const a = portraitFor("neutral"), b = portraitFor("sorprendida");
  p.set("a", faceSquare(cam.still(a.shot, a.index)!, a.shot), 0);
  p.set("b", faceSquare(cam.still(b.shot, b.index)!, b.shot), 1000);
  p.draw(1000 + SWAP_MS / 2);
});
console.log("faces ready");
