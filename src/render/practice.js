// Tutorial props that are entities (the server spawns them): the straw training dummy and the beach
// cannon that lobs parryable balls. Same view API as CharacterView (root, height, update, flash, hit),
// same toon material (rim, hit flash, glow), so they light and outline like everything else.
import * as THREE from 'three';
import { part, merge, cyl, sphere, rbox, torus, lumpy } from './geo.js';
import { characterMaterial } from './characters.js';
import { damp, spring } from '../core/math.js';

const WOOD = 0x8a5a2e, WOOD_D = 0x5e3a1c, STRAW = 0xe2b45a, STRAW_D = 0xb98a34, IRON = 0x34363e, IRON_L = 0x4a4d57, BRASS = 0xc9a24a, SACK = 0xc8a878, RED = 0xc0392b;

function withGlow(geo, glowFn = null) {
  const n = geo.attributes.position.count, g = new Float32Array(n), p = geo.attributes.position;
  if (glowFn) for (let i = 0; i < n; i++) g[i] = glowFn(p.getX(i), p.getY(i), p.getZ(i));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(g, 1));
  geo.computeVertexNormals();
  return geo;
}

let dummyGeo = null, carriageGeo = null, barrelGeo = null;

function buildDummy() {
  const L = [];
  L.push(part(cyl(0.065, 0.075, 1.75, 7), WOOD_D, { pos: [0, 0.875, 0] }));
  for (const r of [0, Math.PI / 2]) L.push(part(rbox(0.9, 0.1, 0.12, 0.02), WOOD, { pos: [0, 0.05, 0], rot: [0, r, 0] }));
  L.push(part(cyl(0.05, 0.05, 1.15, 6), WOOD, { pos: [0, 1.3, 0], rot: [0, 0, Math.PI / 2] }));
  const body = lumpy(new THREE.CapsuleGeometry(0.24, 0.42, 3, 9), 0.06, 3);
  L.push(part(body, 0, { pos: [0, 1.12, 0], scale: [1, 1, 0.82], paint: (x, y, z) => (Math.abs(y - 0.12) < 0.035 || Math.abs(y + 0.16) < 0.035 ? WOOD_D : Math.sin(x * 40 + y * 60) > 0.3 ? STRAW_D : STRAW) }));
  // painted target on the chest
  for (const [r, c] of [[0.17, 0xf3ead2], [0.12, RED], [0.07, 0xf3ead2], [0.035, RED]]) L.push(part(cyl(r, r, 0.02, 14), c, { pos: [0, 1.17, 0.205 + (0.17 - r) * 0.02], rot: [Math.PI / 2, 0, 0] }));
  L.push(part(lumpy(sphere(0.19, 9, 7), 0.07, 5), SACK, { pos: [0, 1.66, 0] }));
  L.push(part(torus(0.15, 0.03, 4, 10), WOOD_D, { pos: [0, 1.52, 0], rot: [Math.PI / 2, 0, 0] }));
  for (const sd of [1, -1]) L.push(part(lumpy(sphere(0.1, 6, 5), 0.15, 7 + sd), STRAW, { pos: [sd * 0.58, 1.3, 0] }));
  return withGlow(merge(L));
}

function buildCarriage() {
  const L = [];
  for (const sd of [1, -1]) {
    L.push(part(rbox(0.12, 0.42, 1.25, 0.03), WOOD, { pos: [sd * 0.3, 0.42, -0.05] }));
    for (const z of [0.38, -0.45]) L.push(part(cyl(0.27, 0.27, 0.1, 12), WOOD_D, { pos: [sd * 0.4, 0.27, z], rot: [0, 0, Math.PI / 2] }));
    for (const z of [0.38, -0.45]) L.push(part(cyl(0.07, 0.07, 0.12, 8), IRON, { pos: [sd * 0.46, 0.27, z], rot: [0, 0, Math.PI / 2] }));
  }
  for (const z of [0.38, -0.45]) L.push(part(cyl(0.05, 0.05, 0.9, 6), IRON, { pos: [0, 0.27, z], rot: [0, 0, Math.PI / 2] }));
  L.push(part(rbox(0.5, 0.08, 1.1, 0.02), WOOD_D, { pos: [0, 0.3, -0.05] }));
  // a small pile of balls beside it
  for (const [x, z, y] of [[0.75, -0.2, 0.13], [0.95, -0.05, 0.13], [0.82, 0.12, 0.13], [0.86, -0.04, 0.33]]) L.push(part(sphere(0.13, 8, 6), IRON_L, { pos: [x, y, z] }));
  return withGlow(merge(L));
}

function buildBarrel() {
  const L = [];
  const pts = [];
  const prof = [[0, 0.0], [0.02, 0.2], [0.18, 0.24], [0.3, 0.22], [1.2, 0.17], [1.32, 0.2], [1.4, 0.2], [1.42, 0.13]];
  for (const [z, r] of prof) pts.push(new THREE.Vector2(r, z));
  const lathe = new THREE.LatheGeometry(pts, 12);
  lathe.rotateX(Math.PI / 2);
  L.push(part(lathe, 0, { pos: [0, 0, -0.45], paint: (x, y, z) => (Math.abs(z + 0.45 - 0.3) < 0.04 || Math.abs(z + 0.45 - 1.3) < 0.06 ? BRASS : IRON) }));
  L.push(part(cyl(0.06, 0.06, 0.62, 6), IRON, { pos: [0, 0, 0], rot: [0, 0, Math.PI / 2] }));
  // fuse at the breech: glows during the wind-up
  L.push(part(cyl(0.025, 0.025, 0.12, 5), 0xffc46a, { pos: [0, 0.2, -0.38] }));
  return withGlow(merge(L), (x, y, z) => (y > 0.13 && z < -0.3 ? 1 : 0));
}

class PracticeView {
  constructor(height) {
    this.root = new THREE.Group();
    this.height = height;
    this.material = characterMaterial('base');
    this.glow = this.material.userData.glow;
    this.flashU = this.material.userData.flash.value;
    this.flashA = 0; this.flashCol = new THREE.Color(1, 1, 1);
    this.look = { enemy: true, body: 'prop' };
    this.armed = false;
    this.attack = null;
    this.meshes = [];
  }
  addMesh(geo, parent = this.root) {
    const m = new THREE.Mesh(geo, this.material);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    this.meshes.push(m);
    return m;
  }
  flash(color = 0xffffff, amount = 1) { this.flashCol.set(color); this.flashA = Math.max(this.flashA, amount); }
  tickFlash(dt) {
    this.flashA = Math.max(0, this.flashA - dt * 6);
    this.flashU.set(this.flashCol.r, this.flashCol.g, this.flashCol.b, Math.min(1, this.flashA) * 0.85);
  }
}

export class DummyView extends PracticeView {
  constructor() {
    super(1.85);
    if (!dummyGeo) dummyGeo = buildDummy();
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    this.addMesh(dummyGeo, this.pivot);
    this.wx = { x: 0, v: 0 }; this.wz = { x: 0, v: 0 };
    this.glow.value = 0;
  }
  hit(k = 1, dir = 1, fx = 0, fz = 1) {
    // Wobble away from the hit (in the dummy's local frame).
    const f = -this.root.rotation.y;
    const lx = fx * Math.cos(f) - fz * Math.sin(f), lz = fx * Math.sin(f) + fz * Math.cos(f);
    this.wx.v += lz * 3.2 * k; this.wz.v -= lx * 3.2 * k;
  }
  update(dt, s) {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.f;
    spring(this.wx, 0, 70, 5, dt);
    spring(this.wz, 0, 70, 5, dt);
    this.pivot.rotation.set(this.wx.x * 0.35, 0, this.wz.x * 0.35);
    this.tickFlash(dt);
  }
}

export class CannonView extends PracticeView {
  constructor() {
    super(1.2);
    if (!carriageGeo) { carriageGeo = buildCarriage(); barrelGeo = buildBarrel(); }
    this.addMesh(carriageGeo);
    this.barrelPivot = new THREE.Group();
    this.barrelPivot.position.set(0, 0.62, 0.05);
    this.root.add(this.barrelPivot);
    this.barrel = this.addMesh(barrelGeo, this.barrelPivot);
    this.recoil = { x: 0, v: 0 };
    this.glow.value = 0;
    this.fired = false;
  }
  hit() { this.recoil.v -= 1.5; }
  update(dt, s) {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.f;
    const a = this.attack;
    let lit = 0;
    if (a) {
      a.t += dt;
      if (a.t < a.windup) lit = 0.4 + 0.6 * Math.abs(Math.sin(a.t * 28));
      else if (!this.fired) { this.fired = true; this.recoil.v -= 7; }
      if (a.t > a.windup + 0.6) { this.attack = null; this.fired = false; }
    }
    this.glow.value = damp(this.glow.value, lit, 30, dt);
    spring(this.recoil, 0, 90, 11, dt);
    this.barrel.position.z = this.recoil.x * 0.12;
    this.barrelPivot.rotation.x = -0.12 + this.recoil.x * 0.04;
    this.tickFlash(dt);
  }
}
