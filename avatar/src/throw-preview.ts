// /throw.html with `npx vite`: one throw worked out by state/throw.ts, drawn as her path (a dot every
// 50 ms, the ledge she bounces off), with the crack where she hits the glass and the stars where she lands.
import { Fx } from "./render/fx.ts";
import { type Flight, launch, step } from "./state/throw.ts";

const fx = new Fx(document.getElementById("fx") as HTMLCanvasElement);
const c = document.getElementById("path") as HTMLCanvasElement;
c.width = innerWidth;
c.height = innerHeight;
const g = c.getContext("2d")!;
const bounds = { left: 60, right: innerWidth - 60, top: 120, floor: innerHeight - 60 };
const ledges = [{ id: 1, x1: innerWidth * 0.55, x2: innerWidth * 0.9, y: innerHeight * 0.55 }];
g.fillStyle = "#cfd8e3";
g.fillRect(ledges[0].x1, ledges[0].y, ledges[0].x2 - ledges[0].x1, 6); // a window's top edge
g.fillStyle = "#1b1f27";
g.fillRect(0, bounds.floor, innerWidth, innerHeight - bounds.floor); // the taskbar

let f: Flight | null = { ...launch({ x: 300, y: 500 }, { vx: 2.2, vy: -1.1 }), spin: 0.004 };
for (let t = 0; f && t < 6000; t += 16) {
  const r = step(f, 16, bounds, ledges, t);
  if (f && t % 48 === 0) {
    g.fillStyle = f.stuck > 0 ? "#ff2152" : "#ffffff";
    g.fillRect(f.x - 3, f.y - 3, 6, 6);
  }
  if (r.hit) {
    console.log(`${t} ms: ${r.hit.kind}${"side" in r.hit ? ` (${r.hit.side})` : ""}`);
    if (r.hit.kind === "wall") fx.crack(r.hit.side === "right" ? innerWidth - 16 : r.hit.side === "left" ? 16 : r.hit.x, r.hit.side === "top" ? 16 : r.hit.y - 60, 60_000);
    if (r.hit.kind === "flat" || r.hit.kind === "feet") {
      const at = { x: r.hit.x, y: r.hit.y - 50 };
      fx.stars(() => at, 60_000);
      g.fillStyle = "#36ff7a";
      g.fillRect(r.hit.x - 6, r.hit.y - 6, 12, 12);
    }
  }
  f = r.flight;
}
