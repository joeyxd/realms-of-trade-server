// Low-poly character kit. Every piece is authored in the bind pose, in model space (y up, facing +z,
// the character's left is +x), as lofted rings or small solids:
//   · colors are painted per face (crisp facets, small tonal jitter, optional vertical gradient)
//   · normals stay smooth (welded) so the outline pass only draws silhouettes and big creases,
//     while the color pass shades facets with derivative normals (flatShading)
//   · each vertex gets up to 4 skin weights from a function of its bind position (knees, elbows,
//     waist and coat panels bend smoothly with rigid bones)
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const sstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
export { sstep };

// ---- Rig ---------------------------------------------------------------------------------------
export const BONES = ['body', 'hips', 'thighL', 'shinL', 'thighR', 'shinR', 'spine', 'chest', 'head', 'armL', 'foreL', 'armR', 'foreR', 'clothF', 'clothB'];
export const B = Object.fromEntries(BONES.map((n, i) => [n, i]));
const PARENT = {
  hips: 'body', thighL: 'hips', shinL: 'thighL', thighR: 'hips', shinR: 'thighR', spine: 'hips', chest: 'spine',
  head: 'chest', armL: 'chest', foreL: 'armL', armR: 'chest', foreR: 'armR', clothF: 'hips', clothB: 'hips',
};

// Bind-pose joint positions (model space) from body proportions.
export function joints(R) {
  return {
    body: [0, 0, 0],
    hips: [0, R.hip + 0.02, 0],
    thighL: [R.legX, R.hip, 0], shinL: [R.legX, R.knee, 0.01],
    thighR: [-R.legX, R.hip, 0], shinR: [-R.legX, R.knee, 0.01],
    spine: [0, R.waist, 0], chest: [0, R.chest, 0], head: [0, R.neck, 0.005],
    armL: [R.shX, R.shY, 0], foreL: [R.shX + 0.004, R.elbow, 0],
    armR: [-R.shX, R.shY, 0], foreR: [-R.shX - 0.004, R.elbow, 0],
    clothF: [0, R.hip + 0.05, 0.09], clothB: [0, R.hip + 0.05, -0.09],
  };
}

export function makeBones(J) {
  const bones = BONES.map((n) => { const b = new THREE.Bone(); b.name = n; return b; });
  BONES.forEach((n, i) => {
    const p = PARENT[n], w = J[n];
    if (p) {
      const q = J[p];
      bones[i].position.set(w[0] - q[0], w[1] - q[1], w[2] - q[2]);
      bones[B[p]].add(bones[i]);
    } else bones[i].position.set(w[0], w[1], w[2]);
  });
  return bones;
}

// ---- Weights -----------------------------------------------------------------------------------
// Vertical seam: above y+h → upper bone, below y−h → lower bone, smooth in between.
export const seam = (upper, lower, y, h) => (x, Y) => { const t = sstep(y - h, y + h, Y); return [[upper, t], [lower, 1 - t]]; };
// Combine: weights of `a` blended toward bone `b` by t(x,y,z) in [0,1].
export const toward = (a, b, tf) => (x, y, z) => {
  const t = tf(x, y, z);
  const base = typeof a === 'function' ? a(x, y, z) : [[a, 1]];
  return [...base.map(([bi, w]) => [bi, w * (1 - t)]), [b, t]];
};

// ---- Primitives (indexed, positions only) -------------------------------------------------------
// rings: [{ y, rx, rz, x?, z?, dy?(θ), f?(θ) }] bottom → top; vertex j at θ = phase + j·2π/sides (θ = 0 → +z).
// skip(x, y, z) drops whole quads by their center (clean openings for hoods and open coats).
export function loft(rings, sides = 8, { phase = 0, capTop = true, capBot = true, skip = null } = {}) {
  const pos = [], idx = [], n = sides;
  for (const r of rings) {
    for (let j = 0; j < n; j++) {
      const t = phase + (j / n) * TAU;
      const k = r.f ? r.f(t) : 1;
      pos.push((r.x || 0) + Math.sin(t) * r.rx * k, r.y + (r.dy ? r.dy(t) : 0), (r.z || 0) + Math.cos(t) * r.rz * k);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < n; j++) {
    const a = i * n + j, b = i * n + ((j + 1) % n), c = (i + 1) * n + ((j + 1) % n), d = (i + 1) * n + j;
    if (skip) {
      const m = (k) => (pos[a * 3 + k] + pos[b * 3 + k] + pos[c * 3 + k] + pos[d * 3 + k]) / 4;
      if (skip(m(0), m(1), m(2))) continue;
    }
    idx.push(a, b, c, a, c, d);
  }
  const cap = (ri, top) => {
    const r = rings[ri], base = ri * n, ci = pos.length / 3;
    let cy = 0;
    for (let j = 0; j < n; j++) cy += pos[(base + j) * 3 + 1];
    pos.push(r.x || 0, cy / n, r.z || 0);
    for (let j = 0; j < n; j++) {
      const a = base + j, b = base + ((j + 1) % n);
      if (top) idx.push(ci, a, b); else idx.push(ci, b, a);
    }
  };
  if (capTop) cap(rings.length - 1, true);
  if (capBot) cap(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// Tapered box along y (a 4-sided loft). hw/hd are half sizes; dz/dx shift the top.
export function tbox(x, y0, y1, z, hw0, hd0, hw1 = hw0, hd1 = hd0, { dx = 0, dz = 0, caps = true } = {}) {
  const s = Math.SQRT2;
  return loft([{ y: y0, rx: hw0 * s, rz: hd0 * s, x, z }, { y: y1, rx: hw1 * s, rz: hd1 * s, x: x + dx, z: z + dz }], 4, { phase: Math.PI / 4, capTop: caps, capBot: caps });
}
// Centered box (w, h, d).
export const box = (w, h, d) => tbox(0, -h / 2, h / 2, 0, w / 2, d / 2);
// Pointed spike along +y (base half sizes hw/hd), 4 or more sides.
export function spike(hw, hd, h, sides = 4) {
  return loft([{ y: 0, rx: hw * Math.SQRT2, rz: hd * Math.SQRT2 }, { y: h, rx: 0.0001, rz: 0.0001 }], sides, { phase: Math.PI / 4, capTop: false });
}
export const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
// Small nose wedge: top, two base corners and a tip.
export function wedge(top, l, r, tip) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...top, ...l, ...r, ...tip], 3));
  g.setIndex([0, 3, 2, 0, 1, 3, 1, 2, 3, 0, 2, 1]);
  return g;
}
// Flat blade (sword) along +y: profile [[y, halfWidth]...], thickness t, with a center ridge.
export function blade(profile, t) {
  const pos = [], idx = [];
  for (const [y, w, off = 0] of profile) pos.push(off - w, y, 0, off, y, t / 2, off + w, y, 0, off, y, -t / 2);
  for (let i = 0; i < profile.length - 1; i++) for (let j = 0; j < 4; j++) {
    const a = i * 4 + j, b = i * 4 + ((j + 1) % 4), c = (i + 1) * 4 + ((j + 1) % 4), d = (i + 1) * 4 + j;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// Strap that follows a surface: centers[i] = [x, y, z], outs[i] = outward unit normal, width w, thickness t.
export function ribbon(centers, outs, w, t) {
  const pos = [], idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), S = new THREE.Vector3();
  for (let i = 0; i < centers.length; i++) {
    const a = centers[Math.max(0, i - 1)], b = centers[Math.min(centers.length - 1, i + 1)];
    T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    N.set(outs[i][0], outs[i][1], outs[i][2]).normalize();
    S.crossVectors(T, N).normalize();
    const c = centers[i];
    for (const [sx, nx] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) {
      pos.push(c[0] + S.x * sx * w / 2 + N.x * nx * t / 2, c[1] + S.y * sx * w / 2 + N.y * nx * t / 2, c[2] + S.z * sx * w / 2 + N.z * nx * t / 2);
    }
  }
  for (let i = 0; i < centers.length - 1; i++) for (let j = 0; j < 4; j++) {
    const a = i * 4 + j, b = i * 4 + ((j + 1) % 4), c = (i + 1) * 4 + ((j + 1) % 4), d = (i + 1) * 4 + j;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// Bake scale → rotation (X, Y, Z) → translation into a geometry.
export function xf(g, { pos, rot, scale } = {}) {
  if (scale) g.scale(scale[0], scale[1], scale[2]);
  if (rot) { if (rot[0]) g.rotateX(rot[0]); if (rot[1]) g.rotateY(rot[1]); if (rot[2]) g.rotateZ(rot[2]); }
  if (pos) g.translate(pos[0], pos[1], pos[2]);
  return g;
}
export const mirrorX = (g) => { g.scale(-1, 1, 1); const i = g.index.array; for (let k = 0; k < i.length; k += 3) { const t = i[k + 1]; i[k + 1] = i[k + 2]; i[k + 2] = t; } return g; };

// ---- Builder -----------------------------------------------------------------------------------
const tmpC = new THREE.Color();
const hashF = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

export class Builder {
  constructor() { this.list = []; }

  // geo: indexed or not, model space unless o.at (then authored relative to o.at and painted locally).
  // o: { color | paint(x,y,z,nx,ny,nz) → hex | [hex, glow], w: boneIndex | fn(x,y,z) → [[bone, w]...],
  //      cut(x,y,z) → drop face, lining: hex (adds an inward, reversed copy), jitter, grad: [y0, y1, k], glow, at }
  add(geo, o) {
    let g = geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    g = mergeVertices(g.index ? g : g, 1e-5);
    if (o.cut) {
      const p = g.attributes.position, src = g.index.array, keep = [];
      for (let i = 0; i < src.length; i += 3) {
        const a = src[i], b = src[i + 1], c = src[i + 2];
        const cx = (p.getX(a) + p.getX(b) + p.getX(c)) / 3, cy = (p.getY(a) + p.getY(b) + p.getY(c)) / 3, cz = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3;
        if (!o.cut(cx, cy, cz)) keep.push(a, b, c);
      }
      g.setIndex(keep);
    }
    g.computeVertexNormals();
    this._push(g, o, o.color, false);
    if (o.lining !== undefined) {
      const inner = g.clone();
      const p = inner.attributes.position, n = inner.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        p.setXYZ(i, p.getX(i) - n.getX(i) * 0.006, p.getY(i) - n.getY(i) * 0.006, p.getZ(i) - n.getZ(i) * 0.006);
        n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
      }
      const ix = inner.index.array.slice();
      for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
      inner.setIndex(Array.from(ix));
      this._push(inner, { ...o, paint: null, grad: null }, o.lining, true);
    }
    return this;
  }

  _push(indexed, o, color, isLining) {
    const g = indexed.toNonIndexed();
    const p = g.attributes.position, n = p.count;
    const col = new Float32Array(n * 3), glow = new Float32Array(n);
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const at = o.at || [0, 0, 0];
    const jit = o.jitter ?? 0.05;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), fn = new THREE.Vector3(), e1 = new THREE.Vector3();
    for (let f = 0; f < n; f += 3) {
      va.fromBufferAttribute(p, f); vb.fromBufferAttribute(p, f + 1); vc.fromBufferAttribute(p, f + 2);
      const cx = (va.x + vb.x + vc.x) / 3, cy = (va.y + vb.y + vc.y) / 3, cz = (va.z + vb.z + vc.z) / 3;
      fn.subVectors(vb, va); e1.subVectors(vc, va); fn.cross(e1).normalize();
      let c = color, gl = o.glow || 0;
      if (o.paint && !isLining) {
        const r = o.paint(cx, cy, cz, fn.x, fn.y, fn.z);
        if (Array.isArray(r)) { c = r[0]; gl = r[1]; } else c = r;
      }
      tmpC.set(c);
      let k = 1 + (hashF(cx + at[0], cy + at[1], cz + at[2]) - 0.5) * 2 * jit;
      if (o.grad) k *= o.grad[2] + (1 - o.grad[2]) * sstep(o.grad[0], o.grad[1], cy);
      if (isLining) k *= 0.8;
      for (let v = 0; v < 3; v++) {
        col[(f + v) * 3] = tmpC.r * k; col[(f + v) * 3 + 1] = tmpC.g * k; col[(f + v) * 3 + 2] = tmpC.b * k;
        glow[f + v] = gl;
      }
    }
    if (o.at) g.translate(at[0], at[1], at[2]);
    for (let i = 0; i < n; i++) {
      let ws;
      if (typeof o.w === 'function') ws = o.w(p.getX(i), p.getY(i), p.getZ(i));
      else ws = [[o.w ?? 0, 1]];
      ws = ws.filter((e) => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
      let sum = 0;
      for (const e of ws) sum += e[1];
      if (sum <= 0) { ws = [[0, 1]]; sum = 1; }
      for (let k = 0; k < ws.length; k++) { si[i * 4 + k] = ws[k][0]; sw[i * 4 + k] = ws[k][1] / sum; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    this.list.push(g);
  }

  build() {
    const g = mergeGeometries(this.list, false);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
