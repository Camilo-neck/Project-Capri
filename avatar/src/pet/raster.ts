// Pixel post-processing on raw RGBA buffers (no DOM, so it is unit-testable).
// Canvas shapes come out anti-aliased; these turn them into hard-edged, outlined pixel art.

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Hard edges: alpha becomes 0 or 255, and each kept pixel snaps to the nearest palette color. */
export function crisp(data: Uint8ClampedArray, palette: RGB[], cutoff = 110): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < cutoff) {
      data[i + 3] = 0;
      continue;
    }
    data[i + 3] = 255;
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const [r, g, b] = palette[k];
      const d = (data[i] - r) ** 2 + (data[i + 1] - g) ** 2 + (data[i + 2] - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    [data[i], data[i + 1], data[i + 2]] = palette[best];
  }
}

/** Adds a 1 px outline: transparent pixels touching an opaque one (4-neighborhood) get the color. */
export function outline(data: Uint8ClampedArray, w: number, h: number, color: RGB): void {
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = data[i * 4 + 3] > 0 ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      const touches =
        (x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w]);
      if (touches) {
        [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]] = color;
        data[i * 4 + 3] = 255;
      }
    }
  }
}

/** Copies opaque pixels of src over dst (same size). */
export function over(dst: Uint8ClampedArray, src: Uint8ClampedArray): void {
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) continue;
    if (src[i + 3] === 255) {
      dst[i] = src[i];
      dst[i + 1] = src[i + 1];
      dst[i + 2] = src[i + 2];
      dst[i + 3] = 255;
      continue;
    }
    // translucent pixels (only the ground shadow): plain alpha blend
    const a = src[i + 3] / 255;
    const da = dst[i + 3] / 255;
    const oa = a + da * (1 - a);
    for (let c = 0; c < 3; c++) dst[i + c] = (src[i + c] * a + dst[i + c] * da * (1 - a)) / oa;
    dst[i + 3] = oa * 255;
  }
}

/** Short glitch: shifts some rows sideways and splits red/blue, like the show's static. */
export function glitch(data: Uint8ClampedArray, w: number, h: number, amount: number, seed: number): void {
  if (amount <= 0) return;
  const copy = data.slice();
  const shift = Math.round(2 * amount);
  for (let y = 0; y < h; y++) {
    const band = Math.floor(y / 3);
    const r = Math.abs(Math.sin((band + seed) * 12.9898) * 43758.5453) % 1;
    const dx = r > 0.7 ? Math.round((r - 0.85) * 20 * amount) : 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const sx = Math.min(w - 1, Math.max(0, x - dx));
      const j = (y * w + sx) * 4;
      const jr = (y * w + Math.min(w - 1, Math.max(0, sx + shift))) * 4;
      const jb = (y * w + Math.min(w - 1, Math.max(0, sx - shift))) * 4;
      data[i] = copy[jr];
      data[i + 1] = copy[j + 1];
      data[i + 2] = copy[jb + 2];
      data[i + 3] = Math.max(copy[j + 3], copy[jr + 3], copy[jb + 3]);
    }
  }
}
