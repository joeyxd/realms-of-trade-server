import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGroundPearlPickup } from '../server/groundPearlPickup.mjs';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { groundResult } from '../server/pearlGround.mjs';
import { fixture, WORLD, incomingUid, accounts, state } from './helpers/pearl-replace-staging.mjs';

const copy = structuredClone;
const clock = () => new GroundDeadlineClock({ worldId: WORLD, sourceDomain: 'durable-ground-v1',
  epoch: new GroundClockEpoch({ localTick: 7, durableTick: 2 ** 40 }) });

async function setup() {
  const f = await fixture(), deadlineClock = clock(); f.world.tick = 11;
  const staging = new PearlStaging(f.sessions, f.world, WORLD, { deadlineClock });
  staging.request({ action: 'leave', uid: incomingUid, source: { clientId: 1, entity: f.entities[0] } });
  await staging.settle(); assert.equal(staging.drain()[0].state, 'applied'); await f.sessions.flush();
  const drop = [...f.world.drops.values()][0]; f.world.tick = drop.pickAt;
  for (const entity of f.entities) { f.world.ecs.x[entity] = drop.x; f.world.ecs.z[entity] = drop.z; }
  f.world.events.length = 0; f.world.profileDirty.clear();
  const server = { world: f.world, clients: new Map(f.entities.map((entity, i) => [i + 1,
    { entity, serverProfile: true }])) };
  const host = { server, profiles: f.sessions, worldState: { id: WORLD } };
  const unique = await f.base.loadUnique(incomingUid), location = await f.base.loadPearlLocation(incomingUid);
  const row = { uid: incomingUid, kind: 'escarcha', world: WORLD, ground: location.ground, version: unique.version };
  const receiver = { clientId: 2, entity: f.entities[1] };
  const close = async () => { await staging.settle(); await f.sessions.flush(); await f.close(); };
  return { ...f, staging, deadlineClock, drop, host, row, receiver, close };
}

const metadata = (f, entity = f.entities[1]) => {
  const session = f.sessions.clients.get(f.world.ecs.clientId[entity]);
  return { session, version: session.version, confirmed: copy(session.confirmed), last: session.last,
    profile: copy(f.world.profiles.get(entity)), dirty: [...f.world.profileDirty], events: copy(f.world.events),
    drops: [...f.world.drops], ledger: [...f.world.pearlLedger], nextDrop: f.world.nextDrop };
};

test('pickup plan is detached and a checked receipt advances the profile session exactly once', async () => {
  const f = await setup();
  try {
    const before = metadata(f), plan = prepareGroundPearlPickup({ host: f.host, deadlineClock: f.deadlineClock,
      dropId: f.drop.id, receiver: f.receiver, row: f.row });
    assert.deepEqual(plan.operation, { uid: incomingUid, kind: 'escarcha', from: null, to: accounts[1],
      expectedVersion: f.row.version, world: WORLD, ground: null,
      profiles: [{ id: accounts[1], expectedVersion: before.version, data: plan.operation.profiles[0].data }] });
    assert.equal(plan.operation.profiles[0].data.pearls.bag.at(-1).uid, incomingUid);
    assert.equal(plan.operation.profiles[0].expectedVersion, before.version);
    assert.deepEqual(metadata(f), before, 'planning performs no profile/drop/ledger/event write');
    plan.assertCurrent();
    assert.equal(plan.apply(groundResult(plan.operation)), true);
    const session = f.sessions.clients.get(2), profile = f.world.profiles.get(f.entities[1]);
    assert.equal(session.version, before.version + 1);
    assert.deepEqual(session.confirmed, profile);
    assert.equal(session.last, JSON.stringify(profile));
    assert.equal(profile.pearls.bag.at(-1).uid, incomingUid);
    assert.equal(f.world.drops.has(f.drop.id), false);
    assert.deepEqual(f.world.pearlLedger.get(incomingUid), { owner: profile.pirateId, entity: f.entities[1], place: 'profile' });
    assert.ok(f.world.profileDirty.has(f.entities[1]));
    assert.ok(f.world.events.length > before.events.length);
    assert.throws(() => plan.assertCurrent(), { code: 'cancelled' }, 'an applied plan cannot be reused');
  } finally { await f.close(); }
});

test('rejects hostile receiver getters and source getters without evaluating them', async () => {
  const f = await setup(); let calls = 0;
  try {
    const receiver = Object.defineProperty({}, 'clientId', { enumerable: true, get() { calls++; return 2; } });
    assert.throws(() => prepareGroundPearlPickup({ host: f.host, deadlineClock: f.deadlineClock,
      dropId: f.drop.id, receiver, row: f.row }));
    const source = f.world.drops.get(f.drop.id);
    const hostile = Object.defineProperty({ ...source }, 'x', { enumerable: true, get() { calls++; return source.x; } });
    f.world.drops.set(f.drop.id, hostile);
    assert.throws(() => prepareGroundPearlPickup({ host: f.host, deadlineClock: f.deadlineClock,
      dropId: f.drop.id, receiver: f.receiver, row: f.row }));
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test('rejects stale hydrated row version and mismatched durable source without a plan', async () => {
  const f = await setup();
  try {
    for (const row of [{ ...f.row, version: 0 },
      { ...f.row, ground: { ...f.row.ground, x: f.row.ground.x + 1 } },
      { ...f.row, world: 'other-world' }]) {
      assert.throws(() => prepareGroundPearlPickup({ host: f.host, deadlineClock: f.deadlineClock,
        dropId: f.drop.id, receiver: f.receiver, row }), { code: 'ownership' });
    }
    assert.equal(f.world.drops.has(f.drop.id), true);
  } finally { await f.close(); }
});

test('a disconnect invalidates the prepared effect before any local write', async () => {
  const f = await setup();
  try {
    const plan = prepareGroundPearlPickup({ host: f.host, deadlineClock: f.deadlineClock,
      dropId: f.drop.id, receiver: f.receiver, row: f.row });
    const before = metadata(f); f.host.server.clients.delete(2);
    assert.throws(() => plan.apply(groundResult(plan.operation)), { code: 'cancelled' });
    assert.deepEqual(metadata(f), before);
  } finally { await f.close(); }
});

test('profile, ECS, and source mutations after planning fail the baseline before applying', async () => {
  for (const mutate of [f => { f.world.profiles.get(f.entities[1]).gold++; },
    f => { f.world.ecs.hp[f.entities[1]]--; }, f => { f.world.drops.get(f.drop.id).x += 0.5; }]) {
    const f = await setup();
    try {
      const plan = prepareGroundPearlPickup({ host: f.host, deadlineClock: f.deadlineClock,
        dropId: f.drop.id, receiver: f.receiver, row: f.row });
      mutate(f); const before = state(f.world);
      assert.throws(() => plan.assertCurrent(), { code: 'cancelled' });
      assert.throws(() => plan.apply(groundResult(plan.operation)), { code: 'cancelled' });
      assert.deepEqual(state(f.world), before);
    } finally { await f.close(); }
  }
});

test('synchronous failure after tentative profile writes restores all local and session metadata', async () => {
  const f = await setup();
  const originalSet = Map.prototype.set;
  try {
    const plan = prepareGroundPearlPickup({ host: f.host, deadlineClock: f.deadlineClock,
      dropId: f.drop.id, receiver: f.receiver, row: f.row });
    const before = metadata(f); let injected = false;
    Map.prototype.set = function(key, value) {
      const result = originalSet.call(this, key, value);
      if (this === f.world.pearlLedger && !injected) { injected = true; throw new Error('injected map failure'); }
      return result;
    };
    assert.throws(() => plan.apply(groundResult(plan.operation)), /injected map failure/);
    assert.ok(injected);
    assert.deepEqual(metadata(f), before, 'profile, source order, ledger, dirty flag, events and session are rolled back');
  } finally { Map.prototype.set = originalSet; await f.close(); }
});

test('stale profile-session version and unexpected in-flight save reject the adapter', async () => {
  const f = await setup();
  try {
    const session = f.sessions.clients.get(2), input = { host: f.host, deadlineClock: f.deadlineClock,
      dropId: f.drop.id, receiver: f.receiver, row: f.row };
    session.version = 0;
    assert.throws(() => prepareGroundPearlPickup(input), { code: 'session' });
    session.version = 1; session.pending = { data: copy(session.confirmed), text: JSON.stringify(session.confirmed) };
    assert.throws(() => prepareGroundPearlPickup(input), { code: 'session' });
    session.pending = null;
  } finally { await f.close(); }
});
