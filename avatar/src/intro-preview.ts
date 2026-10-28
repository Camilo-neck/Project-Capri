// /intro.html with `npx vite`: her intro over a stand-in desktop, landing on the white ring
// (`?still`: as with Windows' animations off). A click while it plays skips it. `?at=1500` freezes
// it that many ms in, for screenshots.
import { Fx } from "./render/fx.ts";
import { IntroView } from "./render/intro.ts";

const fx = new Fx(document.getElementById("fx") as HTMLCanvasElement);
const view = new IntroView(document.getElementById("intro") as HTMLCanvasElement, {
  burst: (x, y, size) => fx.burst(x, y, size, false),
  crackle: (x, y, r, life) => fx.crackle(() => ({ x, y, r }), () => true, life),
  rush: (x, y) => fx.rush(x, y),
});
const spot = document.getElementById("spot")!;
const to = { x: innerWidth - 160, y: innerHeight - 190, size: 90 };
spot.style.left = `${to.x}px`;
spot.style.top = `${to.y}px`;

async function play(): Promise<void> {
  const t0 = performance.now();
  await view.play({ to, label: "¡HOLA!", caption: "CAPRI · PROJECT CAPRICORN", still: new URLSearchParams(location.search).has("still") });
  fx.burst(to.x, to.y, 120, true); // where her body would come together
  console.log(`intro landed in ${Math.round(performance.now() - t0)} ms`);
}

addEventListener("click", (e) => {
  if (view.playing) view.skip();
  else if ((e.target as HTMLElement).id === "again") void play();
});
const at = new URLSearchParams(location.search).get("at");
if (at !== null) view.freezeAt = Number(at); // every frame draws that moment
void view.load().then((ok) => {
  console.log("intro loaded", ok);
  if (ok) void play();
});
