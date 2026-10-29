// Camera mode's frame, resized from its corners: it keeps the shots' 3:2 and grows evenly about her spot (its
// bottom stays on her ledge), so a corner dragged out by dx widens it by 2·dx and one dragged up by dy heightens
// it by dy. Whichever movement is bigger wins; the width stays within CAM_MIN..CAM_MAX.

export const CAM_MIN = 240;
export const CAM_MAX = 600;
export const CAM_DEFAULT = 336;
const RATIO = 1.5;

export type Corner = "tl" | "tr" | "bl" | "br";

export function camWidth(w: number): number {
  return Number.isFinite(w) ? Math.round(Math.min(CAM_MAX, Math.max(CAM_MIN, w))) : CAM_DEFAULT;
}

export function camHeight(w: number): number {
  return Math.round(w / RATIO);
}

/** The new width after dragging `corner` by (dx, dy) px from where it was grabbed at width `w`. */
export function camResize(w: number, corner: Corner, dx: number, dy: number): number {
  const byX = 2 * dx * (corner[1] === "r" ? 1 : -1);
  const byY = dy * (corner[0] === "t" ? -1 : 1) * RATIO;
  return camWidth(w + (Math.abs(byX) >= Math.abs(byY) ? byX : byY));
}
