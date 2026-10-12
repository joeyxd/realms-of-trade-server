import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGroundPearlGive } from '../server/groundPearlGive.mjs';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { groundResult } from '../server/pearlGround.mjs';
import { StoreError } from '../server/store.mjs';
import { fixture, WORLD, incomingUid, outgoingUid, accounts, state } from './helpers/pearl-replace-staging.mjs';
import { PEARL } from '../src/data/pearls.js';

const clock = () => new GroundDeadlineClock({ worldId: WORLD, sourceDomain: 'durable-ground-v1',
  epoch: new GroundClockEpoch({ localTick: 7, durableTick: 2 ** 40 }) });

async function setup() {
  const f = await fixture(); f.world.tick = 11;
  const clients = new Map(f.entities.map((entity, i) => [i + 1, { serverProfile: true, entity }]));
  const host = { server: { world: f.world, clients }, profiles: f.sessions, worldState: { id: WORLD } };
  const unique = await f.base.loadUnique(incomingUid);
  return { ...f, host, source: { clientId: 1, entity: f.entities[0] }, receiver: { clientId: 2, entity: f.entities[1] },
    row: { uid: incomingUid, kind: unique.kind.slice(6), holder: accounts[0], version: unique.version } };
}
const plan = f => prepareGroundPearlGive({ host: f.host, deadlineClock: clock(), source: f.source,
  receiver: f.receiver, uid: incomingUid, row: f.row });

test('give prepares a detached two-profile CAS operation and applies both profiles and events', async () => {
  const f = await setup(); try {
    const before = state(f.world), p = plan(f); assert.deepEqual(state(f.world), before);
    assert.equal(p.operation.from, accounts[0]); assert.equal(p.operation.to, accounts[1]);
    assert.equal(p.operation.expectedVersion, f.row.version); assert.equal(p.operation.world, WORLD);
    assert.equal(Object.isFrozen(p.operation), true); assert.equal(Object.isFrozen(p.operation.profiles[0].data), true);
    assert.equal(p.operation.ground, null); assert.deepEqual(p.operation.profiles.map(x => x.id), [...accounts].sort());
    const src = f.sessions.clients.get(1), dst = f.sessions.clients.get(2);
    assert.equal(p.operation.profiles.find(x => x.id === accounts[0]).expectedVersion, src.version);
    assert.equal(p.operation.profiles.find(x => x.id === accounts[1]).expectedVersion, dst.version);
    assert.equal(p.apply(groundResult({ ...p.operation, operationId: '61000000-0000-4000-8000-000000009019' })), true);
    assert.equal(f.world.profiles.get(f.entities[0]).pearls.bag.some(q => q.uid === incomingUid), false);
    assert.equal(f.world.profiles.get(f.entities[1]).pearls.bag.some(q => q.uid === incomingUid), true);
    assert.deepEqual(f.world.pearlLedger.get(incomingUid), { owner: `account:${accounts[1]}`, entity: f.entities[1], place: 'profile' });
    assert.equal(f.world.events.at(-2).op, 'give'); assert.equal(f.world.events.at(-1).type, 'pickup');
    assert.equal(src.version, p.operation.profiles.find(x => x.id === accounts[0]).expectedVersion + 1);
    assert.equal(dst.version, p.operation.profiles.find(x => x.id === accounts[1]).expectedVersion + 1);
    assert.throws(() => p.apply(groundResult({ ...p.operation, operationId: '61000000-0000-4000-8000-000000009019' })), { code: 'cancelled' });
  } finally { await f.close(); }
});

test('give rejects swallowed, distant, combat, full, wrong-holder and self transfers without mutation', async t => {
  for (const mode of ['swallowed', 'far', 'combat', 'full', 'holder', 'self']) await t.test(mode, async () => {
    const f = await setup(); try {
      if (mode === 'swallowed') {
        const source = f.world.profiles.get(f.entities[0]);
        source.pearls.swallowed = source.pearls.bag.find(q => q.uid === incomingUid);
      }
      if (mode === 'far') f.world.ecs.x[f.entities[1]] += PEARL.transferR + 10;
      if (mode === 'combat') f.world.ecs.atkStage[f.entities[0]] = 1;
      if (mode === 'full') {
        const target = f.world.profiles.get(f.entities[1]);
        target.pearls.bag = Array.from({ length: PEARL.bag }, (_, i) => {
          const item = { uid: `receiver-full-${i}`, kind: 'brasa' };
          f.world.pearlLedger.set(item.uid, { owner: target.pirateId, entity: f.entities[1], place: 'profile' });
          return item;
        });
      }
      if (mode === 'holder') f.row.holder = accounts[1];
      if (mode === 'self') f.receiver = f.source;
      const before = state(f.world); assert.throws(() => plan(f), StoreError); assert.deepEqual(state(f.world), before);
    } finally { await f.close(); }
  });
});

test('baseline allows settlement counters but catches either endpoint or shared ledger drift', async () => {
  const f = await setup(); try {
    const p = plan(f), s = f.sessions.clients.get(2);
    s.pending = {}; assert.equal(p.assertBaseline(), true); assert.throws(() => p.assertCurrent(), { code: 'cancelled' }); delete s.pending;
    f.world.pearlLedger.set(outgoingUid, { owner: 'changed', entity: 77, place: 'profile' });
    assert.throws(() => p.assertBaseline(), { code: 'cancelled' });
  } finally { await f.close(); }
});

test('preflight accepts autosave activity for both accounts, snapshots read-only and cannot apply', async () => {
  const f = await setup(); try {
    const source = f.sessions.clients.get(1), receiver = f.sessions.clients.get(2);
    source.pending = { autosave: true }; receiver.running = true;
    const before = state(f.world);
    const p = prepareGroundPearlGive({ host: f.host, deadlineClock: clock(), source: f.source,
      receiver: f.receiver, uid: incomingUid, row: f.row, preflight: true });
    assert.equal(p.assertBaseline(), true); assert.deepEqual(state(f.world), before);
    assert.throws(() => p.apply(groundResult({ ...p.operation, operationId: '61000000-0000-4000-8000-000000009019' })), { code: 'cancelled' });
  } finally { await f.close(); }
});

test('current endpoint loss, death and guest identity cancel or reject a plan', async t => {
  for (const mode of ['recycled', 'dead', 'guest']) await t.test(mode, async () => {
    const f = await setup(); try {
      if (mode === 'guest') f.host.server.clients.get(2).serverProfile = false;
      if (mode === 'guest') assert.throws(() => plan(f), { code: 'session' });
      else {
        const p = plan(f);
        if (mode === 'recycled') f.host.server.clients.get(2).entity = f.entities[0];
        else f.world.ecs.dead[f.entities[1]] = 1;
        assert.throws(() => p.assertBaseline(), { code: 'cancelled' });
      }
    } finally { await f.close(); }
  });
});

test('failure while marking the second profile dirty rolls back both sessions and the first profile', async () => {
  const f = await setup(); try {
    const p = plan(f), before = state(f.world), originalAdd = Set.prototype.add;
    let added = 0;
    Set.prototype.add = function(value) {
      if (this === f.world.profileDirty && ++added === 2) throw new Error('second profile failed');
      return originalAdd.call(this, value);
    };
    try {
      assert.throws(() => p.apply(groundResult({ ...p.operation, operationId: '61000000-0000-4000-8000-000000009019' })), /second profile failed/);
    } finally { Set.prototype.add = originalAdd; }
    assert.deepEqual(state(f.world), before);
    assert.equal(f.sessions.clients.get(1).version, p.operation.profiles.find(x => x.id === accounts[0]).expectedVersion);
    assert.equal(f.sessions.clients.get(2).version, p.operation.profiles.find(x => x.id === accounts[1]).expectedVersion);
  } finally { await f.close(); }
});

test('one-shot failure writing the second session confirmed value restores both sessions and projections', async () => {
  const f = await setup(); try {
    const target = f.sessions.clients.get(2), saved = { confirmed: target.confirmed, last: target.last, version: target.version };
    let armed = true;
    const proxy = new Proxy(target, { set(obj, key, value, receiver) {
      if (key === 'confirmed' && armed) { armed = false; throw new Error('second confirmed failed'); }
      return Reflect.set(obj, key, value, receiver);
    } });
    f.sessions.clients.set(2, proxy); f.sessions.accounts.set(accounts[1], proxy);
    const p = plan(f), before = state(f.world), src = f.sessions.clients.get(1);
    const sourceState = { confirmed: src.confirmed, last: src.last, version: src.version };
    assert.throws(() => p.apply(groundResult({ ...p.operation, operationId: '61000000-0000-4000-8000-000000009019' })), /second confirmed failed/);
    assert.deepEqual(state(f.world), before);
    assert.equal(src.version, sourceState.version); assert.deepEqual(src.confirmed, sourceState.confirmed); assert.equal(src.last, sourceState.last);
    assert.equal(proxy.version, saved.version); assert.deepEqual(proxy.confirmed, saved.confirmed); assert.equal(proxy.last, saved.last);
  } finally { await f.close(); }
});

test('partial event append failure truncates publication and restores the full give projection', async () => {
  const f = await setup(); try {
    const p = plan(f), before = state(f.world), originalPush = Array.prototype.push;
    Array.prototype.push = function(...values) {
      if (this === f.world.events && values.length > 1) {
        originalPush.call(this, values[0]); throw new Error('partial event append');
      }
      return originalPush.apply(this, values);
    };
    try { assert.throws(() => p.apply(groundResult({ ...p.operation, operationId: '61000000-0000-4000-8000-000000009019' })), /partial event append/); }
    finally { Array.prototype.push = originalPush; }
    assert.deepEqual(state(f.world), before);
  } finally { await f.close(); }
});
