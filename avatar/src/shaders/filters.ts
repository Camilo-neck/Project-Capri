import { defaultFilterVert, Filter, GlProgram } from "pixi.js";

function make(name: string, fragment: string, uniforms: Record<string, { value: number | number[]; type: string }>): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name }),
    resources: { u: uniforms },
  });
}

const HEADER = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize; // must match the default vertex shader's precision
`;

/** RGB split plus displaced horizontal slices; uAmount 0 = off. */
export function glitchFilter(): Filter {
  return make("glitch", /* glsl */ `${HEADER}
uniform float uAmount;
uniform float uSeed;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 uv = vTextureCoord;
  float band = floor(uv.y * uInputSize.y / 12.0);
  if (hash(band + uSeed) > 0.75) uv.x += (hash(band * 1.7 + uSeed) - 0.5) * 0.08 * uAmount;
  vec2 off = vec2(6.0 * uAmount * uInputSize.z, 0.0);
  vec4 c = texture(uTexture, uv);
  vec4 r = texture(uTexture, uv + off);
  vec4 b = texture(uTexture, uv - off);
  finalColor = vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));
}`, { uAmount: { value: 0, type: "f32" }, uSeed: { value: 0, type: "f32" } });
}

/** Style prototype: low-res pixel art look. */
export function pixelFilter(cell = 6): Filter {
  return make("pixel", /* glsl */ `${HEADER}
uniform float uCell;
void main() {
  vec2 px = vTextureCoord * uInputSize.xy;
  vec2 snapped = (floor(px / uCell) + 0.5) * uCell;
  finalColor = texture(uTexture, snapped * uInputSize.zw);
}`, { uCell: { value: cell, type: "f32" } });
}

/** Style prototype: ASCII art, 5x5 glyphs packed as bitmasks, picked by brightness. */
export function asciiFilter(cell = 8): Filter {
  return make("ascii", /* glsl */ `${HEADER}
uniform float uCell;
// Float math instead of bit ops: Pixi may compile this as GLSL ES 1.0. highp keeps 25-bit masks exact.
float glyph(highp float n, vec2 p) {
  p = floor(p * vec2(-4.0, 4.0) + 2.5);
  if (clamp(p.x, 0.0, 4.0) == p.x && clamp(p.y, 0.0, 4.0) == p.y) {
    highp float a = p.x + 5.0 * p.y;
    return mod(floor(n / exp2(a)), 2.0);
  }
  return 0.0;
}
void main() {
  vec2 px = vTextureCoord * uInputSize.xy;
  vec2 center = (floor(px / uCell) + 0.5) * uCell;
  vec4 col = texture(uTexture, center * uInputSize.zw);
  if (col.a < 0.05) { finalColor = vec4(0.0); return; }
  vec3 rgb = col.rgb / col.a;
  float g = dot(rgb, vec3(0.3, 0.59, 0.11));
  highp float n = 4096.0;                 // .
  if (g > 0.2) n = 65600.0;       // :
  if (g > 0.3) n = 332772.0;      // *
  if (g > 0.4) n = 15255086.0;    // o
  if (g > 0.5) n = 23385164.0;    // &
  if (g > 0.6) n = 15252014.0;    // 8
  if (g > 0.7) n = 13199452.0;    // @
  if (g > 0.8) n = 11512810.0;    // #
  vec2 p = mod(px / (uCell * 0.5), 2.0) - vec2(1.0);
  // Dark cells still show a dim glyph so the black silhouette stays visible.
  float m = glyph(n, p);
  finalColor = vec4(max(rgb, vec3(0.25, 0.1, 0.35)) * m, m);
}`, { uCell: { value: cell, type: "f32" } });
}

export function setUniform(f: Filter, name: string, value: number): void {
  (f.resources.u as { uniforms: Record<string, number> }).uniforms[name] = value;
}
