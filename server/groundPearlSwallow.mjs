// Detached same-holder pearl transition, applied reversibly after the common receipt.
import { isDeepStrictEqual } from 'node:util';
import { StoreError } from './store.mjs';
import { canonicalText, profilePearls } from './pearlOperations.mjs';
import { checkedGroundResult } from './pearlGround.mjs';
import { snapshotDropData, assertDropContainers } from './deathDropApply.mjs';
import { capturePearlProfile } from './pearlProfileSnapshot.mjs';
import { assertGroundDeadlineClock } from './groundDeadlineClock.mjs';
import { swallowPearl } from '../src/sim/systems/pearls.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { sanitizePearl } from '../src/data/pearls.js';
import { PEARL_ACTION_BUFFERS, preparePearlInputs } from '../src/net/pearlInputBoundary.js';
import { tuning } from '../src/data/tuning.js';
import { C, KIND } from '../src/sim/ecs.js';

const clone = structuredClone;
const same = (a, b) => canonicalText(a) === canonicalText(b);
const fail = code => { throw new StoreError(code); };
function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

export function prepareGroundPearlSwallow({ host, deadlineClock, source, uid, row: rawRow, preflight = false }) {
  const row = snapshotDropData(rawRow), selector = snapshotDropData(source);
  const server = host?.server, world = server?.world, sessions = host?.profiles;
  if (!world || !sessions || typeof uid !== 'string' || typeof preflight !== 'boolean' ||
      !row || Object.keys(row).sort().join(',') !== 'holder,kind,uid,version' || row.uid !== uid ||
      typeof row.kind !== 'string' || typeof row.holder !== 'string' ||
      !Number.isSafeInteger(row.version) || row.version < 1 || row.version >= 2147483647 ||
      !selector || Object.keys(selector).sort().join(',') !== 'clientId,entity') fail('operation');
  const clock = assertGroundDeadlineClock(deadlineClock, host.worldState?.id);
  const { clientId, entity } = selector, ecs = world.ecs, client = server.clients.get(clientId);
  const session = sessions.clients.get(clientId), liveProfile = world.profiles.get(entity);
  if (!Number.isSafeInteger(clientId) || clientId < 1 || !Number.isInteger(entity) || entity < 1 || entity >= ecs.cap ||
      !client?.serverProfile || client.paused || client.entity !== entity || !session || session.id !== clientId ||
      sessions.accounts.get(session.key) !== session || typeof session.key !== 'string' ||
      session.closed || session.failed || (!preflight && (session.pending || session.running)) || session.pearlBusy ||
      !Number.isSafeInteger(session.version) || session.version < 1 || session.version >= 2147483647 ||
      ecs.clientId[entity] !== clientId || !ecs.alive[entity] || ecs.dead[entity] > 0 ||
      ecs.kind[entity] !== KIND.PLAYER || !(ecs.mask[entity] & C.PLAYER) ||
      liveProfile?.pirateId !== `account:${session.key}`) fail('session');
  const account = session.key;
  if (row.holder !== account) fail('ownership');
  assertDropContainers(world);
  const before = capturePearlProfile(world, entity);
  if (!same(snapshotDropData(liveProfile), sanitizeProfile(snapshotDropData(liveProfile))) ||
      !same(before, sanitizeProfile(before))) fail('profile');
  if (before.pearls.swallowed !== null) fail('bound');
  const pearl = before.pearls.bag.find(item => item.uid === uid);
  if (!pearl || pearl.kind !== row.kind || !same(sanitizePearl(pearl), pearl)) fail('ownership');
  const ledger = { owner: liveProfile.pirateId, entity, place: 'profile' }, owned = profilePearls(before);
  for (const item of owned) if (!same(world.pearlLedger.get(item.uid), ledger)) fail('ownership');
  for (const [key, entry] of world.pearlLedger) if (entry.place === 'profile' &&
      (entry.owner === ledger.owner || entry.entity === entity) && !owned.some(item => item.uid === key)) fail('ownership');
  for (const [, drop] of world.drops) if (snapshotDropData(drop)?.pearl?.uid === uid) fail('ownership');
  for (const [otherEntity, profile] of world.profiles) if (otherEntity !== entity &&
      profilePearls(snapshotDropData(profile)).some(item => item.uid === uid)) fail('ownership');

  const view = { tick: world.tick, ecs: clone(ecs), profiles: new Map([[entity, clone(before)]]),
    profileDirty: new Set(), events: [], emit(event) { this.events.push(clone(event)); } };
  if (!swallowPearl(view, entity, uid)) fail(view.events.at(-1)?.why || 'ownership');
  for (const key of PEARL_ACTION_BUFFERS) view.ecs[key][entity] = 0;
  const after = snapshotDropData(view.profiles.get(entity));
  if (!same(after, sanitizeProfile(after)) || view.events.length !== 1 ||
      view.events[0].type !== 'pearlChanged' || view.events[0].op !== 'swallow') fail('effect');
  const operation = freezeDeep({ uid, kind: pearl.kind, from: account, to: account,
    expectedVersion: row.version, world: clock.worldId, ground: null,
    profiles: [{ id: account, expectedVersion: session.version, data: clone(after) }] });
  const plannedEvents = snapshotDropData(view.events);
  const ecsState = Object.entries(ecs).map(([key, value]) => ({ key, value, content: clone(value) }));
  const changes = ecsState.filter(item => ArrayBuffer.isView(item.value) && !(item.value instanceof DataView) &&
    !Object.is(item.value[entity], view.ecs[item.key][entity])).map(item => ({
      key: item.key, column: item.value, before: item.value[entity], after: view.ecs[item.key][entity] }));
  const matchesEcs = expected => Object.keys(ecs).length === ecsState.length &&
    ecsState.every(item => ecs[item.key] === item.value && isDeepStrictEqual(item.value, expected[item.key]));
  const originalEcs = Object.fromEntries(ecsState.map(item => [item.key, item.content]));
  const profileRows = [...world.profiles], profileData = snapshotDropData(profileRows);
  const ledgerRows = [...world.pearlLedger], ledgerData = snapshotDropData(ledgerRows);
  const dropRows = [...world.drops], dropData = snapshotDropData(dropRows);
  const dirtyRows = [...world.profileDirty], eventRefs = [...world.events], eventData = snapshotDropData(world.events);
  const rng = world.rng, rngState = rng?.state?.(), lootRng = world.lootRng, lootRngState = lootRng?.state?.();
  const tuningData = snapshotDropData(tuning);
  const baseline = { tick: world.tick, ecs, hostProfiles: sessions, profiles: world.profiles,
    ledger: world.pearlLedger, drops: world.drops, dirty: world.profileDirty, events: world.events, emit: world.emit,
    nextDrop: world.nextDrop, nextPearl: world.nextPearl, map: world.map, raftDeck: world.raftDeck,
    version: session.version, confirmed: clone(session.confirmed), last: session.last,
    clients: server.clients, sessionClients: sessions.clients, accounts: sessions.accounts,
    applyBoundary: server.assertDropApplyBoundary };
  let applied = false;
  const refsMatch = (current, rows) => current.length === rows.length &&
    current.every(([key, value], i) => key === rows[i][0] && value === rows[i][1]);
  const assertBaseline = () => {
    assertDropContainers(world);
    if (applied || host.server !== server || server.world !== world || host.profiles !== sessions ||
        server.clients !== baseline.clients || sessions.clients !== baseline.sessionClients || sessions.accounts !== baseline.accounts ||
        server.assertDropApplyBoundary !== baseline.applyBoundary ||
        world.tick !== baseline.tick || world.ecs !== ecs || world.profiles !== baseline.profiles ||
        world.pearlLedger !== baseline.ledger || world.drops !== baseline.drops || world.profileDirty !== baseline.dirty ||
        world.events !== baseline.events || world.emit !== baseline.emit || world.nextDrop !== baseline.nextDrop ||
        world.nextPearl !== baseline.nextPearl || world.map !== baseline.map || world.raftDeck !== baseline.raftDeck ||
        world.rng !== rng || rng?.state?.() !== rngState || world.lootRng !== lootRng || lootRng?.state?.() !== lootRngState ||
        !matchesEcs(originalEcs) || !same(snapshotDropData(tuning), tuningData) ||
        !refsMatch([...world.profiles], profileRows) || !same(snapshotDropData([...world.profiles]), profileData) ||
        !refsMatch([...world.pearlLedger], ledgerRows) || !same(snapshotDropData([...world.pearlLedger]), ledgerData) ||
        !refsMatch([...world.drops], dropRows) || !same(snapshotDropData([...world.drops]), dropData) ||
        !isDeepStrictEqual([...world.profileDirty], dirtyRows) || world.events.length !== eventRefs.length ||
        world.events.some((event, i) => event !== eventRefs[i]) || !same(snapshotDropData(world.events), eventData) ||
        sessions.clients.get(clientId) !== session || sessions.accounts.get(account) !== session ||
        server.clients.get(clientId) !== client || client.entity !== entity || !client.serverProfile || client.paused ||
        session.id !== clientId || session.key !== account || session.closed || session.failed ||
        world.profiles.get(entity) !== liveProfile || !same(capturePearlProfile(world, entity), before)) fail('cancelled');
    return true;
  };
  const assertCurrent = () => {
    assertBaseline();
    if (session.pending || session.running || session.pearlBusy || session.version !== baseline.version ||
        !same(session.confirmed, baseline.confirmed) || session.last !== baseline.last) fail('cancelled');
    return true;
  };
  if (preflight) assertBaseline(); else assertCurrent();
  return { operation, assertBaseline, assertCurrent,
    apply(effect) {
      if (preflight) fail('cancelled');
      server.assertDropApplyBoundary(); assertCurrent();
      const checked = checkedGroundResult(snapshotDropData(effect), operation);
      if (!checked.ok || checked.replay) fail('response');
      const inputs = preparePearlInputs(server, clientId, entity, () => server.assertDropApplyBoundary());
      // Decorate the existing event from the resulting detached ECS, never the old live element.
      const publication = { ecs: view.ecs, events: [] };
      for (const event of plannedEvents) baseline.emit.call(publication, clone(event));
      const emitted = snapshotDropData(publication.events);
      assertCurrent(); inputs.assertCurrent();
      const fields = Object.keys(after).filter(key => !same(liveProfile[key], after[key])).map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(liveProfile, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.writable) fail('effect');
        return { key, before: descriptor.value, after: clone(after[key]) };
      });
      for (const key of ['version', 'confirmed', 'last']) {
        const descriptor = Object.getOwnPropertyDescriptor(session, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.writable) fail('effect');
      }
      if (world.events.length + emitted.length > 4294967295) fail('effect');
      const count = world.events.length, dirtyHad = world.profileDirty.has(entity);
      const expectedProfiles = profileData.map(([key, data]) => [key, key === entity ? after : data]);
      let started = false;
      try {
        started = true;
        for (const field of fields) liveProfile[field.key] = field.after;
        for (const change of changes) change.column[entity] = change.after;
        inputs.apply(); inputs.assertApplied();
        Set.prototype.add.call(world.profileDirty, entity);
        session.version = checked.profiles[0].version;
        session.confirmed = clone(after); session.last = JSON.stringify(after);
        if (!same(snapshotDropData(liveProfile), after) || session.version !== baseline.version + 1 ||
            !same(session.confirmed, after) || session.last !== JSON.stringify(after) || !matchesEcs(view.ecs) ||
            world.ecs !== ecs || world.profiles !== baseline.profiles || world.pearlLedger !== baseline.ledger ||
            world.drops !== baseline.drops || world.profileDirty !== baseline.dirty ||
            !refsMatch([...world.profiles], profileRows) || !same(snapshotDropData([...world.profiles]), expectedProfiles) ||
            !refsMatch([...world.pearlLedger], ledgerRows) ||
            !same(snapshotDropData([...world.pearlLedger]), ledgerData) || !refsMatch([...world.drops], dropRows) ||
            !same(snapshotDropData([...world.drops]), dropData) || world.nextDrop !== baseline.nextDrop ||
            world.nextPearl !== baseline.nextPearl || world.events !== baseline.events ||
            !isDeepStrictEqual([...world.profileDirty], dirtyHad ? dirtyRows : [...dirtyRows, entity]) ||
            world.rng !== rng || rng?.state?.() !== rngState || world.lootRng !== lootRng || lootRng?.state?.() !== lootRngState) fail('effect');
        Array.prototype.push.call(world.events, ...emitted);
        if (!isDeepStrictEqual(world.events.slice(count), emitted) || world.events.length !== count + emitted.length ||
            eventRefs.some((event, i) => world.events[i] !== event) ||
            !same(snapshotDropData(world.events.slice(0, count)), eventData)) fail('effect');
        inputs.assertApplied(); applied = true; return true;
      } catch (error) {
        if (started) {
          baseline.events.length = count; inputs.rollback();
          for (const change of changes) change.column[entity] = change.before;
          for (const field of fields) if (liveProfile[field.key] === field.after) liveProfile[field.key] = field.before;
          if (!dirtyHad) Set.prototype.delete.call(baseline.dirty, entity);
          session.version = baseline.version; session.confirmed = baseline.confirmed; session.last = baseline.last;
        }
        throw error;
      }
    },
  };
}
