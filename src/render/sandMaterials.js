// Authored sand family. Colour maps are sRGB; normals are linear data. No terrain/simulation edits.
import * as THREE from 'three';

export const SAND_MATERIALS = Object.freeze([
  { name: 'Dry', albedo: 'dry-albedo', normal: 'dry-normal', tile: 8 },
  { name: 'Wet', albedo: 'wet-albedo', normal: 'dry-normal', tile: 8 },
  { name: 'Ripple', albedo: 'ripple-albedo', normal: 'ripple-normal', tile: 10 },
  { name: 'Footprints', albedo: 'footprints-albedo', normal: 'footprints-normal', tile: 3.2 },
  { name: 'Shore', albedo: 'shore-sand-albedo', normal: 'shore-sand-normal', tile: 3.2 },
]);
export const sandTextureId = (name) => `tex:sand-${name}-v1`;
const tile = Object.fromEntries(SAND_MATERIALS.map((m) => [m.name, m.tile.toFixed(1)]));

let flatNormal;
function fallbackNormal() {
  if (!flatNormal) {
    flatNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    flatNormal.needsUpdate = true;
  }
  return flatNormal;
}

export function sandUniforms(registry, map) {
  const uniforms = {};
  const loaded = [];
  for (const m of SAND_MATERIALS) {
    const color = registry.texture(sandTextureId(m.albedo));
    const normal = registry.texture(sandTextureId(m.normal));
    uniforms[`mnSand${m.name}Color`] = { value: color || fallbackNormal() };
    uniforms[`mnSand${m.name}Normal`] = { value: normal || fallbackNormal() };
    uniforms[`mnSand${m.name}On`] = { value: color ? 1 : 0 };
    if (color) loaded.push(m.name);
  }
  const { spawn, village } = map.landmarks;
  uniforms.mnSandTrail = { value: new THREE.Vector4(spawn.x, spawn.z, village.x, village.z) };
  uniforms.mnSandNormalStrength = { value: 0.22 };
  // Keep the author's painted trail available for review; walking now leaves separate fading marks.
  uniforms.mnSandStaticFootprints = { value: 0 };
  // Debug/review controls also permit an exact same-camera procedural comparison.
  uniforms.mnSandEnabled = { value: loaded.length ? 1 : 0 };
  return { uniforms, loaded };
}

export const SAND_PARS = /* glsl */ `
  uniform float mnSandEnabled;
  uniform float mnSandNormalStrength;
  uniform float mnSandStaticFootprints;
  uniform vec4 mnSandTrail;
  vec3 mnSandN = vec3(0.0, 0.0, 1.0);
  float mnSandNormalWeight = 0.0;
  float mnSandTrailDistance(vec2 p) {
    vec2 a = mnSandTrail.xy, ab = mnSandTrail.zw - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.001), 0.0, 1.0);
    return length(p - a - ab * t);
  }
` + SAND_MATERIALS.map((m) => /* glsl */ `
  uniform sampler2D mnSand${m.name}Color;
  uniform sampler2D mnSand${m.name}Normal;
  uniform float mnSand${m.name}On;
`).join('');

// Three uploads sRGB textures with hardware decoding; do not apply srgb() a second time.
export const SAND_COLOR = /* glsl */ `
  vec2 sandUV = vec2(wp.x, -wp.z);
  vec2 sandDx = dFdx(sandUV), sandDy = dFdy(sandUV);
  float sandOn = mnSandEnabled;
  float rippleW = smoothstep(0.48, 0.68, n2) * (1.0 - wetW) * mnSandRippleOn * sandOn;
  float footW = (1.0 - smoothstep(1.0, 3.0, mnSandTrailDistance(wp.xz)))
    * smoothstep(0.5, 0.85, h) * (1.0 - wetW) * mnSandFootprintsOn * sandOn * mnSandStaticFootprints;
  float shoreW = (1.0 - smoothstep(0.2, 0.55, h)) * smoothstep(-0.25, 0.05, h)
    * mnSandShoreOn * sandOn;
  vec3 paintedSand = sand * (0.96 + 0.06 * n1);
  if (mnSandDryOn * sandOn > 0.5) paintedSand = textureGrad(mnSandDryColor, sandUV / ${tile.Dry}, sandDx / ${tile.Dry}, sandDy / ${tile.Dry}).rgb;
  if (rippleW > 0.001) paintedSand = mix(paintedSand, textureGrad(mnSandRippleColor, sandUV / ${tile.Ripple}, sandDx / ${tile.Ripple}, sandDy / ${tile.Ripple}).rgb, rippleW);
  if (footW > 0.001) paintedSand = mix(paintedSand, textureGrad(mnSandFootprintsColor, sandUV / ${tile.Footprints}, sandDx / ${tile.Footprints}, sandDy / ${tile.Footprints}).rgb, footW);
  vec3 paintedWet = wet;
  if (mnSandWetOn * sandOn > 0.5 && wetW > 0.001) paintedWet = textureGrad(mnSandWetColor, sandUV / ${tile.Wet}, sandDx / ${tile.Wet}, sandDy / ${tile.Wet}).rgb;
  paintedSand = mix(paintedSand, paintedWet, wetW);
  if (shoreW > 0.001) paintedSand = mix(paintedSand, textureGrad(mnSandShoreColor, sandUV / ${tile.Shore}, sandDx / ${tile.Shore}, sandDy / ${tile.Shore}).rgb, shoreW * 0.7);
  vec3 col = mix(paintedSand, grass, grassW);
`;

export const SAND_NORMAL_SAMPLE = /* glsl */ `
  if (plain * (1.0 - grassW) * sandOn > 0.001) {
    if (mnSandDryOn > 0.5) mnSandN = textureGrad(mnSandDryNormal, sandUV / ${tile.Dry}, sandDx / ${tile.Dry}, sandDy / ${tile.Dry}).rgb * 2.0 - 1.0;
    if (rippleW > 0.001) mnSandN = mix(mnSandN, textureGrad(mnSandRippleNormal, sandUV / ${tile.Ripple}, sandDx / ${tile.Ripple}, sandDy / ${tile.Ripple}).rgb * 2.0 - 1.0, rippleW);
    if (footW > 0.001) mnSandN = mix(mnSandN, textureGrad(mnSandFootprintsNormal, sandUV / ${tile.Footprints}, sandDx / ${tile.Footprints}, sandDy / ${tile.Footprints}).rgb * 2.0 - 1.0, footW);
    if (mnSandWetOn > 0.5 && wetW > 0.001) mnSandN = mix(mnSandN, textureGrad(mnSandWetNormal, sandUV / ${tile.Wet}, sandDx / ${tile.Wet}, sandDy / ${tile.Wet}).rgb * 2.0 - 1.0, wetW);
    if (shoreW > 0.001) mnSandN = mix(mnSandN, textureGrad(mnSandShoreNormal, sandUV / ${tile.Shore}, sandDx / ${tile.Shore}, sandDy / ${tile.Shore}).rgb * 2.0 - 1.0, shoreW * 0.7);
    mnSandNormalWeight = plain * (1.0 - grassW) * sandOn * (1.0 - smoothstep(35.0, 70.0, length(vViewPosition)));
  }
`;

// The projected UV is (+world X, -world Z), so T=+X, B=-Z, N=+Y is right handed.
// Outline normals stay geometric: grains must not turn into black screen-space contours.
export const SAND_NORMAL = /* glsl */ `
  if (mnSandNormalWeight > 0.001) {
    vec3 sn = normalize(inverseTransformDirection(normal, viewMatrix));
    vec3 st = normalize(vec3(1.0, 0.0, 0.0) - sn * sn.x);
    vec3 sb = normalize(cross(sn, st));
    vec3 detailN = normalize(vec3(mnSandN.xy * mnSandNormalStrength, max(mnSandN.z, 0.2)));
    vec3 worldN = normalize(st * detailN.x + sb * detailN.y + sn * detailN.z);
    normal = normalize(mix(normal, mat3(viewMatrix) * worldN, mnSandNormalWeight));
  }
`;
