// The asset registry: loads assets/manifest.json and the models / textures it lists before the scene is built, and
// hands render code fitted, toon-shaded pieces by id. Everything degrades: no manifest, a 404, a bad model, a slow
// network (timeout) → that piece stays procedural and the reason is in assets.errors (and the console).
//
//   import { assets } from './assets/registry.js';
//   assets.charLook(lookIdx, wpn)   → a rebound character build for CharacterView, or null
//   assets.propId(kind)             → the prop entry replacing a procedural prop kind, or null
//   assets.instanced(id, matrices, target) → a Group of InstancedMeshes (props: one per part), or null
//   assets.model(id, target)        → a fitted Group clone (ships, buildings, anything), or null
//   assets.texture(id)              → a THREE.Texture, or null
//   assets.list()                   → [{id, kind, state, error, tris}] (pause menu, ?debug, tools)
import * as THREE from 'three';
import { normalizeManifest, fitBox, selectTextureSource } from './manifest.js';
import { bakeCharacter, sizedCharacter } from './rebind.js';
import { worldToon } from './toonmat.js';
import { LOOKS, buildLook, buildWeaponOnly } from '../charlooks.js';

const withTimeout = async (p, ms, what) => {
  let timer;
  try { return await Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: timed out after ${ms / 1000} s`)), ms); })]); }
  finally { clearTimeout(timer); }
};

function coarsePointerDefault() {
  try { return globalThis.matchMedia?.('(pointer: coarse)')?.matches === true; }
  catch { return false; }
}

export class Assets {
  constructor() {
    this.base = '';
    this.man = normalizeManifest(null);
    this.state = new Map(); // id → { state: 'loading' | 'ok' | 'error', error, data }
    this.errors = [];
    this.loaded = false;
    this.chars = new Map(); // lookIdx + wpn → sized character
    this.pendingModels = new Map();
  }

  // Load the manifest and every asset in it. Resolves when all are done or failed (never rejects).
  // onProgress(done, total, id). timeoutMs: per file.
  async load(url = 'assets/manifest.json', { onProgress = null, timeoutMs = 60000, fetchFn = (u, o) => fetch(u, o), mobileTextures = null } = {}) {
    const useMobileTextures = mobileTextures === null ? coarsePointerDefault() : !!mobileTextures;
    this.base = url.replace(/[^/]*$/, '');
    let json = null;
    try {
      const res = await withTimeout(fetchFn(url, { cache: 'no-cache' }), 8000, 'manifest');
      if (res.ok) json = await res.json();
    } catch (e) { if (!/404|Failed to fetch|NetworkError/i.test(String(e))) this.errors.push('manifest: ' + e.message); }
    this.man = normalizeManifest(json, { looks: LOOKS.map((l) => l.name) });
    this.errors.push(...this.man.errors);
    const list = [...this.man.entries.values()];
    if (!list.length) { this.loaded = true; this.report(); return this; }
    let gltf = null;
    if (list.some((e) => e.kind !== 'tex')) gltf = await this.gltfLoader().catch((e) => { this.errors.push('GLTFLoader: ' + e.message); return null; });
    const tex = new THREE.TextureLoader();
    let done = 0;
    const one = async (e) => {
      const selectedSrc = e.kind === 'tex' ? selectTextureSource(e, useMobileTextures) : e.src;
      this.state.set(e.id, { state: 'loading', selectedSrc });
      try {
        let data;
        if (e.kind === 'tex') {
          data = this.prepTexture(await withTimeout(tex.loadAsync(this.base + selectedSrc), timeoutMs, selectedSrc), e);
        }
        else {
          if (!gltf) throw new Error('no glTF loader');
          const g = await withTimeout(gltf.loadAsync(this.base + e.src), timeoutMs, e.src);
          data = e.kind === 'char' ? { bake: bakeCharacter(g.scene, e) } : prepStatic(g.scene, e);
        }
        this.state.set(e.id, { state: 'ok', data, selectedSrc });
      } catch (err) {
        const msg = `${e.id}: ${err && err.message ? err.message : err}`;
        this.state.set(e.id, { state: 'error', error: msg, selectedSrc });
        this.errors.push(msg);
      }
      done++;
      if (onProgress) onProgress(done, list.length, e.id);
    };
    // A few at a time: big files should not starve the rest of the page.
    const queue = list.slice();
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => { while (queue.length) await one(queue.shift()); }));
    this.loaded = true;
    this.report();
    return this;
  }

  async gltfLoader() {
    const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'), import('three/addons/loaders/DRACOLoader.js'), import('three/addons/libs/meshopt_decoder.module.js'),
    ]);
    const l = new GLTFLoader();
    const draco = new DRACOLoader();
    // The decoder ships with three (same CDN as the import map): only fetched when a file is Draco-compressed.
    try { draco.setDecoderPath(import.meta.resolve('three/addons/libs/draco/gltf/')); } catch { /* old browsers: no Draco */ }
    l.setDRACOLoader(draco);
    l.setMeshoptDecoder(MeshoptDecoder);
    return l;
  }

  // Editor-only catalog entries are indexed separately and fetched when selected. They never
  // replace the manifest's prop bindings or add work to the normal boot download.
  async ensureModel(raw, { base = 'assets/', timeoutMs = 60000 } = {}) {
    const normalized = normalizeManifest({ assets: [raw] });
    const entry = normalized.entries.get(raw?.id);
    if (!entry || !['model', 'prop'].includes(entry.kind) || normalized.errors.length) return false;
    const prior = this.entry(entry.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(entry)) return false;
    if (this.has(entry.id)) return true;
    if (this.pendingModels.has(entry.id)) return this.pendingModels.get(entry.id);
    this.man.entries.set(entry.id, entry);
    const source = new URL(entry.src, new URL(base, globalThis.location?.href || 'http://localhost/')).href;
    const pending = (async () => {
      this.state.set(entry.id, { state: 'loading', selectedSrc: entry.src });
      try {
        const loader = await this.gltfLoader();
        const gltf = await withTimeout(loader.loadAsync(source), timeoutMs, entry.src);
        this.state.set(entry.id, { state: 'ok', selectedSrc: entry.src, data: prepStatic(gltf.scene, entry) });
        return true;
      } catch (error) {
        this.state.set(entry.id, { state: 'error', selectedSrc: entry.src, error: String(error.message || error) });
        return false;
      } finally { this.pendingModels.delete(entry.id); }
    })();
    this.pendingModels.set(entry.id, pending);
    return pending;
  }

  prepTexture(t, e) {
    t.colorSpace = e.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(e.repeat[0], e.repeat[1]);
    if (e.filter === 'nearest') { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapNearestFilter; }
    t.anisotropy = 4;
    return t;
  }

  report() {
    const ok = [...this.state.values()].filter((s) => s.state === 'ok').length;
    if (this.state.size) console.info(`[assets] ${ok}/${this.state.size} loaded${this.errors.length ? ` · ${this.errors.length} problem(s)` : ''}`);
    for (const m of this.errors) console.warn('[assets]', m);
  }

  data(id) { const s = this.state.get(id); return s && s.state === 'ok' ? s.data : null; }
  entry(id) { return this.man.entries.get(id) || null; }
  has(id) { return !!this.data(id); }
  propId(kind) { const id = this.man.byProp.get(kind); return id && this.has(id) ? id : null; }
  texture(id) { const e = this.entry(id); return e && e.kind === 'tex' ? this.data(id) : null; }
  list() {
    return [...this.man.entries.values()].map((e) => {
      const s = this.state.get(e.id) || { state: 'pending' };
      const d = s.data;
      return { id: e.id, kind: e.kind, src: e.src, selectedSrc: s.selectedSrc || e.src, state: s.state, error: s.error || '', tris: d ? (d.bake ? d.bake.tris : d.tris || 0) : 0, notes: d && d.bake ? d.bake.notes : [] };
    });
  }

  // The imported character for look lookIdx with weapon wpn (as buildLook takes it: true / 'pistols' / false), or
  // null. Same shape as buildLook's result plus `ext` (the source materials per group, the entry).
  charLook(lookIdx, wpn) {
    const L = LOOKS[lookIdx];
    if (!L) return null;
    const id = this.man.byLook.get(L.name), d = id ? this.data(id) : null;
    if (!d) return null;
    const e = this.entry(id);
    const w = wpn === 'pistols' ? 'pistols' : wpn ? 'a' : '';
    const key = lookIdx + ':' + w;
    if (this.chars.has(key)) return this.chars.get(key);
    const proc = buildLook(lookIdx, false);
    const height = e.height > 0 ? e.height : proc.height; // the look's own height (CharacterView applies L.scale)
    const weapon = e.weapon === 'none' || !w ? null : buildWeaponOnly(lookIdx, w === 'pistols' ? 'pistols' : true);
    const sized = sizedCharacter(d.bake, height, weapon, proc.J);
    const res = { geo: sized.geo, J: sized.J, R: proc.R, height: sized.height, key: L.body, look: L, ext: { entry: e, mats: sized.mats, weaponGroup: sized.weaponGroup, id } };
    this.chars.set(key, res);
    return res;
  }

  // A fitted clone of a static model (prop / model). target: { w, h } of what it replaces (fit "proc").
  model(id, target = null) {
    const d = this.data(id), e = this.entry(id);
    if (!d || !d.parts) return null;
    const f = fitBox(d.min, d.max, e, target);
    const g = new THREE.Group();
    g.name = id;
    const inner = new THREE.Group();
    inner.scale.setScalar(f.s); inner.position.set(f.x, f.y, f.z);
    for (const p of d.parts) {
      const m = new THREE.Mesh(p.geo, p.mat);
      m.userData.nm = p.nm;
      m.castShadow = e.shadow; m.receiveShadow = true;
      inner.add(m);
    }
    g.add(inner);
    return g;
  }

  // Many copies at once (world props): one InstancedMesh per part. matrices: the placements (position, rotation,
  // scale as the procedural prop would have); the fit to `target` goes in front of each.
  instanced(id, matrices, target = null) {
    const d = this.data(id), e = this.entry(id);
    if (!d || !d.parts || !matrices.length) return null;
    const f = fitBox(d.min, d.max, e, target);
    const F = new THREE.Matrix4().compose(new THREE.Vector3(f.x, f.y, f.z), new THREE.Quaternion(), new THREE.Vector3(f.s, f.s, f.s));
    const g = new THREE.Group();
    g.name = id;
    const m4 = new THREE.Matrix4();
    for (const p of d.parts) {
      const im = new THREE.InstancedMesh(p.geo, p.mat, matrices.length);
      matrices.forEach((m, i) => im.setMatrixAt(i, m4.multiplyMatrices(m, F)));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.userData.nm = p.nm;
      im.castShadow = e.shadow; im.receiveShadow = true;
      g.add(im);
    }
    return g;
  }

  // ?debug: drop a model (or a character's T-pose bake) next to a point. Returns the object (remove it yourself).
  preview(id, scene, x, y, z) {
    const o = this.model(id);
    if (!o) return null;
    o.position.set(x, y, z);
    scene.add(o);
    return o;
  }
}

// Static models (props, ships, buildings): every mesh with its node transform baked in (rotY applied), skin
// attributes dropped (a skinned prop stands in its bind pose), toon materials, the box for fitting.
function prepStatic(scene, e) {
  const wrap = new THREE.Group();
  wrap.rotation.y = (e.rotY || 0) * Math.PI / 180;
  wrap.add(scene);
  wrap.updateMatrixWorld(true);
  const parts = [], mats = new Map(), box = new THREE.Box3();
  let tris = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || o.visible === false) return;
    const geo = o.geometry.clone();
    for (const k of ['skinIndex', 'skinWeight', 'tangent']) if (geo.attributes[k]) geo.deleteAttribute(k);
    geo.applyMatrix4(o.matrixWorld);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.computeBoundingBox();
    box.union(geo.boundingBox);
    tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const conv = src.map((m) => { if (!mats.has(m)) mats.set(m, worldToon(m, e)); return mats.get(m); });
    if (conv.length === 1) parts.push({ geo, mat: conv[0].mat, nm: conv[0].nm });
    else parts.push({ geo, mat: conv.map((c) => c.mat), nm: conv[0].nm });
  });
  wrap.remove(scene);
  if (!parts.length) throw new Error('no meshes');
  return { parts, min: box.min.toArray(), max: box.max.toArray(), tris: Math.round(tris) };
}

export const assets = new Assets();
