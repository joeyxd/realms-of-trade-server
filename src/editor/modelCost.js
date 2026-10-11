import { Box3 } from 'three';

const MATERIAL_TEXTURE_KEYS = [
  'alphaMap', 'aoMap', 'attenuationColorMap', 'bumpMap', 'clearcoatMap', 'clearcoatNormalMap',
  'clearcoatRoughnessMap', 'displacementMap', 'emissiveMap', 'envMap', 'gradientMap', 'iridescenceMap',
  'iridescenceThicknessMap', 'lightMap', 'map', 'metalnessMap', 'normalMap', 'roughnessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'specularColorMap', 'specularIntensityMap', 'thicknessMap',
  'transmissionMap',
];

function fail(message) { throw new TypeError(`Cannot measure model cost: ${message}`); }

function finiteInteger(value, label, { allowInfinity = false } = {}) {
  if (allowInfinity && value === Infinity) return value;
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer`);
  return value;
}

function drawSegments(geometry, material) {
  const position = geometry.getAttribute?.('position');
  const index = geometry.getIndex?.();
  if (!position || position.itemSize < 3) fail('mesh has no usable position attribute');
  const total = finiteInteger(index ? index.count : position.count, 'vertex count');
  if (!total) fail('mesh has empty geometry');

  const range = geometry.drawRange || { start: 0, count: Infinity };
  const drawStart = finiteInteger(range.start ?? 0, 'drawRange.start');
  const drawCount = finiteInteger(range.count ?? Infinity, 'drawRange.count', { allowInfinity: true });
  const drawEnd = Math.min(total, drawCount === Infinity ? total : drawStart + drawCount);
  if (drawStart > total || drawEnd < drawStart) fail('mesh has an invalid draw range');

  const groups = geometry.groups || [];
  const useGroups = Array.isArray(material);
  if (useGroups && groups.length === 0) fail('material array has no geometry groups');
  const segments = useGroups ? groups : [{ start: 0, count: total, materialIndex: 0 }];
  const output = [];
  let hasVisibleMaterial = false;
  for (const group of segments) {
    if (!group || !Number.isSafeInteger(group.start) || group.start < 0 ||
        !(group.count === Infinity || (Number.isSafeInteger(group.count) && group.count >= 0))) {
      fail('mesh has an invalid geometry group');
    }
    if (useGroups && (!Number.isSafeInteger(group.materialIndex) || !material[group.materialIndex])) {
      fail('geometry group references a missing material');
    }
    const groupEnd = Math.min(total, group.count === Infinity ? total : group.start + group.count);
    const start = Math.max(drawStart, group.start);
    const end = Math.min(drawEnd, groupEnd);
    const activeMaterial = useGroups ? material[group.materialIndex] : material;
    if (activeMaterial.visible !== false) hasVisibleMaterial = true;
    if (end > start && activeMaterial.visible !== false) output.push({ count: end - start, material: activeMaterial });
  }
  if (!hasVisibleMaterial) return [];
  if (!output.length) fail('mesh has no drawable triangles');
  return output;
}

/** Measure rendered static-model cost and its conservative XZ footprint in root-local space. */
export function measureModelCost(root) {
  if (!root?.isObject3D || root.isMesh) fail('expected a non-mesh Object3D root');
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone();
  if (!Number.isFinite(rootInverse.determinant()) || Math.abs(rootInverse.determinant()) < 1e-12) fail('root transform is not invertible');
  rootInverse.invert();

  const geometries = new Set(), materials = new Set(), maps = new Set();
  const textureSizes = [];
  const bounds = new Box3();
  bounds.makeEmpty();
  let triangles = 0, primitives = 0, meshes = 0;
  root.traverse((object) => {
    if (!object.visible) return;
    for (let ancestor = object.parent; ancestor && ancestor !== root.parent; ancestor = ancestor.parent) {
      if (!ancestor.visible) return;
      if (ancestor === root) break;
    }
    if (!object.isMesh) {
      if (object.isLine || object.isLineSegments || object.isPoints || object.isSprite) fail('model contains a non-triangle renderable');
      return;
    }
    if (object.isSkinnedMesh || object.isInstancedMesh || object.morphTargetInfluences?.length) fail('model contains a dynamic mesh type');
    const geometry = object.geometry;
    if (!geometry?.isBufferGeometry) fail('mesh uses an unsupported geometry type');
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    if (!meshMaterials.length || meshMaterials.some((entry) => !entry?.isMaterial)) fail('mesh has no supported material');
    const segments = drawSegments(geometry, object.material);
    if (!segments.length) return;
    for (const segment of segments) triangles += Math.floor(segment.count / 3);
    primitives += segments.length;
    meshes++;
    geometries.add(geometry);
    for (const material of new Set(segments.map((segment) => segment.material))) {
      materials.add(material);
      for (const key of MATERIAL_TEXTURE_KEYS) {
        const texture = material[key];
        if (!texture) continue;
        if (!texture.isTexture) fail(`material property ${key} is not a supported texture`);
        if (maps.has(texture)) continue;
        const image = texture.image;
        const width = Number(image?.width), height = Number(image?.height);
        if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
          fail(`texture ${key} has no loaded image dimensions`);
        }
        maps.add(texture);
        textureSizes.push({ width, height });
      }
    }

    geometry.computeBoundingBox();
    const sourceBox = geometry.boundingBox;
    if (!sourceBox || sourceBox.isEmpty() || ![sourceBox.min.x, sourceBox.min.y, sourceBox.min.z, sourceBox.max.x, sourceBox.max.y, sourceBox.max.z].every(Number.isFinite)) {
      fail('mesh has no finite bounds');
    }
    const relative = rootInverse.clone().multiply(object.matrixWorld);
    bounds.union(sourceBox.clone().applyMatrix4(relative));
  });
  if (!meshes || !geometries.size || !materials.size || !primitives || !triangles || bounds.isEmpty()) fail('model contains no supported rendered mesh triangles');
  const radius = Math.max(
    Math.hypot(bounds.min.x, bounds.min.z), Math.hypot(bounds.min.x, bounds.max.z),
    Math.hypot(bounds.max.x, bounds.min.z), Math.hypot(bounds.max.x, bounds.max.z),
  );
  const textureBytes = Math.ceil(textureSizes.reduce((sum, { width, height }) => sum + width * height * 4 * (4 / 3), 0));
  if (!Number.isSafeInteger(triangles) || !Number.isSafeInteger(primitives) || !Number.isFinite(radius) || !Number.isSafeInteger(textureBytes)) {
    fail('computed model cost is outside supported numeric bounds');
  }
  return { triangles, primitives, radius, textures: textureSizes, textureBytes, geometries: geometries.size, materials: materials.size };
}
