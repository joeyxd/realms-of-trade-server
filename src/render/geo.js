// Geometry helpers for procedural, vertex-colored, merged props and characters.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const tmpC = new THREE.Color();

// Bake transforms + a flat color (or a per-vertex color function) into a geometry.
export function part(geo, color, { pos, rot, scale, paint } = {}) {
  if (scale) geo.scale(scale[0], scale[1], scale[2]);
  if (rot) {
    if (rot[0]) geo.rotateX(rot[0]);
    if (rot[1]) geo.rotateY(rot[1]);
    if (rot[2]) geo.rotateZ(rot[2]);
  }
  if (pos) geo.translate(pos[0], pos[1], pos[2]);
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const p = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    if (paint) {
      const c = paint(p.getX(i), p.getY(i), p.getZ(i));
      tmpC.set(c);
    } else tmpC.set(color);
    arr[i * 3] = tmpC.r; arr[i * 3 + 1] = tmpC.g; arr[i * 3 + 2] = tmpC.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo.index ? geo.toNonIndexed() : geo;
}

export function merge(list) {
  const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)), false);
  g.computeBoundingSphere();
  return g;
}

export const box = (w, h, d, r = 0.03, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2));
export const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2, h / 2, d / 2));
export const bbox = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const sphere = (r, ws = 16, hs = 12) => new THREE.SphereGeometry(r, ws, hs);
export const capsule = (r, len, cap = 6, rad = 12) => new THREE.CapsuleGeometry(r, len, cap, rad);
export const cyl = (rt, rb, h, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const cone = (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg);
export const torus = (r, t, rs = 8, ts = 16, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc);
export const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);

// Displace vertices along their normals with a deterministic pseudo-noise (rocks, bushes).
export function lumpy(geo, amt, seed = 1) {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const g = mergeVertices(geo, 1e-4);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = map.get(key);
    if (k === undefined) {
      const s = Math.sin(v.x * 12.9898 * seed + v.y * 78.233 + v.z * 37.719) * 43758.5453;
      k = 1 + (s - Math.floor(s) - 0.5) * 2 * amt;
      map.set(key, k);
    }
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Canvas texture helper (radial blob etc.). Drawn at >= 1.5x its on-screen size.
export function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let blobTex = null;
export function blobTexture() {
  if (blobTex) return blobTex;
  blobTex = canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(26,16,51,0.55)');
    g.addColorStop(0.55, 'rgba(26,16,51,0.32)');
    g.addColorStop(1, 'rgba(26,16,51,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  return blobTex;
}
