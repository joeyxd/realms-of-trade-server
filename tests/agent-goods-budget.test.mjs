import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { createMemoryStore, StoreError } from '../server/store.mjs';

const uuid = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const world = 'world:salty-shore', ownerId = uuid(1), characterId = uuid(2), budgetId = uuid(3);
const limits = { buyGold: 30, buyGoldPerTrade: 20, sellUnits: { madera: 2 }, sellUnitsPerTrade: 2 };
const worldData = () => ({ v: 1, seed: 41, economy: new Economy(41).serialize() });
function profile(goods = { madera: 0 }, gold = 100) {
  const value = newProfile(); value.gold = gold; value.eco.pack.goods = { ...goods }; return value;
}
function trade(operationId, { op = 'buy', n = 1, price = 20, prior = profile({ madera: 2 }), next = null,
  ackOk = true, expectedProfileVersion = 1, expectedWorldVersion = 1 } = {}) {
  next ??= structuredClone(prior);
  if (ackOk) {
    next.gold += op === 'buy' ? -price : price;
    next.eco.pack.goods.madera += op === 'buy' ? n : -n;
    if (!next.eco.pack.goods.madera) delete next.eco.pack.goods.madera;
    next.eco.tradeRev++;
  }
  const command = { type: 'commerce', op, opId: `agent-${operationId.slice(-4)}`, town: 'aldea', g: 'madera', n, expectedTotal: price };
  return { operationId, ownerId, budgetId, request: { world, account: characterId, command,
    expectedProfileVersion, expectedWorldVersion, profile: next, worldData: worldData(),
    ack: { type: 'commerce', op, opId: command.opId, ok: ackOk, why: ackOk ? '' : 'price', rev: ackOk ? next.eco.tradeRev : 0 } } };
}
async function fixture() {
  const store = createMemoryStore(), start = profile({ madera: 2 });
  await store.initializeProfile(characterId, start); await store.saveWorld(world, worldData(), 0);
  const created = await store.createAgentGoodsBudget({ world, ownerId, characterId, budgetId, limits });
  return { store, start, created };
}

test('memory mandate is immutable and exposes a public projection without identities', async () => {
  const { store, created } = await fixture();
  assert.deepEqual(created, { v: 1, budgetId, enabled: true, limits, buyGoldUsed: 0, sellUnitsUsed: {} });
  assert.deepEqual(await store.loadAgentGoodsBudget({ world, ownerId, characterId }), created);
  assert.deepEqual(await store.createAgentGoodsBudget({ world, ownerId, characterId, budgetId, limits }), created);
  await assert.rejects(store.createAgentGoodsBudget({ world, ownerId, characterId, budgetId: uuid(4), limits }),
    error => error instanceof StoreError && error.code === 'operation');
  await assert.rejects(store.createAgentGoodsBudget({ world, ownerId, characterId: uuid(6), budgetId, limits }),
    error => error instanceof StoreError && error.code === 'operation');
  assert.equal(await store.loadAgentGoodsBudget({ world, ownerId: uuid(5), characterId }), null);
});

test('memory trade applies one receipt and usage debit; exact retry is historical', async () => {
  const { store } = await fixture(), raw = trade(uuid(10));
  const first = await store.commitAgentTrade(raw);
  assert.equal(first.ok, true); assert.equal(first.replay, false);
  assert.deepEqual(await store.loadAgentGoodsBudget({ world, ownerId, characterId }),
    { v: 1, budgetId, enabled: true, limits, buyGoldUsed: 20, sellUnitsUsed: {} });
  assert.deepEqual(await store.commitAgentTrade(raw), { ...first, replay: true });
  assert.deepEqual(await store.loadAgentTradeOperation(raw.operationId), {
    request: raw.request, result: first, ownerId, budgetId,
  });
  assert.equal((await store.loadEconomicOperation(raw.operationId)).result.ack.opId, raw.request.command.opId,
    'human economic receipt shape remains available and unchanged');
  first.ack.why = 'caller-edited';
  assert.equal((await store.loadAgentTradeOperation(raw.operationId)).result.ack.why, '',
    'returned results cannot mutate the shared internal immutable economic/agent receipt');
});

test('memory budget cap rejection makes no economic or profile/world writes; denied ACK spends zero', async () => {
  const { store, start } = await fixture();
  const tooMuch = trade(uuid(11), { price: 21 });
  assert.deepEqual(await store.commitAgentTrade(tooMuch), { ok: false, why: 'budget' });
  assert.equal(await store.loadAgentTradeOperation(tooMuch.operationId), null);
  assert.equal(await store.loadEconomicOperation(tooMuch.operationId), null);
  assert.deepEqual(await store.loadProfile(characterId), { data: start, version: 1 });

  const denied = trade(uuid(12), { ackOk: false });
  const result = await store.commitAgentTrade(denied);
  assert.equal(result.ok, true); assert.equal(result.ack.ok, false);
  assert.equal((await store.loadAgentGoodsBudget({ world, ownerId, characterId })).buyGoldUsed, 0);
});

test('memory sell caps accumulate per good, revoke is monotonic, and old exact replay remains readable', async () => {
  const { store } = await fixture();
  const sale = trade(uuid(13), { op: 'sell', n: 2, price: 8, prior: profile({ madera: 2 }) });
  assert.equal((await store.commitAgentTrade(sale)).ok, true);
  const beyond = trade(uuid(14), { op: 'sell', n: 1, price: 4, prior: profile({ madera: 1 }),
    expectedProfileVersion: 2, expectedWorldVersion: 2 });
  assert.deepEqual(await store.commitAgentTrade(beyond), { ok: false, why: 'budget' });
  const revoked = await store.revokeAgentGoodsBudget({ world, ownerId, characterId, budgetId });
  assert.equal(revoked.enabled, false);
  assert.equal((await store.createAgentGoodsBudget({ world, ownerId, characterId, budgetId, limits })).enabled, false);
  assert.equal((await store.commitAgentTrade(sale)).replay, true);
  await assert.rejects(store.revokeAgentGoodsBudget({ world, ownerId: uuid(5), characterId, budgetId }),
    error => error instanceof StoreError && error.code === 'budget');
});

test('memory rejects altered trade replay and human receipt collision', async () => {
  const { store } = await fixture(), raw = trade(uuid(15));
  assert.equal((await store.commitAgentTrade(raw)).ok, true);
  const changed = structuredClone(raw); changed.ownerId = uuid(5);
  assert.deepEqual(await store.commitAgentTrade(changed), { ok: false, why: 'operation' });

  const current = (await store.loadProfile(characterId)).data;
  const human = trade(uuid(16), { prior: current, ackOk: false, expectedProfileVersion: 2, expectedWorldVersion: 2 });
  const humanInput = { operationId: human.operationId, request: human.request };
  assert.equal((await store.commitEconomicOperation(humanInput)).ok, true);
  assert.deepEqual(await store.commitAgentTrade(human), { ok: false, why: 'operation' });
});
