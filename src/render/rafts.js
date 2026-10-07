// Public raft silhouettes. Records are complete snapshot values; a stable id/revision keeps each
// procedural model resident while its independent world pose follows the replicated transform.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAFT, RAFT_PARTS, RAFT_LOOKS } from '../data/raftparts.js';
import { STAIR, raftGangplank } from '../sim/raftGeometry.js';
import { toon, normalMatFor } from './toon.js';
import { assets } from './assets/registry.js';
import { RAFT_ATLAS_ID, surface, materialKey, mapRaftUV } from './raftMaterials.js';

const WOOD = surface('wood', 0xb5803f), WOOD_DARK = surface('wood', 0x704522, 0xd5bfa5), WOOD_LIGHT = surface('wood', 0xd6a565);
const IRON = surface('iron', 0x626b72), IRON_LIGHT = surface('iron', 0xb1b9b8, 0xffecd2);
const CLOTH = surface('cloth', 0xe8d39d), CLOTH_DARK = surface('cloth', 0xb49362, 0xdac8ac);
const ROPE = surface('rope', 0xc69b51), INK = 0x251c1b;
// The painting already carries pen texture. Grade in perceptual space and reduce the second procedural
// hatch layer, so grain stays graphic rather than turning into moire under the isometric camera.
const ATLAS_ALBEDO = `{
  vec3 mnRaftPaint = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(0.4545));
  mnRaftPaint = floor(mnRaftPaint * 6.0 + 0.5) / 6.0;
  diffuseColor.rgb = pow(mnRaftPaint, vec3(2.2)) * 1.16;
}`;
const GREEN = 0x56844b, GREEN_LIGHT = 0x91b65c, FIRE = 0xe88835;
const LEVEL_H = RAFT.levelHeight || 2.6;
const CELL = RAFT.cell;
const cleanNum = (n, fallback = 0) => Number.isFinite(+n) ? +n : fallback;
const colorHex = (n) => Math.max(0, Math.min(0xffffff, n | 0));

function keyOf(record) {
  // Cargo/work revisions change private state without changing the silhouette or its mobile GPU buffers.
  return `${JSON.stringify(record.parts || [])}|${JSON.stringify(record.look || null)}`;
}

function paintColor(look) {
  const paints = RAFT_LOOKS.paints;
  const i = Number.isInteger(look?.paint) ? look.paint : -1;
  return i >= 0 && i < paints.length ? surface('wood', paints[i], paints[i]) : WOOD;
}

function bannerColor(banner) {
  const colors = { calavera: 0xe7d7aa, franjas: 0xb84435, kraken: 0x4b728d, ojo: 0x8d4f91 };
  return surface('cloth', colors[banner] || colors.calavera, banner && banner !== 'calavera' ? colors[banner] || 0xffffff : 0xffffff);
}

function hashPhase(id) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) / 0xffffffff) * Math.PI * 2;
}

export class RaftLayer {
  constructor(scene, { skin = new URLSearchParams(globalThis.location?.search || '').get('raftskin') !== '0', dock = null, surfaceSkin = null } = {}) {
    this.scene = scene;
    this.dock = dock;
    this.views = new Map(); // id -> { root, visual, revKey, record, ownedGeometries, ... }
    this.materials = new Map();
    this.shapes = new Map();
    this.skinEnabled = skin;
    // Optional, instance-owned art study. The main game keeps its original atlas and UV contract.
    this.surfaceSkin = skin ? surfaceSkin : null;
    this.atlas = skin ? assets.texture(RAFT_ATLAS_ID) : null;
    this.nm = normalMatFor({ occluder: true, lineW: 0.65 });
    this.clothNm = normalMatFor({ occluder: true, lineW: 0.65 }, THREE.DoubleSide);
    this.tempMatrix = new THREE.Matrix4();
    this.tempQuaternion = new THREE.Quaternion();
    this.tempPosition = new THREE.Vector3();
    this.tempScale = new THREE.Vector3(1, 1, 1);
    this.tmpEuler = new THREE.Euler();
  }

  material(color) {
    const spec = typeof color === 'object' ? color : { kind: 'solid', color: colorHex(color), tint: colorHex(color) };
    const key = materialKey(spec);
    if (!this.materials.has(key)) {
      const override = this.surfaceSkin?.material?.(spec, { atlas: this.atlas });
      if (override) {
        override.userData.raftSurface = spec.kind;
        this.materials.set(key, override);
        return override;
      }
      const mapped = this.atlas && spec.kind !== 'solid';
      const mat = toon({ color: mapped ? spec.tint : spec.color, map: mapped ? this.atlas : null,
        side: spec.kind === 'cloth' ? THREE.DoubleSide : THREE.FrontSide }, { occluder: true,
        key: mapped ? 'public-raft-comic-v1' : 'public-raft-plain', albedo: mapped ? ATLAS_ALBEDO : '',
        hatchMask: mapped ? '0.25' : '1.0' });
      mat.name = `raft:${spec.kind}`;
      mat.userData.raftSurface = spec.kind;
      this.materials.set(key, mat);
    }
    return this.materials.get(key);
  }

  mapSurfaceUV(geometry, kind, options) {
    if (this.surfaceSkin?.mapUV?.(geometry, kind, options)) return true;
    return this.atlas ? mapRaftUV(geometry, kind, options) : false;
  }

  shape(key, make) {
    if (!this.shapes.has(key)) this.shapes.set(key, make());
    return this.shapes.get(key);
  }

  updateGangplank(view, record) {
    const pose = raftGangplank(record, this.dock);
    if (!pose || ![pose.x, pose.y, pose.z, pose.yaw, pose.length, pose.width, pose.rise].every(Number.isFinite)
      || pose.length <= 0 || pose.width <= 0) {
      if (!view.gangplank) return false;
      view.visual.remove(view.gangplank);
      const geometry = view.gangplank.geometry;
      view.gangplank = null;
      view.gangplankPoseKey = '';
      view.ownedGeometries = view.ownedGeometries.filter((owned) => owned !== geometry);
      geometry.dispose();
      return true;
    }

    const plankDepth = Math.hypot(pose.length, pose.rise);
    const sizeKey = `${pose.width.toFixed(3)}:${plankDepth.toFixed(3)}`;
    const poseKey = JSON.stringify([pose.x, pose.y, pose.z, pose.yaw, pose.length, pose.width, pose.rise]);
    let changed = false;
    if (!view.gangplank || view.gangplank.userData.sizeKey !== sizeKey) {
      const oldGeometry = view.gangplank?.geometry;
      const geometry = this.boxShape(pose.width, 0.14, plankDepth).clone();
      this.mapSurfaceUV(geometry, 'wood', { grain: 'box', variant: 0 });
      if (oldGeometry) {
        view.ownedGeometries = view.ownedGeometries.filter((owned) => owned !== oldGeometry);
        oldGeometry.dispose();
      }
      if (view.gangplank) view.gangplank.geometry = geometry;
      else {
        view.gangplank = new THREE.Mesh(geometry, this.material(WOOD));
        view.gangplank.name = 'raft:gangplank';
        view.gangplank.castShadow = true;
        view.gangplank.receiveShadow = true;
        view.gangplank.userData.nm = this.nm;
        view.gangplank.userData.raftSurface = 'wood';
        view.visual.add(view.gangplank);
      }
      view.gangplank.userData.sizeKey = sizeKey;
      view.ownedGeometries.push(geometry);
      changed = true;
    }
    if (view.gangplankPoseKey !== poseKey) {
      const raftX = cleanNum(record.x), raftY = cleanNum(record.y, 0.72), raftZ = cleanNum(record.z);
      const raftYaw = cleanNum(record.yaw);
      const dx = pose.x - raftX, dz = pose.z - raftZ;
      const c = Math.cos(raftYaw), s = Math.sin(raftYaw);
      const localX = dx * c - dz * s;
      const localZ = dx * s + dz * c;
      const slope = Math.atan2(pose.rise, pose.length);
      const halfThickness = 0.07;
      const relativeYaw = pose.yaw - raftYaw;
      const normalOffset = halfThickness * Math.sin(slope);
      view.gangplank.position.set(localX + normalOffset * Math.sin(relativeYaw),
        pose.y - raftY - halfThickness * Math.cos(slope),
        localZ + normalOffset * Math.cos(relativeYaw));
      view.gangplank.rotation.set(-slope, relativeYaw, 0, 'YXZ');
      view.gangplankPoseKey = poseKey;
      changed = true;
    }
    return changed;
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
    const add = (color, shape, x, y, z, rx = 0, ry = 0, rz = 0, order = 'XYZ') => {
      const spec = typeof color === 'object' ? color : { kind: 'solid', color: colorHex(color), tint: colorHex(color) };
      const key = materialKey(spec);
      if (!batches.has(key)) batches.set(key, { spec, pieces: [] });
      const g = shape.clone();
      if (spec.kind !== 'solid') this.mapSurfaceUV(g, spec.kind, {
        grain: shape.type === 'BoxGeometry' ? 'box' : shape.type === 'CylinderGeometry' ? 'cylinder' : 'raw',
        variant: Math.abs(Math.round(x * 19 + z * 31 + y * 11)) });
      this.tmpEuler.set(rx, ry, rz, order);
      this.tempQuaternion.setFromEuler(this.tmpEuler);
      this.tempPosition.set(x, y, z);
      this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
      g.applyMatrix4(this.tempMatrix);
      batches.get(key).pieces.push(g);
    };
    const box = (color, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, order = 'XYZ') =>
      add(color, this.boxShape(w, h, d), x, y, z, rx, ry, rz, order);
    const cyl = (color, rt, rb, h, x, y, z, segments = 8, rx = 0, ry = 0, rz = 0) =>
      add(color, this.cylinderShape(rt, rb, h, segments), x, y, z, rx, ry, rz);
    const ring = (color, radius, tube, x, y, z, ry = 0, rx = 0) =>
      add(color, this.shape(`ring:${radius}:${tube}`, () => new THREE.TorusGeometry(radius, tube, 4, 12)), x, y, z, rx, ry);
    const line = (color, from, to, radius = 0.025) => {
      const curve = new THREE.LineCurve3(new THREE.Vector3(...from), new THREE.Vector3(...to));
      const g = new THREE.TubeGeometry(curve, 1, radius, 5, false);
      add(color, g, 0, 0, 0); g.dispose();
    };

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
        if (part.layer === 'base') for (const side of [-1, 1]) {
          cyl(WOOD_DARK, 0.28, 0.28, w * 0.96, cx, y - 0.48, cz + side * depth * 0.28, 8, 0, 0, Math.PI / 2);
          for (const sx of [-1, 1]) {
            ring(ROPE, 0.292, 0.038, cx + sx * w * 0.32, y - 0.48, cz + side * depth * 0.28, Math.PI / 2);
            for (const radius of [0.13, 0.235]) ring(INK, radius, 0.009, cx + sx * w * 0.481, y - 0.48, cz + side * depth * 0.28, Math.PI / 2);
          }
        }
        const thick = 0.18, plankN = Math.max(4, Math.round(pd * 5));
        box(WOOD_DARK, w * 0.94, 0.22, 0.14, cx, y - 0.22, cz - depth * 0.31);
        box(WOOD_DARK, w * 0.94, 0.22, 0.14, cx, y - 0.22, cz + depth * 0.31);
        for (let i = 0; i < plankN; i++) {
          const pz = cz - depth / 2 + (i + 0.5) * depth / plankN;
          box(i % 3 === 0 ? WOOD_LIGHT : base, w * 0.98, thick, depth / plankN - 0.035, cx, y - thick / 2, pz);
        }
        for (const sx of [-1, 1]) {
          box(IRON, 0.085, 0.045, depth * 0.96, cx + sx * w * 0.33, y + 0.025, cz);
          for (const dz of [-0.34, 0, 0.34]) cyl(IRON_LIGHT, 0.035, 0.042, 0.045, cx + sx * w * 0.33, y + 0.064, cz + dz * depth, 6);
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
          // P2 keeps doors visually closed; the solid leaf makes the doorway read clearly from every side.
          const normal = horizontal ? [0, 0, d === 0 ? -1 : 1] : [d === 1 ? 1 : -1, 0, 0];
          const leafOffset = 0.035;
          const doorPoint = (u, yy, face = leafOffset) => [
            ex + (horizontal ? u : normal[0] * face), yy,
            ez + (horizontal ? normal[2] * face : u),
          ];
          const faceBox = (color, wide, tall, deep, u, yy, face = leafOffset) => {
            const p = doorPoint(u, yy, face);
            box(color, horizontal ? wide : deep, tall, horizontal ? deep : wide, p[0], p[1], p[2]);
          };
          faceBox(WOOD_DARK, 1.35, 2.25, 0.12, 0, y + 1.125);
          for (let i = 0; i < 4; i++) faceBox(WOOD, 0.31, 2.17, 0.045, -0.51 + i * 0.34, y + 1.125, leafOffset + 0.078);
          // Cross braces are thin iron rods on the leaf face, and remain part of the atlas-mapped batch.
          const brace = (u0, h0, u1, h1) => line(IRON, doorPoint(u0, y + h0, leafOffset + 0.12), doorPoint(u1, y + h1, leafOffset + 0.12), 0.035);
          brace(-0.52, 0.20, 0.52, 0.72); brace(-0.52, 2.05, 0.52, 1.53);
          faceBox(IRON, 0.09, 0.24, 0.04, 0.45, y + 1.12, leafOffset + 0.13);
          const handle = doorPoint(0.45, y + 1.12, leafOffset + 0.18);
          const handleRx = horizontal ? (normal[2] > 0 ? Math.PI / 2 : -Math.PI / 2) : 0;
          const handleRz = horizontal ? 0 : (normal[0] > 0 ? -Math.PI / 2 : Math.PI / 2);
          cyl(IRON_LIGHT, 0.035, 0.035, 0.08, handle[0], handle[1], handle[2], 8, handleRx, 0, handleRz);
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
          const sailX = mastX + sailW * 0.48, sailY = y + mastH * 0.59;
          const sail = this.shape(`sail:${sailW}:${sailH}`, () => {
            const g = new THREE.PlaneGeometry(sailW, sailH, 8, 10), p = g.attributes.position, uv = g.attributes.uv;
            for (let i = 0; i < p.count; i++) p.setZ(i, 0.22 * Math.sin(uv.getX(i) * Math.PI) * Math.sin(uv.getY(i) * Math.PI));
            g.computeVertexNormals(); return g;
          });
          add(CLOTH, sail, sailX, sailY, cz);
          for (const sy of [-1, 1]) {
            box(WOOD_LIGHT, sailW + 0.18, 0.09, 0.10, sailX, sailY + sy * sailH / 2, cz);
            line(ROPE, [sailX - sailW / 2, sailY + sy * sailH / 2, cz + 0.02], [sailX + sailW / 2, sailY + sy * sailH / 2, cz + 0.02], 0.025);
          }
          for (const sx of [-1, 1]) line(ROPE, [sailX + sx * sailW / 2, sailY - sailH / 2, cz + 0.02], [sailX + sx * sailW / 2, sailY + sailH / 2, cz + 0.02], 0.023);
          for (const yy of [0.26, mastH * 0.61, mastH - 0.1]) {
            for (const off of [-0.035, 0.035]) ring(ROPE, 0.115, 0.025, mastX, y + yy + off, cz, 0, Math.PI / 2);
          }
          // Rigging and fittings are visual only: they do not change the authoritative blueprint or deck.
          line(ROPE, [mastX, y + mastH - 0.07, cz], [cx + w * 0.40, y + 0.1, cz + depth * 0.41], 0.026);
          line(ROPE, [mastX, y + mastH - 0.07, cz], [cx - w * 0.40, y + 0.1, cz - depth * 0.41], 0.026);
          for (let i = 0; i < 5; i++) ring(IRON, 0.027, 0.009, sailX - sailW * 0.42 + i * sailW * 0.21, sailY + sailH * 0.45, cz + 0.018);
          box(bannerColor(record.look?.banner), Math.min(0.68, sailW * 0.46), 0.38, 0.07,
            mastX + sailW * 0.52, y + mastH + 0.15, cz);
        } else if (id === 'crate') {
          const assetId = assets.propId('crate');
          const model = assetId ? assets.model(assetId, { w: 1.25, h: 1.15 }) : null;
          let crateWidth = 1.18, crateDepth = 1.18, crateBottom = 0, crateTop = 1.1;
          if (model) {
            const fitBounds = new THREE.Box3().setFromObject(model);
            const fitSize = fitBounds.getSize(new THREE.Vector3());
            crateWidth = fitSize.x; crateDepth = fitSize.z;
            crateBottom = fitBounds.min.y; crateTop = fitBounds.max.y;
            if (this.atlas || this.surfaceSkin) model.traverse((o) => {
              if (!o.isMesh) return;
              // Reskin this fitted instance, leaving the island's registry source and shared resources intact.
              o.geometry = o.geometry.clone();
              this.mapSurfaceUV(o.geometry, 'wood', { grain: 'box', variant: x + z * 3 });
              ownedGeometries.push(o.geometry);
              o.material = this.material(WOOD); o.userData.nm = this.nm; o.userData.raftSurface = 'wood';
            });
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
          for (const sx of [-1, 1]) {
            // Thin straps wrap the fitted crate surface; a full slab would cut through its open interior.
            const strapX = cx + sx * crateWidth * 0.32, crateHeight = crateTop - crateBottom;
            for (const sz of [-1, 1]) {
              const strapZ = cz + sz * (crateDepth / 2 + 0.018);
              box(IRON, 0.085, crateHeight, 0.035, strapX, y + (crateTop + crateBottom) / 2, strapZ);
              for (const sy of [0.2, 0.8]) cyl(IRON_LIGHT, 0.03, 0.035, 0.035, strapX,
                y + crateBottom + crateHeight * sy, strapZ + sz * 0.025, 6, Math.PI / 2);
            }
            box(IRON, 0.085, 0.035, crateDepth + 0.07, strapX, y + crateTop + 0.016, cz);
          }
        } else if (id === 'chest' || id === 'storage') {
          const ww = id === 'storage' ? 1.55 : 1.2;
          box(WOOD_DARK, ww, 0.7, 1.3, cx, y + 0.38, cz);
          box(WOOD, ww * 0.96, 0.18, 1.34, cx, y + 0.82, cz);
          box(IRON, 0.12, 0.3, 0.08, cx, y + 0.58, cz + 0.69);
        } else if (id === 'stairs') {
          const count = Math.max(1, STAIR.steps | 0), treadDepth = CELL / count, rise = LEVEL_H / count;
          const slope = Math.atan2(LEVEL_H, CELL), slopeLength = Math.hypot(LEVEL_H, CELL);
          const turn = (lx, lz) => {
            if (d === 1) return [lz, -lx];
            if (d === 2) return [-lx, -lz];
            if (d === 3) return [-lz, lx];
            return [lx, lz];
          };
          for (let i = 0; i < count; i++) {
            const [ox, oz] = turn(0, -CELL / 2 + (i + 0.5) * treadDepth);
            box(WOOD, STAIR.width, 0.13, treadDepth - 0.015, cx + ox, y + (i + 1) * rise - 0.065, cz + oz, 0, d * Math.PI / 2);
          }
          // Paired sloped stringers and handrails mark both blocked sides of the climb.
          for (const side of [-1, 1]) {
            const [sx, sz] = turn(side * (STAIR.width / 2 + 0.045), 0);
            box(WOOD_DARK, 0.11, 0.17, slopeLength, cx + sx, y + LEVEL_H / 2 - 0.03, cz + sz,
              -slope, d * Math.PI / 2, 0, 'YXZ');
            const [hx, hz] = turn(side * (STAIR.width / 2 + 0.14), 0);
            box(WOOD, 0.09, 0.11, slopeLength, cx + hx, y + LEVEL_H / 2 + 0.74, cz + hz,
              -slope, d * Math.PI / 2, 0, 'YXZ');
          }
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

    for (const [key, { spec, pieces }] of batches) {
      const merged = mergeGeometries(pieces, false);
      for (const piece of pieces) piece.dispose();
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      ownedGeometries.push(merged);
      const mesh = new THREE.Mesh(merged, this.material(spec));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.nm = spec.kind === 'cloth' ? this.clothNm : this.nm;
      mesh.userData.raftSurface = spec.kind;
      mesh.name = `raft:parts:${key}`;
      visual.add(mesh);
    }

    const view = {
      id: String(record.id), root, visual, revKey: keyOf(record), record,
      ownedGeometries, external, phase: hashPhase(record.id), isLocal: false,
      gangplank: null, gangplankPoseKey: '',
      x: NaN, y: NaN, z: NaN, yaw: NaN,
    };
    this.updateGangplank(view, record);
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
      if (this.updateGangplank(view, record)) changed = true;

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
    this.clothNm.dispose();
  }
}
