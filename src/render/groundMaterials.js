// Painted ground in a padded atlas: two samplers, shared colour/normal coordinates.
import * as THREE from 'three';

export const GROUND_TEXTURES = Object.freeze(['atlas-albedo', 'atlas-normal']);
export const groundTextureId = (name) => `tex:ground-${name}-v1`;
export const GROUND_TILES = Object.freeze({ sandGrass: [0, 0.5], sandDirt: [0.5, 0.5], grass: [0, 0], dirt: [0.5, 0] });
export const GROUND_INSET = 1 / 64;
export const GROUND_SPAN = 15 / 32;

// The source gradients run from lower-left sand to upper-right grass/dirt.
// Cross-edge progress offsets the world projection gently; preserve detail instead of stretching it into bands.
export function groundTransitionUV(amount, phase) {
  const sway = 0.1 * Math.sin(phase * 0.6), p = 0.09 + 0.82 * Math.max(0, Math.min(1, amount));
  return [Math.max(0.02, Math.min(0.98, p + sway)), Math.max(0.02, Math.min(0.98, p - sway))];
}
export function groundAtlasUV(tile, uv) {
  return tile.map((origin, i) => origin + GROUND_INSET + Math.max(0, Math.min(1, uv[i])) * GROUND_SPAN);
}

let flat;
export function groundUniforms(registry) {
  if (!flat) { flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); flat.needsUpdate = true; }
  const color = registry.texture(groundTextureId('atlas-albedo'));
  const normal = registry.texture(groundTextureId('atlas-normal'));
  const uniforms = {
    mnGroundColor: { value: color || flat }, mnGroundNormal: { value: normal || flat },
    mnGroundEnabled: { value: color ? 1 : 0 }, mnGroundNormalOn: { value: color && normal ? 1 : 0 },
  };
  return { uniforms, loaded: color ? ['sand-grass', 'sand-dirt', 'grass', 'dirt'] : [] };
}

export const GROUND_PARS = /* glsl */ `
  uniform sampler2D mnGroundColor;
  uniform sampler2D mnGroundNormal;
  uniform float mnGroundEnabled;
  uniform float mnGroundNormalOn;
  vec2 mnGroundTransitionUV(float amount, float phase) {
    float sway = 0.1 * sin(phase * 0.6);
    return clamp(vec2(0.09 + 0.82 * amount) + vec2(sway, -sway), vec2(0.02), vec2(0.98));
  }
  vec3 mnGroundSample(sampler2D tex, vec2 origin, vec2 uv, vec2 dx, vec2 dy) {
    // All derivatives precede fract/branches. Cap LOD to the padded tile's safe mips.
    vec2 gx = dx * 0.46875, gy = dy * 0.46875;
    float limit = min(1.0, 0.0078125 / max(max(length(gx), length(gy)), 0.000001));
    return textureGrad(tex, origin + vec2(0.015625) + uv * 0.46875, gx * limit, gy * limit).rgb;
  }
  vec3 mnGroundOrientedN(vec3 n, vec2 ux, vec2 uy, vec2 wx, vec2 wy) {
    // Transform a warped transition's normal into (+world X, -world Z), matching the sand basis.
    float det = wx.x * wy.y - wx.y * wy.x;
    if (abs(det) < 0.0000001) return vec3(0.0, 0.0, 1.0);
    vec2 gu = (ux.x * vec2(wy.y, -wy.x) + uy.x * vec2(-wx.y, wx.x)) / det;
    vec2 gv = (ux.y * vec2(wy.y, -wy.x) + uy.y * vec2(-wx.y, wx.x)) / det;
    gu /= max(length(gu), 0.00001); gv /= max(length(gv), 0.00001);
    return normalize(vec3(gu * n.x + gv * n.y, max(n.z, 0.2)));
  }
`;

// Unconditional coordinate derivatives, before texture reads in varying mask branches.
export const GROUND_SETUP = /* glsl */ `
  vec2 groundWorldUV = vec2(wp.x, -wp.z);
  vec2 groundWorldDx = dFdx(groundWorldUV), groundWorldDy = dFdy(groundWorldUV);
  vec2 groundUV = groundWorldUV / 8.0;
  vec2 groundDx = dFdx(groundUV), groundDy = dFdy(groundUV);
  vec2 grassEdgeProjected = groundUV + mnGroundTransitionUV(grassW, wp.x + wp.z) * 0.15;
  vec2 grassEdgeUV = fract(grassEdgeProjected);
  vec2 grassEdgeDx = dFdx(grassEdgeProjected), grassEdgeDy = dFdy(grassEdgeProjected);
  float pathW = vMask.x * smoothstep(0.25, 0.55, vMask.x + (n1 - 0.5) * 0.4);
  vec2 pathEdgeProjected = groundUV + mnGroundTransitionUV(pathW, wp.x - wp.z) * 0.15;
  vec2 pathEdgeUV = fract(pathEdgeProjected);
  vec2 pathEdgeDx = dFdx(pathEdgeProjected), pathEdgeDy = dFdy(pathEdgeProjected);
  float grassEdgeW = 4.0 * grassW * (1.0 - grassW);
  float dirtCoreW = smoothstep(0.35, 0.85, pathW);
  // Retain the village's small stone plaza; the surrounding ground and roads become painted dirt.
  float plazaW = 1.0 - smoothstep(4.0, 7.0, length(wp.xz - mnSandTrail.zw));
  if (mnGroundEnabled > 0.5 && grassW > 0.001) {
    grass = mnGroundSample(mnGroundColor, vec2(0.0, 0.0), fract(groundUV), groundDx, groundDy);
  }
`;
export const GROUND_EDGE_COLOR = /* glsl */ `
  if (mnGroundEnabled > 0.5 && grassEdgeW > 0.001) {
    col = mix(col, mnGroundSample(mnGroundColor, vec2(0.0, 0.5), grassEdgeUV, grassEdgeDx, grassEdgeDy), grassEdgeW);
  }
`;
export const GROUND_PATH_COLOR = /* glsl */ `
  if (mnGroundEnabled > 0.5) {
    vec3 pathPaint = mnGroundSample(mnGroundColor, vec2(0.5, 0.5), pathEdgeUV, pathEdgeDx, pathEdgeDy);
    if (dirtCoreW > 0.001) pathPaint = mix(pathPaint,
      mnGroundSample(mnGroundColor, vec2(0.5, 0.0), fract(groundUV), groundDx, groundDy), dirtCoreW);
    p = mix(pathPaint, p, plazaW);
  }
`;
export const GROUND_NORMAL_SAMPLE = /* glsl */ `
  float groundSurface = (1.0 - rockW) * (1.0 - volcW) * (1.0 - vMask.z) * (1.0 - smoothstep(0.3, 0.8, vMask.w));
  if (mnGroundEnabled * mnGroundNormalOn * groundSurface > 0.001) {
    if (grassW > 0.001) mnSandN = mix(mnSandN,
      mnGroundSample(mnGroundNormal, vec2(0.0), fract(groundUV), groundDx, groundDy) * 2.0 - 1.0, grassW);
    if (grassEdgeW > 0.001) {
      vec3 edgeN = mnGroundSample(mnGroundNormal, vec2(0.0, 0.5), grassEdgeUV, grassEdgeDx, grassEdgeDy) * 2.0 - 1.0;
      mnSandN = mix(mnSandN, mnGroundOrientedN(edgeN, grassEdgeDx, grassEdgeDy, groundWorldDx, groundWorldDy), grassEdgeW);
    }
    if (pathW * (1.0 - plazaW) > 0.001) {
      vec3 pathN = mnGroundSample(mnGroundNormal, vec2(0.5), pathEdgeUV, pathEdgeDx, pathEdgeDy) * 2.0 - 1.0;
      pathN = mnGroundOrientedN(pathN, pathEdgeDx, pathEdgeDy, groundWorldDx, groundWorldDy);
      if (dirtCoreW > 0.001) pathN = mix(pathN,
        mnGroundSample(mnGroundNormal, vec2(0.5, 0.0), fract(groundUV), groundDx, groundDy) * 2.0 - 1.0, dirtCoreW);
      mnSandN = mix(mnSandN, pathN, pathW * (1.0 - plazaW));
    }
    mnSandN = mix(mnSandN, vec3(0.0, 0.0, 1.0), pathW * plazaW);
    mnSandNormalWeight = max(mnSandNormalWeight, groundSurface * (max(grassW, grassEdgeW) * (1.0 - pathW) + pathW * (1.0 - plazaW))
      * (1.0 - smoothstep(35.0, 70.0, length(vViewPosition))));
  }
`;
