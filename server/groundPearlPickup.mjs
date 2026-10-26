// Synchronous, reversible pickup projection. The common authority owns reservation and SQL.
import { isDeepStrictEqual } from 'node:util';
import { StoreError } from './store.mjs';
import { canonicalText, profilePearls } from './pearlOperations.mjs';
import { checkedGroundResult } from './pearlGround.mjs';
import { snapshotDropData, assertDropContainers } from './deathDropApply.mjs';
import { capturePearlProfile } from './pearlProfileSnapshot.mjs';
import { assertGroundDeadlineClock } from './groundDeadlineClock.mjs';
import { pickPearl } from '../src/sim/systems/pearls.js';
import { sanitizeProfile } from '../src/sim/systems/inventory.js';
import { sanitizePearl } from '../src/data/pearls.js';
import { DROPS } from '../src/data/loot.js';
import { C, KIND } from '../src/sim/ecs.js';

const copy = structuredClone;
const same = (a, b) => canonicalText(a) === canonicalText(b);
const fail = code => { throw new StoreError(code); };
const columns = (ecs, entity) => Object.entries(ecs)
  .filter(([, c]) => ArrayBuffer.isView(c) && !(c instanceof DataView))
  .map(([key, column]) => ({ key, column, value: column[entity] }));

export function prepareGroundPearlPickup({ host, deadlineClock, dropId, receiver, row }) {
  const server = host.server, w = server.world, sessions = host.profiles;
  const clock = assertGroundDeadlineClock(deadlineClock, host.worldState.id);
  const selector = snapshotDropData(receiver);
  if (!selector || Object.keys(selector).sort().join(',') !== 'clientId,entity' ||
      !Number.isSafeInteger(dropId) || dropId < 1) fail('operation');
  const { clientId, entity } = selector, ecs = w.ecs, c = server.clients.get(clientId), s = sessions.clients.get(clientId);
  const p = w.profiles.get(entity);
  if (!Number.isSafeInteger(clientId) || clientId < 1 || !Number.isInteger(entity) || entity < 1 || entity >= ecs.cap ||
      !c?.serverProfile || c.entity !== entity || !s || s.id !== clientId || sessions.accounts.get(s.key) !== s ||
      s.closed || s.failed || s.pending || s.running || s.pearlBusy || !Number.isSafeInteger(s.version) || s.version < 1 ||
      ecs.clientId[entity] !== clientId || !ecs.alive[entity] || ecs.dead[entity] > 0 || ecs.kind[entity] !== KIND.PLAYER ||
      !(ecs.mask[entity] & C.PLAYER) || p?.pirateId !== 'account:' + s.key) fail('session');
  assertDropContainers(w);
  const drop = w.drops.get(dropId), source = snapshotDropData(drop), pearl = sanitizePearl(source.pearl);
  const ground = clock.assertDrop(source, 'pearl'), at = clock.at(w.tick);
  if (source.id !== dropId || source.to !== 0 || source.kind !== 'pearl' || !pearl || !same(pearl, source.pearl) ||
      Object.hasOwn(source, 'operationId') || Object.hasOwn(source, 'ordinal') ||
      !row || row.uid !== pearl.uid || row.kind !== pearl.kind || row.world !== host.worldState.id ||
      !same(row.ground, ground) || !Number.isSafeInteger(row.version) || row.version < 1 || row.version >= 2147483647) fail('ownership');
  if (at < ground.availableAt || at > ground.returnAt ||
      Math.hypot(ecs.x[entity] - source.x, ecs.z[entity] - source.z) > DROPS.pickR) fail('ownership');
  const live = snapshotDropData(p), before = capturePearlProfile(w, entity);
  if (!same(live, sanitizeProfile(live)) || !same(before, sanitizeProfile(before))) fail('profile');
  const ledger = w.pearlLedger.get(pearl.uid);
  if (!same(ledger, { owner: '', entity: 0, place: 'ground', drop: dropId })) fail('ownership');
  const owned = profilePearls(before);
  for (const q of owned) if (!same(w.pearlLedger.get(q.uid), { owner: p.pirateId, entity, place: 'profile' })) fail('ownership');
  for (const [uid, entry] of w.pearlLedger) if (entry.place === 'profile' &&
      (entry.owner === p.pirateId || entry.entity === entity) && !owned.some(q => q.uid === uid)) fail('ownership');
  for (const [id, d] of w.drops) if (id !== dropId && snapshotDropData(d).pearl?.uid === pearl.uid) fail('ownership');
  for (const profile of w.profiles.values()) if (profilePearls(snapshotDropData(profile)).some(q => q.uid === pearl.uid)) fail('ownership');

  const local = copy(source); delete local.groundClock;
  const view = { tick: w.tick, profiles: new Map([[entity, copy(before)]]),
    drops: new Map([[dropId, local]]), pearlLedger: copy(w.pearlLedger), profileDirty: new Set(), events: [],
    emit(event) { this.events.push(copy(event)); } };
  if (!pickPearl(view, local, entity)) fail(view.events.at(-1)?.why ?? 'ownership');
  const after = snapshotDropData(view.profiles.get(entity));
  if (!same(after, sanitizeProfile(after))) fail('profile');
  const operation = { uid: pearl.uid, kind: pearl.kind, from: null, to: s.key,
    expectedVersion: row.version, world: row.world, ground: null,
    profiles: [{ id: s.key, expectedVersion: s.version, data: copy(after) }] };
  const baseline = { tick: w.tick, version: s.version, confirmed: copy(s.confirmed), last: s.last,
    ecs, columns: columns(ecs, entity), name: ecs.names[entity], profiles: w.profiles, drops: w.drops,
    ledger: w.pearlLedger, dirty: w.profileDirty, events: w.events, nextDrop: w.nextDrop,
    dropRows: [...w.drops], dropData: snapshotDropData([...w.drops]), ledgerData: snapshotDropData([...w.pearlLedger]),
    eventData: snapshotDropData(w.events), wasDirty: w.profileDirty.has(entity) };
  let applied = false;
  const assertCurrent = () => {
    assertDropContainers(w);
    if (applied || host.server !== server || server.world !== w || w.tick !== baseline.tick || w.ecs !== ecs ||
        w.profiles !== baseline.profiles || w.drops !== baseline.drops || w.pearlLedger !== baseline.ledger ||
        w.profileDirty !== baseline.dirty || w.events !== baseline.events || w.nextDrop !== baseline.nextDrop ||
        sessions.clients.get(clientId) !== s || sessions.accounts.get(s.key) !== s || server.clients.get(clientId) !== c ||
        c.entity !== entity || !c.serverProfile || s.closed || s.failed || s.pending || s.running || s.pearlBusy ||
        s.version !== baseline.version || !same(s.confirmed, baseline.confirmed) || s.last !== baseline.last ||
        w.profiles.get(entity) !== p || !same(snapshotDropData(p), live) || !same(capturePearlProfile(w, entity), before) ||
        ecs.names[entity] !== baseline.name || columns(ecs, entity).length !== baseline.columns.length ||
        baseline.columns.some(q => ecs[q.key] !== q.column || !Object.is(q.column[entity], q.value)) ||
        w.drops.get(dropId) !== drop || !same(snapshotDropData([...w.drops]), baseline.dropData) ||
        !same(snapshotDropData([...w.pearlLedger]), baseline.ledgerData) || !same(snapshotDropData(w.events), baseline.eventData) ||
        w.profileDirty.has(entity) !== baseline.wasDirty) fail('cancelled');
    clock.assertDrop(drop, 'pearl', ground);
  };
  assertCurrent();
  return { operation: copy(operation), assertCurrent,
    apply(effect) {
      assertCurrent();
      const checked = checkedGroundResult(effect, operation);
      if (!checked.ok || checked.replay) fail('response');
      const publication = { ecs, events: [] };
      for (const event of view.events) w.emit.call(publication, copy(event));
      const events = snapshotDropData(publication.events);
      assertCurrent();
      if (baseline.events.length + events.length > 4294967295) fail('effect');
      const fields = Object.keys(after).filter(key => !same(p[key], after[key])).map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(p, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.writable) fail('effect');
        return { key, before: descriptor.value, after: copy(after[key]) };
      });
      const nextLedger = { owner: p.pirateId, entity, place: 'profile' };
      for (const key of ['version', 'confirmed', 'last']) {
        const descriptor = Object.getOwnPropertyDescriptor(s, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.writable) fail('effect');
      }
      const nextConfirmed = copy(after), nextLast = JSON.stringify(after), count = w.events.length;
      let started = false;
      try {
        started = true;
        for (const field of fields) p[field.key] = field.after;
        Map.prototype.delete.call(w.drops, dropId); Map.prototype.set.call(w.pearlLedger, pearl.uid, nextLedger);
        Set.prototype.add.call(w.profileDirty, entity);
        s.version = baseline.version + 1; s.confirmed = nextConfirmed; s.last = nextLast;
        if (w.profiles.get(entity) !== p || !same(snapshotDropData(p), after) || w.drops.has(dropId) ||
            w.pearlLedger.get(pearl.uid) !== nextLedger || w.nextDrop !== baseline.nextDrop ||
            w.events.length !== count || !w.profileDirty.has(entity) ||
            baseline.columns.some(q => ecs[q.key] !== q.column || !Object.is(q.column[entity], q.value)) ||
            s.version !== effect.profiles[0].version || !same(s.confirmed, after) || s.last !== nextLast) fail('effect');
        Array.prototype.push.call(w.events, ...events);
        if (!isDeepStrictEqual(w.events.slice(count), events)) fail('effect');
        applied = true;
        return true;
      } catch (error) {
        if (started) {
          baseline.events.length = count;
          // Restore order as well as identity: drop iteration orders future coastal RNG choices.
          Map.prototype.clear.call(baseline.drops);
          for (const [id, value] of baseline.dropRows) Map.prototype.set.call(baseline.drops, id, value);
          Map.prototype.set.call(baseline.ledger, pearl.uid, ledger);
          for (const field of fields) if (p[field.key] === field.after) p[field.key] = field.before;
          if (!baseline.wasDirty) Set.prototype.delete.call(baseline.dirty, entity);
          s.version = baseline.version; s.confirmed = baseline.confirmed; s.last = baseline.last;
        }
        throw error;
      }
    },
  };
}
