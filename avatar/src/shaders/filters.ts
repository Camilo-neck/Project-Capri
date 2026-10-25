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
uniform highp vec4 uInputClamp;
uniform highp vec4 uOutputFrame;
`;

/**
 * Glitch on pixel art: displaced horizontal bands, RGB split and a flat silhouette frame.
 * Bands and shifts are whole native pixels of the grid at uGrid (screen origin xy, pixel size z),
 * so the art never goes blurry. All uniforms at 0 = off.
 */
export function glitchFilter(): Filter {
  return make("glitch", /* glsl */ `${HEADER}
uniform float uGlitch;
uniform float uSplit;
uniform float uSeed;
uniform vec4 uSil;
uniform vec3 uGrid;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec4 at(vec2 uv) {
  if (any(lessThan(uv, uInputClamp.xy)) || any(greaterThan(uv, uInputClamp.zw))) return vec4(0.0);
  return texture(uTexture, uv);
}

void main() {
  vec2 screen = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
  vec2 cell = floor((screen - uGrid.xy) / uGrid.z);
  float bandH = 2.0 + floor(hash(vec2(uSeed, 7.0)) * 5.0);
  float band = floor(cell.y / bandH);
  float dx = 0.0;
  if (hash(vec2(band, uSeed)) < uGlitch * 0.6) dx = floor((hash(vec2(band + 3.0, uSeed)) - 0.5) * 16.0 * uGlitch + 0.5);
  float px = uGrid.z * uInputSize.z; // one native pixel, in uv
  vec2 uv = vTextureCoord - vec2(dx * px, 0.0);
  vec4 c = at(uv);
  if (uSplit > 0.0) {
    vec4 r = at(uv + vec2(uSplit * px, 0.0));
    vec4 b = at(uv - vec2(uSplit * px, 0.0));
    c = vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));
  }
  c.rgb = mix(c.rgb, uSil.rgb * c.a, uSil.a); // premultiplied
  finalColor = c;
}`, {
    uGlitch: { value: 0, type: "f32" },
    uSplit: { value: 0, type: "f32" },
    uSeed: { value: 0, type: "f32" },
    uSil: { value: [0, 0, 0, 0], type: "vec4<f32>" },
    uGrid: { value: [0, 0, 1], type: "vec3<f32>" },
  });
}

export function setUniform(f: Filter, name: string, value: number | number[]): void {
  (f.resources.u as { uniforms: Record<string, number | number[]> }).uniforms[name] = value;
}
