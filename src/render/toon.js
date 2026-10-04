// Shared toon lighting: one band function (mnBand) used by every lit surface (MeshToonMaterial
// patches, terrain and the custom water shader) so the whole world reads as one piece.
// Also: cloud shadows, wind sway, occluder dithering, and paired normal-pass materials for outlines.
import * as THREE from 'three';
import { getNoiseTexture } from './noiseTex.js';

export const MAX_LIGHTS = 12;

export const U = {
  mnNoiseTex: { value: getNoiseTexture() },
  mnTerrainCaustics: { value: 0 },
  mnInk: { value: 1 },
  mnTime: { value: 0 },
  mnPlayer: { value: new THREE.Vector3(0, -1000, 0) },
  mnOccR: { value: 1.8 },
  mnOccOn: { value: 1 },
  // A second thing that must not hide under the canopy (M4.5): your chest, your spilled loot. xyz + on (w).
  mnOcc2: { value: new THREE.Vector4(0, -1000, 0, 0) },
  mnNearFade: { value: 13 },
  mnCloud: { value: 0.32 },
  mnWind: { value: new THREE.Vector2(0.9, 0.45) },
  mnRimColor: { value: new THREE.Color(0x9fd8ff) },
  mnRimStr: { value: 0.55 },
  mnCharFill: { value: new THREE.Color(0, 0, 0) }, // camera-side fill on characters (dark presets)
  mnShadowTint: { value: new THREE.Color(0x6a5a9a) },
  mnGlowOut: { value: 1 }, // 0 while rendering portraits (their alpha is coverage, not the glow mask)
  // Local lights (filled by lights.js): xyz + radius, linear rgb * intensity + wrap, active count.
  mnLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, -999, 0, 1)) },
  mnLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
  mnLightCount: { value: 0 },
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

// Fragment-only (derivatives + the shared noise texture).
export const GLSL_BAND = /* glsl */ `
uniform sampler2D mnNoiseTex;
uniform float mnInk; // 1 medium / high, 0 low: comic hatching and painted detail off
// R = cellular F1, G = cellular edge (F2-F1), B = fbm, A = cell id. 8x8 cells per tile.
vec4 mnTex(vec2 uv) { return texture2D(mnNoiseTex, uv); }
float mnCloudShadow(vec2 xz) {
  float c = texture2D(mnNoiseTex, xz * 0.0024 + mnWind * mnTime * 0.0016).b;
  return 1.0 - mnCloud * smoothstep(0.5, 0.6, c);
}
// The one light-band function. x = N·L in [-1, 1]. Three hard tones, antialiased edges:
// deep 0.36 (x < -0.04), mid 0.70, lit 1.0 (x > 0.30).
float mnBand(float x) {
  float w = max(fwidth(x), 0.0008) * 1.1;
  float b = 0.36;
  b = mix(b, 0.70, smoothstep(-0.04 - w, -0.04 + w, x));
  b = mix(b, 1.00, smoothstep(0.30 - w, 0.30 + w, x));
  return b;
}
`;

// Local lights (lanterns, braziers, lava, windows, flashes), evaluated by every lit shader in the
// same banded style as the sun. wn = world-space normal.
export const GLSL_LIGHTS = /* glsl */ `
#define MN_MAX_LIGHTS ${MAX_LIGHTS}
uniform vec4 mnLightPos[MN_MAX_LIGHTS];
uniform vec4 mnLightCol[MN_MAX_LIGHTS];
uniform int mnLightCount;
// Three soft bands (faint rim, warm pool, hot core) mixed with a smooth ramp: painted pools, not rings.
float mnLightFall(float x) {
  float s = x * x * (3.0 - 2.0 * x);
  float b = 0.2 * smoothstep(0.0, 0.08, s) + 0.32 * smoothstep(0.3, 0.38, s) + 0.48 * smoothstep(0.68, 0.76, s);
  return mix(b, s, 0.35);
}
vec3 mnLocalLight(vec3 wp, vec3 wn) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < MN_MAX_LIGHTS; i++) {
    if (i >= mnLightCount) break;
    vec4 lp = mnLightPos[i];
    vec3 d = lp.xyz - wp;
    float dist = length(d);
    float x = clamp(1.0 - dist / lp.w, 0.0, 1.0);
    float ndl = dot(wn, d / max(dist, 1e-3));
    float back = mix(0.12, 0.55, mnLightCol[i].w);
    sum += mnLightCol[i].rgb * mnLightFall(x) * (back + (1.0 - back) * smoothstep(-0.2, 0.6, ndl));
  }
  return sum;
}
// Light arriving at a point from every direction (smoke, dust, ash: lit from below by braziers).
vec3 mnLocalOmni(vec3 wp) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < MN_MAX_LIGHTS; i++) {
    if (i >= mnLightCount) break;
    vec4 lp = mnLightPos[i];
    sum += mnLightCol[i].rgb * mnLightFall(clamp(1.0 - distance(lp.xyz, wp) / lp.w, 0.0, 1.0));
  }
  return sum;
}
// Water: glints where each light reflects in the waves + a faint glow on the surface below it.
vec3 mnLocalWater(vec3 wp, vec3 n, vec3 V) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < MN_MAX_LIGHTS; i++) {
    if (i >= mnLightCount) break;
    vec4 lp = mnLightPos[i];
    vec3 d = lp.xyz - wp;
    float dist = length(d);
    float x = clamp(1.0 - dist / (lp.w * 1.6), 0.0, 1.0);
    float spec = pow(max(dot(n, normalize(d / max(dist, 1e-3) + V)), 0.0), 48.0);
    sum += mnLightCol[i].rgb * (x * x * 0.08 + spec * x * 0.9);
  }
  return sum;
}
`;

// Glow mask out (see pipeline.js): alpha = 1 - glow, faded by fog. Appended after dithering_fragment.
// Toon surfaces glow only where the emissive is bright (hot lava, gems), not on dim embers.
export const glowOut = (expr) => /* glsl */ `
{
  float mnG = clamp(${expr}, 0.0, 1.0) * mnGlowOut;
  #ifdef USE_FOG
  mnG *= 1.0 - fogFactor;
  #endif
  gl_FragColor.a = 1.0 - mnG;
}
`;

const VERT_PARS = /* glsl */ `
varying vec3 vMnWorld;
// Rest-pose world position (before wind sway): the comic hatching is pinned to it, so lines do not swim on swaying leaves.
#ifdef MN_SWAY
varying vec3 vMnRest;
#else
#define vMnRest vMnWorld
#endif
#ifdef MN_GLOW
attribute float aGlow;
varying float vMnGlow;
#endif
#ifdef MN_SWAY
attribute float aFlex;
uniform float mnSwayAmt;
#endif
`;

const VERT_SWAY = /* glsl */ `
#ifdef MN_GLOW
vMnGlow = aGlow;
#endif
#ifdef MN_SWAY
vec3 mnT0 = transformed;
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
  #ifdef MN_SWAY
  vec4 mnR = vec4(mnT0, 1.0);
  #ifdef USE_INSTANCING
  mnR = instanceMatrix * mnR;
  #endif
  vMnRest = (modelMatrix * mnR).xyz;
  #endif
}
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vMnWorld;
#ifdef MN_SWAY
varying vec3 vMnRest;
#else
#define vMnRest vMnWorld
#endif
uniform vec4 mnOcc2;
// How much a fragment sits inside the cylinder from the camera to target (0 outside).
float mnOccFade(vec3 target) {
  vec3 seg = target - cameraPosition;
  float L = length(seg);
  vec3 dir = seg / L;
  vec3 rel = vMnWorld - cameraPosition;
  float t = dot(rel, dir);
  if (t <= 0.0 || t >= L - 0.5) return 0.0;
  return 1.0 - smoothstep(mnOccR * 0.5, mnOccR, length(rel - dir * t));
}
#ifdef MN_GLOW
varying float vMnGlow;
uniform float mnGlowAmt;
#endif
`;

const FRAG_OCCLUDE = /* glsl */ `
#ifdef MN_OCCLUDER
if (mnOccOn > 0.5) {
  float fade = mnOccFade(mnPlayer);
  if (mnOcc2.w > 0.5) fade = max(fade, mnOccFade(mnOcc2.xyz));
  if (fade * 0.9 > mnBayer(gl_FragCoord.xy)) discard;
  // Anything very close to the camera dissolves too (tall palms at the screen edge).
  float camD = distance(vMnWorld, cameraPosition);
  float near = 1.0 - smoothstep(mnNearFade, mnNearFade + 4.0, camD);
  if (near > 0.0 && near * 0.95 > mnBayer(gl_FragCoord.xy)) discard;
}
#endif
`;

const BAND_PARS = /* glsl */ `
uniform vec3 mnShadowTint;
#define MN_SHADE_TINT 0.3
float mnVis = 1.0;       // sun visibility: cloud x shadow map (1 lit, 0 shadowed)
float mnShF = 1.0;       // shadow-map factor of the light being added
float mnIsSun = 0.0;     // 1 while the light being added is the sun (directional loop index 0)
// Sun terms for the comic pass (hatching, shadow ink edge); only the sun writes them.
float mnSunShadow = 1.0; // shadow-map factor alone, before cloud (1 lit, 0 in a cast shadow)
float mnSunNdl = 1.0;    // raw N·L of the sun, before cloud and shadow
float mnSunLit = 1.0;    // 0..1 lit amount without cloud: 1 above the terminator (x > -0.04), 0 deep in shade (x < -0.6) or a cast shadow
float mnShade = 0.0;     // 0 lit .. 1 deep tone of the sun band (tints the sky fill in shade)
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
  float ndl = dot( normal, lightDirection );
  float raw = ndl;
  ndl = mix( -1.0, ndl, mnVis );
  #ifdef MN_SOFT_BAND
  // Faceted characters: mostly two tones, a quarter smooth ramp, so every facet keeps its own tone.
  float b = mix( mnBand( ndl ), 0.36 + 0.64 * smoothstep( -0.45, 0.95, ndl ), 0.25 );
  #else
  float b = mnBand( ndl );
  #endif
  // The tint follows the sun's real shade (back side, cast shadows), not the clouds: a cloud only darkens, so a
  // beach under a passing cloud stays warm sand instead of turning grey-violet.
  float tb = b;
  if ( mnIsSun > 0.5 ) {
    float sh = mix( -1.0, raw, mnShF );
    mnSunNdl = raw;
    mnSunLit = smoothstep( -0.6, -0.04, sh ); // shadow map only: hatching does not follow clouds
    tb = mnBand( sh );
    mnShade = 1.0 - ( tb - 0.36 ) / 0.64;
  }
  // Deep shade leans toward the tint (normalised, so the lit side stays neutral).
  vec3 tintN = mnShadowTint / max( max( mnShadowTint.r, mnShadowTint.g ), max( mnShadowTint.b, 1e-3 ) );
  return mix( tintN, vec3( 1.0 ), ( tb - 0.36 ) / 0.64 ) * b;
}
`;

let LIGHTS_BEGIN = null;
function lightsBegin() {
  if (LIGHTS_BEGIN) return LIGHTS_BEGIN;
  let s = THREE.ShaderChunk.lights_fragment_begin;
  const a = 'getDirectionalLightInfo( directionalLight, directLight );';
  const b = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]';
  if (!s.includes(a) || !s.includes(b)) console.warn('[toon] lights_fragment_begin layout changed; cloud/shadow banding disabled');
  s = s.replace(a, a + '\n\t\tmnVis = 1.0;\n\t\tmnIsSun = 0.0;\n\t\t#if ( UNROLLED_LOOP_INDEX == 0 )\n\t\tmnVis = mnSunCloud;\n\t\tmnIsSun = 1.0;\n\t\t#endif');
  // The shadow factor is kept apart (mnShF) so the sun's alone survives (hatching, ink edge); the band sees cloud x shadow.
  const i = s.indexOf(b), j = s.indexOf(';', i);
  if (i >= 0 && j > i) {
    s = s.slice(0, i) + s.slice(i, j + 1).replace('directLight.color *=', 'mnShF =')
      + '\n\t\tmnVis *= mnShF;\n\t\t#if ( UNROLLED_LOOP_INDEX == 0 )\n\t\tmnSunShadow = mnShF;\n\t\t#endif' + s.slice(j + 1);
  }
  LIGHTS_BEGIN = s;
  return s;
}

const FRAG_RIM = /* glsl */ `
// The sky fill that lights the shade leans toward the tint too (luminance-preserving, so it stays as bright).
reflectedLight.indirectDiffuse *= mix( vec3( 1.0 ), mix( vec3( 1.0 ), mnShadowTint / max( dot( mnShadowTint, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-3 ), MN_SHADE_TINT ), mnShade );
reflectedLight.directDiffuse += mnLocalLight( vMnWorld, inverseTransformDirection( normal, viewMatrix ) ) * BRDF_Lambert( material.diffuseColor );
#ifdef MN_RIM
{
  vec3 mnV = normalize( vViewPosition );
  float fr = 1.0 - saturate( dot( normal, mnV ) );
  float rimB = smoothstep( 0.6, 0.68, fr );
  reflectedLight.directDiffuse += mnRimColor * mnRimStr * rimB * diffuseColor.rgb;
  // Fill from the camera side so characters stay readable at night and in the Caldera.
  reflectedLight.directDiffuse += mnCharFill * BRDF_Lambert( material.diffuseColor ) * ( 0.35 + 0.65 * smoothstep( -0.1, 0.8, dot( normal, mnV ) ) );
}
#endif
`;

// Comic shadows (MN_COMIC), on the final colour. In shade (mnSunLit < 1: facing away from the sun, inside a cast
// shadow) the surface gets ink hatching in world space on the plane of its dominant normal axis: diagonal strokes
// every MN_HATCH_PERIOD, each line wobbled and broken by the noise (one read, per-line offset), wider the darker it is,
// a thinner crossing set only in the deepest sun-averted shade (a cast shadow alone gets one direction).
// Where the sun's shadow map crosses 0.5 (a cast shadow's edge, not a cloud's) a thin ink line is drawn.
// Both fade with stroke size on screen (no moire when zoomed out) and with distance; green surfaces get less.
const COMIC_PARS = /* glsl */ `
#ifdef MN_COMIC
#define MN_HATCH_PERIOD 0.4
// Antialiased line coverage for the coordinate c (1 = one period): w = width in periods, fw = fwidth(c).
float mnHatchLine( float c, float w, float fw ) {
  float e = 0.5 - abs( fract( c ) - 0.5 );
  return clamp( ( w * 0.5 - e ) / max( fw, 1e-4 ) + 0.5, 0.0, 1.0 ) * smoothstep( 0.0, 0.04, w );
}
#endif
`;
const comicPost = (mask) => /* glsl */ `
#ifdef MN_COMIC
{
  // Derivatives first (uniform control flow); the work below only runs where there is something to ink, so the
  // lit majority of the screen pays a few ops. mnInk = 0 (low tier) skips it all.
  float mnDark = 1.0 - mnSunLit;                                // shade + cast shadow: the first direction
  float mnDark2 = 1.0 - smoothstep( -0.6, -0.04, mnSunNdl );    // the surface's own back side: the crossing set
  vec3 mnWn = abs( inverseTransformDirection( normal, viewMatrix ) );
  // Dominant-axis plane: y = floor (x, z), x = wall facing x (z, y), z = wall facing z (x, y). The camera looks along a
  // diagonal, so on the floor the lines run along the world axes and on walls at 45 degrees: both read as "/" on screen.
  float mnAx = mnWn.y >= max( mnWn.x, mnWn.z ) ? 0.0 : ( mnWn.x >= mnWn.z ? 1.0 : 2.0 );
  vec3 mnQ = vMnRest;
  vec2 mnP = mnAx < 0.5 ? mnQ.xz : ( mnAx < 1.5 ? mnQ.zy : mnQ.xy );
  vec2 mnU = ( mnAx < 0.5 ? mnQ.xz : ( mnAx < 1.5 ? vec2( mnP.x + mnP.y, mnP.x - mnP.y ) : vec2( mnP.x - mnP.y, mnP.x + mnP.y ) ) * 0.7071 ) / MN_HATCH_PERIOD;
  float mnF1 = fwidth( mnU.x ) * 1.2, mnF2 = fwidth( mnU.y ) * 1.2;
  vec2 mnGx = dFdx( mnP * 0.2 ), mnGy = dFdy( mnP * 0.2 );
  float mnSdW = max( fwidth( mnSunShadow ), 1e-4 );
  float mnPx = 1.0 - smoothstep( 0.125, 0.2, max( mnF1, mnF2 ) ); // fades out under ~5 px per period
  float mnSd = abs( mnSunShadow - 0.5 ) / mnSdW;
  float mnM = mnInk * ( 1.0 - smoothstep( 45.0, 80.0, length( vViewPosition ) ) );
  if ( mnM > 0.01 && ( mnDark > 0.25 || mnSd < 2.0 ) ) {
    mnM *= ${mask};
    // Glowing surfaces (lava, embers, gems, lit windows) stay clean; grass is busy already (painted strokes): 40 % less.
    mnM *= 1.0 - smoothstep( 0.15, 0.6, max( max( totalEmissiveRadiance.r, totalEmissiveRadiance.g ), totalEmissiveRadiance.b ) );
    mnM *= 1.0 - 0.4 * smoothstep( 0.04, 0.2, diffuseColor.g - max( diffuseColor.r, diffuseColor.b ) );
    if ( mnDark > 0.25 && mnPx > 0.0 ) {
      // One noise read, shifted per line: wobble (+-0.06 u) from B, pen lifts from A (cell id: ~20 % of cells blank).
      float mnK = floor( mnU.x + 0.5 );
      vec4 mnN = textureGrad( mnNoiseTex, mnP * 0.2 + vec2( mnK * 0.37, mnK * 0.61 ) + mnAx * 0.29, mnGx, mnGy );
      float mnWob = ( mnN.b - 0.5 ) * 0.24 / MN_HATCH_PERIOD;
      float mnH = max(
        mnHatchLine( mnU.x + mnWob, 0.3 * smoothstep( 0.25, 1.0, mnDark ), mnF1 ) * ( 1.0 - smoothstep( 0.78, 0.86, mnN.a ) ),
        mnHatchLine( mnU.y - mnWob, 0.22 * smoothstep( 0.8, 1.0, mnDark2 ), mnF2 ) * ( 1.0 - smoothstep( 0.7, 0.78, mnN.r ) ) ) * mnPx;
      gl_FragColor.rgb = mix( gl_FragColor.rgb, gl_FragColor.rgb * 0.42, mnH * 0.7 * mnM );
    }
    // Cast-shadow edge: ink where the shadow factor crosses 0.5, only on surfaces that face the sun.
    float mnEdge = ( 1.0 - smoothstep( 0.8, 2.0, mnSd ) ) * smoothstep( 0.02, 0.22, mnSunNdl );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.07, 0.04, 0.14 ), mnEdge * 0.65 * mnM );
  }
}
#endif
`;

function definesFor(opts) {
  const d = {};
  if (opts.sway) d.MN_SWAY = '';
  if (opts.occluder) d.MN_OCCLUDER = '';
  if (opts.rim) d.MN_RIM = '';
  if (opts.glow) d.MN_GLOW = '';
  if (opts.softBand) d.MN_SOFT_BAND = '';
  if (opts.comic ?? !opts.softBand) d.MN_COMIC = ''; // comic shadows: on in the world, off on characters
  return d;
}

// Patch a MeshToonMaterial in place. opts: {sway, occluder, rim, glow, softBand, comic (hatching + shadow ink edge,
// default on unless softBand), hatchMask (GLSL float, 0 kills the comic ink; default 1.0), uniforms, fragPars, albedo, emissive,
// post (GLSL on the final color, before the glow mask), glowMask (GLSL expression for the bloom mask, default:
// bright emissive), key}
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
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + GLSL_BAND + GLSL_LIGHTS + FRAG_PARS + 'uniform vec3 mnRimColor;\nuniform float mnRimStr;\nuniform vec3 mnCharFill;\nuniform float mnGlowOut;\n' + COMIC_PARS + (opts.fragPars || ''))
      .replace('#include <gradientmap_pars_fragment>', BAND_PARS)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_OCCLUDE)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + (opts.albedo || ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (opts.emissive || '') + '\n#ifdef MN_GLOW\ntotalEmissiveRadiance += diffuseColor.rgb * vMnGlow * mnGlowAmt;\n#endif')
      .replace('#include <lights_fragment_begin>', 'float mnSunCloud = mnCloudShadow(vMnWorld.xz);\n' + lightsBegin())
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + FRAG_RIM)
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + comicPost(opts.hatchMask || '1.0') + (opts.post || '') + glowOut(opts.glowMask || 'smoothstep(0.35, 1.4, max(max(totalEmissiveRadiance.r, totalEmissiveRadiance.g), totalEmissiveRadiance.b))'));
  };
  mat.customProgramCacheKey = () => 'mn-toon-' + (opts.key || '') + JSON.stringify(definesFor(opts)) + (opts.hatchMask || '');
  return mat;
}

// Unlit glowing surface (lantern glass, coals, lit windows). userData.glow scales its bloom.
export function glowBasic(params, glow = 1) {
  const mat = new THREE.MeshBasicMaterial(params);
  const g = { value: glow };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.mnGlowAmt = g;
    sh.uniforms.mnGlowOut = U.mnGlowOut;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float mnGlowAmt;\nuniform float mnGlowOut;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + glowOut('mnGlowAmt'));
  };
  mat.customProgramCacheKey = () => 'mn-glow-basic';
  mat.userData.glow = g;
  return mat;
}

export function toon(params = {}, opts = {}) {
  const mat = new THREE.MeshToonMaterial(params);
  return patchToon(mat, opts);
}

// Normal-pass material that repeats the same vertex motion and occluder discard as its toon twin.
// Its alpha is the ink line weight (opts.lineW: world 0.5, characters 1): the composite reads it to ink
// characters heavier. meshnormal's `#ifdef OPAQUE` forces a = 1, so the weight is written last in main().
export function normalMatFor(opts = {}, side = THREE.FrontSide) {
  const mat = new THREE.MeshNormalMaterial({ side });
  const lineW = (opts.lineW ?? 0.5).toFixed(3);
  mat.defines = { ...definesFor(opts), MN_LINE_W: lineW };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    if (opts.sway) sh.uniforms.mnSwayAmt = opts.swayUniform || { value: 0.18 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_SWAY)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_WORLD);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', GLSL_COMMON + FRAG_PARS + 'void main() {')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_OCCLUDE)
      .replace(/\}\s*$/, '\tgl_FragColor.a = MN_LINE_W;\n}');
  };
  mat.customProgramCacheKey = () => 'mn-normal-' + JSON.stringify(definesFor(opts)) + side + lineW;
  return mat;
}

// Shared normal-pass materials without sway or occlusion: world weight 0.5 (the pipeline's default, small
// pickups, debris) and characters 1. The character one is attached to the toon material (userData.nm, see
// characterMaterial) so the skinned views, crab, dummy and cannon all pick it up.
let WORLD_NM = null;
export function worldNormalMat() { return WORLD_NM || (WORLD_NM = normalMatFor({})); }
// Characters, skinned or not: line weight 1.
let CHAR_NM = null;
export function charNormalMat() { return CHAR_NM || (CHAR_NM = normalMatFor({ lineW: 1 })); }

// Convenience: toon + paired normal material assigned to the mesh.
export function toonMesh(geo, params, opts = {}, MeshClass = THREE.Mesh, count) {
  const mat = toon(params, opts);
  const mesh = count !== undefined ? new MeshClass(geo, mat, count) : new MeshClass(geo, mat);
  if (opts.sway || opts.occluder || params.side === THREE.DoubleSide) mesh.userData.nm = normalMatFor(opts, params.side ?? THREE.FrontSide);
  return mesh;
}
