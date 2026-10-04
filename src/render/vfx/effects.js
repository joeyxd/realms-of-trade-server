// High-level effects built on the particle pools: footstep dust, dash bursts, water ripples,
// fires (flames, sparks with trails, smoke wisps lit by the fire), the volcano's glow and plume,
// lava bubbles that pop sparks, and the Caldera's rising embers and falling ash.
import * as THREE from 'three';
import { ParticlePool, SHAPE } from './particles.js';
import { StreakPool } from './streaks.js';
import { LAYER, FXU, GLSL_FX_DEPTH } from '../pipeline.js';
import { U } from '../toon.js';
import { lavaPoints } from '../lights.js';

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// Foam ripple: an expanding ring whose thickness is broken up by the shared cell noise, plus a
// faint inner echo; reads like the foamy wakes of stylized water.
const RING_FRAG = /* glsl */ `
${GLSL_FX_DEPTH}
uniform float uT;
uniform float uSeed;
uniform vec3 uColor;
uniform sampler2D mnNoiseTex;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;
  float ang = atan(p.y, p.x);
  vec4 nz = texture2D(mnNoiseTex, vec2(ang * 0.32 + uSeed, d * 0.35 + uSeed * 0.7));
  float r = mix(0.22, 1.0, 1.0 - pow(1.0 - uT, 2.2));
  float w = mix(0.14, 0.05, uT) * (0.65 + 0.7 * nz.b);
  float ring = smoothstep(w, w * 0.45, abs(d - r + (nz.r - 0.5) * 0.06));
  float echo = smoothstep(w * 0.7, w * 0.25, abs(d - r * 0.72)) * 0.55 * step(0.45, nz.b);
  float a = max(ring, echo) * (1.0 - uT * uT) * 0.95;
  a *= smoothstep(0.08, 0.2, nz.g + 0.12);
  a *= fxDepthFade(0.15);
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor * uFxLight, a);
  #include <colorspace_fragment>
}`;

const COLORS = {
  sand: [0.97, 0.9, 0.72], grass: [0.78, 0.9, 0.62], rock: [0.66, 0.6, 0.62], dirt: [0.86, 0.72, 0.52], wood: [0.85, 0.7, 0.5],
};

export class Effects {
  constructor(scene, map) {
    this.map = map;
    this.alpha = new ParticlePool(900, { name: 'fx-alpha' });
    this.add = new ParticlePool(900, { additive: true, name: 'fx-add' });
    this.streaks = new StreakPool(700, { name: 'fx-streaks' });
    scene.add(this.alpha.points, this.add.points, this.streaks.mesh);
    this.rings = [];
    const ringGeo = new THREE.PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 40; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...FXU, uT: { value: 0 }, uSeed: { value: Math.random() }, uColor: { value: new THREE.Color(0xfffbf0) }, mnNoiseTex: U.mnNoiseTex },
        vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false,
      });
      const m = new THREE.Mesh(ringGeo, mat);
      m.layers.set(LAYER.FX);
      m.visible = false;
      m.renderOrder = 5;
      scene.add(m);
      this.rings.push({ m, t: 0, life: 1, size: 1, active: false });
    }
    this.ringCursor = 0;
    this.fires = [];
    for (const p of map.props) {
      const f = { acc: 0, sparkAcc: Math.random(), smokeAcc: Math.random() };
      if (p.kind === 'brazier') this.fires.push({ ...f, x: p.x, y: p.y + 1.15, z: p.z, kind: 'brazier' });
      if (p.kind === 'campfire') this.fires.push({ ...f, x: p.x, y: p.y + 0.25, z: p.z, kind: 'campfire' });
      if (p.kind === 'gatePost') this.fires.push({ ...f, x: p.x, y: p.y + 4.9, z: p.z, kind: 'brazier' });
    }
    this.lava = lavaPoints(map).map((p) => ({ x: p.x, z: p.z, t: Math.random() * 1.5 }));
    const V = map.landmarks.volcano;
    this.volcano = { x: V.x, y: map.heightAt(V.x, V.z) + 2, z: V.z, acc: 0, smokeAcc: 0 };
    this.arena = map.landmarks.arena;
    this.arenaR = map.landmarks.arenaR;
    this.emberAcc = 0;
    this.ashAcc = 0;
    this.time = 0;
    this.focus = new THREE.Vector3();
  }

  // linear: FX blend in linear light (medium/high draw into a render target), so glows need more.
  setQuality(budget, linear = true) {
    this.alpha.budget = budget; this.add.budget = budget; this.streaks.budget = budget;
    this.linear = linear;
    this.setNight(this.night ?? 0);
  }

  // 0 = day … 1 = night: fires read brighter in the dark (and do not clip to white on sunlit sand).
  setNight(k) {
    this.night = k;
    const lin = this.linear !== false;
    this.add.mat.uniforms.uBoost.value = lin ? 1.25 + 0.55 * k : 1;
    this.streaks.mat.uniforms.uBoost.value = lin ? 1.2 + 0.3 * k : 1.1;
    this.alpha.mat.uniforms.uHeatK.value = 0.35 + 0.65 * k;
  }

  setViewport(h, fov) { this.alpha.setViewport(h, fov); this.add.setViewport(h, fov); }

  // Spark burst (lava bubbles now; hits and parries in M2).
  sparks(x, y, z, n, { color = [1, 0.72, 0.3], color1 = [0.95, 0.24, 0.04], up = 3, spread = 1.4, gravity = 9, life = 0.7 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.4 + Math.random() * spread;
      this.streaks.spawn(x, y, z, Math.cos(a) * s, up + Math.random() * up * 1.1, Math.sin(a) * s,
        { life: life + Math.random() * 0.5, width: 0.08 + Math.random() * 0.04, stretch: 0.06, color, color1, gravity, drag: 0.4 });
    }
  }

  footstep(x, y, z, material, wade) {
    if (wade > 0.08) { this.ripple(x, Math.max(y, 0) + 0.02, z, 0.9, 0.7); this.splash(x, z, 3); return; }
    const c = COLORS[material] || COLORS.sand;
    const n = material === 'grass' ? 1 : 2;
    for (let i = 0; i < n; i++) {
      this.alpha.spawn(x + (Math.random() - 0.5) * 0.2, y + 0.18, z + (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.8,
        { life: 0.45 + Math.random() * 0.2, size: 0.22, size1: 0.5, color: c, alpha: 0.75, gravity: 0.6, drag: 3.5 });
    }
  }

  dashBurst(x, y, z, dx, dz, material, wade) {
    const c = wade > 0.08 ? [0.9, 0.98, 1.0] : COLORS[material] || COLORS.sand;
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 2.2;
      this.alpha.spawn(x, y + 0.12, z, Math.cos(a) * s - dx * 2.5, 0.6 + Math.random() * 1.0, Math.sin(a) * s - dz * 2.5,
        { life: 0.5 + Math.random() * 0.25, size: 0.3, size1: 0.75, color: c, alpha: 0.8, gravity: 1.2, drag: 4.5 });
    }
    if (wade > 0.08) { this.ripple(x, 0.02, z, 2.4, 0.6); this.splash(x, z, 10); }
  }

  dashTrail(x, y, z, material, wade) {
    if (wade > 0.08) { this.splash(x, z, 2); return; }
    const c = COLORS[material] || COLORS.sand;
    this.alpha.spawn(x, y + 0.1, z, (Math.random() - 0.5) * 0.6, 0.4, (Math.random() - 0.5) * 0.6,
      { life: 0.35, size: 0.28, size1: 0.55, color: c, alpha: 0.6, gravity: 0.4, drag: 4 });
  }

  splash(x, z, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2;
      this.alpha.spawn(x, 0.05, z, Math.cos(a) * s, 2 + Math.random() * 2.5, Math.sin(a) * s,
        { life: 0.5, size: 0.14, size1: 0.08, color: [0.92, 1, 1], alpha: 0.95, gravity: 12, drag: 0.8 });
    }
  }

  ripple(x, y, z, size = 1, life = 0.8) {
    const r = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    r.m.position.set(x, y, z);
    r.m.scale.setScalar(size);
    r.size = size;
    r.m.material.uniforms.uSeed.value = Math.random();
    r.t = 0; r.life = life; r.active = true; r.m.visible = true;
  }

  update(dt, focus) {
    this.time += dt;
    this.focus.copy(focus);
    const R = Math.random;
    const near = (f, d) => (f.x - focus.x) ** 2 + (f.z - focus.z) ** 2 < d * d;
    this.alpha.wind.copy(U.mnWind.value);
    for (const f of this.fires) {
      if (!near(f, 60)) continue;
      const camp = f.kind === 'campfire';
      f.acc += dt * (camp ? 34 : 26);
      while (f.acc >= 1) {
        f.acc -= 1;
        const r = camp ? 0.4 : 0.4;
        const a = R() * Math.PI * 2, d = R() * r;
        this.add.spawn(f.x + Math.cos(a) * d, f.y, f.z + Math.sin(a) * d, (R() - 0.5) * 0.3, 1.6 + R() * 1.2, (R() - 0.5) * 0.3,
          { life: 0.45 + R() * 0.3, size: camp ? 1.35 : 1.1, size1: 0.2, color: R() < 0.5 ? [1, 0.36, 0.05] : [1, 0.62, 0.14], alpha: 0.9, gravity: -0.8, drag: 1.2, shape: SHAPE.GLOW });
      }
      // Sparks: pop out of the flames and wander up, trailing and cooling from yellow to red.
      f.sparkAcc += dt * (camp ? 5 : 3.5);
      while (f.sparkAcc >= 1) {
        f.sparkAcc -= 1;
        const a = R() * Math.PI * 2, s = 0.3 + R() * 0.6;
        this.streaks.spawn(f.x + Math.cos(a) * 0.2, f.y + 0.3, f.z + Math.sin(a) * 0.2, Math.cos(a) * s, 2.4 + R() * 2.2, Math.sin(a) * s,
          { life: 0.9 + R() * 0.9, width: 0.08 + R() * 0.04, stretch: 0.08, color: [1, 0.66, 0.25], color1: [0.95, 0.22, 0.04], gravity: -0.3, drag: 0.9, turb: 2.2 });
      }
      // Smoke: soft wisps, warm underneath (heat + the fire's own light), dark as they rise.
      f.smokeAcc += dt * (camp ? 3 : 2.2);
      while (f.smokeAcc >= 1) {
        f.smokeAcc -= 1;
        this.alpha.spawn(f.x + (R() - 0.5) * 0.3, f.y + 0.8, f.z + (R() - 0.5) * 0.3, (R() - 0.5) * 0.2, 0.9 + R() * 0.5, (R() - 0.5) * 0.2,
          { life: 3 + R() * 1.2, size: 0.45, size1: 2.3, color: [0.4, 0.38, 0.4], alpha: 0.32, gravity: -0.05, drag: 0.35, shape: SHAPE.WISP, turb: 0.35, heat: 0.6 });
      }
    }
    // Volcano: crater glow puffs + slow smoke plume, lit from below by the crater (visible from far away).
    const v = this.volcano;
    v.acc += dt * 10;
    while (v.acc >= 1) {
      v.acc -= 1;
      this.add.spawn(v.x + (R() - 0.5) * 8, v.y, v.z + (R() - 0.5) * 8, 0, 2 + R() * 2, 0,
        { life: 1.2, size: 4, size1: 1.5, color: [1, 0.4, 0.08], alpha: 0.5, gravity: 0, drag: 0.5, shape: SHAPE.GLOW });
    }
    v.smokeAcc += dt * 2.2;
    while (v.smokeAcc >= 1) {
      v.smokeAcc -= 1;
      const g = 0.32 + R() * 0.12;
      this.alpha.spawn(v.x + (R() - 0.5) * 6, v.y + 2, v.z + (R() - 0.5) * 6, 1.2 + R(), 3.5 + R() * 2, 0.6,
        { life: 9, size: 5, size1: 16, color: [g, g * 0.95, g * 1.05], alpha: 0.55, gravity: -0.05, drag: 0.08, heat: 1.3 });
    }
    // Lava bubbles: every so often a point on the flow pops (sparks, a glow puff, a hot wisp).
    for (const p of this.lava) {
      if (!near(p, 50)) continue;
      p.t -= dt;
      if (p.t > 0) continue;
      p.t = 0.5 + R() * 1.4;
      for (let k = 0; k < 3; k++) {
        const x = p.x + (R() - 0.5) * 5, z = p.z + (R() - 0.5) * 5;
        if (this.map.masks(x, z).lava < 0.6) continue;
        const y = this.map.heightAt(x, z) + 0.12;
        this.sparks(x, y, z, 6 + Math.floor(R() * 6));
        this.add.spawn(x, y + 0.15, z, 0, 0.6, 0, { life: 0.45, size: 1.6, size1: 0.5, color: [1, 0.45, 0.1], alpha: 0.75, drag: 1, shape: SHAPE.GLOW });
        this.alpha.spawn(x, y + 0.4, z, 0, 0.8, 0, { life: 2.2, size: 0.5, size1: 1.6, color: [0.16, 0.13, 0.13], alpha: 0.25, drag: 0.4, shape: SHAPE.WISP, turb: 0.3, heat: 1 });
        break;
      }
    }
    // The Caldera: embers rise from the cracked floor and wander, ash falls around the player.
    const A = this.arena;
    if (near(A, 45)) {
      this.emberAcc += dt * 16;
      while (this.emberAcc >= 1) {
        this.emberAcc -= 1;
        const a = R() * Math.PI * 2, d = Math.sqrt(R()) * this.arenaR;
        const x = A.x + Math.cos(a) * d, z = A.z + Math.sin(a) * d;
        this.streaks.spawn(x, this.map.groundAt(x, z) + 0.2 + R() * 1.2, z, (R() - 0.5) * 0.4, 0.6 + R() * 0.8, (R() - 0.5) * 0.4,
          { life: 3 + R() * 2.5, width: 0.09 + R() * 0.05, stretch: 0.22, color: [1, 0.6, 0.2], color1: [0.85, 0.16, 0.03], gravity: -0.12, drag: 0.45, turb: 1.3 });
      }
    }
    if (near(A, 70)) {
      this.ashAcc += dt * 9;
      while (this.ashAcc >= 1) {
        this.ashAcc -= 1;
        const a = R() * Math.PI * 2, d = Math.sqrt(R()) * 24;
        const pale = R() < 0.55;
        this.alpha.spawn(focus.x + Math.cos(a) * d, focus.y + 7 + R() * 4, focus.z + Math.sin(a) * d, 0.3, -0.5, 0.15,
          { life: 10 + R() * 4, size: 0.1 + R() * 0.07, color: pale ? [0.6, 0.58, 0.58] : [0.24, 0.22, 0.23], alpha: 0.9, gravity: 0.7, drag: 1, shape: SHAPE.FLAKE, turb: 0.7 });
      }
    }
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt / r.life;
      if (r.t >= 1) { r.active = false; r.m.visible = false; continue; }
      r.m.material.uniforms.uT.value = r.t;
      r.m.scale.setScalar(r.size * 2.0);
    }
    this.alpha.update(dt);
    this.add.update(dt);
    this.streaks.update(dt);
  }
}
