import * as THREE from 'three';
import { fitBox } from '../render/assets/manifest.js';
import { loadedPalmGeometry, PALM_IDS } from '../render/palmGeometry.js';
import { loadedPalmBaseGeometry, PALM_BASE_IDS } from '../render/palmBaseGeometry.js';
import { loadedShrubGeometry, SHRUB_IDS } from '../render/shrubGeometry.js';
import { palmMaterials } from '../render/palmMaterials.js';
import { palmBaseMaterials } from '../render/palmBaseMaterials.js';
import { shrubMaterials } from '../render/shrubMaterials.js';

const PALM_SET = new Set(PALM_IDS);
const PALM_BASE_SET = new Set(PALM_BASE_IDS);
const SHRUB_SET = new Set(SHRUB_IDS);

function trackMaterials(owned, bundle) {
  for (const value of Object.values(bundle || {})) if (value?.isMaterial) owned.add(value);
}

function geometryParts(family, value) {
  if (family === 'palm') return [value.trunk, value.fronds];
  if (family === 'palmBase') return [value.roots, value.leaves];
  return [value.stems, value.leaves];
}

function materialParts(family, value) {
  if (family === 'palm') return [
    { material: value.trunk, normal: value.trunkNm, depth: value.trunkDepth },
    { material: value.fronds, normal: value.frondNm, depth: value.frondDepth },
  ];
  if (family === 'palmBase') return [
    { material: value.roots, normal: value.rootNm, depth: value.rootDepth },
    { material: value.leaves, normal: value.leafNm, depth: value.leafDepth },
  ];
  return [
    { material: value.stems, normal: value.stemNm, depth: value.stemDepth },
    { material: value.leaves, normal: value.leafNm, depth: value.leafDepth },
  ];
}

function familyFor(id) {
  if (PALM_SET.has(id)) return { name: 'palm', load: loadedPalmGeometry };
  if (PALM_BASE_SET.has(id)) return { name: 'palmBase', load: loadedPalmBaseGeometry };
  if (SHRUB_SET.has(id)) return { name: 'shrub', load: loadedShrubGeometry };
  return null;
}

/**
 * Creates editor-ready clones for the three painted vegetation families. Their
 * cached resources are owned by this factory; registry models remain registry-owned.
 */
export function createEditorModels(registry, { swayUniform = { value: 0.65 } } = {}) {
  const templates = new Map();
  const ownedGeometries = new Set();
  const ownedMaterials = new Set();
  let disposed = false;

  for (const id of [...PALM_IDS, ...PALM_BASE_IDS, ...SHRUB_IDS]) {
    const family = familyFor(id);
    const data = registry.data(id);
    const entry = registry.entry(id);
    if (!data || !entry) continue;
    const geometry = family.load(data);
    if (!geometry) continue;
    const parts = geometryParts(family.name, geometry);
    if (parts.some((part) => !part)) {
      for (const part of parts) part?.dispose();
      continue;
    }
    parts.forEach((part) => ownedGeometries.add(part));
    templates.set(id, { family: family.name, data, entry, parts });
  }

  const hasPalmMaterials = [...templates.values()].some(({ family }) => family === 'palm' || family === 'palmBase');
  const palmMats = hasPalmMaterials ? palmMaterials(registry, swayUniform) : null;
  if (palmMats) trackMaterials(ownedMaterials, palmMats);
  const baseMats = [...templates.values()].some(({ family }) => family === 'palmBase')
    ? palmBaseMaterials(registry, swayUniform, palmMats)
    : null;
  if (baseMats) trackMaterials(ownedMaterials, baseMats);
  const bushMats = [...templates.values()].some(({ family }) => family === 'shrub')
    ? shrubMaterials(registry, swayUniform)
    : null;
  if (bushMats) trackMaterials(ownedMaterials, bushMats);

  function materialsFor(family) {
    if (family === 'palm') return materialParts('palm', palmMats);
    if (family === 'palmBase') return materialParts('palmBase', baseMats);
    return materialParts('shrub', bushMats);
  }

  return {
    model(id, target = null) {
      if (disposed) return null;
      const template = templates.get(id);
      if (!template) return registry.model(id, target);
      const { data, entry, family, parts } = template;
      const fit = fitBox(data.min, data.max, entry, target);
      const group = new THREE.Group();
      group.name = id;
      const inner = new THREE.Group();
      inner.scale.setScalar(fit.s);
      inner.position.set(fit.x, fit.y, fit.z);
      const renderParts = materialsFor(family);
      parts.forEach((geometry, index) => {
        const render = renderParts[index];
        const mesh = new THREE.Mesh(geometry, render.material);
        mesh.userData.nm = render.normal;
        mesh.customDepthMaterial = render.depth;
        mesh.castShadow = entry.shadow;
        mesh.receiveShadow = true;
        inner.add(mesh);
      });
      group.add(inner);
      return group;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      ownedGeometries.clear();
      ownedMaterials.clear();
      templates.clear();
    },
  };
}
