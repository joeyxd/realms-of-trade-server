import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Economy } from '../src/sim/economy/economy.js';
import { newProfile } from '../src/sim/systems/inventory.js';
import { createSupabaseStore, StoreError } from '../server/store.mjs';
import { database } from './helpers/ground-clock-sql.mjs';

const migration014 = await readFile(new URL('../server/migrations/014_economic_operations.sql', import.meta.url), 'utf8');
const migration015 = await readFile(new URL('../server/migrations/015_resource_operations.sql', import.meta.url), 'utf8');
const migration016 = await readFile(new URL('../server/migrations/016_logging_operations.sql', import.meta.url), 'utf8');
const migration017 = await readFile(new URL('../server/migrations/017_agent_goods_budget.sql', import.meta.url), 'utf8');
const uuid = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const world = 'world:salty-shore', ownerId = uuid(1), characterId = uuid(2), budgetId = uuid(3);
const limits = { buyGold: 30, buyGoldPerTrade: 20, sellUnits: { madera: 2 }, sellUnitsPerTrade: 2 };
const worldData = () => ({ v: 1, seed: 42, economy: new Economy(42).serialize() });
function profile(goods = { madera: 2 }, gold = 100) {
  const value = newProfile(); value.gold = gold; value.eco.pack.goods = { ...goods }; return value;
}
function trade(operationId, { op = 'buy', n = 1, price = 20, prior = profile(), ackOk = true,
  expectedProfileVersion = 1, expectedWorldVersion = 1 } = {}) {
  const next = structuredClone(prior);
  if (ackOk) {
    next.gold += op === 'buy' ? -price : price;
    next.eco.pack.goods.madera += op === 'buy' ? n : -n;
    if (!next.eco.pack.goods.madera) delete next.eco.pack.goods.madera;
    next.eco.tradeRev++;
  }
  const command = { type: 'commerce', op, opId: `sql-${operationId.slice(-4)}`, town: 'aldea', g: 'madera', n, expectedTotal: price };
  return { operationId, ownerId, budgetId, request: { world, account: characterId, command,
    expectedProfileVersion, expectedWorldVersion, profile: next, worldData: worldData(),
    ack: { type: 'commerce', op, opId: command.opId, ok: ackOk, why: ackOk ? '' : 'price', rev: ackOk ? next.eco.tradeRev : 0 } } };
}
async function fixture(t, path = undefined) {
  const f = await database(path);
  let closed = false; const close = f.close;
  f.close = async () => { if (!closed) { closed = true; await close(); } };
  t.after(() => f.close());
  await f.db.exec('RESET ROLE'); await f.db.exec(migration014); await f.db.exec(migration015);
  await f.db.exec(migration016); await f.db.exec(migration017); await f.db.exec(migration017); await f.db.exec('SET ROLE service_role');
  const calls = []; let lose = false;
  const store = createSupabaseStore({ async rpc(name, args) {
    calls.push({ name, args: structuredClone(args) });
    let sql, params;
    switch (name) {
      case 'mn_create_agent_goods_budget': sql = 'select public.mn_create_agent_goods_budget($1,$2::uuid,$3::uuid,$4::uuid,$5::jsonb) as data'; params = [args.p_world,args.p_owner_id,args.p_character_id,args.p_budget_id,args.p_limits]; break;
      case 'mn_load_agent_goods_budget': sql = 'select public.mn_load_agent_goods_budget($1,$2::uuid,$3::uuid) as data'; params = [args.p_world,args.p_owner_id,args.p_character_id]; break;
      case 'mn_revoke_agent_goods_budget': sql = 'select public.mn_revoke_agent_goods_budget($1,$2::uuid,$3::uuid,$4::uuid) as data'; params = [args.p_world,args.p_owner_id,args.p_character_id,args.p_budget_id]; break;
      case 'mn_commit_agent_trade': sql = 'select public.mn_commit_agent_trade($1::uuid,$2::jsonb,$3::uuid,$4::uuid) as data'; params = [args.p_operation_id,args.p_request,args.p_owner_id,args.p_budget_id]; break;
      case 'mn_load_agent_trade_operation': sql = 'select public.mn_load_agent_trade_operation($1::uuid) as data'; params = [args.p_operation_id]; break;
      case 'mn_agent_trade_ready': sql = 'select public.mn_agent_trade_ready() as data'; params = []; break;
      case 'mn_commit_economic_operation': sql = 'select public.mn_commit_economic_operation($1::uuid,$2::jsonb) as data'; params = [args.p_operation_id,args.p_request]; break;
      case 'mn_load_economic_operation': sql = 'select public.mn_load_economic_operation($1::uuid) as data'; params = [args.p_operation_id]; break;
      default: throw new Error(`unexpected RPC ${name}`);
    }
    const data = (await f.db.query(sql, params)).rows[0].data;
    if (name === 'mn_commit_agent_trade' && lose) { lose = false; throw new Error('lost trade response'); }
    return { data, error: null };
  } });
  const initial = profile();
  await f.db.query('insert into public.mn_profiles(player_id,data,version) values($1::uuid,$2::jsonb,1)', [characterId, initial]);
  await f.db.query('insert into public.mn_worlds(world,economy,version) values($1,$2::jsonb,1)', [world, worldData()]);
  const created = await store.createAgentGoodsBudget({ world, ownerId, characterId, budgetId, limits });
  return { ...f, store, calls, initial, created, loseNext: () => { lose = true; } };
}
async function budget(f) { return f.store.loadAgentGoodsBudget({ world, ownerId, characterId }); }

test('SQL017 is rerunnable, scoped and exposes only the public budget projection', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.store.checkAgentTradeOperations(), { version: 1 });
  assert.deepEqual(f.created, { v: 1, budgetId, enabled: true, limits, buyGoldUsed: 0, sellUnitsUsed: {} });
  assert.deepEqual(await budget(f), f.created);
  assert.deepEqual(await f.store.createAgentGoodsBudget({ world, ownerId, characterId, budgetId, limits }), f.created);
  assert.equal(await f.store.loadAgentGoodsBudget({ world, ownerId: uuid(5), characterId }), null);
  await assert.rejects(f.store.createAgentGoodsBudget({ world, ownerId, characterId, budgetId: uuid(6), limits }),
    error => error instanceof StoreError && error.code === 'operation');
  await assert.rejects(f.db.query('select * from public.mn_agent_goods_budgets'), { code: '42501' });
  await f.db.exec('RESET ROLE; GRANT SELECT ON public.mn_agent_goods_budgets TO service_role; SET ROLE service_role');
  await assert.rejects(f.store.checkAgentTradeOperations(), error => error instanceof StoreError && error.code === 'response');
  await f.db.exec('RESET ROLE; REVOKE SELECT ON public.mn_agent_goods_budgets FROM service_role; SET ROLE service_role');
  assert.deepEqual(await f.store.checkAgentTradeOperations(), { version: 1 });
});

test('SQL017 atomically accounts successful buys and exact replay keeps a single economic receipt', async t => {
  const f = await fixture(t), raw = trade(uuid(10));
  const first = await f.store.commitAgentTrade(raw);
  assert.deepEqual(first, { ok: true, replay: false, profileVersion: 2, worldVersion: 2, ack: raw.request.ack });
  assert.equal((await budget(f)).buyGoldUsed, 20);
  assert.deepEqual(await f.store.commitAgentTrade(raw), { ...first, replay: true });
  assert.deepEqual(await f.store.loadAgentTradeOperation(raw.operationId), { request: raw.request,
    result: first, ownerId, budgetId });
  assert.deepEqual((await f.store.loadEconomicOperation(raw.operationId)).result, first);
  assert.equal((await f.db.query('select count(*)::int as n from public.mn_economic_operations')).rows[0].n, 1,
    'agent linkage does not create a second gameplay receipt');
});

test('SQL017 rejects caps and revoked policy without economic writes; denied ACK is receipted at zero cost', async t => {
  const f = await fixture(t), tooMuch = trade(uuid(11), { price: 21 });
  assert.deepEqual(await f.store.commitAgentTrade(tooMuch), { ok: false, why: 'budget' });
  assert.equal(await f.store.loadEconomicOperation(tooMuch.operationId), null);
  assert.equal((await f.db.query('select version from public.mn_profiles where player_id=$1::uuid', [characterId])).rows[0].version, 1);

  const denied = trade(uuid(12), { ackOk: false });
  const result = await f.store.commitAgentTrade(denied);
  assert.equal(result.ok, true); assert.equal(result.ack.ok, false); assert.equal((await budget(f)).buyGoldUsed, 0);
  const revoked = await f.store.revokeAgentGoodsBudget({ world, ownerId, characterId, budgetId });
  assert.equal(revoked.enabled, false);
  const stopped = trade(uuid(13), { expectedProfileVersion: 3, expectedWorldVersion: 3 });
  assert.deepEqual(await f.store.commitAgentTrade(stopped), { ok: false, why: 'budget' });
  assert.equal(await f.store.loadEconomicOperation(stopped.operationId), null);
  assert.equal((await f.store.createAgentGoodsBudget({ world, ownerId, characterId, budgetId, limits })).enabled, false);
});

test('SQL017 rejects altered or human receipt reuse and preserves ordinary economic commands', async t => {
  const f = await fixture(t), raw = trade(uuid(14));
  assert.equal((await f.store.commitAgentTrade(raw)).ok, true);
  const altered = structuredClone(raw); altered.budgetId = uuid(90);
  assert.deepEqual(await f.store.commitAgentTrade(altered), { ok: false, why: 'operation' });

  const currentRow = (await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [characterId])).rows[0];
  const human = trade(uuid(15), { prior: currentRow.data, ackOk: false, expectedProfileVersion: 2, expectedWorldVersion: 2 });
  assert.equal((await f.store.commitEconomicOperation({ operationId: human.operationId, request: human.request })).ok, true);
  assert.deepEqual(await f.store.commitAgentTrade(human), { ok: false, why: 'operation' });
  const secondBudget = await f.store.createAgentGoodsBudget({ world, ownerId, characterId: uuid(7), budgetId: uuid(8), limits });
  assert.equal(secondBudget.enabled, true);
});

test('SQL017 recovers a lost reply from one immutable operation and denies foreign revoke', async t => {
  const f = await fixture(t), raw = trade(uuid(16)); f.loseNext();
  await assert.rejects(f.store.commitAgentTrade(raw), error => error instanceof StoreError && error.code === 'unavailable');
  assert.deepEqual(await f.store.loadAgentTradeOperation(raw.operationId), { request: raw.request,
    result: { ok: true, replay: false, profileVersion: 2, worldVersion: 2, ack: raw.request.ack }, ownerId, budgetId });
  assert.equal((await f.store.commitAgentTrade(raw)).replay, true);
  await assert.rejects(f.store.revokeAgentGoodsBudget({ world, ownerId: uuid(4), characterId, budgetId }),
    error => error instanceof StoreError && error.code === 'budget');
});

test('SQL017 budget usage and linked receipt survive a disk database reopen', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-goods-budget-')), path = join(dir, 'db');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = await fixture(t, path), raw = trade(uuid(17));
  await f.db.query('select public.mn_commit_agent_trade($1::uuid,$2::jsonb,$3::uuid,$4::uuid)',
    [raw.operationId, raw.request, ownerId, budgetId]);
  await f.close();
  const reopened = new PGlite(path);
  t.after(() => reopened.close());
  await reopened.exec('SET ROLE service_role');
  const persistedBudget = (await reopened.query(
    'select public.mn_load_agent_goods_budget($1,$2::uuid,$3::uuid) as data', [world, ownerId, characterId])).rows[0].data;
  assert.deepEqual(persistedBudget, { v: 1, budgetId, enabled: true, limits, buyGoldUsed: 20, sellUnitsUsed: {} });
  const receipt = (await reopened.query('select public.mn_load_agent_trade_operation($1::uuid) as data', [raw.operationId])).rows[0].data;
  assert.deepEqual(receipt, { request: raw.request,
    result: { ok: true, replay: false, profileVersion: 2, worldVersion: 2, ack: raw.request.ack }, ownerId, budgetId });
  const replay = (await reopened.query('select public.mn_commit_agent_trade($1::uuid,$2::jsonb,$3::uuid,$4::uuid) as data',
    [raw.operationId, raw.request, ownerId, budgetId])).rows[0].data;
  assert.deepEqual(replay, { ...receipt.result, replay: true });
  assert.equal((await reopened.query('select public.mn_load_agent_goods_budget($1,$2::uuid,$3::uuid) as data',
    [world, ownerId, characterId])).rows[0].data.buyGoldUsed, 20, 'restart replay does not debit a second time');
});

test('SQL017 sale consumes its own unit cap and never refills buy allowance; forged deltas roll back', async t => {
  const f = await fixture(t), buy = trade(uuid(20));
  assert.equal((await f.store.commitAgentTrade(buy)).ok, true);
  const current = async () => (await f.db.query('select data from public.mn_profiles where player_id=$1::uuid', [characterId])).rows[0].data;
  const afterBuy = await current();
  const forged = trade(uuid(21), { op: 'sell', n: 2, price: 8, prior: afterBuy,
    expectedProfileVersion: 2, expectedWorldVersion: 2 });
  forged.request.profile.gold++;
  assert.deepEqual(await f.store.commitAgentTrade(forged), { ok: false, why: 'budget' });
  assert.equal(await f.store.loadEconomicOperation(forged.operationId), null);
  assert.deepEqual(await current(), afterBuy, 'forged gold delta has no profile effect');

  const sale = trade(uuid(22), { op: 'sell', n: 2, price: 8, prior: afterBuy,
    expectedProfileVersion: 2, expectedWorldVersion: 2 });
  const sold = await f.store.commitAgentTrade(sale);
  assert.equal(sold.ok, true);
  assert.deepEqual(await budget(f), { v: 1, budgetId, enabled: true, limits,
    buyGoldUsed: 20, sellUnitsUsed: { madera: 2 } });
  const afterSale = await current();
  assert.equal(afterSale.gold, 88); assert.equal(afterSale.eco.pack.goods.madera, 1);
  for (const raw of [trade(uuid(23), { op: 'sell', n: 1, price: 4, prior: afterSale,
    expectedProfileVersion: 3, expectedWorldVersion: 3 }),
    trade(uuid(24), { price: 20, prior: afterSale, expectedProfileVersion: 3, expectedWorldVersion: 3 })]) {
    assert.deepEqual(await f.store.commitAgentTrade(raw), { ok: false, why: 'budget' });
    assert.equal(await f.store.loadEconomicOperation(raw.operationId), null);
  }
  await f.store.revokeAgentGoodsBudget({ world, ownerId, characterId, budgetId });
  assert.deepEqual(await f.store.commitAgentTrade(sale), { ...sold, replay: true });
  assert.deepEqual(await current(), afterSale);
  assert.equal((await budget(f)).buyGoldUsed, 20);
  assert.deepEqual((await budget(f)).sellUnitsUsed, { madera: 2 });
  assert.equal((await f.db.query('select count(*)::int as n from public.mn_economic_operations')).rows[0].n, 2);
});
