// The mortar crab (M3, PLAN-M3.md §2.2): a non-humanoid enemy view with the same API as CharacterView
// (root, height, update, flash, hit, glow, attack). Coral shell with an iron plate bolted on the front
// (that is the armour: hit it from behind), six scuttling legs, two claws and a mortar tube on its back
// that glows in the wind-up and kicks when it fires.
import * as THREE from 'three';
import { part, merge, cyl, sphere, rbox, torus, lumpy, cone } from './geo.js';
import { characterMaterial } from './characters.js';
import { damp, spring } from '../core/math.js';
import { ACT } from '../sim/ecs.js';

const SHELL = 0xc4573a, SHELL_D = 0x8e3424, BELLY = 0xe8b08a, IRON = 0x4a4e58, IRON_D = 0x30333a, BRASS = 0xc9a24a, EYE = 0x15161c;

function withGlow(geo, glowFn = null) {
  const n = geo.attributes.position.count, g = new Float32Array(n), p = geo.attributes.position;
  if (glowFn) for (let i = 0; i < n; i++) g[i] = glowFn(p.getX(i), p.getY(i), p.getZ(i));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(g, 1));
  geo.computeVertexNormals();
  return geo;
}

let G = null;
function build() {
  const body = [];
  // Shell: a flattened lumpy dome with darker spots, a pale belly underneath.
  body.push(part(lumpy(sphere(0.62, 18, 12), 0.05, 11), 0, { pos: [0, 0.62, -0.05], scale: [1.08, 0.5, 0.86], paint: (x, y, z) => (Math.sin(x * 9) * Math.cos(z * 11) > 0.55 ? SHELL_D : SHELL) }));
  body.push(part(sphere(0.55, 14, 8), BELLY, { pos: [0, 0.5, -0.05], scale: [1.0, 0.28, 0.8] }));
  // Spikes along the rim of the shell.
  for (let i = 0; i < 7; i++) {
    const a = -1.2 + i * 0.4;
    body.push(part(cone(0.07, 0.22, 6), SHELL_D, { pos: [Math.sin(a) * 0.66, 0.74, -0.05 - Math.cos(a) * 0.5], rot: [-0.6 * Math.cos(a), 0, 0.6 * Math.sin(a)] }));
  }
  // The armour: an iron plate on the front with brass rivets (the 120° in front of it).
  body.push(part(rbox(1.05, 0.42, 0.12, 0.04), IRON, { pos: [0, 0.66, 0.5], rot: [-0.35, 0, 0] }));
  body.push(part(rbox(0.7, 0.1, 0.1, 0.03), IRON_D, { pos: [0, 0.86, 0.46], rot: [-0.35, 0, 0] }));
  for (const x of [-0.42, -0.14, 0.14, 0.42]) body.push(part(sphere(0.035, 6, 4), BRASS, { pos: [x, 0.7, 0.57] }));
  // Eyes on stalks, just above the plate.
  for (const sd of [1, -1]) {
    body.push(part(cyl(0.025, 0.03, 0.22, 5), SHELL_D, { pos: [sd * 0.16, 0.95, 0.38] }));
    body.push(part(sphere(0.055, 8, 6), EYE, { pos: [sd * 0.16, 1.07, 0.39] }));
  }
  // Mortar mount on the back.
  body.push(part(cyl(0.24, 0.3, 0.16, 12), IRON_D, { pos: [0, 0.9, -0.22] }));
  // Mortar tube (its own mesh: it recoils). Origin at the pivot; the muzzle glows.
  const tube = [];
  const prof = [[0, 0.17], [0.05, 0.2], [0.12, 0.2], [0.14, 0.16], [0.55, 0.15], [0.58, 0.19], [0.66, 0.19], [0.66, 0.12]];
  const lathe = new THREE.LatheGeometry(prof.map(([y, r]) => new THREE.Vector2(r, y)), 12);
  tube.push(part(lathe, 0, { paint: (x, y) => (y > 0.55 || (y > 0.03 && y < 0.13) ? BRASS : IRON) }));
  tube.push(part(cyl(0.11, 0.11, 0.02, 10), 0xffa040, { pos: [0, 0.6, 0] }));
  // A leg: two segments, hinged at the body (each leg mesh is rotated as a whole).
  const leg = [];
  leg.push(part(cyl(0.05, 0.045, 0.42, 6), SHELL, { pos: [0.21, 0.08, 0], rot: [0, 0, -1.25] }));
  leg.push(part(cyl(0.045, 0.02, 0.5, 6), SHELL_D, { pos: [0.5, -0.18, 0], rot: [0, 0, -0.35] }));
  // A claw (right side; the left one is built mirrored so the winding stays right).
  const claw = (sd) => {
    const L = [];
    L.push(part(cyl(0.07, 0.06, 0.36, 7), SHELL, { pos: [sd * 0.1, 0, 0.12], rot: [Math.PI / 2 - 0.3, 0, 0] }));
    L.push(part(lumpy(sphere(0.17, 10, 8), 0.06, 4 + sd), SHELL, { pos: [sd * 0.12, 0.05, 0.36], scale: [0.85, 0.75, 1.15] }));
    L.push(part(cone(0.08, 0.3, 6), SHELL_D, { pos: [sd * 0.15, 0.1, 0.56], rot: [Math.PI / 2 - 0.15, 0, 0] }));
    L.push(part(cone(0.06, 0.24, 6), SHELL_D, { pos: [sd * 0.08, -0.03, 0.52], rot: [Math.PI / 2 + 0.25, 0, 0] }));
    return withGlow(merge(L));
  };
  G = {
    body: withGlow(merge(body)),
    tube: withGlow(merge(tube), (x, y) => (y > 0.58 ? 1 : 0)),
    leg: withGlow(merge(leg)),
    clawR: claw(1), clawL: claw(-1),
  };
}

export class CrabView {
  constructor() {
    if (!G) build();
    this.root = new THREE.Group();
    this.height = 1.35;
    this.material = characterMaterial('base');
    this.glow = this.material.userData.glow;
    this.flashU = this.material.userData.flash.value;
    this.flashA = 0; this.flashCol = new THREE.Color(1, 1, 1);
    this.look = { enemy: true, body: 'prop' };
    this.armed = false;
    this.attack = null;
    this.meshes = [];
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.add(G.body, this.body);
    this.tubePivot = new THREE.Group();
    this.tubePivot.position.set(0, 0.95, -0.22);
    this.tubePivot.rotation.x = -0.55; // leaning back: it lobs over its own head
    this.body.add(this.tubePivot);
    this.tube = this.add(G.tube, this.tubePivot);
    this.legs = [];
    for (const sd of [1, -1]) for (let i = 0; i < 3; i++) {
      const pv = new THREE.Group();
      pv.position.set(sd * 0.42, 0.5, 0.22 - i * 0.3);
      pv.rotation.y = sd > 0 ? -0.35 + i * 0.35 : Math.PI + 0.35 - i * 0.35;
      this.body.add(pv);
      this.add(G.leg, pv);
      this.legs.push({ pv, sd, i, base: pv.rotation.y });
    }
    this.claws = [];
    for (const sd of [1, -1]) {
      const pv = new THREE.Group();
      pv.position.set(sd * 0.42, 0.55, 0.38);
      this.body.add(pv);
      this.add(sd > 0 ? G.clawR : G.clawL, pv);
      this.claws.push({ pv, sd });
    }
    this.phase = 0;
    this.recoil = { x: 0, v: 0 };
    this.bob = { x: 0, v: 0 };
    this.fired = false;
    this.glow.value = 0;
  }
  add(geo, parent) {
    const m = new THREE.Mesh(geo, this.material);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    this.meshes.push(m);
    return m;
  }
  flash(color = 0xffffff, amount = 1) { this.flashCol.set(color); this.flashA = Math.max(this.flashA, amount); }
  hit(k = 1) { this.bob.v -= 2.5 * k; }

  update(dt, s) {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.f;
    const sp = Math.hypot(s.vx || 0, s.vz || 0);
    // Scuttle: legs swing in two alternating tripods, faster when it moves.
    this.phase += dt * (3 + sp * 5);
    const k = Math.min(1, sp / 1.5);
    for (const L of this.legs) {
      const ph = this.phase + (L.i % 2 === (L.sd > 0 ? 0 : 1) ? 0 : Math.PI);
      L.pv.rotation.y = L.base + Math.sin(ph) * 0.35 * k;
      L.pv.rotation.z = Math.max(0, Math.cos(ph)) * 0.35 * k;
    }
    // Claws: snap open and shut idly, raised in the wind-up.
    const a = this.attack;
    let lit = 0, raise = 0;
    if (a) {
      a.t += dt;
      if (a.t < a.windup) { lit = 0.5 + 0.5 * Math.abs(Math.sin(a.t * 24)); raise = Math.min(1, a.t / 0.2); }
      else if (!this.fired) { this.fired = true; this.recoil.v -= 9; this.bob.v -= 3; }
      if (a.t > a.windup + 0.6) { this.attack = null; this.fired = false; }
    }
    for (const c of this.claws) {
      c.pv.rotation.x = -0.3 * raise + Math.sin(this.phase * 0.7 + c.sd) * 0.06;
      c.pv.rotation.y = c.sd * (0.25 + 0.15 * raise);
    }
    spring(this.recoil, 0, 90, 10, dt);
    spring(this.bob, 0, 80, 9, dt);
    this.tube.position.y = this.recoil.x * 0.06;
    this.tubePivot.rotation.x = -0.55 + this.recoil.x * 0.05;
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.03 * k + this.bob.x * 0.04;
    this.body.rotation.z = Math.sin(this.phase) * 0.04 * k;
    this.glow.value = damp(this.glow.value, s.act === ACT.STAGGER ? 0 : lit, 30, dt);
    this.flashA = Math.max(0, this.flashA - dt * 6);
    this.flashU.set(this.flashCol.r, this.flashCol.g, this.flashCol.b, Math.min(1, this.flashA) * 0.85);
  }
}
