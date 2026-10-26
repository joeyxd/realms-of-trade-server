import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGroundPearlReturn } from '../server/groundPearlReturn.mjs';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { groundResult } from '../server/pearlGround.mjs';
import { mulberry32 } from '../src/core/rng.js';
import { returnPearl } from '../src/sim/systems/pearls.js';
import { fixture, WORLD, incomingUid, state } from './helpers/pearl-replace-staging.mjs';

const clock = () => new GroundDeadlineClock({ worldId: WORLD, sourceDomain: 'durable-ground-v1',
  epoch: new GroundClockEpoch({ localTick: 7, durableTick: 2 ** 40 }) });
const clone = structuredClone;

async function setup() {
  const f = await fixture(), deadlineClock = clock();
  f.world.tick = 11;
  const staging = new PearlStaging(f.sessions, f.world, WORLD, { deadlineClock });
  staging.request({ action: 'leave', uid: incomingUid, source: { clientId: 1, entity: f.entities[0] } });
  await staging.settle();
  assert.equal(staging.drain()[0].state, 'applied');
  const source = [...f.world.drops.values()][0];
  f.world.tick = source.t + 1;
  f.world.events.length = 0;
  f.world.profileDirty.clear();
  const unique = await f.base.loadUnique(incomingUid), location = await f.base.loadPearlLocation(incomingUid);
  const row = { uid: incomingUid, kind: source.pearl.kind, world: WORLD, ground: location.ground, version: unique.version };
  return { ...f, deadlineClock, staging, source, row, close: async () => { await staging.settle(); await f.close(); } };
}

test('plans the same deterministic return as the legacy helper and applies only a checked family receipt', async () => {
  const f = await setup();
  try {
    const before = state(f.world), oldRng = f.world.lootRng, economy = clone(f.world.economy);
    const plan = prepareGroundPearlReturn({ world: f.world, deadlineClock: f.deadlineClock, dropId: f.source.id, row: f.row });
    const local = clone(f.source); delete local.groundClock;
    const expected = { tick: f.world.tick, map: f.world.map, raftDeck: f.world.raftDeck, ecs: f.world.ecs,
      nextDrop: f.world.nextDrop, lootRng: mulberry32(f.world.lootRng.state()), drops: new Map([[local.id, local]]),
      pearlLedger: new Map([[f.row.uid, clone(f.world.pearlLedger.get(f.row.uid))]]), events: [],
      emit(event) { this.events.push(clone(event)); } };
    const expectedDrop = returnPearl(expected, local);
    const expectedGround = { x: expectedDrop.x, z: expectedDrop.z,
      availableAt: f.deadlineClock.at(expectedDrop.pickAt), returnAt: f.deadlineClock.at(expectedDrop.t) };
    assert.deepEqual(plan.targetDrop, { ...expectedDrop, ...f.deadlineClock.project(expectedGround, 'pearl') });
    assert.deepEqual(plan.operation, { uid: f.row.uid, kind: f.row.kind, from: null, to: null,
      expectedVersion: f.row.version, world: WORLD, ground: plan.targetDrop.groundClock.ground, profiles: [] });
    assert.deepEqual(state(f.world), before);
    assert.equal(f.world.lootRng, oldRng);
    plan.assertCurrent();

    const receipt = groundResult(plan.operation);
    assert.equal(plan.apply(receipt), true);
    assert.equal(f.world.drops.has(f.source.id), false);
    assert.deepEqual(f.world.drops.get(plan.targetDrop.id), plan.targetDrop);
    assert.deepEqual(f.world.pearlLedger.get(f.row.uid), { owner: '', entity: 0, place: 'ground', drop: plan.targetDrop.id });
    assert.equal(f.world.nextDrop, plan.targetDrop.id + 1);
    assert.notEqual(f.world.lootRng, oldRng);
    assert.deepEqual(f.world.events.map(({ elem, ...event }) => event).map(event => event.type),
      ['unloot', 'loot', 'pearlReturn']);
    assert.deepEqual(f.world.events.at(-1), { type: 'pearlReturn', uid: f.row.uid, x: plan.targetDrop.x,
      z: plan.targetDrop.z, zone: f.world.map.zoneAt?.(plan.targetDrop.x, plan.targetDrop.z)?.name || 'la playa' });
    assert.equal(JSON.stringify(f.world.events).includes('groundClock'), false);
    assert.equal(JSON.stringify(plan.targetDrop.groundClock.ground), JSON.stringify(receipt.location.ground));
    assert.deepEqual(f.world.economy, economy);
    assert.throws(() => plan.apply(receipt), { code: 'effect' });
  } finally { await f.close(); }
});

test('rejects wrong receipts and changed source baselines without mutating World', async () => {
  const f = await setup();
  try {
    const plan = prepareGroundPearlReturn({ world: f.world, deadlineClock: f.deadlineClock, dropId: f.source.id, row: f.row });
    const before = state(f.world);
    assert.throws(() => plan.apply({ ...groundResult(plan.operation), location: { ...groundResult(plan.operation).location,
      ground: { ...plan.operation.ground, x: plan.operation.ground.x + 1 } } }));
    assert.deepEqual(state(f.world), before);

    f.world.drops.get(f.source.id).x += 0.5;
    const changed = state(f.world);
    assert.throws(() => plan.assertCurrent(), { code: 'cancelled' });
    assert.deepEqual(state(f.world), changed);
  } finally { await f.close(); }
});

test('rejects accessors, proxies, non-ground identities, and a UID duplicated in live ownership', async () => {
  const f = await setup();
  try {
    let reads = 0;
    const accessor = { world: f.world, deadlineClock: f.deadlineClock, dropId: f.source.id,
      get row() { reads++; return f.row; } };
    assert.throws(() => prepareGroundPearlReturn(accessor));
    assert.equal(reads, 0);
    assert.throws(() => prepareGroundPearlReturn(new Proxy({ world: f.world, deadlineClock: f.deadlineClock,
      dropId: f.source.id, row: f.row }, { ownKeys() { reads++; return []; } })));
    assert.equal(reads, 0);
    assert.throws(() => prepareGroundPearlReturn({ world: f.world, deadlineClock: f.deadlineClock,
      dropId: f.source.id + 999, row: f.row }));

    f.world.profiles.get(f.entities[0]).pearls.bag.push({ uid: f.row.uid, kind: f.row.kind });
    assert.throws(() => prepareGroundPearlReturn({ world: f.world, deadlineClock: f.deadlineClock,
      dropId: f.source.id, row: f.row }), { code: 'ownership' });
  } finally { await f.close(); }
});

test('preserves drop iteration order around unrelated drops when the target is appended', async () => {
  const f = await setup();
  try {
    const extra = { id: f.world.nextDrop + 50, to: 0, kind: 'item', item: { id: 'wood' }, x: 0, z: 0, t: 99, pickAt: 0 };
    f.world.drops.set(extra.id, extra);
    const originalIds = [...f.world.drops.keys()];
    const plan = prepareGroundPearlReturn({ world: f.world, deadlineClock: f.deadlineClock, dropId: f.source.id, row: f.row });
    assert.equal(plan.apply(groundResult(plan.operation)), true);
    assert.deepEqual([...f.world.drops.keys()], [extra.id, plan.targetDrop.id]);
    assert.deepEqual(originalIds.filter(id => id !== f.source.id), [extra.id]);
  } finally { await f.close(); }
});
