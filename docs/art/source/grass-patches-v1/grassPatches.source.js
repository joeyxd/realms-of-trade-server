// Opaque bent blades avoid alpha overdraw; sparse instancing and distance LOD keep grass inexpensive.
import * as THREE from 'three';
import { toon } from './toon.js';
import { LAYER } from './pipeline.js';
import { GRASS_STYLES, grassGeometry } from './grassGeometry.js';
import { GRASS_LIMIT, buildGrassPatches, grassBudget } from './grassPlacement.js';

const CELL = 24;

export function createGrassPatches(map, { shrubs = [] } = {}) {
  const group = new THREE.Group(); group.name = 'grassPatches';
  const points = buildGrassPatches(map, { shrubs }), sway = { value: 0.075 };
  const material = toon({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide },
    { sway: true, swayUniform: sway, comic: false, key: 'grass-patches-v1' });
  const geometry = GRASS_STYLES.map((_, i) => [grassGeometry(i), grassGeometry(i, { low: true })]);
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), yaw = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
  const compose = (p) => {
    q.setFromUnitVectors(up, normal.set(p.nx, p.ny, p.nz));
    yaw.setFromAxisAngle(up, p.rot); q.multiply(yaw);
    return matrix.compose(pos.set(p.x, p.y, p.z), q, scale.setScalar(p.scale));
  };
  const buckets = new Map();
  points.forEach((p, index) => {
    const key = `${p.variant}:${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
    if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push({ p, index });
  });
  const batches = [];
  for (const [key, members] of buckets) {
    const variant = members[0].p.variant;
    const meshes = geometry[variant].map((geo, lod) => {
      const mesh = new THREE.InstancedMesh(geo, material, members.length);
      mesh.name = `grass-${key}-${lod ? 'far' : 'near'}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      members.forEach(({ p }, i) => mesh.setMatrixAt(i, compose(p)));
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += 0.15;
      mesh.castShadow = false; mesh.receiveShadow = true;
      // The material supplies broad painted color planes; avoid a second per-blade outline pass.
      mesh.layers.set(LAYER.NO_OUTLINE);
      mesh.count = 0; mesh.visible = false; group.add(mesh); return mesh;
    });
    batches.push({ members, meshes });
  }
  const stats = group.userData.grass = { total: points.length, patches: new Set(points.map((p) => p.patch)).size,
    limit: GRASS_LIMIT, variants: GRASS_STYLES.map((style, i) => ({ style, count: points.filter((p) => p.variant === i).length })),
    active: 0, near: 0, far: 0, triangles: 0, batches: 0, cosmetic: true, textures: [],
    castShadow: false, alphaTest: 0, chunkSize: CELL };
  let budget = grassBudget(), dirty = true, lastX = NaN, lastZ = NaN;
  function update(focus) {
    if (!focus || !Number.isFinite(focus.x) || !Number.isFinite(focus.z)) return;
    if (!dirty && Math.hypot(focus.x - lastX, focus.z - lastZ) < 2) return;
    lastX = focus.x; lastZ = focus.z; dirty = false;
    Object.assign(stats, { active: 0, near: 0, far: 0, triangles: 0, batches: 0, budget: { ...budget } });
    for (const { members, meshes } of batches) {
      const counts = [0, 0];
      for (const { p, index } of members) {
        if (index >= budget.limit) continue;
        const dist = Math.hypot(p.x - focus.x, p.z - focus.z);
        if (dist > budget.distance) continue;
        const lod = budget.detailDistance > 0 && dist <= budget.detailDistance ? 0 : 1;
        meshes[lod].setMatrixAt(counts[lod]++, compose(p));
      }
      meshes.forEach((mesh, lod) => {
        mesh.count = counts[lod]; mesh.visible = counts[lod] > 0;
        if (mesh.visible) { mesh.instanceMatrix.needsUpdate = true; stats.batches++; }
        stats[lod ? 'far' : 'near'] += counts[lod];
        stats.triangles += counts[lod] * (mesh.geometry.index.count / 3);
      });
    }
    stats.active = stats.near + stats.far;
  }
  update(map.landmarks?.spawn || { x: 0, z: 0 });
  return { group, points, update, setQuality(name, mobile = false) {
    budget = grassBudget(name, mobile); dirty = true;
    if (Number.isFinite(lastX)) update({ x: lastX, z: lastZ });
  } };
}
