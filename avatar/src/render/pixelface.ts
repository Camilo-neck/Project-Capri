// Her pixel-art faces (pet/faces.ts) as stills for the portrait: one 28x28 canvas per emotion, drawn once,
// with a violet silhouette of it for the misregistered copy behind it.
import type { Emocion } from "../net/protocol.ts";
import { FACE_PALETTE, faceGrid, SIZE } from "../pet/faces.ts";
import type { Still } from "./fx.ts";

const cache = new Map<Emocion, Still>();
const VIOLET = "#8b38ff";

export function pixelStill(e: Emocion): Still {
  let still = cache.get(e);
  if (!still) {
    const face = document.createElement("canvas");
    const shadow = document.createElement("canvas");
    face.width = face.height = shadow.width = shadow.height = SIZE;
    const g = face.getContext("2d")!, s = shadow.getContext("2d")!;
    s.fillStyle = VIOLET;
    faceGrid(e).forEach((row, y) => [...row].forEach((c, x) => {
      if (c === ".") return;
      g.fillStyle = FACE_PALETTE[c];
      g.fillRect(x, y, 1, 1);
      s.fillRect(x, y, 1, 1);
    }));
    still = { img: face, sx: 0, sy: 0, sw: SIZE, sh: SIZE, shadow };
    cache.set(e, still);
  }
  return still;
}
