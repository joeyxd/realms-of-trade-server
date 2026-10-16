// Shared opaque paint and spatial batches keep the beach kit cheap at every quality tier.
import * as THREE from 'three';
import { toon } from './toon.js';
import { LAYER } from './pipeline.js';
import { assets } from './assets/registry.js';
import { DEBRIS_STYLES, DEBRIS_IDS, debrisGeometry, loadedDebrisGeometry } from './beachDebrisGeometry.js';
import { DEBRIS_LIMIT, buildBeachDebris, debrisBudget } from './beachDebrisPlacement.js';
import { preserveTerrainSites } from './terrainSites.js';

export function createBeachDebris(map, { shrubs = [], grass = [] } = {}) {
  const group = new THREE.Group(); group.name = 'beachDebris';
  const points = preserveTerrainSites(map, buildBeachDebris, { shrubs, grass }), loaded = [];
  const material = toon({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide },
    { comic: false, key: 'beach-debris-v1',
      vertPars: 'varying vec3 vDebrisPoint;\n', vertBody: 'vDebrisPoint = position;\n',
      fragPars: 'varying vec3 vDebrisPoint;\n',
      albedo: /* glsl */ `
        {
          // Long, uneven painted scars stay broad enough to read; derivatives quiet distant grain.
          vec3 p = vDebrisPoint;
          float curve = p.z + 0.018 * sin(p.x * 7.0) + 0.012 * sin(p.x * 17.0 + p.y * 8.0);
          float phase = curve * 11.0 + p.y * 2.0;
          float line = abs(fract(phase) - 0.5) / 11.0;
          float aa = fwidth(line) + 0.0002;
          float grain = 1.0 - smoothstep(0.004 - aa, 0.008 + aa, line);
          float gaps = smoothstep(-0.25, 0.35, sin(p.x * 10.0 + floor(phase) * 4.1));
          float fade = 1.0 - smoothstep(14.0, 30.0, distance(vMnWorld, cameraPosition));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.045, 0.028), grain * gaps * fade * 0.72);
          float wash = sin(curve * 27.0 + p.x * 0.9) * 0.045;
          diffuseColor.rgb *= 1.0 + wash * fade;
        }
      ` });
  const geometry = DEBRIS_STYLES.map((_, i) => {
    const source = loadedDebrisGeometry(assets.data(DEBRIS_IDS[i]));
    if (source) loaded.push(DEBRIS_IDS[i]); return source || debrisGeometry(i);
  });
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), yaw = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
  const compose = (p) => {
    q.setFromUnitVectors(up, normal.set(p.nx, p.ny, p.nz)); yaw.setFromAxisAngle(up, p.rot); q.multiply(yaw);
    return matrix.compose(pos.set(p.x, p.y, p.z), q, scale.setScalar(p.scale));
  };
  const buckets = new Map();
  points.forEach((p, index) => {
    const key = `${p.variant}:${Math.floor(p.x / 32)},${Math.floor(p.z / 32)}`;
    if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push({ p, index });
  });
  const batches = [];
  for (const [key, members] of buckets) {
    const mesh = new THREE.InstancedMesh(geometry[members[0].p.variant], material, members.length);
    mesh.name = `beach-debris-${key}`; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    members.forEach(({ p }, i) => mesh.setMatrixAt(i, compose(p))); mesh.computeBoundingSphere();
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.layers.set(LAYER.NO_OUTLINE);
    mesh.count = 0; mesh.visible = false; group.add(mesh); batches.push({ members, mesh });
  }
  const stats = group.userData.debris = { total: points.length, limit: DEBRIS_LIMIT, active: 0, batches: 0, triangles: 0,
    variants: DEBRIS_STYLES.map((style, i) => ({ style, count: points.filter((p) => p.variant === i).length })),
    loaded, cosmetic: true, textures: [], castShadow: false, chunkSize: 32 };
  let budget = debrisBudget(), dirty = true, lastX = NaN, lastZ = NaN;
  function update(focus) {
    if (!focus || !Number.isFinite(focus.x) || !Number.isFinite(focus.z)) return;
    if (!dirty && Math.hypot(focus.x - lastX, focus.z - lastZ) < 2) return;
    lastX = focus.x; lastZ = focus.z; dirty = false;
    Object.assign(stats, { active: 0, batches: 0, triangles: 0, budget: { ...budget } });
    for (const { members, mesh } of batches) {
      let count = 0;
      for (const { p, index } of members) {
        if (index >= budget.limit || Math.hypot(p.x - focus.x, p.z - focus.z) > budget.distance) continue;
        mesh.setMatrixAt(count++, compose(p));
      }
      mesh.count = count; mesh.visible = count > 0;
      if (count) { mesh.instanceMatrix.needsUpdate = true; stats.batches++; }
      stats.active += count; stats.triangles += count * (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
    }
  }
  update(map.landmarks?.spawn || { x: 0, z: 0 });
  return { group, points, update, setQuality(name, mobile = false) {
    budget = debrisBudget(name, mobile); dirty = true;
    if (Number.isFinite(lastX)) update({ x: lastX, z: lastZ });
  } };
}
