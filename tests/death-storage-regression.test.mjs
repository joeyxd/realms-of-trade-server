import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createSupabaseStore } from '../server/store.mjs';
import { deathOperation, deathResult } from '../server/deathOperation.mjs';
import { tuning } from '../src/data/tuning.js';
import { rollItem } from '../src/sim/items.js';
import { database } from './helpers/death-storage-sql.mjs';
import { makeDeath, planRequest, seedDeathStore, VICTIM, WORLD, deathOp } from './helpers/death-storage.mjs';

test('SQL and memory follow the real Float64 death kernel at XP cent boundaries and adjustable loss fractions', async () => {
  const sql = await database(), memory = createMemoryStore(), oldLoss = tuning.combat.deathXpLoss;
  const values = [0, 0.49999999999999994 / 100, 0.005, 0.01, 0.05, 0.555, 1.115, 123.455, 32768.015, 999999.99, 1e6];
  let count = 0;
  try {
    for (const fraction of [0, 0.1, 0.375, 1]) for (const value of values) {
      tuning.combat.deathXpLoss = fraction;
      const f = makeDeath(); f.world.ecs.xp[f.entity] = value;
      const { plan, request } = planRequest(f, deathOp(700 + count++));
      for (const store of [memory, sql.store]) {
        const current = await store.loadProfile(VICTIM);
        assert.equal((await store.saveProfile(VICTIM, request.profiles[0].before, current?.version ?? 0)).ok, true);
        const raw = structuredClone(request); raw.profiles[0].expectedVersion = (await store.loadProfile(VICTIM)).version;
        const result = await store.commitDeath(raw);
        assert.equal(result.ok, true, `${store.kind}: ${value} × (1-${fraction})`);
        assert.deepEqual((await store.loadProfile(VICTIM)).data, plan.profiles[0].after);
      }
    }
    assert.equal(count, 44);
  } finally { tuning.combat.deathXpLoss = oldLoss; await sql.close(); }
});

test('non-starter Cala weapon loss creates the actual same-kit starter once and stores the exact former weapon', async (t) => {
  for (const base of ['daga', 'duelo', 'trabuco']) await t.test(base, async () => {
    const sql = await database();
    try {
      const f = makeDeath({ lawless: true, loot: true, pearlCount: 1 }), p = f.world.profiles.get(f.entity);
      p.eq.weapon = rollItem(f.world.lootRng, { base, lvl: 5, rarity: 0, uid: p.uid++ });
      const { plan, request } = planRequest(f, deathOp(800));
      for (const store of [createMemoryStore(), sql.store]) {
        await seedDeathStore(store, f, structuredClone(request));
        const raw = structuredClone(request); raw.profiles[0].expectedVersion = (await store.loadProfile(VICTIM)).version;
        const result = await store.commitDeath(raw);
        assert.equal(result.ok, true);
        assert.deepEqual((await store.loadProfile(VICTIM)).data, plan.profiles[0].after);
        assert.equal(result.drops[0].kind, 'item'); assert.deepEqual(result.drops[0].item, p.eq.weapon);
        assert.equal(result.drops.filter((d) => d.item?.u === p.eq.weapon.u).length, 1);
      }
    } finally { await sql.close(); }
  });
});

test('all nine pearl generations advance independently together with full ordinary inventory loss', async () => {
  const sql = await database();
  try {
    const f = makeDeath({ lawless: true, killer: true, pearlCount: 9, loot: true });
    const { request } = planRequest(f, deathOp(900)); await seedDeathStore(sql.store, f, request);
    // Each pair of location/ledger generations remains consistent. This is a service fixture,
    // not a gameplay grant or a claim that raw generation updates are a public operation.
    for (let i = 0; i < request.pearls.length; i++) {
      const q = request.pearls[i]; q.expectedVersion = i + 1;
      for (let v = 1; v < q.expectedVersion; v++) await sql.db.transaction(async (tx) => {
        await tx.query('update public.mn_unique_items set version=version+1 where uid=$1', [q.uid]);
        await tx.query('update public.mn_pearl_locations set version=version+1 where uid=$1', [q.uid]);
      });
    }
    const result = await sql.store.commitDeath(request);
    assert.equal(result.ok, true); assert.equal(result.uniques.length, 9);
    assert.equal(result.profiles.length, 2); assert.equal(result.drops.length, request.drops.length);
    assert.deepEqual(result.uniques.map((q) => q.version), request.pearls.map((q) => q.expectedVersion + 1));
    assert.deepEqual(await sql.store.listDeathDrops(WORLD), result.drops);
    for (const p of request.profiles) assert.deepEqual((await sql.store.loadProfile(p.id)).data, p.data);
  } finally { await sql.close(); }
});

test('SDK rejects corrupted whole-death responses, receipts and ground pages', async () => {
  const { request } = planRequest(makeDeath({ lawless: true, pearlCount: 2, loot: true }));
  const { request: payload } = deathOperation(request), good = deathResult(payload, request.operationId);
  let reply = good;
  const store = createSupabaseStore({ rpc: async () => ({ data: structuredClone(reply), error: null }) });
  for (const corrupt of [
    (r) => { r.profiles[0].version++; }, (r) => { r.uniques[0].holder = VICTIM; },
    (r) => { r.locations[0].ground.x++; }, (r) => { r.drops.pop(); },
    (r) => { r.drops[0].ordinal++; }, (r) => { r.drops[0].item.u++; },
    (r) => { r.extra = true; }, (r) => { r.replay = 'true'; },
  ]) {
    reply = structuredClone(good); corrupt(reply);
    await assert.rejects(store.commitDeath(request), { code: 'response' });
    reply = { request: payload, result: reply };
    await assert.rejects(store.loadDeathOperation(request.operationId), { code: 'response' });
  }
  for (const corrupt of [
    (rows) => { rows[0].world = 'other'; }, (rows) => { rows[0].ground.x = 1000001; },
    (rows) => { rows.reverse(); }, (rows) => { rows[0].item.unknown = true; },
    (rows) => { rows[0].victim = 'broken'; }, (rows) => { rows[0].extra = true; },
  ]) {
    reply = structuredClone(good.drops); corrupt(reply);
    await assert.rejects(store.listDeathDrops(WORLD), { code: 'response' });
  }
});

test('the SDK detaches profiles, rules, pearl metadata and item geometry before its first await', async () => {
  const { request } = planRequest(makeDeath({ lawless: true, pearlCount: 2, loot: true }));
  const frozen = structuredClone(request); let finish, received;
  const pending = new Promise((resolve) => { finish = resolve; });
  const store = createSupabaseStore({ rpc: async (_name, args) => {
    received = args; await pending;
    return { data: deathResult(args.p_request, args.p_operation_id), error: null };
  } });
  const result = store.commitDeath(request);
  request.profiles[0].before.gold++; request.profiles[0].data.gold++;
  request.rules.xpBefore++; request.pearls[0].ground.x++; request.drops[0].item.u++;
  request.drops[0].ground.z++; request.drops.pop();
  const { operationId, ...payload } = frozen;
  assert.deepEqual(received, { p_operation_id: operationId, p_request: payload }); finish();
  assert.deepEqual(await result, deathResult(payload, operationId));
});
