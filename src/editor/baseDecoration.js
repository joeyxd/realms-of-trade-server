import * as THREE from 'three';

const KIND_LABELS = Object.freeze({
  rock: { en: 'Natural rock', es: 'Roca natural' },
  flower: { en: 'Flower', es: 'Flor' },
  pebble: { en: 'Pebble', es: 'Guijarro' },
});
const RENDERER_WHITELIST = /^(?:rocks[01]|coastRocks\d+|flowers\d+|pebbles)$/;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const clone = (value) => structuredClone(value);

function fingerprint(seed, revision, prop, index) {
  const text = JSON.stringify([seed, revision, index, prop.kind, prop.x, prop.y, prop.z,
    prop.rot, prop.scale, prop.r, prop.v, prop.h]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function checkedTransform(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 3 || !value.position || !value.rotation ||
      typeof value.scale !== 'number' || !finite(value.scale) || value.scale <= 0) {
    throw new TypeError('Invalid base decoration transform');
  }
  for (const vector of [value.position, value.rotation]) {
    if (Object.keys(vector).length !== 3 || !['x', 'y', 'z'].every((key) => finite(vector[key]))) {
      throw new TypeError('Invalid base decoration transform');
    }
  }
  return clone(value);
}

function logicalMatrix(transform, target = new THREE.Matrix4()) {
  const position = transform.position, rotation = transform.rotation;
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z, 'YXZ'));
  return target.compose(new THREE.Vector3(position.x, position.y, position.z), quaternion,
    new THREE.Vector3(transform.scale, transform.scale, transform.scale));
}

function sameCollider(collider, prop) {
  return collider && collider.x === prop.x && collider.z === prop.z && collider.r === prop.r;
}

function colliderKey(value) { return JSON.stringify([value.x, value.z, value.r]); }

/** Draft-only transforms for cosmetic instances registered by the vegetation renderer. */
export class BaseDecorationLayer {
  constructor({ scene, map, baseRevision = 'terrain-s21-v1' } = {}) {
    if (!scene?.traverse || !map || !Array.isArray(map.props) || !Array.isArray(map.colliders) ||
        !Number.isSafeInteger(map.seed) || typeof baseRevision !== 'string' || !baseRevision) {
      throw new TypeError('BaseDecorationLayer requires a scene, generated map, and base revision');
    }
    this.scene = scene;
    this.map = map;
    this.baseRevision = baseRevision;
    this.entries = new Map();
    this.byMesh = new WeakMap();
    this.meshSnapshots = new Map();
    this.colliderSnapshots = map.colliders.map((c) => clone(c));
    this.colliderOwnerCounts = new Map();
    for (const prop of map.props) {
      if (prop?.r > 0 && [prop.x, prop.z, prop.r].every(finite)) {
        const key = colliderKey(prop);
        this.colliderOwnerCounts.set(key, (this.colliderOwnerCounts.get(key) || 0) + 1);
      }
    }
    this.overrides = new Map();

    const meshes = [];
    scene.traverse((object) => {
      if (object.isInstancedMesh && Array.isArray(object.userData?.gmBaseProps) && RENDERER_WHITELIST.test(object.name)) {
        meshes.push(object);
      }
    });
    for (const mesh of meshes) this.#registerMesh(mesh);
  }

  #registerMesh(mesh) {
    const props = mesh.userData.gmBaseProps;
    const lookup = new Map();
    mesh.updateWorldMatrix(true, false);
    const meshWorld = mesh.matrixWorld.clone();
    const originalMatrices = [];
    for (let instanceIndex = 0; instanceIndex < props.length; instanceIndex++) {
      if (instanceIndex >= mesh.count) break;
      const prop = props[instanceIndex];
      const index = this.map.props.indexOf(prop);
      if (index < 0 || !KIND_LABELS[prop.kind] || ![prop.x, prop.y, prop.z, prop.rot, prop.scale, prop.r,
        prop.v, prop.h].every(finite) || prop.scale <= 0 || lookup.has(index)) continue;
      const id = `base:${prop.kind}:${index}:${fingerprint(this.map.seed >>> 0, this.baseRevision, prop, index)}`;
      if (id.length > 96) continue;
      const originalLocal = new THREE.Matrix4();
      mesh.getMatrixAt(instanceIndex, originalLocal);
      originalMatrices[instanceIndex] = originalLocal.clone();
      const originalWorld = meshWorld.clone().multiply(originalLocal);
      const transform = { position: { x: prop.x, y: prop.y, z: prop.z },
        rotation: { x: 0, y: prop.rot, z: 0 }, scale: prop.scale };
      const originalLogicalWorld = logicalMatrix(transform);
      let ownedCollider = null;
      if (prop.r > 0) {
        const matches = [];
        for (let i = 0; i < this.colliderSnapshots.length; i++) {
          if (sameCollider(this.colliderSnapshots[i], prop)) matches.push(i);
        }
        if (matches.length === 1 && this.colliderOwnerCounts.get(colliderKey(prop)) === 1) ownedCollider = matches[0];
      }
      const entry = {
        id, kind: prop.kind, index, prop, baselineTransform: clone(transform),
        collider: prop.r > 0 && ownedCollider !== null
          ? { type: 'circle', radius: prop.r / prop.scale } : 'none',
        editable: prop.r === 0 || ownedCollider !== null,
        label: KIND_LABELS[prop.kind], mesh, instanceIndex,
        originalLocal, originalWorld, originalLogicalWorld,
        relative: originalLogicalWorld.clone().invert().multiply(originalWorld),
        ownedCollider,
      };
      lookup.set(instanceIndex, entry);
      this.entries.set(id, entry);
    }
    if (!this.meshSnapshots.has(mesh)) this.meshSnapshots.set(mesh, originalMatrices);
    this.byMesh.set(mesh, lookup);
  }

  list() { return [...this.entries.values()].map((entry) => this.#publicEntry(entry)); }

  get(id) {
    const entry = this.entries.get(id);
    return entry ? this.#publicEntry(entry) : null;
  }

  #publicEntry(entry) {
    return { id: entry.id, kind: entry.kind, index: entry.index, transform: clone(entry.baselineTransform),
      collider: clone(entry.collider), editable: entry.editable, label: { ...entry.label },
      mesh: entry.mesh, instanceIndex: entry.instanceIndex };
  }

  resolveHit(intersection) {
    if (!intersection?.object || !Number.isInteger(intersection.instanceId)) return null;
    const entry = this.byMesh.get(intersection.object)?.get(intersection.instanceId);
    return entry?.editable ? this.#publicEntry(entry) : null;
  }

  #checkedOverrides(overrides) {
    if (!Array.isArray(overrides)) throw new TypeError('Base decoration overrides must be an array');
    const next = new Map();
    for (const override of overrides) {
      if (!override || typeof override !== 'object' || Array.isArray(override) ||
          Object.keys(override).length !== 3 || typeof override.id !== 'string' ||
          typeof override.hidden !== 'boolean' || next.has(override.id)) {
        throw new TypeError('Invalid base decoration override');
      }
      const entry = this.entries.get(override.id);
      if (!entry || !entry.editable) throw new TypeError('Unknown or non-editable base decoration ID');
      next.set(override.id, { transform: checkedTransform(override.transform), hidden: override.hidden });
    }
    return next;
  }

  apply(overrides) {
    const next = this.#checkedOverrides(overrides);
    const writes = [];
    for (const entry of this.entries.values()) {
      const state = next.get(entry.id);
      const transform = state?.transform || { position: { x: entry.prop.x, y: entry.prop.y, z: entry.prop.z },
        rotation: { x: 0, y: entry.prop.rot, z: 0 }, scale: entry.prop.scale };
      const desired = logicalMatrix(transform).multiply(entry.relative);
      if (state?.hidden) desired.makeScale(0, 0, 0);
      const parentWorld = entry.mesh.matrixWorld;
      const local = state ? parentWorld.clone().invert().multiply(desired) : entry.originalLocal.clone();
      writes.push({ entry, local, transform });
    }
    // Validation and matrix computation complete before the first mesh is touched.
    for (const { entry, local, transform } of writes) {
      entry.mesh.setMatrixAt(entry.instanceIndex, local);
    }
    for (const mesh of this.meshSnapshots.keys()) this.#refreshMesh(mesh);
    this.overrides = next;
    return this.list();
  }

  setTransform(id, transform) {
    const entry = this.entries.get(id);
    if (!entry || !entry.editable) throw new TypeError('Unknown or non-editable base decoration ID');
    const next = new Map(this.overrides);
    const previous = next.get(id);
    next.set(id, { transform: checkedTransform(transform), hidden: previous?.hidden ?? false });
    return this.apply([...next].map(([key, state]) => ({ id: key, ...state })));
  }

  colliders(overrides = [...this.overrides].map(([id, state]) => ({ id, ...state }))) {
    const next = this.#checkedOverrides(overrides);
    const replaced = new Set();
    for (const [id, state] of next) {
      const entry = this.entries.get(id);
      if (entry.ownedCollider !== null) replaced.add(entry.ownedCollider);
    }
    const result = this.colliderSnapshots.filter((_, i) => !replaced.has(i)).map((c) => ({ ...c }));
    for (const [id, state] of next) {
      const entry = this.entries.get(id);
      if (entry.ownedCollider === null || state.hidden) continue;
      result.push({ ...this.colliderSnapshots[entry.ownedCollider], x: state.transform.position.x,
        z: state.transform.position.z, r: entry.collider.radius * state.transform.scale });
    }
    return result;
  }

  model(id) {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const group = new THREE.Group();
    group.name = id;
    group.userData.gmBaseDecorationId = id;
    const material = entry.mesh.material;
    let proxyMaterial = material;
    if (entry.mesh.instanceColor) {
      const color = new THREE.Color();
      entry.mesh.getColorAt(entry.instanceIndex, color);
      const tintOne = (source) => {
        const copy = source.clone();
        if (copy.color) copy.color.multiply(color);
        return copy;
      };
      proxyMaterial = Array.isArray(material) ? material.map(tintOne) : tintOne(material);
      group.userData.gmOwnedMaterials = Array.isArray(proxyMaterial) ? proxyMaterial : [proxyMaterial];
    }
    const mesh = new THREE.Mesh(entry.mesh.geometry, proxyMaterial);
    mesh.name = `${id}:model`;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(entry.relative);
    mesh.castShadow = entry.mesh.castShadow;
    mesh.receiveShadow = entry.mesh.receiveShadow;
    mesh.layers.mask = entry.mesh.layers.mask;
    mesh.userData.nm = entry.mesh.userData.nm;
    mesh.customDepthMaterial = entry.mesh.customDepthMaterial;
    group.add(mesh);
    return group;
  }

  restore() {
    for (const [mesh, matrices] of this.meshSnapshots) {
      matrices.forEach((matrix, index) => { if (matrix) mesh.setMatrixAt(index, matrix); });
      this.#refreshMesh(mesh);
    }
    this.overrides.clear();
    return this.list();
  }

  #refreshMesh(mesh) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }
}

export function createBaseDecorationLayer(options) { return new BaseDecorationLayer(options); }
