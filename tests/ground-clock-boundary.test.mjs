import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createSupabaseStore } from '../server/store.mjs';
import { newProfile } from '../src/sim/systems/inventory.js';
import { database } from './helpers/ground-clock-sql.mjs';
import { clockOp, clockRequest, CLOCK_WORLD } from './helpers/ground-clock-contract.mjs';
import { seed as seedBatch, request as batchRequest } from './helpers/pearl-batch.mjs';
import { makeDeath, planRequest, seedDeathStore, VICTIM, KILLER, WORLD } from './helpers/death-storage.mjs';
import { seedDeathDropScenario, expiryRequest } from './helpers/death-drop-storage.mjs';

const families = {
  pearl: async (store) => {
    const data = newProfile(); await store.saveProfile(VICTIM, data, 0);
    data.pearls.bag.push({ uid: 'clock:pearl', kind: 'brasa' });
    return { method: 'commitPearl', raw: { operationId: clockOp(200), uid: 'clock:pearl', kind: 'brasa',
      from: null, to: VICTIM, expectedVersion: 0, profiles: [{ id: VICTIM, expectedVersion: 1, data }] } };
  },
  ground: async () => ({ method: 'commitPearlGround', raw: { operationId: clockOp(201), uid: 'clock:ground',
    kind: 'escarcha', from: null, to: null, expectedVersion: 0, profiles: [], world: WORLD,
    ground: { x: 2, z: 3, availableAt: 4, returnAt: 100 } } }),
  batch: async (store) => ({ method: 'commitPearlBatch', raw: batchRequest(await seedBatch(store), 'death', clockOp(202)) }),
  death: async (store) => {
    const f = makeDeath(), { request } = planRequest(f, clockOp(203)); await seedDeathStore(store, f, request);
    return { method: 'commitDeath', raw: request };
  },
  drop: async (store) => ({ method: 'commitDeathDrop', raw: await expiryRequest(
    await seedDeathDropScenario(store, { sourceOperation: 2200 }), { operation: 2201 }) }),
};
async function state(store) {
  return { victim: await store.loadProfile(VICTIM), killer: await store.loadProfile(KILLER),
    pearls: await store.listPearlGround(WORLD), drops: await store.listCurrentDeathDrops(WORLD), world: await store.loadWorld(WORLD) };
}
async function boundaries(t, setup) {
  await t.test('simultaneous CAS attempts admit one winner and no losing receipt', async () => {
    const f = await setup();
    try {
      await f.store.commitGroundClock(clockRequest(clockOp(100), { tick: 12 }));
      const attempts = [13, 14, 15].map((tick, i) => clockRequest(clockOp(101 + i), { expectedVersion: 1, expectedTick: 12, tick }));
      const results = await Promise.all(attempts.map((raw) => f.store.commitGroundClock(raw)));
      assert.equal(results.filter((r) => r.ok).length, 1);
      const winner = results.findIndex((r) => r.ok);
      assert.deepEqual(await f.store.loadGroundClock(CLOCK_WORLD), results[winner].clock);
      for (let i = 0; i < results.length; i++) if (i !== winner) {
        assert.deepEqual(results[i], { ok: false, why: 'conflict' });
        assert.equal(await f.store.loadGroundClockOperation(attempts[i].operationId), null);
      }
    } finally { await f.close?.(); }
  });
  for (const [family, prepare] of Object.entries(families)) await t.test(family + ': clock/receipt UUID collision is non-mutating in both directions', async () => {
    const f = await setup();
    try {
      const { method, raw } = await prepare(f.store);
      assert.equal((await f.store[method](raw)).ok, true);
      const before = await state(f.store);
      assert.deepEqual(await f.store.commitGroundClock(clockRequest(raw.operationId)), { ok: false, why: 'operation' });
      assert.equal(await f.store.loadGroundClock(CLOCK_WORLD), null);
      assert.equal(await f.store.loadGroundClockOperation(raw.operationId), null);
      const clock = clockRequest(clockOp(299), { tick: 70 });
      assert.equal((await f.store.commitGroundClock(clock)).ok, true);
      assert.deepEqual(await f.store[method]({ ...raw, operationId: clock.operationId }), { ok: false, why: 'operation' });
      assert.deepEqual(await state(f.store), before);
      assert.equal((await f.store.loadGroundClock(CLOCK_WORLD)).tick, 70);
    } finally { await f.close?.(); }
  });
  await t.test('checkpoint does not alter economy, profiles, drop state or source deadlines', async () => {
    const f = await setup();
    try {
      await seedDeathDropScenario(f.store, { sourceOperation: 2300 });
      await f.store.saveWorld(WORLD, { clock: 432, rng: 71, markets: ['retained'] }, 0);
      const before = await state(f.store);
      const raw = clockRequest(clockOp(300), { world: WORLD, tick: 10000 });
      assert.equal((await f.store.commitGroundClock(raw)).ok, true);
      assert.deepEqual(await state(f.store), before);
    } finally { await f.close?.(); }
  });
}
test('memory ground-clock authority boundaries', async (t) => boundaries(t, async () => ({ store: createMemoryStore() })));
test('SQL013 ground-clock authority boundaries', async (t) => boundaries(t, database));

test('SDK refuses hostile or invalid input before any RPC', async () => {
  let calls = 0, callbacks = 0;
  const store = createSupabaseStore({ rpc: async () => { calls++; return { data: null, error: null }; } });
  const extra = clockRequest(clockOp(401)); Object.defineProperty(extra, 'hidden', { value: 1 });
  const symbol = clockRequest(clockOp(402)); symbol[Symbol('hidden')] = 1;
  const getter = clockRequest(clockOp(403)); Object.defineProperty(getter, 'tick', { enumerable: true, get() { callbacks++; return 3; } });
  const proxy = new Proxy(clockRequest(clockOp(404)), { ownKeys() { callbacks++; return []; } });
  for (const raw of [extra, symbol, getter, proxy, clockRequest(clockOp(405), { extra: true }),
    clockRequest(clockOp(406), { tick: '1' }), clockRequest(clockOp(407), { expectedTick: -1 }),
    clockRequest(clockOp(408), { expectedVersion: 1, expectedTick: 1, tick: 1 }),
    clockRequest(clockOp(409), { expectedVersion: 1, expectedTick: 1, tick: 0 }),
    clockRequest(clockOp(410), { world: 'bad world' }), clockRequest('invalid')]) {
    await assert.rejects(store.commitGroundClock(raw), { code: 'operation' });
  }
  assert.equal(calls, 0); assert.equal(callbacks, 0);
});

test('SDK rejects mismatched clock/results/receipts instead of accepting unbound success', async () => {
  const raw = clockRequest(clockOp(420), { tick: 30 });
  const { operationId, ...request } = raw;
  const clock = { world: raw.world, tick: 30, version: 1, operationId };
  const result = { ok: true, replay: false, clock };
  let data;
  const store = createSupabaseStore({ rpc: async () => ({ data, error: null }) });
  for (const response of [{ ...clock, world: 'another:world' }, { ...clock, tick: '30' },
    { ...clock, extra: 1 }, { ...clock, version: 0 }, { ...clock, operationId: 'invalid' }]) {
    data = response; await assert.rejects(store.loadGroundClock(raw.world), { code: 'response' });
  }
  for (const response of [{ ...result, clock: { ...clock, tick: 31 } }, { ...result, clock: { ...clock, version: 2 } },
    { ...result, clock: { ...clock, operationId: clockOp(421) } }, { ok: false, why: 'unknown' },
    { ok: false, why: 'conflict', extra: true }, { ...result, replay: 'true' }]) {
    data = response; await assert.rejects(store.commitGroundClock(raw), { code: 'response' });
  }
  for (const response of [{ request, result: { ...result, replay: true } },
    { request: { ...request, tick: 29 }, result }, { request: { ...request, operationId }, result },
    { request, result: null }, { request, result, extra: true }]) {
    data = response; await assert.rejects(store.loadGroundClockOperation(operationId), { code: 'response' });
  }
  data = { request, result }; assert.deepEqual(await store.loadGroundClockOperation(operationId), data);
});

test('SQL013 grants no direct service writes and keeps guarded receipts immutable', async () => {
  const f = await database();
  try {
    const raw = clockRequest(clockOp(450)), result = await f.store.commitGroundClock(raw);
    for (const table of ['mn_ground_clocks', 'mn_ground_clock_operations']) for (const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE']) {
      const r = await f.db.query('select pg_catalog.has_table_privilege($1,$2,$3) as allowed', ['service_role', 'public.' + table, privilege]);
      assert.equal(r.rows[0].allowed, false, table + ' ' + privilege);
    }
    const metadata = await f.db.query("select prosecdef,proconfig from pg_catalog.pg_proc where oid='public.mn_commit_ground_clock(uuid,jsonb)'::regprocedure");
    assert.equal(metadata.rows[0].prosecdef, true);
    assert.ok(metadata.rows[0].proconfig.includes('search_path=""'));
    const rls = await f.db.query("select relname,relrowsecurity from pg_catalog.pg_class where oid in ('public.mn_ground_clocks'::regclass,'public.mn_ground_clock_operations'::regclass)");
    assert.equal(rls.rows.length, 2); assert.ok(rls.rows.every((r) => r.relrowsecurity));
    await f.db.exec('RESET ROLE');
    await assert.rejects(f.db.query('update public.mn_ground_clock_operations set created_at=now() where operation_id=$1::uuid', [raw.operationId]), { code: 'MNP02' });
    await f.db.exec('SET ROLE service_role');
    assert.deepEqual(await f.store.loadGroundClock(raw.world), result.clock);
  } finally { await f.close(); }
});

test('SQL013 rejects invalid JSON types/ranges without creating a row or receipt', async () => {
  const f = await database();
  try {
    const raw = clockRequest(clockOp(460)); const { operationId, ...request } = raw;
    for (const bad of [null, [], { ...request, extra: 1 }, { ...request, world: 'bad world' },
      { ...request, expectedVersion: '0' }, { ...request, expectedVersion: 2147483647 },
      { ...request, expectedTick: 1 }, { ...request, tick: -1 }, { ...request, tick: 9007199254740992 },
      { ...request, tick: 1.25 }, { ...request, expectedVersion: 1, expectedTick: 2, tick: 2 }]) {
      const reply = await f.db.query('select public.mn_commit_ground_clock($1::uuid,$2::jsonb) as data', [operationId, bad]);
      assert.deepEqual(reply.rows[0].data, { ok: false, why: 'operation' });
    }
    assert.equal(await f.store.loadGroundClock(raw.world), null);
    assert.equal(await f.store.loadGroundClockOperation(operationId), null);
  } finally { await f.close(); }
});


test('SQL013 permits the last safe version and refuses overflow without losing the checkpoint', async () => {
  const f = await database();
  try {
    const priorId = clockOp(470), prior = { world: CLOCK_WORLD, expectedVersion: 2147483645, expectedTick: 0, tick: 1 };
    // Privileged fixture establishes a near-cap history; service callers cannot seed these tables.
    await f.db.exec('RESET ROLE');
    await f.db.query('insert into public.mn_ground_clock_operations(operation_id,request,result) values($1::uuid,$2::jsonb,public.mn_ground_clock_result($1::uuid,$2::jsonb))', [priorId, prior]);
    await f.db.query('insert into public.mn_ground_clocks(world,tick,version,operation_id) values($1,1,2147483646,$2::uuid)', [CLOCK_WORLD, priorId]);
    await f.db.exec('SET ROLE service_role');
    const result = await f.store.commitGroundClock(clockRequest(clockOp(471), { expectedVersion: 2147483646, expectedTick: 1, tick: 2 }));
    assert.equal(result.clock.version, 2147483647);
    assert.deepEqual(await f.store.loadGroundClock(CLOCK_WORLD), result.clock);
    await assert.rejects(f.store.commitGroundClock(clockRequest(clockOp(472), { expectedVersion: 2147483647, expectedTick: 2, tick: 3 })), { code: 'operation' });
    assert.equal(await f.store.loadGroundClockOperation(clockOp(472)), null);
    assert.deepEqual(await f.store.loadGroundClock(CLOCK_WORLD), result.clock);
  } finally { await f.close(); }
});
