// Combat VFX: sword slash arcs (a crescent that sweeps with the swing's active frames), the parry
// guard (a faint arc in front while the window is open, a bright one on success) and shockwave rings
// (perfect parries: three layers, wide-faint / medium / thin-bright). All additive, FX layer, blooming.
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';

const ADD = {
  transparent: true, depthWrite: false, blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
};

// Flat sector in XZ: angle a01 0..1 across the arc, radius r01 0..1 from inner to outer.
function sectorGeo(segs = 40, rings = 3) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rings; i++) for (let j = 0; j <= segs; j++) { pos.push(0, 0, 0); uv.push(j / segs, i / rings); }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * (segs + 1) + j, b = a + 1, c = a + segs + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const SLASH_VERT = /* glsl */ `
uniform float uSpan;   // radians
uniform float uR0, uR1;
uniform float uTilt;
varying vec2 vUv;
void main() {
  vUv = uv;
  float a = (uv.x - 0.5) * uSpan;
  float r = mix(uR0, uR1, uv.y);
  vec3 p = vec3(sin(a) * r, uTilt * sin(a) * r * 0.35 + (uv.y - 0.5) * 0.06, cos(a) * r);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const SLASH_FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uP;      // 0..1 sweep progress (leading edge)
uniform float uFade;   // 1 → 0 after the swing
uniform float uDir;    // +1 sweeps toward +angle, −1 the other way
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float s = uDir > 0.0 ? vUv.x : 1.0 - vUv.x;
  float lead = uP;
  float behind = lead - s;
  if (behind < 0.0) discard;
  float tail = exp(-behind * 4.5);
  float edge = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  float rim = smoothstep(0.62, 0.86, vUv.y) * (1.0 - smoothstep(0.86, 1.0, vUv.y));
  float a = (edge * 0.35 + rim) * tail * uFade * fxDepthFade(0.3);
  if (a < 0.01) discard;
  vec3 c = mix(uColor, vec3(1.0), rim * smoothstep(0.05, 0.0, behind) * 0.7);
  gl_FragColor = vec4(c * a * 1.6, a);
  #include <colorspace_fragment>
}`;

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uT;      // 0..1
uniform float uWidth;  // ring thickness (fraction of radius)
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float d = length(vUv);
  float r = mix(0.15, 1.0, 1.0 - pow(1.0 - uT, 2.4));
  float w = uWidth * mix(1.0, 0.45, uT);
  float ring = 1.0 - smoothstep(0.0, w, abs(d - r));
  float a = ring * (1.0 - uT) * uAlpha * fxDepthFadeBias(0.2, 0.3);
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), ring * ring * 0.5) * a, a);
  #include <colorspace_fragment>
}`;

export class CombatFx {
  constructor(scene) {
    this.slashes = [];
    const sg = sectorGeo();
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...FXU, uSpan: { value: 2.6 }, uR0: { value: 0.5 }, uR1: { value: 2 }, uTilt: { value: 0 }, uP: { value: 0 }, uFade: { value: 1 }, uDir: { value: 1 }, uColor: { value: new THREE.Color(0x9ff6ff) } },
        vertexShader: SLASH_VERT, fragmentShader: SLASH_FRAG, side: THREE.DoubleSide, ...ADD,
      });
      const m = new THREE.Mesh(sg, mat);
      m.layers.set(LAYER.FX); m.frustumCulled = false; m.visible = false; m.renderOrder = 26;
      scene.add(m);
      this.slashes.push({ m, mat, active: false, t: 0, view: null });
    }
    this.rings = [];
    const rg = new THREE.PlaneGeometry(2, 2);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...FXU, uT: { value: 0 }, uWidth: { value: 0.1 }, uAlpha: { value: 1 }, uColor: { value: new THREE.Color(0x9ff6ff) } },
        vertexShader: RING_VERT, fragmentShader: RING_FRAG, ...ADD,
      });
      const m = new THREE.Mesh(rg, mat);
      m.layers.set(LAYER.FX); m.frustumCulled = false; m.visible = false; m.renderOrder = 25;
      scene.add(m);
      this.rings.push({ m, mat, active: false, t: 0, life: 0.4, size: 1 });
    }
    this.ringCursor = 0;
    // Parry guard: one per local player (a wide arc in front).
    const gmat = new THREE.ShaderMaterial({
      uniforms: { ...FXU, uSpan: { value: (110 * Math.PI) / 180 }, uR0: { value: 0.9 }, uR1: { value: 1.6 }, uTilt: { value: 0 }, uP: { value: 1 }, uFade: { value: 0 }, uDir: { value: 1 }, uColor: { value: new THREE.Color(0x3bf0ff) } },
      vertexShader: SLASH_VERT, fragmentShader: SLASH_FRAG.replace('float tail = exp(-behind * 4.5);', 'float tail = 0.55 + 0.45 * smoothstep(0.0, 0.2, min(s, 1.0 - s));'), side: THREE.DoubleSide, ...ADD,
    });
    this.guard = new THREE.Mesh(sg, gmat);
    this.guard.layers.set(LAYER.FX); this.guard.frustumCulled = false; this.guard.visible = false; this.guard.renderOrder = 26;
    scene.add(this.guard);
    this.guardW = 0; this.guardHit = 0;
  }

  // A sword swing: stage 1 sweeps right → left, stage 2 back, stage 3 a full circle.
  slash(view, stage, color, active, delay) {
    const s = this.slashes.find((q) => !q.active) || this.slashes[0];
    const u = s.mat.uniforms;
    const full = stage === 3;
    u.uSpan.value = full ? Math.PI * 2 : 2.62;
    u.uR0.value = 0.55; u.uR1.value = full ? 2.5 : 2.1;
    u.uTilt.value = stage === 1 ? 1 : stage === 2 ? -1 : 0;
    u.uDir.value = stage === 2 ? -1 : 1;
    u.uColor.value.set(color);
    u.uP.value = 0; u.uFade.value = 1;
    Object.assign(s, { active: true, t: -delay, active01: active, view, full });
    s.m.visible = false;
  }

  ring(x, y, z, size, color, life = 0.45, width = 0.12, alpha = 1) {
    const r = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    r.m.position.set(x, y, z);
    r.m.scale.setScalar(size);
    const u = r.mat.uniforms;
    u.uColor.value.set(color); u.uWidth.value = width; u.uAlpha.value = alpha; u.uT.value = 0;
    Object.assign(r, { active: true, t: 0, life });
    r.m.visible = true;
  }

  // PERFECT: three layers (wide and faint, medium, thin and bright).
  shockwave(x, y, z, color = 0x9ff6ff) {
    this.ring(x, y + 0.08, z, 4.2, color, 0.55, 0.3, 0.35);
    this.ring(x, y + 0.1, z, 3.0, color, 0.42, 0.14, 0.7);
    this.ring(x, y + 0.12, z, 2.2, 0xffffff, 0.3, 0.06, 1);
  }

  // open: parry window open (0..1 weight); hit: a parry just succeeded.
  setGuard(view, open, success) {
    this.guardView = view;
    this.guardOpen = open;
    if (success) this.guardHit = 1;
  }

  update(dt) {
    for (const s of this.slashes) {
      if (!s.active) continue;
      s.t += dt;
      const u = s.mat.uniforms;
      const v = s.view;
      if (s.t < 0) continue;
      s.m.visible = true;
      if (v) {
        s.m.position.set(v.root.position.x, v.root.position.y + (s.full ? 0.75 : 1.05), v.root.position.z);
        s.m.rotation.set(0, v.root.rotation.y, 0);
      }
      u.uP.value = Math.min(1.25, s.t / Math.max(0.05, s.active01));
      u.uFade.value = s.t < s.active01 ? 1 : Math.max(0, 1 - (s.t - s.active01) / 0.16);
      if (u.uFade.value <= 0) { s.active = false; s.m.visible = false; }
    }
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { r.active = false; r.m.visible = false; continue; }
      r.mat.uniforms.uT.value = k;
    }
    const g = this.guard, gu = g.material.uniforms, v = this.guardView;
    this.guardW += ((this.guardOpen ? 1 : 0) - this.guardW) * Math.min(1, dt * (this.guardOpen ? 40 : 10));
    this.guardHit = Math.max(0, this.guardHit - dt * 4);
    const a = Math.max(this.guardW * 0.45, this.guardHit);
    g.visible = !!v && a > 0.02;
    if (g.visible) {
      g.position.set(v.root.position.x, v.root.position.y + 1.0, v.root.position.z);
      g.rotation.set(0, v.root.rotation.y, 0);
      gu.uFade.value = a;
      gu.uR1.value = 1.6 + this.guardHit * 0.25;
    }
  }
}
