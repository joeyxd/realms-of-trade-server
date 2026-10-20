import test from 'node:test';
import assert from 'node:assert/strict';
import { economicOperationId } from '../server/economicAuthority.mjs';
import { GameHost } from '../server/host.mjs';
import { readProgression } from '../src/sim/systems/progression.js';
import { NODES } from '../src/data/skillTree.js';
import { MSG } from '../src/net/protocol.js';
import { ACCOUNT_ONE, RESOURCE_WORLD, connect, copy, makeResourceHost, makeResourceStore, startResourceHost, submitAndApply, turn }
  from './helpers/resource-authority-fixture.mjs';

const options = { loggingOperations: true, artisanOperations: true, workshopOperations: true,
  skillOperations: true, communityRequirements: { madera: 4, piedra: 2 } };
const profileFor = f => f.host.server.world.profiles.get(f.entity());
const assign = (profile, opId, node = 'lunge', extra = {}) => ({ type: 'skills', op: 'assign', opId,
  expectedRev: profile.eco.tradeRev, tree: 'combat', node, ...extra });
const reset = (profile, opId, extra = {}) => ({ type: 'skills', op: 'reset', opId, expectedRev: profile.eco.tradeRev,
  tree: 'combat', ...extra });
const receiptId = opId => economicOperationId(RESOURCE_WORLD, ACCOUNT_ONE, opId);
const welcome = client => client.of(MSG.WELCOME).at(-1);

async function fixture(t, overrides = {}, hostOptions = options) {
  const stores = makeResourceStore(overrides);
  const f = await startResourceHost(t, stores.store, { goods: { madera: 3 }, options: hostOptions });
  return { ...f, ...stores };
}

// Saber mastery 4 gives combat rank 4 (6 points); the legacy arts spend 3 of them on adoption.
async function trained(f, gold = 200) {
  const p = profileFor(f);
  p.mast = [[4, 0], [1, 0]]; p.gold = gold;
  f.host.profiles.save(f.client.id, p);
  await f.host.profiles.flush();
  return p;
}

test('skill commands are rejected as disabled by default and never write a receipt or v3', async t => {
  const f = await fixture(t, {}, { ...options, skillOperations: false }), p = await trained(f), before = copy(p);
  assert.equal(welcome(f.client).skills.enabled, false);
  assert.deepEqual(f.host.status().storage.skills, { enabled: false, ready: false });
  f.client.send(assign(p, 'disabled-assign'));
  f.client.send(reset(p, 'disabled-reset'));
  await turn();
  for (const opId of ['disabled-assign', 'disabled-reset']) {
    const ack = f.client.events(opId).at(-1);
    assert.equal(ack?.ok, false); assert.equal(ack?.why, 'disabled');
    assert.equal(await f.store.loadEconomicOperation(receiptId(opId)), null);
  }
  assert.deepEqual(p, before);
  assert.equal((await f.store.loadProfile(ACCOUNT_ONE)).data.progression?.v ?? 1, 1);
});

test('a host without the economic lane answers skill commands as disabled', async t => {
  const host = new GameHost({ seed: 3, bots: 0, log: () => {} });
  t.after(() => host.close().catch(() => {}));
  await host.prepare();
  const client = connect(host); client.hello(); await Promise.all([...host.joins]);
  assert.equal(host.economicAuthority, null);
  client.send({ type: 'skills', op: 'assign', opId: 'no-lane', expectedRev: 0, tree: 'combat', node: 'lunge' });
  await turn();
  const ack = client.events('no-lane').at(-1);
  assert.equal(ack?.ok, false); assert.equal(ack?.why, 'disabled');
  assert.equal(host.status().storage.skills.enabled, false);
});

test('skill operations need the starter workshop lane and an exact {version:1} SQL040 readiness', async () => {
  const { store } = makeResourceStore();
  assert.throws(() => makeResourceHost(store, async () => ACCOUNT_ONE, { ...options, workshopOperations: false }), /configuration/);
  assert.throws(() => makeResourceHost(store, async () => ACCOUNT_ONE, { ...options, skillOperations: 'yes' }), /configuration/);
  for (const checkSkillOperations of [async () => ({ version: 0 }), async () => null, undefined,
    async () => { throw new Error('SQL skill readiness unavailable'); }]) {
    const stores = makeResourceStore({ checkSkillOperations });
    if (checkSkillOperations === undefined) delete stores.store.checkSkillOperations;
    const host = makeResourceHost(stores.store, async () => ACCOUNT_ONE, options);
    await assert.rejects(host.prepare(), error => checkSkillOperations?.toString().includes('throw')
      ? /SQL skill readiness unavailable/.test(error.message) : error.code === 'configuration');
    assert.equal(host.worldState.ready, false, 'no world admission without SQL040');
    await host.close().catch(() => {});
  }
  const control = makeResourceHost(makeResourceStore().store, async () => ACCOUNT_ONE, options);
  await control.prepare();
  assert.equal(control.worldState.ready, true, 'the same configuration opens with {version:1}');
  await control.close().catch(() => {});
});

test('assign adopts and raises through one durable receipt, publishes status and replays exactly', async t => {
  const f = await fixture(t), p = await trained(f);
  assert.equal(welcome(f.client).skills.enabled, true);
  assert.deepEqual(f.host.status().storage.skills, { enabled: true, ready: true });
  const command = assign(p, 'assign-lunge'), goods = copy(p.eco.pack.goods);
  const ack = await submitAndApply(f.host, f.client, command);
  assert.deepEqual({ ...ack, to: undefined }, { type: 'skills', op: 'assign', opId: 'assign-lunge', ok: true, why: '',
    rev: command.expectedRev + 1, to: undefined, durable: false });
  assert.equal(p.progression.v, 3);
  assert.equal(p.progression.skills.lunge, 2);
  assert.deepEqual(readProgression(p.progression), p.progression);
  assert.deepEqual(p.eco.pack.goods, goods);
  const receipt = await f.store.loadEconomicOperation(receiptId('assign-lunge'));
  assert.deepEqual(receipt.request.command, command);
  assert.equal(Object.hasOwn(receipt.request.before, 'progression') ? receipt.request.before.progression.v : 1, 1);
  assert.deepEqual(receipt.request.profile.progression, p.progression);
  assert.deepEqual((await f.store.loadProfile(ACCOUNT_ONE)).data.progression, p.progression);

  const after = copy(p);
  const replay = await submitAndApply(f.host, f.client, command);
  assert.equal(replay?.ok, true); assert.equal(replay?.replay, true); assert.equal(replay?.historical, true);
  assert.deepEqual(p, after, 'a replay never reapplies the rank');
  const rebound = await submitAndApply(f.host, f.client, { ...command, node: 'wave', expectedRev: p.eco.tradeRev });
  assert.equal(rebound?.ok, false); assert.equal(rebound?.why, 'duplicate');
  assert.deepEqual(p, after);
});

test('an older catalog adoption replays historically through the memory store without fencing the authority', async t => {
  const f = await fixture(t), p = await trained(f), command = assign(p, 'old-catalog');
  const index = NODES.findIndex(n => n.id === 'haggling');
  assert.ok(index >= 0);
  const [node] = NODES.splice(index, 1);
  let first;
  try {
    first = await submitAndApply(f.host, f.client, command);
    assert.equal(first?.ok, true);
    assert.equal(Object.hasOwn(p.progression.skills, node.id), false);
  } finally { NODES.splice(index, 0, node); }
  const before = copy(p), saved = await f.store.loadProfile(ACCOUNT_ONE);
  const receipt = await f.base.loadEconomicOperation(receiptId(command.opId));
  assert.equal(Object.hasOwn(receipt.request.profile.progression.skills, node.id), false);
  const replay = await submitAndApply(f.host, f.client, command);
  assert.deepEqual(replay, { ...first, replay: true, historical: true });
  assert.equal(f.host.economicAuthority.failed, false);
  assert.equal(f.host.worldState.ready, true);
  assert.deepEqual(p, before);
  assert.deepEqual(await f.store.loadProfile(ACCOUNT_ONE), saved);
  assert.equal((await submitAndApply(f.host, f.client, reset(p, 'after-historical-replay')))?.ok, true);
  assert.equal(f.host.economicAuthority.failed, false, 'subsequent economic commands stay usable');
});

test('free then paid reset charges the live gold once, and short gold or stale revisions are no-op receipts', async t => {
  const f = await fixture(t), p = await trained(f, 200);
  assert.equal((await submitAndApply(f.host, f.client, reset(p, 'reset-free')))?.ok, true);
  assert.equal(p.gold, 200); assert.deepEqual(p.progression.skr, { combat: 1 });
  assert.equal((await submitAndApply(f.host, f.client, assign(p, 'assign-after-reset')))?.ok, true);
  const paid = await submitAndApply(f.host, f.client, reset(p, 'reset-paid'));
  assert.equal(paid?.ok, true, JSON.stringify(paid));
  assert.equal(p.gold, 50); assert.deepEqual(p.progression.skr, { combat: 2 });
  assert.equal((await f.store.loadProfile(ACCOUNT_ONE)).data.gold, 50);

  assert.equal((await submitAndApply(f.host, f.client, assign(p, 'assign-third')))?.ok, true);
  const before = copy(p);
  const short = await submitAndApply(f.host, f.client, reset(p, 'reset-short'));
  assert.equal(short?.ok, false); assert.equal(short?.why, 'gold'); assert.equal(short?.rev, before.eco.tradeRev);
  assert.deepEqual(p, before);
  const stale = await submitAndApply(f.host, f.client, assign(p, 'stale-assign', 'lunge', { expectedRev: p.eco.tradeRev - 1 }));
  assert.equal(stale?.why, 'conflict');
  assert.deepEqual(p, before);
  const receipt = await f.store.loadEconomicOperation(receiptId('stale-assign'));
  assert.equal(receipt.result.ack.why, 'conflict');
  assert.deepEqual(receipt.request.profile, receipt.request.before);
  assert.equal(f.host.economicAuthority.failed, false);
});

test('malformed skill commands are refused at the edge without a receipt', async t => {
  const f = await fixture(t), p = await trained(f), before = copy(p);
  for (const [opId, command] of [['bad-tree', assign(p, 'bad-tree', 'lunge', { tree: 'exploration' })],
    ['bad-extra', assign(p, 'bad-extra', 'lunge', { n: 2 })], ['bad-node', assign(p, 'bad-node', 'Lunge!')]]) {
    f.client.send(command); await turn();
    assert.equal(f.client.events(opId).at(-1)?.why, 'command');
    assert.equal(await f.store.loadEconomicOperation(receiptId(opId)), null);
  }
  const unknown = await submitAndApply(f.host, f.client, assign(p, 'unknown-node', 'not_a_node'));
  assert.equal(unknown?.why, 'command', 'a well-formed unknown node is a durable no-op denial');
  assert.deepEqual(p, before);
});
