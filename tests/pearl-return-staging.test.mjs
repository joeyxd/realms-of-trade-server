import test from 'node:test';
import assert from 'node:assert/strict';
import { PearlReturnStaging } from '../server/pearlReturnStaging.mjs';
import { PearlPickupStaging } from '../server/pearlPickupStaging.mjs';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { StoreError } from '../server/store.mjs';
import { mulberry32 } from '../src/core/rng.js';
import { returnPearl } from '../src/sim/systems/pearls.js';
import { stepDrops } from '../src/sim/systems/inventory.js';
import { fixture, WORLD, incomingUid, accounts, state, deferred } from './helpers/pearl-replace-staging.mjs';

const clone = structuredClone;
const makeClock = (anchor = { localTick: 7, durableTick: 2 ** 40 }, worldId = WORLD) => new GroundDeadlineClock({
  worldId, sourceDomain: 'durable-ground-v1', epoch: new GroundClockEpoch(anchor) });
async function setup() {
  const f = await fixture(); f.clock = makeClock(); f.world.tick = 11;
  const leave = new PearlStaging(f.sessions, f.world, WORLD, { deadlineClock: f.clock });
  leave.request({ action: 'leave', uid: incomingUid, source: { clientId: 1, entity: f.entities[0] } });
  await leave.settle(); assert.equal(leave.drain()[0].state, 'applied'); await f.sessions.flush();
  f.drop = [...f.world.drops.values()][0]; f.world.tick = f.drop.t + 1;
  f.world.events.length = 0; f.world.profileDirty.clear();
  f.returner = new PearlReturnStaging(f.sessions, f.world, WORLD, { deadlineClock: f.clock });
  return f;
}
const command = f => ({ dropId: f.drop.id });
async function ready(f) {
  const handle = f.returner.return(command(f)); await f.returner.settle();
  const ctx = f.returner.operations.get(handle.operationId); assert.equal(ctx.state, 'ready'); return { handle, ctx };
}
function expected(f) {
  const d = clone(f.drop); delete d.groundClock;
  const view = { tick: f.world.tick, map: f.world.map, raftDeck: f.world.raftDeck, ecs: f.world.ecs,
    nextDrop: f.world.nextDrop, lootRng: mulberry32(f.world.lootRng.state()),
    drops: new Map([[d.id, d]]), pearlLedger: clone(f.world.pearlLedger), events: [], emit(e) { this.events.push(clone(e)); } };
  const target = returnPearl(view, d);
  const ground = { x: target.x, z: target.z, availableAt: f.clock.at(target.pickAt), returnAt: f.clock.at(target.t) };
  return { view, ground, target: { ...target, ...f.clock.project(ground, 'pearl') } };
}

test('async receipt leaves World and original RNG untouched; drain matches deterministic return once', async () => {
  const f = await setup();
  try {
    const want = expected(f), before = state(f.world), oldRng = f.world.lootRng, nextDrop = f.world.nextDrop;
    const handle = f.returner.return(command(f)); assert.deepEqual(state(f.world), before); assert.deepEqual(f.returner.drain(), []);
    assert.throws(() => f.returner.assertPublishable(), { code: 'busy' });
    await f.returner.settle(); assert.deepEqual(state(f.world), before); assert.equal(f.world.lootRng, oldRng);
    const ctx = f.returner.operations.get(handle.operationId);
    assert.equal(ctx.state, 'ready'); assert.equal(ctx.request.expectedVersion, 2); assert.equal(Object.isFrozen(ctx.request.ground), true);
    assert.equal(ctx.request.from, null); assert.equal(ctx.request.to, null); assert.deepEqual(ctx.request.profiles, []);
    assert.deepEqual(ctx.request.ground, want.ground);
    assert.deepEqual(await f.base.loadPearlLocation(incomingUid), { world: WORLD, ground: want.ground, version: 3 });
    assert.deepEqual(f.returner.drain(), [{ operationId: handle.operationId, state: 'applied' }]);
    assert.equal(f.world.nextDrop, nextDrop + 1); assert.equal(f.world.drops.has(f.drop.id), false);
    assert.deepEqual(f.world.drops.get(nextDrop), want.target); assert.equal(f.world.drops.size, 1);
    assert.deepEqual(f.world.events.map(({ elem, ...event }) => event), want.view.events);
    assert.equal(f.world.lootRng.state(), want.view.lootRng.state()); assert.equal(oldRng.state(), before.lootRng);
    const comparison = mulberry32(want.view.lootRng.state()); assert.equal(f.world.lootRng(), comparison());
    const applied = state(f.world); assert.deepEqual(f.returner.drain(), []); assert.deepEqual(state(f.world), applied);
    f.returner.assertPublishable(); f.returner.gate.assertAvailable({ uids: [incomingUid] });
    assert.equal(JSON.stringify(f.world.events).includes('groundClock'), false);
  } finally { await f.close(); }
});

test('all return owners share the RNG claim and UID lane also excludes pickup', async () => {
  const f = await setup();
  try {
    f.returner.return(command(f));
    const other = new PearlReturnStaging(f.sessions, f.world, WORLD, { deadlineClock: f.clock });
    assert.throws(() => other.return(command(f)), { code: 'busy' });
    assert.throws(() => other.return({ dropId: 999 }), { code: 'busy' });
    assert.throws(() => other.assertPublishable(), { code: 'busy' });
    f.world.tick = f.drop.t; // Verify shared UID authorization independently of the expiry window.
    const pickup = new PearlPickupStaging(f.sessions, f.world, WORLD, { deadlineClock: f.clock });
    f.world.ecs.x[f.entities[1]] = f.drop.x; f.world.ecs.z[f.entities[1]] = f.drop.z;
    assert.throws(() => pickup.pickup({ dropId: f.drop.id, receiver: { clientId: 2, entity: f.entities[1] } }), { code: 'busy' });
    f.world.tick = f.drop.t + 1;
    await f.returner.settle(); assert.equal(f.returner.drain()[0].state, 'applied'); other.assertPublishable();
  } finally { await f.close(); }
});

for (const [name, alter] of [
  ['before expiry', f => { f.world.tick = f.drop.t - 1; }],
  ['exact expiry', f => { f.world.tick = f.drop.t; }],
  ['missing marker', f => { delete f.drop.groundClock; }],
  ['wrong marker world', f => { f.drop.groundClock.world = 'wrong'; }],
  ['wrong projection', f => { f.drop.t--; }],
  ['wrong UID ledger', f => { f.world.pearlLedger.get(incomingUid).drop++; }],
  ['local profile claims source', f => { f.world.profiles.get(f.entities[1]).pearls.bag.push(clone(f.drop.pearl)); }],
  ['duplicate source', f => { const d = clone(f.drop); d.id = 100; f.world.drops.set(100, d); }],
  ['allocator collision', f => { f.world.drops.set(f.world.nextDrop, { id: f.world.nextDrop, kind: 'potion' }); }],
  ['unsafe allocator', f => { f.world.nextDrop = Number.MAX_SAFE_INTEGER; }],
]) test(name + ' rejects before IO and consumes no RNG or reservation', async () => {
  const f = await setup(); let io = 0;
  try {
    const load = f.store.loadUnique; f.store.loadUnique = (...args) => { io++; return load(...args); };
    alter(f); const before = state(f.world); assert.throws(() => f.returner.return(command(f)));
    assert.deepEqual(state(f.world), before); assert.equal(io, 0); f.returner.assertPublishable(); f.returner.gate.assertWorldAvailable();
  } finally { await f.close(); }
});

for (const raw of [null, {}, { dropId: 1, uid: incomingUid }, { dropId: 1, at: 1 }, { dropId: 1, ground: {} },
  { dropId: 1, operationId: accounts[0] }, { dropId: '1' }]) test('strict return selector ' + JSON.stringify(raw), async () => {
  const f = await setup();
  try { const before = state(f.world); assert.throws(() => f.returner.return(raw)); assert.deepEqual(state(f.world), before); f.returner.assertPublishable(); }
  finally { await f.close(); }
});

test('selector getter and Proxy are rejected without callbacks', async () => {
  const f = await setup(); let calls = 0;
  try {
    const getter = Object.defineProperty({}, 'dropId', { enumerable: true, get() { calls++; return f.drop.id; } });
    assert.throws(() => f.returner.return(getter));
    assert.throws(() => f.returner.return(new Proxy(command(f), { ownKeys() { calls++; return ['dropId']; } })));
    assert.equal(calls, 0); f.returner.assertPublishable();
  } finally { await f.close(); }
});

for (const [name, change] of [
  ['missing unique', () => null], ['held unique', q => ({ ...q, holder: accounts[0] })],
  ['wrong kind', q => ({ ...q, kind: 'pearl:tinta' })], ['max generation', q => ({ ...q, version: 2147483647 })],
]) test(name + ' fences without a return receipt or local effect', async () => {
  const f = await setup();
  try {
    const load = f.store.loadUnique; f.store.loadUnique = async uid => change(await load(uid));
    const before = state(f.world), h = f.returner.return(command(f)); await f.returner.settle();
    assert.equal(f.returner.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
    assert.equal(await f.base.loadPearlGroundOperation(h.operationId), null); assert.throws(() => f.returner.assertPublishable(), { code: 'busy' });
  } finally { await f.close(); }
});

for (const [name, change] of [
  ['missing location', () => null], ['wrong world', q => ({ ...q, world: 'other' })],
  ['wrong generation', q => ({ ...q, version: q.version + 1 })], ['wrong source geometry', q => ({ ...q, ground: { ...q.ground, x: q.ground.x + 1 } })],
  ['wrong source deadline', q => ({ ...q, ground: { ...q.ground, returnAt: q.ground.returnAt + 1 } })],
]) test(name + ' is compared against original source, not only destination receipt', async () => {
  const f = await setup();
  try {
    const load = f.store.loadPearlLocation; f.store.loadPearlLocation = async uid => change(await load(uid));
    const before = state(f.world), h = f.returner.return(command(f)); await f.returner.settle();
    assert.equal(f.returner.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
    assert.equal(await f.base.loadPearlGroundOperation(h.operationId), null);
  } finally { await f.close(); }
});

for (const [name, alter] of [
  ['forward tick', f => { f.world.tick++; }], ['rewind tick', f => { f.world.tick--; }],
  ['RNG consumed', f => { f.world.lootRng(); }], ['RNG replaced', f => { f.world.lootRng = mulberry32(f.world.lootRng.state()); }],
  ['allocator moved', f => { f.world.nextDrop++; }], ['source marker removed', f => { delete f.drop.groundClock; }],
  ['source object replaced', f => { f.world.drops.set(f.drop.id, clone(f.drop)); }], ['source position changed', f => { f.drop.x++; }],
  ['source ledger changed', f => { f.world.pearlLedger.get(incomingUid).drop++; }],
  ['request replaced', (f, ctx) => { ctx.request = clone(ctx.request); }], ['receipt target changed', (f, ctx) => { ctx.receipt.location.ground.x++; }],
  ['receipt generation changed', (f, ctx) => { ctx.receipt.unique.version++; }], ['invalidated UID', f => { f.returner.invalidatePearl(incomingUid); }],
  ['map replaced', f => { f.world.map = { ...f.world.map }; }], ['map callback replaced', f => { f.world.map = { ...f.world.map, groundAt: () => 3 }; }],
  ['new event', f => { f.world.events.push({ type: 'other' }); }],
]) test(name + ' after receipt fences and retains durable destination without replay', async () => {
  const f = await setup();
  try {
    const { handle, ctx } = await ready(f), receipt = await f.base.loadPearlGroundOperation(handle.operationId);
    alter(f, ctx); const before = state(f.world);
    assert.equal(f.returner.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
    assert.deepEqual(await f.base.loadPearlGroundOperation(handle.operationId), receipt);
    assert.deepEqual(f.returner.drain(), []); assert.throws(() => f.returner.return(command(f)), { code: 'busy' });
  } finally { await f.close(); }
});

test('lost response retries exact UUID and target without rerunning the beach search', async () => {
  const f = await setup(); const calls = [];
  try {
    const commit = f.store.commitPearlGround; f.store.commitPearlGround = async raw => {
      calls.push(clone(raw)); const result = await commit(raw);
      if (calls.length === 1) throw new StoreError('unavailable'); return result;
    };
    const before = state(f.world), { handle } = await ready(f);
    assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].operationId, handle.operationId);
    assert.deepEqual(state(f.world), before); assert.equal((await f.base.loadUnique(incomingUid)).version, 3);
    assert.equal(f.returner.drain()[0].state, 'applied'); assert.equal(f.world.events.filter(e => e.type === 'pearlReturn').length, 1);
  } finally { await f.close(); }
});

test('source generation relocated before queue dispatch conflicts without a new receipt', async () => {
  const f = await setup(); let loads = 0;
  try {
    const load = f.store.loadPearlLocation; f.store.loadPearlLocation = async uid => {
      const row = await load(uid);
      if (++loads === 1) await f.base.commitPearlGround({ operationId: 'dd000000-0000-4000-8000-000000000037',
        uid, kind: f.drop.pearl.kind, from: null, to: null, expectedVersion: row.version, world: WORLD,
        ground: { ...row.ground, x: row.ground.x + 3 }, profiles: [] });
      return row;
    };
    const before = state(f.world), handle = f.returner.return(command(f)); await f.returner.settle();
    assert.equal(f.returner.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
    assert.equal(await f.base.loadPearlGroundOperation(handle.operationId), null); assert.equal((await f.base.loadUnique(incomingUid)).version, 3);
  } finally { await f.close(); }
});

test('independent read failure waits for both reads before fencing', async () => {
  const f = await setup(), held = deferred();
  try {
    f.store.loadUnique = async () => { throw new StoreError('unavailable'); };
    const load = f.store.loadPearlLocation; f.store.loadPearlLocation = async uid => { await held.promise; return load(uid); };
    const h = f.returner.return(command(f)); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.returner.operations.get(h.operationId).state, 'pending'); assert.deepEqual(f.returner.drain(), []);
    held.resolve(); await f.returner.settle(); assert.equal(f.returner.drain()[0].state, 'fenced');
  } finally { held.resolve(); await f.close(); }
});

test('event decoration failure leaves source, RNG and allocator intact but retains receipt', async () => {
  const f = await setup();
  try {
    const { handle } = await ready(f), before = state(f.world); f.world.emit = () => { throw new Error('decoration'); };
    assert.equal(f.returner.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
    assert.ok(await f.base.loadPearlGroundOperation(handle.operationId)); assert.throws(() => f.returner.assertPublishable(), { code: 'busy' });
  } finally { await f.close(); }
});

test('swallowed decoration reentry is fenced and never publishes', async () => {
  const f = await setup();
  try {
    await ready(f); const before = state(f.world); f.world.emit = function () { try { f.returner.drain(); } catch {} };
    assert.equal(f.returner.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
  } finally { await f.close(); }
});

test('release failure after tentative publication rolls back exact source, marker, RNG reference and allocator', async () => {
  const f = await setup();
  try {
    const { handle } = await ready(f), before = state(f.world), rng = f.world.lootRng, source = f.drop;
    const release = f.returner.gate.release; f.returner.gate.release = () => { throw new StoreError('effect'); };
    assert.equal(f.returner.drain()[0].state, 'fenced'); f.returner.gate.release = release;
    assert.deepEqual(state(f.world), before); assert.equal(f.world.drops.get(source.id), source); assert.equal(f.world.lootRng, rng);
    assert.ok(source.groundClock); assert.ok(await f.base.loadPearlGroundOperation(handle.operationId));
    assert.throws(() => f.returner.assertPublishable(), { code: 'busy' });
  } finally { await f.close(); }
});

test('native expiry retains projected source until durable owner applies; new drop can be picked after availability', async () => {
  const f = await setup();
  try {
    const before = state(f.world); assert.equal(returnPearl(f.world, f.drop), false); stepDrops(f.world); assert.deepEqual(state(f.world), before);
    await ready(f); assert.equal(f.returner.drain()[0].state, 'applied');
    const fresh = [...f.world.drops.values()][0]; f.world.tick = fresh.pickAt;
    const entity = f.entities[1]; f.world.ecs.x[entity] = fresh.x; f.world.ecs.z[entity] = fresh.z;
    const pickup = new PearlPickupStaging(f.sessions, f.world, WORLD, { deadlineClock: f.clock });
    pickup.pickup({ dropId: fresh.id, receiver: { clientId: 2, entity } }); await pickup.settle(); assert.equal(pickup.drain()[0].state, 'applied');
    assert.equal(f.world.drops.size, 0); assert.equal((await f.base.loadUnique(incomingUid)).holder, accounts[1]);
    assert.equal((await f.base.loadUnique(incomingUid)).version, 4);
  } finally { await f.close(); }
});

test('new expired source can return again with another generation and a fresh local ID', async () => {
  const f = await setup();
  try {
    await ready(f); assert.equal(f.returner.drain()[0].state, 'applied'); f.drop = [...f.world.drops.values()][0];
    f.world.tick = f.drop.t + 1; const first = f.drop.id; await ready(f); assert.equal(f.returner.drain()[0].state, 'applied');
    assert.equal(f.world.drops.size, 1); assert.equal(f.world.drops.has(first), false); assert.equal((await f.base.loadUnique(incomingUid)).version, 4);
  } finally { await f.close(); }
});

for (const bad of [null, undefined, {}, makeClock({ localTick: 7, durableTick: 100 }, 'other')]) test('genuine same-world clock required ' + String(bad), async () => {
  const f = await setup();
  try { assert.throws(() => new PearlReturnStaging(f.sessions, f.world, WORLD, { deadlineClock: bad }), { code: 'configuration' }); }
  finally { await f.close(); }
});

test('overflow target deadline is rejected before IO and leaves no local claim', async () => {
  const f = await setup();
  try {
    const at = f.world.tick; f.clock = makeClock({ localTick: at, durableTick: Number.MAX_SAFE_INTEGER - 5 });
    const ground = { x: f.drop.x, z: f.drop.z, availableAt: f.clock.at(at) - 20, returnAt: f.clock.at(at) - 1 };
    Object.assign(f.drop, f.clock.project(ground, 'pearl'));
    f.returner = new PearlReturnStaging(f.sessions, f.world, WORLD, { deadlineClock: f.clock });
    const before = state(f.world); assert.throws(() => f.returner.return(command(f))); assert.deepEqual(state(f.world), before);
    f.returner.assertPublishable(); f.returner.gate.assertWorldAvailable();
  } finally { await f.close(); }
});


test('rollback restores source iteration order with unrelated drops and preserves their identities', async () => {
  const f = await setup();
  try {
    const other = { id: 800, kind: 'potion', to: 0, x: f.drop.x + 50, z: f.drop.z, pickAt: f.world.tick + 100, t: f.world.tick + 200 };
    f.world.drops.set(other.id, other); const source = f.drop, before = state(f.world);
    await ready(f); const release = f.returner.gate.release;
    f.returner.gate.release = () => { throw new StoreError('effect'); };
    assert.equal(f.returner.drain()[0].state, 'fenced'); f.returner.gate.release = release;
    assert.deepEqual(state(f.world), before); assert.equal(f.world.drops.get(source.id), source); assert.equal(f.world.drops.get(other.id), other);
    assert.deepEqual([...f.world.drops.keys()], [source.id, other.id]);
  } finally { await f.close(); }
});

test('in-place terrain change at captured destination is detected without reselection', async () => {
  const f = await setup();
  try {
    const map = f.world.map; let changed = false;
    f.world.map = { ...map, groundAt(x, z) { return map.groundAt(x, z) + (changed ? 10 : 0); } };
    await ready(f); changed = true; const before = state(f.world);
    assert.equal(f.returner.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
  } finally { await f.close(); }
});

test('terrain fallback preserves original helper RNG draws and spawn destination', async () => {
  const f = await setup();
  try {
    const original = f.world.map;
    f.world.map = { ...original, groundAt: () => 20, onDock: () => false, queryColliders: () => [], colliders: [] };
    const want = expected(f); await ready(f); assert.equal(f.returner.drain()[0].state, 'applied');
    const [d] = f.world.drops.values(); assert.deepEqual(d, want.target);
    assert.equal(d.x, original.landmarks.spawn.x); assert.equal(d.z, original.landmarks.spawn.z);
    assert.equal(f.world.lootRng.state(), want.view.lootRng.state());
  } finally { await f.close(); }
});

test('drift during independent source reads stops dispatch and leaves no return receipt', async () => {
  const f = await setup(), held = deferred();
  try {
    const load = f.store.loadPearlLocation; f.store.loadPearlLocation = async uid => { await held.promise; return load(uid); };
    const h = f.returner.return(command(f)); await new Promise(resolve => setImmediate(resolve)); f.world.lootRng();
    const before = state(f.world); held.resolve(); await f.returner.settle();
    assert.equal(f.returner.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
    assert.equal(await f.base.loadPearlGroundOperation(h.operationId), null);
  } finally { held.resolve(); await f.close(); }
});


test('capture callbacks cannot start a second return owner before the RNG claim is installed', async () => {
  const f = await setup();
  try {
    const original = f.world.map, other = new PearlReturnStaging(f.sessions, f.world, WORLD, { deadlineClock: f.clock });
    let attempts = 0;
    f.world.map = { ...original, groundAt(x, z) {
      attempts++; assert.throws(() => other.return(command(f)), { code: 'busy' }); return original.groundAt(x, z);
    } };
    await ready(f); assert.equal(f.returner.drain()[0].state, 'applied'); assert.ok(attempts > 0);
    other.assertPublishable();
  } finally { await f.close(); }
});
