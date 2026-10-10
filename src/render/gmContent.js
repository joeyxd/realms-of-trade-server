import * as THREE from 'three';
import { validateDocument } from '../editor/document.js';
import { createBaseDecorationLayer } from '../editor/baseDecoration.js';
import { createEditorModels } from '../editor/modelFactory.js';

function sourceEntry(entry) {
  if (!entry || typeof entry.id !== 'string' || typeof entry.src !== 'string') throw new TypeError('Invalid prepared GM asset entry');
  const prefix = entry.src.startsWith('baseassets/') ? 'baseassets/' : entry.src.startsWith('assets/') ? 'assets/' : null;
  if (!prefix) throw new TypeError('Prepared GM asset source must be inside an asset root');
  const src = entry.src.slice(prefix.length);
  if (!src || src.split('/').some((part) => !part || part === '.' || part === '..')) throw new TypeError('Invalid prepared GM asset source');
  return { ...entry.loader, id: entry.id, src, base: prefix };
}

function disposeOwnedGroup(group, { disposeGeometry = true, disposeMaterials = true } = {}) {
  const geometries = new Set(), materials = new Set();
  group.traverse((object) => {
    if (object.geometry && disposeGeometry) geometries.add(object.geometry);
    if (object.material && disposeMaterials) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const material of group.userData.gmOwnedMaterials || []) material.dispose?.();
}

function place(group, transform) {
  group.position.set(transform.position.x, transform.position.y, transform.position.z);
  group.rotation.order = 'YXZ';
  group.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  group.scale.setScalar(transform.scale);
  group.updateMatrix();
  group.updateMatrixWorld(true);
}

/** Renderer-only projection of a validated GM content document. */
export function createGmContentLayer({ scene, map, assets, baseRevision = 'terrain-s21-v1' } = {}) {
  if (!scene?.add || !scene?.remove || !map?.props || !assets?.model || !assets?.data || !assets?.entry) {
    throw new TypeError('GM content layer requires a scene, base map, and asset registry');
  }
  let baseLayer = null, modelFactory = null, document = null, active = false, suspended = false, disposed = false;
  const authored = new Map();

  function removeAuthored() {
    for (const group of authored.values()) {
      scene.remove(group);
      // Base-decoration proxies own their tinted material; model-factory/registry assets own shared resources.
      if (group.userData.gmOwnedMaterials?.length) disposeOwnedGroup(group, { disposeGeometry: false, disposeMaterials: false });
    }
    authored.clear();
  }

  async function load(rawDocument, assetEntries = []) {
    if (disposed) throw new Error('GM content layer is disposed');
    const next = rawDocument === null ? null : validateDocument(rawDocument);
    if (!Array.isArray(assetEntries)) throw new TypeError('Prepared GM assets must be an array');
    const needed = new Set((next?.objects || []).filter((item) => !item.assetId.startsWith('base:')).map((item) => item.assetId));
    const supplied = new Map(assetEntries.map((entry) => [entry?.id, entry]));
    for (const id of needed) {
      if (assets.has?.(id)) continue;
      const entry = supplied.get(id);
      if (!entry) throw new TypeError(`Missing prepared GM asset: ${id}`);
      const raw = sourceEntry(entry);
      const loaded = await assets.ensureModel(raw, { base: raw.base });
      if (!loaded || !assets.has(id)) throw new Error(`Prepared GM asset failed to load: ${id}`);
    }

    const wasSuspended = suspended;
    suspend();
    const nextBaseLayer = createBaseDecorationLayer({ scene, map, baseRevision });
    let nextFactory, nextGroups = new Map();
    try {
      nextFactory = createEditorModels(assets);
      // Resolve every referenced base identity before touching scene state.
      for (const item of next?.objects || []) if (item.assetId.startsWith('base:') && !nextBaseLayer.get(item.assetId)) {
        throw new TypeError(`Unknown prepared GM base asset: ${item.assetId}`);
      }
      for (const item of next?.objects || []) {
        const group = item.assetId.startsWith('base:') ? nextBaseLayer.model(item.assetId) : nextFactory.model(item.assetId);
        if (!group) throw new Error(`Prepared GM model unavailable: ${item.assetId}`);
        group.name = `gm:${item.id}`;
        group.userData.gmObjectId = item.id;
        place(group, item.transform);
        nextGroups.set(item.id, group);
      }

      restore();
      baseLayer = nextBaseLayer;
      modelFactory = nextFactory;
      document = next;
      for (const group of nextGroups.values()) scene.add(group);
      for (const item of document?.objects || []) authored.set(item.id, nextGroups.get(item.id));
      active = true;
      apply();
      return api;
    } catch (error) {
      for (const group of nextGroups.values()) {
        scene.remove(group);
        if (group.userData.gmOwnedMaterials?.length) disposeOwnedGroup(group, { disposeGeometry: false, disposeMaterials: false });
      }
      nextFactory?.dispose();
      nextBaseLayer?.restore();
      if (!wasSuspended) resume();
      throw error;
    }
  }

  function apply() {
    if (!active || disposed) return false;
    suspended = false;
    baseLayer.apply(document?.baseOverrides || []);
    for (const group of authored.values()) {
      if (group.parent !== scene) scene.add(group);
      group.visible = true;
    }
    return true;
  }

  function suspend() {
    if (!active || disposed || suspended) return false;
    baseLayer.restore();
    for (const group of authored.values()) group.visible = false;
    suspended = true;
    return true;
  }

  function resume() { return apply(); }

  function restore() {
    if (!active && !baseLayer && !authored.size) return false;
    removeAuthored();
    baseLayer?.restore();
    modelFactory?.dispose();
    baseLayer = null; modelFactory = null; document = null; active = false; suspended = false;
    return true;
  }

  function dispose() {
    if (disposed) return;
    restore();
    disposed = true;
  }

  const api = { load, apply, suspend, resume, restore, dispose, get active() { return active; }, get suspended() { return suspended; } };
  return api;
}
