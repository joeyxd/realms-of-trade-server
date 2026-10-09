// Frame pipeline (medium/high):
//   1 normal+depth pass (outlined world)      → rtNormal (+DepthTexture: opaque scene depth)
//   2 opaque color (world + no-outline)       → rtMain
//   3 outline composite                       → rtPost
//   4 half-res copy of rtPost                 → rtRefract   (what the water refracts)
//   5 water (refraction, absorption, foam)    → rtPost      (manual depth test vs rtNormal)
//   6 FX layer with soft depth                → rtPost
//   7 bloom: extract glow (½) → down ¼ ⅛ 1/16 → up back to ½ (additive)
//   8 bloom + grading (contrast, split tone) + AA + dither → screen
// Low: opaque → screen, cheap alpha water (heightmap depth) → screen, FX → screen (no grading, no bloom).
// Layers: 0 world (outlined) · 1 FX · 2 world without outline (sky, blobs, flowers) · 3 water.
//
// Glow mask: the alpha channel of rtMain / rtPost holds 1 - glow. Opaque materials write 1 (no glow)
// by default; emissive toon surfaces (lava, cracks, gems), lantern glass, coals, lit windows, the
// moon and stars, light glints on the water, additive particles and dash afterimages lower it.
// Alpha-blended FX (smoke, dust) raise it back, so smoke in front of a fire hides its glow.
import * as THREE from 'three';
import { tuning } from '../data/tuning.js';
import { worldNormalMat } from './toon.js';

export const LAYER = { WORLD: 0, FX: 1, NO_OUTLINE: 2, WATER: 3 };

// Shared uniforms for FX materials (soft particles against the scene depth).
export const FXU = {
  uDepth: { value: null },
  uRes: { value: new THREE.Vector2(1, 1) },
  uNear: { value: 0.5 },
  uFar: { value: 1200 },
  uUseDepth: { value: 0 },
  uFxLight: { value: new THREE.Color(1, 1, 1) }, // ambient light on lit FX (smoke, dust, foam rings)
};

// Shared uniforms for the water pass.
export const WATERU = {
  tRefract: { value: null },
  tSceneDepth: { value: null },
  uSceneRes: { value: new THREE.Vector2(1, 1) },
  uNear: { value: 0.5 },
  uFar: { value: 1200 },
};

export const GLSL_FX_DEPTH = /* glsl */ `
#include <packing>
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uUseDepth;
uniform vec3 uFxLight;
// Returns 0..1 visibility against the opaque scene (soft over 'soft' world units).
float fxDepthFade(float soft) {
  if (uUseDepth < 0.5) return 1.0;
  float sd = texture2D(uDepth, gl_FragCoord.xy / uRes).r;
  float sceneZ = -perspectiveDepthToViewZ(sd, uNear, uFar);
  float fragZ = -perspectiveDepthToViewZ(gl_FragCoord.z, uNear, uFar);
  return clamp((sceneZ - fragZ) / soft, 0.0, 1.0);
}
// Ground decals: lying on the terrain, they stay visible over it and hide only behind things more than
// 'bias' world units in front of them.
float fxDepthFadeBias(float soft, float bias) {
  if (uUseDepth < 0.5) return 1.0;
  float sd = texture2D(uDepth, gl_FragCoord.xy / uRes).r;
  float sceneZ = -perspectiveDepthToViewZ(sd, uNear, uFar);
  float fragZ = -perspectiveDepthToViewZ(gl_FragCoord.z, uNear, uFar);
  return clamp((sceneZ - fragZ + bias) / soft, 0.0, 1.0);
}
`;

const FS_QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Ink. tNormal.rgb = view normal, .a = line weight (world 0.5, characters 1; 0 where nothing was drawn).
// World: depth silhouettes (radius 1.5x, both sides) and normal creases (0.5x, thin), faded with distance.
// Characters (weight > 0.75) are inked heavier but on the OUTSIDE: any non-character pixel with a character
// within 2.5x (axis taps) is ink, so the heavy line grows around the figure and its colors stay (a two-sided
// line of that width swallows limbs). Inside: only a thin contour. Character against character keeps the
// depth edge. Never faded. 12 + 4 texture reads per pixel, no extra pass.
const COMPOSITE_FRAG = /* glsl */ `
#include <packing>
// Line widths in uThick units: world silhouette (both sides), character silhouette (inside / outside); the crease
// width is a uniform (0.5, 0.7 on Ultra).
const float W_SIL = 1.5, W_CHAR_IN = 0.8, W_CHAR_OUT = 2.5;
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear, uFar, uThick, uDepthThr, uNormalThr, uFadeNear, uFadeFar, uCreaseW;
uniform vec3 uOutline;
varying vec2 vUv;
float linD(float raw) { return -perspectiveDepthToViewZ(raw, uNear, uFar); }
float linD(vec2 uv) { return linD(texture2D(tDepth, uv).r); }
void main() {
  vec4 src = texture2D(tColor, vUv);
  vec3 col = src.rgb;
  float rawC = texture2D(tDepth, vUv).r;
  float dc = linD(rawC);
  vec4 tc = texture2D(tNormal, vUv);
  vec3 nc = tc.rgb * 2.0 - 1.0;
  float hasGeo = step(rawC, 0.999999);
  float cw = step(0.75, tc.a); // this pixel belongs to a character
  // Silhouettes: depth jumps. Wide around the world, thin inside a character (its heavy line is drawn outside).
  vec2 o = uTexel * uThick * mix(W_SIL, W_CHAR_IN, cw);
  float d1 = linD(vUv + o), d2 = linD(vUv - o);
  float d3 = linD(vUv + vec2(-o.x, o.y)), d4 = linD(vUv + vec2(o.x, -o.y));
  float dmin = min(min(min(d1, d2), min(d3, d4)), dc);
  float g = sqrt((d1 - d2) * (d1 - d2) + (d3 - d4) * (d3 - d4));
  float ndv = hasGeo > 0.5 ? clamp(abs(nc.z), 0.0, 1.0) : 1.0;
  float thr = uDepthThr * dmin * (1.0 + 5.0 * (1.0 - ndv));
  float de = smoothstep(thr, thr * 1.7, g);
  // Creases: normal jumps, thin.
  vec2 o1 = uTexel * max(1.0, uThick * uCreaseW);
  vec4 t1 = texture2D(tNormal, vUv + o1), t2 = texture2D(tNormal, vUv - o1);
  vec4 t3 = texture2D(tNormal, vUv + vec2(-o1.x, o1.y)), t4 = texture2D(tNormal, vUv + vec2(o1.x, -o1.y));
  float ng = (length(t1.rgb - t2.rgb) + length(t3.rgb - t4.rgb)) * 2.0; // packed *0.5 + 0.5: back to normal scale
  float ne = smoothstep(uNormalThr, uNormalThr * 1.6, ng) * hasGeo;
  // Characters: weight alpha. Outside = a character within the wide footprint; inside = thin contour.
  vec2 oc = uTexel * max(2.0, floor(uThick * W_CHAR_OUT + 0.5)); // whole texels: crisp taps, no bilinear mixing
  float w5 = texture2D(tNormal, vUv + vec2(oc.x, 0.0)).a, w6 = texture2D(tNormal, vUv - vec2(oc.x, 0.0)).a;
  float w7 = texture2D(tNormal, vUv + vec2(0.0, oc.y)).a, w8 = texture2D(tNormal, vUv - vec2(0.0, oc.y)).a;
  float wHi = max(max(max(t1.a, t2.a), max(t3.a, t4.a)), max(max(w5, w6), max(w7, w8)));
  float wLo = min(min(t1.a, t2.a), min(t3.a, t4.a));
  float charEdge = max((1.0 - cw) * smoothstep(0.7, 0.8, wHi), cw * (1.0 - smoothstep(0.7, 0.8, wLo)));
  float world = max(de, ne * 0.8) * (1.0 - smoothstep(uFadeNear, uFadeFar, dmin));
  float edge = clamp(max(world, charEdge), 0.0, 1.0);
  col = mix(col, uOutline, edge);
  gl_FragColor = vec4(col, mix(src.a, 1.0, edge)); // ink never glows
  #include <colorspace_fragment>
}
`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D tInput;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(tInput, vUv).rgb, 1.0);
  #include <colorspace_fragment>
}
`;

// Bloom. Extract: glow-masked color, 4 bilinear taps (a box over the source footprint, no flicker).
const BLOOM_EXTRACT = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uOff;
varying vec2 vUv;
vec3 tap(vec2 uv) { vec4 c = texture2D(tInput, uv); return c.rgb * (1.0 - c.a); }
void main() {
  vec3 s = tap(vUv + vec2(-uOff.x, -uOff.y)) + tap(vUv + vec2(uOff.x, -uOff.y)) + tap(vUv + vec2(-uOff.x, uOff.y)) + tap(vUv + uOff);
  gl_FragColor = vec4(s * 0.25, 1.0);
}
`;
// Dual-filter (Kawase) down and up; the up pass is added onto the next bigger level.
const BLOOM_DOWN = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tInput, vUv).rgb * 4.0;
  s += texture2D(tInput, vUv - uTexel).rgb + texture2D(tInput, vUv + uTexel).rgb;
  s += texture2D(tInput, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(tInput, vUv - vec2(uTexel.x, -uTexel.y)).rgb;
  gl_FragColor = vec4(s * 0.125, 1.0);
}
`;
const BLOOM_UP = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
vec3 t(vec2 o) { return texture2D(tInput, vUv + o * uTexel).rgb; }
void main() {
  vec3 s = t(vec2(-2.0, 0.0)) + t(vec2(2.0, 0.0)) + t(vec2(0.0, -2.0)) + t(vec2(0.0, 2.0));
  s += (t(vec2(-1.0, 1.0)) + t(vec2(1.0, 1.0)) + t(vec2(1.0, -1.0)) + t(vec2(-1.0, -1.0))) * 2.0;
  gl_FragColor = vec4(s * (uWeight / 12.0), 1.0);
}
`;

// Final: bloom, grading (S-curve contrast, split toning, saturation, vignette, danger, capped screen flash,
// slow-mo chroma) and
// FXAA (medium) or bilinear downsample of the supersampled buffer (high), + output color space.
// Ultra (uComic = 1): +0.08 contrast and saturation, a vignette toward ink instead of black, a static paper grain,
// the impact frame (uImpact: two-tone ink and paper print in the hit's colour) and radial speed lines (uLines)
// from uLinesPos. One branch on a uniform; nothing else costs anything when it is 0.
const FINAL_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uFxaa;
uniform float uVignette, uSat, uChroma, uDanger, uFlash, uContrast, uSplit, uBloom;
uniform vec3 uFlashColor, uSplitShadow, uSplitHigh;
uniform float uComic, uImpact, uLines, uSeed;
uniform vec2 uImpactPos, uLinesPos;
uniform vec3 uImpactCol;
float cHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
uniform sampler2D tBloom;
uniform int uView;
varying vec2 vUv;
vec3 fxaa(vec2 uv) {
  vec3 rgbNW = texture2D(tInput, uv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture2D(tInput, uv + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture2D(tInput, uv + vec2(-1.0, 1.0) * uTexel).rgb;
  vec3 rgbSE = texture2D(tInput, uv + vec2(1.0, 1.0) * uTexel).rgb;
  vec3 rgbM = texture2D(tInput, uv).rgb;
  vec3 luma = vec3(0.299, 0.587, 0.114);
  float lNW = dot(sqrt(rgbNW), luma), lNE = dot(sqrt(rgbNE), luma), lSW = dot(sqrt(rgbSW), luma), lSE = dot(sqrt(rgbSE), luma), lM = dot(sqrt(rgbM), luma);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
  vec3 a = 0.5 * (texture2D(tInput, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tInput, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tInput, uv - dir * 0.5).rgb + texture2D(tInput, uv + dir * 0.5).rgb);
  float lB = dot(sqrt(b), luma);
  return (lB < lMin || lB > lMax) ? a : b;
}
void main() {
  float comic = step(0.5, uComic);
  vec3 col = uFxaa > 0.5 ? fxaa(vUv) : texture2D(tInput, vUv).rgb;
  if (uChroma > 0.0001) {
    vec2 dir = (vUv - 0.5) * uChroma;
    col.r = texture2D(tInput, vUv + dir).r;
    col.b = texture2D(tInput, vUv - dir).b;
  }
  vec3 bloom = texture2D(tBloom, vUv).rgb * uBloom * 0.2; // levels summed: a uniform glowing area gains ~uBloom×
  if (uView == 1) { gl_FragColor = vec4(bloom, 1.0); return; }
  if (uView == 2) { gl_FragColor = vec4(vec3(1.0 - texture2D(tInput, vUv).a), 1.0); return; }
  col += bloom;
  // Grade in a perceptual (≈ gamma 2) space: S-curve contrast, then shadows toward one hue and
  // highlights toward another (luma-neutral tints), then saturation.
  vec3 lw = vec3(0.2126, 0.7152, 0.0722);
  vec3 p = sqrt(max(col, 0.0));
  p = mix(p, p * p * (3.0 - 2.0 * p), uContrast + 0.08 * comic);
  float pl = dot(p, lw);
  p += (uSplitShadow - dot(uSplitShadow, lw)) * (1.0 - smoothstep(0.05, 0.55, pl)) * uSplit;
  p += (uSplitHigh - dot(uSplitHigh, lw)) * smoothstep(0.45, 0.95, pl) * uSplit;
  col = max(p, 0.0);
  col *= col;
  float l = dot(col, lw);
  col = mix(vec3(l), col, uSat + 0.08 * comic);
  float r = length((vUv - 0.5) * vec2(1.25, 1.0));
  const vec3 INK = vec3(0.07, 0.04, 0.14);
  float vig = uVignette * smoothstep(0.42, 0.95, r);
  col = comic > 0.5 ? mix(col, INK, vig) : col * (1.0 - vig);
  col = mix(col, col * vec3(1.0, 0.35, 0.3) + vec3(0.25, 0.0, 0.0), uDanger * smoothstep(0.35, 0.9, r));
  col = 1.0 - (1.0 - col) * (1.0 - min(uFlash, 0.8) * uFlashColor);
  if (uComic > 0.5) {
    // Paper grain: static, in screen pixels (2 px blocks), +-1.25 %.
    col *= 1.0 - 0.025 * (cHash(floor(gl_FragCoord.xy / 2.0)) - 0.5);
    // Impact frame: the picture as a two-tone print (paper where it is light, ink tinted by the hit's colour where dark).
    if (uImpact > 0.001) {
      float L = dot(sqrt(max(col, 0.0)), lw);
      // The print's colours are display values (squared into the linear buffer): near-black ink, a hint of the hit's colour, cream paper.
      vec3 dark = mix(INK, sqrt(uImpactCol) * 0.4, 0.25), paper = vec3(0.98, 0.95, 0.86);
      vec3 print = mix(dark * dark, paper * paper, smoothstep(0.43, 0.47, L));
      col = mix(col, print, uImpact * 0.9);
    }
    // Speed lines: ~56 angular sectors round the hit, ~30 % of them hold a wedge that widens outward, starting
    // 0.16-0.3 screen heights out. No loops, no texture reads.
    if (uLines > 0.001) {
      vec2 d = (vUv - uLinesPos) * vec2(uTexel.y / uTexel.x, 1.0);
      float rr = length(d);
      float sec = atan(d.y, d.x) * (56.0 / 6.2831853);
      float id = floor(sec);
      float h = cHash(vec2(id, uSeed));
      if (h < 0.3 && rr > 0.12) {
        float h2 = fract(h * 91.7), h3 = fract(h * 37.3);
        float rIn = mix(0.16, 0.3, h2);
        float halfW = mix(0.12, 0.34, h3) * smoothstep(rIn, rIn + 0.55, rr); // in sector units, 0 at the tip
        float aa = uTexel.y / max(rr, 0.05) * (56.0 / 6.2831853) * 0.9;
        float line = (1.0 - smoothstep(halfW - aa, halfW + aa, abs(fract(sec) - 0.5))) * smoothstep(rIn - 0.01, rIn + 0.02, rr);
        col = mix(col, INK, line * uLines * 0.6);
      }
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  // Dither to 8 bits (interleaved gradient noise): no banding in dark skies and glow halos.
  gl_FragColor.rgb += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
}
`;

function fsQuad(material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { scene, mesh };
}

export class Pipeline {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.q = { pixelRatio: 1, ss: 1, outlines: true, fxaa: true, comic: 0, outlineMul: 1 };
    this.hit = { frames: 0, lastT: -1e9, linesK: 0, linesT: 0 }; // comic impact state (impact())
    this.size = new THREE.Vector2(1, 1);
    this.defaultNormal = worldNormalMat(); // line weight 0.5
    this.casters = [];
    this.castersDirty = true;
    this.frame = 0;
    this.water = null; // { setMode(ssr) } provided by the scene
    this.grading = {
      vignette: 0.22, sat: 1.07, chroma: 0, danger: 0, flash: 0, flashColor: new THREE.Color(1, 1, 1),
      contrast: 0, split: 0, splitShadow: new THREE.Color(0x5a4aa0), splitHigh: new THREE.Color(0xffd9a0), bloom: 0,
    };
    this.view = 0; // debug: 1 = bloom only, 2 = glow mask
    this.fxHeight = 1; // pixel height of the target FX draw into (point sprite scale)

    this.rtMain = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
    this.rtMain.texture.colorSpace = THREE.SRGBColorSpace;
    this.rtNormal = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
    this.rtNormal.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.rtPost = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.rtPost.texture.colorSpace = THREE.SRGBColorSpace;
    this.rtRefract = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.rtRefract.texture.colorSpace = THREE.SRGBColorSpace;

    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rtMain.texture }, tNormal: { value: this.rtNormal.texture }, tDepth: { value: this.rtNormal.depthTexture },
        uTexel: { value: new THREE.Vector2() }, uNear: { value: camera.near }, uFar: { value: camera.far },
        uThick: { value: 2 }, uDepthThr: { value: 0.022 }, uNormalThr: { value: 0.55 },
        uFadeNear: { value: 90 }, uFadeFar: { value: 210 }, uCreaseW: { value: 0.5 }, uOutline: { value: new THREE.Color(tuning.visual.outlineColor) },
      },
      vertexShader: FS_QUAD_VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
    });
    this.copy = new THREE.ShaderMaterial({
      uniforms: { tInput: { value: this.rtPost.texture } },
      vertexShader: FS_QUAD_VERT, fragmentShader: COPY_FRAG, depthTest: false, depthWrite: false,
    });
    this.final = new THREE.ShaderMaterial({
      uniforms: {
        tInput: { value: this.rtPost.texture }, uTexel: { value: new THREE.Vector2() }, uFxaa: { value: 1 },
        uVignette: { value: 0.22 }, uSat: { value: 1.07 }, uChroma: { value: 0 }, uDanger: { value: 0 },
        uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1, 1, 1) },
        uContrast: { value: 0 }, uSplit: { value: 0 }, uSplitShadow: { value: new THREE.Color() }, uSplitHigh: { value: new THREE.Color() },
        tBloom: { value: null }, uBloom: { value: 0 }, uView: { value: 0 },
        uComic: { value: 0 }, uImpact: { value: 0 }, uImpactPos: { value: new THREE.Vector2(0.5, 0.5) }, uImpactCol: { value: new THREE.Color(1, 1, 1) },
        uLines: { value: 0 }, uLinesPos: { value: new THREE.Vector2(0.5, 0.5) }, uSeed: { value: 0 },
      },
      vertexShader: FS_QUAD_VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false,
    });
    // Bloom chain: ½, ¼, ⅛, 1/16 of the screen. Half float when the GPU can render to it (no banding).
    const ext = renderer.extensions;
    const half = renderer.capabilities.isWebGL2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    this.bloomRT = Array.from({ length: 4 }, () => new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, type: half ? THREE.HalfFloatType : THREE.UnsignedByteType }));
    const bm = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ uniforms, vertexShader: FS_QUAD_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, ...extra });
    this.bloomExtract = bm(BLOOM_EXTRACT, { tInput: { value: this.rtPost.texture }, uOff: { value: new THREE.Vector2() } });
    this.bloomDown = bm(BLOOM_DOWN, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.bloomUp = bm(BLOOM_UP, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } },
      { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation });
    this.bloomQuad = fsQuad(this.bloomExtract);
    this.bloomWeights = [1, 1.25, 1.5]; // how much each wider level adds onto the next (wide haze > tight core)
    this.final.uniforms.tBloom.value = this.bloomRT[0].texture;
    this.compQuad = fsQuad(this.composite);
    this.copyQuad = fsQuad(this.copy);
    this.finalQuad = fsQuad(this.final);
    this.clearColor = new THREE.Color(0xb9e6f2);
    FXU.uDepth.value = this.rtNormal.depthTexture;
    WATERU.tSceneDepth.value = this.rtNormal.depthTexture;
    WATERU.tRefract.value = this.rtRefract.texture;
  }

  setQuality(q) {
    Object.assign(this.q, q);
    // Ultra inks bolder: creases 0.5 -> 0.7 and the world's lines hold out to 140 / 320 u instead of 90 / 210.
    const ultra = this.q.comic > 0, cu = this.composite.uniforms;
    cu.uCreaseW.value = ultra ? 0.7 : 0.5;
    cu.uFadeNear.value = ultra ? 140 : 90; cu.uFadeFar.value = ultra ? 320 : 210;
    this.final.uniforms.uComic.value = ultra ? 1 : 0;
    if (!ultra) { this.hit.frames = 0; this.hit.linesT = 0; }
    if (this.water) this.water.setMode(this.q.outlines);
    this.resize(this.size.x, this.size.y);
  }

  resize(w, h) {
    this.size.set(w, h);
    const r = this.renderer;
    r.setPixelRatio(this.q.pixelRatio);
    r.setSize(w, h, false);
    const pr = r.getPixelRatio();
    const bw = Math.max(1, Math.floor(w * pr)), bh = Math.max(1, Math.floor(h * pr));
    const sw = Math.max(1, Math.floor(bw * this.q.ss)), sh = Math.max(1, Math.floor(bh * this.q.ss));
    this.rtMain.setSize(sw, sh);
    this.rtNormal.setSize(sw, sh);
    // Low-mode FX can bind the depth sampler before this framebuffer is used again.
    // Keep its storage dimensions aligned now, preserving every shared sampler binding.
    const depth = this.rtNormal.depthTexture;
    if (depth.image.width !== sw || depth.image.height !== sh) {
      depth.dispose(); // A low-only session may have allocated the sampler before the FBO.
      depth.image.width = sw; depth.image.height = sh;
      depth.needsUpdate = true;
    }
    this.rtPost.setSize(sw, sh);
    this.rtRefract.setSize(Math.max(1, sw >> 1), Math.max(1, sh >> 1));
    this.composite.uniforms.uTexel.value.set(1 / sw, 1 / sh);
    // Outline thickness scales with resolution so it reads the same on 720p and 4K.
    this.composite.uniforms.uThick.value = Math.max(1, Math.round((sh / 1080) * 2.2 * 10) / 10) * (this.q.outlineMul || 1);
    this.final.uniforms.uTexel.value.set(1 / sw, 1 / sh);
    this.final.uniforms.uFxaa.value = this.q.fxaa && this.q.ss <= 1 ? 1 : 0;
    let bx = bw, by = bh;
    for (const rt of this.bloomRT) { bx = Math.max(1, Math.ceil(bx / 2)); by = Math.max(1, Math.ceil(by / 2)); rt.setSize(bx, by); }
    this.bloomExtract.uniforms.uOff.value.set(0.5 / this.bloomRT[0].width, 0.5 / this.bloomRT[0].height);
    // FX draw into rtPost (supersampled) on medium/high, straight to the screen on low.
    if (this.q.outlines) { FXU.uRes.value.set(sw, sh); this.fxHeight = sh; } else { FXU.uRes.value.set(bw, bh); this.fxHeight = bh; }
    WATERU.uSceneRes.value.set(sw, sh);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  markDirty() { this.castersDirty = true; }

  // Per frame (real dt): the speed lines fade out over 0.3 s.
  update(dt) {
    const h = this.hit;
    if (h.linesT > 0) h.linesT = Math.max(0, h.linesT - dt);
  }

  // A comic hit at screen position (uvx, uvy in 0..1, y up) in `color` (hex or THREE.Color). Ultra only (else ignored).
  // frame: the two-frame ink-and-paper impact (at most one every 0.4 s); lines: speed lines' strength 0..1, fading in 0.3 s
  // (they can retrigger as often as you like).
  impact(uvx, uvy, color = 0xffffff, { lines = 1, frame = true } = {}) {
    if (!(this.q.comic > 0) || !this.q.outlines) return;
    const h = this.hit, fu = this.final.uniforms, now = performance.now();
    if (frame && now - h.lastT >= 400) {
      h.lastT = now; h.frames = 2;
      fu.uImpactPos.value.set(uvx, uvy);
      fu.uImpactCol.value.set(color);
    }
    if (lines > 0) {
      h.linesK = lines; h.linesT = 0.3;
      fu.uLinesPos.value.set(uvx, uvy);
      fu.uSeed.value = Math.random() * 97;
    }
  }

  collectCasters() {
    this.casters.length = 0;
    this.scene.traverse((o) => {
      if ((o.isMesh || o.isInstancedMesh) && o.layers.isEnabled(LAYER.WORLD)) this.casters.push(o);
    });
    this.castersDirty = false;
  }

  render() {
    const r = this.renderer, cam = this.camera, scene = this.scene;
    this.frame++;
    FXU.uNear.value = WATERU.uNear.value = cam.near;
    FXU.uFar.value = WATERU.uFar.value = cam.far;
    const worldLayers = () => { cam.layers.set(LAYER.WORLD); cam.layers.enable(LAYER.NO_OUTLINE); };

    if (!this.q.outlines) {
      FXU.uUseDepth.value = 0;
      r.autoClear = true;
      r.setRenderTarget(null);
      r.setClearColor(this.clearColor, 1);
      worldLayers();
      r.shadowMap.needsUpdate = true;
      r.render(scene, cam);
      r.autoClear = false;
      cam.layers.set(LAYER.WATER);
      r.render(scene, cam);
      cam.layers.set(LAYER.FX);
      r.render(scene, cam);
      worldLayers();
      r.autoClear = true;
      return;
    }

    // 1) Normals + opaque depth (outlined layer), with paired materials.
    if (this.castersDirty || this.frame % 90 === 0) this.collectCasters();
    const list = this.casters;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const mat = m.material;
      m.userData._m = mat;
      m.material = m.userData.nm || (mat.userData && mat.userData.nm) || this.defaultNormal; // mesh pair, else its material's (characters)
    }
    r.autoClear = true;
    cam.layers.set(LAYER.WORLD);
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rtNormal);
    r.render(scene, cam);
    for (let i = 0; i < list.length; i++) { const m = list[i]; m.material = m.userData._m; m.userData._m = null; }

    // 2) Opaque color (shadow map refreshed once, here).
    r.setClearColor(this.clearColor, 1);
    worldLayers();
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.rtMain);
    r.render(scene, cam);

    // 3) Outlines.
    const cu = this.composite.uniforms;
    cu.uNear.value = cam.near; cu.uFar.value = cam.far;
    r.setRenderTarget(this.rtPost);
    r.render(this.compQuad.scene, this.quadCam);

    // 4) Half-res copy for refraction.
    r.setRenderTarget(this.rtRefract);
    r.render(this.copyQuad.scene, this.quadCam);

    // 5) Water on top of the outlined opaque image.
    r.autoClear = false;
    r.setRenderTarget(this.rtPost);
    cam.layers.set(LAYER.WATER);
    r.render(scene, cam);
    r.autoClear = true;

    // 6) FX with soft depth against the scene (rtPost has no depth buffer; FX test depth in the shader).
    FXU.uUseDepth.value = 1;
    r.autoClear = false;
    cam.layers.set(LAYER.FX);
    r.render(scene, cam);
    r.autoClear = true;

    // 7) Bloom.
    const g = this.grading;
    const bloomOn = g.bloom > 0.005 || this.view === 1;
    if (bloomOn) this.renderBloom();

    // 8) Bloom + grading + AA to the screen.
    const fu = this.final.uniforms;
    fu.uVignette.value = g.vignette; fu.uSat.value = g.sat; fu.uChroma.value = g.chroma;
    fu.uDanger.value = g.danger; fu.uFlash.value = g.flash; fu.uFlashColor.value.copy(g.flashColor);
    fu.uContrast.value = g.contrast; fu.uSplit.value = g.split;
    fu.uSplitShadow.value.copy(g.splitShadow); fu.uSplitHigh.value.copy(g.splitHigh);
    fu.uBloom.value = bloomOn ? Math.max(g.bloom, this.view === 1 ? 1 : 0) : 0;
    fu.uView.value = this.view;
    const hit = this.hit;
    fu.uImpact.value = hit.frames > 0 ? 1 : 0;
    fu.uLines.value = hit.linesT > 0 ? hit.linesK * (hit.linesT / 0.3) : 0;
    if (hit.frames > 0) hit.frames--;
    r.setRenderTarget(null);
    r.render(this.finalQuad.scene, this.quadCam);
    worldLayers();
  }

  renderBloom() {
    const r = this.renderer, q = this.bloomQuad, rt = this.bloomRT;
    const pass = (mat, target) => { q.mesh.material = mat; r.setRenderTarget(target); r.render(q.scene, this.quadCam); };
    r.autoClear = true;
    pass(this.bloomExtract, rt[0]);
    const du = this.bloomDown.uniforms;
    for (let i = 1; i < rt.length; i++) {
      du.tInput.value = rt[i - 1].texture;
      du.uTexel.value.set(1 / rt[i - 1].width, 1 / rt[i - 1].height);
      pass(this.bloomDown, rt[i]);
    }
    // Up: each level adds a tent-filtered copy of the smaller one (tight core + wide falloff).
    r.autoClear = false;
    const uu = this.bloomUp.uniforms;
    for (let i = rt.length - 1; i > 0; i--) {
      uu.tInput.value = rt[i].texture;
      uu.uTexel.value.set(0.5 / rt[i].width, 0.5 / rt[i].height);
      uu.uWeight.value = this.bloomWeights[i - 1];
      pass(this.bloomUp, rt[i - 1]);
    }
    r.autoClear = true;
  }
}
