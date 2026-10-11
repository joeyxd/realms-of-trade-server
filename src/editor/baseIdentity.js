// Pure GM base-decoration identity and eligibility shared with the Node host.
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const colliderKey = (prop) => JSON.stringify([prop.x, prop.z, prop.r]);

export function gmBaseId(seed, revision, prop, index) {
  const text = JSON.stringify([seed >>> 0, revision, index, prop.kind, prop.x, prop.y, prop.z,
    prop.rot, prop.scale, prop.r, prop.v, prop.h]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `base:${prop.kind}:${index}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function naturalRock(map, prop) {
  if (prop.kind !== 'rock') return false;
  const masks = map.masks(prop.x, prop.z);
  return masks.volcanic < .2 && masks.arenaFloor < .1 && masks.lava < .1;
}

function coastalRock(map, prop) {
  if (prop.kind !== 'rock' || map.materialAt(prop.x, prop.z) !== 'sand') return false;
  const masks = map.masks(prop.x, prop.z);
  return masks.volcanic < .2 && masks.arenaFloor < .1 && masks.lava < .1 && masks.path < .2;
}

/** Return the exact GM02 base prop references which may be overridden, in map order. */
export function gmEditableBaseProps(map, revision = map?.baseRevision || '') {
  if (!map || !Array.isArray(map.props) || !Array.isArray(map.colliders) ||
      typeof map.masks !== 'function' || typeof map.materialAt !== 'function') {
    throw new TypeError('Invalid generated map for GM base identity');
  }
  const source = map.terrainSource || map;
  const colliderCounts = new Map();
  for (const prop of map.props) {
    if (prop?.r > 0 && [prop.x, prop.z, prop.r].every(finite)) {
      const key = colliderKey(prop);
      colliderCounts.set(key, (colliderCounts.get(key) || 0) + 1);
    }
  }
  return map.props.flatMap((prop, index) => {
    if (!prop || !['rock', 'flower', 'pebble'].includes(prop.kind) ||
        ![prop.x, prop.y, prop.z, prop.rot, prop.scale, prop.r, prop.v, prop.h].every(finite) || prop.scale <= 0) return [];
    const sourceProp = source.props?.[index] || prop;
    const coastal = prop.kind === 'rock' && coastalRock(source, sourceProp);
    if (prop.kind === 'rock' && !coastal && !naturalRock(source, sourceProp)) return [];
    let editable = prop.r === 0;
    if (prop.r > 0) {
      const matches = map.colliders.filter((collider) => collider.x === prop.x && collider.z === prop.z && collider.r === prop.r).length;
      editable = matches === 1 && colliderCounts.get(colliderKey(prop)) === 1;
    }
    return editable ? [{ id: gmBaseId(map.seed, revision, prop, index), index, prop, coastal }] : [];
  });
}
