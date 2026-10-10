import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { createMemoryStore, StoreError } from '../server/store.mjs';
import { EconomicOperationError, economicOperation } from '../server/economicOperation.mjs';
import { upgradeTimingState } from '../server/resourceState.mjs';

const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const worldId = 'world:salty-shore';
const seed = 77;
const worldData = () => ({ v: 1, seed, economy: new Economy(seed).serialize() });
const accountProfile = () => {
  const profile = newProfile();
  profile.gold = 500;
  return profile;
};
const command = (operationId, changes = {}) => ({ type: 'commerce', op: 'buy', opId: operationId,
  town: 'aldea', g: 'madera', n: 2, expectedTotal: 20, ...changes });
function request(operationId, { profile = accountProfile(), world = worldData(), ack = null,
  expectedProfileVersion = 1, expectedWorldVersion = 1, command: cmd = command(operationId) } = {}) {
  return { operationId, request: { world: worldId, account: id(1), command: cmd,
    expectedProfileVersion, expectedWorldVersion, profile, worldData: world,
    ack: ack ?? { type: cmd.type, op: cmd.op, opId: cmd.opId, ok: true, why: '', rev: 1 } } };
}
async function seeded() {
  const store = createMemoryStore(), profile = accountProfile(), world = worldData();
  await store.initializeProfile(id(1), profile);
  await store.saveWorld(worldId, world, 0);
  return { store, profile, world };
}

test('v3 economic receipts preserve workshop metadata and derived pack limits outside paid workshop edits', async () => {
  const { store, profile, world } = await seeded();
  world.resources = upgradeTimingState({ v: 1, tick: 100,
    nodes: [{ id: 'palm-1', kind: 'palm', rev: 1, hits: 0, readyAt: 0 }], cooldowns: {} });
  await store.saveWorld(worldId, world, 1);
  for (const [i, mutate] of [
    p => { p.workshop.boards = 10; p.workshop.storageCredit = true; },
    p => { p.carry.backpack = 1; p.eco.pack.cap = 30; },
  ].entries()) {
    const next = structuredClone(profile); mutate(next);
    const result = await store.commitEconomicOperation(request(id(110 + i), { profile: next, world, expectedWorldVersion: 2 }));
    assert.equal(result.ok, false);
    assert.deepEqual(await store.loadProfile(id(1)), { data: profile, version: 1 });
    assert.equal(await store.loadEconomicOperation(id(110 + i)), null);
  }
});

test('memory economic operation commits profile, world and immutable receipt together; exact replay is historical', async () => {
  const { store, profile, world } = await seeded(), opId = id(10);
  const nextProfile = structuredClone(profile); nextProfile.gold -= 20; nextProfile.eco.pack.goods.madera = 2;
  const nextWorld = structuredClone(world); nextWorld.economy.markets.aldea.stock.madera -= 2;
  const raw = request(opId, { profile: nextProfile, world: nextWorld });
  const result = await store.commitEconomicOperation(raw);
  assert.deepEqual(result, { ok: true, replay: false, profileVersion: 2, worldVersion: 2, ack: raw.request.ack });
  assert.deepEqual(await store.loadProfile(id(1)), { data: nextProfile, version: 2 });
  assert.deepEqual(await store.loadWorld(worldId), { data: nextWorld, version: 2 });
  assert.deepEqual(await store.loadEconomicOperation(opId), { request: raw.request, result });
  assert.deepEqual(await store.commitEconomicOperation(raw), { ...result, replay: true });

  const altered = structuredClone(raw); altered.request.ack.rev++;
  assert.deepEqual(await store.commitEconomicOperation(altered), { ok: false, why: 'operation' });
  assert.deepEqual(await store.loadProfile(id(1)), { data: nextProfile, version: 2 });
});

test('client operation IDs remain opaque strings and receipt UUID reuse requires the exact command', async () => {
  const { store } = await seeded(), receiptId = id(12);
  const raw = request(receiptId, { command: command(receiptId, { opId: 'ui_buy_12' }) });
  const first = await store.commitEconomicOperation(raw);
  assert.equal(first.ok, true);
  assert.equal(first.ack.opId, 'ui_buy_12');
  assert.deepEqual(await store.commitEconomicOperation(raw), { ...first, replay: true });
  const reused = structuredClone(raw);
  reused.request.command.op = 'sell'; reused.request.ack.op = 'sell';
  assert.deepEqual(await store.commitEconomicOperation(reused), { ok: false, why: 'operation' });
});

test('terminal gameplay denial receives a durable receipt without changing candidate snapshots', async () => {
  const { store, profile, world } = await seeded(), opId = id(20);
  const denied = request(opId, { ack: { type: 'commerce', op: 'buy', opId, ok: false, why: 'price', rev: 0 } });
  const first = await store.commitEconomicOperation(denied);
  assert.deepEqual(first, { ok: true, replay: false, profileVersion: 2, worldVersion: 2, ack: denied.request.ack });
  assert.deepEqual(await store.loadProfile(id(1)), { data: profile, version: 2 });
  assert.deepEqual(await store.loadWorld(worldId), { data: world, version: 2 });

  const laterProfile = structuredClone(profile); laterProfile.gold += 7;
  const later = request(id(21), { profile: laterProfile, world, expectedProfileVersion: 2, expectedWorldVersion: 2 });
  await store.commitEconomicOperation(later);
  assert.deepEqual(await store.commitEconomicOperation(denied), { ...first, replay: true });
  assert.deepEqual(await store.loadProfile(id(1)), { data: laterProfile, version: 3 }, 'replay does not restore an old snapshot');
});

test('community contribution uses the same profile, world and receipt authority', async () => {
  const { store, profile, world } = await seeded(), opId = id(25);
  profile.eco.pack.goods.madera = 3;
  await store.saveProfile(id(1), profile, 1);
  const nextProfile = structuredClone(profile); delete nextProfile.eco.pack.goods.madera;
  const nextWorld = structuredClone(world);
  nextWorld.community = { projects: { 'salty:hall': { version: 2, contributed: { madera: 3 } } } };
  const cmd = { type: 'community', op: 'contribute', opId, projectId: 'salty:hall', good: 'madera', amount: 3, expectedRev: 1 };
  const raw = request(opId, { profile: nextProfile, world: nextWorld, expectedProfileVersion: 2,
    command: cmd, ack: { type: 'community', op: 'contribute', opId, ok: true, why: '', rev: 2, accepted: 3 } });
  assert.deepEqual(await store.commitEconomicOperation(raw), { ok: true, replay: false,
    profileVersion: 3, worldVersion: 2, ack: raw.request.ack });
  assert.deepEqual(await store.loadProfile(id(1)), { data: nextProfile, version: 3 });
  assert.deepEqual(await store.loadWorld(worldId), { data: nextWorld, version: 2 });
});

test('ordinary world saves preserve committed community metadata while allowing unchanged snapshots', async () => {
  const { store, profile, world } = await seeded();
  const initialCommunity = { v: 1, epoch: id(60), project: { id: 'salty-shore-carpentry', version: 1,
    requirements: { madera: 4, piedra: 2 }, contributed: { madera: 0, piedra: 0 } } };
  assert.deepEqual(await store.saveWorld(worldId, { ...world, community: initialCommunity }, 1), { ok: true, version: 2 },
    'startup may add community metadata to an older world row');

  const nextWorld = { ...world, community: structuredClone(initialCommunity) };
  nextWorld.community.project.version = 2; nextWorld.community.project.contributed.madera = 2;
  const operation = request(id(61), { world: nextWorld, expectedWorldVersion: 2 });
  assert.equal((await store.commitEconomicOperation(operation)).worldVersion, 3);

  const ordinary = structuredClone(nextWorld); ordinary.economy.hours++;
  assert.deepEqual(await store.saveWorld(worldId, ordinary, 3), { ok: true, version: 4 },
    'an ordinary economy snapshot can advance while preserving the exact project epoch and progress');
  const omitted = structuredClone(ordinary); delete omitted.community;
  assert.deepEqual(await store.saveWorld(worldId, omitted, 4), { ok: false, why: 'conflict' },
    'a legacy writer that omits committed project data cannot erase it');
  const altered = structuredClone(ordinary); altered.community.project.contributed.madera = 1;
  assert.deepEqual(await store.saveWorld(worldId, altered, 4), { ok: false, why: 'conflict' },
    'an ordinary snapshot cannot roll back project progress');
  assert.deepEqual(await store.loadWorld(worldId), { data: ordinary, version: 4 });
});

test('simultaneous economic commits using one profile and world baseline admit one winner', async () => {
  const { store, profile, world } = await seeded();
  const firstProfile = structuredClone(profile); firstProfile.gold -= 10;
  const secondProfile = structuredClone(profile); secondProfile.gold -= 20;
  const first = request(id(26), { profile: firstProfile, world });
  const second = request(id(27), { profile: secondProfile, world,
    ack: { type: 'commerce', op: 'buy', opId: id(27), ok: true, why: '', rev: 1 } });
  const results = await Promise.all([store.commitEconomicOperation(first), store.commitEconomicOperation(second)]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => result.why === 'conflict').length, 1);
  assert.equal((await store.loadProfile(id(1))).version, 2);
  assert.equal((await store.loadWorld(worldId)).version, 2);
});

test('stale profile or world CAS changes neither row and creates no receipt', async () => {
  const { store, profile, world } = await seeded(), raw = request(id(30), { expectedWorldVersion: 2 });
  assert.deepEqual(await store.commitEconomicOperation(raw), { ok: false, why: 'conflict' });
  assert.deepEqual(await store.loadProfile(id(1)), { data: profile, version: 1 });
  assert.deepEqual(await store.loadWorld(worldId), { data: world, version: 1 });
  assert.equal(await store.loadEconomicOperation(raw.operationId), null);
});

test('economic UUIDs share memory receipt and pending-intent namespaces with other M5 families', async () => {
  const { store } = await seeded(), opId = id(40);
  const clock = await store.commitGroundClock({ operationId: opId, world: worldId,
    expectedVersion: 0, expectedTick: 0, tick: 1 });
  assert.equal(clock.ok, true);
  assert.deepEqual(await store.commitEconomicOperation(request(opId)), { ok: false, why: 'operation' });

  const economicId = id(41), receipt = await store.commitEconomicOperation(request(economicId));
  assert.equal(receipt.ok, true);
  const journals = (await import('../server/pearlJournal.mjs')).createMemoryPearlJournals(store);
  await assert.rejects(journals(worldId).prepare('pearl', { operationId: economicId, uid: 'pearl:test', kind: 'brasa',
    from: null, to: null, expectedVersion: 0, profiles: [] }), error => error instanceof StoreError && error.code === 'operation');
});

test('economic snapshots cannot rewrite managed pearl ownership', async () => {
  const { store, profile, world } = await seeded(), uid = 'managed-pearl:one';
  const withPearl = structuredClone(profile);
  withPearl.pearls.bag.push({ uid, kind: 'brasa' });
  const minted = await store.commitPearl({ operationId: id(45), uid, kind: 'brasa', from: null, to: id(1),
    expectedVersion: 0, profiles: [{ id: id(1), expectedVersion: 1, data: withPearl }] });
  assert.equal(minted.ok, true);
  const invalid = structuredClone(withPearl); invalid.pearls.bag = [];
  const raw = request(id(46), { profile: invalid, world, expectedProfileVersion: 2, expectedWorldVersion: 1 });
  await assert.rejects(store.commitEconomicOperation(raw), error => error instanceof StoreError && error.code === 'ownership');
  assert.deepEqual(await store.loadProfile(id(1)), { data: withPearl, version: 2 });
  assert.deepEqual(await store.loadWorld(worldId), { data: world, version: 1 });
  assert.equal(await store.loadEconomicOperation(raw.operationId), null);
});

test('contract rejects open commands, foreign ACK routing, noncanonical profiles and oversized snapshots', () => {
  const valid = request(id(50));
  for (const mutate of [
    r => { r.request.command.extra = true; },
    r => { r.request.ack.to = 9; },
    r => { r.request.command.opId = id(51); },
    r => { r.request.profile.unrecognized = true; },
    r => { r.request.worldData.community = 'invalid'; },
  ]) {
    const raw = structuredClone(valid); mutate(raw);
    assert.throws(() => economicOperation(raw), EconomicOperationError);
  }
  const tooLarge = request(id(52)); tooLarge.request.worldData.community = { note: 'x'.repeat(2 * 1024 * 1024) };
  assert.throws(() => economicOperation(tooLarge), EconomicOperationError);
});

test('contract enforces the host contribution ceiling and exact client operation ID ACK', () => {
  const receiptId = id(53);
  const cmd = { type: 'community', op: 'contribute', opId: 'project-53', projectId: 'salty:hall',
    good: 'madera', amount: 500, expectedRev: 1 };
  const raw = request(receiptId, { command: cmd, ack: { type: cmd.type, op: cmd.op, opId: cmd.opId,
    ok: true, why: '', rev: 2, accepted: 500 } });
  assert.equal(economicOperation(raw).request.command.opId, 'project-53');
  raw.request.command.amount = 501;
  assert.throws(() => economicOperation(raw), EconomicOperationError);
});
