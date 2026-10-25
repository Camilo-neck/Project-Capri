// Her mask, what she is at heart in the show once the mane and the body are gone: a green slab of a
// face with a hooked spike rising from it, two eyes (ink almonds, green ring, blue iris, white pupil
// turned toward `look`) and a white fang under it, all over a violet copy. Shapes from
// mochiiwuff/capri-desktop (fx.js drawMask). In the pixel style it's drawn small and scaled up
// with hard pixels, like the rest of her.
import type { Eyes } from "../state/doze.ts";

const C = { green: "#36ff7a", ink: "#14101c", violet: "#7b3dff", paper: "#fff4f6", blue: "#3d6bff" };
type Pt = [number, number];

const MASK: { face: Pt[]; spike: Pt[]; fang: Pt[]; eyes: Pt[] } = {
  face: [[-48, -20], [-12, -22], [48, -26], [46, 20], [-45, 23]],
  spike: [[-32, -20], [-37, -50], [-22, -63], [6, -67], [24, -75], [34, -99], [49, -90], [44, -66], [30, -48], [2, -42], [-10, -40], [-12, -21]],
  fang: [[-6, 22], [1, 27], [8, 22], [13, 26], [22, 21], [8, 52]],
  eyes: [[-23, 0], [22, -3]],
};

/** Extent of the mask around its face center, at scale 1. */
export const MASK_BOX = { left: -52, top: -102, right: 54, bottom: 55 };

export interface MaskLook {
  eyes: Eyes;
  look?: { x: number; y: number } | null; // where the pupils turn, same coordinates as (x, y)
  flat?: string | null; // one colour for all of it (the landing frame)
}

/** Draws the mask with its face center at (x, y); k = scale (1: about 100 px wide). */
export function drawMask(g: CanvasRenderingContext2D, x: number, y: number, k: number, { eyes, look = null, flat = null }: MaskLook): void {
  const poly = (pts: Pt[], dx = 0, dy = 0) => {
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)));
    g.closePath();
  };
  const shapes = [MASK.spike, MASK.face, MASK.fang];
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.lineJoin = "miter";
  g.fillStyle = flat ?? C.violet;
  for (const s of shapes) {
    poly(s, 3, 3);
    g.fill();
  }
  if (flat) {
    for (const s of shapes) {
      poly(s);
      g.fill();
    }
    g.restore();
    return;
  }
  g.fillStyle = C.green;
  poly(MASK.spike);
  g.fill();
  poly(MASK.face);
  g.fill();
  poly(MASK.fang);
  g.fillStyle = C.paper;
  g.fill();
  g.strokeStyle = C.green;
  g.lineWidth = 2.2;
  g.stroke();
  MASK.eyes.forEach(([ex, ey], i) => {
    const o = eyes[i];
    if (o < 0.15) {
      // shut: a thick sleepy curve
      g.beginPath();
      g.moveTo(ex - 15, ey - 4);
      g.lineTo(ex, ey + 5);
      g.lineTo(ex + 15, ey - 4);
      g.strokeStyle = C.ink;
      g.lineWidth = Math.max(4.5, 1.2 / k); // at least a whole pixel when drawn small
      g.stroke();
      return;
    }
    let px = 0, py = 0;
    if (look) {
      const lx = (look.x - x) / k - ex, ly = (look.y - y) / k - ey;
      const d = Math.hypot(lx, ly) || 1;
      // the pupils turn at least ~2 screen px, or a small mask would seem not to look
      px = (lx / d) * Math.max(2.6, 2 / k);
      py = (ly / d) * Math.max(2.2, 1.7 / k);
    }
    g.save();
    g.translate(ex, ey);
    g.scale(1, o);
    g.beginPath(); // an almond of ink
    g.moveTo(-19, 0);
    g.quadraticCurveTo(0, -24, 19, 0);
    g.quadraticCurveTo(0, 24, -19, 0);
    g.fillStyle = C.ink;
    g.fill();
    const disk = (dx: number, dy: number, r: number, color: string) => {
      g.beginPath();
      g.arc(dx, dy, r, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
    };
    disk(px * 0.4, py * 0.4, 10.5, C.green);
    disk(px * 0.4, py * 0.4, 8.8, C.ink);
    disk(px * 0.7, py * 0.7, 7.6, C.blue);
    g.beginPath();
    g.ellipse(px, py, 3, 4, 0, 0, Math.PI * 2);
    g.fillStyle = C.paper;
    g.fill();
    g.restore();
  });
  g.restore();
}

/** The mask on its own little canvas, placed by its face center in page px. */
export class MaskView {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly small = document.createElement("canvas");
  private readonly k: number;
  private readonly pad = 6;
  center = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, k: number) {
    this.canvas = canvas;
    this.k = k;
    this.canvas.width = Math.ceil((MASK_BOX.right - MASK_BOX.left) * k) + 2 * this.pad;
    this.canvas.height = Math.ceil((MASK_BOX.bottom - MASK_BOX.top) * k) + 2 * this.pad;
    this.g = this.canvas.getContext("2d")!;
    this.canvas.hidden = true;
  }

  /** Face center inside the canvas. */
  private get origin(): Pt {
    return [this.pad - MASK_BOX.left * this.k, this.pad - MASK_BOX.top * this.k];
  }

  /** Page box of the canvas: [x, y, w, h]. */
  box(): [number, number, number, number] {
    const [ox, oy] = this.origin;
    return [this.center.x - ox, this.center.y - oy, this.canvas.width, this.canvas.height];
  }

  show(visible: boolean): void {
    this.canvas.hidden = !visible;
  }

  /** `px` > 1 draws it `px` times smaller and scales it back up with hard pixels. */
  draw(look: MaskLook, { bob = 0, shake = 0, px = 1 } = {}): void {
    const [bx, by] = this.box();
    this.canvas.style.transform = `translate(${Math.round(bx + shake)}px, ${Math.round(by + bob)}px)`;
    const [ox, oy] = this.origin;
    const g = this.g;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const pageLook = look.look && { x: look.look.x - bx, y: look.look.y - by };
    if (px <= 1) {
      drawMask(g, ox, oy, this.k, { ...look, look: pageLook });
      return;
    }
    const s = this.small;
    s.width = Math.ceil(this.canvas.width / px);
    s.height = Math.ceil(this.canvas.height / px);
    const sg = s.getContext("2d")!;
    sg.clearRect(0, 0, s.width, s.height);
    drawMask(sg, ox / px, oy / px, this.k / px, { ...look, look: pageLook && { x: pageLook.x / px, y: pageLook.y / px } });
    // hard pixels: each one fully there or not (no see-through antialiased edges)
    const img = sg.getImageData(0, 0, s.width, s.height);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] < 110 ? 0 : 255;
    sg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(s, 0, 0, s.width * px, s.height * px);
  }
}
