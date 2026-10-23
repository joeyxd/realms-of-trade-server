// Prepare a deterministic, reversible projection for a freshly rolled public ground pearl.
import { types } from 'node:util';
import { sanitizePearl } from '../src/data/pearls.js';
import { tuning, DT } from '../src/data/tuning.js';
import { PEARL } from '../src/data/pearls.js';
import { canStand } from '../src/sim/systems/movement.js';
import { dropPearl } from '../src/sim/systems/pearls.js';
import { StoreError } from './store.mjs';
import { canonicalText } from './pearlOperations.mjs';
import { checkedGroundResult } from './pearlGround.mjs';
import { assertGroundDeadlineClock } from './groundDeadlineClock.mjs';
import { assertDropContainers, snapshotDropData } from './deathDropApply.mjs';

const same = (a, b) => canonicalText(a) === canonicalText(b);
const fail = (code = 'operation') => { throw new StoreError(code); };
const clone = structuredClone;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function input(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || types.isProxy(raw) ||
      Object.getPrototypeOf(raw) !== Object.prototype) fail();
  const d = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(d).some(k => typeof k !== 'string' || !Object.hasOwn(d[k], 'value')) ||
      Object.keys(d).sort().join(',') !== 'candidate,deadlineClock,host') fail();
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.value]));
}
function candidateData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || types.isProxy(raw) || Object.getPrototypeOf(raw) !== Object.prototype) fail();
  const d = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(d).some(k => typeof k !== 'string' || !Object.hasOwn(d[k], 'value')) ||
      Object.keys(d).sort().join(',') !== 'operationId,pearl,tick,x,z') fail();
  const c = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.value]));
  if (typeof c.operationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(c.operationId) ||
      !Number.isSafeInteger(c.tick) || c.tick < 0 || ![c.x, c.z].every(v => Number.isFinite(v) && Math.abs(v) <= 1e6)) fail();
  const pearl = snapshotDropData(c.pearl);
  if (!pearl || Array.isArray(pearl) || Object.keys(pearl).sort().join(',') !== 'kind,uid' ||
      pearl.uid !== `mint:${c.operationId}` || !sanitizePearl(pearl) || !same(sanitizePearl(pearl), pearl)) fail();
  return { ...c, pearl };
}
function profilePearlUids(profile) {
  const p = snapshotDropData(profile)?.pearls;
  if (!p || !Array.isArray(p.bag)) fail('effect');
  return [...p.bag.map(q => q?.uid), ...(p.swallowed ? [p.swallowed.uid] : [])];
}
function footprintAt(w, d) {
  return { standable: canStand(w, d.x, d.z, .2), height: w.map.groundAt(d.x, d.z), dock: !!w.map.onDock(d.x, d.z),
    zone: w.map.zoneAt?.(d.x, d.z)?.name || 'la playa' };
}

export function prepareGroundPearlMint(raw) {
  const { host, deadlineClock: rawClock, candidate: rawCandidate } = input(raw), c = candidateData(rawCandidate);
  const server = host?.server, w = server?.world;
  if (!w || typeof w !== 'object' || types.isProxy(w)) fail();
  assertDropContainers(w);
  const clock = assertGroundDeadlineClock(rawClock, host.worldState.id);
  const tick = w.tick, map = w.map, raftDeck = w.raftDeck, ecs = w.ecs, profiles = w.profiles,
    drops = w.drops, ledger = w.pearlLedger, dirty = w.profileDirty, events = w.events,
    nextDrop = w.nextDrop, emit = w.emit, rng = w.lootRng;
  if (!Number.isSafeInteger(tick) || tick < 0 || c.tick > tick || c.tick < tick - 1 || !map || !ecs ||
      !Number.isSafeInteger(nextDrop) || nextDrop < 1 || nextDrop >= Number.MAX_SAFE_INTEGER ||
      typeof emit !== 'function' || typeof rng !== 'function' || typeof rng.state !== 'function') fail();
  const rngState = rng.state();
  if (!Number.isInteger(rngState) || rngState < 0 || rngState > 0xffffffff || drops.has(nextDrop) || ledger.has(c.pearl.uid)) fail('ownership');
  const groundBase = { x: c.x, z: c.z,
    availableAt: clock.at(c.tick + 30), returnAt: clock.at(c.tick + Math.round(PEARL.returnAfter / DT)) };
  const originalDrops = [...Map.prototype.entries.call(drops)], dropData = originalDrops.map(([id, d]) => [id, snapshotDropData(d)]);
  const originalLedger = [...Map.prototype.entries.call(ledger)], ledgerData = originalLedger.map(([id, d]) => [id, snapshotDropData(d)]);
  const originalProfiles = [...Map.prototype.entries.call(profiles)], profileData = originalProfiles.map(([id, p]) => [id, snapshotDropData(p)]);
  const originalDirty = [...Set.prototype.values.call(dirty)], eventRefs = [...events], eventData = snapshotDropData(events);
  for (const p of Map.prototype.values.call(profiles)) if (profilePearlUids(p).includes(c.pearl.uid)) fail('ownership');
  for (const [, d] of originalDrops) if (snapshotDropData(d)?.pearl?.uid === c.pearl.uid) fail('ownership');
  const geometry = [map.groundAt, map.onDock, map.queryColliders, map.zoneAt, map.half, map.colliders, map.landmarks];
  const worldTuning = snapshotDropData(tuning.world), eventCount = events.length;
  const view = { tick: c.tick, map, raftDeck, ecs, nextDrop, drops: new Map(), pearlLedger: new Map(), events: [],
    emit(event) { this.events.push(clone(event)); } };
  const target = dropPearl(view, clone(c.pearl), c.x, c.z);
  if (!target || target.id !== nextDrop || view.nextDrop !== nextDrop + 1 ||
      view.pearlLedger.get(c.pearl.uid)?.drop !== target.id) fail('effect');
  const ground = { ...groundBase, x: target.x, z: target.z };
  const operation = freeze({ uid: c.pearl.uid, kind: c.pearl.kind,
    from: null, to: null, expectedVersion: 0, world: clock.worldId, ground, profiles: [] });
  const targetDrop = freeze({ ...snapshotDropData(target), ...clock.project(ground, 'pearl') });
  clock.assertDrop(targetDrop, 'pearl', ground);
  const plannedEvents = snapshotDropData(view.events), footprint = footprintAt(w, targetDrop);
  let applied = false, published = [];
  const assertCurrent = () => {
    assertDropContainers(w);
    if (host.server !== server || server.world !== w || host.worldState.id !== clock.worldId ||
        w.tick !== tick || w.map !== map || w.raftDeck !== raftDeck || w.ecs !== ecs || w.profiles !== profiles ||
        w.drops !== drops || w.pearlLedger !== ledger || w.profileDirty !== dirty || w.events !== events || w.emit !== emit ||
        w.nextDrop !== nextDrop || w.lootRng !== rng || rng.state() !== rngState || events.length !== eventCount ||
        events.some((e, i) => e !== eventRefs[i]) || !same(snapshotDropData(events), eventData) || drops.has(nextDrop) ||
        ledger.has(c.pearl.uid) || !same(snapshotDropData(tuning.world), worldTuning)) fail('cancelled');
    const de = [...Map.prototype.entries.call(drops)], le = [...Map.prototype.entries.call(ledger)], pe = [...Map.prototype.entries.call(profiles)];
    if (de.length !== originalDrops.length || de.some(([id, v], i) => id !== originalDrops[i][0] || v !== originalDrops[i][1] || !same(snapshotDropData(v), dropData[i][1])) ||
        le.length !== originalLedger.length || le.some(([id, v], i) => id !== originalLedger[i][0] || v !== originalLedger[i][1] || !same(snapshotDropData(v), ledgerData[i][1])) ||
        pe.length !== originalProfiles.length || pe.some(([id, v], i) => id !== originalProfiles[i][0] || v !== originalProfiles[i][1] || !same(snapshotDropData(v), profileData[i][1]))) fail('cancelled');
    const ds = [...Set.prototype.values.call(dirty)];
    if (ds.length !== originalDirty.length || ds.some((v, i) => v !== originalDirty[i])) fail('cancelled');
    const now = [map.groundAt, map.onDock, map.queryColliders, map.zoneAt, map.half, map.colliders, map.landmarks];
    if (now.some((v, i) => v !== geometry[i]) || !same(footprintAt(w, targetDrop), footprint)) fail('cancelled');
    for (const p of Map.prototype.values.call(profiles)) if (profilePearlUids(p).includes(c.pearl.uid)) fail('ownership');
    for (const [, d] of de) if (snapshotDropData(d)?.pearl?.uid === c.pearl.uid) fail('ownership');
    return true;
  };
  const rollback = () => {
    if (events.length > eventCount) while (events.length > eventCount) Array.prototype.pop.call(events);
    if (drops.has(targetDrop.id) && Map.prototype.get.call(drops, targetDrop.id)?.id === targetDrop.id) Map.prototype.delete.call(drops, targetDrop.id);
    Map.prototype.clear.call(drops); for (const [id, d] of originalDrops) Map.prototype.set.call(drops, id, d);
    if (ledger.get(c.pearl.uid)?.drop === targetDrop.id) Map.prototype.delete.call(ledger, c.pearl.uid);
    Map.prototype.clear.call(ledger); for (const [id, d] of originalLedger) Map.prototype.set.call(ledger, id, d);
    if (w.nextDrop === nextDrop + 1) w.nextDrop = nextDrop;
    applied = false;
  };
  const apply = rawEffect => {
    if (applied) fail('effect');
    assertCurrent();
    const checked = checkedGroundResult(snapshotDropData(rawEffect), operation);
    if (!checked.ok || checked.replay || checked.location.version !== 1 || checked.location.uid !== c.pearl.uid ||
        checked.location.world !== clock.worldId || !same(checked.location.ground, ground)) fail('response');
    const publication = { ecs, events: [] };
    for (const event of plannedEvents) emit.call(publication, clone(event));
    published = snapshotDropData(publication.events);
    assertCurrent();
    if (eventCount + published.length > 4294967295) fail('effect');
    for (const key of ['nextDrop']) {
      const field = Object.getOwnPropertyDescriptor(w, key);
      if (!field || !Object.hasOwn(field, 'value') || !field.writable) fail('effect');
    }
    try {
      Map.prototype.set.call(drops, targetDrop.id, clone(targetDrop));
      Map.prototype.set.call(ledger, c.pearl.uid, { owner: '', entity: 0, place: 'ground', drop: targetDrop.id });
      w.nextDrop = nextDrop + 1;
      if (!same(snapshotDropData(Map.prototype.get.call(drops, targetDrop.id)), targetDrop) ||
          !same(snapshotDropData(Map.prototype.get.call(ledger, c.pearl.uid)),
            { owner: '', entity: 0, place: 'ground', drop: targetDrop.id }) || w.nextDrop !== nextDrop + 1 ||
          events.length !== eventCount || w.lootRng !== rng || rng.state() !== rngState) fail('effect');
      for (const event of published) Array.prototype.push.call(events, event);
      if (events.length !== eventCount + published.length || published.some((event, i) => events[eventCount + i] !== event)) fail('effect');
      applied = true; return true;
    } catch (error) { rollback(); throw error; }
  };
  assertCurrent();
  return { operation, targetDrop, assertCurrent, apply };
}
