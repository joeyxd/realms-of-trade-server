// Loot on the ground (M4, PLAN-M4.md §2.7). Only your own drops exist here (the server tells nobody else).
// Each one is a small toon model of what it is (a sack of gear shaped by its slot, coins, a bottle, coral,
// the boss chest) that pops out of the corpse in an arc, bobs and turns, with a beam of light in its rarity's
// colour (short and faint for commons, tall and gold with sparks for legendaries) and a soft disc on the
// ground. Picked up, it flies to you; expired, it sinks; a chest opens with a burst.
import * as THREE from 'three';
import { part, merge, cyl, sphere, rbox, torus, lumpy, cone } from './geo.js';
import { characterMaterial } from './characters.js';
import { worldNormalMat } from './toon.js';
import { LAYER, FXU, GLSL_FX_DEPTH } from './pipeline.js';
import { SHAPE } from './vfx/particles.js';
import { RARITIES, BASES } from '../data/items.js';

const WOOD = 0x8a5a2e, WOOD_D = 0x5e3a1c, BRASS = 0xd9b04a, IRON = 0x4a4d57, SAIL = 0xe8dcc0, CLOTH = 0x6a3d8a;
const LEATHER = 0x7a4a2a, GOLD = 0xffcf4a, GOLD_D = 0xc8962a, GLASS = 0xb8e0d8, RUM = 0xd8442a, CORAL = 0xff7a8a, STEEL = 0xdfe6ee;

function withGlow(geo, glowFn = null) {
  const n = geo.attributes.position.count, g = new Float32Array(n), p = geo.attributes.position;
  if (glowFn) for (let i = 0; i < n; i++) g[i] = glowFn(p.getX(i), p.getY(i), p.getZ(i));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(g, 1));
  geo.computeVertexNormals();
  return geo;
}

// One small model per kind of loot (built once).
const GEO = {};
function geoFor(kind, sub) {
  const key = kind + ':' + (sub || '');
  if (GEO[key]) return GEO[key];
  const L = [];
  let glow = null;
  if (kind === 'gold') {
    for (const [x, y, z] of [[0, 0.03, 0], [0.04, 0.08, 0.02], [-0.02, 0.13, -0.01], [0.16, 0.03, 0.1], [-0.15, 0.03, 0.08]]) L.push(part(cyl(0.11, 0.11, 0.045, 12), GOLD, { pos: [x, y, z] }));
    glow = (x, y) => (y > 0.1 ? 0.6 : 0.3);
  } else if (kind === 'potion') {
    L.push(part(sphere(0.15, 10, 8), GLASS, { pos: [0, 0.16, 0], scale: [1, 1.1, 1] }));
    L.push(part(sphere(0.12, 10, 8), RUM, { pos: [0, 0.14, 0], scale: [1, 0.9, 1] }));
    L.push(part(cyl(0.05, 0.06, 0.14, 8), GLASS, { pos: [0, 0.34, 0] }));
    L.push(part(cyl(0.055, 0.05, 0.06, 8), WOOD, { pos: [0, 0.43, 0] }));
    glow = (x, y) => (y < 0.25 ? 0.7 : 0);
  } else if (kind === 'quest') {
    L.push(part(lumpy(cyl(0.05, 0.08, 0.36, 6), 0.15, 3), CORAL, { pos: [0, 0.18, 0], rot: [0, 0, 0.2] }));
    L.push(part(lumpy(cyl(0.035, 0.05, 0.24, 6), 0.15, 4), CORAL, { pos: [0.1, 0.26, 0.02], rot: [0.3, 0, -0.7] }));
    L.push(part(lumpy(cyl(0.03, 0.045, 0.2, 6), 0.15, 5), CORAL, { pos: [-0.09, 0.27, -0.03], rot: [-0.2, 0, 0.8] }));
    glow = () => 0.35;
  } else if (kind === 'chest') {
    L.push(part(rbox(0.9, 0.5, 0.6, 0.05), WOOD, { pos: [0, 0.25, 0] }));
    for (const x of [-0.33, 0, 0.33]) L.push(part(rbox(0.07, 0.53, 0.63, 0.02), BRASS, { pos: [x, 0.25, 0] }));
    L.push(part(rbox(0.16, 0.18, 0.06, 0.02), BRASS, { pos: [0, 0.42, 0.31] }));
    glow = (x, y, z) => (z > 0.3 && y > 0.35 ? 1 : 0);
  } else if (kind === 'lid') {
    const lid = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12, 1, false, 0, Math.PI);
    L.push(part(lid, WOOD_D, { rot: [0, 0, Math.PI / 2], pos: [0, 0, 0.3], scale: [1, 1, 1] }));
    for (const x of [-0.33, 0.33]) L.push(part(torus(0.3, 0.035, 4, 12, Math.PI), BRASS, { rot: [0, Math.PI / 2, 0], pos: [x, 0, 0.3] }));
  } else if (sub === 'sable') {
    L.push(part(rbox(0.08, 0.02, 0.62, 0.01), STEEL, { pos: [0, 0.06, 0.12], rot: [0, 0, 0] }));
    L.push(part(rbox(0.26, 0.05, 0.06, 0.02), BRASS, { pos: [0, 0.06, -0.2] }));
    L.push(part(cyl(0.035, 0.035, 0.2, 6), LEATHER, { pos: [0, 0.06, -0.32], rot: [Math.PI / 2, 0, 0] }));
    glow = (x, y, z) => (z > 0.3 ? 0.8 : 0);
  } else if (sub === 'pistolas') {
    for (const s of [-1, 1]) {
      L.push(part(cyl(0.035, 0.035, 0.42, 8), IRON, { pos: [s * 0.1, 0.06, 0.08], rot: [Math.PI / 2, 0, 0] }));
      L.push(part(rbox(0.07, 0.07, 0.22, 0.02), WOOD, { pos: [s * 0.1, 0.06, -0.2], rot: [0.5, 0, 0] }));
    }
    glow = (x, y, z) => (z > 0.25 ? 0.6 : 0);
  } else if (sub === 'head') {
    L.push(part(cone(0.3, 0.18, 3), 0x2a2040, { pos: [0, 0.1, 0], rot: [0, Math.PI / 6, 0] }));
    L.push(part(cyl(0.16, 0.18, 0.16, 10), 0x2a2040, { pos: [0, 0.2, 0] }));
    L.push(part(torus(0.17, 0.025, 4, 12), BRASS, { pos: [0, 0.13, 0], rot: [Math.PI / 2, 0, 0] }));
  } else if (sub === 'chest') {
    L.push(part(lumpy(rbox(0.5, 0.16, 0.36, 0.06), 0.08, 2), CLOTH, { pos: [0, 0.08, 0] }));
    L.push(part(rbox(0.52, 0.04, 0.06, 0.02), BRASS, { pos: [0, 0.13, 0] }));
  } else if (sub === 'boots') {
    for (const s of [-1, 1]) {
      L.push(part(rbox(0.12, 0.3, 0.14, 0.04), LEATHER, { pos: [s * 0.1, 0.15, -0.04] }));
      L.push(part(rbox(0.12, 0.1, 0.26, 0.04), LEATHER, { pos: [s * 0.1, 0.05, 0.03] }));
    }
  } else if (sub === 'ring') {
    L.push(part(torus(0.12, 0.03, 6, 14), GOLD, { pos: [0, 0.12, 0], rot: [0.4, 0, 0] }));
    L.push(part(sphere(0.06, 8, 6), 0x6ad8ff, { pos: [0, 0.25, 0.04] }));
    glow = (x, y) => (y > 0.2 ? 1 : 0.2);
  } else {
    // A loot sack.
    L.push(part(lumpy(sphere(0.22, 10, 8), 0.12, 2), SAIL, { pos: [0, 0.2, 0], scale: [1, 0.9, 1] }));
    L.push(part(torus(0.08, 0.03, 4, 10), LEATHER, { pos: [0, 0.38, 0], rot: [Math.PI / 2, 0, 0] }));
  }
  GEO[key] = withGlow(merge(L), glow);
  return GEO[key];
}

// The beam: an open cylinder, additive, bright at the foot and fading up, soft at its edges; and the disc.
const ADD = {
  transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, blendEquationAlpha: THREE.AddEquation,
};
function beamMaterial() {
  return new THREE.ShaderMaterial({
    ...ADD, side: THREE.DoubleSide,
    uniforms: { ...FXU, uColor: { value: new THREE.Color() }, uA: { value: 1 }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying float vF;
      void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vec3 n = normalize(mat3(modelMatrix) * normal);
        vF = abs(dot(n, normalize(cameraPosition - wp.xyz))); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `${GLSL_FX_DEPTH}
      uniform vec3 uColor; uniform float uA, uTime; varying vec2 vUv; varying float vF;
      void main() {
        float up = vUv.y;
        float a = pow(1.0 - up, 1.6) * smoothstep(0.0, 0.05, up) * pow(vF, 1.5);
        a *= 0.75 + 0.25 * sin(uTime * 3.0 + up * 9.0);
        a *= uA * fxDepthFade(0.4);
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a * 1.6, a);
      }`,
  });
}
function discMaterial() {
  return new THREE.ShaderMaterial({
    ...ADD,
    uniforms: { ...FXU, uColor: { value: new THREE.Color() }, uA: { value: 1 }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `${GLSL_FX_DEPTH}
      uniform vec3 uColor; uniform float uA, uTime; varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float ring = smoothstep(0.62, 0.8, d) * (1.0 - smoothstep(0.8, 1.0, d)) * (0.7 + 0.3 * sin(uTime * 4.0));
        float a = (pow(max(0.0, 1.0 - d), 2.0) * 0.6 + ring * 0.8) * uA * fxDepthFadeBias(0.15, 0.3);
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
}
const BEAM_GEO = (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true); g.translate(0, 0.5, 0); return g; })();
const DISC_GEO = (() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; })();

// What a drop looks like: its model, its beam (height, width, strength) and its colour.
function lookOf(d) {
  if (d.kind === 'item') {
    const B = BASES[d.item.b], r = d.item.r;
    const sub = B.slot === 'weapon' ? B.weapon : B.slot;
    return { geo: geoFor('item', sub), color: RARITIES[r].color, h: [1.2, 2.4, 4, 6, 9][r], w: [0.1, 0.13, 0.16, 0.2, 0.26][r], a: [0.25, 0.45, 0.65, 0.8, 1][r], r, sparks: r >= 3 };
  }
  if (d.kind === 'chest') { const r = d.r ?? 2; return { geo: geoFor('chest'), lid: geoFor('lid'), color: RARITIES[r].color, h: 10, w: 0.35, a: 1, r, sparks: true, chest: true }; }
  if (d.kind === 'gold') return { geo: geoFor('gold'), color: '#ffd24a', h: 0.8, w: 0.12, a: 0.3, r: 0 };
  if (d.kind === 'potion') return { geo: geoFor('potion'), color: '#ff6a4a', h: 1, w: 0.1, a: 0.35, r: 0 };
  return { geo: geoFor('quest'), color: '#ff7a8a', h: 1.6, w: 0.12, a: 0.5, r: 1 };
}

export class LootLayer {
  constructor(scene, map, effects, lights) {
    Object.assign(this, { scene, map, effects, lights });
    this.drops = new Map(); // id → view
    this.material = characterMaterial('base');
    this.material.userData.nm = worldNormalMat(); // small pickups: world line weight, not the heavy character ink
    this.material.userData.glow.value = 1.4;
    this.time = 0;
    this.tmp = new THREE.Vector3();
  }

  // A new drop d {id, kind, x, z, item | n | r} thrown from (fx, fz) (the corpse, the chest).
  add(d, fx = d.x, fz = d.z) {
    if (this.drops.has(d.id)) return this.drops.get(d.id);
    const L = lookOf(d), y = this.map.groundAt(d.x, d.z);
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(L.geo, this.material);
    mesh.castShadow = true;
    root.add(mesh);
    let lid = null;
    if (L.lid) { lid = new THREE.Mesh(L.lid, this.material); lid.position.set(0, 0.5, -0.3); lid.castShadow = true; mesh.add(lid); }
    const beam = new THREE.Mesh(BEAM_GEO, beamMaterial());
    beam.material.uniforms.uColor.value.set(L.color);
    beam.scale.set(L.w, L.h, L.w);
    beam.layers.set(LAYER.FX); beam.frustumCulled = false; beam.renderOrder = 22;
    const disc = new THREE.Mesh(DISC_GEO, discMaterial());
    disc.material.uniforms.uColor.value.set(L.color);
    const ds = L.chest ? 2.2 : 0.8 + L.r * 0.18;
    disc.scale.set(ds, 1, ds);
    disc.layers.set(LAYER.FX); disc.renderOrder = 21;
    this.scene.add(root, beam, disc);
    const v = { d, L, root, mesh, lid, beam, disc, x: d.x, z: d.z, y, fx, fy: this.map.groundAt(fx, fz) + 1, fz, t: 0, arc: fx !== d.x || fz !== d.z ? 0.5 : 0, spin: (d.id * 1.37) % (Math.PI * 2), gone: null, gt: 0, sparkT: 0 };
    this.drops.set(d.id, v);
    this.place(v, 0);
    if (L.r >= 3 || L.chest) {
      const c = new THREE.Color(L.color);
      this.lights.flash(d.x, y + 1.2, d.z, c.getHex(), L.chest ? 7 : 5, L.r >= 4 ? 5 : 3.5, 0.6);
    }
    return v;
  }

  get(id) { return this.drops.get(id); }

  // how: 'pick' (flies to `to`), 'expire' (sinks), 'open' (the chest bursts open).
  remove(id, how = 'pick', to = null) {
    const v = this.drops.get(id);
    if (!v || v.gone) return v;
    v.gone = how; v.gt = 0; v.to = to;
    if (how === 'open') {
      const c = new THREE.Color(v.L.color);
      this.effects.sparks(v.x, v.y + 0.6, v.z, 40, { color: [1, 0.95, 0.7], color1: [c.r, c.g, c.b], up: 7, spread: 4, gravity: 9, life: 0.9 });
      this.lights.flash(v.x, v.y + 1.5, v.z, c.getHex(), 9, 6, 0.8);
    }
    return v;
  }

  clear() { for (const id of [...this.drops.keys()]) this.dispose(id); }

  dispose(id) {
    const v = this.drops.get(id);
    if (!v) return;
    this.scene.remove(v.root, v.beam, v.disc);
    v.beam.material.dispose(); v.disc.material.dispose();
    this.drops.delete(id);
  }

  place(v, bob) {
    let x = v.x, y = v.y, z = v.z;
    if (v.t < v.arc) {
      const k = v.t / v.arc, e = 1 - (1 - k) * (1 - k);
      x = v.fx + (v.x - v.fx) * e; z = v.fz + (v.z - v.fz) * e;
      y = v.fy + (v.y - v.fy) * k + Math.sin(k * Math.PI) * 1.6;
    } else y += 0.12 + bob;
    v.root.position.set(x, y, z);
    v.beam.position.set(v.x, v.y, v.z);
    v.disc.position.set(v.x, v.y + 0.05, v.z);
  }

  // ps: where you are (picked loot flies to you).
  update(dt, ps) {
    this.time += dt;
    const R = Math.random;
    for (const [id, v] of this.drops) {
      const was = v.t;
      v.t += dt;
      const landed = was < v.arc && v.t >= v.arc;
      if (landed) this.effects.sparks(v.x, v.y + 0.1, v.z, 6 + v.L.r * 3, { color: [1, 0.95, 0.75], color1: [0.9, 0.7, 0.3], up: 2, spread: 2, gravity: 8, life: 0.4 });
      const settle = Math.min(1, Math.max(0, (v.t - v.arc) / 0.3));
      const bob = v.L.chest ? 0 : (0.06 + 0.04 * Math.sin(this.time * 2.4 + v.spin)) * settle;
      if (!v.L.chest) v.mesh.rotation.y = v.spin + this.time * (v.t < v.arc ? 9 : 0.9);
      else v.mesh.rotation.y = v.spin;
      this.place(v, bob);
      let a = Math.min(1, Math.max(0, (v.t - v.arc * 0.6) / 0.4)) * v.L.a;
      if (v.gone) {
        v.gt += dt;
        if (v.gone === 'pick') {
          const k = Math.min(1, v.gt / 0.28), tx = v.to ? v.to.x : v.x, tz = v.to ? v.to.z : v.z, ty = (v.to ? v.to.y : v.y) + 1.1;
          v.root.position.set(v.root.position.x + (tx - v.root.position.x) * k, v.root.position.y + (ty - v.root.position.y) * k, v.root.position.z + (tz - v.root.position.z) * k);
          v.root.scale.setScalar(1 - k * 0.8);
          a *= 1 - k;
          if (k >= 1) { this.dispose(id); continue; }
        } else if (v.gone === 'expire') {
          const k = Math.min(1, v.gt / 0.8);
          v.root.position.y -= k * 0.4; v.root.scale.setScalar(1 - k);
          a *= 1 - k;
          if (k >= 1) { this.dispose(id); continue; }
        } else if (v.gone === 'open') {
          const k = Math.min(1, v.gt / 0.7);
          if (v.lid) v.lid.rotation.x = -k * 1.9;
          a *= 1 - k * 0.6;
          if (v.gt > 1.4) { v.root.scale.setScalar(Math.max(0, 1 - (v.gt - 1.4) / 0.4)); if (v.gt > 1.8) { this.dispose(id); continue; } }
        }
      }
      for (const m of [v.beam, v.disc]) { m.material.uniforms.uA.value = a; m.material.uniforms.uTime.value = this.time + v.spin; }
      // Epic and legendary drops (and chests) shed sparks up their beam.
      if (v.L.sparks && !v.gone && v.t > v.arc) {
        v.sparkT -= dt;
        if (v.sparkT <= 0) {
          v.sparkT = v.L.r >= 4 ? 0.05 : 0.12;
          const c = new THREE.Color(v.L.color), an = R() * Math.PI * 2, rr = 0.15 + R() * 0.35;
          this.effects.add.spawn(v.x + Math.cos(an) * rr, v.y + 0.2 + R() * 0.6, v.z + Math.sin(an) * rr, 0, 1.4 + R() * 1.8, 0,
            { life: 0.8 + R() * 0.6, size: 0.22, size1: 0.05, color: [c.r, c.g, c.b], alpha: 0.9, gravity: -0.4, drag: 0.6, shape: SHAPE.GLOW });
        }
      }
    }
  }
}
