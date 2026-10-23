// Synchronous, reversible projection for leaving one authenticated bag pearl.
import { isDeepStrictEqual } from 'node:util';
import { StoreError } from './store.mjs';
import { canonicalText, profilePearls } from './pearlOperations.mjs';
import { checkedGroundResult } from './pearlGround.mjs';
import { snapshotDropData, assertDropContainers } from './deathDropApply.mjs';
import { capturePearlProfile } from './pearlProfileSnapshot.mjs';
import { assertGroundDeadlineClock } from './groundDeadlineClock.mjs';
import { leavePearl } from '../src/sim/systems/pearls.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { sanitizePearl } from '../src/data/pearls.js';
import { KIND, C } from '../src/sim/ecs.js';
import { PEARL } from '../src/data/pearls.js';
import { DT, tuning } from '../src/data/tuning.js';
import { canStand } from '../src/sim/systems/movement.js';

const clone = structuredClone;
const same = (a, b) => canonicalText(a) === canonicalText(b);
const fail = code => { throw new StoreError(code); };

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function pearlRow(raw, uid) {
  const row = snapshotDropData(raw);
  if (!row || Object.keys(row).sort().join(',') !== 'holder,kind,uid,version' ||
      row.uid !== uid || typeof row.kind !== 'string' || typeof row.holder !== 'string' ||
      !Number.isSafeInteger(row.version) || row.version < 1 || row.version >= 2147483647) fail('operation');
  return freezeDeep(row);
}

function ecsColumns(ecs, entity) {
  return Object.entries(ecs)
    .filter(([, value]) => ArrayBuffer.isView(value) && !(value instanceof DataView))
    .map(([key, column]) => ({ key, column, value: column[entity] }));
}

function ecsSnapshot(ecs) {
  return Object.entries(ecs).map(([key, value]) => ({
    key,
    value,
    content: clone(value),
  }));
}

function matchesEcsSnapshot(ecs, snapshot) {
  return snapshot.every(value => ecs[value.key] === value.value &&
    isDeepStrictEqual(value.value, value.content));
}

function geometrySnapshot(map) {
  const refs = [map?.groundAt, map?.onDock, map?.queryColliders, map?.zoneAt,
    map?.half, map?.colliders, map?.landmarks];
  const data = snapshotDropData({ half: map?.half, colliders: map?.colliders, landmarks: map?.landmarks });
  return { refs, data };
}

function footprintAt(world, drop) {
  const map = world.map;
  return {
    standable: canStand(world, drop.x, drop.z, 0.2),
    height: map.groundAt(drop.x, drop.z),
    dock: !!map.onDock(drop.x, drop.z),
    zone: map.zoneAt?.(drop.x, drop.z)?.name || 'la playa',
  };
}

export function prepareGroundPearlLeave({ host, deadlineClock, source, uid, row: rawRow }) {
  const row = pearlRow(rawRow, uid);
  const server = host?.server;
  const world = server?.world;
  const sessions = host?.profiles;
  if (!world || !sessions) fail('operation');

  const clock = assertGroundDeadlineClock(deadlineClock, host.worldState.id);
  const selector = snapshotDropData(source);
  if (!selector || Object.keys(selector).sort().join(',') !== 'clientId,entity' ||
      typeof uid !== 'string') fail('operation');

  const { clientId, entity } = selector;
  const ecs = world.ecs;
  const client = server.clients.get(clientId);
  const session = sessions.clients.get(clientId);
  const liveProfile = world.profiles.get(entity);
  if (!Number.isSafeInteger(clientId) || clientId < 1 || !Number.isInteger(entity) ||
      entity < 1 || entity >= ecs.cap || !client?.serverProfile || client.entity !== entity ||
      !session || session.id !== clientId || sessions.accounts.get(session.key) !== session ||
      session.key !== row.holder || session.closed || session.failed || session.pending ||
      session.running || session.pearlBusy || !Number.isSafeInteger(session.version) || session.version < 1 ||
      ecs.clientId[entity] !== clientId || !ecs.alive[entity] || ecs.dead[entity] > 0 ||
      ecs.kind[entity] !== KIND.PLAYER || !(ecs.mask[entity] & C.PLAYER) ||
      liveProfile?.pirateId !== `account:${session.key}`) fail('session');

  assertDropContainers(world);
  const rawProfile = snapshotDropData(liveProfile);
  if (!same(rawProfile, sanitizeProfile(rawProfile))) fail('profile');
  const before = capturePearlProfile(world, entity);
  if (!same(before, sanitizeProfile(before))) fail('profile');

  const pearl = before.pearls.bag.find(value => value.uid === uid);
  if (!pearl || pearl.kind !== row.kind || !same(sanitizePearl(pearl), pearl)) fail('ownership');
  const owner = liveProfile.pirateId;
  const owned = profilePearls(before);
  for (const value of owned) {
    if (!same(world.pearlLedger.get(value.uid), { owner, entity, place: 'profile' })) fail('ownership');
  }
  for (const [key, entry] of world.pearlLedger) {
    if (entry.place === 'profile' && (entry.owner === owner || entry.entity === entity) &&
        !owned.some(value => value.uid === key)) fail('ownership');
  }
  for (const [, drop] of world.drops) {
    if (snapshotDropData(drop)?.pearl?.uid === uid) fail('ownership');
  }
  for (const [otherEntity, profile] of world.profiles) {
    if (otherEntity !== entity && profilePearls(snapshotDropData(profile)).some(value => value.uid === uid)) {
      fail('ownership');
    }
  }
  const sourceLedger = world.pearlLedger.get(uid);
  if (!same(sourceLedger, { owner, entity, place: 'profile' })) fail('ownership');

  const allocator = Object.getOwnPropertyDescriptor(world, 'nextDrop');
  if (!Number.isSafeInteger(world.nextDrop) || world.nextDrop < 1 ||
      world.nextDrop >= Number.MAX_SAFE_INTEGER || world.drops.has(world.nextDrop) ||
      !allocator || !Object.hasOwn(allocator, 'value') || !allocator.writable) fail('effect');
  if (typeof world.lootRng !== 'function' || typeof world.lootRng.state !== 'function') fail('effect');
  const rng = world.lootRng;
  const rngState = rng.state();
  if (!Number.isInteger(rngState) || rngState < 0 || rngState > 0xffffffff) fail('effect');

  const detachedProfile = clone(before);
  const view = {
    tick: world.tick,
    ecs: clone(ecs),
    map: world.map,
    raftDeck: world.raftDeck,
    nextDrop: world.nextDrop,
    drops: new Map(),
    pearlLedger: new Map([[uid, clone(sourceLedger)]]),
    profiles: new Map([[entity, detachedProfile]]),
    profileDirty: new Set(),
    events: [],
    emit(event) { this.events.push(clone(event)); },
  };
  if (!leavePearl(view, entity, uid)) fail(view.events.at(-1)?.why || 'ownership');

  const after = snapshotDropData(view.profiles.get(entity));
  const projectedDrop = [...view.drops.values()][0];
  if (!same(after, sanitizeProfile(after)) || !projectedDrop || projectedDrop.id !== world.nextDrop ||
      view.drops.size !== 1 || view.nextDrop !== world.nextDrop + 1 ||
      view.pearlLedger.get(uid)?.place !== 'ground' || view.pearlLedger.get(uid)?.drop !== projectedDrop.id) fail('effect');

  const ground = {
    x: projectedDrop.x,
    z: projectedDrop.z,
    availableAt: clock.at(world.tick + 30),
    returnAt: clock.at(world.tick + Math.round(PEARL.returnAfter / DT)),
  };
  const operation = freezeDeep({
    uid,
    kind: pearl.kind,
    from: session.key,
    to: null,
    expectedVersion: row.version,
    world: clock.worldId,
    ground,
    profiles: [{ id: session.key, expectedVersion: session.version, data: clone(after) }],
  });
  const targetDrop = freezeDeep({ ...snapshotDropData(projectedDrop), ...clock.project(ground, 'pearl') });
  clock.assertDrop(targetDrop, 'pearl', ground);
  const targetFootprint = footprintAt(world, targetDrop);
  const plannedEvents = snapshotDropData(view.events);

  const ecsState = ecsSnapshot(ecs);
  const geometry = geometrySnapshot(world.map);
  const worldTuning = snapshotDropData(tuning.world);
  const profileRows = [...Map.prototype.entries.call(world.profiles)];
  const profileData = profileRows.map(([key, value]) => [key, snapshotDropData(value)]);
  const ledgerRows = [...Map.prototype.entries.call(world.pearlLedger)];
  const ledgerData = ledgerRows.map(([key, value]) => [key, snapshotDropData(value)]);
  const dirtyRows = [...Set.prototype.values.call(world.profileDirty)];
  const eventRefs = [...world.events];
  const baseline = {
    tick: world.tick,
    version: session.version,
    confirmed: clone(session.confirmed),
    last: session.last,
    ecs,
    ecsState,
    columns: ecsColumns(ecs, entity),
    profiles: world.profiles,
    profile: liveProfile,
    profileData: snapshotDropData(liveProfile),
    profileRows,
    profileDataRows: profileData,
    drops: world.drops,
    dropRows: [...Map.prototype.entries.call(world.drops)],
    dropData: snapshotDropData([...world.drops]),
    ledger: world.pearlLedger,
    ledgerRows,
    ledgerDataRows: ledgerData,
    ledgerData: snapshotDropData([...world.pearlLedger]),
    dirty: world.profileDirty,
    dirtyRows,
    dirtyHad: world.profileDirty.has(entity),
    events: world.events,
    eventRefs,
    eventData: snapshotDropData(world.events),
    nextDrop: world.nextDrop,
    allocator,
    rng,
    rngState,
    map: world.map,
    geometry,
    raftDeck: world.raftDeck,
    emit: world.emit,
    session,
    client,
  };
  let applied = false;

  const assertBaseline = () => {
    assertDropContainers(world);
    if (applied || host.server !== server || server.world !== world || world.tick !== baseline.tick ||
        world.ecs !== ecs || world.profiles !== baseline.profiles || world.drops !== baseline.drops ||
        world.pearlLedger !== baseline.ledger || world.profileDirty !== baseline.dirty ||
        world.events !== baseline.events || world.nextDrop !== baseline.nextDrop || world.map !== baseline.map ||
        world.raftDeck !== baseline.raftDeck || world.emit !== baseline.emit || world.lootRng !== baseline.rng ||
        sessions.clients.get(clientId) !== session || sessions.accounts.get(session.key) !== session ||
        server.clients.get(clientId) !== client || client.entity !== entity || !client.serverProfile ||
        session.closed || session.failed || world.profiles.get(entity) !== liveProfile ||
        !same(snapshotDropData(liveProfile), baseline.profileData) ||
        !same(capturePearlProfile(world, entity), before) ||
        ecsColumns(ecs, entity).length !== baseline.columns.length ||
        ecsColumns(ecs, entity).some((column, i) => column.column !== baseline.columns[i].column ||
          !Object.is(column.value, baseline.columns[i].value)) ||
        !matchesEcsSnapshot(ecs, ecsState) ||
        !same(snapshotDropData([...world.drops]), baseline.dropData) ||
        !same(snapshotDropData([...world.pearlLedger]), baseline.ledgerData) ||
        !same(snapshotDropData(world.events), baseline.eventData) ||
        world.profileDirty.has(entity) !== baseline.dirtyHad || world.lootRng !== rng || rng.state() !== rngState ||
        !same(snapshotDropData(tuning.world), worldTuning)) fail('cancelled');

    const geometryNow = geometrySnapshot(world.map);
    if (geometryNow.refs.some((value, i) => value !== geometry.refs[i]) || !same(geometryNow.data, geometry.data)) {
      fail('cancelled');
    }
    if (!same(footprintAt(world, targetDrop), targetFootprint)) fail('cancelled');
    const profilesNow = [...Map.prototype.entries.call(world.profiles)];
    if (profilesNow.length !== profileRows.length || profilesNow.some(([key, value], i) =>
        key !== profileRows[i][0] || value !== profileRows[i][1] ||
        !same(snapshotDropData(value), profileData[i][1]))) fail('cancelled');
    const ledgerNow = [...Map.prototype.entries.call(world.pearlLedger)];
    if (ledgerNow.length !== ledgerRows.length || ledgerNow.some(([key, value], i) =>
        key !== ledgerRows[i][0] || value !== ledgerRows[i][1] ||
        !same(snapshotDropData(value), ledgerData[i][1]))) fail('cancelled');
    const dirtyNow = [...Set.prototype.values.call(world.profileDirty)];
    if (dirtyNow.length !== dirtyRows.length || dirtyNow.some((value, i) => value !== dirtyRows[i]) ||
        world.events.length !== eventRefs.length || world.events.some((event, i) => event !== eventRefs[i])) {
      fail('cancelled');
    }
    const dropsNow = [...Map.prototype.entries.call(world.drops)];
    if (dropsNow.length !== baseline.dropRows.length || dropsNow.some(([key, value], i) =>
        key !== baseline.dropRows[i][0] || value !== baseline.dropRows[i][1])) fail('cancelled');
    return true;
  };

  const assertCurrent = () => {
    assertBaseline();
    if (session.pending || session.running || session.pearlBusy || session.version !== baseline.version ||
        !same(session.confirmed, baseline.confirmed) || session.last !== baseline.last) fail('cancelled');
    return true;
  };
  assertCurrent();

  return {
    operation,
    targetDrop,
    assertBaseline,
    assertCurrent,
    apply(effect) {
      assertCurrent();
      const checked = checkedGroundResult(snapshotDropData(effect), operation);
      if (!checked.ok || checked.replay || checked.location.version !== row.version + 1 ||
          checked.location.world !== clock.worldId || !same(checked.location.ground, ground)) fail('response');

      const publication = { ecs, events: [] };
      for (const event of plannedEvents) baseline.emit.call(publication, clone(event));
      const emitted = snapshotDropData(publication.events);
      assertCurrent();
      if (baseline.events.length + emitted.length > 4294967295) fail('effect');

      const fields = Object.keys(after).filter(key => !same(liveProfile[key], after[key])).map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(liveProfile, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.writable) fail('effect');
        return { key, before: descriptor.value, after: clone(after[key]) };
      });
      for (const key of ['version', 'confirmed', 'last']) {
        const descriptor = Object.getOwnPropertyDescriptor(session, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.writable) fail('effect');
      }
      const currentAllocator = Object.getOwnPropertyDescriptor(world, 'nextDrop');
      if (!currentAllocator || !Object.hasOwn(currentAllocator, 'value') || !currentAllocator.writable ||
          world.nextDrop !== baseline.nextDrop || world.drops.has(targetDrop.id)) fail('cancelled');

      const nextLedger = { owner: '', entity: 0, place: 'ground', drop: targetDrop.id };
      const nextConfirmed = clone(after);
      const nextLast = JSON.stringify(after);
      const eventCount = world.events.length;
      let started = false;
      try {
        started = true;
        for (const field of fields) liveProfile[field.key] = field.after;
        Map.prototype.set.call(world.drops, targetDrop.id, clone(targetDrop));
        Map.prototype.set.call(world.pearlLedger, uid, nextLedger);
        world.nextDrop = baseline.nextDrop + 1;
        Set.prototype.add.call(world.profileDirty, entity);
        session.version = baseline.version + 1;
        session.confirmed = nextConfirmed;
        session.last = nextLast;

        if (!same(snapshotDropData(liveProfile), after) ||
            !same(snapshotDropData(world.drops.get(targetDrop.id)), targetDrop) ||
            !same(world.pearlLedger.get(uid), nextLedger) || world.nextDrop !== baseline.nextDrop + 1 ||
            !world.profileDirty.has(entity) || session.version !== checked.profiles[0].version ||
            !same(session.confirmed, after) || session.last !== nextLast || world.events !== baseline.events ||
            world.ecs !== ecs || !matchesEcsSnapshot(ecs, ecsState) || world.lootRng !== rng ||
            rng.state() !== rngState) fail('effect');

        Array.prototype.push.call(world.events, ...emitted);
        if (!isDeepStrictEqual(world.events.slice(eventCount), emitted) ||
            world.events.length !== eventCount + emitted.length ||
            emitted.some((event, i) => world.events[eventCount + i] !== event)) fail('effect');
        applied = true;
        return true;
      } catch (error) {
        if (started) {
          baseline.events.length = eventCount;
          Map.prototype.clear.call(baseline.drops);
          for (const [key, value] of baseline.dropRows) Map.prototype.set.call(baseline.drops, key, value);
          Map.prototype.clear.call(baseline.ledger);
          for (const [key, value] of baseline.ledgerRows) Map.prototype.set.call(baseline.ledger, key, value);
          for (const field of fields) {
            if (liveProfile[field.key] === field.after) liveProfile[field.key] = field.before;
          }
          if (world.nextDrop === baseline.nextDrop + 1) world.nextDrop = baseline.nextDrop;
          if (!baseline.dirtyHad) Set.prototype.delete.call(baseline.dirty, entity);
          session.version = baseline.version;
          session.confirmed = baseline.confirmed;
          session.last = baseline.last;
        }
        throw error;
      }
    },
  };
}
