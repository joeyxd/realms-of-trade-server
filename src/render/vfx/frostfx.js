// Persistent, client-visible ice fields. The live hazard list is the source of truth so snapshots,
// prediction rollback and late joins all show the same remaining lifetime.
import * as THREE from 'three';
import { LAYER } from '../pipeline.js';
import { DT } from '../../data/tuning.js';

const CAPACITY = 16;
const SEGMENTS = 56;
const ICE = 0x72eaff;
const WHITE = 0xdfffff;

function polarGeometry(rings, segments = SEGMENTS) {
  const vertices = rings.length * (segments + 1);
  const pos = new Float32Array(vertices * 3), polar = new Float32Array(vertices * 2), indices = [];
  let k = 0;
  for (const r of rings) for (let j = 0; j <= segments; j++) {
    polar[k * 2] = r;
    polar[k * 2 + 1] = j / segments * Math.PI * 2;
    k++;
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < segments; j++) {
    const a = i * (segments + 1) + j, b = a + 1, c = a + segments + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aPolar', new THREE.BufferAttribute(polar, 2));
  g.setIndex(indices);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

function lay(geo, map, x, z, radius, lift) {
  const p = geo.attributes.position.array, polar = geo.attributes.aPolar.array;
  for (let i = 0; i < polar.length / 2; i++) {
    const a = polar[i * 2 + 1], r = polar[i * 2] * radius;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    p[i * 3] = px; p[i * 3 + 1] = map.groundAt(px, pz) + lift; p[i * 3 + 2] = pz;
  }
  geo.attributes.position.needsUpdate = true;
}

function surfaceMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
}

export class FrostFx {
  constructor(scene, map) {
    this.map = map;
    this.slots = [];
    for (let i = 0; i < CAPACITY; i++) this.slots.push(this.makeSlot(scene));
  }

  makeSlot(scene) {
    const disk = new THREE.Mesh(polarGeometry([0, 0.42, 0.78, 0.94]), surfaceMaterial(ICE, 0.105));
    const rim = new THREE.Mesh(polarGeometry([0.94, 1.0]), surfaceMaterial(WHITE, 0.88));
    const inner = new THREE.Mesh(polarGeometry([0.69, 0.72]), surfaceMaterial(ICE, 0.72));
    for (const mesh of [disk, rim, inner]) {
      mesh.frustumCulled = false;
      mesh.layers.set(LAYER.FX);
      mesh.renderOrder = 4;
      mesh.visible = false;
      scene.add(mesh);
    }

    const anchor = new THREE.Group();
    anchor.layers.set(LAYER.FX);
    anchor.visible = false;
    const crystalMat = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, depthWrite: false });
    const blueMat = new THREE.MeshBasicMaterial({ color: ICE, transparent: true, depthWrite: false });
    const makeShard = (geometry, material, x, y, z, sx, sy, sz, yaw = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.rotation.y = yaw;
      mesh.layers.set(LAYER.FX); mesh.renderOrder = 8;
      anchor.add(mesh);
      return mesh;
    };
    const shards = [
      makeShard(new THREE.OctahedronGeometry(0.42, 0), crystalMat, 0, 0.8, 0, 0.56, 2.15, 0.56),
      makeShard(new THREE.OctahedronGeometry(0.31, 0), blueMat, -0.4, 0.42, 0.04, 0.55, 1.3, 0.55, -0.35),
      makeShard(new THREE.OctahedronGeometry(0.29, 0), crystalMat, 0.4, 0.36, -0.02, 0.5, 1.2, 0.5, 0.4),
    ];
    // A short crossbar gives the ice formation an unmistakable anchor silhouette.
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.13, 0.16), blueMat);
    bar.position.set(0, 0.76, 0); bar.rotation.y = Math.PI / 4; bar.layers.set(LAYER.FX); bar.renderOrder = 8;
    anchor.add(bar);
    scene.add(anchor);
    return { disk, rim, inner, anchor, shards, key: '', id: '', live: false, mat: [disk.material, rim.material, inner.material], crystalMat: [crystalMat, blueMat] };
  }

  update(fields, tick) {
    const present = new Set();
    for (const field of fields || []) {
      if (!field || !Number.isFinite(field.x) || !Number.isFinite(field.z) || !(field.r > 0)) continue;
      // The network snapshot retains field history for reconciliation; only draw its live tick interval.
      if (Number.isFinite(field.t0) && tick < field.t0) continue;
      if (Number.isFinite(field.tEnd) && tick >= field.tEnd) continue;
      // `fieldOwner` is supplied by the client when local prediction is matched to the server entity.
      const owner = field.fieldOwner ?? field.e;
      const id = `${owner}:${field.seq}`;
      present.add(id);
      let slot = this.slots.find((s) => s.id === id) || this.slots.find((s) => !s.live);
      if (!slot) slot = this.slots[0];
      const key = `${field.x.toFixed(2)}:${field.z.toFixed(2)}:${field.r.toFixed(2)}`;
      if (!slot.live || slot.id !== id || slot.key !== key) {
        slot.id = id; slot.key = key;
        lay(slot.disk.geometry, this.map, field.x, field.z, field.r, 0.045);
        lay(slot.rim.geometry, this.map, field.x, field.z, field.r, 0.065);
        lay(slot.inner.geometry, this.map, field.x, field.z, field.r, 0.075);
        slot.anchor.position.set(field.x, this.map.groundAt(field.x, field.z) + 0.08, field.z);
      }
      slot.live = true;
      slot.disk.visible = slot.rim.visible = slot.inner.visible = slot.anchor.visible = true;
      const left = Number.isFinite(field.tEnd) ? Math.max(0, (field.tEnd - tick) * DT) : 1;
      const fade = Math.min(1, left / 0.42);
      slot.mat[0].opacity = 0.105 * (0.8 + 0.2 * (0.5 + 0.5 * Math.sin(tick * DT * 5))) * fade;
      slot.mat[1].opacity = 0.88 * fade;
      slot.mat[2].opacity = 0.6 * fade;
      slot.crystalMat[0].opacity = fade;
      slot.crystalMat[1].opacity = 0.82 * fade;
      const pulse = 1 + Math.sin(tick * DT * 5 + (field.seq || 0)) * 0.035;
      slot.anchor.scale.setScalar(pulse);
    }
    for (const slot of this.slots) if (slot.live && !present.has(slot.id)) {
      slot.live = false;
      slot.disk.visible = slot.rim.visible = slot.inner.visible = slot.anchor.visible = false;
    }
  }
}
