import test from 'node:test';
import assert from 'node:assert/strict';
import { PearlPickupStaging } from '../server/pearlPickupStaging.mjs';
import { PearlStaging } from '../server/pearlStaging.mjs';
import { GroundClockEpoch } from '../server/groundClockSession.mjs';
import { GroundDeadlineClock } from '../server/groundDeadlineClock.mjs';
import { StoreError } from '../server/store.mjs';
import { pickPearl, returnPearl } from '../src/sim/systems/pearls.js';
import { stepDrops } from '../src/sim/systems/inventory.js';
import { fixture, WORLD, incomingUid, accounts, state, deferred } from './helpers/pearl-replace-staging.mjs';

const clone = structuredClone;
const clock = (anchor = { localTick: 7, durableTick: 2 ** 40 }, worldId = WORLD) => new GroundDeadlineClock({
  worldId, sourceDomain: 'durable-ground-v1', epoch: new GroundClockEpoch(anchor) });
const receiver = (f, i = 1) => ({ clientId: i + 1, entity: f.entities[i] });
const command = (f, i = 1) => ({ dropId: f.drop.id, receiver: receiver(f, i) });
async function setup(options = {}) {
  const f = await fixture(options); f.clock = clock(); f.world.tick = 11;
  const leave = new PearlStaging(f.sessions, f.world, WORLD, { deadlineClock: f.clock });
  leave.request({ action: 'leave', uid: incomingUid, source: receiver(f, 0) });
  await leave.settle(); assert.equal(leave.drain()[0].state, 'applied'); await f.sessions.flush();
  f.drop = [...f.world.drops.values()][0]; f.world.tick = f.drop.pickAt;
  for (const e of f.entities) { f.world.ecs.x[e] = f.drop.x; f.world.ecs.z[e] = f.drop.z; }
  f.world.events.length = 0; f.world.profileDirty.clear();
  f.pickup = new PearlPickupStaging(f.sessions, f.world, WORLD, { deadlineClock: f.clock });
  return f;
}
async function ready(f) {
  const handle = f.pickup.pickup(command(f)); await f.pickup.settle();
  const ctx = f.pickup.operations.get(handle.operationId); assert.equal(ctx.state, 'ready'); return { handle, ctx };
}
function helper(f) {
  const d = clone(f.drop); delete d.groundClock;
  const view = { tick: f.world.tick, profiles: clone(f.world.profiles), drops: new Map([[d.id, d]]),
    pearlLedger: clone(f.world.pearlLedger), profileDirty: new Set(), events: [], emit(e) { this.events.push(clone(e)); } };
  assert.equal(pickPearl(view, d, f.entities[1]), true); return view;
}

test('capture and receipt leave World untouched; one drain matches helper and durable destination', async () => {
  const f = await setup();
  try {
    const expected = helper(f), before = state(f.world), h = f.pickup.pickup(command(f));
    assert.deepEqual(state(f.world), before); assert.deepEqual(f.pickup.drain(), []);
    assert.throws(() => f.pickup.assertPublishable(2), { code: 'busy' });
    assert.throws(() => f.sessions.save(2, f.world.profiles.get(f.entities[1])), { code: 'busy' });
    await f.pickup.settle(); assert.deepEqual(state(f.world), before);
    const ctx = f.pickup.operations.get(h.operationId);
    assert.equal(ctx.state, 'ready'); assert.equal(ctx.request.expectedVersion, 2);
    assert.equal(ctx.request.from, null); assert.equal(ctx.request.to, accounts[1]); assert.equal(ctx.request.ground, null);
    assert.equal(Object.isFrozen(ctx.request.profiles[0].data), true);
    assert.equal((await f.base.loadUnique(incomingUid)).holder, accounts[1]);
    assert.deepEqual(f.pickup.drain(), [{ operationId: h.operationId, state: 'applied' }]);
    assert.deepEqual(f.world.profiles.get(f.entities[1]).pearls, expected.profiles.get(f.entities[1]).pearls);
    assert.deepEqual(f.world.events.map(({ elem, ...e }) => e), expected.events);
    assert.equal(f.world.drops.size, 0); assert.deepEqual(f.world.pearlLedger.get(incomingUid), expected.pearlLedger.get(incomingUid));
    assert.equal(JSON.stringify(f.world.events).includes('groundClock'), false);
    const applied = state(f.world); assert.deepEqual(f.pickup.drain(), []); assert.deepEqual(state(f.world), applied);
    await f.sessions.flush(); assert.deepEqual((await f.base.loadProfile(accounts[1])).data, f.world.profiles.get(f.entities[1]));
    assert.deepEqual(await f.base.loadPearlLocation(incomingUid), { world: WORLD, ground: null, version: 3 });
  } finally { await f.close(); }
});

test('source UID reservation excludes competing receivers and coordinators before any second IO', async () => {
  const f = await setup();
  try {
    f.pickup.pickup(command(f));
    assert.throws(() => f.pickup.pickup(command(f, 0)), { code: 'busy' });
    const other = new PearlPickupStaging(f.sessions, f.world, WORLD, { deadlineClock: f.clock });
    assert.throws(() => other.pickup(command(f, 0)), { code: 'busy' });
    await f.pickup.settle(); assert.equal(f.pickup.drain()[0].state, 'applied');
    assert.equal((await f.base.loadUnique(incomingUid)).version, 3);
    assert.throws(() => other.pickup(command(f))); assert.deepEqual(other.drain(), []);
  } finally { await f.close(); }
});

test('the reservation also protects every existing receiver pearl', async () => {
  const f = await setup();
  try {
    const held = f.world.profiles.get(f.entities[0]).pearls.bag[0].uid;
    f.pickup.pickup(command(f, 0));
    assert.throws(() => f.pickup.gate.assertAvailable({ accounts: [accounts[0]], uids: [held] }), { code: 'busy' });
    const transfer = new PearlStaging(f.sessions, f.world, WORLD);
    assert.throws(() => transfer.request({ action: 'give', uid: held, source: receiver(f, 0), target: receiver(f, 1) }), { code: 'busy' });
    await f.pickup.settle(); assert.equal(f.pickup.drain()[0].state, 'applied');
    await f.sessions.flush(); f.pickup.gate.assertAvailable({ uids: [held, incomingUid] });
  } finally { await f.close(); }
});

for (const [name, alter] of [
  ['early', f => { f.world.tick = f.drop.pickAt - 1; }],
  ['returned window', f => { f.world.tick = f.drop.t + 1; }],
  ['far', f => { f.world.ecs.x[f.entities[1]] += 10; }],
  ['dead', f => { f.world.ecs.dead[f.entities[1]] = 1; }],
  ['ledger mismatch', f => { f.world.pearlLedger.get(incomingUid).drop++; }],
  ['missing marker', f => { delete f.drop.groundClock; }],
  ['wrong marker world', f => { f.drop.groundClock.world = 'other-world'; }],
  ['wrong projection', f => { f.drop.pickAt++; }],
  ['duplicate source', f => { const d = clone(f.drop); d.id = 500; f.world.drops.set(500, d); }],
]) test(name + ' denies synchronously without IO, events or held lanes', async () => {
  const f = await setup(); let reads = 0, commits = 0;
  try {
    const load = f.store.loadUnique, commit = f.store.commitPearlGround;
    f.store.loadUnique = (...a) => { reads++; return load(...a); }; f.store.commitPearlGround = (...a) => { commits++; return commit(...a); };
    alter(f); const before = state(f.world); assert.throws(() => f.pickup.pickup(command(f)));
    assert.deepEqual(state(f.world), before); assert.equal(reads + commits, 0); assert.equal(f.pickup.operations.size, 0);
    f.pickup.gate.assertWorldAvailable();
  } finally { await f.close(); }
});

test('full pearl bag denial remains detached and does not add native full or denial flags', async () => {
  const f = await setup();
  try {
    const p = f.world.profiles.get(f.entities[1]);
    for (let i = 0; i < 8; i++) { const q = { uid: 'full-' + i, kind: 'brasa' }; p.pearls.bag.push(q);
      f.world.pearlLedger.set(q.uid, { owner: p.pirateId, entity: f.entities[1], place: 'profile' }); }
    const before = state(f.world); assert.throws(() => f.pickup.pickup(command(f)), { code: 'full' });
    assert.deepEqual(state(f.world), before); assert.equal(Object.hasOwn(f.drop, 'full'), false); f.pickup.gate.assertWorldAvailable();
  } finally { await f.close(); }
});

test('strict selectors and hostile source getters/proxies run no callbacks', async () => {
  const f = await setup(); let callbacks = 0;
  try {
    for (const bad of [{ ...command(f), uid: incomingUid }, { ...command(f), at: 0 }, { ...command(f), operationId: accounts[0] },
      { ...command(f), receiver: { ...receiver(f), account: accounts[0] } },
      new Proxy(command(f), { getPrototypeOf() { callbacks++; throw Error('trap'); } }),
      Object.defineProperty({}, 'dropId', { enumerable: true, get() { callbacks++; return f.drop.id; } })]) assert.throws(() => f.pickup.pickup(bad));
    const original = f.drop;
    f.world.drops.set(original.id, new Proxy(original, { ownKeys() { callbacks++; throw Error('trap'); } }));
    assert.throws(() => f.pickup.pickup(command(f))); f.world.drops.set(original.id, original);
    assert.equal(callbacks, 0); f.pickup.gate.assertWorldAvailable();
  } finally { await f.close(); }
});

test('constructor requires a genuine same-world clock and never calls hostile clock objects', async () => {
  const f = await setup(); let callbacks = 0;
  try {
    for (const bad of [undefined, null, clock(undefined, 'other-world'), Object.create(GroundDeadlineClock.prototype),
      new Proxy(clock(), { getPrototypeOf() { callbacks++; throw Error('trap'); } })])
      assert.throws(() => new PearlPickupStaging(f.sessions, f.world, WORLD, { deadlineClock: bad }), { code: 'configuration' });
    assert.equal(callbacks, 0);
  } finally { await f.close(); }
});

for (const [name, mutate] of [
  ['missing unique', () => null], ['foreign holder', row => ({ ...row, holder: accounts[0] })],
  ['wrong kind', row => ({ ...row, kind: 'pearl:tinta' })], ['terminal generation', row => ({ ...row, version: 2147483647 })],
]) test(name + ' rejects durable source before pickup commit', async () => {
  const f = await setup(); let commits = 0;
  try { const load = f.store.loadUnique, commit = f.store.commitPearlGround;
    f.store.loadUnique = async uid => uid === incomingUid ? mutate(await load(uid)) : load(uid);
    f.store.commitPearlGround = (...a) => { commits++; return commit(...a); };
    const before = state(f.world), h = f.pickup.pickup(command(f)); await f.pickup.settle();
    assert.equal(f.pickup.drain()[0].state, 'fenced'); assert.equal(commits, 0); assert.deepEqual(state(f.world), before);
    assert.equal(await f.base.loadPearlGroundOperation(h.operationId), null);
  } finally { await f.close(); }
});

for (const [name, mutate] of [
  ['missing location', () => null], ['foreign world', row => ({ ...row, world: 'other-world' })],
  ['version mismatch', row => ({ ...row, version: row.version + 1 })],
  ['ground coordinate mismatch', row => ({ ...row, ground: { ...row.ground, x: row.ground.x + 1 } })],
  ['ground deadline mismatch', row => ({ ...row, ground: { ...row.ground, returnAt: row.ground.returnAt + 1 } })],
]) test(name + ' rejects durable ground before pickup commit', async () => {
  const f = await setup(); let commits = 0;
  try { const load = f.store.loadPearlLocation, commit = f.store.commitPearlGround;
    f.store.loadPearlLocation = async uid => uid === incomingUid ? mutate(await load(uid)) : load(uid);
    f.store.commitPearlGround = (...a) => { commits++; return commit(...a); };
    const before = state(f.world); f.pickup.pickup(command(f)); await f.pickup.settle();
    assert.equal(f.pickup.drain()[0].state, 'fenced'); assert.equal(commits, 0); assert.deepEqual(state(f.world), before);
  } finally { await f.close(); }
});

for (const [name, mutate] of [
  ['request replacement', (f, ctx) => { ctx.request = clone(ctx.request); }],
  ['false receipt', (f, ctx) => { ctx.receipt = { ok: false, why: 'conflict' }; }],
  ['receipt wrong UID', (f, ctx) => { ctx.receipt.unique.uid = 'wrong'; }],
  ['receipt wrong version', (f, ctx) => { ctx.receipt.location.version++; }],
  ['receipt false destination', (f, ctx) => { ctx.receipt.location.ground = clone(f.drop.groundClock.ground); }],
  ['source replacement', f => { f.world.drops.set(f.drop.id, clone(f.drop)); }],
  ['source marker change', f => { f.drop.groundClock.ground.returnAt++; }],
  ['source marker removed', f => { delete f.drop.groundClock; }],
  ['source ledger change', f => { f.world.pearlLedger.get(incomingUid).owner = 'wrong'; }],
  ['receiver inventory drift', f => { f.world.profiles.get(f.entities[1]).gold++; }],
  ['receiver movement', f => { f.world.ecs.x[f.entities[1]] += 0.1; }],
  ['receiver ECS column replacement', f => { f.world.ecs.hp = clone(f.world.ecs.hp); }],
  ['tick advance', f => { f.world.tick++; }], ['tick rewind', f => { f.world.tick--; }],
  ['death revival invalidation', f => { f.pickup.invalidate(accounts[1]); }],
  ['disconnect', f => { f.sessions.close(2); }],
  ['entity reuse', f => { f.world.ecs.clientId[f.entities[1]] = 99; }],
]) test(name + ' after receipt fences without local publication or another commit', async () => {
  const f = await setup();
  try { const { handle, ctx } = await ready(f), receipt = await f.base.loadPearlGroundOperation(handle.operationId);
    mutate(f, ctx); const before = state(f.world); assert.equal(f.pickup.drain()[0].state, 'fenced');
    assert.deepEqual(state(f.world), before); assert.deepEqual(await f.base.loadPearlGroundOperation(handle.operationId), receipt);
    assert.equal((await f.base.loadUnique(incomingUid)).holder, accounts[1]); assert.deepEqual(f.pickup.drain(), []);
    assert.throws(() => f.pickup.gate.assertWorldAvailable(), { code: 'busy' });
  } finally { await f.close(); }
});

test('lost reply retries identical UUID/request and performs one pickup', async () => {
  const f = await setup(); const sent = []; let lost = false;
  try { const commit = f.store.commitPearlGround;
    f.store.commitPearlGround = async raw => { sent.push(clone(raw)); const result = await commit(raw);
      if (!lost) { lost = true; throw new StoreError('unavailable'); } return result; };
    const before = state(f.world); const { handle } = await ready(f); assert.deepEqual(state(f.world), before);
    assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]); assert.equal(sent[0].operationId, handle.operationId);
    assert.equal(f.pickup.drain()[0].state, 'applied'); assert.deepEqual(f.pickup.drain(), []);
    assert.equal(f.world.events.filter(e => e.type === 'pickup').length, 1); assert.equal((await f.base.loadUnique(incomingUid)).version, 3);
    await f.sessions.flush();
  } finally { await f.close(); }
});

test('postreceipt save failure restores exact profile/drop/marker/ledger/dirty/events and leaves receipt', async () => {
  const f = await setup();
  try { const before = state(f.world), original = f.drop, { handle } = await ready(f);
    f.sessions.save = () => { throw new StoreError('unavailable'); };
    assert.equal(f.pickup.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
    assert.equal(f.world.drops.get(original.id), original); assert.equal((await f.base.loadPearlGroundOperation(handle.operationId)).result.ok, true);
    assert.equal((await f.base.loadUnique(incomingUid)).holder, accounts[1]); assert.deepEqual(f.pickup.drain(), []);
  } finally { await f.close(); }
});

test('event decoration failure cannot leak pickup or consume source', async () => {
  const f = await setup();
  try { const before = state(f.world); await ready(f); f.world.emit = () => { throw new Error('decoration'); };
    assert.equal(f.pickup.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
  } finally { await f.close(); }
});

test('ECS progress is captured before IO and persisted with the pickup while the tick stays held', async () => {
  const f = await setup();
  try { const e = f.entities[1]; f.world.ecs.xp[e] = 28.127; f.world.ecs.potions[e] = 3;
    const old = state(f.world), { ctx } = await ready(f);
    assert.deepEqual(state(f.world), old); assert.equal(ctx.request.profiles[0].data.xp, 28.13); assert.equal(ctx.request.profiles[0].data.pot, 3);
    assert.equal(f.pickup.drain()[0].state, 'applied'); assert.equal(f.world.profiles.get(e).xp, 28.13);
    assert.equal(f.world.ecs.xp[e], 28.127); await f.sessions.flush();
    assert.equal((await f.base.loadProfile(accounts[1])).data.xp, 28.13);
  } finally { await f.close(); }
});

test('native pick/return and normal stepDrops cannot consume or relocate projected pearl sources', async () => {
  const f = await setup();
  try { const before = state(f.world);
    assert.equal(pickPearl(f.world, f.drop, f.entities[1]), false); assert.equal(returnPearl(f.world, f.drop), false);
    assert.deepEqual(state(f.world), before);
    f.world.tick += (3 - f.world.tick % 3) % 3; const atPick = state(f.world); stepDrops(f.world); assert.deepEqual(state(f.world), atPick);
    f.world.tick = f.drop.t + 3 - f.drop.t % 3; const atReturn = state(f.world); stepDrops(f.world); assert.deepEqual(state(f.world), atReturn);
    for (const value of [undefined, null, {}]) { f.drop.groundClock = value; const invalid = state(f.world);
      assert.equal(pickPearl(f.world, f.drop, f.entities[1]), false); assert.equal(returnPearl(f.world, f.drop), false); assert.deepEqual(state(f.world), invalid); }
  } finally { await f.close(); }
});

test('unmarked native pearl pickup retains its old gameplay behavior', async () => {
  const f = await setup();
  try { delete f.drop.groundClock; assert.equal(pickPearl(f.world, f.drop, f.entities[1]), true);
    assert.equal(f.world.drops.size, 0); assert.equal(f.world.events[0].type, 'pickup'); assert.equal(f.world.events[1].type, 'unloot'); }
  finally { await f.close(); }
});


test('source or held tick drift during pending source read prevents dispatch', async () => {
  const f = await setup(), entered = deferred(), release = deferred(); let commits = 0;
  try { const load = f.store.loadPearlLocation, commit = f.store.commitPearlGround;
    f.store.loadPearlLocation = async uid => { const row = await load(uid); entered.resolve(); await release.promise; return row; };
    f.store.commitPearlGround = (...a) => { commits++; return commit(...a); };
    const handle = f.pickup.pickup(command(f)); await entered.promise; f.world.tick++;
    const before = state(f.world); release.resolve(); await f.pickup.settle();
    assert.equal(f.pickup.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before); assert.equal(commits, 0);
    assert.equal(await f.base.loadPearlGroundOperation(handle.operationId), null);
  } finally { release.resolve(); await f.pickup.settle(); await f.close(); }
});

test('managed version changes before queue dispatch fence pickup rather than consuming a relocated source', async () => {
  const f = await setup(), entered = deferred(), release = deferred();
  try { const load = f.store.loadPearlLocation;
    f.store.loadPearlLocation = async uid => { const row = await load(uid); entered.resolve(); await release.promise; return row; };
    const handle = f.pickup.pickup(command(f)); await entered.promise;
    const ground = clone(f.drop.groundClock.ground); ground.x++;
    const moved = await f.base.commitPearlGround({ operationId: 'de360000-0000-4000-8000-000000000001',
      ...f.drop.pearl, from: null, to: null, world: WORLD, ground, expectedVersion: 2, profiles: [] });
    assert.equal(moved.ok, true); const before = state(f.world); release.resolve(); await f.pickup.settle();
    assert.equal(f.pickup.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
    assert.equal(await f.base.loadPearlGroundOperation(handle.operationId), null);
    assert.equal((await f.base.loadUnique(incomingUid)).holder, null); assert.equal((await f.base.loadUnique(incomingUid)).version, 3);
    assert.deepEqual((await f.base.loadPearlLocation(incomingUid)).ground, ground);
  } finally { release.resolve(); await f.pickup.settle(); await f.close(); }
});

test('both independent source reads are settled if one fails; no unhandled or partial apply', async () => {
  const f = await setup(), release = deferred(); let locationFinished = false;
  try { const load = f.store.loadPearlLocation;
    f.store.loadUnique = async () => { throw new StoreError('unavailable'); };
    f.store.loadPearlLocation = async (...a) => { await release.promise; locationFinished = true; return load(...a); };
    const before = state(f.world); f.pickup.pickup(command(f)); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.pickup.completed.length, 0); release.resolve(); await f.pickup.settle(); assert.equal(locationFinished, true);
    assert.equal(f.pickup.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
  } finally { release.resolve(); await f.pickup.settle(); await f.close(); }
});

test('a forged success reply without the committed profile cannot authorize local pickup', async () => {
  const f = await setup();
  try { const before = state(f.world), commit = f.sessions.commitPearlGround;
    f.sessions.commitPearlGround = async (meta, build, reservation) => {
      const real = await commit.call(f.sessions, meta, build, reservation); real.receipt.location.version++; return real;
    };
    const handle = f.pickup.pickup(command(f)); await f.pickup.settle();
    assert.equal(f.pickup.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
    assert.equal((await f.base.loadPearlGroundOperation(handle.operationId)).result.ok, true);
  } finally { await f.close(); }
});

test('reentrant event decoration is detected even when its exception is swallowed', async () => {
  const f = await setup();
  try { const before = state(f.world); await ready(f); const emit = f.world.emit;
    f.world.emit = function (ev) { try { f.pickup.drain(); } catch {} return emit.call(this, ev); };
    assert.equal(f.pickup.drain()[0].state, 'fenced'); assert.deepEqual(state(f.world), before);
  } finally { await f.close(); }
});


test('past local availability stays negative while durable source ground remains unchanged', async () => {
  const f = await setup();
  try { const ground = clone(f.drop.groundClock.ground), durable = f.clock.at(f.world.tick) + 10;
    f.clock = clock({ localTick: 0, durableTick: durable }); f.world.tick = 0; Object.assign(f.drop, f.clock.project(ground, 'pearl'));
    assert.equal(f.drop.pickAt, -10); f.pickup = new PearlPickupStaging(f.sessions, f.world, WORLD, { deadlineClock: f.clock });
    const before = state(f.world), { ctx } = await ready(f); assert.deepEqual(state(f.world), before);
    assert.equal(ctx.request.expectedVersion, 2); assert.equal(f.pickup.drain()[0].state, 'applied');
    assert.equal(f.world.drops.size, 0); assert.equal((await f.base.loadUnique(incomingUid)).holder, accounts[1]);
  } finally { await f.close(); }
});

test('the last return tick is pickable; a later tick is denied before IO', async () => {
  const f = await setup();
  try { f.world.tick = f.drop.t; await ready(f); assert.equal(f.pickup.drain()[0].state, 'applied'); }
  finally { await f.close(); }
});

for (const [name, anchor, tick] of [
  ['future anchor', { localTick: 42, durableTick: 2 ** 40 + 35 }, 41],
  ['overflow', { localTick: 41, durableTick: Number.MAX_SAFE_INTEGER }, 42],
]) test(name + ' refuses pickup without storage work or reservations', async () => {
  const f = await setup(); let reads = 0;
  try { f.clock = clock(anchor); Object.assign(f.drop, f.clock.project(f.drop.groundClock.ground, 'pearl')); f.world.tick = tick;
    f.pickup = new PearlPickupStaging(f.sessions, f.world, WORLD, { deadlineClock: f.clock });
    f.store.loadUnique = async () => { reads++; throw Error('unexpected read'); };
    const before = state(f.world); assert.throws(() => f.pickup.pickup(command(f))); assert.deepEqual(state(f.world), before);
    assert.equal(reads, 0); f.pickup.gate.assertWorldAvailable();
  } finally { await f.close(); }
});

test('pending saves use the captured progress without escaping the account reservation', async () => {
  const f = await setup();
  try { const h = f.pickup.pickup(command(f)), p = f.world.profiles.get(f.entities[1]);
    f.pickup.save(2, clone(p)); await f.pickup.settle(); const ctx = f.pickup.operations.get(h.operationId);
    assert.equal(ctx.state, 'ready'); f.pickup.save(2, clone(p)); assert.equal(f.sessions.clients.get(2).pending, null);
    assert.equal(f.pickup.drain()[0].state, 'applied'); await f.sessions.flush();
  } finally { await f.close(); }
});

test('other drop proxies and orphan ledger getters are rejected without executing callbacks', async () => {
  const f = await setup(); let callbacks = 0;
  try { f.world.drops.set(500, new Proxy({}, { ownKeys() { callbacks++; throw Error('trap'); } }));
    assert.throws(() => f.pickup.pickup(command(f))); f.world.drops.delete(500);
    f.world.pearlLedger.set('orphan', Object.defineProperty({}, 'place', { enumerable: true, get() { callbacks++; return 'profile'; } }));
    assert.throws(() => f.pickup.pickup(command(f))); f.world.pearlLedger.delete('orphan'); assert.equal(callbacks, 0);
    f.pickup.gate.assertWorldAvailable();
  } finally { await f.close(); }
});
