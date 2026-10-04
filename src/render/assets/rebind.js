// Imported characters onto the game's rig. A rigged glTF humanoid is not animated with its own skeleton: it is
// posed into the rig's rest (arms and legs straight down), its vertices baked in that pose, and re-skinned onto the
// 15 procedural bones (charkit.js BONES) with the rig's joints moved to where the model's are. The result is the
// same kind of geometry charlooks.js builds (position, normal, color, aGlow, skinIndex, skinWeight; plus uv), so
// CharacterView animates it with every procedural motion (run, dash, combo, guard, casts, flinches, deaths) and
// the afterimages, portraits, death debris and ink outlines work unchanged. One bake per model, at height 1; each
// look that uses it scales a copy.
import * as THREE from 'three';
import { B } from '../charkit.js';
import { mapBones, followMap, boneRole } from './bonemap.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion();
// attr.getComponent arrived after three 0.160.
const comp = (a, i, c) => (c === 0 ? a.getX(i) : c === 1 ? a.getY(i) : c === 2 ? a.getZ(i) : a.getW(i));

// Rotate bone b (world space) so the direction from b to c becomes `dir`.
function alignBone(b, c, dir) {
  b.updateWorldMatrix(true, true);
  b.getWorldPosition(_v); c.getWorldPosition(_w);
  _w.sub(_v);
  if (_w.lengthSq() < 1e-12) return;
  _w.normalize();
  _q.setFromUnitVectors(_w, dir);
  if (b.parent) b.parent.getWorldQuaternion(_pq); else _pq.identity();
  // new local = parentWorld⁻¹ · q · parentWorld · local
  const x = _pq.clone().invert().multiply(_q).multiply(_pq);
  b.quaternion.premultiply(x);
  b.updateWorldMatrix(false, true);
}

// Texture sampler for the per-vertex colours (death debris, the debug view): the image drawn small into a canvas.
function sampler(map) {
  const img = map && map.image;
  if (!img || typeof document === 'undefined') return null;
  try {
    const w = Math.min(128, img.width || 128), h = Math.min(128, img.height || 128);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data, flipY = !!map.flipY;
    const rep = map.repeat, off = map.offset;
    return (u, v, out) => {
      u = u * rep.x + off.x; v = v * rep.y + off.y;
      u -= Math.floor(u); v -= Math.floor(v);
      const x = Math.min(w - 1, Math.floor(u * w)), y = Math.min(h - 1, Math.floor((flipY ? 1 - v : v) * h));
      const k = (y * w + x) * 4;
      return out.setRGB(data[k] / 255, data[k + 1] / 255, data[k + 2] / 255, THREE.SRGBColorSpace);
    };
  } catch { return null; }
}

// Bake a loaded glTF scene (gltf.scene; it is re-posed in place) for entry e. Returns the canonical data at height 1:
// { pos, nrm, uv, col: Float32Arrays, si: Uint16Array, sw: Float32Array (4 per vertex), groups: [{start, count, mat}],
//   J: { bone: [x, y, z] } | null (a rigid model: the look's own joints), hand: { L, R } | null, rigid, notes, tris }.
export function bakeCharacter(scene, e) {
  const wrap = new THREE.Group();
  wrap.rotation.y = (e.rotY || 0) * Math.PI / 180;
  wrap.add(scene);
  wrap.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position && o.visible !== false) meshes.push(o); });
  if (!meshes.length) throw new Error('no meshes');
  const boneList = [], idx = new Map();
  for (const m of meshes) if (m.isSkinnedMesh) for (const b of m.skeleton.bones) if (!idx.has(b)) { idx.set(b, boneList.length); boneList.push(b); }
  const rigid = boneList.length === 0;
  const notes = [];
  let follow = null, r = null;
  const pos = (i) => boneList[i].getWorldPosition(new THREE.Vector3());

  if (!rigid) {
    const names = boneList.map((b) => b.name || ''), parents = boneList.map((b) => { let p = b.parent; while (p && !idx.has(p)) p = p.parent; return p ? idx.get(p) : -1; });
    r = mapBones(names, parents, e.bones);
    notes.push(...r.notes);
    if (r.missing.length) throw new Error(`bones not found: ${r.missing.join(', ')} (its bones: ${names.join(', ')}); name them in the manifest "bones"`);
    // Our left is +X: a model that faces −Z (or has its sides swapped) turns around.
    if (pos(r.map.armL).x < pos(r.map.armR).x) { wrap.rotation.y += Math.PI; wrap.updateMatrixWorld(true); notes.push('turned 180° (it faced −Z)'); }
    if (e.armsDown) {
      const pairs = [['thighL', r.map.shinL], ['shinL', r.foot.L], ['thighR', r.map.shinR], ['shinR', r.foot.R],
        ['armL', r.map.foreL], ['foreL', r.hand.L], ['armR', r.map.foreR], ['foreR', r.hand.R]];
      for (const [k, c] of pairs) if (c >= 0 && r.map[k] >= 0) alignBone(boneList[r.map[k]], boneList[c], DOWN);
      wrap.updateMatrixWorld(true);
    }
    follow = followMap(names, parents, r.map, B);
  }

  // Bake every triangle in the posed state, sorted by material.
  const byMat = new Map(); // material → { p: [], n: [], uv: [], si: [], sw: [] }
  const rigidBone = B[e.bone] ?? B.body;
  const M = new THREE.Matrix4(), A = new THREE.Matrix4(), N3 = new THREE.Matrix3(), A3 = new THREE.Matrix3(), vv = new THREE.Vector3(), nn = new THREE.Vector3();
  let tris = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position, Nn = g.attributes.normal, UV = g.attributes.uv, I = g.index;
    const skinned = mesh.isSkinnedMesh && g.attributes.skinIndex && g.attributes.skinWeight;
    let boneM = null, ours = null, own = rigidBone;
    if (skinned) {
      // Per bone: post · boneWorld · boneInverse · bind (attached: post = I; detached: meshWorld · bind⁻¹).
      const sk = mesh.skeleton, post = new THREE.Matrix4();
      if (mesh.bindMode !== 'attached') post.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
      boneM = sk.bones.map((b, j) => new THREE.Matrix4().multiplyMatrices(post, M.multiplyMatrices(b.matrixWorld, sk.boneInverses[j])).multiply(mesh.bindMatrix));
      ours = sk.bones.map((b) => (idx.has(b) ? follow[idx.get(b)] : rigidBone));
    } else if (!rigid) {
      let p = mesh.parent;
      while (p && !idx.has(p)) p = p.parent;
      if (p) own = follow[idx.get(p)];
    }
    const SI = skinned ? g.attributes.skinIndex : null, SW = skinned ? g.attributes.skinWeight : null;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = Array.isArray(mesh.material) && g.groups.length ? g.groups : [{ start: 0, count: I ? I.count : P.count, materialIndex: 0 }];
    N3.getNormalMatrix(mesh.matrixWorld);
    for (const grp of groups) {
      const mat = mats[grp.materialIndex] || mats[0];
      if (!byMat.has(mat)) byMat.set(mat, { p: [], n: [], uv: [], si: [], sw: [] });
      const out = byMat.get(mat);
      const end = Math.min(grp.start + grp.count, I ? I.count : P.count);
      for (let k = grp.start; k < end; k++) {
        const i = I ? I.getX(k) : k;
        vv.fromBufferAttribute(P, i); nn.fromBufferAttribute(Nn, i);
        let ws = [[own, 1]];
        if (skinned) {
          A.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
          const ae = A.elements;
          const acc = new Map();
          for (let c = 0; c < 4; c++) {
            const w = comp(SW, i, c);
            if (!(w > 0)) continue;
            const j = comp(SI, i, c), be = boneM[j].elements;
            for (let q = 0; q < 16; q++) ae[q] += be[q] * w;
            acc.set(ours[j], (acc.get(ours[j]) || 0) + w);
          }
          vv.applyMatrix4(A);
          nn.applyMatrix3(A3.setFromMatrix4(A));
          ws = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        } else {
          vv.applyMatrix4(mesh.matrixWorld);
          nn.applyMatrix3(N3);
        }
        nn.normalize();
        out.p.push(vv.x, vv.y, vv.z); out.n.push(nn.x, nn.y, nn.z);
        out.uv.push(UV ? UV.getX(i) : 0, UV ? UV.getY(i) : 0);
        let tot = 0;
        for (const [, w] of ws) tot += w;
        for (let c = 0; c < 4; c++) { const x = ws[c]; out.si.push(x ? x[0] : 0); out.sw.push(x ? x[1] / (tot || 1) : 0); }
      }
      tris += (end - grp.start) / 3;
    }
  }

  // Normalize: feet on y = 0, the pelvis over the origin, height 1.
  let minY = Infinity, maxY = -Infinity;
  for (const o of byMat.values()) for (let k = 1; k < o.p.length; k += 3) { minY = Math.min(minY, o.p[k]); maxY = Math.max(maxY, o.p[k]); }
  const hipsW = rigid ? new THREE.Vector3() : pos(r.map.hips);
  if (rigid) { // centre a rigid model on its box
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const o of byMat.values()) for (let k = 0; k < o.p.length; k += 3) { x0 = Math.min(x0, o.p[k]); x1 = Math.max(x1, o.p[k]); z0 = Math.min(z0, o.p[k + 2]); z1 = Math.max(z1, o.p[k + 2]); }
    hipsW.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  }
  const h = maxY - minY;
  if (!(h > 1e-6)) throw new Error('flat model (no height)');
  const s = 1 / h, tx = -hipsW.x, ty = -minY, tz = -hipsW.z;
  const norm = (x, y, z) => [(x + tx) * s, (y + ty) * s, (z + tz) * s];

  // Gather into flat arrays, a group per material; the per-vertex colour is the texture (× colour) at the vertex.
  let count = 0;
  for (const o of byMat.values()) count += o.p.length / 3;
  const out = { pos: new Float32Array(count * 3), nrm: new Float32Array(count * 3), uv: new Float32Array(count * 2), col: new Float32Array(count * 3),
    si: new Uint16Array(count * 4), sw: new Float32Array(count * 4), groups: [], J: null, hand: null, rigid, notes, tris: Math.round(tris) };
  let at = 0;
  const c = new THREE.Color();
  for (const [mat, o] of byMat) {
    const n = o.p.length / 3, smp = sampler(mat.map), base = mat.color || new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = norm(o.p[i * 3], o.p[i * 3 + 1], o.p[i * 3 + 2]);
      const k = at + i;
      out.pos[k * 3] = x; out.pos[k * 3 + 1] = y; out.pos[k * 3 + 2] = z;
      out.nrm[k * 3] = o.n[i * 3]; out.nrm[k * 3 + 1] = o.n[i * 3 + 1]; out.nrm[k * 3 + 2] = o.n[i * 3 + 2];
      out.uv[k * 2] = o.uv[i * 2]; out.uv[k * 2 + 1] = o.uv[i * 2 + 1];
      if (smp) smp(o.uv[i * 2], o.uv[i * 2 + 1], c).multiply(base); else c.copy(base);
      out.col[k * 3] = c.r; out.col[k * 3 + 1] = c.g; out.col[k * 3 + 2] = c.b;
      for (let q = 0; q < 4; q++) { out.si[k * 4 + q] = o.si[i * 4 + q]; out.sw[k * 4 + q] = o.sw[i * 4 + q]; }
    }
    out.groups.push({ start: at, count: n, mat });
    at += n;
  }

  // The rig's joints where the model's are (the neck pivots the head, as in the procedural rig).
  if (!rigid) {
    const P3 = (i) => { const p = pos(i); return norm(p.x, p.y, p.z); };
    const m = r.map;
    let neck = -1;
    for (let i = boneList[m.head].parent; i && idx.has(i) && boneList.indexOf(i) !== m.chest && boneList.indexOf(i) !== m.spine; i = i.parent) if (boneRole(i.name).role === 'neck') neck = idx.get(i);
    const hips = P3(m.hips), spine = P3(m.spine), head = P3(neck >= 0 ? neck : m.head);
    const chest = m.chest >= 0 ? P3(m.chest) : spine.map((v, k) => v + (head[k] - v) * 0.55);
    const J = {
      body: [0, 0, 0], hips, spine, chest, head,
      thighL: P3(m.thighL), shinL: P3(m.shinL), thighR: P3(m.thighR), shinR: P3(m.shinR),
      armL: P3(m.armL), foreL: P3(m.foreL), armR: P3(m.armR), foreR: P3(m.foreR),
      clothF: [0, hips[1] + 0.027, 0.048], clothB: [0, hips[1] + 0.027, -0.048],
    };
    // Hands: the hand bones, or the forearm carried on by 0.8 of its length.
    const handAt = (s) => (r.hand[s] >= 0 ? P3(r.hand[s]) : J['fore' + s].map((v, k) => v + (v - J['arm' + s][k]) * 0.8));
    out.J = J;
    out.hand = { L: handAt('L'), R: handAt('R') };
  }
  wrap.remove(scene);
  return out;
}

// A look-sized copy of a bake: { geo (BufferGeometry with groups, the material order of `mats`), J, height, mats }.
// weapon: a charlooks weapon-only build ({ geo, R } from buildWeaponOnly) moved from the procedural hands to the
// model's, appended as the last group (drawn with the view's vertex-colour material); null for none.
export function sizedCharacter(bake, height, weapon = null, procJ = null) {
  const n = bake.pos.length / 3, wn = weapon ? weapon.geo.attributes.position.count : 0, tot = n + wn;
  const p = new Float32Array(tot * 3), nr = new Float32Array(tot * 3), uv = new Float32Array(tot * 2), col = new Float32Array(tot * 3);
  const gl = new Float32Array(tot), si = new Uint16Array(tot * 4), sw = new Float32Array(tot * 4);
  for (let i = 0; i < n * 3; i++) p[i] = bake.pos[i] * height;
  nr.set(bake.nrm); uv.set(bake.uv); col.set(bake.col); si.set(bake.si); sw.set(bake.sw);
  const J = {};
  const srcJ = bake.J || procJ;
  const k = bake.J ? height : 1; // a rigid model rides the look's own joints
  for (const [b, v] of Object.entries(srcJ)) J[b] = [v[0] * k, v[1] * k, v[2] * k];
  if (weapon) {
    const wg = weapon.geo, R = weapon.R, WP = wg.attributes.position, WN = wg.attributes.normal, WC = wg.attributes.color, WG = wg.attributes.aGlow;
    const WSI = wg.attributes.skinIndex, WSW = wg.attributes.skinWeight;
    // From the procedural hands (x ±shX at wrist height) to the model's.
    const hand = bake.hand ? { L: bake.hand.L.map((v) => v * height), R: bake.hand.R.map((v) => v * height) } : null;
    const dL = hand ? [hand.L[0] - R.shX, hand.L[1] - R.wrist, hand.L[2]] : [0, 0, 0];
    const dR = hand ? [hand.R[0] + R.shX, hand.R[1] - R.wrist, hand.R[2]] : [0, 0, 0];
    for (let i = 0; i < wn; i++) {
      const o = n + i, d = WSI.getX(i) === B.foreL ? dL : dR;
      p[o * 3] = WP.getX(i) + d[0]; p[o * 3 + 1] = WP.getY(i) + d[1]; p[o * 3 + 2] = WP.getZ(i) + d[2];
      nr[o * 3] = WN.getX(i); nr[o * 3 + 1] = WN.getY(i); nr[o * 3 + 2] = WN.getZ(i);
      col[o * 3] = WC.getX(i); col[o * 3 + 1] = WC.getY(i); col[o * 3 + 2] = WC.getZ(i);
      gl[o] = WG ? WG.getX(i) : 0;
      for (let q = 0; q < 4; q++) { si[o * 4 + q] = comp(WSI, i, q); sw[o * 4 + q] = comp(WSW, i, q); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  bake.groups.forEach((g, i) => geo.addGroup(g.start, g.count, i));
  if (wn) geo.addGroup(n, wn, bake.groups.length);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { geo, J, height: geo.boundingBox.max.y, mats: bake.groups.map((g) => g.mat), weaponGroup: wn ? bake.groups.length : -1 };
}
