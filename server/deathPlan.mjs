// Detached, synchronous preparation for a future whole-death transaction. This captures real
// gameplay rules; it neither reserves authority nor dispatches storage, applies or publishes.
import { mulberry32 } from '../src/core/rng.js';
import { tuning } from '../src/data/tuning.js';
import { C, KIND } from '../src/sim/ecs.js';
import { World } from '../src/sim/world.js';
import { killPlayer } from '../src/sim/systems/combat.js';
import { sanitizeProfile, spillOnDeath } from '../src/sim/systems/inventory.js';
import { spillPearls } from '../src/sim/systems/pearls.js';
import { StoreError } from './store.mjs';
import { canonicalText, profilePearls } from './pearlOperations.mjs';
import { pearlEcsDraft } from './pearlEcsEffect.mjs';
import { capturePearlProfile } from './pearlProfileSnapshot.mjs';

const clone = structuredClone;
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const normalized = (profile) => {
  const checked = sanitizeProfile(profile);
  if (!checked || canonicalText(checked) !== canonicalText(profile)) throw new StoreError('profile');
  return checked;
};
const counter = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647;
function selectors(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new StoreError('operation');
  const fields = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(fields).some((key) => !['seq', 'by'].includes(key) ||
      !Object.hasOwn(fields[key], 'value'))) throw new StoreError('operation');
  const seq = Object.hasOwn(fields, 'seq') ? fields.seq.value : 0;
  const by = Object.hasOwn(fields, 'by') ? fields.by.value : 0;
  if (!counter(seq) || !counter(by)) throw new StoreError('operation');
  return { seq, by };
}

const numericRow = (ecs, entity, live = ecs) => Object.fromEntries(Object.entries(live)
  .filter(([, column]) => ArrayBuffer.isView(column) && !(column instanceof DataView))
  .map(([key]) => {
    const value = ecs[key][entity];
    if (!Number.isFinite(value)) throw new StoreError('effect');
    return [key, value];
  }));

export function captureDeathPlan(world, entity, options = {}) {
  const { seq, by } = selectors(options), live = world.ecs;
  if (world.isServer !== true || !Number.isInteger(entity) || entity < 1 || entity >= live.cap ||
      !live.alive[entity] || live.dead[entity] > 0 || live.kind[entity] !== KIND.PLAYER ||
      !(live.mask[entity] & C.PLAYER) || !world.profiles?.has(entity)) throw new StoreError('session');
  if (!counter(world.tick) || !(world.pearlLedger instanceof Map) ||
      typeof world.lootRng?.state !== 'function') throw new StoreError('configuration');
  if (by && (by >= live.cap || !live.alive[by] || live.kind[by] !== KIND.PLAYER ||
      !(live.mask[by] & C.PLAYER))) throw new StoreError('session');
  const before = capturePearlProfile(world, entity), pearls = profilePearls(before);
  if (!before.pirateId) throw new StoreError('session');
  const owned = new Set(pearls.map((pearl) => pearl.uid));
  for (const pearl of pearls) {
    const row = world.pearlLedger.get(pearl.uid);
    if (row?.owner !== before.pirateId || row.entity !== entity || row.place !== 'profile' ||
        Object.keys(row).sort().join(',') !== 'entity,owner,place') {
      throw new StoreError('ownership');
    }
  }
  for (const [uid, row] of world.pearlLedger) {
    if (row?.place === 'profile' && (row.owner === before.pirateId || row.entity === entity) &&
        (!owned.has(uid) || row.owner !== before.pirateId || row.entity !== entity)) throw new StoreError('ownership');
  }
  const lawless = !!world.map.lawlessAt?.(live.x[entity], live.z[entity]);
  if (!Number.isFinite(tuning.combat.deathXpLoss) || tuning.combat.deathXpLoss < 0 ||
      tuning.combat.deathXpLoss > 1) throw new StoreError('configuration');
  const rngBefore = world.lootRng.state();
  if (!Number.isInteger(rngBefore) || rngBefore < 0 || rngBefore > 4294967295) throw new StoreError('effect');
  const numericBefore = numericRow(live, entity), draft = pearlEcsDraft(live, entity);
  if (typeof live.names[entity] !== 'string') throw new StoreError('effect');
  const profiles = new Map([[entity, clone(before)]]), baselines = new Map([[entity, before]]);
  // The existing spill credits the killer's PK only inside Cala. Capture that profile separately;
  // no killer ECS write or invented progression belongs to this victim's death.
  if (by && by !== entity && world.profiles.has(by)) {
    const killer = capturePearlProfile(world, by);
    profiles.set(by, clone(killer)); baselines.set(by, killer);
  }
  const view = { ecs: { ...draft.ecs, names: clone(live.names) }, map: world.map, raftDeck: world.raftDeck,
    tick: world.tick, profiles, pearlLedger: new Map(), drops: new Map(), nextDrop: 1,
    lootRng: mulberry32(rngBefore), profileDirty: new Set(), events: [],
    emit(event) { World.prototype.emit.call(this, clone(event)); },
    onDeath(e, killer) { spillPearls(this, e); spillOnDeath(this, e, killer); } };
  if (!killPlayer(view, entity, seq, by)) throw new StoreError('effect');
  const changes = [...profiles].map(([e, profile]) => ({ entity: e, before: clone(baselines.get(e)),
    after: normalized(profile) })).filter((row) => row.entity === entity ||
      canonicalText(row.before) !== canonicalText(row.after));
  // Drop IDs are temporary ordinals, never the live world's allocator. Persistent identity and
  // remapping at a future synchronous drain must be established by the transaction coordinator.
  return freeze({ entity, tick: world.tick, cause: { seq, by },
    rules: { xpLossFraction: tuning.combat.deathXpLoss, lawless }, profiles: changes,
    ecs: { before: numericBefore, after: numericRow(view.ecs, entity, live) },
    drops: [...view.drops.values()].map((drop) => clone(drop)),
    ledgers: [...view.pearlLedger].map(([uid, data]) => ({ uid, data: clone(data) })),
    events: clone(view.events), lootRng: { before: rngBefore, after: view.lootRng.state() } });
}
