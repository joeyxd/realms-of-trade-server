// Weapon-skill VFX (M3.5): the cutlass crescent (Hoja de viento) flying on the projectile timeline, the
// lead-rain zone (telegraph ring, falling lead, ground sparks), the bullets a perfect guard caught
// orbiting the shoulder, muzzle flashes and smoke, the blink's smoke puffs. Additive FX layer; the
// particles go through the shared pools in Effects.
import * as THREE from 'three';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';
import { DT } from '../../data/tuning.js';
import { elementVisual } from '../../data/elements.js';

const ADD = {
  transparent: true, depthWrite: false, blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
};

// A flat arc in XZ (uv.x across the arc, uv.y inner → outer), bent so its middle leads (+z).
function arcGeo(span, r0, r1, segs = 28) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= segs; j++) {
    const u = j / segs, v = i / 2, a = (u - 0.5) * span, r = r0 + (r1 - r0) * v;
    pos.push(Math.sin(a) * r, 0, Math.cos(a) * r); uv.push(u, v);
  }
  for (let i = 0; i < 2; i++) for (let j = 0; j < segs; j++) {
    const a = i * (segs + 1) + j, b = a + 1, c = a + segs + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CRESCENT_FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uFade;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;           // 1 in the middle, 0 at the tips
  float tips = smoothstep(0.0, 0.35, across);
  float thick = mix(0.25, 1.0, sqrt(across));             // thinner toward the tips
  float body = smoothstep(1.0 - thick, 1.0 - thick + 0.25, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
  float rim = smoothstep(0.62, 0.84, vUv.y) * (1.0 - smoothstep(0.84, 1.0, vUv.y));
  float a = (body * 0.55 + rim) * tips * uFade * fxDepthFade(0.3);
  if (a < 0.01) discard;
  vec3 c = mix(uColor, vec3(1.0), rim * 0.65);
  gl_FragColor = vec4(c * a * 1.7, a);
  #include <colorspace_fragment>
}`;

export class WeaponFx {
  constructor(scene, effects, decals, after, map) {
    Object.assign(this, { effects, decals, after, map });
    this.crescents = [];
    const g = arcGeo((110 * Math.PI) / 180, 0.62, 1.15);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.ShaderMaterial({ uniforms: { ...FXU, uFade: { value: 1 }, uColor: { value: new THREE.Color(0x9ff6ff) } }, vertexShader: VERT, fragmentShader: CRESCENT_FRAG, side: THREE.DoubleSide, ...ADD });
      const m = new THREE.Mesh(g, mat);
      m.layers.set(LAYER.FX); m.frustumCulled = false; m.visible = false; m.renderOrder = 27;
      scene.add(m);
      this.crescents.push({ m, mat, ev: null, trailAcc: 0, visual: null });
    }
    this.rains = [];
    this.time = 0;
  }

  // ---- events --------------------------------------------------------------------------------------
  wave(ev, color) {
    const c = this.crescents.find((q) => !q.ev) || this.crescents[0];
    c.ev = ev; c.visual = elementVisual(ev.elem); c.mat.uniforms.uColor.value.set(c.visual ? c.visual.accent : color);
    c.m.rotation.set(0, Math.atan2(ev.dx, ev.dz), 0);
  }

  rain(ev, color) {
    const visual = elementVisual(ev.elem);
    const ring = this.decals.ring(ev.x, ev.z, ev.r, visual ? visual.accent : color);
    ring.static = false; ring.t0 = ev.tick;
    this.rains.push({ ev, ring, acc: 0, color: new THREE.Color(visual ? visual.accent : color), visual });
  }

  // Muzzle flash, a puff of smoke, a few sparks forward. big: the blast.
  muzzle(x, y, z, dx, dz, big = false, elem = 0) {
    const visual = elementVisual(elem), flash = visual ? visual.c0 : [1, 0.62, 0.22];
    const E = this.effects, n = big ? 3 : 1;
    for (let i = 0; i < n; i++) E.add.spawn(x + dx * 0.12 * i, y, z + dz * 0.12 * i, dx * 2, 0.2, dz * 2, { life: big ? 0.09 : 0.05, size: big ? 0.55 : 0.28, size1: big ? 0.8 : 0.4, color: flash, alpha: 0.9, drag: 8 });
    for (let i = 0; i < (big ? 12 : 3); i++) {
      const a = Math.atan2(dx, dz) + (Math.random() - 0.5) * (big ? 0.9 : 0.35), s = (big ? 7 : 5) + Math.random() * 4;
      E.streaks.spawn(x, y, z, Math.sin(a) * s, 0.5 + Math.random(), Math.cos(a) * s, { life: 0.12 + Math.random() * 0.1, width: 0.05, stretch: 0.05, color: visual ? visual.c0 : [1, 0.9, 0.5], color1: visual ? visual.c1 : [1, 0.45, 0.1], gravity: 4, drag: 3 });
    }
    for (let i = 0; i < (big ? 7 : 2); i++) {
      E.alpha.spawn(x + dx * 0.25, y, z + dz * 0.25, dx * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.6, 0.35 + Math.random() * 0.3, dz * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.6,
        { life: 0.5 + Math.random() * 0.3, size: big ? 0.35 : 0.18, size1: big ? 1.0 : 0.5, color: [0.78, 0.76, 0.74], alpha: big ? 0.45 : 0.32, gravity: -0.3, drag: 2.5 });
    }
  }

  smoke(x, y, z, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 1.2;
      this.effects.alpha.spawn(x + Math.cos(a) * 0.2, y + 0.3 + Math.random() * 1.2, z + Math.sin(a) * 0.2, Math.cos(a) * s, 0.3 + Math.random() * 0.5, Math.sin(a) * s,
        { life: 0.6 + Math.random() * 0.4, size: 0.3, size1: 0.95, color: [0.62, 0.64, 0.72], alpha: 0.38, gravity: -0.4, drag: 2.2 });
    }
  }

  // ---- per frame -----------------------------------------------------------------------------------
  // tick: the projectile tick shown this frame. caught: {view, n, heavy} for the local player.
  update(dt, tick, caught) {
    this.time += dt;
    const E = this.effects, map = this.map;
    for (const c of this.crescents) {
      const ev = c.ev;
      if (!ev) continue;
      const tt = Math.min(tick, ev.end);
      const front = ev.speed * Math.max(0, tt - ev.tick) * DT;
      const fade = tick < ev.end ? 1 : 1 - (tick - ev.end) * DT / 0.12;
      if (fade <= 0 || tick < ev.tick - 2) { if (fade <= 0) { c.ev = null; c.m.visible = false; } else c.m.visible = false; continue; }
      const x = ev.x + ev.dx * (front - 0.6), z = ev.z + ev.dz * (front - 0.6);
      c.m.position.set(x, map.groundAt(x, z) + 1.0, z);
      c.m.scale.set(1.25 * ev.w / 0.9, 1, 1);
      c.mat.uniforms.uFade.value = fade;
      c.m.visible = true;
      c.trailAcc += dt;
      if (c.trailAcc > 0.02 && tick < ev.end) {
        c.trailAcc = 0;
        const col = c.mat.uniforms.uColor.value;
        for (const s of [-1, 1]) {
          const px = ev.x + ev.dx * (front - 0.75) + ev.dz * s * 0.7, pz = ev.z + ev.dz * (front - 0.75) - ev.dx * s * 0.7;
          E.streaks.spawn(px, map.groundAt(px, pz) + 1.0, pz, -ev.dx * 2, 0, -ev.dz * 2, { life: 0.18, width: 0.08, stretch: 0.3, color: c.visual ? c.visual.c0 : [0.85, 1, 1], color1: [col.r, col.g, col.b], drag: 3 });
        }
      }
    }
    for (let i = this.rains.length - 1; i >= 0; i--) {
      const R = this.rains[i], ev = R.ev, end = ev.tick + ev.dur / DT;
      const ring = R.ring, u = ring.mat.uniforms;
      if (tick >= end + 6) {
        ring.active = false; ring.mesh.visible = false;
        this.rains.splice(i, 1);
        continue;
      }
      if (tick < ev.tick) { u.uActive.value = 0.5 + 0.5 * Math.sin(this.time * 22); continue; }
      u.uActive.value = 1;
      R.pulse = (R.pulse ?? 0) - dt;
      if (R.pulse <= 0) { R.pulse = 0.15; if (this.onPulse) this.onPulse(ev); }
      // Lead drops (bright dots falling: streaks seen from above would be dots anyway), sparks and sand
      // where they land.
      R.acc += dt * 70;
      while (R.acc >= 1) {
        R.acc -= 1;
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * ev.r;
        const x = ev.x + Math.cos(a) * rr, z = ev.z + Math.sin(a) * rr, gx = map.groundAt(x, z);
        E.add.spawn(x, gx + 2.2 + Math.random() * 0.8, z, 0, -22, 0, { life: 0.11, size: 0.34, size1: 0.26, color: R.visual ? R.visual.c0 : [1, 0.86, 0.5], alpha: 1, drag: 0 });
        E.streaks.spawn(x, gx + 0.06, z, (Math.random() - 0.5) * 3.5, 1.8 + Math.random() * 2.2, (Math.random() - 0.5) * 3.5, { life: 0.22, width: 0.09, stretch: 0.06, color: R.visual ? R.visual.c0 : [1, 0.85, 0.4], color1: R.visual ? R.visual.c1 : [1, 0.4, 0.1], gravity: 9, drag: 0.5 });
        if (Math.random() < 0.18) E.alpha.spawn(x, gx + 0.12, z, 0, 0.5, 0, { life: 0.45, size: 0.25, size1: 0.7, color: [0.9, 0.82, 0.64], alpha: 0.5, gravity: 0, drag: 2 });
      }
    }
    // Caught bullets circling the shoulder: amber, the heavy ones red and bigger.
    if (caught && caught.view && caught.n > 0) {
      const p = caught.view.root.position;
      for (let k = 0; k < caught.n; k++) {
        const a = this.time * 4.2 + (k / caught.n) * Math.PI * 2, heavy = k < caught.heavy;
        E.add.spawn(p.x + Math.cos(a) * 0.5, p.y + 1.85 + Math.sin(this.time * 3 + k) * 0.06, p.z + Math.sin(a) * 0.5, 0, 0, 0,
          { life: 0.05, size: heavy ? 0.42 : 0.28, size1: heavy ? 0.42 : 0.28, color: heavy ? [1, 0.36, 0.12] : [1, 0.72, 0.25], alpha: 1, drag: 0 });
      }
    }
  }
}
