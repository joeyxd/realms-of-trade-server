import test from 'node:test';
import assert from 'node:assert/strict';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { ACCOUNT_ONE, ACCOUNT_TWO, RESOURCE_WORLD, calmAt, connect, copy, deferred, findNode, makeResourceHost,
  makeResourceStore, startResourceHost, submitAndApply, turn } from './helpers/resource-authority-fixture.mjs';

const options = { loggingOperations: true, artisanOperations: true, workshopOperations: true,
  attributeOperations: true, communityRequirements: { madera: 4, piedra: 2 } };
const profileFor = f => f.host.server.world.profiles.get(f.entity());
const command = (profile, op, opId, extra = {}) => ({ type: 'attributes', op, opId,
  expectedRev: profile.eco.tradeRev, ...extra });
const receiptId = opId => economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, opId);

async function fixture(t, overrides = {}) {
  const stores = makeResourceStore(overrides);
  const f = await startResourceHost(t, stores.store, { goods: { madera: 3, hierro: 2 }, options });
  return { ...f, ...stores };
}

async function level(f, value) {
  const p = profileFor(f), w = f.host.server.world;
  p.lvl = value; w.ecs.level[f.entity()] = value;
  p.eco.pack.maxMass = 18 + 2 * (value - 1);
  f.host.profiles.save(f.client.id, p);
  await f.host.profiles.flush();
}

async function waitFor(predicate, message) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await turn(); }
  assert.fail(message);
}

test('attribute commands remain unavailable by default and do not create a receipt', async t => {
  const f = await startResourceHost(t, makeResourceStore().store), { host, client, store } = f;
  const entity = f.entity();
  const profile = host.server.world.profiles.get(entity), before = copy(profile);
  client.send(command(profile, 'adopt', 'disabled-adopt'));
  await turn();
  const ack = client.events('disabled-adopt').at(-1);
  assert.equal(ack?.ok, false); assert.equal(ack?.why, 'disabled');
  assert.equal(await store.loadEconomicOperation(receiptId('disabled-adopt')), null);
  assert.deepEqual(profile, before);
});

test('missing attribute SQL readiness prevents world admission', async () => {
  const { store } = makeResourceStore({ checkAttributeOperations: async () => { throw new Error('SQL attribute readiness unavailable'); } });
  const host = makeResourceHost(store, async () => ACCOUNT_ONE, options);
  await assert.rejects(host.prepare(), /SQL attribute readiness unavailable/);
  assert.equal(host.worldState.ready, false);
  await host.close().catch(() => {});
});

test('explicit adoption initializes level-one legacy profiles without inventing points', async t => {
  const f = await fixture(t), p = profileFor(f), beforeGoods = copy(p.eco.pack.goods);
  assert.equal(p.attr, undefined);
  const ack = await submitAndApply(f.host, f.client, command(p, 'adopt', 'adopt-level-one'));
  assert.equal(ack?.ok, true, JSON.stringify(ack));
  assert.deepEqual(ack.points, { earned: 0, invested: 0, available: 0, resetsLeft: 1 });
  assert.deepEqual(ack.limits, { volume: 18, comfortableMass: 40, maxMass: 50 });
  assert.deepEqual(p.attr, { v: 1, carga: 0, re: 0 });
  assert.equal(p.eco.pack.maxMass, 50);
  assert.deepEqual(p.eco.pack.goods, beforeGoods);
  assert.deepEqual((await f.store.loadEconomicOperation(receiptId('adopt-level-one'))).request.profile.attr, p.attr);
});

test('adoption preserves a legacy carry-less profile and its goods while installing the baseline', async t => {
  const profile = newProfile({ starter: false });
  profile.pirateId = `account:${ACCOUNT_ONE}`;
  profile.lvl = 3;
  profile.eco.pack = { cap: 10, goods: { madera: 2, hierro: 1 } };
  const { store } = makeResourceStore();
  await store.initializeProfile(ACCOUNT_ONE, profile);
  await store.checkResourceOperations();
  const host = makeResourceHost(store, async () => ACCOUNT_ONE, options);
  t.after(async () => { if (!host.closePromise) await host.close().catch(error => { if (error.code !== 'flush') throw error; }); });
  await host.prepare();
  const client = connect(host); client.hello(); await Promise.all([...host.joins]);
  const entity = host.server.clients.get(client.id).entity, live = host.server.world.profiles.get(entity);
  const goods = copy(live.eco.pack.goods);
  const ack = await submitAndApply(host, client, command(live, 'adopt', 'adopt-legacy-carry'));
  assert.equal(ack?.ok, true, JSON.stringify(ack));
  assert.deepEqual(live.attr, { v: 1, carga: 0, re: 0 });
  assert.deepEqual(live.carry, { v: 1, backpack: 0 });
  assert.deepEqual(live.eco.pack.goods, goods);
  assert.equal(live.eco.pack.cap, 18);
  assert.equal(live.eco.pack.maxMass, 50);
});

test('level-three assignment and free reset preserve every carried good', async t => {
  const f = await fixture(t), { host, client } = f;
  await level(f, 3);
  const p = profileFor(f), goods = copy(p.eco.pack.goods);
  const assigned = await submitAndApply(host, client, command(p, 'assign', 'assign-carga', { stat: 'carga', n: 2 }));
  assert.equal(assigned?.ok, true, JSON.stringify(assigned));
  assert.deepEqual(p.attr, { v: 1, carga: 2, re: 0 });
  assert.equal(p.eco.pack.maxMass, 60);
  assert.deepEqual(p.eco.pack.goods, goods);
  const reset = await submitAndApply(host, client, command(p, 'reset', 'reset-carga'));
  assert.equal(reset?.ok, true, JSON.stringify(reset));
  assert.deepEqual(p.attr, { v: 1, carga: 0, re: 1 });
  assert.equal(p.eco.pack.maxMass, 50);
  assert.deepEqual(p.eco.pack.goods, goods);
  const secondReset = await submitAndApply(host, client, command(p, 'reset', 'reset-carga-again'));
  assert.equal(secondReset?.ok, false);
  assert.deepEqual(p.eco.pack.goods, goods);
});

test('deferred commit and lost reply do not ACK early; identical retry replays the exact receipt', async t => {
  const { base, store } = makeResourceStore(), entered = deferred(), release = deferred();
  let commits = 0;
  store.commitEconomicOperation = async input => {
    if (input.request.command.opId !== 'held-attribute') return base.commitEconomicOperation(input);
    commits++; entered.resolve(); await release.promise;
    const result = await base.commitEconomicOperation(input);
    if (commits === 1) throw new Error('injected lost attribute response');
    return result;
  };
  const f = await fixture(t, store), { host, client } = f;
  await level(f, 3);
  const p = profileFor(f), before = copy(p), commandValue = command(p, 'assign', 'held-attribute', { stat: 'carga', n: 1 });
  client.send(commandValue); await entered.promise;
  assert.equal(client.events(commandValue.opId).length, 0);
  assert.deepEqual(p, before);
  host.server.step(); assert.deepEqual(p, before, 'the world boundary stays held during the storage request');
  release.resolve(); await host.economicAuthority.settle();
  assert.equal(client.events(commandValue.opId).length, 0, 'settlement alone cannot publish');
  assert.deepEqual(p, before);
  host.server.step();
  const ack = client.events(commandValue.opId).at(-1);
  assert.equal(ack?.ok, true, JSON.stringify(ack));
  assert.equal(ack.durable, false, 'the memory store does not claim durable storage');
  assert.equal(commits, 1, 'the lost response is reconciled from the receipt without a second commit');
  const after = copy(p);
  const replay = await submitAndApply(host, client, commandValue);
  assert.equal(replay?.replay, true); assert.equal(replay?.historical, true);
  assert.deepEqual(p, after);
});

test('same operation identity cannot be rebound to a different attribute command', async t => {
  const f = await fixture(t); await level(f, 3);
  const p = profileFor(f), original = command(p, 'assign', 'attribute-identity', { stat: 'carga', n: 1 });
  assert.equal((await submitAndApply(f.host, f.client, original))?.ok, true);
  const current = copy(p);
  const changed = await submitAndApply(f.host, f.client, { ...original, n: 2, expectedRev: p.eco.tradeRev });
  assert.equal(changed?.ok, false); assert.equal(changed?.why, 'duplicate');
  assert.deepEqual(p, current);
});

test('stale expectedRev is receipted as a no-op conflict and exact retry replays it', async t => {
  const f = await fixture(t); await level(f, 3);
  const p = profileFor(f), adopted = await submitAndApply(f.host, f.client,
    command(p, 'adopt', 'stale-rev-adopt'));
  assert.equal(adopted?.ok, true, JSON.stringify(adopted));
  const before = copy(p), stale = command(p, 'assign', 'stale-attribute-rev',
    { expectedRev: adopted.rev - 1, stat: 'carga', n: 1 });
  const denied = await submitAndApply(f.host, f.client, stale);
  assert.equal(denied?.ok, false); assert.equal(denied?.why, 'conflict');
  assert.equal(denied?.rev, before.eco.tradeRev);
  assert.deepEqual(p, before, 'stale revision denial leaves attributes, pack and goods untouched');
  assert.equal(f.host.economicAuthority.failed, false);
  const receipt = await f.store.loadEconomicOperation(receiptId(stale.opId));
  assert.equal(receipt.result.ack.ok, false);
  assert.equal(receipt.result.ack.why, 'conflict');
  assert.deepEqual(receipt.request.command, stale);
  assert.deepEqual(receipt.request.profile, before, 'the receipt commits an exact no-op profile snapshot');

  const replay = await submitAndApply(f.host, f.client, stale);
  assert.equal(replay?.ok, false); assert.equal(replay?.why, 'conflict');
  assert.equal(replay?.replay, true); assert.equal(replay?.historical, true);
  assert.deepEqual(p, before);
});

test('restart loads adopted attributes and historical replay does not restore an old profile', async t => {
  const { store } = makeResourceStore(), profile = newProfile();
  profile.pirateId = `account:${ACCOUNT_ONE}`;
  await store.initializeProfile(ACCOUNT_ONE, profile);
  await store.checkResourceOperations();
  const hosts = [];
  t.after(async () => { for (const host of hosts) if (!host.closePromise) await host.close().catch(error => { if (error.code !== 'flush') throw error; }); });
  const first = makeResourceHost(store, async () => ACCOUNT_ONE, options); hosts.push(first); await first.prepare();
  const c1 = connect(first); c1.hello(); await Promise.all([...first.joins]);
  const e1 = first.server.clients.get(c1.id).entity, p1 = first.server.world.profiles.get(e1);
  const adoption = command(p1, 'adopt', 'restart-adoption');
  assert.equal((await submitAndApply(first, c1, adoption))?.ok, true);
  const durable = await store.loadProfile(ACCOUNT_ONE);
  assert.deepEqual(durable.data.attr, { v: 1, carga: 0, re: 0 });
  c1.ws.close(); await first.close();

  const second = makeResourceHost(store, async () => ACCOUNT_ONE, options); hosts.push(second); await second.prepare();
  const c2 = connect(second); c2.hello(); await Promise.all([...second.joins]);
  const e2 = second.server.clients.get(c2.id).entity, p2 = second.server.world.profiles.get(e2);
  assert.deepEqual(p2.attr, durable.data.attr);
  p2.lvl = 3; second.server.world.ecs.level[e2] = 3;
  second.profiles.save(c2.id, p2); await second.profiles.flush();
  const assignment = command(p2, 'assign', 'restart-assignment', { stat: 'carga', n: 2 });
  assert.equal((await submitAndApply(second, c2, assignment))?.ok, true);
  const later = copy(p2);
  const replay = await submitAndApply(second, c2, adoption);
  assert.equal(replay?.replay, true); assert.equal(replay?.historical, true);
  assert.deepEqual(p2, later, 'receipt replay does not replace the newer assigned profile');
});

test('unreadable uncertain commit fences attribute mutations without ACK', async t => {
  const { base, store } = makeResourceStore();
  let dispatched = false;
  store.commitEconomicOperation = async () => { dispatched = true; throw new Error('injected uncertain commit'); };
  store.loadEconomicOperation = async id => dispatched
    ? Promise.reject(new Error('injected receipt read failure'))
    : base.loadEconomicOperation(id);
  const f = await fixture(t, store), { host, client } = f;
  await level(f, 3);
  const p = profileFor(f), before = copy(p), cmd = command(p, 'assign', 'uncertain-attribute', { stat: 'carga', n: 1 });
  client.send(cmd);
  await waitFor(() => host.economicAuthority.failed, 'unknown commit outcome must fence the attribute authority');
  assert.equal(dispatched, true, 'the provider request was sent before the outcome became uncertain');
  assert.equal(host.worldState.failed, true);
  assert.equal(client.events(cmd.opId).length, 0);
  assert.deepEqual(p, before);
  assert.equal(host.economicAuthority.active?.operationId, receiptId(cmd.opId));
  assert.deepEqual(host.economicAuthority.active?.request.command, cmd,
    'the exact command remains attached to the fenced operation for recovery');
  assert.ok(host.economicAuthority.active?.request, 'the immutable request remains available as evidence');
  const tick = host.server.world.tick; host.server.step(); assert.equal(host.server.world.tick, tick);
  assert.equal(host.economicAuthority.status().pending, 1);
});

test('v3 shared Tala award preserves an adopted offline beneficiary through receipt and reconnect', async t => {
  const { store } = makeResourceStore();
  const f = await startResourceHost(t, store, { accounts: [ACCOUNT_ONE, ACCOUNT_TWO], tools: { axe: 1 }, options });
  const { host } = f, one = f.clients.get(ACCOUNT_ONE), two = f.clients.get(ACCOUNT_TWO);
  const entityOne = f.entity(ACCOUNT_ONE), entityTwo = f.entity(ACCOUNT_TWO);
  assert.equal(host.worldState.resources.v, 3);

  const adopted = await submitAndApply(host, one, command(host.server.world.profiles.get(entityOne), 'adopt', 'tala-offline-adopt'));
  assert.equal(adopted?.ok, true, JSON.stringify(adopted));
  const adoptedProfile = host.server.world.profiles.get(entityOne);
  assert.deepEqual(adoptedProfile.attr, { v: 1, carga: 0, re: 0 });
  assert.equal(adoptedProfile.eco.pack.maxMass, 50);
  const goodsBeforeTala = copy(adoptedProfile.eco.pack.goods);

  async function preciseHit(client, entity, opId) {
    const node = findNode(host, 'palm');
    calmAt(host, entity, node);
    client.send({ type: 'resource', op: 'aim', node: node.id, expectedRev: node.rev });
    await turn();
    const aim = client.ws.messages.filter(message => message.ev?.type === 'loggingAim').at(-1)?.ev;
    assert.equal(aim?.ok, true, JSON.stringify(aim));
    while (host.worldState.resourceTick() < aim.challenge.targetTick) assert.equal(host.server.step(), true);
    const live = host.server.world.resources.nodes.get(node.id);
    calmAt(host, entity, live);
    const ack = await submitAndApply(host, client, { type: 'resource', op: 'gather', opId,
      node: live.id, expectedRev: live.rev, challenge: aim.challengeId });
    assert.equal(ack?.ok, true, JSON.stringify(ack));
    assert.equal(ack.timing.quality, 1);
    return ack;
  }

  await preciseHit(one, entityOne, 'tala-adopted-one-hit');
  one.ws.close(); await turn(); await host.profiles.flush();
  assert.equal(host.profiles.accounts.has(ACCOUNT_ONE), false, 'the adopted contributor is offline before completion');
  const offlineBaseline = await store.loadProfile(ACCOUNT_ONE);
  assert.deepEqual(offlineBaseline.data.attr, { v: 1, carga: 0, re: 0 });
  assert.equal(offlineBaseline.data.eco.pack.maxMass, 50);

  await preciseHit(two, entityTwo, 'tala-second-account-first-hit');
  for (let i = 0; i < 55; i++) assert.equal(host.server.step(), true);
  const finalAck = await preciseHit(two, entityTwo, 'tala-second-account-final-hit');
  assert.equal(finalAck.count, 6, 'three base logs plus one for each precise hit');

  const receipt = await store.loadEconomicOperation(economicOperationId(RESOURCE_WORLD, ACCOUNT_TWO, 'tala-second-account-final-hit'));
  const beneficiary = receipt.request.beneficiaries.find(row => row.account === ACCOUNT_ONE);
  assert.ok(beneficiary, 'the durable batch includes the offline contributor');
  assert.deepEqual(beneficiary.before.attr, { v: 1, carga: 0, re: 0 });
  assert.equal(beneficiary.before.eco.pack.maxMass, 50);
  assert.deepEqual(beneficiary.profile.attr, beneficiary.before.attr);
  assert.equal(beneficiary.profile.eco.pack.maxMass, 50);
  assert.deepEqual(beneficiary.profile.eco.pack.goods, goodsBeforeTala, 'offline progression award does not rewrite goods');
  assert.equal(beneficiary.profile.progression.practice.logging - beneficiary.before.progression.practice.logging, 3);
  const actor = receipt.request.beneficiaries.find(row => row.account === ACCOUNT_TWO);
  assert.equal(actor.profile.progression.practice.logging - actor.before.progression.practice.logging, 7);
  assert.equal((beneficiary.profile.progression.practice.logging - beneficiary.before.progression.practice.logging) +
    (actor.profile.progression.practice.logging - actor.before.progression.practice.logging), 10);

  const saved = await store.loadProfile(ACCOUNT_ONE);
  assert.deepEqual(saved.data.attr, { v: 1, carga: 0, re: 0 });
  assert.equal(saved.data.eco.pack.maxMass, 50);
  assert.deepEqual(saved.data.eco.pack.goods, goodsBeforeTala);
  assert.equal(saved.data.progression.practice.logging, 3);

  const reconnected = connect(host, 'Resource tester'); reconnected.hello(); await Promise.all([...host.joins]);
  const restored = host.server.world.profiles.get(host.server.clients.get(reconnected.id).entity);
  assert.deepEqual(restored.attr, { v: 1, carga: 0, re: 0 });
  assert.equal(restored.eco.pack.maxMass, 50);
  assert.deepEqual(restored.eco.pack.goods, goodsBeforeTala);
  assert.equal(restored.progression.practice.logging, 3);
});
