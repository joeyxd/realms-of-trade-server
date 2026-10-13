// Synchronous, reversible projection for transferring one authenticated bag pearl.
import { isDeepStrictEqual } from 'node:util';
import { StoreError } from './store.mjs';
import { canonicalText, profilePearls } from './pearlOperations.mjs';
import { checkedGroundResult } from './pearlGround.mjs';
import { snapshotDropData, assertDropContainers } from './deathDropApply.mjs';
import { capturePearlProfile } from './pearlProfileSnapshot.mjs';
import { assertGroundDeadlineClock } from './groundDeadlineClock.mjs';
import { transferPearl } from '../src/sim/systems/pearls.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { sanitizePearl } from '../src/data/pearls.js';
import { C, KIND } from '../src/sim/ecs.js';

const clone = structuredClone;
const same = (a, b) => canonicalText(a) === canonicalText(b);
const fail = code => { throw new StoreError(code); };
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function columns(ecs, entity) {
  return Object.entries(ecs).filter(([, value]) => ArrayBuffer.isView(value) && !(value instanceof DataView))
    .map(([key, column]) => ({ key, column, value: column[entity] }));
}
function ecsSnapshot(ecs) {
  return Object.entries(ecs).map(([key, value]) => ({ key, value, content: clone(value) }));
}
function matchesEcs(ecs, snapshot) {
  return snapshot.every(item => ecs[item.key] === item.value && isDeepStrictEqual(item.value, item.content));
}

function row(raw, uid) {
  const value = snapshotDropData(raw);
  if (!value || Object.keys(value).sort().join(',') !== 'holder,kind,uid,version' || value.uid !== uid ||
      typeof value.kind !== 'string' || typeof value.holder !== 'string' || !Number.isSafeInteger(value.version) ||
      value.version < 1 || value.version >= 2147483647) fail('operation');
  return value;
}

function endpoint(host, raw, allowPending) {
  const value = snapshotDropData(raw);
  if (!value || Object.keys(value).sort().join(',') !== 'clientId,entity') fail('operation');
  const { clientId, entity } = value, server = host.server, w = server.world, ecs = w.ecs;
  const client = server.clients.get(clientId), session = host.profiles.clients.get(clientId), profile = w.profiles.get(entity);
  if (!Number.isSafeInteger(clientId) || clientId < 1 || !Number.isInteger(entity) || entity < 1 || entity >= ecs.cap ||
      !client?.serverProfile || client.paused || client.entity !== entity || !session || session.id !== clientId ||
      host.profiles.accounts.get(session.key) !== session || typeof session.key !== 'string' ||
      session.closed || session.failed || (!allowPending && (session.pending || session.running)) || session.pearlBusy ||
      !Number.isSafeInteger(session.version) || session.version < 1 || ecs.clientId[entity] !== clientId ||
      !ecs.alive[entity] || ecs.dead[entity] > 0 || ecs.kind[entity] !== KIND.PLAYER || !(ecs.mask[entity] & C.PLAYER) ||
      profile?.pirateId !== `account:${session.key}`) fail('session');
  return { clientId, entity, client, session, profile, account: session.key };
}

export function prepareGroundPearlGive({ host, deadlineClock, source, receiver, uid, row: rawRow, preflight = false }) {
  const r = row(rawRow, uid), server = host?.server, world = server?.world, sessions = host?.profiles;
  if (!world || !sessions || !host.worldState?.id || typeof uid !== 'string') fail('operation');
  const clock = assertGroundDeadlineClock(deadlineClock, host.worldState.id);
  if (typeof preflight !== 'boolean') fail('operation');
  const from = endpoint(host, source, preflight), to = endpoint(host, receiver, preflight), ecs = world.ecs;
  if (from.entity === to.entity || from.clientId === to.clientId || from.account === to.account) fail('session');
  if (from.account !== r.holder) fail('ownership');
  assertDropContainers(world);

  const endpoints = [from, to].sort((a, b) => order(a.account, b.account));
  const before = new Map(endpoints.map(ep => [ep.entity, capturePearlProfile(world, ep.entity)]));
  for (const ep of endpoints) {
    const profile = before.get(ep.entity);
    if (!same(snapshotDropData(ep.profile), sanitizeProfile(snapshotDropData(ep.profile))) ||
        !same(profile, sanitizeProfile(profile))) fail('profile');
  }
  const pearl = before.get(from.entity).pearls.bag.find(item => item.uid === uid);
  if (!pearl || pearl.kind !== r.kind || !same(sanitizePearl(pearl), pearl) ||
      before.get(from.entity).pearls.swallowed?.uid === uid) fail('ownership');
  for (const ep of endpoints) {
    const owned = profilePearls(before.get(ep.entity)), owner = ep.profile.pirateId;
    for (const item of owned) if (!same(world.pearlLedger.get(item.uid), { owner, entity: ep.entity, place: 'profile' })) fail('ownership');
    for (const [key, entry] of world.pearlLedger) if (entry.place === 'profile' &&
        (entry.owner === owner || entry.entity === ep.entity) && !owned.some(item => item.uid === key)) fail('ownership');
  }
  for (const [key, entry] of world.pearlLedger) if (key === uid &&
      !same(entry, { owner: from.profile.pirateId, entity: from.entity, place: 'profile' })) fail('ownership');
  if (!same(world.pearlLedger.get(uid), { owner: from.profile.pirateId, entity: from.entity, place: 'profile' })) fail('ownership');
  for (const [, drop] of world.drops) if (snapshotDropData(drop)?.pearl?.uid === uid) fail('ownership');
  for (const [entity, profile] of world.profiles) if (!endpoints.some(ep => ep.entity === entity) &&
      profilePearls(snapshotDropData(profile)).some(item => item.uid === uid)) fail('ownership');

  const viewProfiles = new Map(endpoints.map(ep => [ep.entity, clone(before.get(ep.entity))]));
  const ledgerRows = [...Map.prototype.entries.call(world.pearlLedger)];
  const viewLedger = new Map(ledgerRows.map(([key, value]) => [key, clone(value)]));
  const view = { tick: world.tick, ecs: clone(ecs), profiles: viewProfiles, pearlLedger: viewLedger,
    profileDirty: new Set(), events: [], emit(event) { this.events.push(clone(event)); } };
  if (!transferPearl(view, from.entity, uid, to.entity)) fail(view.events.at(-1)?.why || 'ownership');

  const after = new Map(endpoints.map(ep => [ep.entity, snapshotDropData(viewProfiles.get(ep.entity))]));
  for (const ep of endpoints) if (!same(after.get(ep.entity), sanitizeProfile(after.get(ep.entity)))) fail('profile');
  if (viewLedger.get(uid)?.owner !== to.profile.pirateId || viewLedger.get(uid)?.entity !== to.entity ||
      viewLedger.get(uid)?.place !== 'profile' || viewLedger.get(uid)?.drop !== undefined) fail('effect');
  const operation = freezeDeep({
    uid, kind: pearl.kind, from: from.account, to: to.account, expectedVersion: r.version,
    world: clock.worldId, ground: null,
    profiles: endpoints.map(ep => ({ id: ep.account, expectedVersion: ep.session.version, data: clone(after.get(ep.entity)) }))
      .sort((a, b) => order(a.id, b.id)),
  });
  const plannedEvents = snapshotDropData(view.events);

  const allProfiles = [...Map.prototype.entries.call(world.profiles)];
  const profileData = allProfiles.map(([entity, value]) => [entity, snapshotDropData(value)]);
  const allLedger = [...Map.prototype.entries.call(world.pearlLedger)];
  const ledgerData = allLedger.map(([key, value]) => [key, snapshotDropData(value)]);
  const dirtyRows = [...Set.prototype.values.call(world.profileDirty)];
  const eventRefs = [...world.events], eventData = snapshotDropData(world.events);
  const ecsState = ecsSnapshot(ecs);
  const dropRows = [...Map.prototype.entries.call(world.drops)], dropData = snapshotDropData(dropRows);
  const dropRefs = [...world.drops.entries()];
  const nextDrop = world.nextDrop, nextDropDescriptor = Object.getOwnPropertyDescriptor(world, 'nextDrop');
  const nextPearl = world.nextPearl;
  if (!Number.isSafeInteger(nextDrop) || nextDrop < 1 || !nextDropDescriptor ||
      !Object.hasOwn(nextDropDescriptor, 'value') || !nextDropDescriptor.writable) fail('effect');
  const rng = world.rng, rngState = rng?.state?.(), lootRng = world.lootRng, lootRngState = lootRng?.state?.();
  const sessionState = endpoints.map(ep => ({ ep, version: ep.session.version, confirmed: clone(ep.session.confirmed),
    last: ep.session.last, closed: ep.session.closed, failed: ep.session.failed }));
  const baseline = { tick: world.tick, ecs, profiles: world.profiles, drops: world.drops, ledger: world.pearlLedger,
    dirty: world.profileDirty, events: world.events, emit: world.emit, profileRefs: allProfiles,
    ledgerRefs: allLedger, dirtyRows, eventRefs, eventData, ecsState, sessions: sessionState,
    hostProfiles: host.profiles, nextDrop, nextDropDescriptor };
  let applied = false;

  const assertBaseline = () => {
    assertDropContainers(world);
    if (applied || host.server !== server || host.profiles !== baseline.hostProfiles || server.world !== world || world.tick !== baseline.tick || world.ecs !== ecs ||
        world.profiles !== baseline.profiles || world.pearlLedger !== baseline.ledger ||
        world.drops !== baseline.drops || world.profileDirty !== baseline.dirty || world.events !== baseline.events || world.emit !== baseline.emit ||
        world.drops.size !== dropRows.length || world.nextPearl !== nextPearl || !same(snapshotDropData([...world.drops]), dropData) ||
        [...world.drops.entries()].some(([key, value], i) => key !== dropRefs[i][0] || value !== dropRefs[i][1]) ||
        world.nextDrop !== nextDrop || Object.getOwnPropertyDescriptor(world, 'nextDrop')?.value !== nextDropDescriptor?.value ||
        Object.getOwnPropertyDescriptor(world, 'nextDrop')?.writable !== nextDropDescriptor?.writable ||
        Object.getOwnPropertyDescriptor(world, 'nextDrop')?.configurable !== nextDropDescriptor?.configurable ||
        Object.getOwnPropertyDescriptor(world, 'nextDrop')?.enumerable !== nextDropDescriptor?.enumerable) fail('cancelled');
    if (world.rng !== rng || rng?.state?.() !== rngState || world.lootRng !== lootRng || lootRng?.state?.() !== lootRngState) fail('cancelled');
    if (!matchesEcs(ecs, ecsState)) fail('cancelled');
    if (!same(snapshotDropData(world.events), eventData) || world.events.length !== eventRefs.length ||
        world.events.some((event, i) => event !== eventRefs[i])) fail('cancelled');
    const profilesNow = [...Map.prototype.entries.call(world.profiles)], ledgerNow = [...Map.prototype.entries.call(world.pearlLedger)];
    if (profilesNow.length !== allProfiles.length || profilesNow.some(([key, value], i) => key !== allProfiles[i][0] ||
        value !== allProfiles[i][1] || !same(snapshotDropData(value), profileData[i][1])) ||
        ledgerNow.length !== allLedger.length || ledgerNow.some(([key, value], i) => key !== allLedger[i][0] ||
        value !== allLedger[i][1] || !same(snapshotDropData(value), ledgerData[i][1]))) fail('cancelled');
    const dirtyNow = [...Set.prototype.values.call(world.profileDirty)];
    if (dirtyNow.length !== dirtyRows.length || dirtyNow.some((value, i) => value !== dirtyRows[i])) fail('cancelled');
    for (const { ep, closed, failed } of sessionState) if (sessions.clients.get(ep.clientId) !== ep.session ||
        sessions.accounts.get(ep.account) !== ep.session || server.clients.get(ep.clientId) !== ep.client ||
        ep.client.entity !== ep.entity || !ep.client.serverProfile || ep.profile !== world.profiles.get(ep.entity) ||
        ep.session.id !== ep.clientId || ep.session.key !== ep.account || ep.session.closed !== closed || ep.session.failed !== failed ||
        ep.client.paused || !ecs.alive[ep.entity] || ecs.dead[ep.entity] > 0 ||
        ep.profile.pirateId !== `account:${ep.account}`) fail('cancelled');
    return true;
  };
  const assertCurrent = () => {
    assertBaseline();
    for (const { ep, version, confirmed, last } of sessionState) if (ep.session.pending || ep.session.running ||
        ep.session.pearlBusy || ep.session.version !== version || !same(ep.session.confirmed, confirmed) || ep.session.last !== last) fail('cancelled');
    return true;
  };
  if (preflight) assertBaseline(); else assertCurrent();
  return { operation, assertBaseline, assertCurrent,
    apply(effect) {
      if (preflight) fail('cancelled');
      assertCurrent();
      const checked = checkedGroundResult(snapshotDropData(effect), operation);
      if (!checked.ok || checked.replay || checked.location.version !== r.version + 1 ||
          checked.location.world !== clock.worldId || checked.location.ground !== null) fail('response');
      const publication = { ecs, events: [] };
      for (const event of plannedEvents) baseline.emit.call(publication, clone(event));
      const emitted = snapshotDropData(publication.events);
      assertCurrent();
      if (baseline.events.length + emitted.length > 4294967295) fail('effect');
      const fields = endpoints.map(ep => ({ ep, values: Object.keys(after.get(ep.entity))
        .filter(key => !same(ep.profile[key], after.get(ep.entity)[key])).map(key => {
          const descriptor = Object.getOwnPropertyDescriptor(ep.profile, key);
          if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.writable) fail('effect');
          return { key, before: descriptor.value, after: clone(after.get(ep.entity)[key]) };
        }) }));
      for (const { ep } of fields) for (const key of ['version', 'confirmed', 'last']) {
        const descriptor = Object.getOwnPropertyDescriptor(ep.session, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.writable) fail('effect');
      }
      const count = world.events.length, changedDirty = endpoints.filter(ep => !world.profileDirty.has(ep.entity));
      const wantedLedger = new Map(ledgerRows.map(([key, value]) => [key, clone(value)]));
      wantedLedger.set(uid, { owner: to.profile.pirateId, entity: to.entity, place: 'profile' });
      const wantedDirty = [...dirtyRows];
      for (const ep of endpoints) if (!wantedDirty.includes(ep.entity)) wantedDirty.push(ep.entity);
      let started = false;
      try {
        started = true;
        for (const { ep, values } of fields) for (const field of values) ep.profile[field.key] = field.after;
        Map.prototype.set.call(world.pearlLedger, uid, { owner: to.profile.pirateId, entity: to.entity, place: 'profile' });
        for (const ep of endpoints) Set.prototype.add.call(world.profileDirty, ep.entity);
        for (const { ep } of fields) {
          const committed = checked.profiles.find(p => p.id === ep.account);
          ep.session.version = committed.version; ep.session.confirmed = clone(after.get(ep.entity));
          ep.session.last = JSON.stringify(after.get(ep.entity));
        }
        for (const { ep } of fields) if (!same(snapshotDropData(ep.profile), after.get(ep.entity))) fail('effect');
        for (const { ep } of fields) {
          const committed = checked.profiles.find(p => p.id === ep.account);
          if (ep.session.version !== committed.version || !same(ep.session.confirmed, after.get(ep.entity)) ||
              ep.session.last !== JSON.stringify(after.get(ep.entity))) fail('effect');
        }
        const ledgerNow = [...Map.prototype.entries.call(world.pearlLedger)];
        if (ledgerNow.length !== wantedLedger.size || ledgerNow.some(([key, value], i) => {
            const expected = [...wantedLedger.entries()][i];
            return key !== expected?.[0] || !same(value, expected?.[1]);
          }) || [...Set.prototype.values.call(world.profileDirty)].length !== wantedDirty.length ||
            [...Set.prototype.values.call(world.profileDirty)].some((value, i) => value !== wantedDirty[i]) ||
            world.drops !== baseline.drops || world.drops.size !== dropRefs.length ||
            [...world.drops.entries()].some(([key, value], i) => key !== dropRefs[i][0] || value !== dropRefs[i][1]) ||
            !same(snapshotDropData([...world.drops]), dropData) || world.nextPearl !== nextPearl || world.nextDrop !== baseline.nextDrop ||
            Object.getOwnPropertyDescriptor(world, 'nextDrop')?.value !== nextDropDescriptor.value ||
            Object.getOwnPropertyDescriptor(world, 'nextDrop')?.writable !== nextDropDescriptor.writable ||
            Object.getOwnPropertyDescriptor(world, 'nextDrop')?.configurable !== nextDropDescriptor.configurable ||
            Object.getOwnPropertyDescriptor(world, 'nextDrop')?.enumerable !== nextDropDescriptor.enumerable ||
            !matchesEcs(ecs, ecsState) || world.rng !== rng || rng?.state?.() !== rngState ||
            world.lootRng !== lootRng || lootRng?.state?.() !== lootRngState) fail('effect');
        Array.prototype.push.call(world.events, ...emitted);
        if (!isDeepStrictEqual(world.events.slice(count), emitted) || world.events.length !== count + emitted.length ||
            eventRefs.some((event, i) => world.events[i] !== event) ||
            !same(snapshotDropData(world.events.slice(0, count)), eventData)) fail('effect');
        applied = true; return true;
      } catch (error) {
        if (started) {
          baseline.events.length = count;
          Map.prototype.clear.call(baseline.ledger);
          for (const [key, value] of baseline.ledgerRefs) Map.prototype.set.call(baseline.ledger, key, value);
          for (const { ep, values } of fields) for (const field of values) if (ep.profile[field.key] === field.after) ep.profile[field.key] = field.before;
          for (const ep of changedDirty) Set.prototype.delete.call(baseline.dirty, ep.entity);
          for (const { ep, version, confirmed, last } of sessionState) {
            ep.session.version = version; ep.session.confirmed = confirmed; ep.session.last = last;
          }
        }
        throw error;
      }
    },
  };
}
