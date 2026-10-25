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

export function setUniform(f: Filter, name: string, value: number): void {
  (f.resources.u as { uniforms: Record<string, number> }).uniforms[name] = value;
}
