// Prepare a deterministic, reversible projection for a common ground-family pearl return.
// Persistence and reservation ownership stay with GroundHostAuthority.stageFamily.
import { types } from 'node:util';
import { mulberry32 } from '../src/core/rng.js';
import { sanitizePearl } from '../src/data/pearls.js';
import { tuning } from '../src/data/tuning.js';
import { canStand } from '../src/sim/systems/movement.js';
import { returnPearl } from '../src/sim/systems/pearls.js';
import { StoreError } from './store.mjs';
import { canonicalText, managedPearl, pearlKind } from './pearlOperations.mjs';
import { checkedGroundResult, groundData, groundKey } from './pearlGround.mjs';
import { assertGroundDeadlineClock } from './groundDeadlineClock.mjs';
import { assertDropContainers, snapshotDropData } from './deathDropApply.mjs';

const clone = structuredClone;
const same = (a, b) => canonicalText(a) === canonicalText(b);
const fail = (code = 'operation') => { throw new StoreError(code); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

function inputRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || types.isProxy(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) fail();
  const fields = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(fields).some(key => typeof key !== 'string' || !Object.hasOwn(fields[key], 'value')) ||
      Object.keys(fields).sort().join(',') !== 'deadlineClock,dropId,row,world') fail();
  return Object.fromEntries(Object.entries(fields).map(([key, descriptor]) => [key, descriptor.value]));
}

const ownValue = (object, key) => {
  const d = Object.getOwnPropertyDescriptor(object, key);
  if (!d || !Object.hasOwn(d, 'value')) fail('effect');
  return d.value;
};

export function prepareGroundPearlReturn(raw) {
  const { world: w, deadlineClock: rawClock, dropId, row: rawRow } = inputRecord(raw);
  if (!w || typeof w !== 'object' || types.isProxy(w) || !Number.isSafeInteger(dropId) || dropId < 1) fail();
  assertDropContainers(w);
  const row = snapshotDropData(rawRow);
  if (!row || Array.isArray(row) || Object.keys(row).sort().join(',') !== 'ground,kind,uid,version,world') fail();
  const uid = groundKey(row.uid), worldId = groundKey(row.world), ground = groundData(row.ground);
  const pearl = sanitizePearl({ uid, kind: row.kind });
  if (!pearl || !managedPearl(pearlKind(row.kind)) || pearl.uid !== uid || pearl.kind !== row.kind || !Number.isSafeInteger(row.version) ||
      row.version < 1 || row.version >= 2147483647) fail();
  const clock = assertGroundDeadlineClock(rawClock, worldId);
  const tick = ownValue(w, 'tick'), map = ownValue(w, 'map'), raftDeck = ownValue(w, 'raftDeck');
  const ecs = ownValue(w, 'ecs'), profiles = ownValue(w, 'profiles'), drops = ownValue(w, 'drops');
  const ledgerMap = ownValue(w, 'pearlLedger'), dirty = ownValue(w, 'profileDirty'), events = ownValue(w, 'events');
  if (!Number.isSafeInteger(tick) || tick < 0 || !map || !ecs || !Number.isSafeInteger(ownValue(w, 'nextDrop')) ||
      ownValue(w, 'nextDrop') < 1 || ownValue(w, 'nextDrop') >= Number.MAX_SAFE_INTEGER) fail();
  const durableAt = clock.at(tick), nextDrop = ownValue(w, 'nextDrop');
  const rng = ownValue(w, 'lootRng');
  if (typeof rng !== 'function' || types.isProxy(rng) || typeof rng.state !== 'function') fail('effect');
  const rngBefore = rng.state();
  if (!Number.isInteger(rngBefore) || rngBefore < 0 || rngBefore > 4294967295 || drops.has(nextDrop)) fail('effect');

  const sourceObject = Map.prototype.get.call(drops, dropId);
  const source = snapshotDropData(sourceObject), sourcePearl = sanitizePearl(source?.pearl);
  if (!source || source.id !== dropId || source.to !== 0 || source.kind !== 'pearl' || !sourcePearl ||
      !same(sourcePearl, source.pearl) || sourcePearl.uid !== uid || sourcePearl.kind !== row.kind) fail('ownership');
  const sourceGround = clock.assertDrop(source, 'pearl');
  if (!same(sourceGround, ground) || durableAt <= sourceGround.returnAt) fail('ownership');
  const ledger = Map.prototype.get.call(ledgerMap, uid), ledgerBefore = snapshotDropData(ledger);
  if (!same(ledgerBefore, { owner: '', entity: 0, place: 'ground', drop: dropId })) fail('ownership');

  const originalDrops = [...Map.prototype.entries.call(drops)];
  const originalDropData = originalDrops.map(([id, item]) => [id, snapshotDropData(item)]);
  const originalLedgerEntries = [...Map.prototype.entries.call(ledgerMap)];
  const originalLedgerData = originalLedgerEntries.map(([key, value]) => [key, snapshotDropData(value)]);
  const originalProfiles = [...Map.prototype.entries.call(profiles)];
  const originalProfileData = originalProfiles.map(([entity, profile]) => [entity, snapshotDropData(profile)]);
  const originalDirty = [...Set.prototype.values.call(dirty)];
  for (const profile of Map.prototype.values.call(profiles)) {
    if (profilePearlUids(profile).includes(uid)) fail('ownership');
  }
  for (const [id, item] of originalDrops) {
    if (id === dropId) continue;
    const detached = snapshotDropData(item);
    if (detached?.pearl?.uid === uid) fail('ownership');
  }

  const geometry = [map.groundAt, map.onDock, map.queryColliders, map.zoneAt, map.bounds, map.colliders, map.landmarks];
  const worldTuning = snapshotDropData(tuning.world);
  const eventCount = events.length;
  const localDrop = clone(source);
  delete localDrop.groundClock;
  const view = { tick, map, raftDeck, ecs, nextDrop, lootRng: mulberry32(rngBefore),
    drops: new Map([[dropId, localDrop]]), pearlLedger: new Map([[uid, clone(ledgerBefore)]]), events: [],
    emit(event) { this.events.push(clone(event)); } };
  const target = returnPearl(view, localDrop);
  if (!target || target.id !== nextDrop || view.nextDrop !== nextDrop + 1 || !same(target.pearl, pearl)) fail('effect');
  const targetGround = Object.freeze({ x: target.x, z: target.z,
    availableAt: clock.at(target.pickAt), returnAt: clock.at(target.t) });
  const targetDrop = freeze({ ...snapshotDropData(target), ...clock.project(targetGround, 'pearl') });
  clock.assertDrop(targetDrop, 'pearl', targetGround);
  const plannedEvents = snapshotDropData(view.events), rngAfter = view.lootRng.state();
  const footprint = footprintAt(w, targetDrop);
  const originalEventRefs = Array.from(events);
  const originalEventData = snapshotDropData(events);
  const originalLedger = ledger;
  const originalRng = rng, originalEmit = w.emit;
  let applied = false;
  let publishedEvents = [];

  const assertCurrent = () => {
    assertDropContainers(w);
    if (ownValue(w, 'tick') !== tick || ownValue(w, 'map') !== map || ownValue(w, 'raftDeck') !== raftDeck ||
        ownValue(w, 'ecs') !== ecs || ownValue(w, 'profiles') !== profiles || ownValue(w, 'drops') !== drops ||
        ownValue(w, 'pearlLedger') !== ledgerMap || ownValue(w, 'profileDirty') !== dirty || ownValue(w, 'events') !== events ||
        w.emit !== originalEmit ||
        ownValue(w, 'nextDrop') !== nextDrop || ownValue(w, 'lootRng') !== originalRng || originalRng.state() !== rngBefore ||
        events.length !== eventCount || events.some((event, i) => event !== originalEventRefs[i]) ||
        !same(snapshotDropData(events), originalEventData) ||
        !same(snapshotDropData(Map.prototype.get.call(drops, dropId)), source) ||
        !same(clock.assertDrop(Map.prototype.get.call(drops, dropId), 'pearl'), sourceGround) ||
        Map.prototype.get.call(ledgerMap, uid) !== originalLedger || !same(snapshotDropData(originalLedger), ledgerBefore) ||
        drops.has(nextDrop) || !same(snapshotDropData(tuning.world), worldTuning)) fail('cancelled');
    const entries = [...Map.prototype.entries.call(drops)];
    if (entries.length !== originalDrops.length || entries.some(([id, item], i) => id !== originalDrops[i][0] ||
        item !== originalDrops[i][1] || !same(snapshotDropData(item), originalDropData[i][1]))) fail('cancelled');
    const ledgerEntries = [...Map.prototype.entries.call(ledgerMap)];
    if (ledgerEntries.length !== originalLedgerEntries.length || ledgerEntries.some(([key, value], i) =>
      key !== originalLedgerEntries[i][0] || value !== originalLedgerEntries[i][1] ||
      !same(snapshotDropData(value), originalLedgerData[i][1]))) fail('cancelled');
    const profileEntries = [...Map.prototype.entries.call(profiles)];
    if (profileEntries.length !== originalProfiles.length || profileEntries.some(([entity, profile], i) =>
      entity !== originalProfiles[i][0] || profile !== originalProfiles[i][1] ||
      !same(snapshotDropData(profile), originalProfileData[i][1]))) fail('cancelled');
    const dirtyEntries = [...Set.prototype.values.call(dirty)];
    if (dirtyEntries.length !== originalDirty.length || dirtyEntries.some((entity, i) => entity !== originalDirty[i])) fail('cancelled');
    const currentGeometry = [map.groundAt, map.onDock, map.queryColliders, map.zoneAt, map.bounds, map.colliders, map.landmarks];
    if (currentGeometry.some((value, i) => value !== geometry[i]) || !same(footprintAt(w, targetDrop), footprint)) fail('cancelled');
    for (const profile of Map.prototype.values.call(profiles)) if (profilePearlUids(profile).includes(uid)) fail('ownership');
    for (const [id, item] of entries) if (id !== dropId && snapshotDropData(item)?.pearl?.uid === uid) fail('ownership');
    return true;
  };

  const operation = Object.freeze({ uid, kind: row.kind, from: null, to: null, expectedVersion: row.version,
    world: worldId, ground: targetGround, profiles: Object.freeze([]) });

  const apply = rawEffect => {
    if (applied) fail('effect');
    assertCurrent();
    const effect = snapshotDropData(rawEffect), checked = checkedGroundResult(effect, operation);
    if (!checked.ok || checked.replay || checked.location.uid !== uid || checked.location.world !== worldId ||
        checked.location.version !== row.version + 1 || !same(checked.location.ground, targetGround)) fail('response');
    const publication = { ecs, events: [], emit: view.emit };
    for (const event of plannedEvents) w.emit.call(publication, clone(event));
    const published = snapshotDropData(publication.events);
    publishedEvents = published;
    assertCurrent();
    if (eventCount + published.length > 4294967295) fail('effect');

    const nextRng = mulberry32(rngAfter);
    let started = false;
    try {
      started = true;
      Map.prototype.delete.call(drops, dropId);
      Map.prototype.set.call(drops, targetDrop.id, clone(targetDrop));
      Map.prototype.set.call(ledgerMap, uid, { owner: '', entity: 0, place: 'ground', drop: targetDrop.id });
      w.nextDrop = nextDrop + 1;
      w.lootRng = nextRng;
      const installed = Map.prototype.get.call(drops, targetDrop.id);
      if (ownValue(w, 'tick') !== tick || drops.has(dropId) || !same(snapshotDropData(installed), targetDrop) ||
          Map.prototype.get.call(ledgerMap, uid)?.drop !== targetDrop.id || ownValue(w, 'nextDrop') !== nextDrop + 1 ||
          ownValue(w, 'lootRng') !== nextRng || nextRng.state() !== rngAfter || events.length !== eventCount ||
          !same(clock.assertDrop(installed, 'pearl'), targetGround)) fail('effect');
      for (const event of published) Array.prototype.push.call(events, event);
      if (events.length !== eventCount + published.length || published.some((event, i) => events[eventCount + i] !== event)) fail('effect');
      applied = true;
      return true;
    } catch (error) {
      if (started) rollback();
      throw error;
    }
  };

  const rollback = () => {
    for (let i = events.length - 1; i >= eventCount; i--) {
      if (events[i] === publishedEvents[i - eventCount]) Array.prototype.splice.call(events, i, 1);
    }
    const current = [...Map.prototype.entries.call(drops)];
    const withoutSource = originalDrops.filter(([id]) => id !== dropId);
    const expected = withoutSource.concat([[targetDrop.id, Map.prototype.get.call(drops, targetDrop.id)]]);
    const ownIntermediate = current.length === withoutSource.length && current.every(([id, item], i) =>
      id === withoutSource[i][0] && item === withoutSource[i][1]);
    const ownComplete = current.length === expected.length && current.every(([id, item], i) =>
      id === expected[i][0] && item === expected[i][1]);
    if (ownIntermediate || ownComplete) {
      Map.prototype.clear.call(drops);
      for (const [id, item] of originalDrops) Map.prototype.set.call(drops, id, item);
    } else {
      if (Map.prototype.get.call(drops, targetDrop.id)?.id === targetDrop.id && targetDrop.id !== dropId) Map.prototype.delete.call(drops, targetDrop.id);
      if (!drops.has(dropId)) Map.prototype.set.call(drops, dropId, sourceObject);
    }
    if (Map.prototype.get.call(ledgerMap, uid)?.drop === targetDrop.id) Map.prototype.set.call(ledgerMap, uid, originalLedger);
    if (ownValue(w, 'nextDrop') === nextDrop + 1) w.nextDrop = nextDrop;
    if (ownValue(w, 'lootRng') !== originalRng && ownValue(w, 'lootRng')?.state?.() === rngAfter) w.lootRng = originalRng;
    applied = false;
  };
  return { operation, apply, assertCurrent, targetDrop };
}

function profilePearlUids(profile) {
  const data = snapshotDropData(profile);
  const pearls = data?.pearls;
  if (!pearls || !Array.isArray(pearls.bag)) fail('effect');
  return [...pearls.bag.map(q => q?.uid), ...(pearls.swallowed ? [pearls.swallowed.uid] : [])];
}

function footprintAt(world, target) {
  const { x, z } = target, map = world.map;
  return { standable: canStand(world, x, z, 0.2), height: map.groundAt(x, z), dock: !!map.onDock(x, z),
    zone: map.zoneAt?.(x, z)?.name || 'la playa' };
}
