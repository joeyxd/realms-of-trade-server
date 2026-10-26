// Source DepthFade: saturate((opaque view depth - fragment view depth) / FadeDistance).
// Linear view depths in scene units (metres): axial separation, not Euclidean distance.
// The one fade-distance default: the source's 100 cm, i.e. 1.0 scene unit.
export const DEPTH_FADE_DISTANCE = 1;

export function depthFactor(sceneDepth, pixelDepth, fadeDistance = DEPTH_FADE_DISTANCE) {
  if (![sceneDepth, pixelDepth, fadeDistance].every(Number.isFinite) || fadeDistance <= 0)
    throw new Error('Invalid linear depth');
  return Math.max(0, Math.min(1, (sceneDepth - pixelDepth) / fadeDistance));
}

// GLSL twin of depthFactor. opaqueDepth is a separate target, never the active framebuffer;
// depthFadeDistance is the per-layer uniform (DEPTH_FADE_DISTANCE for the pilot).
export const DEPTH_FADE_GLSL = `
uniform sampler2D opaqueDepth;
uniform vec2 depthSize;
uniform vec2 nearFar;
uniform bool orthographic;
uniform float depthFadeDistance;
float viewDepth(float z) {
  return orthographic ? mix(nearFar.x, nearFar.y, z)
    : nearFar.x * nearFar.y / (nearFar.y - z * (nearFar.y - nearFar.x));
}
float depthFade() {
  float sceneDepth = viewDepth(texture2D(opaqueDepth, gl_FragCoord.xy / depthSize).r);
  return clamp((sceneDepth - viewDepth(gl_FragCoord.z)) / depthFadeDistance, 0.0, 1.0);
}`;
