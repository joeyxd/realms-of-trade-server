// RNV07a tuning knobs. Container contents are whole units and are stored separately
// from cargo goods so water can never be counted in two places at once.
export const FRESHWATER = Object.freeze({
  sourceId: 'salty-spring', collectTicks: 120, bucketCost: 2, barrelCost: 4,
  bucketId: 'bucket', bucketCapacity: 4, bucketVolume: 2, bucketMass: 1,
  canteenId: 'canteen', canteenCapacity: 3, canteenVolume: 1, canteenMass: 0.5,
  canteenLonaCost: 2, canteenWoodCost: 1,
  barrelCapacity: 20, barrelVolume: 0, bucketWoodCost: 2,
  maxVessels: 32, maxRevision: 2147483646,
});

const CANTEEN_OPS = new Set(['craftCanteen', 'fillCanteen', 'refillCanteen', 'drink', 'eat']);
export function isCanteenCommand(command) {
  try {
    if (!command || typeof command !== 'object') return false;
    const fields = Object.getOwnPropertyDescriptors(command);
    return Object.hasOwn(fields, 'type') && Object.hasOwn(fields.type, 'value') && fields.type.value === 'freshwater' &&
      Object.hasOwn(fields, 'op') && Object.hasOwn(fields.op, 'value') && CANTEEN_OPS.has(fields.op.value);
  } catch { return false; }
}

export function freshwaterSource(map) {
  if (!map || typeof map.toWorld !== 'function' || typeof map.groundAt !== 'function') return null;
  const point = map.toWorld(-69, 15);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  return { id: FRESHWATER.sourceId, x: point.x, y: map.groundAt(point.x, point.z), z: point.z, radius: 3 };
}

const invalid = () => { throw new TypeError('Invalid freshwater vessels'); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function readStoredVessels(holder) {
  if (!holder || typeof holder !== 'object') return [];
  const d = Object.getOwnPropertyDescriptor(holder, 'vessels');
  if (!d) { if ('vessels' in holder) return invalid(); return []; }
  if (!own(d, 'value')) return invalid();
  return readVessels(d.value);
}

// Missing legacy state is empty. Present state is deliberately strict: never repair
// or clamp saved contents here, because doing so could silently destroy water.
export function readVessels(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > FRESHWATER.maxVessels) return invalid();
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== raw.length + 1 || keys.some((k) => k !== 'length' && (!/^(0|[1-9]\d*)$/.test(k) || Number(k) >= raw.length))) return invalid();
  const ids = new Set(); let buckets = 0, canteens = 0;
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const item = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!item || !own(item, 'value')) return invalid();
    const v = item.value;
    if (!v || typeof v !== 'object' || Array.isArray(v) || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)) return invalid();
    const props = Reflect.ownKeys(v);
    if (props.length !== 3 || props.some((k) => !['id', 'kind', 'water'].includes(k))) return invalid();
    const fields = Object.getOwnPropertyDescriptors(v);
    if (['id', 'kind', 'water'].some((k) => !fields[k] || !own(fields[k], 'value'))) return invalid();
    const id = fields.id.value, kind = fields.kind.value, water = fields.water.value;
    if (typeof id !== 'string' || !Number.isSafeInteger(water) || water < 0) return invalid();
    if (kind === 'bucket') {
      if (id !== FRESHWATER.bucketId || ++buckets > 1 || water > FRESHWATER.bucketCapacity) return invalid();
    } else if (kind === 'canteen') {
      if (id !== FRESHWATER.canteenId || ++canteens > 1 || water > FRESHWATER.canteenCapacity) return invalid();
    } else if (kind === 'barrel') {
      if (!/^p[0-9]{1,10}$/.test(id) || water > FRESHWATER.barrelCapacity) return invalid();
    } else return invalid();
    if (ids.has(id)) return invalid();
    ids.add(id);
    out.push({ id, kind, water });
  }
  return out;
}

export function vesselsMass(hold) {
  return readVessels(hold?.vessels).reduce((sum, v) => sum + v.water +
    (v.kind === 'bucket' ? FRESHWATER.bucketMass : v.kind === 'canteen' ? FRESHWATER.canteenMass : 0), 0);
}

export function vesselsVolume(hold) {
  return readVessels(hold?.vessels).reduce((sum, v) => sum +
    (v.kind === 'bucket' ? FRESHWATER.bucketVolume : v.kind === 'canteen' ? FRESHWATER.canteenVolume : 0), 0);
}

// Profile shape matches eco.pack and eco.ships[].hold. Barrel validity follows the
// instance identity bound to its waterBarrel blueprint part, even if hp is zero.
export function validProfileVessels(profile) {
  try {
    const eco = profile?.eco;
    if (!eco || typeof eco !== 'object') return true;
    const pack = eco.pack;
    readStoredVessels(pack).forEach((v) => { if (v.kind !== 'bucket' && v.kind !== 'canteen') throw 0; });
    if (!Array.isArray(eco.ships)) return false;
    for (const ship of eco.ships) {
      const vessels = readStoredVessels(ship?.hold);
      const grid = Array.isArray(ship?.grid?.parts) ? ship.grid.parts : [];
      const condition = Array.isArray(ship?.condition?.entries) ? ship.condition.entries : [];
      for (const v of vessels) {
        if (v.kind !== 'barrel') return false;
        const row = condition.find((r) => Array.isArray(r) && r[0] === v.id);
        if (!row || row[1] !== 'waterBarrel' || !grid.some((p) => Array.isArray(p) && p[0] === 'waterBarrel' && p.slice(1, 5).every((n, i) => n === row[i + 2]))) return false;
      }
    }
    return true;
  } catch { return false; }
}
