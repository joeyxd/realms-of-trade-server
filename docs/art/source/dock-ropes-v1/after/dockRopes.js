// Small, static dock dressing, kept separate from navigation and berth ownership.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon } from './toon.js';
import { LAYER } from './pipeline.js';
import { mapRaftUV, RAFT_ATLAS_ID } from './raftMaterials.js';

class RopeCurve extends THREE.Curve {
  constructor(point) { super(); this.point = point; }
  getPoint(t, target = new THREE.Vector3()) { return target.set(...this.point(t)); }
}

export function dockRopeGeometry(map, mapped = false) {
  const d = map.dock;
  if (!d || !d.base || !d.dir || ![d.base.x, d.base.z, d.dir.x, d.dir.z, d.len, d.halfWidth, d.deckY].every(Number.isFinite)
      || d.len < 3 || d.halfWidth < 1 || Math.hypot(d.dir.x, d.dir.z) < .001) return null;
  const yaw = Math.atan2(d.dir.x, d.dir.z), c = Math.cos(yaw), s = Math.sin(yaw);
  const posts = (map.props || []).filter(p => p.kind === 'dockPost' && [p.x, p.y, p.z, p.scale].every(Number.isFinite) && p.scale > 0)
    .map(p => { const dx = p.x - d.base.x, dz = p.z - d.base.z;
      return { x: c * dx - s * dz, z: s * dx + c * dz, y: p.y, scale: p.scale }; })
    .filter(p => p.z >= -1.6 && p.z <= d.len + .8 && Math.abs(Math.abs(p.x) - d.halfWidth) < .55)
    .sort((a, b) => a.z - b.z || a.x - b.x).slice(0, 16);
  const parts = [];
  const tube = (fn, segments, radius) => {
    const g = new THREE.TubeGeometry(new RopeCurve(fn), segments, radius, 5, false);
    if (mapped) mapRaftUV(g, 'rope');
    parts.push(g);
  };
  for (const p of posts) {
    // Two turns sit above the deck and outside each existing timber post.
    const r = .243 * p.scale;
    tube(t => { const angle = t * Math.PI * 4;
      return [p.x + Math.cos(angle) * r, p.y + (.23 + .16 * t) * p.scale, p.z + Math.sin(angle) * r]; }, 32, .047 * p.scale);
    const outward = p.x < 0 ? -1 : 1;
    tube(t => [p.x + outward * (r + .12 * t), p.y + (.23 - .17 * t) * p.scale, p.z + .12 * Math.sin(t * Math.PI)], 6, .043 * p.scale);
  }
  const coils = [];
  for (const [side, along] of [[-1, Math.min(4, d.len * .28)], [1, Math.max(1.5, d.len - 2.3)]]) {
    const x = side * (d.halfWidth - .46), z = along;
    // A flat spiral and short end stay in a narrow edge strip, leaving the route clear.
    tube(t => { const a = t * Math.PI * 5, r = .13 + .24 * t;
      return [x + Math.cos(a) * r, d.deckY + .063 + .013 * t, z + Math.sin(a) * r]; }, 48, .052);
    tube(t => [x - .37 - .05 * t, d.deckY + .071, z + .45 * t], 8, .049);
    coils.push({ x, z });
  }
  const geometry = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  geometry.computeBoundingSphere();
  geometry.userData.dockRopes = { family: 'dock-ropes-v1', wraps: posts.length, coils: coils.length, coilCenters: coils,
    triangles: geometry.index.count / 3, mapped, texturesAdded: 0 };
  return geometry;
}

export function dockRopeMaterial(atlas) {
  const material = toon({ color: atlas ? 0xffffff : 0xc6a66e, ...(atlas ? { map: atlas } : {}) }, {
    key: `dock-ropes-v1:${atlas ? 'atlas' : 'native'}`, hatchMask: '0.0',
    albedo: atlas ? /* glsl */ `{
      vec3 paint = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(0.4545));
      float value = dot(paint, vec3(0.2126, 0.7152, 0.0722));
      paint = mix(paint, vec3(value) * vec3(1.04, 1.0, .90), .35);
      diffuseColor.rgb = pow(paint, vec3(2.2));
    }` : '',
  });
  material.name = 'dock:painted-rope';
  material.userData.dockRopes = { family: 'dock-ropes-v1', atlas: atlas ? RAFT_ATLAS_ID : null, texturesAdded: 0 };
  return material;
}

export function createDockRopes(map, atlas) {
  const geometry = dockRopeGeometry(map, !!atlas);
  if (!geometry) return null;
  const mesh = new THREE.Mesh(geometry, dockRopeMaterial(atlas));
  mesh.name = 'dockRopes';
  mesh.userData.dockRopes = { ...geometry.userData.dockRopes, atlas: atlas ? RAFT_ATLAS_ID : null };
  mesh.position.set(map.dock.base.x, 0, map.dock.base.z);
  mesh.rotation.y = Math.atan2(map.dock.dir.x, map.dock.dir.z);
  mesh.receiveShadow = true;
  // Thin cords do not need a separate outline/normal pass or extra shadow casters.
  mesh.layers.set(LAYER.NO_OUTLINE);
  return mesh;
}
