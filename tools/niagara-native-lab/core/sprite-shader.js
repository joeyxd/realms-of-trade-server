// Instanced sprite shader shared by every emitter layer. Per-layer options are data (spriteLayer) that
// become #defines and uniforms; the Three.js material is built by the binding, not here.
import { DEPTH_FADE_GLSL } from './depth-fade.js';
import { SUBUV_ATLAS_UV_GLSL, validateGrid } from './subuv-atlas.js';

// UE's sprite UV Y points down. Its positive rotation uses that down basis.
export const SPRITE_CORNER_GLSL = `
vec2 spriteCorner(vec2 corner, vec2 size, float rotationDegrees) {
  float a = radians(rotationDegrees);
  return mat2(cos(a), -sin(a), sin(a), cos(a)) * (corner * size);
}`;

// Sprite facing: the only mode is the camera-plane billboard (the corner offsets the view-space center).
// FaceCameraPosition goes here: a second SPRITE_FACINGS value selecting another basis. Not implemented.
export const SPRITE_FACINGS = Object.freeze(['camera-plane']);
export const SPRITE_FACING_GLSL = `
vec4 spriteViewPosition(vec3 center, vec2 corner) {
  return viewMatrix * vec4(center, 1.0) + vec4(corner, 0.0, 0.0);
}`;

export const SPRITE_VERTEX_SHADER = `
attribute vec3 particlePosition;
attribute vec2 particleSize;
attribute vec4 particleColor;
attribute float particleRotation;
attribute float particleFrame;
varying vec2 atlasUv;
varying vec4 tint;
uniform vec2 grid;
${SPRITE_CORNER_GLSL}
${SPRITE_FACING_GLSL}
${SUBUV_ATLAS_UV_GLSL}
void main() {
  gl_Position = projectionMatrix * spriteViewPosition(particlePosition, spriteCorner(position.xy, particleSize, particleRotation));
  atlasUv = subUVAtlasUv(particleFrame, grid, uv);
  tint = particleColor;
}`;

// Material: RGB = texel RGB * particle RGB; opacity = saturate(texel R * particle alpha) * DepthFade.
// Without SPRITE_TEXTURE the texel is white. DepthFade needs DEPTH_FADE and an opaque depth at run time.
export const SPRITE_FRAGMENT_SHADER = `
#ifdef SPRITE_TEXTURE
uniform sampler2D atlas;
#endif
#ifdef DEPTH_FADE
uniform bool depthFadeEnabled;
${DEPTH_FADE_GLSL}
#endif
varying vec2 atlasUv;
varying vec4 tint;
void main() {
#ifdef SPRITE_TEXTURE
  vec3 texel = texture2D(atlas, atlasUv).rgb;
#else
  vec3 texel = vec3(1.0);
#endif
  float fade = 1.0;
#ifdef DEPTH_FADE
  if (depthFadeEnabled) fade = depthFade();
#endif
  gl_FragColor = vec4(texel * tint.rgb, clamp(texel.r * tint.a, 0.0, 1.0) * fade);
}`;

// One layer's options: grid [columns, rows] (1x1 allowed), texture on/off, depthFade null (off) or the
// fade distance in scene units, facing. Returns the frozen options plus the #defines for the material.
export function spriteLayer({ grid, texture, depthFade, facing = SPRITE_FACINGS[0] } = {}) {
  validateGrid(grid);
  if (typeof texture !== 'boolean') throw new Error('Invalid sprite texture option');
  if (depthFade !== null && !(Number.isFinite(depthFade) && depthFade > 0)) throw new Error('Invalid DepthFade distance');
  if (!SPRITE_FACINGS.includes(facing)) throw new Error('Unsupported sprite facing');
  const defines = {};
  if (texture) defines.SPRITE_TEXTURE = '';
  if (depthFade !== null) defines.DEPTH_FADE = '';
  return Object.freeze({ grid: Object.freeze([...grid]), texture, depthFade, facing, defines: Object.freeze(defines) });
}
