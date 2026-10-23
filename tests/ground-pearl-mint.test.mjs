import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGroundPearlMint } from '../server/groundPearlMint.mjs';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { groundResult } from '../server/pearlGround.mjs';
import { WORLD, op } from './helpers/pearl-batch.mjs';
import { fixture, state } from './helpers/pearl-replace-staging.mjs';
import { dropRolledPearl, dropPearl } from '../src/sim/systems/pearls.js';

const clock = () => new GroundDeadlineClock({ worldId: WORLD, sourceDomain: 'durable-ground-v1',
  epoch: new GroundClockEpoch({ localTick: 7, durableTick: 2 ** 40 }) });
const uid = n => `mint:${op(n)}`;
async function setup(tick = 11, n = 71) {
  const f = await fixture(); f.world.tick = tick; f.world.events.length = 0; f.world.profileDirty.clear();
  const candidate = { operationId: op(n), pearl: { uid: uid(n), kind: 'escarcha' }, x: 0, z: 0, tick };
  return { ...f, deadlineClock: clock(), candidate,
    close: async () => { await f.staging.settle(); await f.close(); } };
}

test('mint planning is detached and applies a fresh checked ground receipt with projected deadlines', async t => {
  const f = await setup(); t.after(f.close);
  const before = state(f.world), rng = f.world.lootRng;
  const plan = prepareGroundPearlMint({ host: { server: { world: f.world }, worldState: { id: WORLD } }, deadlineClock: f.deadlineClock, candidate: f.candidate });
  assert.deepEqual(state(f.world), before); assert.equal(f.world.lootRng, rng);
  assert.deepEqual(plan.operation, { uid: uid(71), kind: 'escarcha',
    from: null, to: null, expectedVersion: 0, world: WORLD, ground: plan.targetDrop.groundClock.ground, profiles: [] });
  assert.equal(plan.targetDrop.id, f.world.nextDrop);
  assert.equal(plan.targetDrop.pickAt, f.candidate.tick + 30);
  assert.equal(plan.targetDrop.t, f.candidate.tick + 5400);
  plan.assertCurrent();
  assert.equal(plan.apply(groundResult(plan.operation)), true);
  assert.deepEqual(f.world.drops.get(plan.targetDrop.id), plan.targetDrop);
  assert.deepEqual(f.world.pearlLedger.get(uid(71)), { owner: '', entity: 0, place: 'ground', drop: plan.targetDrop.id });
  assert.equal(f.world.events.at(-1).type, 'loot');
  assert.ok(f.world.events.at(-1).elem === undefined);
  assert.equal(f.world.nextDrop, plan.targetDrop.id + 1);
  assert.throws(() => plan.apply(groundResult(plan.operation)), { code: 'effect' });
});

test('uses the origin tick within the one tick capture window and rejects out of window candidates', async t => {
  const f = await setup(12, 72); t.after(f.close);
  const c = { ...f.candidate, tick: 11 };
  const plan = prepareGroundPearlMint({ host: { server: { world: f.world }, worldState: { id: WORLD } }, deadlineClock: f.deadlineClock, candidate: c });
  assert.equal(plan.targetDrop.pickAt, 41); assert.equal(plan.targetDrop.t, 5411);
  assert.throws(() => prepareGroundPearlMint({ host: { server: { world: f.world }, worldState: { id: WORLD } }, deadlineClock: f.deadlineClock,
    candidate: { ...f.candidate, operationId: op(73), pearl: { uid: uid(73), kind: 'brasa' }, tick: 10 } }));
});

test('rejects UID collisions and duplicate live profile ownership', async t => {
  const f = await setup(11, 74); t.after(f.close);
  f.world.pearlLedger.set(uid(74), { owner: '', entity: 0, place: 'ground', drop: 800 });
  assert.throws(() => prepareGroundPearlMint({ host: { server: { world: f.world }, worldState: { id: WORLD } }, deadlineClock: f.deadlineClock, candidate: f.candidate }), { code: 'ownership' });
  f.world.pearlLedger.delete(uid(74));
  f.world.profiles.get(f.entities[0]).pearls.bag.push({ uid: uid(74), kind: 'escarcha' });
  assert.throws(() => prepareGroundPearlMint({ host: { server: { world: f.world }, worldState: { id: WORLD } }, deadlineClock: f.deadlineClock, candidate: f.candidate }), { code: 'ownership' });
});

test('cancels when profiles, RNG, or target geometry drift during the IO window', async t => {
  const f = await setup(11, 75); t.after(f.close);
  const prepare = () => prepareGroundPearlMint({ host: { server: { world: f.world }, worldState: { id: WORLD } }, deadlineClock: f.deadlineClock, candidate: f.candidate });
  const profilePlan = prepare(); f.world.profiles.get(f.entities[0]).gold++;
  assert.throws(() => profilePlan.assertCurrent(), { code: 'cancelled' });
  f.world.profiles.get(f.entities[0]).gold--;
  const rngPlan = prepare(); f.world.lootRng();
  assert.throws(() => rngPlan.assertCurrent(), { code: 'cancelled' });
  // A new candidate has a separately captured clean baseline.
  const geom = prepare(); f.world.map.groundAt = () => 9;
  assert.throws(() => geom.assertCurrent(), { code: 'cancelled' });
});

test('rejects replay and malformed receipts without applying; rolls back if publication throws', async t => {
  const f = await setup(11, 76); t.after(f.close);
  const plan = prepareGroundPearlMint({ host: { server: { world: f.world }, worldState: { id: WORLD } }, deadlineClock: f.deadlineClock, candidate: f.candidate });
  const before = state(f.world), receipt = groundResult(plan.operation);
  assert.throws(() => plan.apply(groundResult(plan.operation, true)), { code: 'response' });
  assert.throws(() => plan.apply({ ...receipt, location: { ...receipt.location, ground: { ...receipt.location.ground, x: 100 } } }), { code: 'response' });
  assert.deepEqual(state(f.world), before);
  f.world.emit = function () { throw new Error('emit failed'); };
  const failing = prepareGroundPearlMint({ host: { server: { world: f.world }, worldState: { id: WORLD } }, deadlineClock: f.deadlineClock, candidate: f.candidate });
  const clean = state(f.world);
  assert.throws(() => failing.apply(groundResult(failing.operation)), /emit failed/);
  assert.deepEqual(state(f.world), clean);
});

test('a fault after drop insertion rolls back the mint allocator, ledger and drop', async t => {
  const f = await setup(11, 77); t.after(f.close);
  const plan = prepareGroundPearlMint({ host: { server: { world: f.world }, worldState: { id: WORLD } },
    deadlineClock: f.deadlineClock, candidate: f.candidate });
  const before = state(f.world);
  const original = Map.prototype.set;
  Map.prototype.set = function(key, value) {
    if (this === f.world.pearlLedger && key === uid(77)) {
      assert.ok(f.world.drops.has(plan.targetDrop.id));
      throw new Error('ledger insertion failed');
    }
    return original.call(this, key, value);
  };
  try { assert.throws(() => plan.apply(groundResult(plan.operation)), /ledger insertion failed/); }
  finally { Map.prototype.set = original; }
  assert.deepEqual(state(f.world), before);
});

test('rolled-pearl seam stays synchronous and does not intercept existing pearl drops', async t => {
  const f = await setup(11, 78); t.after(f.close);
  const w = f.world, before = state(w); let captures = 0;
  w.deferPearlMint = raw => { captures++; assert.deepEqual(raw, { kind: 'escarcha', x: 0, z: 0 }); return true; };
  assert.equal(dropRolledPearl(w, f.candidate.pearl, 0, 0), null);
  assert.equal(captures, 1); assert.deepEqual(state(w), before);
  assert.ok(dropPearl(w, f.candidate.pearl, 0, 0));
  assert.equal(captures, 1, 'death/leave/return helper does not enter the fresh-roll seam');
  w.deferPearlMint = () => Promise.reject(new Error('async hook'));
  assert.throws(() => dropRolledPearl(w, f.candidate.pearl, 0, 0), /synchronous boolean/);
  await new Promise(resolve => setImmediate(resolve));
});
