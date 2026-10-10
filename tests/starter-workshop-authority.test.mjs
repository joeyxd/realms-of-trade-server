import test from 'node:test';
import assert from 'node:assert/strict';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { ACCOUNT_ONE, RESOURCE_WORLD, calmAt, connect, copy, deferred, findNode, makeResourceHost,
  makeResourceStore, startResourceHost, submitAndApply, turn } from './helpers/resource-authority-fixture.mjs';

const options = { loggingOperations: true, artisanOperations: true, workshopOperations: true,
  communityRequirements: { madera: 50, piedra: 20 } };
const profileFor = f => f.host.server.world.profiles.get(f.entity());
const artisan = (p, op, opId, extra = {}) => ({ type: 'artisan', op, opId, expectedRev: p.eco.tradeRev, ...extra });
const receiptId = opId => economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, opId);
async function fixture(t, overrides = {}) {
  const stores = makeResourceStore(overrides);
  const f = await startResourceHost(t, stores.store, { goods: { madera: 5 }, tools: { axe: 1 }, options });
  calmAt(f.host, f.entity(), f.host.server.world.resources.bench);
  return { ...f, ...stores };
}
function onDeck(f, ship) {
  const w = f.host.server.world, raft = w.rafts.get(ship.id), e = f.entity(), ecs = w.ecs;
  const a = ecs.facing[raft.entity];
  calmAt(f.host, e, { x: ecs.x[raft.entity] + Math.cos(a) + Math.sin(a),
    z: ecs.z[raft.entity] - Math.sin(a) + Math.cos(a), y: ecs.y[raft.entity] });
}

test('personal project accepts partial deliveries without practice or community completion and prepays one build', async t => {
  const f = await fixture(t), p = profileFor(f), { host, client } = f;
  const community = copy(host.worldState.community);
  assert.equal(p.progression?.practice?.logging ?? 0, 0);
  const first = artisan(p, 'contribute', 'project-first-five', { amount: 5 });
  assert.equal((await submitAndApply(host, client, first))?.ok, true);
  assert.equal(p.workshop.boards, 5); assert.equal(p.workshop.storageCredit, false);
  p.eco.pack.goods.madera = 5;
  assert.equal((await submitAndApply(host, client, artisan(p, 'contribute', 'project-last-five', { amount: 5 })))?.ok, true);
  assert.equal(p.workshop.boards, 10); assert.equal(p.workshop.storageCredit, true);
  assert.deepEqual(p.progression.knowledge, ['raft_storage']); assert.deepEqual(host.worldState.community, community);
  const ship = p.eco.ships.find(s => s.kind === 'raft'); onDeck(f, ship);
  const placed = await submitAndApply(host, client, { type: 'raft', op: 'place', opId: 'first-prepaid-storage',
    id: ship.id, expectedRev: ship.rev, piece: ['storage', 0, 1, 0, 0] });
  assert.equal(placed?.ok, true, JSON.stringify(placed));
  assert.equal(p.workshop.storageCredit, false); assert.equal(p.eco.pack.goods.madera, undefined);
  assert.equal(ship.hold.cap, 26);
  const beforeReplay = copy(p);
  const replay = await submitAndApply(host, client, first);
  assert.equal(replay?.historical, true); assert.deepEqual(p, beforeReplay);
  const receipt = await f.base.loadEconomicOperation(receiptId('first-prepaid-storage'));
  assert.equal(receipt.request.command.rules, 2);
  assert.equal(receipt.request.before.workshop.storageCredit, true);
  assert.equal(receipt.request.profile.workshop.storageCredit, false);
});

test('crate is crafted at the bench and placed once from its kit without a second material debit', async t => {
  const f = await fixture(t), p = profileFor(f), { host, client } = f;
  assert.equal((await submitAndApply(host, client, artisan(p, 'craftCrate', 'crate-kit')))?.ok, true);
  assert.equal(p.eco.pack.goods.madera, 3); assert.equal(p.workshop.crateKits, 1);
  const ship = p.eco.ships.find(s => s.kind === 'raft'); onDeck(f, ship);
  const cmd = { type: 'raft', op: 'place', opId: 'crate-from-kit', id: ship.id,
    expectedRev: ship.rev, piece: ['crate', 1, 0, 0, 0] };
  const ack = await submitAndApply(host, client, cmd);
  assert.equal(ack?.ok, true, JSON.stringify(ack)); assert.equal(p.workshop.crateKits, 0);
  assert.equal(p.eco.pack.goods.madera, 3); assert.equal(ship.hold.cap, 12);
  const after = copy(p);
  assert.equal((await submitAndApply(host, client, cmd))?.replay, true); assert.deepEqual(p, after);
  const denied = await submitAndApply(host, client, { ...cmd, opId: 'crate-no-kit', expectedRev: ship.rev,
    piece: ['crate', 0, 1, 0, 0] });
  assert.equal(denied?.why, 'crateKit'); assert.deepEqual(p, after);
});

test('held and lost workshop commit cannot publish an early reward or charge a retry twice', async t => {
  const { base } = makeResourceStore(), entered = deferred(), gate = deferred(); let lost = true;
  const store = { ...base, async commitEconomicOperation(input) {
    if (input.request.command.opId !== 'held-project') return base.commitEconomicOperation(input);
    entered.resolve(); await gate.promise;
    const result = await base.commitEconomicOperation(input);
    if (lost) { lost = false; throw new Error('lost response'); }
    return result;
  } };
  const f = await startResourceHost(t, store, { goods: { madera: 5 }, options });
  const p = profileFor(f); calmAt(f.host, f.entity(), f.host.server.world.resources.bench);
  const cmd = artisan(p, 'contribute', 'held-project', { amount: 5 }), before = copy(p);
  f.client.send(cmd); await entered.promise;
  assert.deepEqual(p, before); assert.equal(f.client.events(cmd.opId).length, 0);
  gate.resolve(); await f.host.economicAuthority.settle();
  assert.deepEqual(p, before); assert.equal(f.client.events(cmd.opId).length, 0);
  f.host.server.step(); assert.equal(p.workshop.boards, 5);
  const after = copy(p);
  assert.equal((await submitAndApply(f.host, f.client, cmd))?.replay, true); assert.deepEqual(p, after);
});

test('authoritative timing produces exactly earned logs and rejects a made-up challenge token', async t => {
  const f = await fixture(t), p = profileFor(f), { host, client } = f;
  p.eco.pack.goods = {};
  const node = findNode(host, 'palm'); calmAt(host, f.entity(), node);
  const bad = await submitAndApply(host, client, { type: 'resource', op: 'gather', opId: 'forged-challenge',
    node: node.id, expectedRev: node.rev, challenge: 'made-up-token' });
  assert.equal(bad?.ok, false); assert.equal(node.hits, 0);
  for (let i = 0; i < 3; i++) {
    calmAt(host, f.entity(), node);
    while ((host.server.world.resources.cooldowns.get(f.entity()) || 0) > host.server.world.tick) host.server.step();
    client.send({ type: 'resource', op: 'aim', node: node.id, expectedRev: node.rev });
    const aim = client.ws.messages.filter(m => m.ev?.type === 'loggingAim').at(-1)?.ev;
    assert.equal(aim?.ok, true, JSON.stringify(aim));
    while (host.worldState.resourceTick() < aim.challenge.targetTick) host.server.step();
    const ack = await submitAndApply(host, client, { type: 'resource', op: 'gather', opId: `timed-hit-${i}`,
      node: node.id, expectedRev: node.rev, challenge: aim.challengeId });
    assert.equal(ack?.ok, true, JSON.stringify({ i, ack, status: host.economicAuthority.status() }));
    assert.equal(ack.timing.quality, 1); assert.equal(ack.count, i === 2 ? 6 : 0);
  }
  assert.equal(p.eco.pack.goods.tronco, 6); assert.equal(p.progression.practice.logging, 10);
  const receipt = await f.base.loadEconomicOperation(receiptId('timed-hit-2'));
  assert.equal(receipt.request.worldData.resources.logging[node.id].quality, 3);
});

test('missing workshop SQL readiness blocks admission before world adoption', async () => {
  const { store } = makeResourceStore({ checkStarterWorkshop: async () => { throw new Error('SQL023 unavailable'); } });
  const host = makeResourceHost(store, async () => ACCOUNT_ONE, options);
  await assert.rejects(host.prepare(), /SQL023 unavailable/); assert.equal(host.worldState.ready, false);
});

test('paid second storage debits ten boards and an occupied tile preserves the prepaid credit', async t => {
  const f = await fixture(t), p = profileFor(f), { host, client } = f;
  await submitAndApply(host, client, artisan(p, 'contribute', 'partial', { amount: 5 }));
  p.eco.pack.goods.madera = 5;
  await submitAndApply(host, client, artisan(p, 'contribute', 'finish', { amount: 5 }));
  const ship = p.eco.ships[0]; onDeck(f, ship);
  const before = copy(p);
  const place = piece => ({ type: 'raft', op: 'place', opId: `place-${piece[1]}-${piece[2]}`,
    id: ship.id, expectedRev: ship.rev, piece });
  const occupied = await submitAndApply(host, client, place(['storage', 0, 0, 0, 0]));
  assert.equal(occupied?.ok, false); assert.deepEqual(p, before);
  assert.equal((await submitAndApply(host, client, place(['storage', 0, 1, 0, 0])))?.ok, true);
  p.eco.pack.goods.madera = 6; ship.hold.goods.madera = 4;
  assert.equal((await submitAndApply(host, client, place(['storage', 1, 0, 0, 0])))?.ok, true);
  assert.equal(p.eco.pack.goods.madera, undefined); assert.equal(ship.hold.goods.madera, undefined);
  assert.equal(ship.hold.cap, 46); assert.equal(p.workshop.storageCredit, false);
});

test('partial workshop progress survives host restart and shares the receipt authority with paid fire', async t => {
  const { store, base } = makeResourceStore();
  const f = await startResourceHost(t, store, { goods: { madera: 6 }, options: { ...options, fireOperations: true } });
  const p = profileFor(f); calmAt(f.host, f.entity(), f.host.server.world.resources.bench);
  assert.equal((await submitAndApply(f.host, f.client, artisan(p, 'contribute', 'before-restart', { amount: 5 })))?.ok, true);
  const fire = { type: 'fire', op: 'load', opId: 'workshop-fire', ship: '', part: 'hand', kind: 'handTorch', expectedRev: 0, lit: false };
  assert.equal((await submitAndApply(f.host, f.client, fire))?.ok, true);
  assert.equal(p.workshop.boards, 5); assert.equal(p.eco.pack.maxMass, 18);
  await f.host.close();
  const persisted = await base.loadWorld(RESOURCE_WORLD);
  const resumed = makeResourceHost(store, async () => ACCOUNT_ONE, { ...options, fireOperations: true });
  t.after(() => resumed.close()); await resumed.prepare();
  assert.equal(resumed.worldState.resourceTick(), persisted.data.resources.tick, 'downtime cannot advance the resource clock');
  const client = connect(resumed); client.hello(); await Promise.all([...resumed.joins]);
  const entity = resumed.server.clients.get(client.id).entity, profile = resumed.server.world.profiles.get(entity);
  assert.equal(profile.workshop.boards, 5); assert.equal(profile.workshop.storageCredit, false);
  assert.equal(profile.fire.slots.hand.seconds, 1200); assert.equal(profile.eco.pack.maxMass, 18);
  const replay = await submitAndApply(resumed, client, fire);
  assert.equal(replay?.replay, true); assert.equal(profile.eco.pack.goods.madera, undefined);
});

test('an existing legacy pack adopts the basic carry limits inside its first successful workshop receipt', async t => {
  const { store, base } = makeResourceStore(), legacy = newProfile({ starter: false });
  legacy.eco.pack.goods = { madera: 3 };
  await store.initializeProfile(ACCOUNT_ONE, legacy);
  const host = makeResourceHost(store, async () => ACCOUNT_ONE, options);
  t.after(() => host.close()); await host.prepare();
  const client = connect(host); client.hello(); await Promise.all([...host.joins]);
  const entity = host.server.clients.get(client.id).entity, p = host.server.world.profiles.get(entity);
  assert.equal(p.eco.pack.cap, 10); assert.equal(p.carry, undefined);
  calmAt(host, entity, host.server.world.resources.bench);
  assert.equal((await submitAndApply(host, client, artisan(p, 'contribute', 'legacy-first-board', { amount: 1 })))?.ok, true);
  assert.deepEqual(p.carry, { v: 1, backpack: 0 }); assert.equal(p.eco.pack.cap, 18);
  assert.equal(p.eco.pack.maxMass, 18); assert.equal(p.eco.pack.goods.madera, 2);
  const receipt = await base.loadEconomicOperation(receiptId('legacy-first-board'));
  assert.equal(receipt.request.before.carry, undefined); assert.equal(receipt.request.before.eco.pack.cap, 10);
  assert.equal(receipt.request.profile.eco.pack.cap, 18);
});
