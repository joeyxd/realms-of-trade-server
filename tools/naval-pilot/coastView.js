import * as THREE from 'three';
import { LAYER } from '../../src/render/pipeline.js';

const TERRAIN_SIZE = 96;
const TERRAIN_STEP = 2;

function inWaterHull(map, center, direction, yaw, rig) {
  const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  for (const side of [-1, 1]) for (const end of [-1, 1]) {
    const x = center.x + right.x * side * rig.beam / 2 + direction.x * end * rig.length / 2;
    const z = center.z + right.z * side * rig.beam / 2 + direction.z * end * rig.length / 2;
    if (map.heightAt(x, z) >= 0 || map.onDock?.(x, z)) return false;
  }
  return true;
}

function pointSegmentDistanceSquared(point, start, end) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared)) : 0;
  const x = start.x + t * dx, z = start.z + t * dz;
  return (point.x - x) ** 2 + (point.z - z) ** 2;
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  const onSegment = (p, q, r) => q.x >= Math.min(p.x, r.x) && q.x <= Math.max(p.x, r.x) &&
    q.z >= Math.min(p.z, r.z) && q.z <= Math.max(p.z, r.z);
  const epsilon = 1e-9;
  return ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
      ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon)) ||
    (Math.abs(abC) <= epsilon && onSegment(a, c, b)) || (Math.abs(abD) <= epsilon && onSegment(a, d, b)) ||
    (Math.abs(cdA) <= epsilon && onSegment(c, a, d)) || (Math.abs(cdB) <= epsilon && onSegment(c, b, d));
}

function segmentDistanceSquared(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistanceSquared(a, c, d), pointSegmentDistanceSquared(b, c, d),
    pointSegmentDistanceSquared(c, a, b), pointSegmentDistanceSquared(d, a, b));
}

function dockApproachClearance(map, start, shore, rig, margin = 1) {
  const dock = map.dock;
  if (!dock?.base || !dock?.end || !Number.isFinite(dock.halfWidth)) return Infinity;
  const radius = Math.hypot(rig.beam, rig.length) / 2 + dock.halfWidth + margin;
  return Math.sqrt(segmentDistanceSquared(start, shore, dock.base, dock.end)) - radius;
}

export function findCoastApproach(map, rig, { clearance = 20 } = {}) {
  if (!map?.dock?.end || typeof map.heightAt !== 'function' || !rig ||
      ![rig.beam, rig.length, rig.hullCx, rig.hullCz, clearance].every(Number.isFinite) ||
      rig.beam <= 0 || rig.length <= 0 || clearance < 0) throw new TypeError('A valid map, hull rig and clearance are required.');
  const origin = map.dock.end, candidates = [];
  for (let degrees = 0; degrees < 360; degrees++) {
    const angle = degrees * Math.PI / 180, direction = { x: Math.cos(angle), z: Math.sin(angle) };
    let previous = map.heightAt(origin.x, origin.z), previousDistance = 0;
    for (let distance = 0.5; distance <= 80; distance += 0.5) {
      const x = origin.x + direction.x * distance, z = origin.z + direction.z * distance;
      const height = map.heightAt(x, z);
      if (previous < 0 && height >= 0 && !map.onDock?.(x, z)) {
        let low = previousDistance, high = distance;
        for (let i = 0; i < 8; i++) {
          const mid = (low + high) / 2;
          const mh = map.heightAt(origin.x + direction.x * mid, origin.z + direction.z * mid);
          if (mh < 0) low = mid; else high = mid;
        }
        const shore = { x: origin.x + direction.x * high, z: origin.z + direction.z * high };
        const yaw = Math.atan2(direction.x, direction.z), centerDistance = clearance + rig.length / 2;
        const hullCenter = { x: shore.x - direction.x * centerDistance, z: shore.z - direction.z * centerDistance };
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const pose = { x: hullCenter.x - c * rig.hullCx - s * rig.hullCz,
          y: 0.72, z: hullCenter.z + s * rig.hullCx - c * rig.hullCz, yaw };
        let dockFree = true;
        for (let along = 0; along <= centerDistance; along += 1) {
          const px = shore.x - direction.x * along, pz = shore.z - direction.z * along;
          if (map.onDock?.(px, pz)) { dockFree = false; break; }
        }
        const dockClearance = dockApproachClearance(map, hullCenter, shore, rig);
        if (dockFree && dockClearance >= 0 &&
            inWaterHull(map, hullCenter, direction, yaw, rig)) candidates.push({
          pose, shore, direction: { ...direction }, clearance,
          coastDistance: Math.hypot(shore.x - origin.x, shore.z - origin.z), dockClearance,
        });
        break;
      }
      previous = height; previousDistance = distance;
    }
  }
  candidates.sort((a, b) => a.coastDistance - b.coastDistance);
  if (!candidates.length) throw new Error('No hay una aproximación a costa que deje el casco entero en agua y libre del muelle.');
  return Object.freeze(candidates[0]);
}

function terrainColor(height, mask) {
  if (height < -0.05) return new THREE.Color(0x244e63);
  if (mask?.sand > 0.35 || height < 1.7) return new THREE.Color(0xc6aa72);
  if (height < 4.5) return new THREE.Color(0x657b4b);
  return new THREE.Color(0x596b53);
}

export function buildCoastGeometry(map, { center, size = TERRAIN_SIZE, step = TERRAIN_STEP } = {}) {
  if (!map || typeof map.heightAt !== 'function' || !center || ![center.x, center.z, size, step].every(Number.isFinite) ||
      size <= 0 || step <= 0 || Math.round(size / step) !== size / step) throw new TypeError('A map and a regular coast patch are required.');
  const cells = size / step;
  const positions = new Float32Array((cells + 1) * (cells + 1) * 3);
  const colors = new Float32Array(positions.length);
  const indices = new Uint32Array(cells * cells * 6);
  const color = new THREE.Color();
  let v = 0;
  for (let iz = 0; iz <= cells; iz++) for (let ix = 0; ix <= cells; ix++) {
    const x = center.x - size / 2 + ix * step, z = center.z - size / 2 + iz * step;
    const y = map.heightAt(x, z);
    positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
    const mask = typeof map.masks === 'function' ? map.masks(x, z) : null;
    color.copy(terrainColor(y, mask));
    colors[v * 3] = color.r; colors[v * 3 + 1] = color.g; colors[v * 3 + 2] = color.b;
    v++;
  }
  let k = 0;
  for (let iz = 0; iz < cells; iz++) for (let ix = 0; ix < cells; ix++) {
    const a = iz * (cells + 1) + ix, b = a + 1, c = a + cells + 1, d = c + 1;
    indices[k++] = a; indices[k++] = c; indices[k++] = b;
    indices[k++] = b; indices[k++] = c; indices[k++] = d;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

function dockMesh(map) {
  const dock = map?.dock;
  if (!dock?.base || !dock?.end || !dock?.dir || !Number.isFinite(dock.len) || !Number.isFinite(dock.halfWidth)) return null;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(dock.halfWidth * 2, 0.48, dock.len),
    new THREE.MeshStandardMaterial({ color: 0x927044, roughness: 0.92, metalness: 0 }));
  mesh.name = 'naval-pilot-real-dock';
  mesh.position.set((dock.base.x + dock.end.x) / 2, dock.deckY - 0.24, (dock.base.z + dock.end.z) / 2);
  mesh.rotation.y = Math.atan2(dock.dir.x, dock.dir.z);
  mesh.layers.set(LAYER.WORLD);
  return mesh;
}

export class NavalPilotCoastView {
  constructor(scene, { mobile = false } = {}) {
    if (!scene?.add) throw new TypeError('NavalPilotCoastView requires a scene.');
    this.scene = scene; this.mobile = !!mobile; this.map = null; this.terrain = null; this.dock = null;
    this.diagnostics = { patchSize: TERRAIN_SIZE, step: mobile ? 4 : TERRAIN_STEP, triangles: 0, center: null, dock: null };
  }

  update(map) {
    if (!map?.dock || typeof map.heightAt !== 'function') throw new TypeError('The world map must include its real dock and height field.');
    if (this.terrain) { this.scene.remove(this.terrain); this.terrain.geometry.dispose(); this.terrain.material.dispose(); }
    if (this.dock) { this.scene.remove(this.dock); this.dock.geometry.dispose(); this.dock.material.dispose(); }
    const center = { x: (map.dock.base.x + map.dock.end.x) / 2, z: (map.dock.base.z + map.dock.end.z) / 2 };
    const step = this.mobile ? 4 : TERRAIN_STEP;
    const geometry = buildCoastGeometry(map, { center, size: TERRAIN_SIZE, step });
    this.terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
    this.terrain.name = 'naval-pilot-map-coast'; this.terrain.layers.set(LAYER.WORLD); this.scene.add(this.terrain);
    this.dock = dockMesh(map); if (this.dock) this.scene.add(this.dock);
    this.map = map;
    this.diagnostics = { patchSize: TERRAIN_SIZE, step, triangles: geometry.index.count / 3, center, dock: {
      base: { ...map.dock.base }, end: { ...map.dock.end }, halfWidth: map.dock.halfWidth,
    } };
    return { ...this.diagnostics, dock: structuredClone(this.diagnostics.dock) };
  }

  dispose() {
    for (const mesh of [this.terrain, this.dock]) if (mesh) {
      this.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose();
    }
    this.terrain = this.dock = null;
  }
}
