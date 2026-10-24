// Instanced sprite shader shared by every emitter layer. Per-layer options are data (spriteLayer) that
// become #defines and uniforms; the Three.js material is built by the binding, not here. Every option beyond the
// pilot's is opt-in: without its #define the preprocessed shader is the pilot's.
import { DEPTH_FADE_GLSL } from './depth-fade.js';
import { SUBUV_ATLAS_UV_GLSL, SUBUV_POLICIES, validateGrid } from './subuv-atlas.js';

// UE's sprite UV Y points down. Its positive rotation uses that down basis.
export const SPRITE_CORNER_GLSL = `
vec2 spriteCorner(vec2 corner, vec2 size, float rotationDegrees) {
  float a = radians(rotationDegrees);
  return mat2(cos(a), -sin(a), sin(a), cos(a)) * (corner * size);
}`;

// Sprite facing. 'camera-plane' (default, the pilot's) is UE FaceCamera: Right = view right, Up = -view up
// (NiagaraSpriteVertexFactory.ush 556-557, 602-606); the corner offsets the view-space center.
// 'camera-position' is UE FaceCameraPosition (ush 561-562, 582-583, 619-620): CameraDirection =
// SafeNormalize(CameraOrigin - Particle), Right = SafeNormalize(cross(CameraDirection, (0,0,1))),
// Up = cross(CameraDirection, Right), in UE axes (Z up). Scene axes are toScene(UE) = [y, z, -x] (particles.js), a
// reflection (determinant -1), so each UE cross product becomes the reversed scene cross product:
// Right = safeNormalize(cross(+Y, direction)), Up = cross(Right, direction). The corner's x runs along Right and its y
// along -Up, as in FaceCamera, where -Up is the view up; the rotation (ush 633-640) is the corner's.
// SPRITE_FACINGS keeps the pilot's single entry (pinned by render-core.test.mjs); SPRITE_FACING_MODES lists all.
export const SPRITE_FACINGS = Object.freeze(['camera-plane']);
export const SPRITE_FACING_MODES = Object.freeze(['camera-plane', 'camera-position']);
export const SPRITE_FACING_GLSL = `
#ifdef SPRITE_FACING_CAMERA_POSITION
vec3 spriteSafeNormalize(vec3 v) {
  return v / max(length(v), 0.000001);
}
vec4 spriteViewPosition(vec3 center, vec2 corner) {
  vec3 direction = spriteSafeNormalize(cameraPosition - center);
  vec3 right = spriteSafeNormalize(cross(vec3(0.0, 1.0, 0.0), direction));
  vec3 up = cross(right, direction);
  return viewMatrix * vec4(center + corner.x * right - corner.y * up, 1.0);
}
#else
vec4 spriteViewPosition(vec3 center, vec2 corner) {
  return viewMatrix * vec4(center, 1.0) + vec4(corner, 0.0, 0.0);
}
#endif`;

// JS twin of the 'camera-position' basis, in scene axes: { right, up } with up along UE's Up (the UV's down).
export function cameraPositionBasis(cameraPosition, center) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const safeNormalize = v => { const l = Math.max(Math.hypot(...v), .000001); return v.map(x => x / l); };
  const direction = safeNormalize(sub(cameraPosition, center));
  const right = safeNormalize(cross([0, 1, 0], direction));
  return { direction, right, up: cross(right, direction) };
}

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

// RadialGradientExponential as M_Master_RadialBeam wires it (docs/delivery/st01c/basichit/RENDER-SOURCES.md, section
// (c)): uv = TexCoord[0], CenterPosition (0.5, 0.5), Radius 0.5, Density 2.333, Invert Density false; the graph has no
// saturate. UE's TexCoord[0] on a sprite is the SubUV coordinate (NiagaraSpriteVertexFactory.ush 288, 1068), V down.
export const RADIAL_GRADIENT_EXPONENTIAL = Object.freeze({ center: Object.freeze([.5, .5]), radius: .5, density: 2.333, invertDensity: false });
export const RADIAL_GRADIENT_EXPONENTIAL_GLSL = `
float radialGradientExponential(vec2 uv) {
  float x = 1.0 - length(uv - vec2(0.5)) / 0.5;
  float tk = x * 2.333;
  return 1.0 - (x > 1e-5 ? 1.0 / pow(2.718282, tk * tk) : 1.0);
}`;
// JS twin of radialGradientExponential; uv in UE's TexCoord[0] (the gradient is symmetric about the center).
export function radialGradientExponential([u, v]) {
  const x = 1 - Math.hypot(u - .5, v - .5) / .5, tk = x * 2.333;
  return 1 - (x > 1e-5 ? 1 / Math.pow(2.718282, tk * tk) : 1);
}

// Material: RGB = texel RGB * particle RGB; opacity = saturate(texel R * particle alpha) * DepthFade.
// Without SPRITE_TEXTURE the texel is white. DepthFade needs DEPTH_FADE and an opaque depth at run time.
// SPRITE_RADIAL_GRADIENT (untextured): opacity = saturate(particle alpha * radialGradientExponential(TexCoord[0])).
// Every opacity is saturated: UE GetMaterialOpacity = saturate(GetMaterialOpacityRaw) (MaterialTemplate.ush 3916-3920),
// the opacity of the legacy translucent base pass (BasePassPixelShader.usf 1012, 1021; r.Substrate defaults to 0,
// RenderUtils.cpp 2068-2072).
export const SPRITE_FRAGMENT_SHADER = `
#ifdef SPRITE_TEXTURE
uniform sampler2D atlas;
#endif
#ifdef DEPTH_FADE
uniform bool depthFadeEnabled;
${DEPTH_FADE_GLSL}
#endif
#ifdef SPRITE_RADIAL_GRADIENT
${RADIAL_GRADIENT_EXPONENTIAL_GLSL}
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
#ifdef SPRITE_RADIAL_GRADIENT
  gl_FragColor = vec4(texel * tint.rgb, clamp(tint.a * radialGradientExponential(vec2(atlasUv.x, 1.0 - atlasUv.y)), 0.0, 1.0) * fade);
#else
  gl_FragColor = vec4(texel * tint.rgb, clamp(texel.r * tint.a, 0.0, 1.0) * fade);
#endif
}`;

// Opacity sources: 'texel-red' (default, the pilot's M_Smoke and M_Ground_Crack) or the untextured
// 'radial-gradient-exponential' (M_Master_RadialBeam).
export const SPRITE_OPACITIES = Object.freeze(['texel-red', 'radial-gradient-exponential']);

// One layer's options: grid [columns, rows] (1x1 allowed), texture on/off, depthFade null (off) or the fade distance in
// scene units, facing, subUV policy and opacity source. Returns the frozen options plus the #defines for the material.
// Options left at their default stay absent, so a pilot layer keeps exactly its earlier shape.
export function spriteLayer({ grid, texture, depthFade, facing = SPRITE_FACINGS[0], subUV = SUBUV_POLICIES[0],
  opacity = SPRITE_OPACITIES[0] } = {}) {
  validateGrid(grid);
  if (typeof texture !== 'boolean') throw new Error('Invalid sprite texture option');
  if (depthFade !== null && !(Number.isFinite(depthFade) && depthFade > 0)) throw new Error('Invalid DepthFade distance');
  if (!SPRITE_FACING_MODES.includes(facing)) throw new Error('Unsupported sprite facing');
  if (!SUBUV_POLICIES.includes(subUV)) throw new Error('Invalid SubUV policy');
  if (!SPRITE_OPACITIES.includes(opacity)) throw new Error('Unsupported sprite opacity');
  if (opacity === 'radial-gradient-exponential' && texture) throw new Error('The radial gradient layer is untextured');
  const defines = {};
  if (texture) defines.SPRITE_TEXTURE = '';
  if (depthFade !== null) defines.DEPTH_FADE = '';
  if (facing === 'camera-position') defines.SPRITE_FACING_CAMERA_POSITION = '';
  if (subUV === 'wrap') defines.SUBUV_WRAP = '';
  if (opacity === 'radial-gradient-exponential') defines.SPRITE_RADIAL_GRADIENT = '';
  const options = { grid: Object.freeze([...grid]), texture, depthFade, facing };
  if (subUV !== SUBUV_POLICIES[0]) options.subUV = subUV;
  if (opacity !== SPRITE_OPACITIES[0]) options.opacity = opacity;
  return Object.freeze({ ...options, defines: Object.freeze(defines) });
}
