// Frame pipeline (medium/high):
//   1 normal+depth pass (outlined world)      → rtNormal (+DepthTexture: opaque scene depth)
//   2 opaque color (world + no-outline)       → rtMain
//   3 outline composite                       → rtPost
//   4 half-res copy of rtPost                 → rtRefract   (what the water refracts)
//   5 water (refraction, absorption, foam)    → rtPost      (manual depth test vs rtNormal)
//   6 grading + AA / downsample               → screen
//   7 FX layer with soft depth                → screen
// Low: opaque → screen, cheap alpha water (heightmap depth) → screen, FX → screen.
// Layers: 0 world (outlined) · 1 FX · 2 world without outline (sky, blobs, flowers) · 3 water.
import * as THREE from 'three';
import { tuning } from '../data/tuning.js';

export const LAYER = { WORLD: 0, FX: 1, NO_OUTLINE: 2, WATER: 3 };

// Shared uniforms for FX materials (soft particles against the scene depth).
export const FXU = {
  uDepth: { value: null },
  uRes: { value: new THREE.Vector2(1, 1) },
  uNear: { value: 0.5 },
  uFar: { value: 1200 },
  uUseDepth: { value: 0 },
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
// Returns 0..1 visibility against the opaque scene (soft over 'soft' world units).
float fxDepthFade(float soft) {
  if (uUseDepth < 0.5) return 1.0;
  float sd = texture2D(uDepth, gl_FragCoord.xy / uRes).r;
  float sceneZ = -perspectiveDepthToViewZ(sd, uNear, uFar);
  float fragZ = -perspectiveDepthToViewZ(gl_FragCoord.z, uNear, uFar);
  return clamp((sceneZ - fragZ) / soft, 0.0, 1.0);
}
`;

const FS_QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const COMPOSITE_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear, uFar, uThick, uDepthThr, uNormalThr, uFadeNear, uFadeFar;
uniform vec3 uOutline;
varying vec2 vUv;
float linD(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).r, uNear, uFar); }
vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).rgb * 2.0 - 1.0; }
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float rawC = texture2D(tDepth, vUv).r;
  float dc = linD(vUv);
  vec3 nc = nrm(vUv);
  float hasGeo = step(rawC, 0.999999);
  vec2 o = uTexel * uThick;
  float d1 = linD(vUv + o), d2 = linD(vUv - o);
  float d3 = linD(vUv + vec2(-o.x, o.y)), d4 = linD(vUv + vec2(o.x, -o.y));
  float dmin = min(min(min(d1, d2), min(d3, d4)), dc);
  float g = sqrt((d1 - d2) * (d1 - d2) + (d3 - d4) * (d3 - d4));
  float ndv = hasGeo > 0.5 ? clamp(abs(nc.z), 0.0, 1.0) : 1.0;
  float thr = uDepthThr * dmin * (1.0 + 5.0 * (1.0 - ndv));
  float de = smoothstep(thr, thr * 1.7, g);
  vec2 o1 = uTexel * max(1.0, uThick * 0.5);
  vec3 n1 = nrm(vUv + o1), n2 = nrm(vUv - o1), n3 = nrm(vUv + vec2(-o1.x, o1.y)), n4 = nrm(vUv + vec2(o1.x, -o1.y));
  float ng = length(n1 - n2) + length(n3 - n4);
  float ne = smoothstep(uNormalThr, uNormalThr * 1.6, ng) * hasGeo;
  float edge = max(de, ne * 0.8);
  edge *= 1.0 - smoothstep(uFadeNear, uFadeFar, dmin);
  col = mix(col, uOutline, clamp(edge, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
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

// Final: grading (saturation, vignette, danger, capped screen flash, slow-mo chroma) and
// FXAA (medium) or bilinear downsample of the supersampled buffer (high), + output color space.
const FINAL_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uFxaa;
uniform float uVignette, uSat, uChroma, uDanger, uFlash;
uniform vec3 uFlashColor;
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
  vec3 col = uFxaa > 0.5 ? fxaa(vUv) : texture2D(tInput, vUv).rgb;
  if (uChroma > 0.0001) {
    vec2 dir = (vUv - 0.5) * uChroma;
    col.r = texture2D(tInput, vUv + dir).r;
    col.b = texture2D(tInput, vUv - dir).b;
  }
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  float r = length((vUv - 0.5) * vec2(1.25, 1.0));
  col *= 1.0 - uVignette * smoothstep(0.42, 0.95, r);
  col = mix(col, col * vec3(1.0, 0.35, 0.3) + vec3(0.25, 0.0, 0.0), uDanger * smoothstep(0.35, 0.9, r));
  col = 1.0 - (1.0 - col) * (1.0 - min(uFlash, 0.8) * uFlashColor);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
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
    this.q = { pixelRatio: 1, ss: 1, outlines: true, fxaa: true };
    this.size = new THREE.Vector2(1, 1);
    this.defaultNormal = new THREE.MeshNormalMaterial();
    this.casters = [];
    this.castersDirty = true;
    this.frame = 0;
    this.water = null; // { setMode(ssr) } provided by the scene
    this.grading = { vignette: 0.22, sat: 1.07, chroma: 0, danger: 0, flash: 0, flashColor: new THREE.Color(1, 1, 1) };

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
        uFadeNear: { value: 70 }, uFadeFar: { value: 170 }, uOutline: { value: new THREE.Color(tuning.visual.outlineColor) },
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
      },
      vertexShader: FS_QUAD_VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false,
    });
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
    this.rtPost.setSize(sw, sh);
    this.rtRefract.setSize(Math.max(1, sw >> 1), Math.max(1, sh >> 1));
    this.composite.uniforms.uTexel.value.set(1 / sw, 1 / sh);
    // Outline thickness scales with resolution so it reads the same on 720p and 4K.
    this.composite.uniforms.uThick.value = Math.max(1, Math.round((sh / 1080) * 2.2 * 10) / 10);
    this.final.uniforms.uTexel.value.set(1 / sw, 1 / sh);
    this.final.uniforms.uFxaa.value = this.q.fxaa && this.q.ss <= 1 ? 1 : 0;
    FXU.uRes.value.set(bw, bh);
    WATERU.uSceneRes.value.set(sw, sh);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  markDirty() { this.castersDirty = true; }

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
      m.userData._m = m.material;
      m.material = m.userData.nm || this.defaultNormal;
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

    // 6) Grading + AA to the screen.
    const fu = this.final.uniforms, g = this.grading;
    fu.uVignette.value = g.vignette; fu.uSat.value = g.sat; fu.uChroma.value = g.chroma;
    fu.uDanger.value = g.danger; fu.uFlash.value = g.flash; fu.uFlashColor.value.copy(g.flashColor);
    r.setRenderTarget(null);
    r.render(this.finalQuad.scene, this.quadCam);

    // 7) FX on top with soft depth against the scene.
    FXU.uUseDepth.value = 1;
    r.autoClear = false;
    r.clearDepth();
    cam.layers.set(LAYER.FX);
    r.render(scene, cam);
    r.autoClear = true;
    worldLayers();
  }
}
