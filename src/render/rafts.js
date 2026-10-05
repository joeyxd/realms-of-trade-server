// Public raft silhouettes. Records are complete snapshot values; a stable id/revision keeps each
// procedural model resident while its independent world pose follows the replicated transform.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAFT, RAFT_PARTS, RAFT_LOOKS } from '../data/raftparts.js';
import { toon, normalMatFor } from './toon.js';
import { assets } from './assets/registry.js';

const WOOD = 0xb5803f, WOOD_DARK = 0x704522, WOOD_LIGHT = 0xd6a565;
const IRON = 0x626b72, IRON_LIGHT = 0xb1b9b8, CLOTH = 0xe8d39d, CLOTH_DARK = 0xb49362;
const GREEN = 0x56844b, GREEN_LIGHT = 0x91b65c, FIRE = 0xe88835;
const LEVEL_H = RAFT.levelHeight || 2.6;
const CELL = RAFT.cell;
const cleanNum = (n, fallback = 0) => Number.isFinite(+n) ? +n : fallback;
const colorHex = (n) => Math.max(0, Math.min(0xffffff, n | 0));

function keyOf(record) {
  return `${String(record.rev ?? '')}|${JSON.stringify(record.parts || [])}|${JSON.stringify(record.look || null)}`;
}

function paintColor(look) {
  const paints = RAFT_LOOKS.paints;
  const i = Number.isInteger(look?.paint) ? look.paint : -1;
  return i >= 0 && i < paints.length ? paints[i] : WOOD;
}

function bannerColor(banner) {
  const colors = { calavera: 0xe7d7aa, franjas: 0xb84435, kraken: 0x4b728d, ojo: 0x8d4f91 };
  return colors[banner] || colors.calavera;
}

function hashPhase(id) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) / 0xffffffff) * Math.PI * 2;
}

export class RaftLayer {
  constructor(scene) {
    this.scene = scene;
    this.views = new Map(); // id -> { root, visual, revKey, record, ownedGeometries, ... }
    this.materials = new Map();
    this.shapes = new Map();
    this.nm = normalMatFor({ occluder: true });
    this.tempMatrix = new THREE.Matrix4();
    this.tempQuaternion = new THREE.Quaternion();
    this.tempPosition = new THREE.Vector3();
    this.tempScale = new THREE.Vector3(1, 1, 1);
    this.tmpEuler = new THREE.Euler();
  }

  material(color) {
    const hex = colorHex(color);
    if (!this.materials.has(hex)) {
      this.materials.set(hex, toon({ color: hex }, { occluder: true, key: 'public-raft' }));
    }
    return this.materials.get(hex);
  }

  shape(key, make) {
    if (!this.shapes.has(key)) this.shapes.set(key, make());
    return this.shapes.get(key);
  }

  boxShape(w, h, d) {
    const a = [w, h, d].map((v) => Math.max(0.025, +v).toFixed(3));
    const key = `b:${a.join(':')}`;
    return this.shape(key, () => new THREE.BoxGeometry(+a[0], +a[1], +a[2]));
  }

  cylinderShape(rt, rb, h, segments = 8) {
    const a = [rt, rb, h].map((v) => Math.max(0.025, +v).toFixed(3));
    const key = `c:${a.join(':')}:${segments}`;
    return this.shape(key, () => new THREE.CylinderGeometry(+a[0], +a[1], +a[2], segments));
  }

  // Builds a handful of merged, vertex-normal meshes per raft. Cached source shapes are immutable;
  // only the merged BufferGeometries belong to a view and are disposed when its revision changes.
  build(record) {
    const root = new THREE.Group();
    root.name = `raft:${record.id}`;
    root.userData.raftId = record.id;
    root.userData.entity = record.entity ?? 0;
    root.userData.owner = record.owner ?? 0;
    const visual = new THREE.Group();
    visual.name = 'raft:visual';
    root.add(visual);
    const batches = new Map();
    const external = [];
    const ownedGeometries = [];
    const add = (color, shape, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const hex = colorHex(color);
      if (!batches.has(hex)) batches.set(hex, []);
      const g = shape.clone();
      this.tmpEuler.set(rx, ry, rz, 'XYZ');
      this.tempQuaternion.setFromEuler(this.tmpEuler);
      this.tempPosition.set(x, y, z);
      this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
      g.applyMatrix4(this.tempMatrix);
      batches.get(hex).push(g);
    };
    const box = (color, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) =>
      add(color, this.boxShape(w, h, d), x, y, z, rx, ry, rz);
    const cyl = (color, rt, rb, h, x, y, z, segments = 8, rx = 0, ry = 0, rz = 0) =>
      add(color, this.cylinderShape(rt, rb, h, segments), x, y, z, rx, ry, rz);

    const parts = Array.isArray(record.parts) ? record.parts : [];
    const hull = paintColor(record.look);
    for (const raw of parts) {
      if (!Array.isArray(raw) || typeof raw[0] !== 'string') continue;
      const [id, ix, iz, level0, dir0] = raw;
      const part = RAFT_PARTS[id];
      if (!part) continue;
      const x = cleanNum(ix), z = cleanNum(iz), level = Math.max(0, cleanNum(level0));
      const y = level * LEVEL_H;
      const d = ((cleanNum(dir0) | 0) % 4 + 4) % 4;
      const [pw, pd] = part.size || [1, 1];
      const w = pw * CELL, depth = pd * CELL;
      const cx = (x + pw / 2) * CELL, cz = (z + pd / 2) * CELL;
      const base = part.layer === 'base' || part.layer === 'floor' ? (part.layer === 'floor' ? WOOD_LIGHT : hull) : hull;

      if (part.layer === 'base' || part.layer === 'floor') {
        // A framed deck with visible cross-planks. Its top is exactly at this level's walk surface.
        if (part.layer === 'base') for (const side of [-1, 1])
          cyl(WOOD_DARK, 0.28, 0.28, w * 0.96, cx, y - 0.48, cz + side * depth * 0.28, 8, 0, 0, Math.PI / 2);
        const thick = 0.18, plankN = Math.max(2, Math.round(pd * 2));
        box(WOOD_DARK, w * 0.94, 0.22, 0.14, cx, y - 0.22, cz - depth * 0.31);
        box(WOOD_DARK, w * 0.94, 0.22, 0.14, cx, y - 0.22, cz + depth * 0.31);
        for (let i = 0; i < plankN; i++) {
          const pz = cz - depth / 2 + (i + 0.5) * depth / plankN;
          box(i % 3 === 0 ? WOOD_LIGHT : base, w * 0.98, thick, depth / plankN - 0.035, cx, y - thick / 2, pz);
        }
      } else if (part.layer === 'pillar') {
        const ph = LEVEL_H - 0.18;
        for (const sx of [-1, 1]) for (const sz of [-1, 1])
          box(WOOD_DARK, 0.18, ph, 0.18, cx + sx * 0.72, y + ph / 2, cz + sz * 0.72);
      } else if (part.layer === 'edge') {
        const horizontal = d === 0 || d === 2;
        const ex = cx + (d === 1 ? CELL / 2 : d === 3 ? -CELL / 2 : 0);
        const ez = cz + (d === 2 ? CELL / 2 : d === 0 ? -CELL / 2 : 0);
        const wh = id === 'railing' ? 0.72 : LEVEL_H - 0.18;
        const eh = y + wh / 2;
        const edgeBox = (color, wide, tall, thick, yy) => horizontal
          ? box(color, wide, tall, thick, ex, yy, ez)
          : box(color, thick, tall, wide, ex, yy, ez);
        const thick = id === 'railing' ? 0.1 : 0.18;
        if (id === 'door') {
          const off = horizontal ? [0.78, 0, 0] : [0, 0, 0.78];
          // Two jambs are split symmetrically along the wall span.
          for (const s of [-1, 1]) box(WOOD_DARK, horizontal ? 0.16 : thick, LEVEL_H - 0.18, horizontal ? thick : 0.16,
            ex + off[0] * s, eh, ez + off[2] * s);
          edgeBox(WOOD, 1.8, 0.18, thick, y + LEVEL_H - 0.27);
        } else if (id === 'window') {
          edgeBox(base, 1.9, 0.15, thick, y + 0.25);
          edgeBox(base, 1.9, 0.15, thick, y + 1.85);
          const off = horizontal ? [0.88, 0, 0] : [0, 0, 0.88];
          for (const s of [-1, 1]) box(WOOD_DARK, horizontal ? 0.16 : thick, 1.6, horizontal ? thick : 0.16,
            ex + off[0] * s, y + 1.05, ez + off[2] * s);
          edgeBox(WOOD_DARK, 0.08, 1.45, thick + 0.03, y + 1.05);
        } else if (id === 'railing') {
          edgeBox(base, 1.9, 0.13, thick, y + 0.62);
          for (const s of [-1, 0, 1]) {
            const off = horizontal ? [0.84 * s, 0, 0] : [0, 0, 0.84 * s];
            box(WOOD_DARK, horizontal ? 0.12 : 0.12, 0.75, horizontal ? 0.12 : 0.12, ex + off[0], y + 0.34, ez + off[2]);
          }
        } else {
          edgeBox(base, 1.92, wh, thick, eh);
          for (const s of [-1, 1]) {
            const off = horizontal ? [0.84 * s, 0, 0] : [0, 0, 0.84 * s];
            box(WOOD_DARK, horizontal ? 0.12 : thick + 0.03, wh, horizontal ? thick + 0.03 : 0.12,
              ex + off[0], eh, ez + off[2]);
          }
        }
      } else if (part.layer === 'roof') {
        box(id === 'roof' ? CLOTH_DARK : hull, w * 0.99, 0.16, depth * 0.99, cx, y + LEVEL_H - 0.13, cz);
        box(WOOD_DARK, 0.12, 0.2, depth * 0.95, cx, y + LEVEL_H - 0.28, cz);
      } else if (part.layer === 'tile') {
        if (id === 'sail' || id === 'bigSail') {
          const mastH = id === 'bigSail' ? 4.4 : 3.25;
          const sailW = id === 'bigSail' ? 2.45 : 1.55;
          const sailH = id === 'bigSail' ? 2.8 : 2.15;
          const mastX = cx - w * 0.2;
          cyl(WOOD_DARK, 0.075, 0.12, mastH, mastX, y + mastH / 2, cz, 8);
          box(CLOTH, sailW, sailH, 0.055, mastX + sailW * 0.48, y + mastH * 0.59, cz);
          box(bannerColor(record.look?.banner), Math.min(0.68, sailW * 0.46), 0.38, 0.07,
            mastX + sailW * 0.52, y + mastH + 0.15, cz);
          box(WOOD_LIGHT, 0.16, 0.09, sailW + 0.1, mastX + sailW * 0.48, y + mastH * 0.59 - sailH / 2, cz);
        } else if (id === 'crate') {
          const assetId = assets.propId('crate');
          const model = assetId ? assets.model(assetId, { w: 1.25, h: 1.15 }) : null;
          if (model) {
            model.position.set(cx, y, cz);
            model.name = `raft:crate:${x}:${z}:${level}`;
            visual.add(model);
            external.push(model);
          } else {
            box(WOOD, 1.18, 1.1, 1.18, cx, y + 0.55, cz);
            for (const s of [-1, 1]) {
              box(WOOD_DARK, 0.11, 1.18, 1.25, cx + s * 0.49, y + 0.55, cz);
              box(WOOD_DARK, 1.25, 1.18, 0.11, cx, y + 0.55, cz + s * 0.49);
            }
          }
        } else if (id === 'chest' || id === 'storage') {
          const ww = id === 'storage' ? 1.55 : 1.2;
          box(WOOD_DARK, ww, 0.7, 1.3, cx, y + 0.38, cz);
          box(WOOD, ww * 0.96, 0.18, 1.34, cx, y + 0.82, cz);
          box(IRON, 0.12, 0.3, 0.08, cx, y + 0.58, cz + 0.69);
        } else if (id === 'stairs') {
          for (let i = 0; i < 6; i++) box(WOOD, 1.55, 0.13, 0.3, cx, y + (i + 1) * LEVEL_H / 6 - 0.065, cz - 0.72 + i * 0.29);
        } else if (id === 'ladder') {
          for (let s of [-1, 1]) cyl(WOOD_DARK, 0.065, 0.065, 2.3, cx + s * 0.42, y + 1.17, cz, 6);
          for (let i = 0; i < 7; i++) box(WOOD_LIGHT, 0.9, 0.07, 0.07, cx, y + 0.25 + i * 0.3, cz);
        } else if (id === 'engine') {
          box(IRON, 1.35, 1.25, 1.35, cx, y + 0.7, cz);
          cyl(IRON_LIGHT, 0.38, 0.38, 0.8, cx, y + 1.72, cz, 10);
          cyl(WOOD_DARK, 0.1, 0.1, 0.55, cx + 0.42, y + 1.58, cz, 8);
        } else if (id === 'anchor') {
          cyl(IRON, 0.08, 0.08, 1.25, cx, y + 0.64, cz, 8, 0, 0, Math.PI / 2);
          box(IRON, 0.12, 0.8, 0.12, cx, y + 0.38, cz);
          for (const s of [-1, 1]) box(IRON_LIGHT, 0.12, 0.12, 0.48, cx + s * 0.3, y + 0.08, cz);
        } else if (id === 'cropPlot' || id === 'canePlot') {
          box(WOOD_DARK, 1.7, 0.22, 1.7, cx, y + 0.14, cz);
          const count = id === 'cropPlot' ? 6 : 7;
          for (let i = 0; i < count; i++) {
            const px = cx + ((i % 3) - 1) * 0.45, pz = cz + (Math.floor(i / 3) - 1) * 0.43;
            cyl(GREEN, id === 'cropPlot' ? 0.1 : 0.07, 0.12, id === 'cropPlot' ? 0.65 : 1.15, px, y + 0.55, pz, 6, 0, 0, (i % 2 ? 0.2 : -0.18));
            if (id === 'cropPlot') cyl(GREEN_LIGHT, 0.17, 0.035, 0.13, px + 0.13, y + 0.64, pz, 6, 0, 0, Math.PI / 2);
          }
        } else if (id === 'purifier') {
          box(IRON, 1.2, 0.28, 1.15, cx, y + 0.16, cz);
          cyl(IRON_LIGHT, 0.45, 0.5, 1.1, cx, y + 0.82, cz, 10);
          cyl(IRON, 0.19, 0.19, 0.42, cx, y + 1.58, cz, 8);
        } else if (id === 'net') {
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(WOOD_DARK, 0.1, 0.65, 0.1, cx + sx * 0.76, y + 0.34, cz + sz * 0.76);
          box(CLOTH_DARK, 1.5, 0.06, 1.5, cx, y + 0.58, cz);
          for (let i = -2; i <= 2; i++) {
            box(CLOTH, 0.025, 0.035, 1.48, cx + i * 0.29, y + 0.62, cz);
            box(CLOTH, 1.48, 0.035, 0.025, cx, y + 0.62, cz + i * 0.29);
          }
        } else if (id === 'grill') {
          box(WOOD_DARK, 1.25, 0.5, 1.15, cx, y + 0.38, cz);
          box(IRON, 1.2, 0.13, 1.25, cx, y + 0.78, cz);
          for (let i = -2; i <= 2; i++) box(IRON_LIGHT, 0.035, 0.12, 1.16, cx + i * 0.22, y + 0.88, cz);
          cyl(FIRE, 0.26, 0.18, 0.32, cx, y + 1.08, cz, 6);
        } else if (id === 'still') {
          box(WOOD_DARK, 1.2, 0.34, 1.2, cx, y + 0.17, cz);
          cyl(IRON, 0.52, 0.42, 0.95, cx, y + 0.82, cz, 10);
          cyl(IRON_LIGHT, 0.24, 0.24, 0.7, cx, y + 1.55, cz, 8);
          box(IRON_LIGHT, 0.68, 0.09, 0.09, cx + 0.3, y + 1.86, cz);
        } else if (id === 'research') {
          box(WOOD_DARK, 1.4, 0.85, 1.15, cx, y + 0.55, cz);
          box(WOOD_LIGHT, 1.6, 0.12, 1.4, cx, y + 1.02, cz);
          box(CLOTH, 0.7, 0.05, 0.5, cx, y + 1.12, cz);
          box(IRON_LIGHT, 0.12, 0.35, 0.1, cx - 0.25, y + 1.3, cz);
        } else if (id === 'bed' || id === 'bunk') {
          const levels = id === 'bunk' ? [0.45, 1.55] : [0.46];
          for (const yy of levels) {
            box(WOOD_DARK, 1.75, 0.13, 1.25, cx, y + yy, cz);
            box(CLOTH, 1.6, 0.13, 1.1, cx, y + yy + 0.12, cz);
            for (const s of [-1, 1]) box(WOOD_LIGHT, 0.1, 0.23, 1.28, cx + s * 0.82, y + yy + 0.11, cz);
          }
          if (id === 'bunk') for (const sx of [-1, 1]) box(WOOD_DARK, 0.12, 2.0, 0.12, cx + sx * 0.78, y + 1.0, cz);
        } else if (id === 'lantern') {
          cyl(WOOD_DARK, 0.07, 0.1, 1.05, cx, y + 0.52, cz, 8);
          box(IRON, 0.46, 0.55, 0.46, cx, y + 1.24, cz);
          box(FIRE, 0.24, 0.32, 0.24, cx, y + 1.24, cz);
          box(IRON_LIGHT, 0.5, 0.08, 0.5, cx, y + 1.55, cz);
        } else if (id === 'turret') {
          cyl(IRON, 0.48, 0.56, 0.42, cx, y + 0.24, cz, 10);
          cyl(IRON_LIGHT, 0.34, 0.34, 0.4, cx, y + 0.64, cz, 10);
          box(IRON, 0.25, 0.28, 1.15, cx, y + 0.86, cz + 0.45);
          cyl(IRON_LIGHT, 0.14, 0.14, 0.34, cx, y + 0.86, cz + 1.02, 8, Math.PI / 2, 0, 0);
        } else {
          // Decorative tiles remain distinct, low silhouettes instead of disappearing for unknown styles.
          box(id === 'decor' ? GREEN_LIGHT : base, 1.05, 0.42, 1.05, cx, y + 0.3, cz);
          cyl(WOOD_LIGHT, 0.38, 0.3, 0.22, cx, y + 0.64, cz, 8);
        }
      }
    }

    for (const [color, pieces] of batches) {
      const merged = mergeGeometries(pieces, false);
      for (const piece of pieces) piece.dispose();
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      ownedGeometries.push(merged);
      const mesh = new THREE.Mesh(merged, this.material(color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.nm = this.nm;
      mesh.name = `raft:parts:${color.toString(16)}`;
      visual.add(mesh);
    }

    const view = {
      id: String(record.id), root, visual, revKey: keyOf(record), record,
      ownedGeometries, external, phase: hashPhase(record.id), isLocal: false,
      x: NaN, y: NaN, z: NaN, yaw: NaN,
    };
    return view;
  }

  removeView(view) {
    if (!view) return;
    this.scene.remove(view.root);
    view.root.clear(); // imported registry meshes/materials/geometries are shared; only detach them.
    for (const geometry of view.ownedGeometries) geometry.dispose();
    view.ownedGeometries.length = 0;
  }

  update(records, time, youServer = 0) {
    const list = Array.isArray(records) ? records : [];
    const incoming = new Map();
    for (const record of list) {
      if (!record || record.id === undefined || record.id === null) continue;
      incoming.set(String(record.id), record); // duplicate snapshot IDs resolve to the last record
    }

    let changed = false;
    for (const [id, record] of incoming) {
      let view = this.views.get(id);
      const revKey = keyOf(record);
      if (!view) {
        view = this.build(record);
        this.views.set(id, view);
        this.scene.add(view.root);
        changed = true;
      } else if (view.revKey !== revKey) {
        this.removeView(view);
        view = this.build(record);
        this.views.set(id, view);
        this.scene.add(view.root);
        changed = true;
      }

      const x = cleanNum(record.x), y = cleanNum(record.y, 0.72), z = cleanNum(record.z);
      const yaw = cleanNum(record.yaw);
      if (view.x !== x || view.y !== y || view.z !== z || view.yaw !== yaw) {
        view.root.position.set(x, y, z);
        view.root.rotation.y = yaw;
        view.x = x; view.y = y; view.z = z; view.yaw = yaw;
        changed = true;
      }
      const local = youServer !== 0 && record.owner === youServer;
      if (view.isLocal !== local) { view.isLocal = local; changed = true; }
      view.root.userData.entity = record.entity ?? 0;
      view.root.userData.owner = record.owner ?? 0;
      view.root.userData.name = record.name || '';
      view.root.userData.berth = record.berth ?? '';
      view.root.userData.isLocal = local;
      view.record = record;

      const t = cleanNum(time);
      const bob = Math.sin(t * 0.85 + view.phase) * 0.018;
      view.visual.position.y = bob;
      view.visual.rotation.z = Math.sin(t * 0.53 + view.phase) * 0.0025;
      view.visual.rotation.x = Math.cos(t * 0.47 + view.phase) * 0.0018;
    }

    for (const [id, view] of this.views) {
      if (incoming.has(id)) continue;
      this.removeView(view);
      this.views.delete(id);
      changed = true;
    }
    return changed;
  }

  dispose() {
    for (const view of this.views.values()) this.removeView(view);
    this.views.clear();
    for (const geometry of this.shapes.values()) geometry.dispose();
    this.shapes.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.nm.dispose();
  }
}
