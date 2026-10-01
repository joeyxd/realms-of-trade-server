// Shared toon lighting: one band function (mnBand) used by every lit surface (MeshToonMaterial
// patches, terrain and the custom water shader) so the whole world reads as one piece.
// Also: cloud shadows, wind sway, occluder dithering, and paired normal-pass materials for outlines.
import * as THREE from 'three';

export const U = {
  mnTime: { value: 0 },
  mnPlayer: { value: new THREE.Vector3(0, -1000, 0) },
  mnOccR: { value: 1.8 },
  mnOccOn: { value: 1 },
  mnNearFade: { value: 13 },
  mnCloud: { value: 0.32 },
  mnWind: { value: new THREE.Vector2(0.9, 0.45) },
  mnRimColor: { value: new THREE.Color(0x9fd8ff) },
  mnRimStr: { value: 0.55 },
  mnShadowTint: { value: new THREE.Color(0x6a5a9a) },
};

export const GLSL_COMMON = /* glsl */ `
uniform float mnTime;
uniform vec3 mnPlayer;
uniform float mnOccR;
uniform float mnOccOn;
uniform float mnNearFade;
uniform float mnCloud;
uniform vec2 mnWind;
float mnHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float mnNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mnHash(i), mnHash(i + vec2(1.0, 0.0)), u.x), mix(mnHash(i + vec2(0.0, 1.0)), mnHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float mnFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * mnNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float mnCloudShadow(vec2 xz) {
  vec2 q = xz * 0.016 + mnWind * mnTime * 0.011;
  float c = mnFbm(q);
  return 1.0 - mnCloud * smoothstep(0.5, 0.6, c);
}
float mnBayer(vec2 fc) {
  ivec2 p = ivec2(mod(fc, 4.0));
  const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[p.x + p.y * 4] + 0.5) / 16.0;
}
// Voronoi: x = distance to nearest feature, y = distance to the nearest cell edge.
vec2 mnVoronoi(vec2 x) {
  vec2 n = floor(x), f = fract(x), mg = vec2(0.0), mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(mnHash(n + g), mnHash(n + g + 31.7));
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  float ed = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 o = vec2(mnHash(n + g), mnHash(n + g + 31.7));
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001) ed = min(ed, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec2(sqrt(md), ed);
}
`;

// Fragment-only (uses derivatives).
export const GLSL_BAND = /* glsl */ `
// The one light-band function. x = N·L in [-1, 1]. Antialiased band edges.
float mnBand(float x) {
  float w = max(fwidth(x), 0.0008) * 1.1;
  float b = 0.42;
  b = mix(b, 0.68, smoothstep(-0.02 - w, -0.02 + w, x));
  b = mix(b, 0.88, smoothstep(0.30 - w, 0.30 + w, x));
  b = mix(b, 1.00, smoothstep(0.64 - w, 0.64 + w, x));
  return b;
}
`;

const VERT_PARS = /* glsl */ `
varying vec3 vMnWorld;
#ifdef MN_SWAY
attribute float aFlex;
uniform float mnSwayAmt;
#endif
`;

const VERT_SWAY = /* glsl */ `
#ifdef MN_SWAY
{
  vec3 o = vec3(0.0);
  #ifdef USE_INSTANCING
  o = instanceMatrix[3].xyz;
  #endif
  float ph = o.x * 0.21 + o.z * 0.17;
  float sw = sin(mnTime * 1.25 + ph) * 0.65 + sin(mnTime * 2.6 + ph * 1.7) * 0.25;
  float sw2 = cos(mnTime * 1.05 + ph * 0.8) * 0.45;
  float flutter = sin(mnTime * 7.0 + ph * 3.0 + position.x * 2.0 + position.z * 2.0) * 0.06 * step(1.5, aFlex);
  float k = min(aFlex, 1.0);
  transformed.x += (sw * mnSwayAmt) * k;
  transformed.z += (sw2 * mnSwayAmt) * k;
  transformed.y += flutter;
}
#endif
`;

const VERT_WORLD = /* glsl */ `
{
  vec4 mnW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  mnW = instanceMatrix * mnW;
  #endif
  vMnWorld = (modelMatrix * mnW).xyz;
}
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vMnWorld;
`;

const FRAG_OCCLUDE = /* glsl */ `
#ifdef MN_OCCLUDER
if (mnOccOn > 0.5) {
  vec3 seg = mnPlayer - cameraPosition;
  float L = length(seg);
  vec3 dir = seg / L;
  vec3 rel = vMnWorld - cameraPosition;
  float t = dot(rel, dir);
  if (t > 0.0 && t < L - 0.5) {
    float d = length(rel - dir * t);
    float fade = 1.0 - smoothstep(mnOccR * 0.5, mnOccR, d);
    if (fade * 0.9 > mnBayer(gl_FragCoord.xy)) discard;
  }
  // Anything very close to the camera dissolves too (tall palms at the screen edge).
  float camD = distance(vMnWorld, cameraPosition);
  float near = 1.0 - smoothstep(mnNearFade, mnNearFade + 4.0, camD);
  if (near > 0.0 && near * 0.95 > mnBayer(gl_FragCoord.xy)) discard;
}
#endif
`;

const BAND_PARS = /* glsl */ `
float mnVis = 1.0;
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
  float ndl = dot( normal, lightDirection );
  ndl = mix( -1.0, ndl, mnVis );
  return vec3( mnBand( ndl ) );
}
`;

let LIGHTS_BEGIN = null;
function lightsBegin() {
  if (LIGHTS_BEGIN) return LIGHTS_BEGIN;
  let s = THREE.ShaderChunk.lights_fragment_begin;
  const a = 'getDirectionalLightInfo( directionalLight, directLight );';
  const b = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]';
  if (!s.includes(a) || !s.includes(b)) console.warn('[toon] lights_fragment_begin layout changed; cloud/shadow banding disabled');
  s = s.replace(a, a + '\n\t\tmnVis = 1.0;\n\t\t#if ( UNROLLED_LOOP_INDEX == 0 )\n\t\tmnVis = mnSunCloud;\n\t\t#endif');
  s = s.replace(b, 'mnVis *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]');
  LIGHTS_BEGIN = s;
  return s;
}

const FRAG_RIM = /* glsl */ `
#ifdef MN_RIM
{
  vec3 mnV = normalize( vViewPosition );
  float fr = 1.0 - saturate( dot( normal, mnV ) );
  float rimB = smoothstep( 0.58, 0.72, fr );
  reflectedLight.directDiffuse += mnRimColor * mnRimStr * rimB * diffuseColor.rgb;
}
#endif
`;

function definesFor(opts) {
  const d = {};
  if (opts.sway) d.MN_SWAY = '';
  if (opts.occluder) d.MN_OCCLUDER = '';
  if (opts.rim) d.MN_RIM = '';
  return d;
}

// Patch a MeshToonMaterial in place. opts: {sway, occluder, rim, uniforms, fragPars, albedo, emissive, key}
export function patchToon(mat, opts = {}) {
  mat.defines = { ...(mat.defines || {}), ...definesFor(opts) };
  const extra = opts.uniforms || {};
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, extra);
    if (opts.sway) sh.uniforms.mnSwayAmt = opts.swayUniform || { value: 0.18 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + VERT_PARS + (opts.vertPars || ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_SWAY + (opts.vertBody || ''))
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_WORLD);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + GLSL_BAND + FRAG_PARS + 'uniform vec3 mnRimColor;\nuniform float mnRimStr;\n' + (opts.fragPars || ''))
      .replace('#include <gradientmap_pars_fragment>', BAND_PARS)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_OCCLUDE)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + (opts.albedo || ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (opts.emissive || ''))
      .replace('#include <lights_fragment_begin>', 'float mnSunCloud = mnCloudShadow(vMnWorld.xz);\n' + lightsBegin())
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + FRAG_RIM);
  };
  mat.customProgramCacheKey = () => 'mn-toon-' + (opts.key || '') + JSON.stringify(definesFor(opts));
  return mat;
}

export function toon(params = {}, opts = {}) {
  const mat = new THREE.MeshToonMaterial(params);
  return patchToon(mat, opts);
}

// Normal-pass material that repeats the same vertex motion and occluder discard as its toon twin.
export function normalMatFor(opts = {}, side = THREE.FrontSide) {
  const mat = new THREE.MeshNormalMaterial({ side });
  mat.defines = definesFor(opts);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    if (opts.sway) sh.uniforms.mnSwayAmt = opts.swayUniform || { value: 0.18 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_SWAY)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_WORLD);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', GLSL_COMMON + FRAG_PARS + 'void main() {')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_OCCLUDE);
  };
  mat.customProgramCacheKey = () => 'mn-normal-' + JSON.stringify(definesFor(opts)) + side;
  return mat;
}

// Convenience: toon + paired normal material assigned to the mesh.
export function toonMesh(geo, params, opts = {}, MeshClass = THREE.Mesh, count) {
  const mat = toon(params, opts);
  const mesh = count !== undefined ? new MeshClass(geo, mat, count) : new MeshClass(geo, mat);
  if (opts.sway || opts.occluder || params.side === THREE.DoubleSide) mesh.userData.nm = normalMatFor(opts, params.side ?? THREE.FrontSide);
  return mesh;
}
