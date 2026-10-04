// Cosmetic wildlife (client-only, not simulated): beach crabs that flee, gulls circling the coast,
// butterflies around the village flowers. All instanced; no allocation per frame.
import * as THREE from 'three';
import { part, merge, sphere, bbox as box, cyl } from './geo.js';
import { toon } from './toon.js';
import { LAYER } from './pipeline.js';
import { mulberry32 } from '../core/rng.js';

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();

function crabGeo() {
  const C = 0xff6a3d, D = 0xd9472a;
  const L = [
    part(sphere(0.2, 10, 6), C, { pos: [0, 0.14, 0], scale: [1.3, 0.55, 1] }),
    part(sphere(0.09, 6, 4), D, { pos: [0.3, 0.17, 0.12], scale: [1.2, 0.8, 0.9] }),
    part(sphere(0.09, 6, 4), D, { pos: [-0.3, 0.17, 0.12], scale: [1.2, 0.8, 0.9] }),
    part(cyl(0.015, 0.015, 0.12, 3), D, { pos: [0.07, 0.26, 0.12] }),
    part(cyl(0.015, 0.015, 0.12, 3), D, { pos: [-0.07, 0.26, 0.12] }),
    part(sphere(0.03, 4, 3), 0x1a1033, { pos: [0.07, 0.33, 0.12] }),
    part(sphere(0.03, 4, 3), 0x1a1033, { pos: [-0.07, 0.33, 0.12] }),
  ];
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) L.push(part(box(0.18, 0.03, 0.03), D, { pos: [sx * 0.27, 0.08, -0.08 + i * 0.08], rot: [0, 0, sx * -0.5] }));
  return merge(L);
}

function gullBodyGeo() {
  return merge([
    part(sphere(0.22, 8, 6), 0xffffff, { scale: [0.8, 0.75, 1.7] }),
    part(sphere(0.13, 6, 4), 0xffffff, { pos: [0, 0.08, 0.32] }),
    part(box(0.05, 0.04, 0.16), 0xffb02e, { pos: [0, 0.06, 0.48] }),
    part(box(0.2, 0.03, 0.18), 0x6a7280, { pos: [0, 0.02, -0.4] }),
  ]);
}
function gullWingGeo() {
  const paint = (x) => (Math.abs(x) > 0.55 ? 0x3d4250 : 0xeef2f6);
  return merge([part(box(0.8, 0.03, 0.26), 0, { pos: [0.4, 0, 0], paint })]);
}
function wingGeo() {
  const g = new THREE.PlaneGeometry(0.16, 0.13);
  g.translate(0.08, 0, 0);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class Ambient {
  constructor(scene, map) {
    this.map = map;
    const rng = mulberry32(map.seed ^ 0xc0ffee);
    const mat = toon({ color: 0xffffff, vertexColors: true }, { key: 'critter', comic: false });
    // Crabs on the beach band.
    this.crabs = [];
    let tries = 0;
    while (this.crabs.length < 14 && tries++ < 4000) {
      const x = rng.range(-170, 170), z = rng.range(-170, 170);
      const h = map.heightAt(x, z);
      if (h < 0.15 || h > 1.1 || map.queryColliders(x, z, 1).length) continue;
      this.crabs.push({ x, z, a: rng.range(0, 6.28), t: rng.range(0, 3), mode: 0, speed: 0, home: { x, z } });
    }
    this.crabMesh = new THREE.InstancedMesh(crabGeo(), mat, this.crabs.length);
    this.crabMesh.castShadow = true;
    this.crabMesh.frustumCulled = false;
    scene.add(this.crabMesh);
    // Gulls circling coastal points.
    this.gulls = [];
    const L = map.landmarks;
    const centers = [L.dockEnd, L.ship, { x: L.spawn.x + 16, z: L.spawn.z + 16 }];
    for (let i = 0; i < 11; i++) {
      const c = centers[i % centers.length];
      this.gulls.push({ cx: c.x + rng.range(-10, 10), cz: c.z + rng.range(-10, 10), r: rng.range(9, 18), a: rng.range(0, 6.28), w: rng.range(0.2, 0.32) * (rng() < 0.5 ? 1 : -1), h: rng.range(3.4, 5.2), flap: rng.range(0, 6), glide: 0 });
    }
    this.gullBody = new THREE.InstancedMesh(gullBodyGeo(), mat, this.gulls.length);
    this.gullWing = new THREE.InstancedMesh(gullWingGeo(), mat, this.gulls.length * 2);
    for (const m of [this.gullBody, this.gullWing]) { m.castShadow = true; m.frustumCulled = false; scene.add(m); }
    // Butterflies near flowers.
    const flowers = map.props.filter((p) => p.kind === 'flower');
    this.flies = [];
    for (let i = 0; i < Math.min(22, flowers.length); i++) {
      const f = flowers[Math.floor(rng() * flowers.length)];
      this.flies.push({ ax: f.x, az: f.z, ay: f.y, x: f.x, y: f.y + 0.8, z: f.z, t: rng.range(0, 10), sp: rng.range(0.7, 1.3), ph: rng.range(0, 6) });
    }
    const flyMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.flyWing = new THREE.InstancedMesh(wingGeo(), flyMat, Math.max(1, this.flies.length * 2));
    this.flyWing.layers.set(LAYER.NO_OUTLINE);
    this.flyWing.frustumCulled = false;
    const palette = [0xffa63d, 0x5ad1ff, 0xffe14d, 0xff6fb5];
    const col = new THREE.Color();
    for (let i = 0; i < this.flies.length; i++) {
      col.set(palette[i % palette.length]);
      this.flyWing.setColorAt(i * 2, col); this.flyWing.setColorAt(i * 2 + 1, col);
    }
    scene.add(this.flyWing);
    this.time = 0;
  }

  update(dt, player, camPos) {
    this.time += dt;
    const map = this.map;
    // Crabs: scuttle sideways, pause, flee from the player.
    for (let i = 0; i < this.crabs.length; i++) {
      const c = this.crabs[i];
      const dx = c.x - player.x, dz = c.z - player.z;
      const d = Math.hypot(dx, dz);
      c.t -= dt;
      if (d < 4.5) { c.mode = 2; c.a = Math.atan2(dx, dz) + Math.PI / 2; c.t = 0.8; }
      else if (c.t <= 0) { c.mode = c.mode === 1 ? 0 : 1; c.t = c.mode ? 0.6 + Math.random() * 1.2 : 1 + Math.random() * 3; if (c.mode) c.a += (Math.random() - 0.5) * 2; }
      const sp = c.mode === 2 ? 3.6 : c.mode === 1 ? 1.1 : 0;
      c.speed += (sp - c.speed) * Math.min(1, dt * 10);
      // sideways walk: move along local x
      const mx = Math.cos(c.a) * c.speed * dt, mz = -Math.sin(c.a) * c.speed * dt;
      const nx = c.x + mx, nz = c.z + mz;
      const h = map.heightAt(nx, nz);
      if (h > 0.05 && h < 1.3) { c.x = nx; c.z = nz; } else { c.a += Math.PI * 0.6; }
      if (Math.hypot(c.x - c.home.x, c.z - c.home.z) > 14) c.a = Math.atan2(c.home.x - c.x, c.home.z - c.z) + Math.PI / 2;
      const jig = c.speed > 0.2 ? Math.sin(this.time * 30 + i) * 0.03 : 0;
      e.set(0, c.a, jig * 3);
      q.setFromEuler(e);
      m4.compose(v.set(c.x, map.heightAt(c.x, c.z) + Math.abs(jig), c.z), q, s.set(1, 1, 1));
      this.crabMesh.setMatrixAt(i, m4);
    }
    this.crabMesh.instanceMatrix.needsUpdate = true;
    // Gulls: circle with flap/glide phases.
    for (let i = 0; i < this.gulls.length; i++) {
      const g = this.gulls[i];
      g.a += g.w * dt;
      const x = g.cx + Math.cos(g.a) * g.r, z = g.cz + Math.sin(g.a) * g.r;
      const y = g.h + Math.sin(this.time * 0.7 + i) * 0.8;
      const heading = Math.atan2(-Math.sin(g.a) * Math.sign(g.w), Math.cos(g.a) * Math.sign(g.w));
      g.glide -= dt;
      if (g.glide < -1.6) g.glide = 1.5 + Math.random() * 2;
      const flapping = g.glide < 0;
      g.flap += dt * (flapping ? 11 : 0);
      const wingA = flapping ? Math.sin(g.flap) * 0.7 : 0.08 + Math.sin(this.time * 2 + i) * 0.05;
      const bank = -Math.sign(g.w) * 0.35;
      e.set(0, heading, bank);
      q.setFromEuler(e);
      m4.compose(v.set(x, y, z), q, s.set(0.7, 0.7, 0.7));
      this.gullBody.setMatrixAt(i, m4);
      for (const side of [1, -1]) {
        e.set(0, heading, bank + side * wingA, 'YXZ');
        q.setFromEuler(e);
        m4.compose(v.set(x, y + 0.035, z), q, s.set(side * 0.7, 0.7, 0.7));
        this.gullWing.setMatrixAt(i * 2 + (side > 0 ? 0 : 1), m4);
      }
    }
    this.gullBody.instanceMatrix.needsUpdate = true;
    this.gullWing.instanceMatrix.needsUpdate = true;
    // Butterflies: lazy lissajous around their flower, wings flap fast.
    for (let i = 0; i < this.flies.length; i++) {
      const f = this.flies[i];
      f.t += dt * f.sp;
      const x = f.ax + Math.sin(f.t * 0.9 + f.ph) * 1.4 + Math.sin(f.t * 2.3) * 0.3;
      const z = f.az + Math.cos(f.t * 0.7 + f.ph) * 1.4;
      const y = f.ay + 0.7 + Math.sin(f.t * 1.7) * 0.35;
      const heading = Math.atan2(x - f.x, z - f.z);
      f.x = x; f.y = y; f.z = z;
      const flap = Math.sin(this.time * 22 + f.ph) * 1.1;
      for (const side of [1, -1]) {
        e.set(0, heading + Math.PI / 2, side * flap, 'YXZ');
        q.setFromEuler(e);
        m4.compose(v.set(x, y, z), q, s.set(side, 1, 1));
        this.flyWing.setMatrixAt(i * 2 + (side > 0 ? 0 : 1), m4);
      }
    }
    this.flyWing.instanceMatrix.needsUpdate = true;
  }
}
