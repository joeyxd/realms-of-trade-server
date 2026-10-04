// Enemy deaths: the body comes apart (DESIGN §7). The look's merged geometry is split once by each
// triangle's main bone; when an enemy dies, every piece starts from its bone's current pose and flies
// off with a spin, bounces on the ground, then sinks away. Pieces reuse the dead character's material.
import * as THREE from 'three';
import { worldNormalMat } from '../toon.js';

const cache = new Map(); // look key → [{geo, center: Vector3, bone}]

function piecesOf(built, key) {
  if (cache.has(key)) return cache.get(key);
  const g = built.geo, pos = g.attributes.position, col = g.attributes.color, glow = g.attributes.aGlow, si = g.attributes.skinIndex;
  const byBone = new Map();
  for (let t = 0; t < pos.count; t += 3) {
    const b = si.getX(t);
    if (!byBone.has(b)) byBone.set(b, []);
    byBone.get(b).push(t);
  }
  const out = [];
  for (const [bone, tris] of byBone) {
    if (tris.length < 4) continue;
    const n = tris.length * 3;
    const p = new Float32Array(n * 3), c = new Float32Array(n * 3), gl = new Float32Array(n);
    const center = new THREE.Vector3();
    let k = 0;
    for (const t of tris) for (let v = 0; v < 3; v++) {
      const i = t + v;
      p[k * 3] = pos.getX(i); p[k * 3 + 1] = pos.getY(i); p[k * 3 + 2] = pos.getZ(i);
      c[k * 3] = col.getX(i); c[k * 3 + 1] = col.getY(i); c[k * 3 + 2] = col.getZ(i);
      gl[k] = glow ? glow.getX(i) : 0;
      center.x += p[k * 3]; center.y += p[k * 3 + 1]; center.z += p[k * 3 + 2];
      k++;
    }
    center.divideScalar(n);
    for (let i = 0; i < n; i++) { p[i * 3] -= center.x; p[i * 3 + 1] -= center.y; p[i * 3 + 2] -= center.z; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    out.push({ geo, center, bone });
  }
  cache.set(key, out);
  return out;
}

const m4 = new THREE.Matrix4(), tmpV = new THREE.Vector3();

export class Debris {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.list = [];
    this.onChange = null; // the outline pass re-collects its meshes when pieces come and go
  }

  // Break a CharacterView apart. dir: unit (x, z) the killing blow came from (pieces fly away from it).
  burst(view, dirX = 0, dirZ = 0, power = 1) {
    view.root.updateMatrixWorld(true);
    const sk = view.mesh.skeleton;
    const pieces = piecesOf(view.built, view.skin + (view.armed ? 'a' : ''));
    const base = view.root.position;
    for (const pc of pieces) {
      const mesh = new THREE.Mesh(pc.geo, view.material);
      mesh.userData.nm = worldNormalMat(); // small chunks: world line weight, not a heavy character outline
      mesh.castShadow = true;
      m4.multiplyMatrices(sk.bones[pc.bone].matrixWorld, sk.boneInverses[pc.bone]);
      tmpV.copy(pc.center).applyMatrix4(m4);
      mesh.position.copy(tmpV);
      mesh.quaternion.setFromRotationMatrix(m4);
      const ox = tmpV.x - base.x, oz = tmpV.z - base.z, ol = Math.hypot(ox, oz) || 1;
      const sp = (1.6 + Math.random() * 2.4) * power;
      const v = new THREE.Vector3((ox / ol) * sp * 0.8 - dirX * sp * 0.9 + (Math.random() - 0.5), 2.2 + Math.random() * 3.2 * power, (oz / ol) * sp * 0.8 - dirZ * sp * 0.9 + (Math.random() - 0.5));
      const w = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
      this.scene.add(mesh);
      this.list.push({ mesh, v, w, t: 0, life: 1.7 + Math.random() * 0.5, rest: false });
    }
    if (this.onChange) this.onChange();
  }

  update(dt) {
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.t += dt;
      const m = d.mesh;
      if (!d.rest) {
        d.v.y -= 16 * dt;
        m.position.addScaledVector(d.v, dt);
        e.set(d.w.x * dt, d.w.y * dt, d.w.z * dt);
        m.quaternion.multiply(q.setFromEuler(e));
        const g = this.map.groundAt(m.position.x, m.position.z) + 0.05;
        if (m.position.y < g) {
          m.position.y = g;
          d.v.y = Math.abs(d.v.y) * 0.35; d.v.x *= 0.55; d.v.z *= 0.55; d.w.multiplyScalar(0.5);
          if (Math.abs(d.v.y) < 0.6) d.rest = true;
        }
      }
      const fade = Math.max(0, (d.t - d.life) / 0.6);
      if (fade > 0) { m.position.y -= dt * 0.4; m.scale.setScalar(Math.max(0.01, 1 - fade)); }
      if (fade >= 1) { this.scene.remove(m); this.list.splice(i, 1); if (this.onChange) this.onChange(); }
    }
  }
}
